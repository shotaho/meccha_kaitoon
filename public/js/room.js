// 部屋（ゲーム進行）のロジック。
// Node.js サーバー（LAN版）でも、ホストのブラウザ（GitHub Pages版・P2P）でも同じものを使う。
// 依存なし・DOM なし。
//
// 使い方:
//   const room = createRoom({ getUrls: () => [...] });
//   const h = room.addConnection({ send(str) {...}, close() {...} });
//   受信したら h.message(str) / 切断したら h.close()

import { MAPS, groundY } from './maps.js';

const MAX_PLAYERS = 16; // 人間の最大人数（CPU は別）
const MAX_CPUS = 7;
const MIN_PLAYERS = 2; // 人間が1人だけなら CPU を自動で入れる
const TICK_MS = 66; // 位置の配信間隔（約15Hz）
const SHOT_COOLDOWN_MS = 600;
const MAX_OPS_PER_PLAYER = 20000;
const CPU_LEVELS = new Set(['easy', 'normal', 'hard']);

const LIMITS = {
  prepSec: [20, 600],
  huntSec: [20, 600],
  penaltySec: [0, 30],
  seekers: [1, 8],
  cpus: [0, MAX_CPUS],
};

const POSES = new Set(['stand', 'crouch', 'curl', 'lie', 'banzai', 'star', 'flip']);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validVec(v, n) {
  return Array.isArray(v) && v.length === n && v.every(isNum);
}

function cleanText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function makeId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function sanitizeOp(op) {
  if (!op || typeof op !== 'object') return null;
  const g = Number(op.g) || 0;
  if (op.k === 'c') return { k: 'c', g };
  const part = Number(op.p);
  if (!Number.isInteger(part) || part < 0 || part > 16) return null;
  if (!COLOR_RE.test(op.c)) return null;
  if (op.k === 's') {
    if (!isNum(op.r) || !Array.isArray(op.pts)) return null;
    const pts = op.pts.slice(0, 400).filter(isNum).map((v) => clamp(v, -0.2, 1.2));
    if (pts.length < 2 || pts.length % 2) return null;
    return { k: 's', g, p: part, c: op.c, r: clamp(op.r, 0.5, 300), pts };
  }
  if (op.k === 'f') return { k: 'f', g, p: part, c: op.c };
  return null;
}

