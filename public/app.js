'use strict';

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

const $app = document.getElementById('app');
const $conn = document.getElementById('conn');
const $toast = document.getElementById('toast');

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}

const COLORS = ['#e4572e', '#29a3a3', '#f2a541', '#7b5ea7', '#2e86de', '#e84393', '#3caa5d', '#8d6e63', '#c0392b', '#16a085', '#d35400', '#5f6caf'];
function colorOf(id) {
  const idx = state ? state.players.findIndex((p) => p.id === id) : 0;
  return COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
}
function playerById(id) {
  return state.players.find((p) => p.id === id);
}
function nameOf(id) {
  return playerById(id)?.name ?? '（退出）';
}
function avatar(id) {
  const name = nameOf(id);
  return h('span', { class: 'avatar', style: `background:${colorOf(id)}` }, [...name][0] || '?');
}

// ---------------------------------------------------------------------------
// 通信
// ---------------------------------------------------------------------------

let myId = store.get('chameleon.id');
let state = null;
let es = null;
let leaving = false;
let revealedRound = Number(store.get('chameleon.revealed') || 0);

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '通信エラー');
  return data;
}

async function act(type, extra) {
  try {
    await api('/api/action', { id: myId, type, ...extra });
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

async function join(name) {
  leaving = false;
  const { id } = await api('/api/join', { id: myId, name });
  myId = id;
  store.set('chameleon.id', id);
  if (name) store.set('chameleon.name', name);
  connect();
}

function connect() {
  if (es) es.close();
  es = new EventSource(`/api/events?id=${encodeURIComponent(myId)}`);
  es.onopen = () => setConn(true);
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.kicked) {
      kickedOut('ホストに外されました');
      return;
    }
    state = data;
    render();
  };
  es.onerror = async () => {
    if (leaving || !es) return;
    setConn(false);
    // サーバーが再起動して自分のIDが消えていたら入り直す
    try {
      const res = await fetch(`/api/events?id=${encodeURIComponent(myId)}`, { method: 'HEAD' });
      if (res.status === 404) {
        const name = store.get('chameleon.name');
        es.close();
        myId = null;
        store.del('chameleon.id');
        if (name) join(name).catch(() => kickedOut());
        else kickedOut();
      }
    } catch {}
  };
}

function kickedOut(msg) {
  if (es) es.close();
  es = null;
  myId = null;
  state = null;
  store.del('chameleon.id');
  if (msg) toast(msg);
  render();
}

function setConn(ok) {
  $conn.textContent = ok ? '● 接続中' : '○ 再接続中…';
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

let lastRenderKey = null;
function render() {
  // 入力中のテキストとフォーカスを保持
  const active = document.activeElement;
  const keepId = active && active.id;
  const saved = {};
  for (const el of $app.querySelectorAll('input[id]')) saved[el.id] = el.value;

  $app.replaceChildren(...(state && myId ? screen() : joinScreen()));

  // アニメーションは場面が変わったときだけ
  const key = state ? `${state.phase}-${state.roundNo}-${state.round?.turn}-${state.round?.runoff}-${revealedRound}` : '';
  if (key === lastRenderKey) for (const el of $app.querySelectorAll('.pop')) el.classList.remove('pop');
  lastRenderKey = key;

  for (const [id, v] of Object.entries(saved)) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = v;
  }
  if (keepId) document.getElementById(keepId)?.focus();
}

