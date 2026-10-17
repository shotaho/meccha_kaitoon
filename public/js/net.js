// 通信まわり。2つの方式に対応する。
//  - server: Node.js サーバー（server.js）に WebSocket でつなぐ（LAN版）
//  - p2p:    GitHub Pages など静的ホスティング用。ホストのブラウザが部屋（room.js）を動かし、
//            他のプレイヤーは WebRTC（PeerJS）でホストに直接つなぐ。
//            直接つながらないとき（ルーターや端末の組み合わせによる）は、
//            ① TURN サーバーを通す ② 公開のメッセージサーバー（MQTT）で中継する、の順にためす
//
// どの方式も link = { send(obj), close() } を返し、cb.onOpen / onMessage / onClose / onError / onStatus を呼ぶ。

import { createRoom } from './room.js';

const PREFIX = 'meccha-kaitoon-room-';
// 位置（tf）は新しいものだけあればよい。回線がつまっているときは古いものをすてる
const isTf = (s) => s.startsWith('{"t":"tf"');
const dcBuffered = (dc) => dc.dataChannel?.bufferedAmount ?? 0;
const DC_BACKLOG = 16 * 1024;
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

// 2台の間で直接つながれないときのために、STUN と中継（TURN）サーバーを複数用意する。
// UDP がだめなときのために TCP（80・443 番）でもつなげるようにする
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478?transport=tcp'],
    username: 'peerjs',
    credential: 'peerjsp',
  },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

// ?peerserver=https://example.com:9000/ でシグナリングサーバーを差し替えられる（自前の PeerJS サーバー用）
function peerOptions() {
  const opts = { config: { sdpSemantics: 'unified-plan', iceServers: ICE_SERVERS } };
  const v = new URLSearchParams(location.search).get('peerserver');
  if (!v) return opts;
  try {
    const u = new URL(v);
    const secure = u.protocol === 'https:';
    return { ...opts, host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: u.pathname || '/', secure };
  } catch {
    return opts;
  }
}

// ---------------------------------------------------------------------------
// 中継モード（MQTT）
//   直接つながれないときは、公開のメッセージサーバーを通してやりとりする。
//   ホストは部屋を作ったら中継でも待ち受け、ゲストは直接つながれなかったら中継で入る。
//   ?relayurl=wss://example.com/mqtt でサーバーを変えられる、?relay=only で最初から中継
// ---------------------------------------------------------------------------

const QS = new URLSearchParams(location.search);
const RELAY_URLS = /^wss?:/.test(QS.get('relayurl') || '') ? [QS.get('relayurl')] : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const relayOnly = () => QS.get('relay') === 'only';
const relayTopic = (code, to) => `${PREFIX}v1/relay/${code}/${to}`;
const randId = () => Math.random().toString(36).slice(2, 10);
const RELAY_CHUNK = 20000;

let mqttLoading = null;
function loadMqtt() {
  if (window.mqtt) return Promise.resolve(window.mqtt);
  if (!mqttLoading) {
    mqttLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/mqtt.min.js', import.meta.url).href;
      s.onload = () => (window.mqtt ? resolve(window.mqtt) : reject(new Error('mqtt')));
      s.onerror = () => {
        mqttLoading = null;
        reject(new Error('mqtt'));
      };
      document.head.appendChild(s);
    });
  }
  return mqttLoading;
}

// 中継の通路。send(文字列) / onData / onClose / close()
class RelayConn {
  constructor(client, pubTopic, sid, isHost) {
    this.client = client;
    this.pub = pubTopic;
    this.sid = sid;
    this.isHost = isHost;
    this.open = false;
    this.closed = false;
    this.rx = Date.now();
    this.parts = new Map();
    this.q = [];
    this.qLen = 0;
    this.qt = 0;
    this.onData = null;
    this.onClose = null;
    this.rtt = 0; // 往復にかかる時間（ms）。中継がこんでいると大きくなる
    this.tfPending = null;
    this.tfAt = 0;
    this.tfTimer = 0;
    // 生きているよの合図（時刻つき）。10 秒へんじがなければ切れたとみなす
    this.timer = setInterval(() => {
      if (this.closed) return;
      this._pub({ p: 1, ts: Date.now() });
      if (this.open && Date.now() - this.rx > 10000) this.close();
    }, 1000);
  }