export function createRoom({ getUrls = () => [] } = {}) {
  // player = { id, name, score, joinedAt, conn, seekerCount,
  //            role: 'none'|'hider'|'seeker'|'spectator', found, foundBy,
  //            tf: { p:[x,y,z], r:[yaw,pitch,roll], pose, look:[yaw,pitch] }, ops: [], lastShot }
  const players = new Map();
  let hostId = null;
  let phase = 'lobby'; // lobby | prep | hunt | result
  let phaseEndsAt = 0;
  let roundNo = 0;
  let foundLog = [];
  let roundResult = null;
  const timers = [];

  const settings = {
    mode: 'normal', // normal | infect（増え鬼）
    seekers: 1,
    prepSec: 120,
    huntSec: 120,
    penaltySec: 5,
    map: 'house',
    cpus: 0,
    cpuLevel: 'normal',
  };

  function send(p, msg) {
    p.conn?.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  // 参加中（接続している人間か CPU）
  function online() {
    return [...players.values()].filter((p) => p.conn || p.cpu);
  }

  function humans() {
    return [...players.values()].filter((p) => !p.cpu);
  }

  // CPU の人数を設定に合わせる
  function syncCpus() {
    const cpus = [...players.values()].filter((p) => p.cpu);
    while (cpus.length > settings.cpus) players.delete(cpus.pop().id);
    let n = 1;
    while (cpus.length < settings.cpus) {
      const used = new Set([...players.values()].map((q) => q.name));
      while (used.has(`CPU${n}`)) n++;
      const p = newPlayer(`CPU${n}`);
      p.cpu = true;
      p.joinedAt = Date.now() + 1e12 + n; // 一覧では人間の後ろ
      players.set(p.id, p);
      cpus.push(p);
    }
  }

  function newPlayer(name) {
    return {
      id: makeId(),
      name,
      score: 0,
      joinedAt: Date.now(),
      conn: null,
      cpu: false,
      seekerCount: 0,
      role: phase === 'lobby' ? 'none' : 'spectator',
      found: false,
      foundBy: null,
      spot: null,
      tf: { p: [0, 0, 0], r: [0, 0, 0], pose: 'stand', look: [0, 0] },
      ops: [],
      lastShot: 0,
    };
  }

  function seekerTf() {
    const m = MAPS[settings.map];
    const [x, y, z] = m.seekerSpawn;
    return { p: [x, y ?? groundY(settings.map, x, z), z], r: [m.seekerLook + Math.PI, 0, 0], pose: 'stand', look: [m.seekerLook, 0] };
  }

  function ensureHost() {
    const h = players.get(hostId);
    if (h && h.conn) return;
    const c = [...players.values()].filter((p) => p.conn).sort((a, b) => a.joinedAt - b.joinedAt);
    if (c.length) hostId = c[0].id;
  }

  function publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      score: p.score,
      online: !!p.conn || p.cpu,
      cpu: p.cpu,
      spot: p.spot,
      role: p.role,
      found: p.found,
      foundBy: p.foundBy,
    };
  }

  function stateMsg() {
    ensureHost();
    return {
      t: 'state',
      hostId,
      phase,
      roundNo,
      remainMs: phaseEndsAt ? Math.max(0, phaseEndsAt - Date.now()) : 0,
      settings,
      players: [...players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map(publicPlayer),
      foundLog,
      result: roundResult,
      urls: getUrls(),
    };
  }

  function broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const p of players.values()) if (p.conn && p.id !== exceptId) p.conn.send(s);
  }

  function broadcastState() {
    broadcast(stateMsg());
  }

  function systemMsg(text) {
    broadcast({ t: 'log', text });
  }

  // ----- ラウンド進行 -----

  // role: 人間が1人（CPU 戦）のとき、その人が選んだ役 'seeker' | 'hider'
  function startRound(role) {
    // 1人だけなら CPU と対戦する
    if (online().length < MIN_PLAYERS && !settings.cpus) {
      settings.cpus = 3;
      syncCpus();
    }
    const list = online();
    if (list.length < MIN_PLAYERS) throw new Error(`${MIN_PLAYERS}にんいじょうであそべます`);
    const nSeek = clamp(settings.seekers, 1, list.length - 1);

    let seekers;
    const people = list.filter((p) => !p.cpu);
    const cpus = list.filter((p) => p.cpu).sort(() => Math.random() - 0.5);
    if (people.length === 1 && cpus.length && (role === 'seeker' || role === 'hider')) {
      // CPU 戦：えらんだ役にする
      seekers = role === 'seeker'
        ? new Set([people[0].id])
        : new Set(cpus.slice(0, clamp(settings.seekers, 1, cpus.length)).map((p) => p.id));
    } else {
      // 鬼をやった回数が少ない人を優先してランダムに選ぶ
      const order = list
        .map((p) => ({ p, k: p.seekerCount + Math.random() * 0.9 }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.p);
      seekers = new Set(order.slice(0, nSeek).map((p) => p.id));
    }

    roundNo++;
    foundLog = [];
    roundResult = null;
    let hi = 0;
    const map = MAPS[settings.map];
    const hiderCount = list.filter((p) => !p.cpu).length - [...seekers].filter((id) => !players.get(id).cpu).length;
    // CPU が隠れる場所をランダムに選ぶ（重ならないように）
    const spotIdx = map.spots.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (const p of players.values()) {
      p.found = false;
      p.foundBy = null;
      p.ops = [];
      p.lastShot = 0;
      p.spot = null;
      if (!p.conn && !p.cpu) {
        p.role = 'spectator';
      } else if (seekers.has(p.id)) {
        p.role = 'seeker';
        p.seekerCount++;
        p.tf = seekerTf();
      } else if (p.cpu) {
        p.role = 'hider';
        p.spot = spotIdx.length ? spotIdx.pop() : 0;
        const sp = map.spots[p.spot];
        p.tf = { p: sp.p.slice(), r: [sp.yaw, 0, 0], pose: sp.pose, look: [0, 0] };
      } else {
        p.role = 'hider';
        const a = (hi++ / Math.max(1, hiderCount)) * Math.PI * 2;
        const { c, rx, rz } = map.hiderSpawn;
        const x = c[0] + Math.cos(a) * rx;
        const z = c[1] + Math.sin(a) * rz;
        p.tf = { p: [x, groundY(settings.map, x, z), z], r: [0, 0, 0], pose: 'stand', look: [0, 0] };
      }
    }
    phase = 'prep';
    phaseEndsAt = Date.now() + settings.prepSec * 1000;
    // 隠れる側が CPU だけなら、準備を待たずにすぐ始める
    const humanHider = [...players.values()].some((p) => p.role === 'hider' && !p.cpu);
    if (!humanHider) phaseEndsAt = Date.now() + 3000;
    broadcast({ t: 'round', roundNo });
    broadcast(transformsMsg(true));
    broadcastState();
  }

  function finishPrep() {
    startHunt();
  }

  function startHunt() {
    phase = 'hunt';
    phaseEndsAt = Date.now() + settings.huntSec * 1000;
    for (const p of players.values()) {
      if (p.role === 'seeker') p.tf = seekerTf();
    }
    broadcast(transformsMsg(true));
    systemMsg('おにがうごきだした！');
    broadcastState();
  }

  function endRound(reason) {
    phase = 'result';
    phaseEndsAt = 0;
    const survivors = [...players.values()].filter((p) => p.role === 'hider' && !p.found);
    for (const p of survivors) p.score += 3;
    roundResult = {
      reason,
      survivors: survivors.map((p) => p.id),
      winner: survivors.length ? 'hiders' : 'seekers',
    };
    broadcastState();
  }

  function checkEnd() {
    if (phase !== 'hunt' && phase !== 'prep') return;
    const hiders = [...players.values()].filter((p) => p.role === 'hider' && !p.found);
    if (phase === 'hunt' && !hiders.length) return endRound('ぜんいんみつかった！');
    if (!online().some((p) => p.role === 'seeker')) return endRound('おにがいなくなった…');
    if (!hiders.some((p) => p.conn || p.cpu) && phase === 'prep') return endRound('かくれるひとがいなくなった…');
  }

  timers.push(
    setInterval(() => {
      if (!phaseEndsAt || Date.now() < phaseEndsAt) return;
      if (phase === 'prep') finishPrep();
      else if (phase === 'hunt') endRound('じかんぎれ！にげきった！');
    }, 200),
  );

  // ----- 位置の同期 -----

  function transformsMsg(all) {
    const list = [];
    for (const p of players.values()) {
      if (p.role !== 'hider' && p.role !== 'seeker') continue;
      list.push([p.id, p.tf.p, p.tf.r, p.tf.pose, p.tf.look]);
    }
    return { t: 'tf', all: !!all, list };
  }

  timers.push(
    setInterval(() => {
      if (phase === 'prep' || phase === 'hunt') broadcast(transformsMsg(false));
    }, TICK_MS),
  );

  // ----- メッセージ処理 -----

  function canPaint(p) {
    return p.role === 'hider' && !p.found && (phase === 'prep' || phase === 'hunt');
  }

  function handle(p, msg) {
    const isHost = p.id === hostId;
    switch (msg.t) {
      case 'tf': {
        if (p.role !== 'hider' && p.role !== 'seeker') return;
        if (validVec(msg.look, 2)) p.tf.look = msg.look;
        const canMove = (p.role === 'hider' && phase === 'prep') || (p.role === 'seeker' && phase === 'hunt');
        if (!canMove) return;
        const b = MAPS[settings.map].bounds;
        if (validVec(msg.p, 3)) p.tf.p = [clamp(msg.p[0], b.x0, b.x1), clamp(msg.p[1], -1, b.h), clamp(msg.p[2], b.z0, b.z1)];
        if (validVec(msg.r, 3)) p.tf.r = msg.r;
        if (POSES.has(msg.pose)) p.tf.pose = msg.pose;
        return;
      }
      case 'paint': {
        // 見つかるまでは捜索中もぬれる
        if (!canPaint(p) || !Array.isArray(msg.ops)) return;
        const ops = msg.ops.slice(0, 200).map(sanitizeOp).filter(Boolean);
        if (!ops.length) return;
        if (p.ops.length + ops.length > MAX_OPS_PER_PLAYER) {
          send(p, { t: 'toast', text: 'これいじょうぬれません（「ぜんぶけす」でせいりしてね）' });
          return;
        }
        p.ops.push(...ops);
        broadcast({ t: 'paint', id: p.id, ops }, p.id);
        return;
      }
      case 'undo': {
        if (!canPaint(p) || !p.ops.length) return;
        const g = p.ops[p.ops.length - 1].g;
        while (p.ops.length && p.ops[p.ops.length - 1].g === g) p.ops.pop();
        broadcast({ t: 'paintReset', id: p.id, ops: p.ops }, p.id);
        return;
      }
      case 'shoot': {
        if (p.role !== 'seeker' || phase !== 'hunt') return;
        const now = Date.now();
        if (now - p.lastShot < SHOT_COOLDOWN_MS) return;
        p.lastShot = now;
        const point = validVec(msg.point, 3) ? msg.point : null;
        const target = players.get(msg.target);
        if (target && target.role === 'hider' && !target.found) {
          target.found = true;
          target.foundBy = p.id;
          p.score += 1;
          foundLog.push({ id: target.id, by: p.id, at: settings.huntSec * 1000 - (phaseEndsAt - now) });
          broadcast({ t: 'shot', from: p.id, point, hit: target.id });
          systemMsg(`${p.name} が ${target.name} をみつけた！`);
          if (settings.mode === 'infect') {
            target.role = 'seeker';
            target.tf.pose = 'stand';
            systemMsg(`${target.name} がおにになった！`);
          }
          broadcastState();
          checkEnd();
        } else {
          const penalty = settings.penaltySec;
          if (penalty > 0) phaseEndsAt -= penalty * 1000;
          broadcast({ t: 'shot', from: p.id, point, hit: null, penalty });
          if (penalty > 0) broadcastState();
        }
        return;
      }
      case 'rename': {
        const name = cleanText(msg.name, 12);
        if (name) p.name = name;
        broadcastState();
        return;
      }
      case 'settings': {
        if (!isHost || (phase !== 'lobby' && phase !== 'result')) return;
        const s = msg.settings || {};
        if (s.mode === 'normal' || s.mode === 'infect') settings.mode = s.mode;
        if (typeof s.map === 'string' && MAPS[s.map]) settings.map = s.map;
        if (CPU_LEVELS.has(s.cpuLevel)) settings.cpuLevel = s.cpuLevel;
        for (const k of Object.keys(LIMITS)) {
          if (isNum(s[k])) settings[k] = clamp(Math.round(s[k]), LIMITS[k][0], LIMITS[k][1]);
        }
        syncCpus();
        broadcastState();
        return;
      }
      case 'start': {
        if (!isHost) return send(p, { t: 'toast', text: 'ホストだけがスタートできます' });
        if (phase !== 'lobby' && phase !== 'result') return;
        try {
          startRound(msg.role);
        } catch (e) {
          send(p, { t: 'toast', text: e.message });
        }
        return;
      }
      case 'skip': {
        if (isHost && phase === 'prep') finishPrep();
        return;
      }
      case 'abort': {
        if (!isHost || phase === 'lobby') return;
        phase = 'lobby';
        phaseEndsAt = 0;
        for (const q of players.values()) q.role = 'none';
        broadcastState();
        return;
      }
      case 'kick': {
        if (!isHost || msg.target === p.id) return;
        const t = players.get(msg.target);
        if (!t) return;
        if (t.cpu) {
          if (phase !== 'lobby' && phase !== 'result') return;
          settings.cpus = Math.max(0, settings.cpus - 1);
        }
        send(t, { t: 'kicked' });
        const c = t.conn;
        t.conn = null;
        c?.close();
        players.delete(t.id);
        broadcast({ t: 'left', id: t.id });
        checkEnd();
        broadcastState();
        return;
      }
      case 'cpu': {
        // CPU 鬼の動きはホストのブラウザが計算して送ってくる
        if (!isHost || !msg.msg || typeof msg.msg !== 'object') return;
        const c = players.get(msg.id);
        if (!c || !c.cpu || (msg.msg.t !== 'tf' && msg.msg.t !== 'shoot')) return;
        handle(c, msg.msg);
        return;
      }
      case 'resetScores': {
        if (!isHost || phase === 'prep' || phase === 'hunt') return;
        for (const q of players.values()) q.score = 0;
        broadcastState();
        return;
      }
    }
  }

  function join(conn, msg) {
    const name = cleanText(msg.name, 12);
    let p = typeof msg.id === 'string' ? players.get(msg.id) : null;
    if (!p || p.cpu) {
      if (humans().length >= MAX_PLAYERS) {
        conn.send(JSON.stringify({ t: 'error', text: `まんいんです（さいだい${MAX_PLAYERS}にん）` }));
        return null;
      }
      p = newPlayer(name || `プレイヤー${humans().length + 1}`);
      players.set(p.id, p);
    } else if (name) {
      p.name = name;
    }
    if (p.conn && p.conn !== conn) {
      const old = p.conn;
      p.conn = null;
      old.close();
    }
    p.conn = conn;
    if (!hostId || !players.get(hostId)?.conn) hostId = p.id;
    send(p, { t: 'welcome', id: p.id });
    // 途中参加・再接続用に、全員の塗りと位置を送る
    const paints = {};
    for (const q of players.values()) if (q.ops.length) paints[q.id] = q.ops;
    send(p, { t: 'paintAll', paints });
    send(p, transformsMsg(true));
    broadcastState();
    return p;
  }

  function addConnection(conn) {
    let me = null;
    return {
      message(raw) {
        let msg;
        try {
          msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        if (!me) {
          if (msg.t === 'join') me = join(conn, msg);
          return;
        }
        if (me.conn !== conn) return;
        handle(me, msg);
      },
      close() {
        if (!me || me.conn !== conn) return;
        me.conn = null;
        const id = me.id;
        // ロビーで切断したままの人はしばらくして消す
        timers.push(
          setTimeout(() => {
            const p = players.get(id);
            if (p && !p.conn && (phase === 'lobby' || phase === 'result')) {
              players.delete(id);
              broadcast({ t: 'left', id });
              broadcastState();
            }
          }, 60000),
        );
        timers.push(setTimeout(checkEnd, 15000));
        broadcastState();
      },
    };
  }

  function destroy() {
    for (const t of timers) {
      clearInterval(t);
      clearTimeout(t);
    }
  }

  return { addConnection, destroy, broadcastState };
}
