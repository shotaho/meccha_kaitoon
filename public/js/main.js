// めっちゃカイトオン - クライアント

import * as THREE from 'three';
import { buildWorld, collide, groundAt, ceilingAt, pushOut } from './world.js';
import { MAPS, spotView } from './maps.js';
import { paintCamo } from './camo.js';
import { createCpuBrains } from './cpu.js';
import { Character, POSES, PARTS, BODY_RADIUS } from './character.js';
import { detectServer, connectServer, hostP2P, joinP2P, localRoom, makeRoomCode, normalizeCode } from './net.js';

// ===========================================================================
// 小物
// ===========================================================================

const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const store = {
  get(k) { try { return localStorage.getItem('mc.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('mc.' + k, v); } catch {} },
  del(k) { try { localStorage.removeItem('mc.' + k); } catch {} },
};

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function feed(text) {
  const el = h('div', {}, text);
  $('feed').append(el);
  setTimeout(() => el.remove(), 4000);
  while ($('feed').children.length > 4) $('feed').firstChild.remove();
}

const isTouch = matchMedia('(pointer: coarse)').matches;

// 効果音（WebAudio で簡単に鳴らす）
let audio;
function beep(freq, dur = 0.12, type = 'sine', vol = 0.15, slide = 0) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, audio.currentTime + dur);
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch {}
}

// ===========================================================================
// 3D
// ===========================================================================

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#222222');
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
camera.rotation.order = 'YXZ';
let world = buildWorld(scene, 'house');

// ステージを切り替える
function ensureWorld(mapId) {
  if (!MAPS[mapId] || world.id === mapId) return;
  world.dispose();
  world = buildWorld(scene, mapId);
  resetFreeCam();
  for (const c of chars.values()) c.camoKey = null;
}

function resetFreeCam() {
  const b = world.bounds;
  free.pos.set((b.x0 + b.x1) / 2, Math.min(b.h - 0.5, MAPS[world.id].outdoor ? 6 : 3), b.z1 - 2);
  free.yaw = 0;
  free.pitch = -0.35;
}
const raycaster = new THREE.Raycaster();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ペイント弾の跡
const splats = [];
function splat(point, hit) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(hit ? 0.35 : 0.13, 12, 8),
    new THREE.MeshBasicMaterial({ color: hit ? '#ffe14d' : '#ff3b8d', transparent: true }),
  );
  m.position.set(point[0], point[1], point[2]);
  scene.add(m);
  splats.push({ m, t: 0, life: hit ? 1.2 : 3 });
}

// ===========================================================================
// 状態
// ===========================================================================

// 通信
let netMode = null; // 'server'（Node.js の LAN サーバー） | 'p2p'（GitHub Pages など）
let link = null;
let roomCode = null;
let hosting = false;
let myId = null;

