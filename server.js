// めっちゃカメレオン（LAN版） - サーバー
// 依存パッケージなし。Node.js 標準モジュールだけで HTTP + WebSocket を提供する。
// 1サーバー = 1部屋。同じWiFiの端末からブラウザで接続して遊ぶ。

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 16;
const MIN_PLAYERS = 2;
const TICK_MS = 66; // 位置の配信間隔（約15Hz）
const SHOT_COOLDOWN_MS = 600;
const MAX_OPS_PER_PLAYER = 20000;
const SEEKER_SPAWN = [8, 0, 5];

// ---------------------------------------------------------------------------
// 最小限の WebSocket 実装（RFC 6455）
// ---------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 4 * 1024 * 1024;

class WsConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.open = true;
    this.onmessage = () => {};
    this.onclose = () => {};
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.onclose();
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return this.close();
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME) return this.close();
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      let payload = this.buf.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(off + maskLen + len);

      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) {
        this._sendFrame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      this.fragments.push(payload);
      if (fin) {
        const msg = Buffer.concat(this.fragments).toString('utf8');
        this.fragments = [];
        try {
          this.onmessage(msg);
        } catch (e) {
          console.error('message error:', e);
        }
      }
    }
  }

  _sendFrame(opcode, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(obj) {
    this._sendFrame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }

  close() {
    if (!this.open) return;
    try {
      this._sendFrame(0x8, Buffer.alloc(0));
    } catch {}
    this.socket.end();
    this._closed();
  }
}

// ---------------------------------------------------------------------------
// ゲーム状態
// ---------------------------------------------------------------------------

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

const settings = {
  mode: 'normal', // normal | infect（増え鬼）
  seekers: 1,
  prepSec: 120,
  huntSec: 120,
  penaltySec: 5,
};