function joinScreen() {
  const input = h('input', {
    type: 'text', id: 'nameInput', placeholder: 'ニックネーム（12文字まで）', maxlength: 12,
    autocomplete: 'off', enterkeyhint: 'go',
  });
  input.value = store.get('chameleon.name') || '';
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return toast('名前を入力してね');
    try { await join(name); } catch (e) { toast(e.message); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  return [
    h('div', { class: 'card center' },
      h('div', { style: 'font-size:64px' }, '🦎'),
      h('h2', {}, 'めっちゃカメレオン'),
      h('p', { class: 'muted' }, 'みんなに紛れたカメレオンを探せ！ 同じWiFiのスマホで遊べる正体隠しゲーム'),
    ),
    h('div', { class: 'card stack' },
      h('h2', {}, '参加する'),
      input,
      h('button', { class: 'block', onclick: submit }, 'はじめる'),
    ),
    rulesCard(),
  ];
}

function rulesCard() {
  return h('div', { class: 'card' },
    h('details', {},
      h('summary', {}, '遊び方'),
      h('ol', { class: 'rules' },
        h('li', {}, '16個のワードが並んだお題カードが配られます。'),
        h('li', {}, 'カメレオン以外の人には「秘密のワード」が知らされます。カメレオン（1人）だけは知りません。'),
        h('li', {}, '順番に、秘密のワードに関係するヒントを1つずつ出します。具体的すぎるとカメレオンにバレる、ぼかしすぎると疑われる！'),
        h('li', {}, 'カメレオンは他の人のヒントから推測して、バレないようにそれっぽいヒントを出します。'),
        h('li', {}, '話し合って、カメレオンだと思う人に投票！ 同票なら1回だけ決選投票。'),
        h('li', {}, 'カメレオンが見破られたら、カメレオンは秘密のワードを当てるチャンス。当てたら逃げ切り！'),
      ),
      h('p', { class: 'muted' }, '得点：カメレオンが逃げ切り → カメレオン+2 ／ 見破られたがワード正解 → カメレオン+1 ／ 捕まえた → 他の全員+2'),
    ),
  );
}

function screen() {
  const r = state.round;
  const parts = [];
  switch (state.phase) {
    case 'lobby': parts.push(...lobbyScreen()); break;
    case 'clue': parts.push(...clueScreen(r)); break;
    case 'vote': parts.push(...voteScreen(r)); break;
    case 'guess': parts.push(...guessScreen(r)); break;
    case 'result': parts.push(...resultScreen(r)); break;
  }
  parts.push(playersCard());
  parts.push(rulesCard());
  return parts;
}

const isHost = () => state.hostId === myId;

// --- ロビー ---------------------------------------------------------------

function topicSelect() {
  const sel = h('select', { id: 'topicSelect' },
    h('option', { value: 'random' }, '🎲 ランダム'),
    state.topics.map((t) => h('option', { value: t.idx }, t.name)),
  );
  sel.value = store.get('chameleon.topic') || 'random';
  sel.addEventListener('change', () => store.set('chameleon.topic', sel.value));
  return sel;
}

function hostControls(label) {
  const online = state.players.filter((p) => p.connected).length;
  const enough = online >= state.minPlayers;
  const sel = topicSelect();
  return h('div', { class: 'card stack' },
    h('h2', {}, 'ホスト操作'),
    h('label', { class: 'muted', for: 'topicSelect' }, 'お題カード'),
    sel,
    h('button', {
      class: 'block', disabled: !enough,
      onclick: () => act('start', { topic: sel.value }),
    }, label),
    !enough && h('p', { class: 'muted center' }, `あと${state.minPlayers - online}人以上集まると始められます`),
  );
}

function lobbyScreen() {
  const parts = [
    h('div', { class: 'card' },
      h('h2', {}, '友だちを呼ぼう'),
      h('p', { class: 'muted' }, '同じWiFiにつないで、ブラウザでこのアドレスを開いてもらってね'),
      state.urls.length
        ? state.urls.map((u) => h('p', { class: 'url' }, u))
        : h('p', { class: 'url' }, location.origin),
    ),
  ];
  if (isHost()) parts.push(hostControls('ゲーム開始！'));
  else parts.push(h('div', { class: 'card center' }, h('p', {}, `ホスト（${nameOf(state.hostId)}）の開始を待っています…`)));
  return parts;
}

// --- 役割・お題カード -------------------------------------------------------

function roleCard(r) {
  if (!r.inRound) {
    return h('div', { class: 'role hidden' },
      h('div', { class: 'big' }, '👀 観戦中'),
      h('div', { class: 'hint' }, '次のラウンドから参加できます'),
    );
  }
  const shown = revealedRound === state.roundNo;
  const toggle = () => {
    revealedRound = shown ? 0 : state.roundNo;
    store.set('chameleon.revealed', String(revealedRound));
    render();
  };
  if (!shown) {
    return h('div', { class: 'role hidden', onclick: toggle },
      h('div', { class: 'big' }, '🃏 タップして役割を確認'),
      h('div', { class: 'hint' }, 'まわりの人に見られないように！'),
    );
  }
  if (r.isChameleon) {
    return h('div', { class: 'role chameleon pop', onclick: toggle },
      h('div', {}, 'あなたは…'),
      h('div', { class: 'big' }, '🦎 カメレオン！'),
      h('div', {}, '秘密のワードはわかりません。みんなのヒントから推理して、バレないように紛れ込もう'),
      h('div', { class: 'hint' }, 'タップで隠す'),
    );
  }
  return h('div', { class: 'role normal pop', onclick: toggle },
    h('div', {}, '秘密のワードは'),
    h('div', { class: 'big' }, `「${r.words[r.secret]}」`),
    h('div', {}, 'カメレオンにバレないように、でも仲間には伝わるヒントを！'),
    h('div', { class: 'hint' }, 'タップで隠す'),
  );
}

function gridCard(r, opts = {}) {
  const showSecret = opts.reveal || (revealedRound === state.roundNo && r.secret != null);
  const cols = ['A', 'B', 'C', 'D'];
  const cells = [h('span'), cols.map((c) => h('span', { class: 'axis' }, c))];
  for (let row = 0; row < 4; row++) {
    cells.push(h('span', { class: 'axis' }, row + 1));
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      let cls = 'cell';
      if (showSecret && i === r.secret) cls += ' secret';
      if (opts.wrong === i) cls += ' wrong';
      if (opts.onPick) cls += ' pickable';
      cells.push(h('div', { class: cls, onclick: opts.onPick ? () => opts.onPick(i) : null }, r.words[i]));
    }
  }
  return h('div', { class: 'card' },
    h('div', { class: 'topic-name' }, `お題：${r.topic}`),
    opts.title && h('p', { style: 'font-weight:700' }, opts.title),
    h('div', { class: 'grid' }, cells),
  );
}