// 再読み込みしても同じ部屋に戻れるよう、タブ単位で覚えておく
const sess = {
  get(k) { try { return sessionStorage.getItem('mc.' + k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem('mc.' + k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem('mc.' + k); } catch {} },
};
let offline = false; // CPU とだけ遊ぶ（通信なし）
let quickStart = false; // 部屋ができたらすぐ CPU 戦を始める
const idKey = () => (offline ? 'id.cpu' : netMode === 'p2p' ? `id.${roomCode}` : 'id');
let S = null; // サーバーから来た状態
let stateAt = 0;
let joined = false;
const chars = new Map(); // id -> Character
const opsById = new Map(); // id -> ペイント操作の配列

const self = {
  pos: new THREE.Vector3(0, 0, 0),
  yaw: 0, // 体の向き
  pitch: 0,
  roll: 0,
  pose: 'stand',
  vy: 0,
  look: [0, 0], // 一人称の視線 [yaw, pitch]
};
const orbit = { yaw: 0.6, pitch: 0.25, dist: 3.2 };
const free = { pos: new THREE.Vector3(0, 2.5, 6), yaw: 0, pitch: -0.2 };

let viewMode = 'none';
let hiderMode = 'move'; // move | paint
let tool = 'brush';
let color = store.get('color') || '#8a5a34';
let brushCm = Number(store.get('brush') || 6);
let recent = JSON.parse(store.get('recent') || '[]');
let groups = []; // 自分のペイントの undo 単位
let redoStack = [];
let menuOpen = false;
let resultPanelHidden = false;
let lastShotAt = 0;

const me = () => S?.players.find((p) => p.id === myId);
const playerInfo = (id) => S?.players.find((p) => p.id === id);
const nameOf = (id) => playerInfo(id)?.name ?? '？';
const isHost = () => S && S.hostId === myId;

function remainSec() {
  if (!S) return 0;
  return Math.max(0, (S.remainMs - (performance.now() - stateAt)) / 1000);
}

// ===========================================================================
// 通信
// ===========================================================================

function send(msg) {
  link?.send(msg);
}

const callbacks = {
  onOpen: () => send({ t: 'join', id: myId, name: store.get('name') }),
  onMessage: (m) => onMessage(m),
  onClose: () => toast('せつぞくがきれました。さいせつぞくちゅう…'),
  onError: (text) => {
    toast(text);
    leaveRoom();
  },
  onStatus: (text) => toast(text),
  // 新しく作ろうとした部屋番号が使用中だったので、別の番号で作り直す
  onIdTaken: () => connect('host', makeRoomCode(), true),
};

function defaultName() {
  return `ゲスト${Math.floor(Math.random() * 900) + 100}`;
}

function shareUrl(code) {
  const q = new URLSearchParams({ room: code });
  const ps = new URLSearchParams(location.search).get('peerserver');
  if (ps) q.set('peerserver', ps);
  return `${location.origin}${location.pathname}?${q}`;
}

// 接続を始める。mode = 'cpu'（CPU とすぐ遊ぶ）／ p2p では 'host' | 'join'
function connect(mode, code, fresh = false) {
  link?.close();
  offline = mode === 'cpu';
  if (offline) {
    hosting = true;
    roomCode = null;
    quickStart = true;
    myId = store.get(idKey());
    sess.set('room', 'cpu');
    sess.set('hosting', '1');
    history.replaceState(null, '', location.pathname + (new URLSearchParams(location.search).get('peerserver') ? `?peerserver=${encodeURIComponent(new URLSearchParams(location.search).get('peerserver'))}` : ''));
    link = localRoom(callbacks);
  } else if (netMode === 'server') {
    myId = store.get(idKey());
    link = connectServer(callbacks);
  } else {
    roomCode = code;
    hosting = mode === 'host';
    myId = store.get(idKey());
    sess.set('room', code);
    sess.set('hosting', hosting ? '1' : '');
    history.replaceState(null, '', shareUrl(code));
    try {
      link = hosting ? hostP2P(code, shareUrl(code), callbacks, fresh) : joinP2P(code, callbacks);
    } catch (e) {
      toast(e.message);
      link = null;
    }
  }
  renderPanel();
}

function leaveRoom() {
  link?.close();
  link = null;
  offline = false;
  quickStart = false;
  joined = false;
  S = null;
  sess.del('room');
  sess.del('hosting');
  for (const c of chars.values()) c.dispose();
  chars.clear();
  renderPanel();
  renderHud();
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id;
      joined = true;
      store.set(idKey(), myId);
      break;
    case 'error':
      toast(m.text);
      store.del(idKey());
      myId = null;
      leaveRoom();
      break;
    case 'kicked':
      toast('ホストにはずされました');
      store.del(idKey());
      myId = null;
      leaveRoom();
      break;
    case 'state': {
      const prevPhase = S?.phase;
      const prevRole = me()?.role;
      S = m;
      stateAt = performance.now();
      ensureWorld(S.settings.map);
      if (offline) {
        // CPU 戦の設定は次回のために覚えておく
        store.set('cpu.cpus', String(S.settings.cpus || 3));
        store.set('cpu.level', S.settings.cpuLevel);
        store.set('cpu.map', S.settings.map);
        if (quickStart && S.phase === 'lobby') {
          quickStart = false;
          // 前回の設定にして、「おに／かくれる」をえらぶ画面へ
          send({ t: 'settings', settings: { cpus: Number(store.get('cpu.cpus')) || 3, cpuLevel: store.get('cpu.level') || 'normal', map: store.get('cpu.map') || 'house' } });
        }
      }
      if (prevPhase !== S.phase) onPhaseChange(prevPhase);
      else if (prevRole !== me()?.role) onPhaseChange(prevPhase);
      syncCharKinds();
      renderPanel();
      renderHud();
      if (viewMode === 'hider' && S.phase === 'prep') renderTools(); // 「かくれたよ」の表示を更新
      break;
    }
    case 'round':
      opsById.clear();
      groups = [];
      redoStack = [];
      for (const c of chars.values()) c.dispose();
      chars.clear();
      break;
    case 'tf':
      for (const [id, p, r, pose, look] of m.list) {
        if (id === myId) {
          if (m.all) {
            self.pos.set(p[0], p[1], p[2]);
            self.yaw = r[0];
            self.pitch = r[1];
            self.roll = r[2];
            self.pose = pose;
            self.look = look.slice();
            self.vy = 0;
          }
          ensureChar(id);
          continue;
        }
        const c = ensureChar(id);
        c.setTarget(p, r, pose, look);
        if (m.all) c.snap();
      }
      break;
    case 'paintAll':
      opsById.clear();
      for (const [id, ops] of Object.entries(m.paints)) opsById.set(id, ops);
      for (const [id, c] of chars) if (!playerInfo(id)?.cpu) c.replay(opsById.get(id) || []);
      rebuildGroups();
      break;
    case 'paint': {
      const list = opsById.get(m.id) || [];
      list.push(...m.ops);
      opsById.set(m.id, list);
      const c = chars.get(m.id);
      if (c) for (const op of m.ops) c.applyOp(op);
      break;
    }
    case 'paintReset':
      opsById.set(m.id, m.ops);
      chars.get(m.id)?.replay(m.ops);
      if (m.id === myId) rebuildGroups();
      break;
    case 'shot':
      if (m.point) splat(m.point, !!m.hit);
      if (m.hit) {
        beep(520, 0.25, 'triangle', 0.2, 500);
        if (m.hit === myId) toast('みつかった！');
      } else {
        beep(180, 0.1, 'square', 0.06, -60);
        if (m.penalty && m.from === myId) feed(`はずれ！ のこりじかん -${m.penalty}びょう`);
      }
      break;
    case 'log':
      feed(m.text);
      break;
    case 'toast':
      toast(m.text);
      break;
    case 'left': {
      const c = chars.get(m.id);
      if (c) c.dispose();
      chars.delete(m.id);
      break;
    }
  }
}

function charKindFor(id) {
  return playerInfo(id)?.role === 'seeker' ? 'seeker' : 'hider';
}

function ensureChar(id) {
  let c = chars.get(id);
  const kind = charKindFor(id);
  if (c && c.kind !== kind) {
    c.dispose();
    chars.delete(id);
    c = null;
  }
  if (!c) {
    c = new Character({ id, kind, name: nameOf(id) });
    scene.add(c.root);
    chars.set(id, c);
    if (kind === 'hider') c.replay(opsById.get(id) || []);
  }
  return c;
}

function syncCharKinds() {
  for (const id of [...chars.keys()]) {
    const info = playerInfo(id);
    if (!info) {
      chars.get(id).dispose();
      chars.delete(id);
      continue;
    }
    const c = ensureChar(id);
    c.setName(info.name);
  }
}

function rebuildGroups() {
  groups = [];
  for (const op of opsById.get(myId) || []) {
    const last = groups[groups.length - 1];
    if (last && last.g === op.g) last.ops.push(op);
    else groups.push({ g: op.g, ops: [op] });
  }
}

// ===========================================================================
// フェーズと視点モード
// ===========================================================================

function computeViewMode() {
  if (!S || !joined) return 'lobby';
  const info = me();
  const role = info?.role;
  switch (S.phase) {
    case 'prep':
      if (role === 'hider') return 'hider';
      if (role === 'seeker') return 'wait';
      return 'free';
    case 'hunt':
      if (role === 'seeker') return 'fps';
      if (role === 'hider' && !info.found) return 'frozen';
      return 'free';
    case 'result':
      return 'free';
    default:
      return 'lobby';
  }
}

function onPhaseChange(prev) {
  menuOpen = false;
  resultPanelHidden = false;
  if (S.phase === 'prep' && prev !== 'prep') {
    beep(660, 0.15);
    setTimeout(() => beep(880, 0.2), 150);
    hiderMode = 'move';
  }
  if (S.phase === 'hunt' && prev === 'prep') {
    beep(440, 0.3, 'sawtooth', 0.08, 220);
  }
  if (S.phase === 'result' && prev && prev !== 'lobby') showResultSplash();
}

// ラウンド終了時に、どちらの勝ちかを画面いっぱいに出す
let splashTimer = 0;
function showResultSplash() {
  const r = S.result || {};
  const info = me();
  const seekersWin = r.winner === 'seekers';
  const team = info?.role === 'seeker' ? 'seekers' : info?.role === 'hider' ? 'hiders' : null;
  const won = team && team === r.winner;
  let mine = null;
  if (team) {
    if (won) mine = team === 'hiders' && info.found ? '🎉 なかまがにげきった！ あなたのチームのかち！' : '🎉 あなたのかち！';
    else mine = '😢 あなたのまけ…';
  }
  const caught = S.foundLog.length;
  const left = (r.survivors || []).length;

  document.getElementById('splash')?.remove();
  const el = h('div', { id: 'splash', class: seekersWin ? 's' : 'h' },
    h('div', { class: 'sp-who' }, seekersWin ? '👹' : '🦎'),
    h('div', { class: 'sp-title' }, seekersWin ? 'おにのかち！' : 'かくれるがわのかち！'),
    mine && h('div', { class: `sp-mine ${won ? 'win' : 'lose'}` }, mine),
    h('div', { class: 'sp-count' }, `にげきり ${left}にん ／ みつかった ${caught}にん`),
    r.reason && h('div', { class: 'sp-reason' }, r.reason),
    h('div', { class: 'sp-tap' }, 'タップでとじる'),
  );
  if (won || !team) {
    for (let i = 0; i < 36; i++) {
      el.append(h('span', {
        class: 'confetti',
        style: `left:${Math.random() * 100}%;animation-delay:${Math.random() * 1.2}s;animation-duration:${2 + Math.random() * 1.5}s`,
      }, ['🎉', '✨', '⭐', '🎊'][i % 4]));
    }
  }
  const close = () => {
    clearTimeout(splashTimer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', close);
  document.body.append(el);
  splashTimer = setTimeout(close, 4500);

  if (won || !team) {
    [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => beep(f, i === 3 ? 0.45 : 0.14, 'triangle', 0.18), i * 130));
  } else {
    [392, 330, 262].forEach((f, i) => setTimeout(() => beep(f, i === 2 ? 0.5 : 0.22, 'sawtooth', 0.07), i * 220));
  }
}

function setViewMode(mode) {
  if (mode === viewMode) return;
  const prev = viewMode;
  viewMode = mode;
  if (document.pointerLockElement) document.exitPointerLock();
  if (mode === 'free') {
    free.pos.copy(camera.position);
    free.yaw = camera.rotation.y;
    free.pitch = camera.rotation.x;
    if (prev === 'lobby' || prev === 'none' || prev === 'wait') {
      resetFreeCam();
    }
  }
  renderTools();
  renderHud();
  renderTouch();
}

// ===========================================================================
// 入力
// ===========================================================================

const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  keys.add(e.code);
  onKey(e);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// 隠れる側はじゅんび中も、さがされている間（見つかるまで）もぬれる
const canPaint = () => viewMode === 'hider' || viewMode === 'frozen';

function onKey(e) {
  if (canPaint()) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      return redo();
    }
    if (e.code === 'Space' || e.code === 'KeyP') {
      e.preventDefault();
      setHiderMode(hiderMode === 'move' ? 'paint' : 'move');
      return;
    }
    if (hiderMode === 'move' && viewMode === 'hider') {
      const poseKeys = Object.keys(POSES);
      const n = Number(e.key);
      if (n >= 1 && n <= poseKeys.length) setPose(poseKeys[n - 1]);
      if (e.code === 'KeyZ') turn(-1);
      if (e.code === 'KeyX') turn(1);
      if (e.code === 'KeyC') tilt(1);
      if (e.code === 'KeyV') tilt(-1);
      if (e.code === 'KeyR') resetRot();
    } else if (hiderMode === 'paint') {
      const tl = ['brush', 'eraser', 'picker', 'fill', 'rotate'];
      const n = Number(e.key);
      if (n >= 1 && n <= tl.length) setTool(tl[n - 1]);
      if (e.code === 'BracketLeft') setBrush(brushCm - 1);
      if (e.code === 'BracketRight') setBrush(brushCm + 1);
    }
  }
  if (viewMode === 'fps' && e.code === 'Space') {
    e.preventDefault();
    jump();
  }
  if (e.code === 'Escape') {
    menuOpen = !menuOpen && S && S.phase !== 'lobby';
    renderPanel();
  }
}

