// めっちゃカメレオン - LAN対戦サーバー
// 依存パッケージなし（Node.js 標準モジュールのみ）。
// 通信は Server-Sent Events（サーバー→端末）と fetch POST（端末→サーバー）で行う。

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const TOPICS = require('./topics');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const AWAY_MS = 15000; // これ以上切断していたら「不在」扱い

// ---------------------------------------------------------------------------
// ゲーム状態（1サーバー = 1部屋）
// ---------------------------------------------------------------------------

const players = new Map(); // id -> { id, name, score, streams: Set<res>, joinedAt }
let hostId = null;
let phase = 'lobby'; // lobby | clue | vote | guess | result
let round = null;
let roundNo = 0;
let lastTopicIdx = -1;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isConnected(p) {
  return p.streams.size > 0;
}

function isAway(p) {
  return !p || (!isConnected(p) && Date.now() - (p.disconnectedAt || 0) >= AWAY_MS);
}

function cleanText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function ensureHost() {
  const host = players.get(hostId);
  if (host && !isAway(host)) return;
  const candidates = [...players.values()].filter(isConnected).sort((a, b) => a.joinedAt - b.joinedAt);
  if (candidates.length) hostId = candidates[0].id;
  else if (!host) hostId = players.size ? [...players.keys()][0] : null;
}

function startRound(topicChoice) {
  const active = [...players.values()].filter(isConnected);
  if (active.length < MIN_PLAYERS) throw new Error(`${MIN_PLAYERS}人以上で遊べます`);

  let topicIdx;
  if (Number.isInteger(topicChoice) && topicChoice >= 0 && topicChoice < TOPICS.length) {
    topicIdx = topicChoice;
  } else {
    do topicIdx = crypto.randomInt(TOPICS.length);
    while (TOPICS.length > 1 && topicIdx === lastTopicIdx);
  }
  lastTopicIdx = topicIdx;

  const order = shuffle(active.map((p) => p.id));
  roundNo++;
  round = {
    topicIdx,
    secret: crypto.randomInt(16),
    chameleonId: order[crypto.randomInt(order.length)],
    order,
    turn: 0,
    clues: {},
    votes: {},
    candidates: order.slice(),
    runoff: false,
    voteTally: null,
    accusedId: null,
    guess: null,
    outcome: null, // escaped | guessed | caught
    outcomeReason: null,
    scoreDelta: {},
  };
  phase = 'clue';
}

function finishRound(outcome, reason) {
  const r = round;
  r.outcome = outcome;
  r.outcomeReason = reason;
  if (outcome === 'escaped') {
    r.scoreDelta[r.chameleonId] = 2;
  } else if (outcome === 'guessed') {
    r.scoreDelta[r.chameleonId] = 1;
  } else {
    for (const id of r.order) if (id !== r.chameleonId) r.scoreDelta[id] = 2;
  }
  for (const [id, d] of Object.entries(r.scoreDelta)) {
    const p = players.get(id);
    if (p) p.score += d;
  }
  phase = 'result';
}

function tallyVotes() {
  const r = round;
  const counts = {};
  for (const id of r.candidates) counts[id] = 0;
  for (const target of Object.values(r.votes)) if (target in counts) counts[target]++;
  r.voteTally = { ...counts, _votes: { ...r.votes } };

  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === max);

  if (max === 0) return; // 誰も投票していない
  if (top.length > 1) {
    if (!r.runoff) {
      r.runoff = true;
      r.candidates = top;
      r.votes = {};
      return;
    }
    finishRound('escaped', '決選投票でも同票…カメレオンは逃げ切った！');
    return;
  }
  r.accusedId = top[0];
  if (r.accusedId !== r.chameleonId) {
    finishRound('escaped', '指名された人はカメレオンではなかった！');
  } else {
    phase = 'guess';
  }
}

function votersNeeded() {
  // しばらく回線が切れている人は待たない
  return round.order.filter((id) => !isAway(players.get(id)));
}

function maybeTally() {
  if (phase !== 'vote') return;
  const needed = votersNeeded();
  if (needed.length && needed.every((id) => id in round.votes)) tallyVotes();
}