  // こみぐあいに合わせて、位置を送るあいだをあける
  _tfGap() {
    // 本当につまっているときだけ間をあける（重い端末だと少しおそめに出るので、ゆるめにする）
    return this.rtt < 2500 ? 100 : this.rtt < 5000 ? 250 : 500;
  }

  _pub(o) {
    if (!this.isHost) o._s = this.sid;
    try {
      this.client.publish(this.pub, JSON.stringify(o));
    } catch {}
  }

  // 公開サーバーは送る回数が多いと間引くことがあるので、100 ミリ秒ぶんをまとめて送る
  send(s) {
    if (!this.open) return;
    if (isTf(s)) {
      // 位置はいちばん新しいものだけ。前に送ってから間がなければ、あとでまとめて送る
      this.tfPending = s;
      const wait = this.tfAt + this._tfGap() - Date.now();
      if (wait <= 0) this._sendTf();
      else if (!this.tfTimer) this.tfTimer = setTimeout(() => this._sendTf(), wait);
      return;
    }
    this._queue(s);
  }

  _sendTf() {
    clearTimeout(this.tfTimer);
    this.tfTimer = 0;
    if (!this.tfPending || this.closed) return;
    const s = this.tfPending;
    this.tfPending = null;
    this.tfAt = Date.now();
    this._queue(s);
  }

  _queue(s) {
    if (s.length > RELAY_CHUNK) {
      this._flush();
      const id = randId();
      const n = Math.ceil(s.length / RELAY_CHUNK);
      for (let i = 0; i < n; i++) this._pub({ c: id, i, n, d: s.slice(i * RELAY_CHUNK, (i + 1) * RELAY_CHUNK) });
      return;
    }
    this.q.push(s);
    this.qLen += s.length;
    if (this.qLen > 16000) this._flush();
    else if (!this.qt) this.qt = setTimeout(() => this._flush(), 100);
  }

  _flush() {
    clearTimeout(this.qt);
    this.qt = 0;
    if (!this.q.length || this.closed) return;
    const q = this.q;
    this.q = [];
    this.qLen = 0;
    this._pub(q.length === 1 ? { m: q[0] } : { ms: q });
  }

  recv(o) {
    this.rx = Date.now();
    if (o.bye) return this.close(true);
    if (o.p) {
      if (o.ts) this._pub({ pr: o.ts });
      return;
    }
    if (o.pr) {
      const r = Date.now() - o.pr;
      this.rtt = this.rtt ? this.rtt * 0.6 + r * 0.4 : r;
      return;
    }
    if (typeof o.m === 'string') return this.onData?.(o.m);
    if (Array.isArray(o.ms)) {
      for (const m of o.ms) if (typeof m === 'string') this.onData?.(m);
      return;
    }
    if (o.c) {
      let e = this.parts.get(o.c);
      if (!e) this.parts.set(o.c, (e = { got: 0, arr: new Array(o.n) }));
      if (e.arr[o.i] == null) e.got++;
      e.arr[o.i] = o.d;
      if (e.got === o.n) {
        this.parts.delete(o.c);
        this.onData?.(e.arr.join(''));
      }
    }
  }

  close(remoteSaid) {
    if (this.closed) return;
    if (!remoteSaid) {
      this._flush();
      this._pub({ bye: 1 });
    }
    this.closed = true;
    this.open = false;
    clearInterval(this.timer);
    clearTimeout(this.qt);
    clearTimeout(this.tfTimer);
    this._end?.();
    this.onClose?.();
  }
}

