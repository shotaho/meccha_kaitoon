// 外のステージの空（グラデーション＋流れる雲）。
// 空が一色だと体を空色にぬるだけで消えられてしまうので、模様をつけてゆっくり動かす。

import * as THREE from 'three';
import { rng } from './textures.js';

const STYLES = {
  burger: { top: '#2f7fd6', mid: '#8cc8f2', bottom: '#eef7ff', cloud: ['#ffffff'], shape: 'puff' },
  candy: { top: '#b98cf0', mid: '#ffc4e4', bottom: '#fff1f8', cloud: ['#ffffff', '#ffd1ea', '#ffb3dc'], shape: 'puff' },
  blocks: { top: '#5d8ff2', mid: '#93bbff', bottom: '#d8e6ff', cloud: ['#ffffff'], shape: 'block' },
  sea: { top: '#bff3ff', mid: '#3d9fd0', bottom: '#14527e', cloud: ['#e8fbff'], shape: 'wave' },
  city: { top: '#3a86d8', mid: '#9cd0f5', bottom: '#f2f8ff', cloud: ['#ffffff', '#f1f3f5'], shape: 'puff' },
  island: { top: '#1f8fe0', mid: '#7fd0ff', bottom: '#e9fbff', cloud: ['#ffffff'], shape: 'puff' },
  sado: { top: '#3f7fc8', mid: '#a6cdea', bottom: '#eef4f8', cloud: ['#ffffff', '#eef1f4'], shape: 'puff' },
  space: { top: '#03040c', mid: '#0b0d24', bottom: '#14163a', cloud: ['#ffffff'], shape: 'stars' },
};

const DOME_R = 120;

