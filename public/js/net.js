// 通信まわり。2つの方式に対応する。
//  - server: Node.js サーバー（server.js）に WebSocket でつなぐ（LAN版）
//  - p2p:    GitHub Pages など静的ホスティング用。ホストのブラウザが部屋（room.js）を動かし、
//            他のプレイヤーは WebRTC（PeerJS）でホストに直接つなぐ
//
// どの方式も link = { send(obj), close() } を返し、cb.onOpen / onMessage / onClose / onError / onStatus を呼ぶ。

import { createRoom } from './room.js';

const PREFIX = 'meccha-kaitoon-room-';
const CHUNK = 15000; // DataChannel の1メッセージの大きさを抑える

export async function detectServer() {
  // GitHub Pages には Node.js サーバーはいない
  if (location.hostname.endsWith('github.io')) return false;
  try {
    const r = await fetch('__mc_server', { cache: 'no-store' });
    return r.ok && (await r.text()) === 'ok';
  } catch {
    return false;
  }
}

export function makeRoomCode() {
  // 4桁の数字（0000〜9999）
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

export function normalizeCode(s) {
  // 全角数字も受け付ける
  return String(s || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '')
    .slice(0, 4);
}

// ---------------------------------------------------------------------------
// サーバー版（WebSocket）
// ---------------------------------------------------------------------------

export function connectServer(cb) {
  let ws = null;
  let closed = false;
  function open() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => cb.onOpen();
    ws.onmessage = (ev) => cb.onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      if (closed) return;
      cb.onClose();
      setTimeout(() => !closed && open(), 1500);
    };
  }
  open();
  return {
    send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}

// ---------------------------------------------------------------------------
// P2P版（PeerJS）
// ---------------------------------------------------------------------------

function sendStr(dc, s) {
  if (s.length <= CHUNK) return dc.send(s);
  const id = Math.random().toString(36).slice(2, 8);
  const n = Math.ceil(s.length / CHUNK);
  for (let i = 0; i < n; i++) dc.send(`\u0001${id}|${i}|${n}|${s.slice(i * CHUNK, (i + 1) * CHUNK)}`);
}

function receiver(fn) {
  const parts = new Map();
  return (d) => {
    if (typeof d !== 'string') return;
    if (d.charCodeAt(0) !== 1) return fn(d);
    const p1 = d.indexOf('|');
    const p2 = d.indexOf('|', p1 + 1);
    const p3 = d.indexOf('|', p2 + 1);
    const id = d.slice(1, p1);
    const i = Number(d.slice(p1 + 1, p2));
    const n = Number(d.slice(p2 + 1, p3));
    let e = parts.get(id);
    if (!e) parts.set(id, (e = { n, got: 0, arr: new Array(n) }));
    if (e.arr[i] == null) e.got++;
    e.arr[i] = d.slice(p3 + 1);
    if (e.got === e.n) {
      parts.delete(id);
      fn(e.arr.join(''));
    }
  };
}

// ?peerserver=https://example.com:9000/ でシグナリングサーバーを差し替えられる（自前の PeerJS サーバー用）
function peerOptions() {
  const v = new URLSearchParams(location.search).get('peerserver');
  if (!v) return {};
  try {
    const u = new URL(v);
    const secure = u.protocol === 'https:';
    return { host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: u.pathname || '/', secure };
  } catch {
    return {};
  }
}

function PeerCtor() {
  const P = window.peerjs?.Peer;
  if (!P) throw new Error('通信ライブラリ（PeerJS）を読み込めませんでした');
  return P;
}

const RETRY_TYPES = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'webrtc']);

// CPU とだけ遊ぶ部屋（通信なし・このブラウザの中だけで動く）
export function localRoom(cb) {
  const room = createRoom({ getUrls: () => [] });
  const local = room.addConnection({
    send: (s) => queueMicrotask(() => cb.onMessage(JSON.parse(s))),
    close() {},
  });
  queueMicrotask(() => cb.onOpen());
  return {
    send(obj) {
      const s = JSON.stringify(obj);
      queueMicrotask(() => local.message(s));
    },
    close() {
      room.destroy();
    },
  };
}