// ----- ポインタ（マウス・タッチ） -----

const pointers = new Map(); // pointerId -> {x, y, sx, sy, t, kind}
let pinchDist = 0;
let stroke = null; // ペイント中のストローク

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button, kind: 'look' };
  pointers.set(e.pointerId, p);

  if (viewMode === 'fps' && e.pointerType === 'mouse') {
    if (!document.pointerLockElement) {
      canvas.requestPointerLock?.();
    } else if (e.button === 0) {
      shoot(innerWidth / 2, innerHeight / 2);
    }
    p.kind = 'none';
    return;
  }

  if (canPaint() && hiderMode === 'paint' && pointers.size === 1) {
    const rotate = e.button === 2 || e.button === 1 || tool === 'rotate';
    if (!rotate) {
      p.kind = 'paint';
      if (tool === 'picker' || e.altKey) {
        pickColor(e.clientX, e.clientY);
        p.kind = 'none';
      } else if (tool === 'fill') {
        fillAt(e.clientX, e.clientY);
        p.kind = 'none';
      } else {
        beginStroke(e.clientX, e.clientY);
      }
    }
  }
  if (pointers.size === 2) {
    // ピンチで拡大縮小（ペイント中のストロークは取り消さずに終える）
    endStroke();
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    for (const q of pointers.values()) q.kind = 'pinch';
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas && viewMode === 'fps') {
    self.look[0] -= e.movementX * 0.0022;
    self.look[1] = clamp(self.look[1] - e.movementY * 0.0022, -1.45, 1.45);
    return;
  }
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (p.kind === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) zoom(pinchDist / d);
    pinchDist = d;
    return;
  }
  if (p.kind === 'paint') {
    moveStroke(e.clientX, e.clientY);
    return;
  }
  if (p.kind !== 'look') return;
  const sens = e.pointerType === 'touch' ? 0.006 : 0.005;
  if (viewMode === 'hider' || viewMode === 'frozen') {
    orbit.yaw -= dx * sens;
    orbit.pitch = clamp(orbit.pitch + dy * sens, -1.2, 1.4);
  } else if (viewMode === 'fps') {
    self.look[0] -= dx * sens;
    self.look[1] = clamp(self.look[1] - dy * sens, -1.45, 1.45);
  } else if (viewMode === 'free' || viewMode === 'lobby') {
    free.yaw -= dx * sens;
    free.pitch = clamp(free.pitch - dy * sens, -1.45, 1.45);
  }
});

function pointerEnd(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p) return;
  if (p.kind === 'paint') endStroke();
  // タップで撃つ（スマホ）
  if (viewMode === 'fps' && e.pointerType !== 'mouse' && p.kind === 'look') {
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    if (moved < 12 && performance.now() - p.t < 350) shoot(e.clientX, e.clientY);
  }
  if (pointers.size < 2) pinchDist = 0;
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom(e.deltaY > 0 ? 1.1 : 0.9);
}, { passive: false });

function zoom(f) {
  if (viewMode === 'hider' || viewMode === 'frozen') orbit.dist = clamp(orbit.dist * f, 0.8, 9);
}

// ----- バーチャルスティック -----

const stick = { id: null, x: 0, y: 0 };
$('stick').addEventListener('pointerdown', (e) => {
  stick.id = e.pointerId;
  $('stick').setPointerCapture(e.pointerId);
  updateStick(e);
});
$('stick').addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) updateStick(e);
});
const stickEnd = (e) => {
  if (e.pointerId !== stick.id) return;
  stick.id = null;
  stick.x = stick.y = 0;
  $('knob').style.transform = '';
};
$('stick').addEventListener('pointerup', stickEnd);
$('stick').addEventListener('pointercancel', stickEnd);