function skyTexture(st, seed) {
  const block = st.shape === 'block';
  const W = block ? 256 : 1024;
  const H = W / 2;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const r = rng(seed);
  const grad = g.createLinearGradient(0, 0, 0, H / 2);
  grad.addColorStop(0, st.top);
  grad.addColorStop(0.6, st.mid);
  grad.addColorStop(1, st.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = st.bottom;
  g.fillRect(0, H / 2, W, H / 2);

  const wrap = (fn) => {
    for (const dx of [-W, 0, W]) fn(dx);
  };
  if (st.shape === 'stars') {
    // ほしと、もやもやの星雲
    g.fillStyle = st.mid;
    g.fillRect(0, H / 2, W, H / 2);
    for (const col of ['#5b2a86', '#1f4e8c', '#8c2a5b', '#2a7f86']) {
      for (let i = 0; i < 3; i++) {
        const x = r() * W;
        const y = r() * H;
        const rad = 60 + r() * 140;
        wrap((dx) => {
          const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
          gr.addColorStop(0, col + 'aa');
          gr.addColorStop(1, col + '00');
          g.fillStyle = gr;
          g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
        });
      }
    }
    for (let i = 0; i < 1400; i++) {
      const big = r() < 0.06;
      g.fillStyle = ['#ffffff', '#ffe9a8', '#bcd7ff'][Math.floor(r() * 3)];
      g.globalAlpha = 0.5 + r() * 0.5;
      const sz = big ? 2.5 : 1.2;
      g.fillRect(r() * W, r() * H, sz, sz);
    }
    g.globalAlpha = 1;
  } else if (st.shape === 'wave') {
    // 水面のゆらゆら（上のほうに明るい網目）
    g.globalAlpha = 0.45;
    g.strokeStyle = st.cloud[0];
    for (let i = 0; i < 260; i++) {
      const x = r() * W;
      const y = Math.pow(r(), 1.6) * H * 0.42;
      const s = (8 + r() * 26) * (1 - y / (H * 0.5));
      g.lineWidth = 1 + r() * 2.5;
      wrap((dx) => {
        g.beginPath();
        g.ellipse(x + dx, y, s, s * 0.45, r() * 0.4, 0, Math.PI * 2);
        g.stroke();
      });
    }
    g.globalAlpha = 1;
  } else if (block) {
    // マイクラ風の四角い雲
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(r() * W);
      const y = Math.floor(H * (0.08 + r() * 0.36));
      const w = 6 + Math.floor(r() * 22);
      const h = 2 + Math.floor(r() * 5);
      g.fillStyle = st.cloud[0];
      g.globalAlpha = 0.85 + r() * 0.15;
      wrap((dx) => {
        g.fillRect(x + dx, y, w, h);
        g.fillRect(x + dx + 2, y - 2, w - 6, 2);
      });
    }
    g.globalAlpha = 1;
  } else {
    // ふわふわ雲（丸を重ねる）
    for (let i = 0; i < 34; i++) {
      const cx = r() * W;
      const cy = H * (0.06 + r() * 0.4);
      const sc = (0.5 + r()) * (0.4 + (cy / H) * 1.4);
      const col = st.cloud[Math.floor(r() * st.cloud.length)];
      const n = 5 + Math.floor(r() * 7);
      const blobs = [];
      for (let j = 0; j < n; j++) blobs.push([(r() - 0.5) * 90 * sc, (r() - 0.6) * 18 * sc, (12 + r() * 22) * sc]);
      wrap((dx) => {
        for (const [bx, by, br] of blobs) {
          const gr = g.createRadialGradient(cx + dx + bx, cy + by, br * 0.2, cx + dx + bx, cy + by, br);
          gr.addColorStop(0, col);
          gr.addColorStop(0.7, col);
          gr.addColorStop(1, col + '00');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(cx + dx + bx, cy + by, br, 0, Math.PI * 2);
          g.fill();
        }
      });
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  if (block) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
  }
  return t;
}

// ステージのまわりに浮かぶ立体の雲
function cloud3d(st, r) {
  const grp = new THREE.Group();
  const col = st.cloud[Math.floor(r() * st.cloud.length)];
  const m = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, fog: false });
  if (st.shape === 'block') {
    const w = 4 + Math.floor(r() * 6);
    const d = 3 + Math.floor(r() * 4);
    for (let i = 0; i < 3; i++) {
      const bw = w - i * 1.5 * r();
      const bd = d - i * r();
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, 1, bd), m);
      b.position.set((r() - 0.5) * 2, i * 0.8, (r() - 0.5) * 2);
      grp.add(b);
    }
  } else {
    const n = 5 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const s = 1.2 + r() * 1.6;
      const b = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), m);
      b.position.set((r() - 0.5) * 6, (r() - 0.3) * 1.2, (r() - 0.5) * 3);
      b.scale.y = 0.75;
      grp.add(b);
    }
  }
  return grp;
}

/** 空をつくる。対応していないステージなら null */
export function buildSky(group, mapId, bounds) {
  const st = STYLES[mapId];
  if (!st) return null;
  const seed = [...mapId].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  const r = rng(seed + 11);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_R, 48, 24),
    new THREE.MeshBasicMaterial({ map: skyTexture(st, seed), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -10;
  group.add(dome);

  const clouds = new THREE.Group();
  if (st.shape !== 'wave' && st.shape !== 'stars') {
    const reach = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2;
    for (let i = 0; i < 12; i++) {
      const c = cloud3d(st, r);
      const a = (i / 12) * Math.PI * 2 + r() * 0.4;
      const d = reach + 6 + r() * 26;
      c.position.set(Math.cos(a) * d, bounds.h + 1 + r() * 10, Math.sin(a) * d);
      c.rotation.y = r() * Math.PI;
      clouds.add(c);
    }
  }
  group.add(clouds);

  // 時計で回すので、みんなの画面でだいたい同じ空になる
  const spinDome = st.shape === 'wave' ? 0.012 : 0.008;
  const spinClouds = 0.02;
  return {
    update() {
      const t = Date.now() / 1000;
      dome.rotation.y = (t * spinDome) % (Math.PI * 2);
      clouds.rotation.y = (t * spinClouds) % (Math.PI * 2);
    },
  };
}