function cluesCard(r) {
  return h('div', { class: 'card' },
    h('h2', {}, 'ヒント'),
    h('ul', { class: 'clues' },
      r.order.map((id, i) => {
        const done = id in r.clues;
        const current = state.phase === 'clue' && i === r.turn;
        return h('li', { class: current ? 'current' : '' },
          avatar(id),
          h('span', { class: 'pname' }, nameOf(id), id === myId && h('span', { class: 'tag' }, 'あなた')),
          done
            ? h('span', { class: 'clue' }, r.clues[id])
            : h('span', { class: 'waiting' }, current ? '考え中…' : '—'),
        );
      }),
    ),
  );
}

// --- ヒントフェーズ ---------------------------------------------------------

function clueScreen(r) {
  const parts = [roleCard(r)];
  const currentId = r.order[r.turn];
  if (currentId === myId) {
    const input = h('input', {
      type: 'text', id: 'clueInput', placeholder: 'ヒントを1つ（20文字まで）', maxlength: 20,
      autocomplete: 'off', enterkeyhint: 'send',
    });
    const submit = () => {
      const text = input.value.trim();
      if (!text) return toast('ヒントを入力してね');
      input.value = '';
      act('clue', { text });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
    parts.push(h('div', { class: 'card stack pop', style: 'border:3px solid var(--yellow)' },
      h('h2', {}, '✏️ あなたの番です！'),
      revealedRound !== state.roundNo && h('p', { class: 'muted' }, '先に上のカードで役割を確認してね'),
      h('div', { class: 'row' }, input, h('button', { onclick: submit }, '出す')),
    ));
  } else {
    parts.push(h('div', { class: 'card center' },
      h('p', {}, h('b', {}, nameOf(currentId)), ' さんがヒントを考えています…'),
      isHost() && h('button', { class: 'small secondary', onclick: () => act('skip') }, 'この人をスキップ'),
    ));
  }
  parts.push(cluesCard(r), gridCard(r));
  return parts;
}

// --- 投票フェーズ -----------------------------------------------------------

function voteScreen(r) {
  const parts = [];
  parts.push(h('div', { class: 'card' },
    h('h2', {}, r.runoff ? '⚖️ 決選投票！' : '🗳️ カメレオンは誰だ？'),
    h('p', { class: 'muted' }, r.runoff ? '同票だったので、この中からもう一度選んでね' : 'ヒントをもとに話し合って、怪しい人に投票！'),
    r.inRound
      ? h('div', { class: 'vote-list' },
          r.candidates.filter((id) => id !== myId).map((id) =>
            h('button', {
              class: 'vote-btn' + (r.myVote === id ? ' selected' : ''),
              onclick: () => act('vote', { target: id }),
            }, avatar(id), nameOf(id), h('span', { class: 'clue' }, r.clues[id] ?? '')),
          ),
        )
      : h('p', {}, '観戦中です'),
    h('p', { class: 'muted center', style: 'margin-top:10px' },
      `投票済み ${r.voted.length} / ${r.order.length} 人`,
      r.myVote && '（変更できます）'),
    isHost() && r.voted.length > 0 && r.voted.length < r.order.length &&
      h('button', { class: 'small secondary block', onclick: () => act('forceTally') }, '今の票で締め切る'),
  ));
  parts.push(roleCard(r), cluesCard(r), gridCard(r));
  return parts;
}

// --- カメレオンの推理フェーズ -----------------------------------------------

function guessScreen(r) {
  const parts = [];
  const caught = h('div', { class: 'banner win-others pop' },
    `🎯 ${nameOf(r.accusedId)} さんはカメレオンだった！`,
    h('div', { class: 'sub' }, 'でもカメレオンには最後のチャンス。秘密のワードを当てたら逃げ切り！'),
  );
  parts.push(caught);
  if (r.isChameleon) {
    parts.push(gridCard(r, {
      title: '秘密のワードはどれ？ タップして答えよう',
      onPick: (i) => {
        if (confirm(`「${r.words[i]}」で答えますか？`)) act('guess', { index: i });
      },
    }));
    parts.push(cluesCard(r));
  } else {
    parts.push(h('div', { class: 'card center' }, h('p', {}, '🦎 カメレオンが秘密のワードを推理中…')));
    parts.push(cluesCard(r), gridCard(r));
  }
  parts.push(tallyCard(r));
  return parts;
}

function tallyCard(r) {
  if (!r.voteTally) return null;
  const votes = r.voteTally._votes || {};
  const ids = Object.keys(r.voteTally).filter((k) => k !== '_votes').sort((a, b) => r.voteTally[b] - r.voteTally[a]);
  const total = Math.max(1, Object.keys(votes).length);
  return h('div', { class: 'card' },
    h('h2', {}, r.runoff ? '投票結果（決選投票）' : '投票結果'),
    ids.map((id) => {
      const voters = Object.keys(votes).filter((v) => votes[v] === id).map(nameOf);
      return h('div', { style: 'margin:8px 0' },
        h('div', { class: 'row' },
          avatar(id),
          h('span', { class: 'pname' }, nameOf(id)),
          h('span', { class: 'score' }, `${r.voteTally[id]}票`),
        ),
        h('div', { class: 'bar' }, h('div', { style: `width:${(r.voteTally[id] / total) * 100}%` })),
        voters.length > 0 && h('div', { class: 'muted' }, '← ' + voters.join('、')),
      );
    }),
  );
}

// --- 結果 -------------------------------------------------------------------

function resultScreen(r) {
  const chameleonWins = r.outcome === 'escaped' || r.outcome === 'guessed';
  const title = chameleonWins ? '🦎 カメレオンの勝ち！' : '🎉 みんなの勝ち！';
  const parts = [
    h('div', { class: `banner pop ${chameleonWins ? 'win-chameleon' : 'win-others'}` },
      title,
      h('div', { class: 'sub' }, r.outcomeReason),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        avatar(r.chameleonId),
        h('div', { class: 'pname' }, 'カメレオンは ', h('b', {}, nameOf(r.chameleonId)), ' さんでした'),
      ),
      h('p', {}, '秘密のワード：', h('b', {}, `「${r.words[r.secret]}」`)),
      r.guess != null && h('p', {}, 'カメレオンの答え：', h('b', {}, `「${r.words[r.guess]}」`), r.guess === r.secret ? ' ⭕' : ' ❌'),
      Object.keys(r.scoreDelta).length > 0 && h('p', { class: 'muted' },
        Object.entries(r.scoreDelta).map(([id, d]) => `${nameOf(id)} +${d}`).join('　')),
    ),
  ];
  if (isHost()) parts.push(hostControls('次のラウンドへ'));
  else parts.push(h('div', { class: 'card center' }, h('p', {}, 'ホストが次のラウンドを始めるのを待っています…')));
  parts.push(
    gridCard(r, { reveal: true, wrong: r.guess != null && r.guess !== r.secret ? r.guess : null }),
    cluesCard(r),
    tallyCard(r),
  );
  return parts;
}