function updateStick(e) {
  const r = $('stick').getBoundingClientRect();
  let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const l = Math.hypot(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  stick.x = x;
  stick.y = y;
  $('knob').style.transform = `translate(${x * 35}px, ${y * 35}px)`;
}

const held = new Set(); // スマホのボタン長押し（up/down）

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// 入力ベクトル（前後左右）
function moveInput() {
  let f = 0;
  let s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  f -= stick.y;
  s += stick.x;
  const l = Math.hypot(f, s);
  if (l > 1) {
    f /= l;
    s /= l;
  }
  return { f, s };
}

function vertInput() {
  let v = 0;
  if (keys.has('KeyE') || held.has('up')) v += 1;
  if (keys.has('KeyQ') || held.has('down')) v -= 1;
  return v;
}

// ===========================================================================
// 隠れる側の操作
// ===========================================================================

const POSE_HEIGHT = { stand: 1.75, crouch: 1.3, curl: 1.0, lie: 0.55, banzai: 2.15, star: 1.75, flip: 1.85 };

function setHiderMode(m) {
  hiderMode = m;
  endStroke();
  renderTools();
  renderTouch();
  renderHint();
}

function setPose(p) {
  self.pose = p;
  renderTools();
}

function turn(dir) {
  self.yaw += (dir * Math.PI) / 12;
}

function tilt(dir) {
  self.pitch = clamp(self.pitch + (dir * Math.PI) / 12, -Math.PI / 2, Math.PI / 2);
}

function roll(dir) {
  self.roll = clamp(self.roll + (dir * Math.PI) / 12, -Math.PI / 2, Math.PI / 2);
}

function resetRot() {
  self.pitch = 0;
  self.roll = 0;
}

function setTool(t) {
  tool = t;
  renderTools();
  renderHint();
}

function setBrush(cm) {
  brushCm = clamp(Math.round(cm), 1, 40);
  store.set('brush', brushCm);
  const r = $('brushRange');
  if (r) r.value = brushCm;
  const l = $('brushLabel');
  if (l) l.textContent = `${brushCm}cm`;
}

function setColor(c, addRecent) {
  color = c;
  store.set('color', c);
  if (addRecent) {
    recent = [c, ...recent.filter((x) => x !== c)].slice(0, 12);
    store.set('recent', JSON.stringify(recent));
  }
  renderTools();
}

function myChar() {
  return chars.get(myId);
}

function hitMyBody(cx, cy) {
  const c = myChar();
  if (!c) return null;
  raycaster.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  // ステージに隠れて見えない部分は塗れない
  const hits = raycaster.intersectObjects([...c.parts, ...world.meshes], false);
  const hit = hits[0];
  if (!hit || hit.object.userData.owner !== myId || !hit.uv) return null;
  return { part: hit.object.userData.part, u: hit.uv.x, v: hit.uv.y };
}

let gCounter = Date.now();
let curGroup = null;
let pendingOps = [];

function beginStroke(cx, cy) {
  curGroup = { g: ++gCounter, ops: [] };
  stroke = null;
  moveStroke(cx, cy);
}

function moveStroke(cx, cy) {
  if (!curGroup) return;
  const hit = hitMyBody(cx, cy);
  if (!hit) {
    flushStroke(true);
    return;
  }
  const c = myChar();
  const col = tool === 'eraser' ? '#ffffff' : color;
  if (stroke) {
    const n = stroke.pts.length;
    const du = Math.abs(hit.u - stroke.pts[n - 2]);
    const dv = Math.abs(hit.v - stroke.pts[n - 1]);
    if (stroke.part !== hit.part || du > 0.3 || dv > 0.3) flushStroke(true);
  }
  if (!stroke) {
    const r = Math.max(0.5, (brushCm / 100) * c.paint[hit.part].density);
    stroke = { part: hit.part, c: col, r, pts: [hit.u, hit.v], sent: 0 };
    c.applyOp({ k: 's', p: hit.part, c: col, r, pts: [hit.u, hit.v] });
    return;
  }
  const n = stroke.pts.length;
  const pu = stroke.pts[n - 2];
  const pv = stroke.pts[n - 1];
  if (Math.hypot(hit.u - pu, hit.v - pv) < 0.002) return;
  stroke.pts.push(hit.u, hit.v);
  c.applyOp({ k: 's', p: hit.part, c: stroke.c, r: stroke.r, pts: [pu, pv, hit.u, hit.v] });
}

// 描いた分を送信キューへ。end=true ならストロークを終える
function flushStroke(end) {
  if (stroke && curGroup) {
    const from = Math.max(0, stroke.sent - 2);
    if (stroke.pts.length > stroke.sent) {
      const op = { k: 's', g: curGroup.g, p: stroke.part, c: stroke.c, r: +stroke.r.toFixed(2), pts: stroke.pts.slice(from).map((v) => +v.toFixed(4)) };
      curGroup.ops.push(op);
      pendingOps.push(op);
      stroke.sent = stroke.pts.length;
    }
  }
  if (end) stroke = null;
}

function endStroke() {
  if (!curGroup) return;
  flushStroke(true);
  if (curGroup.ops.length) {
    groups.push(curGroup);
    redoStack = [];
    const list = opsById.get(myId) || [];
    list.push(...curGroup.ops);
    opsById.set(myId, list);
  }
  curGroup = null;
}

function commitGroup(ops) {
  const g = ++gCounter;
  for (const op of ops) op.g = g;
  const c = myChar();
  for (const op of ops) c?.applyOp(op);
  groups.push({ g, ops });
  const list = opsById.get(myId) || [];
  list.push(...ops);
  opsById.set(myId, list);
  pendingOps.push(...ops);
}

function fillAt(cx, cy) {
  const hit = hitMyBody(cx, cy);
  if (!hit) return toast('じぶんのからだをタップしてね');
  redoStack = [];
  commitGroup([{ k: 'f', p: hit.part, c: color }]);
}

function clearAll() {
  redoStack = [];
  commitGroup([{ k: 'c' }]);
}

function fillAllParts() {
  redoStack = [];
  commitGroup([0, 1, 2, 3, 4, 5].map((p) => ({ k: 'f', p, c: color })));
}

function undo() {
  if (curGroup || !groups.length) return;
  flushPaint();
  const g = groups.pop();
  redoStack.push(g);
  const ops = groups.flatMap((x) => x.ops);
  opsById.set(myId, ops);
  myChar()?.replay(ops);
  send({ t: 'undo' });
}

function redo() {
  if (curGroup || !redoStack.length) return;
  const g = redoStack.pop();
  commitGroup(g.ops.map((op) => ({ ...op })));
}

function flushPaint() {
  if (!pendingOps.length) return;
  for (let i = 0; i < pendingOps.length; i += 150) send({ t: 'paint', ops: pendingOps.slice(i, i + 150) });
  pendingOps = [];
}

// 画面の色を拾う（スポイト）
function pickColor(cx, cy) {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const dpr = renderer.getPixelRatio();
  const buf = new Uint8Array(4);
  gl.readPixels(Math.floor(cx * dpr), Math.floor((innerHeight - cy) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const hex = '#' + [buf[0], buf[1], buf[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  setColor(hex, true);
  toast(`いろをとったよ ${hex}`);
  if (tool === 'picker') setTool('brush');
}

// ===========================================================================
// 鬼の操作
// ===========================================================================

function jump() {
  if (self.onGround) {
    self.vy = 6;
    self.onGround = false;
  }
}

function shoot(cx, cy) {
  const now = performance.now();
  if (now - lastShotAt < 650) return;
  lastShotAt = now;
  raycaster.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  const targets = [...world.meshes];
  for (const [id, c] of chars) {
    if (id === myId || c.kind !== 'hider' || playerInfo(id)?.found) continue;
    if (playerInfo(id)?.role !== 'hider') continue;
    targets.push(...c.parts);
  }
  const hit = raycaster.intersectObjects(targets, false)[0];
  const point = hit ? hit.point.toArray().map((v) => +v.toFixed(3)) : null;
  send({ t: 'shoot', target: hit?.object.userData.owner ?? null, point });
  $('crosshair').classList.add('cool');
  setTimeout(() => $('crosshair').classList.remove('cool'), 650);
}

// ===========================================================================
// 毎フレーム
// ===========================================================================

const clock = new THREE.Clock();
let tfTimer = 0;
let lobbyT = 0;

function step() {
  const dt = Math.min(0.05, clock.getDelta());
  setViewMode(computeViewMode());

  switch (viewMode) {
    case 'hider':
      updateHider(dt);
      break;
    case 'frozen':
      updateOrbitCamera();
      break;
    case 'fps':
      updateSeeker(dt);
      break;
    case 'free':
      updateFree(dt);
      break;
    default:
      {
        lobbyT += dt * 0.08;
        const b = world.bounds;
        const cx = (b.x0 + b.x1) / 2;
        const cz = (b.z0 + b.z1) / 2;
        const out = MAPS[world.id].outdoor;
        camera.position.set(cx + Math.cos(lobbyT) * (b.x1 - b.x0) * 0.34, out ? 8 : b.h * 0.68, cz + Math.sin(lobbyT) * (b.z1 - b.z0) * 0.32);
        camera.lookAt(cx, out ? 1.5 : 1, cz);
      }
      break;
  }

  // 自分のキャラは手元の状態で動かす
  const mine = chars.get(myId);
  if (mine) {
    mine.target = null;
    mine.root.position.copy(self.pos);
    if (mine.kind === 'seeker') {
      mine.root.rotation.set(0, self.look[0] + Math.PI, 0);
      mine.lookPitch = self.look[1];
    } else {
      mine.root.rotation.set(self.pitch, self.yaw, self.roll);
    }
    mine.setPose(self.pose);
  }

  for (const c of chars.values()) c.update(dt);
  if (viewMode === 'hider') keepBodyOutOfObjects();
  updateVisibility();
  updateCamo();
  brains.update(dt);
  world.update();

  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i];
    s.t += dt;
    s.m.material.opacity = 1 - s.t / s.life;
    s.m.scale.setScalar(1 + s.t * 0.6);
    if (s.t >= s.life) {
      s.m.removeFromParent();
      s.m.geometry.dispose();
      splats.splice(i, 1);
    }
  }

  // 送信
  tfTimer += dt;
  if (tfTimer > 0.066) {
    tfTimer = 0;
    flushStroke(false);
    flushPaint();
    if (viewMode === 'hider') {
      send({ t: 'tf', p: vec(self.pos), r: [round3(self.yaw), round3(self.pitch), round3(self.roll)], pose: self.pose, look: [0, 0] });
    } else if (viewMode === 'fps') {
      send({ t: 'tf', p: vec(self.pos), r: [round3(self.look[0] + Math.PI), 0, 0], pose: 'stand', look: self.look.map(round3) });
    }
  }

  updateTimer();
  renderer.render(scene, camera);
  requestAnimationFrame(step);
}

const round3 = (v) => Math.round(v * 1000) / 1000;
const vec = (v) => [round3(v.x), round3(v.y), round3(v.z)];

function camForward() {
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  f.y = 0;
  f.normalize();
  return f;
}

function updateHider(dt) {
  const r = BODY_RADIUS;
  const hgt = POSE_HEIGHT[self.pose] || 1.7;
  if (hiderMode === 'move') {
    const { f, s } = moveInput();
    if (f || s) {
      const fw = camForward();
      const rt = new THREE.Vector3(-fw.z, 0, fw.x);
      const sp = keys.has('ShiftLeft') ? 1.2 : 3.2;
      const mv = fw.multiplyScalar(f).add(rt.multiplyScalar(s)).multiplyScalar(sp * dt);
      self.pos.add(mv);
      // 進む方向を向く
      const target = Math.atan2(mv.x, mv.z);
      let d = target - self.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      self.yaw += d * Math.min(1, dt * 10);
    }
    const v = vertInput();
    if (v) self.pos.y += v * 1.8 * dt;
  }
  collide(world.colliders, self.pos, r, hgt, world.bounds);
  const g = groundAt(world.colliders, self.pos.x, self.pos.z, self.pos.y, r, 0.02);
  const top = ceilingAt(world.colliders, self.pos.x, self.pos.z, self.pos.y, r, hgt, world.bounds);
  self.pos.y = clamp(self.pos.y, g, Math.max(g, top));
  updateOrbitCamera();
}

// ポーズ・向き・傾きをふくめた体の形で、物にめり込まないように押し出す
const _v = new THREE.Vector3();
function bodySpheres(c) {
  const out = [];
  c.root.updateMatrixWorld(true);
  c.parts.forEach((m, i) => {
    const p = PARTS[i];
    const r = p.r * 0.9;
    const ys = p.kind === 'sphere' ? [0] : [-p.len / 2, 0, p.len / 2];
    for (const y of ys) {
      _v.set(0, y, 0).applyMatrix4(m.matrixWorld);
      out.push({ x: _v.x, y: _v.y, z: _v.z, r });
    }
  });
  return out;
}

function keepBodyOutOfObjects() {
  const c = myChar();
  if (!c || c.kind !== 'hider') return;
  // 近くの物だけを調べる
  const x = self.pos.x;
  const z = self.pos.z;
  const near = world.colliders.filter((b) => b.x0 < x + 3 && b.x1 > x - 3 && b.z0 < z + 3 && b.z1 > z - 3);
  for (let i = 0; i < 8; i++) {
    const push = pushOut(near, bodySpheres(c), world.bounds);
    if (!push) break;
    self.pos.x += push[0];
    self.pos.y += push[1];
    self.pos.z += push[2];
    c.root.position.copy(self.pos);
  }
}

function updateOrbitCamera() {
  const hgt = POSE_HEIGHT[self.pose] || 1.7;
  const tgt = self.pos.clone();
  tgt.y += Math.min(1.0, hgt * 0.55);
  const cp = Math.cos(orbit.pitch);
  const off = new THREE.Vector3(Math.sin(orbit.yaw) * cp, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * cp).multiplyScalar(orbit.dist);
  const pos = tgt.clone().add(off);
  pos.x = clamp(pos.x, world.bounds.x0 + 0.1, world.bounds.x1 - 0.1);
  pos.z = clamp(pos.z, world.bounds.z0 + 0.1, world.bounds.z1 - 0.1);
  pos.y = clamp(pos.y, 0.1, world.bounds.h - 0.1);
  camera.position.copy(pos);
  camera.lookAt(tgt);
}

function updateSeeker(dt) {
  const { f, s } = moveInput();
  const yaw = self.look[0];
  const fw = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rt = new THREE.Vector3(-fw.z, 0, fw.x);
  const sp = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6.5 : 4.2;
  self.pos.add(fw.multiplyScalar(f * sp * dt)).add(rt.multiplyScalar(s * sp * dt));
  if (held.has('jump')) jump();
  self.vy -= 13 * dt;
  self.pos.y += self.vy * dt;
  // 先に着地を判定する（ジャンプで台の上に乗れるように）
  const g0 = groundAt(world.colliders, self.pos.x, self.pos.z, Math.max(self.pos.y, 0), BODY_RADIUS, 0.4);
  if (self.pos.y <= g0 && self.vy <= 0) {
    self.pos.y = g0;
    self.vy = 0;
  }
  collide(world.colliders, self.pos, BODY_RADIUS, 1.7, world.bounds);
  const g = groundAt(world.colliders, self.pos.x, self.pos.z, Math.max(self.pos.y, 0), BODY_RADIUS, 0.4);
  if (self.pos.y <= g) {
    self.pos.y = g;
    self.vy = 0;
    self.onGround = true;
  } else {
    self.onGround = false;
  }
  const top = ceilingAt(world.colliders, self.pos.x, self.pos.z, self.pos.y, BODY_RADIUS, 1.7, world.bounds);
  if (self.pos.y > top) {
    self.pos.y = top;
    self.vy = Math.min(0, self.vy);
  }
  self.pose = 'stand';
  camera.position.set(self.pos.x, self.pos.y + 1.55, self.pos.z);
  camera.rotation.set(self.look[1], self.look[0], 0);
}

function updateFree(dt) {
  const { f, s } = moveInput();
  const v = vertInput();
  const fw = new THREE.Vector3(-Math.sin(free.yaw) * Math.cos(free.pitch), Math.sin(free.pitch), -Math.cos(free.yaw) * Math.cos(free.pitch));
  const rt = new THREE.Vector3(Math.cos(free.yaw), 0, -Math.sin(free.yaw));
  const sp = keys.has('ShiftLeft') ? 10 : 5;
  free.pos.add(fw.multiplyScalar(f * sp * dt)).add(rt.multiplyScalar(s * sp * dt));
  free.pos.y += v * sp * dt;
  free.pos.x = clamp(free.pos.x, world.bounds.x0 + 0.2, world.bounds.x1 - 0.2);
  free.pos.z = clamp(free.pos.z, world.bounds.z0 + 0.2, world.bounds.z1 - 0.2);
  free.pos.y = clamp(free.pos.y, 0.3, world.bounds.h - 0.2);
  camera.position.copy(free.pos);
  camera.rotation.set(free.pitch, free.yaw, 0);
}

// CPU の擬態ペイント（1フレームに1体ずつ）
function updateCamo() {
  if (!S || S.phase === 'lobby' || world.id !== S.settings.map) return;
  for (const [id, c] of chars) {
    const info = playerInfo(id);
    if (!info?.cpu || info.role !== 'hider' || info.spot == null || c.kind !== 'hider' || !c.target) continue;
    const key = `${S.roundNo}:${S.settings.map}:${info.spot}:${S.settings.cpuLevel}`;
    if (c.camoKey === key) continue;
    const spot = MAPS[S.settings.map].spots[info.spot];
    if (!spot) continue;
    c.snap();
    paintCamo(renderer, scene, c, spotView(spot, MAPS[S.settings.map].viewDist), S.settings.cpuLevel, (hidden) => {
      if (hidden) {
        for (const o of chars.values()) o.root.visible = false;
        for (const sp of splats) sp.m.visible = false;
      } else {
        for (const sp of splats) sp.m.visible = true;
        updateVisibility();
      }
    });
    c.camoKey = key;
    return;
  }
}

const brains = createCpuBrains({
  renderer,
  scene,
  chars,
  send: (m) => send(m),
  getState: () => S,
  getWorld: () => world,
  myId: () => myId,
  // 見つけ判定の描画中は、鬼と名札を隠して対象だけを出し入れする
  setProbe(targetId, show) {
    for (const [id, c] of chars) {
      if (c.label) c.label.visible = false;
      c.setOutline(null);
      if (id === targetId) c.root.visible = show;
      else if (c.kind === 'seeker') c.root.visible = false;
    }
  },
  endProbe: () => updateVisibility(),
});

function updateVisibility() {
  const phase = S?.phase;
  const myRole = me()?.role;
  const t = performance.now() / 1000;
  for (const [id, c] of chars) {
    const info = playerInfo(id);
    let vis = false;
    let label = false;
    let outline = null;
    if (info && phase && phase !== 'lobby' && (info.role === 'hider' || info.role === 'seeker')) {
      if (c.kind === 'seeker') {
        vis = phase === 'result' || (phase === 'hunt' && id !== myId);
        label = vis && id !== myId;
      } else {
        vis = phase === 'prep' || phase === 'hunt' || phase === 'result';
        if (info.found) {
          outline = '#ff3b6b';
          label = id !== myId;
        } else if (phase === 'result') {
          outline = Math.sin(t * 6) > -0.3 ? '#ffd400' : null;
          label = true;
        } else if (id !== myId && myRole !== 'seeker') {
          label = true;
        }
      }
    }
    c.root.visible = vis;
    if (c.label) c.label.visible = vis && label;
    c.setOutline(vis ? outline : null);
  }
}

// ===========================================================================
// UI
// ===========================================================================

function updateTimer() {
  if (!S || (S.phase !== 'prep' && S.phase !== 'hunt')) return;
  const sec = Math.ceil(remainSec());
  const txt = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const el = $('timer');
  if (el.textContent !== txt) {
    el.textContent = txt;
    el.classList.toggle('warn', sec <= 10);
    if (sec <= 5 && sec > 0) beep(1000, 0.05, 'sine', 0.05);
  }
  $('waitTimer').textContent = txt;
}

function renderHud() {
  const show = S && joined && (S.phase === 'prep' || S.phase === 'hunt');
  $('hud').classList.toggle('hidden', !show);
  $('waitOverlay').classList.toggle('hidden', viewMode !== 'wait');
  $('crosshair').classList.toggle('hidden', viewMode !== 'fps');
  if (!show) {
    $('hint').classList.add('hidden');
    return;
  }
  const info = me();
  const left = S.players.filter((p) => p.role === 'hider' && !p.found).length;
  const people = S.players.filter((p) => p.role === 'hider' && !p.cpu && p.online);
  const readyN = people.filter((p) => p.ready).length;
  $('phaseLabel').textContent = S.phase === 'prep'
    ? (people.length > 1 ? `じゅんびタイム（OK ${readyN}/${people.length}にん）` : 'じゅんびタイム')
    : `さがしちゅう・のこり${left}にん`;
  const rl = $('roleLabel');
  if (info?.role === 'seeker') {
    rl.textContent = '👹 おに';
    rl.className = 'seeker';
  } else if (info?.role === 'hider') {
    rl.textContent = info.found ? '😵 みつかった' : '🦎 かくれるがわ';
    rl.className = '';
  } else {
    rl.textContent = '👀 かんせん';
    rl.className = '';
  }
  renderHint();
}

function renderHint() {
  const el = $('hint');
  if (isTouch || !S) return el.classList.add('hidden');
  let html = '';
  if (viewMode === 'hider') {
    html = hiderMode === 'move'
      ? '<b>いどうモード</b><br>WASD：いどう　Q/E：した/うえ（うけます）<br>ドラッグ：カメラ　ホイール：ズーム<br>1〜7：ポーズ　Z/X：かいてん　C/V：まえうしろにかたむける　R：かたむきリセット<br><b>スペース：ペイントモードへ</b>'
      : '<b>ペイントモード</b><br>ひだりドラッグ：ぬる　みぎドラッグ：カメラ　ホイール：ズーム<br>Alt+クリック：スポイト　1〜5：どうぐ　[ ]：ふとさ<br>Ctrl+Z：もどす　Ctrl+Y：やりなおし<br><b>スペース：いどうモードへ</b>';
  } else if (viewMode === 'fps') {
    html = document.pointerLockElement
      ? '<b>おに</b>　WASD：いどう　Shift：はしる　スペース：ジャンプ<br>クリック：ペイントだん（はずすとじかんがへる）　Esc：マウスかいほう'
      : '<b>がめんをクリックしてしてんそうさをスタート</b>';
  } else if (viewMode === 'frozen') {
    html = hiderMode === 'paint'
      ? '<b>かくれちゅう（ペイントできます）</b><br>ひだりドラッグ：ぬる　みぎドラッグ：カメラ　Alt+クリック：スポイト<br>Ctrl+Z：もどす　<b>スペース：みまわす</b>'
      : 'かくれちゅう… うごけません。ドラッグでまわりをみられます<br><b>スペース：ペイント（みつかるまでぬれます）</b>';
  } else if (viewMode === 'free') {
    html = 'かんせんちゅう　WASD：いどう　Q/E：うえ・した　ドラッグ：してん';
  }
  el.innerHTML = html;
  el.classList.toggle('hidden', !html);
}
document.addEventListener('pointerlockchange', renderHint);

function renderTouch() {
  const show = isTouch && ['hider', 'fps', 'free'].includes(viewMode) && !(viewMode === 'hider' && hiderMode === 'paint');
  $('touch').classList.toggle('hidden', !show);
  $('touch').classList.toggle('withTools', canPaint());
  $('touch').classList.toggle('toolsCollapsed', $('tools').classList.contains('collapsed'));
  const btns = $('touchBtns');
  btns.replaceChildren();
  const hold = (name, label) => {
    const b = h('button', {}, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      held.add(name);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => held.delete(name));
    return b;
  };
  if (viewMode === 'fps') btns.append(hold('jump', '⤒'));
  else btns.append(hold('up', '⬆'), hold('down', '⬇'));
}

const PALETTE = ['#ffffff', '#d9d9d9', '#8c8c8c', '#3a3a3a', '#000000', '#8a5a34', '#c0443f', '#e07a8b', '#f2c94c', '#6f9d4a', '#4a7bd0', '#7b5ea7'];

function renderTools() {
  const el = $('tools');
  const show = canPaint();
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const frozen = viewMode === 'frozen';
  const scroll = el.scrollTop;
  const collapsed = el.classList.contains('collapsed');
  const sel = (cond) => (cond ? 'on' : 'sub');
  const parts = [];
  // スマホ：ひらく／たたむの取っ手は、たたんでいても見えるようにいちばん上に置く
  const setCollapsed = (v) => {
    el.classList.toggle('collapsed', v);
    renderTools();
    renderTouch();
  };
  if (isTouch) {
    parts.push(h('button', { class: 'sub small toolHandle', onclick: () => setCollapsed(!collapsed) }, collapsed ? '▲ ツールをひらく' : '▼ ツールをたたむ'));
  }
  const pickMode = (m) => {
    if (collapsed) el.classList.remove('collapsed');
    setHiderMode(m);
  };
  parts.push(
    h('div', { class: 'grid2' },
      h('button', { class: sel(hiderMode === 'move'), onclick: () => pickMode('move') }, frozen ? '👀 みまわす' : '🚶 いどう・ポーズ'),
      h('button', { class: sel(hiderMode === 'paint'), onclick: () => pickMode('paint') }, '🎨 ペイント'),
    ),
  );
  if (!frozen) {
    // かくれ終わったら押す
    const ready = !!me()?.ready;
    parts.push(h('button', {
      class: ready ? 'sub' : '',
      style: 'width:100%;font-size:16px;padding:12px 6px',
      onclick: () => send({ t: 'ready', v: !ready }),
    }, ready ? '⏳ みんなをまっています（とりけす）' : '✅ かくれたよ！スタート'));
  }
  if (hiderMode === 'move' && frozen) {
    parts.push(h('p', { class: 'muted' }, 'もううごけないけど、みつかるまではペイントでいろをぬりなおせるよ。おにのうごきをみながらなおそう！'));
  } else if (hiderMode === 'move') {
    parts.push(
      h('div', {},
        h('h4', {}, 'ポーズ'),
        h('div', { class: 'grid' }, Object.entries(POSES).map(([k, p]) => h('button', { class: sel(self.pose === k), onclick: () => setPose(k) }, p.label))),
      ),
      h('div', {},
        h('h4', {}, 'むき・かたむき'),
        h('div', { class: 'grid' },
          h('button', { class: 'sub', onclick: () => turn(-1) }, '⟲ ひだり'),
          h('button', { class: 'sub', onclick: () => turn(1) }, '⟳ みぎ'),
          h('button', { class: 'sub', onclick: resetRot }, 'かたむき0'),
          h('button', { class: 'sub', onclick: () => tilt(1) }, 'まえへたおす'),
          h('button', { class: 'sub', onclick: () => tilt(-1) }, 'うしろへたおす'),
          h('button', { class: 'sub', onclick: () => roll(1) }, 'よこにたおす'),
        ),
      ),
      h('p', { class: 'muted' }, 'ばしょとポーズをきめたら、ペイントではいけいにとけこもう！ くうちゅうにもうけます（Q/E・⬆⬇）'),
    );
  } else {
    const tools = [['brush', '🖌 ブラシ'], ['eraser', '🧽 けしゴム'], ['picker', '💧 スポイト'], ['fill', '🪣 パーツぬり'], ['rotate', '🔄 してん']];
    parts.push(
      h('div', {},
        h('h4', {}, 'どうぐ'),
        h('div', { class: 'grid' }, tools.map(([k, l]) => h('button', { class: sel(tool === k), onclick: () => setTool(k) }, l))),
      ),
      h('div', {},
        h('h4', {}, 'ふとさ ', h('span', { id: 'brushLabel' }, `${brushCm}cm`)),
        h('input', { type: 'range', id: 'brushRange', min: 1, max: 40, value: brushCm, oninput: (e) => setBrush(Number(e.target.value)) }),
      ),
      h('div', {},
        h('h4', {}, 'いろ（スポイトではいけいのいろをとるととけこみやすい）'),
        h('div', { class: 'colorRow' },
          h('div', { class: 'curColor', style: `background:${color}` }),
          h('input', { type: 'color', value: color, onchange: (e) => setColor(e.target.value, true) }),
        ),
      ),
      recent.length > 0 && h('div', {},
        h('h4', {}, 'さいきんのいろ'),
        h('div', { class: 'swatches' }, recent.map((c) => h('div', { class: 'sw' + (c === color ? ' cur' : ''), style: `background:${c}`, onclick: () => setColor(c) }))),
      ),
      h('div', {},
        h('h4', {}, 'パレット'),
        h('div', { class: 'swatches' }, PALETTE.map((c) => h('div', { class: 'sw' + (c === color ? ' cur' : ''), style: `background:${c}`, onclick: () => setColor(c, true) }))),
      ),
      h('div', { class: 'grid' },
        h('button', { class: 'sub', onclick: undo }, '↶ もどす'),
        h('button', { class: 'sub', onclick: redo }, '↷ やりなおし'),
        h('button', { class: 'sub', onclick: () => confirm('ぜんしんをまっしろにもどしますか？') && clearAll() }, '🗑 ぜんぶけす'),
      ),
      h('button', { class: 'sub', onclick: fillAllParts }, 'ぜんしんをこのいろでぬる'),
    );
  }
  el.replaceChildren(...parts.filter(Boolean));
  el.scrollTop = scroll;
}

function playerList(opts = {}) {
  const sorted = S.players.slice().sort((a, b) => (opts.byScore ? b.score - a.score : 0));
  return h('ul', { class: 'plist' },
    sorted.map((p) => h('li', { class: p.online ? '' : 'off' },
      h('span', { class: 'nm' },
        p.name,
        p.id === S.hostId && h('span', { class: 'tag host' }, 'ホスト'),
        p.id === myId && h('span', { class: 'tag' }, 'あなた'),
        p.cpu && h('span', { class: 'tag' }, '🤖 CPU'),
        p.role === 'seeker' && S.phase !== 'lobby' && h('span', { class: 'tag seek' }, 'おに'),
        !p.online && h('span', { class: 'tag' }, 'せつだんちゅう'),
      ),
      h('span', { class: 'sc' }, `${p.score}てん`),
      isHost() && p.id !== myId && opts.kick &&
        h('button', { class: 'small sub', onclick: () => confirm(`${p.name} さんをはずしますか？`) && send({ t: 'kick', target: p.id }) }, 'はずす'),
    )),
  );
}

function rulesCard() {
  return h('div', { class: 'card' },
    h('details', {},
      h('summary', {}, 'あそびかた'),
      h('ol', { class: 'rules' },
        h('li', {}, 'おにとかくれるがわにわかれます。'),
        h('li', {}, 'じゅんびタイム：かくれるがわはへやのなかでかくれるばしょとポーズをきめ、まっしろなからだにペイントしてはいけいにとけこみます。おにはそのあいだ、めをつぶってたいき。'),
        h('li', {}, 'スポイトではいけいのいろをひろい、レンガのめじやほんのせびょうしまでかきこむのがコツ！'),
        h('li', {}, 'さがすタイム：かくれるがわはうごけません。おにはあやしいところにペイントだんをうってさがします。はずすとのこりじかんがへります。'),
        h('li', {}, 'じかんぎれまでみつからなければかくれるがわのかち（+3てん）。おにはひとりみつけるごとに+1てん。'),
        h('li', {}, '「ふえおに」モードでは、みつかったひとがおにになります。'),
      ),
    ),
  );
}

// 人間が自分ひとり＝CPU 戦。ラウンドごとに「おに／かくれる」をえらべる
function isCpuMatch() {
  return isHost() && S.players.filter((p) => p.online && !p.cpu).length === 1;
}

// ホストは自分の役（おに／かくれる）をえらんでスタートする
function roleChoiceCard() {
  if (!isHost()) return null;
  const cpuMatch = isCpuMatch();
  const big = 'flex:1;font-size:18px;padding:16px 8px';
  return h('div', { class: 'card' },
    h('h2', {}, S.phase === 'result' ? 'つぎはどっちであそぶ？' : 'どっちであそぶ？'),
    h('div', { class: 'row' },
      h('button', { class: 'danger', style: big, onclick: () => send({ t: 'start', role: 'seeker' }) }, '👹 おにになる'),
      h('button', { style: big, onclick: () => send({ t: 'start', role: 'hider' }) }, '🦎 かくれる'),
    ),
    !cpuMatch && h('button', { class: 'sub', style: 'width:100%;margin-top:8px', onclick: () => send({ t: 'start' }) }, '🎲 おまかせ（みんなランダム）'),
    h('p', { class: 'muted' }, cpuMatch
      ? (S.settings.cpus ? `CPU ${S.settings.cpus}にんとたいせん（したのせっていでかえられます）` : 'CPU 3にんとたいせんします')
      : 'あなた（ホスト）の役をえらんでスタート。ほかの人の役はランダムできまります'),
  );
}

function settingsCard() {
  const st = S.settings;
  const editable = isHost();
  const sel = (key, options, fmt) => {
    const s = h('select', {
      disabled: !editable,
      onchange: (e) => send({ t: 'settings', settings: { [key]: ['mode', 'map', 'cpuLevel'].includes(key) ? e.target.value : Number(e.target.value) } }),
    }, options.map((o) => h('option', { value: o }, fmt(o))));
    s.value = String(st[key]);
    return s;
  };
  return h('div', { class: 'card' },
    h('h2', {}, 'ルールせってい', !editable && h('span', { class: 'muted' }, '（ホストがへんこうできます）')),
    h('div', { class: 'settings' },
      h('label', {}, 'ステージ'), sel('map', Object.keys(MAPS), (o) => MAPS[o].name),
      h('label', {}, 'CPU'), sel('cpus', [0, 1, 2, 3, 4, 5, 6, 7], (o) => (o ? `${o}にん` : 'なし')),
      st.cpus > 0 && h('label', {}, 'CPUのつよさ'), st.cpus > 0 && sel('cpuLevel', ['easy', 'normal', 'hard'], (o) => ({ easy: 'よわい', normal: 'ふつう', hard: 'つよい' })[o]),
      h('label', {}, 'モード'), sel('mode', ['normal', 'infect'], (o) => (o === 'normal' ? 'ノーマル' : 'ふえおに（みつかるとおにになる）')),
      h('label', {}, 'おにのにんずう'), sel('seekers', [1, 2, 3, 4], (o) => `${o}にん`),
      h('label', {}, 'じゅんびタイム'), sel('prepSec', [30, 60, 90, 120, 150, 180, 240, 300], (o) => `${o}びょう`),
      h('label', {}, 'さがすタイム'), sel('huntSec', [30, 60, 90, 120, 150, 180, 240], (o) => `${o}びょう`),
      h('label', {}, 'はずれペナルティ'), sel('penaltySec', [0, 2, 3, 5, 10], (o) => (o ? `-${o}びょう` : 'なし')),
    ),
    !editable && h('p', { class: 'muted' }, 'ホストのスタートをまっています…'),
    editable && h('p', { class: 'muted' }, 'うえの「おにになる」「かくれる」でスタートします'),
  );
}

function renderPanel() {
  const el = $('panel');
  const out = [];
  if (!netMode) {
    out.push(h('div', { class: 'card' }, 'よみこみちゅう…'));
  } else if (!link) {
    out.push(...joinCards());
  } else if (!joined || !S) {
    out.push(h('div', { class: 'card' },
      h('p', {}, offline ? 'CPUせんをじゅんびしています…' : netMode === 'p2p' ? (hosting ? `へや「${roomCode}」をじゅんびしています…` : `へや「${roomCode}」にせつぞくしています…`) : 'せつぞくちゅう…'),
      netMode === 'p2p' && h('button', { class: 'sub small', onclick: leaveRoom }, 'やめる'),
    ));
  } else if (S.phase === 'lobby') {
    out.push(
      roleChoiceCard(),
      inviteCard(),
      h('div', { class: 'card' }, h('h2', {}, `プレイヤー（${S.players.filter((p) => p.online).length}にん）`), playerList({ kick: true }), nameRow()),
      settingsCard(),
      rulesCard(),
    );
  } else if (S.phase === 'result' && !resultPanelHidden) {
    const r = S.result || {};
    out.push(
      h('div', { class: 'card' },
        h('div', { class: `banner ${r.winner === 'hiders' ? 'h' : 's'}` }, r.winner === 'hiders' ? '🦎 かくれるがわのかち！' : '👹 おにのかち！'),
        h('p', { style: 'text-align:center' }, r.reason),
        (r.survivors || []).length > 0 && h('p', {}, 'にげきり：', r.survivors.map(nameOf).join('、'), '（+3てん）'),
        S.foundLog.length > 0 && h('div', {},
          h('p', { class: 'muted' }, 'みつかったじゅん'),
          S.foundLog.map((f) => h('p', {}, `⏱ ${Math.floor(f.at / 1000)}びょう　${nameOf(f.by)} → ${nameOf(f.id)}`)),
        ),
        h('button', { class: 'sub', style: 'width:100%;margin-top:8px', onclick: () => { resultPanelHidden = true; renderPanel(); } }, '👀 こたえあわせ（ステージをみてまわる）'),
      ),
      roleChoiceCard(),
      h('div', { class: 'card' }, h('h2', {}, 'とくてん'), playerList({ byScore: true, kick: true }), nameRow()),
      settingsCard(),
      isHost() && h('div', { class: 'card' }, h('button', { class: 'sub', onclick: () => send({ t: 'abort' }) }, 'ロビーにもどる'), ' ',
        h('button', { class: 'sub', onclick: () => confirm('ぜんいんのとくてんを0にしますか？') && send({ t: 'resetScores' }) }, 'とくてんリセット')),
    );
  } else if (menuOpen) {
    out.push(
      h('div', { class: 'card' },
        h('h2', {}, 'メニュー'),
        playerList(),
        isHost() && h('div', { class: 'row', style: 'margin-top:10px;flex-wrap:wrap' },
          S.phase === 'prep' && h('button', { class: 'sub', onclick: () => send({ t: 'skip' }) }, 'じゅんびをおわらせる'),
          h('button', { class: 'danger', onclick: () => confirm('このラウンドをちゅうししますか？') && send({ t: 'abort' }) }, 'ラウンドちゅうし'),
        ),
        h('button', { style: 'width:100%;margin-top:10px', onclick: () => { menuOpen = false; renderPanel(); } }, 'とじる'),
      ),
    );
  }
  el.replaceChildren(...(out.length ? [h('div', { class: 'stack' }, out.filter(Boolean))] : []));
  renderMenuButton();
}

function joinCards() {
  const nameInput = h('input', { type: 'text', placeholder: 'ニックネーム（なしでもOK）', maxlength: 12, value: store.get('name') || '' });
  const takeName = () => {
    const name = nameInput.value.trim() || defaultName();
    store.set('name', name);
    beep(660, 0.08);
    return true;
  };
  const title = h('div', { class: 'card title' },
    h('div', { class: 'logo' }, '🦎'),
    h('h1', {}, 'めっちゃカイトオン'),
    h('p', { class: 'muted' }, 'からだにえをかいてはいけいにとけこむ、おえかきかくれんぼ。PC・スマホのブラウザでたいせん！'),
  );
  const cpuCard = h('div', { class: 'card' },
    h('button', { style: 'width:100%;font-size:18px;padding:14px', onclick: () => takeName() && connect('cpu') }, '🤖 CPUとすぐあそぶ'),
    h('p', { class: 'muted' }, 'へやをつくらずに、このままCPUとたいせんします（ステージやCPUのつよさはけっかがめんでかえられます）'),
  );
  if (netMode === 'server') {
    const go = () => takeName() && connect();
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && go());
    return [title, cpuCard, h('div', { class: 'card' }, h('h2', {}, 'みんなであそぶ'), h('div', { class: 'row' }, nameInput, h('button', { onclick: go }, 'はじめる'))), rulesCard()];
  }
  const urlCode = normalizeCode(new URLSearchParams(location.search).get('room'));
  const codeInput = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder: 'へやばんごう（4けたのすうじ）', maxlength: 4, value: urlCode, style: 'letter-spacing:.2em;font-weight:800' });
  const join = () => {
    const code = normalizeCode(codeInput.value);
    if (code.length !== 4) return toast('へやばんごう（4けたのすうじ）をいれてね');
    if (takeName()) connect('join', code);
  };
  const host = () => takeName() && connect('host', makeRoomCode(), true);
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && join());
  const joinCard = h('div', { class: 'card' },
    h('h2', {}, 'へやにはいる'),
    h('div', { class: 'row' }, codeInput, h('button', { onclick: join }, 'はいる')),
  );
  const hostCard = h('div', { class: 'card' },
    h('h2', {}, 'へやをつくる'),
    h('p', { class: 'muted' }, 'あなたがホストになります。できればPCでつくってね（ホストのがめんをとじるとへやがなくなります）'),
    h('button', { class: urlCode ? 'sub' : '', style: 'width:100%', onclick: host }, 'あたらしいへやをつくる'),
  );
  return [
    title,
    h('div', { class: 'card' }, h('h2', {}, 'ニックネーム'), nameInput, h('p', { class: 'muted' }, 'からのままならじどうでなまえがつきます')),
    ...(urlCode ? [joinCard, hostCard, cpuCard] : [cpuCard, hostCard, joinCard]),
    rulesCard(),
  ];
}