const LIMITS = {
  prepSec: [20, 600],
  huntSec: [20, 600],
  penaltySec: [0, 30],
  seekers: [1, 8],
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function cleanText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function online() {
  return [...players.values()].filter((p) => p.conn);
}

function ensureHost() {
  const h = players.get(hostId);
  if (h && h.conn) return;
  const c = online().sort((a, b) => a.joinedAt - b.joinedAt);
  if (c.length) hostId = c[0].id;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    online: !!p.conn,
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
    urls: lanUrls(),
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

function startRound() {
  const list = online();
  if (list.length < MIN_PLAYERS) throw new Error(`${MIN_PLAYERS}人以上で遊べます`);
  const nSeek = clamp(settings.seekers, 1, list.length - 1);

  // 鬼をやった回数が少ない人を優先してランダムに選ぶ
  const order = list
    .map((p) => ({ p, k: p.seekerCount + Math.random() * 0.9 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
  const seekers = new Set(order.slice(0, nSeek).map((p) => p.id));

  roundNo++;
  foundLog = [];
  roundResult = null;
  let hi = 0;
  const hiderCount = list.length - nSeek;
  for (const p of players.values()) {
    p.found = false;
    p.foundBy = null;
    p.ops = [];
    p.lastShot = 0;
    if (!p.conn) {
      p.role = 'spectator';
    } else if (seekers.has(p.id)) {
      p.role = 'seeker';
      p.seekerCount++;
      p.tf = { p: SEEKER_SPAWN.slice(), r: [Math.PI, 0, 0], pose: 'stand', look: [1.0, 0] };
    } else {
      p.role = 'hider';
      const a = (hi++ / Math.max(1, hiderCount)) * Math.PI * 2;
      p.tf = { p: [Math.cos(a) * 2.5 - 1, 0, Math.sin(a) * 2 + 1], r: [0, 0, 0], pose: 'stand', look: [0, 0] };
    }
  }
  phase = 'prep';
  phaseEndsAt = Date.now() + settings.prepSec * 1000;
  broadcast({ t: 'round', roundNo });
  broadcast(transformsMsg(true));
  broadcastState();
}

function startHunt() {
  phase = 'hunt';
  phaseEndsAt = Date.now() + settings.huntSec * 1000;
  for (const p of players.values()) {
    if (p.role === 'seeker') p.tf = { p: SEEKER_SPAWN.slice(), r: [Math.PI, 0, 0], pose: 'stand', look: [1.0, 0] };
  }
  broadcast(transformsMsg(true));
  systemMsg('鬼が動き出した！');
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
  if (phase === 'hunt' && !hiders.length) return endRound('全員見つかった！');
  if (!online().some((p) => p.role === 'seeker')) return endRound('鬼がいなくなった…');
  if (!hiders.some((p) => p.conn) && phase === 'prep') return endRound('隠れる人がいなくなった…');
}

setInterval(() => {
  if (!phaseEndsAt || Date.now() < phaseEndsAt) return;
  if (phase === 'prep') startHunt();
  else if (phase === 'hunt') endRound('時間切れ！逃げ切った！');
}, 200);

// ----- 位置の同期 -----

function transformsMsg(all) {
  const list = [];
  for (const p of players.values()) {
    if (p.role !== 'hider' && p.role !== 'seeker') continue;
    list.push([p.id, p.tf.p, p.tf.r, p.tf.pose, p.tf.look]);
  }
  return { t: 'tf', all: !!all, list };
}

setInterval(() => {
  if (phase === 'prep' || phase === 'hunt') broadcast(transformsMsg(false));
}, TICK_MS);

// ---------------------------------------------------------------------------
// メッセージ処理
// ---------------------------------------------------------------------------

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validVec(v, n) {
  return Array.isArray(v) && v.length === n && v.every(isNum);
}

const POSES = new Set(['stand', 'crouch', 'curl', 'lie', 'banzai', 'star', 'flip']);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

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

function handle(p, msg) {
  const isHost = p.id === hostId;
  switch (msg.t) {
    case 'tf': {
      if (p.role !== 'hider' && p.role !== 'seeker') return;
      if (validVec(msg.look, 2)) p.tf.look = msg.look;
      const canMove =
        (p.role === 'hider' && phase === 'prep') || (p.role === 'seeker' && phase === 'hunt');
      if (!canMove) return;
      if (validVec(msg.p, 3)) p.tf.p = [clamp(msg.p[0], -14, 14), clamp(msg.p[1], -1, 6), clamp(msg.p[2], -10, 10)];
      if (validVec(msg.r, 3)) p.tf.r = msg.r;
      if (POSES.has(msg.pose)) p.tf.pose = msg.pose;
      return;
    }
    case 'paint': {
      if (p.role !== 'hider' || phase !== 'prep' || !Array.isArray(msg.ops)) return;
      const ops = msg.ops.slice(0, 200).map(sanitizeOp).filter(Boolean);
      if (!ops.length) return;
      if (p.ops.length + ops.length > MAX_OPS_PER_PLAYER) {
        p.conn?.send({ t: 'toast', text: 'これ以上塗れません（「全部消す」で整理してね）' });
        return;
      }
      p.ops.push(...ops);
      broadcast({ t: 'paint', id: p.id, ops }, p.id);
      return;
    }
    case 'undo': {
      if (p.role !== 'hider' || phase !== 'prep' || !p.ops.length) return;
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
        systemMsg(`${p.name} が ${target.name} を見つけた！`);
        if (settings.mode === 'infect') {
          target.role = 'seeker';
          target.tf.pose = 'stand';
          systemMsg(`${target.name} が鬼になった！`);
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
      for (const k of Object.keys(LIMITS)) {
        if (isNum(s[k])) settings[k] = clamp(Math.round(s[k]), LIMITS[k][0], LIMITS[k][1]);
      }
      broadcastState();
      return;
    }
    case 'start': {
      if (!isHost) return p.conn?.send({ t: 'toast', text: 'ホストだけが開始できます' });
      if (phase !== 'lobby' && phase !== 'result') return;
      try {
        startRound();
      } catch (e) {
        p.conn?.send({ t: 'toast', text: e.message });
      }
      return;
    }
    case 'skip': {
      if (isHost && phase === 'prep') startHunt();
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
      t.conn?.send({ t: 'kicked' });
      t.conn?.close();
      players.delete(t.id);
      broadcast({ t: 'left', id: t.id });
      checkEnd();
      broadcastState();
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

function onConnection(conn) {
  let me = null;
  conn.onmessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (!me) {
      if (msg.t !== 'join') return;
      const name = cleanText(msg.name, 12);
      let p = typeof msg.id === 'string' ? players.get(msg.id) : null;
      if (!p) {
        if (!name) return conn.send({ t: 'error', text: '名前を入力してください' });
        if (players.size >= MAX_PLAYERS) return conn.send({ t: 'error', text: `満員です（最大${MAX_PLAYERS}人）` });
        p = {
          id: crypto.randomUUID(),
          name,
          score: 0,
          joinedAt: Date.now(),
          conn: null,
          seekerCount: 0,
          role: phase === 'lobby' ? 'none' : 'spectator',
          found: false,
          foundBy: null,
          tf: { p: [0, 0, 0], r: [0, 0, 0], pose: 'stand', look: [0, 0] },
          ops: [],
          lastShot: 0,
        };
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
      me = p;
      if (!hostId || !players.get(hostId)?.conn) hostId = p.id;
      conn.send({ t: 'welcome', id: p.id });
      // 途中参加・再接続用に、全員の塗りと位置を送る
      const paints = {};
      for (const q of players.values()) if (q.ops.length) paints[q.id] = q.ops;
      conn.send({ t: 'paintAll', paints });
      conn.send(transformsMsg(true));
      broadcastState();
      return;
    }
    handle(me, msg);
  };
  conn.onclose = () => {
    if (!me || me.conn !== conn) return;
    me.conn = null;
    const id = me.id;
    // ロビーで切断したままの人はしばらくして消す
    setTimeout(() => {
      const p = players.get(id);
      if (p && !p.conn && (phase === 'lobby' || phase === 'result')) {
        players.delete(id);
        broadcast({ t: 'left', id });
        broadcastState();
      }
    }, 60000);
    setTimeout(checkEnd, 15000);
    broadcastState();
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  const rel = pathname === '/' ? '/index.html' : pathname;
  let file;
  try {
    file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
  } catch {
    return res.writeHead(400).end();
  }
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket' || !req.url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  onConnection(new WsConn(socket));
});

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
  console.log('  🦎 めっちゃカメレオン（LAN版）サーバー起動！');
  console.log('');
  console.log('  同じWiFiにつないだPC/スマホのブラウザで開いてね:');
  const urls = lanUrls();
  for (const u of urls) console.log(`    ${u}`);
  if (!urls.length) console.log('    (LANのIPアドレスが見つかりませんでした)');
  console.log(`    http://localhost:${PORT}  (このPCから)`);
  console.log('');
});