function skipDisconnectedTurns() {
  if (phase !== 'clue') return;
  while (round.turn < round.order.length) {
    if (!isAway(players.get(round.order[round.turn]))) break;
    round.clues[round.order[round.turn]] = '（不在のためスキップ）';
    round.turn++;
  }
  if (round.turn >= round.order.length) phase = 'vote';
}

// ---------------------------------------------------------------------------
// アクション
// ---------------------------------------------------------------------------

function handleAction(pid, body) {
  const me = players.get(pid);
  if (!me) throw new Error('プレイヤーが見つかりません。再読み込みしてください');
  const isHost = pid === hostId;
  const r = round;

  switch (body.type) {
    case 'rename': {
      const name = cleanText(body.name, 12);
      if (!name) throw new Error('名前を入力してください');
      me.name = name;
      break;
    }
    case 'start': {
      if (!isHost) throw new Error('ホストのみ開始できます');
      if (phase !== 'lobby' && phase !== 'result') throw new Error('ゲーム中です');
      const t = body.topic === 'random' ? null : Number(body.topic);
      startRound(t);
      break;
    }
    case 'clue': {
      if (phase !== 'clue') throw new Error('今はヒントを出すフェーズではありません');
      if (r.order[r.turn] !== pid) throw new Error('あなたの番ではありません');
      const text = cleanText(body.text, 20);
      if (!text) throw new Error('ヒントを入力してください');
      r.clues[pid] = text;
      r.turn++;
      if (r.turn >= r.order.length) phase = 'vote';
      else skipDisconnectedTurns();
      break;
    }
    case 'skip': {
      if (!isHost) throw new Error('ホストのみ操作できます');
      if (phase !== 'clue') throw new Error('今はスキップできません');
      r.clues[r.order[r.turn]] = '（スキップ）';
      r.turn++;
      if (r.turn >= r.order.length) phase = 'vote';
      else skipDisconnectedTurns();
      break;
    }
    case 'vote': {
      if (phase !== 'vote') throw new Error('今は投票フェーズではありません');
      if (!r.order.includes(pid)) throw new Error('このラウンドには参加していません');
      if (!r.candidates.includes(body.target)) throw new Error('その人には投票できません');
      if (body.target === pid) throw new Error('自分には投票できません');
      r.votes[pid] = body.target;
      maybeTally();
      break;
    }
    case 'forceTally': {
      if (!isHost) throw new Error('ホストのみ操作できます');
      if (phase !== 'vote') throw new Error('今は集計できません');
      if (!Object.keys(r.votes).length) throw new Error('まだ誰も投票していません');
      tallyVotes();
      break;
    }
    case 'guess': {
      if (phase !== 'guess') throw new Error('今は推理フェーズではありません');
      if (pid !== r.chameleonId) throw new Error('カメレオンだけが答えられます');
      const idx = Number(body.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= 16) throw new Error('不正な選択です');
      r.guess = idx;
      if (idx === r.secret) finishRound('guessed', '見破られたけど、お題を当てて逃げ切った！');
      else finishRound('caught', 'カメレオンを捕まえた！お題も外れ！');
      break;
    }
    case 'toLobby': {
      if (!isHost) throw new Error('ホストのみ操作できます');
      phase = 'lobby';
      round = null;
      break;
    }
    case 'resetScores': {
      if (!isHost) throw new Error('ホストのみ操作できます');
      if (phase !== 'lobby' && phase !== 'result') throw new Error('ゲーム中はリセットできません');
      for (const p of players.values()) p.score = 0;
      break;
    }
    case 'kick': {
      if (!isHost) throw new Error('ホストのみ操作できます');
      if (phase !== 'lobby' && phase !== 'result') throw new Error('ゲーム中は外せません');
      const t = players.get(body.target);
      if (!t || t.id === pid) throw new Error('外せません');
      for (const res of t.streams) {
        send(res, { kicked: true });
        res.end();
      }
      players.delete(t.id);
      break;
    }
    case 'leave': {
      if (phase !== 'lobby' && phase !== 'result') throw new Error('ゲーム中は退出できません');
      for (const res of me.streams) res.end();
      players.delete(pid);
      ensureHost();
      break;
    }
    default:
      throw new Error('不明なアクションです');
  }
}

// ---------------------------------------------------------------------------
// 状態配信（プレイヤーごとに見える情報を変える）
// ---------------------------------------------------------------------------