// --- プレイヤー一覧 ---------------------------------------------------------

function playersCard() {
  const canManage = state.phase === 'lobby' || state.phase === 'result';
  const sorted = state.players.slice();
  if (state.phase === 'result') sorted.sort((a, b) => b.score - a.score);
  const me = playerById(myId);
  return h('div', { class: 'card' },
    h('h2', {}, `プレイヤー（${state.players.filter((p) => p.connected).length}人）`),
    h('ul', { class: 'players' },
      sorted.map((p) => h('li', { class: p.connected ? '' : 'offline' },
        avatar(p.id),
        h('span', { class: 'pname' },
          p.name,
          p.id === state.hostId && h('span', { class: 'tag' }, 'ホスト'),
          p.id === myId && h('span', { class: 'tag' }, 'あなた'),
          !p.connected && h('span', { class: 'tag' }, '切断中'),
        ),
        h('span', { class: 'score' }, `${p.score}点`),
        isHost() && canManage && p.id !== myId &&
          h('button', { class: 'small secondary', onclick: () => confirm(`${p.name} さんを外しますか？`) && act('kick', { target: p.id }) }, '外す'),
      )),
    ),
    canManage && h('div', { class: 'row', style: 'margin-top:10px; flex-wrap:wrap' },
      h('button', {
        class: 'small secondary',
        onclick: () => {
          const name = prompt('新しい名前', me?.name || '');
          if (name && name.trim()) {
            store.set('chameleon.name', name.trim());
            act('rename', { name });
          }
        },
      }, '名前を変える'),
      isHost() && h('button', { class: 'small secondary', onclick: () => confirm('全員の得点を0にしますか？') && act('resetScores') }, '得点リセット'),
      h('button', {
        class: 'small secondary',
        onclick: async () => {
          if (!confirm('退出しますか？')) return;
          leaving = true;
          const ok = await act('leave');
          leaving = false;
          if (ok) kickedOut();
        },
      }, '退出'),
    ),
    isHost() && !canManage && h('div', { style: 'margin-top:10px' },
      h('button', { class: 'small danger', onclick: () => confirm('このラウンドを中止してロビーに戻りますか？') && act('toLobby') }, 'ラウンド中止'),
    ),
  );
}

// ---------------------------------------------------------------------------

if (myId) connect();
render();