function inviteCard() {
  if (offline) {
    return h('div', { class: 'card' },
      h('h2', {}, '🤖 CPUとたいせんちゅう'),
      h('p', { class: 'muted' }, '「おにになる」か「かくれる」をえらぶと、すぐはじまるよ。ステージやCPUのにんずう・つよさは、したのせっていでかえられます。ともだちとあそぶときは「CPUせんをやめる」からへやをつくってね'),
    );
  }
  if (netMode !== 'p2p') {
    return h('div', { class: 'card' },
      h('h2', {}, 'ともだちをよぼう'),
      h('p', { class: 'muted' }, 'おなじWiFiにつないで、ブラウザでこのアドレスをひらいてね'),
      (S.urls.length ? S.urls : [location.origin]).map((u) => h('div', { class: 'url' }, u)),
    );
  }
  const url = S.urls[0] || shareUrl(roomCode);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('URLをコピーしました');
    } catch {
      prompt('このURLをおくってね', url);
    }
  };
  const shareBtn = navigator.share && h('button', { class: 'sub small', onclick: () => navigator.share({ title: 'めっちゃカイトオン', text: `へやばんごう ${roomCode} であそぼう！`, url }).catch(() => {}) }, 'きょうゆう');
  return h('div', { class: 'card' },
    h('h2', {}, 'ともだちをよぼう'),
    h('p', {}, 'へやばんごう：', h('span', { class: 'url', style: 'font-size:30px;letter-spacing:.2em' }, roomCode)),
    h('p', { class: 'muted' }, 'このURLをおくるか、へやばんごうをにゅうりょくしてもらってね。ひとりでもCPUとあそべます'),
    h('div', { class: 'url', style: 'font-size:14px' }, url),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'sub small', onclick: copy }, 'URLをコピー'),
      shareBtn,
    ),
    hosting && h('p', { class: 'muted' }, '⚠ あなたがホストです。このがめんをとじたり、べつのタブ・アプリにきりかえたままにしないでね'),
  );
}