// ホスト：中継サーバーで待ち受ける。onGuest(conn) で新しいゲストを渡す
function relayHost(code, onGuest, onLog) {
  const items = [];
  let stopped = false;
  loadMqtt()
    .then((mqtt) => {
      if (stopped) return;
      for (const url of RELAY_URLS) {
        let cl;
        try {
          cl = mqtt.connect(url, { clientId: 'mk' + randId(), clean: true, connectTimeout: 8000, reconnectPeriod: 4000 });
        } catch {
          continue;
        }
        const conns = new Map();
        items.push({ cl, conns });
        cl.on('connect', () => cl.subscribe(relayTopic(code, 'h')));
        cl.on('message', (_t, buf) => {
          let o;
          try {
            o = JSON.parse(buf.toString());
          } catch {
            return;
          }
          if (!o || typeof o._s !== 'string') return;
          let c = conns.get(o._s);
          if (o.hello) {
            if (c && !c.closed) c.close(true);
            const sid = o._s;
            c = new RelayConn(cl, relayTopic(code, 'g/' + sid), sid, true);
            conns.set(sid, c);
            const me = c;
            c._end = () => conns.get(sid) === me && conns.delete(sid);
            c._pub({ welcome: 1 });
            c.open = true;
            onGuest(c);
            return;
          }
          if (c) c.recv(o);
        });
      }
    })
    .catch(() => onLog?.('ちゅうけいのぶひんをよみこめませんでした'));
  return {
    stop() {
      stopped = true;
      for (const it of items) {
        for (const c of it.conns.values()) c.close();
        try {
          it.cl.end(true);
        } catch {}
      }
    },
  };
}