function viewFor(pid) {
  const list = [...players.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: isConnected(p) }));

  const view = {
    you: pid,
    hostId,
    phase,
    roundNo,
    players: list,
    topics: TOPICS.map((t, i) => ({ idx: i, name: t.name })),
    minPlayers: MIN_PLAYERS,
    urls: lanUrls(),
  };

  if (round) {
    const r = round;
    const inRound = r.order.includes(pid);
    const revealed = phase === 'result';
    const isChameleon = pid === r.chameleonId;
    view.round = {
      topic: TOPICS[r.topicIdx].name,
      words: TOPICS[r.topicIdx].words,
      inRound,
      isChameleon: inRound && isChameleon,
      secret: revealed || (inRound && !isChameleon) ? r.secret : null,
      chameleonId: revealed ? r.chameleonId : null,
      order: r.order,
      turn: r.turn,
      clues: r.clues,
      candidates: r.candidates,
      runoff: r.runoff,
      voted: Object.keys(r.votes),
      myVote: r.votes[pid] ?? null,
      voteTally: phase === 'guess' || revealed ? r.voteTally : null,
      accusedId: r.accusedId,
      guess: revealed ? r.guess : null,
      outcome: r.outcome,
      outcomeReason: r.outcomeReason,
      scoreDelta: revealed ? r.scoreDelta : {},
    };
  }
  return view;
}

function send(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast() {
  ensureHost();
  for (const p of players.values()) {
    if (!p.streams.size) continue;
    const v = viewFor(p.id);
    for (const res of p.streams) send(res, v);
  }
}

setInterval(() => {
  for (const p of players.values()) for (const res of p.streams) res.write(': ping\n\n');
}, 20000);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10000) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  try {
    if (req.method === 'POST' && pathname === '/api/join') {
      const body = await readBody(req);
      const name = cleanText(body.name, 12);
      let p = typeof body.id === 'string' ? players.get(body.id) : null;
      if (!p) {
        if (!name) return json(res, 400, { error: '名前を入力してください' });
        if (players.size >= MAX_PLAYERS) return json(res, 400, { error: `満員です（最大${MAX_PLAYERS}人）` });
        p = { id: crypto.randomUUID(), name, score: 0, streams: new Set(), joinedAt: Date.now() };
        players.set(p.id, p);
        if (!hostId) hostId = p.id;
      } else if (name) {
        p.name = name;
      }
      broadcast();
      return json(res, 200, { id: p.id });
    }

    if (req.method === 'HEAD' && pathname === '/api/events') {
      res.writeHead(players.has(url.searchParams.get('id')) ? 200 : 404).end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      const p = players.get(url.searchParams.get('id'));
      if (!p) return json(res, 404, { error: 'unknown player' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      p.streams.add(res);
      req.socket.setKeepAlive(true);
      broadcast();
      req.on('close', () => {
        p.streams.delete(res);
        if (!isConnected(p)) {
          p.disconnectedAt = Date.now();
          // ヒント番・投票待ちで止まらないように進める
          skipDisconnectedTurnsLater(p.id);
        }
        broadcast();
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/action') {
      const body = await readBody(req);
      try {
        handleAction(String(body.id || ''), body);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      broadcast();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    res.writeHead(405).end();
  } catch (e) {
    json(res, 400, { error: 'リクエストが不正です' });
  }
});

// スマホのスリープなどで一瞬切れることがあるので、少し待ってから判定する
function skipDisconnectedTurnsLater(pid) {
  setTimeout(() => {
    const p = players.get(pid);
    if (!p || isConnected(p)) return; // 戻ってきた
    if (round) {
      skipDisconnectedTurns();
      maybeTally();
    }
    broadcast();
  }, AWAY_MS + 100);
}

function lanUrls() {
  const urls = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  }
  return urls;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  🦎 めっちゃカメレオン サーバー起動！');
  console.log('');
  console.log('  同じWiFiにつないだスマホ/PCのブラウザで開いてね:');
  const urls = lanUrls();
  if (urls.length) for (const u of urls) console.log(`    ${u}`);
  else console.log('    (LANのIPアドレスが見つかりませんでした)');
  console.log(`    http://localhost:${PORT}  (このPCから)`);
  console.log('');
});