// 部屋を作る（このブラウザがホストになる）。fresh = 新しく作る部屋（番号が使用中なら cb.onIdTaken）
export function hostP2P(code, shareUrl, cb, fresh = false) {
  const Peer = PeerCtor();
  let peer = null;
  let room = null;
  let local = null;
  let closed = false;
  let attempts = 0;

  function start() {
    peer = new Peer(PREFIX + code, peerOptions());
    peer.on('open', () => {
      attempts = 0;
      if (!room) {
        room = createRoom({ getUrls: () => [shareUrl] });
        // ホスト自身もプレイヤーとして、部屋に直接（ネットワークを通さず）つなぐ
        local = room.addConnection({
          send: (s) => queueMicrotask(() => cb.onMessage(JSON.parse(s))),
          close() {},
        });
        cb.onOpen();
      }
    });
    peer.on('connection', (dc) => {
      dc.on('open', () => {
        const h = room.addConnection({
          send: (s) => {
            try {
              sendStr(dc, s);
            } catch {}
          },
          close: () => dc.close(),
        });
        dc.on('data', receiver((s) => h.message(s)));
        dc.on('close', () => h.close());
        dc.on('error', () => h.close());
      });
    });
    peer.on('disconnected', () => {
      // シグナリングサーバーとの接続だけが切れた（既存のプレイヤーとはつながったまま）
      setTimeout(() => !closed && !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (closed) return;
      if (err.type === 'unavailable-id' && !room) {
        if (fresh) {
          // 新しく作ろうとした番号が他の部屋で使われていた
          peer.destroy();
          closed = true;
          return cb.onIdTaken?.();
        }
        // 再読み込み直後は前の接続が残っていることがあるので、少し待って取り直す
        if (attempts++ < 8) {
          cb.onStatus?.('部屋を準備しています…');
          peer.destroy();
          setTimeout(() => !closed && start(), 2500);
        } else {
          cb.onError('その部屋番号は使われています。別の部屋を作ってね');
        }
        return;
      }
      if (err.type === 'browser-incompatible') return cb.onError('このブラウザはP2P通信に対応していません');
      if (RETRY_TYPES.has(err.type)) {
        cb.onStatus?.('サーバーとの接続が不安定です…');
        if (!room) {
          peer.destroy();
          setTimeout(() => !closed && start(), 3000);
        }
        return;
      }
      cb.onStatus?.(`通信エラー（${err.type}）`);
    });
  }
  start();

  return {
    send(obj) {
      if (!local) return;
      const s = JSON.stringify(obj);
      queueMicrotask(() => local.message(s));
    },
    close() {
      closed = true;
      peer?.destroy();
      room?.destroy();
    },
  };
}

// 部屋に入る
export function joinP2P(code, cb) {
  const Peer = PeerCtor();
  let peer = null;
  let dc = null;
  let closed = false;
  let everOpened = false;
  let retryTimer = null;

  function retry(ms) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (closed) return;
      if (!peer || peer.destroyed) startPeer();
      else if (peer.disconnected) peer.reconnect();
      else connectDc();
    }, ms);
  }

  function connectDc() {
    const d = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
    dc = d;
    d.on('open', () => {
      everOpened = true;
      cb.onOpen();
    });
    d.on('data', receiver((s) => cb.onMessage(JSON.parse(s))));
    d.on('close', () => {
      if (closed || d !== dc) return;
      cb.onClose();
      retry(2000);
    });
  }

  function startPeer() {
    peer = new Peer(peerOptions());
    peer.on('open', connectDc);
    peer.on('disconnected', () => retry(1500));
    peer.on('error', (err) => {
      if (closed) return;
      if (err.type === 'peer-unavailable') {
        if (!everOpened) return cb.onError(`部屋「${code}」が見つかりません。番号を確認してね`);
        cb.onStatus?.('ホストを探しています…');
        return retry(3000);
      }
      if (err.type === 'browser-incompatible') return cb.onError('このブラウザはP2P通信に対応していません');
      cb.onStatus?.('接続が不安定です…');
      if (RETRY_TYPES.has(err.type)) {
        peer.destroy();
        retry(3000);
      }
    });
  }
  startPeer();

  return {
    send(obj) {
      if (dc && dc.open) {
        try {
          sendStr(dc, JSON.stringify(obj));
        } catch {}
      }
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      peer?.destroy();
    },
  };
}