// ゲスト：中継サーバーを順番にためし、部屋（ホスト）から返事が来たらつながる
function relayJoin(code, onConn, onFail) {
  let i = 0;
  let cancelled = false;
  let cur = null;
  const next = (mqtt) => {
    if (cancelled) return;
    if (i >= RELAY_URLS.length) return onFail();
    const url = RELAY_URLS[i++];
    const sid = randId();
    let done = false;
    let cl;
    try {
      cl = mqtt.connect(url, { clientId: 'mk' + sid, clean: true, connectTimeout: 8000, reconnectPeriod: 0 });
    } catch {
      return next(mqtt);
    }
    cur = cl;
    const conn = new RelayConn(cl, relayTopic(code, 'h'), sid, false);
    const giveUp = () => {
      if (done) return;
      done = true;
      conn.closed = true;
      clearInterval(conn.timer);
      try {
        cl.end(true);
      } catch {}
      next(mqtt);
    };
    const to = setTimeout(giveUp, 9000);
    cl.on('connect', () => cl.subscribe(relayTopic(code, 'g/' + sid), () => conn._pub({ hello: 1 })));
    cl.on('error', () => {});
    cl.on('close', () => {
      if (!done) {
        clearTimeout(to);
        giveUp();
      } else if (conn.open) conn.close(true);
    });
    cl.on('message', (_t, buf) => {
      let o;
      try {
        o = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (o.welcome) {
        if (done || cancelled) return;
        done = true;
        clearTimeout(to);
        conn.open = true;
        conn._end = () => {
          try {
            cl.end(true);
          } catch {}
        };
        onConn(conn);
        return;
      }
      conn.recv(o);
    });
  };
  loadMqtt().then(next, () => onFail());
  return {
    cancel() {
      cancelled = true;
      try {
        cur?.end(true);
      } catch {}
    },
  };
}

function PeerCtor() {
  const P = window.peerjs?.Peer;
  if (!P) throw new Error('つうしんライブラリ（PeerJS）をよみこめませんでした');
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
// 直接（PeerJS）と中継（MQTT）の両方で待ち受ける
export function hostP2P(code, shareUrl, cb, fresh = false) {
  const Peer = PeerCtor();
  let peer = null;
  let room = null;
  let local = null;
  let relay = null;
  let closed = false;
  let attempts = 0;
  let fallbackTimer = null;

  // 部屋をつくってホスト自身をつなぐ（直接の待ち受けがまだでも、中継だけで始められる）
  function ensureRoom() {
    if (room || closed) return;
    clearTimeout(fallbackTimer);
    room = createRoom({ getUrls: () => [shareUrl] });
    // ホスト自身もプレイヤーとして、部屋に直接（ネットワークを通さず）つなぐ
    local = room.addConnection({
      send: (s) => queueMicrotask(() => cb.onMessage(JSON.parse(s))),
      close() {},
    });
    relay = relayHost(code, (conn) => {
      const h = room.addConnection({ send: (s) => conn.send(s), close: () => conn.close() });
      conn.onData = (s) => h.message(s);
      conn.onClose = () => h.close();
    }, (t) => cb.onStatus?.(t));
    cb.onOpen();
  }

  function start() {
    peer = new Peer(PREFIX + code, peerOptions());
    peer.on('open', () => {
      attempts = 0;
      ensureRoom();
    });
    peer.on('connection', (dc) => {
      dc.on('open', () => {
        if (!room) return dc.close();
        const h = room.addConnection({
          send: (s) => {
            if (isTf(s) && dcBuffered(dc) > DC_BACKLOG) return;
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
          clearTimeout(fallbackTimer);
          peer.destroy();
          closed = true;
          return cb.onIdTaken?.();
        }
        // 再読み込み直後は前の接続が残っていることがあるので、少し待って取り直す
        if (attempts++ < 8) {
          cb.onStatus?.('へやをじゅんびしています…');
          peer.destroy();
          setTimeout(() => !closed && start(), 2500);
        } else {
          ensureRoom(); // 直接はあきらめて中継だけで
        }
        return;
      }
      if (err.type === 'browser-incompatible') return ensureRoom();
      if (RETRY_TYPES.has(err.type)) {
        cb.onStatus?.('サーバーとのせつぞくがふあんていです…');
        if (!room || peer.destroyed) {
          peer.destroy();
          setTimeout(() => !closed && start(), 3000);
        }
        return;
      }
      cb.onStatus?.(`つうしんエラー（${err.type}）`);
    });
  }
  start();
  // 直接の待ち受けがなかなか始まらないときは、中継だけで部屋をひらく
  fallbackTimer = setTimeout(() => {
    if (room || closed) return;
    cb.onStatus?.('ちゅうけいモードでへやをひらきました');
    ensureRoom();
  }, relayOnly() ? 0 : 8000);

  // iPhone などは画面を消すとサーバーとの接続が切れるので、もどったらつなぎ直す
  const onVis = () => {
    if (document.visibilityState === 'visible' && peer && peer.disconnected && !peer.destroyed && !closed) peer.reconnect();
  };
  document.addEventListener('visibilitychange', onVis);

  return {
    send(obj) {
      if (!local) return;
      const s = JSON.stringify(obj);
      queueMicrotask(() => local.message(s));
    },
    close() {
      closed = true;
      clearTimeout(fallbackTimer);
      document.removeEventListener('visibilitychange', onVis);
      relay?.stop();
      peer?.destroy();
      room?.destroy();
    },
  };
}

// 部屋に入る。まず直接（PeerJS）でつなぎ、だめなら中継（MQTT）でつなぐ
export function joinP2P(code, cb) {
  let Peer = null;
  try {
    Peer = PeerCtor();
  } catch {}
  let peer = null;
  let dc = null;
  let rconn = null; // 中継の通路
  let relayTry = null;
  let mode = relayOnly() || !Peer ? 'relay' : 'direct';
  let closed = false;
  let everOpened = false;
  let retryTimer = null;
  let fallbackTimer = null;

  function opened() {
    everOpened = true;
    clearTimeout(fallbackTimer);
    globalThis.__mcNetMode = mode; // テスト・調査用（direct / relay）
    cb.onOpen();
  }

  // ----- 中継 -----
  function startRelay() {
    if (closed || relayTry || (rconn && rconn.open)) return;
    mode = 'relay';
    clearTimeout(fallbackTimer);
    // 直接のほうはやめる
    try {
      peer?.destroy();
    } catch {}
    cb.onStatus?.('ちょくせつつながらないので、ちゅうけいでつないでいます…');
    relayTry = relayJoin(code, (conn) => {
      relayTry = null;
      if (closed) return conn.close();
      rconn = conn;
      scheduleUpgrade();
      conn.onData = (s) => cb.onMessage(JSON.parse(s));
      conn.onClose = () => {
        if (closed || rconn !== conn) return;
        rconn = null;
        cb.onClose();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(startRelay, 2000);
      };
      opened();
    }, () => {
      relayTry = null;
      if (closed) return;
      if (!everOpened) return cb.onError(`へや「${code}」につながりませんでした。ばんごうをかくにんしてね`);
      cb.onStatus?.('ホストをさがしています…');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(startRelay, 4000);
    });
  }

  // ----- 中継でつながったあとも、ときどき直接つなげないかためす（つながったら切りかえる） -----
  let upgradeTimer = null;
  let upPeer = null;
  function scheduleUpgrade() {
    if (!Peer || relayOnly() || closed) return;
    clearTimeout(upgradeTimer);
    upgradeTimer = setTimeout(tryUpgrade, 20000);
  }
  function tryUpgrade() {
    if (closed || mode !== 'relay' || !rconn) return;
    try {
      upPeer?.destroy();
    } catch {}
    const pr = new Peer(peerOptions());
    upPeer = pr;
    const giveUp = setTimeout(() => {
      if (upPeer === pr && mode === 'relay') {
        pr.destroy();
        scheduleUpgrade();
      }
    }, 15000);
    pr.on('error', () => {});
    pr.on('open', () => {
      const d = pr.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
      d.on('open', () => {
        if (closed || mode !== 'relay' || upPeer !== pr) return d.close();
        clearTimeout(giveUp);
        // 直接にきりかえる
        mode = 'direct';
        peer = pr;
        upPeer = null;
        dc = d;
        const old = rconn;
        rconn = null;
        old?.close();
        d.on('data', receiver((s) => cb.onMessage(JSON.parse(s))));
        d.on('close', () => {
          if (closed || d !== dc || mode !== 'direct') return;
          cb.onClose();
          retry(2000);
        });
        pr.on('disconnected', () => retry(1500));
        cb.onStatus?.('ちょくせつつながりました');
        opened();
      });
    });
  }

  // ----- 直接 -----
  function retry(ms) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (closed || mode !== 'direct') return;
      if (!peer || peer.destroyed) startPeer();
      else if (peer.disconnected) peer.reconnect();
      else connectDc();
    }, ms);
  }

  function connectDc() {
    const d = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
    dc = d;
    d.on('open', () => {
      if (mode !== 'direct') return d.close();
      opened();
    });
    d.on('data', receiver((s) => cb.onMessage(JSON.parse(s))));
    d.on('close', () => {
      if (closed || d !== dc || mode !== 'direct') return;
      cb.onClose();
      retry(2000);
    });
    // つながりかけたまま止まる（ICE がとおらない）ときは中継へ
    d.on('error', () => !everOpened && startRelay());
  }

  function startPeer() {
    peer = new Peer(peerOptions());
    peer.on('open', connectDc);
    peer.on('disconnected', () => retry(1500));
    peer.on('error', (err) => {
      if (closed || mode !== 'direct') return;
      if (err.type === 'peer-unavailable') {
        // 直接の待ち受けがない部屋（ホストが中継だけ）かもしれない
        if (!everOpened) return startRelay();
        cb.onStatus?.('ホストをさがしています…');
        return retry(3000);
      }
      if (err.type === 'browser-incompatible') return startRelay();
      cb.onStatus?.('せつぞくがふあんていです…');
      if (RETRY_TYPES.has(err.type)) {
        peer.destroy();
        if (!everOpened) return startRelay();
        retry(3000);
      }
    });
  }

  if (mode === 'relay') startRelay();
  else {
    startPeer();
    // 8 秒たってもつながらなければ中継にきりかえる
    fallbackTimer = setTimeout(() => !everOpened && startRelay(), 8000);
  }

  return {
    send(obj) {
      const s = JSON.stringify(obj);
      if (mode === 'relay') {
        if (rconn && rconn.open) rconn.send(s);
      } else if (dc && dc.open) {
        if (isTf(s) && dcBuffered(dc) > DC_BACKLOG) return;
        try {
          sendStr(dc, s);
        } catch {}
      }
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      clearTimeout(fallbackTimer);
      clearTimeout(upgradeTimer);
      upPeer?.destroy();
      relayTry?.cancel();
      rconn?.close();
      peer?.destroy();
    },
  };
}