function nameRow() {
  return h('div', { class: 'row', style: 'margin-top:10px' },
    offline && h('button', { class: 'small sub', onclick: leaveRoom }, 'CPUせんをやめる'),
    !offline && netMode === 'p2p' && h('button', {
      class: 'small sub',
      onclick: () => confirm(hosting ? 'へやをとじますか？（ぜんいんのせつぞくがきれます）' : 'へやをでますか？') && leaveRoom(),
    }, hosting ? 'へやをとじる' : 'へやをでる'),
    h('button', {
      class: 'small sub',
      onclick: () => {
        const n = prompt('あたらしいなまえ', me()?.name || '');
        if (n && n.trim()) {
          store.set('name', n.trim());
          send({ t: 'rename', name: n.trim() });
        }
      },
    }, 'なまえをかえる'),
  );
}

// 右上のメニュー / 結果パネルを戻すボタン
const menuBtn = h('button', { id: 'menuBtn', class: 'sub small', style: 'position:fixed;left:10px;top:10px;z-index:7' }, '☰ メニュー');
document.body.append(menuBtn);
menuBtn.addEventListener('click', () => {
  if (S?.phase === 'result') resultPanelHidden = false;
  else menuOpen = !menuOpen;
  renderPanel();
});
function renderMenuButton() {
  const show = joined && S && (S.phase === 'prep' || S.phase === 'hunt' || (S.phase === 'result' && resultPanelHidden));
  menuBtn.classList.toggle('hidden', !show);
  menuBtn.textContent = S?.phase === 'result' ? '📋 けっかをみる' : '☰ メニュー';
}

// ===========================================================================

renderPanel();
requestAnimationFrame(step);

(async () => {
  netMode = (await detectServer()) ? 'server' : 'p2p';
  const name = store.get('name');
  if (sess.get('room') === 'cpu') {
    // CPU 戦の途中で再読み込みした
    if (!name) store.set('name', defaultName());
    connect('cpu');
  } else if (netMode === 'server') {
    if (store.get('id')) {
      if (!name) store.set('name', defaultName());
      connect();
    }
  } else {
    // 再読み込みしたときは同じ部屋に戻る
    const code = sess.get('room');
    const urlCode = normalizeCode(new URLSearchParams(location.search).get('room'));
    if (code && (!urlCode || urlCode === code)) {
      if (!name) store.set('name', defaultName());
      connect(sess.get('hosting') ? 'host' : 'join', code);
    }
  }
  renderPanel();
})();

// テスト・デバッグ用
window.__mc = { get S() { return S; }, self, chars, orbit, free, setTool, setHiderMode, shoot, get viewMode() { return viewMode; } };
