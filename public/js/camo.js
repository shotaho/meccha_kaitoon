// CPU の擬態ペイント。
// 隠れ場所の「正面の視点」から背景を描画し、その画像を体の三角形ごとにテクスチャへ貼り付ける。
// （その視点から見ると背景と同じ模様になる。横や斜めから見るとズレて見える）

import * as THREE from 'three';

const targets = new Map();

function renderTarget(size) {
  let rt = targets.get(size);
  if (!rt) {
    rt = new THREE.WebGLRenderTarget(size, size);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    targets.set(size, rt);
  }
  return rt;
}

// 画面外のカメラで描画して RGBA を読む（上下は WebGL のまま＝下から上）
export function renderPixels(renderer, scene, cam, size) {
  const rt = renderTarget(size);
  const buf = new Uint8Array(size * size * 4);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  renderer.setRenderTarget(prev);
  return buf;
}

function toCanvas(buf, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
  }
  g.putImageData(img, 0, 0);
  return c;
}

const LEVEL = {
  easy: { size: 64, blotches: 9, jitter: 0.28 },
  normal: { size: 128, blotches: 4, jitter: 0.14 },
  hard: { size: 256, blotches: 0, jitter: 0 },
};

/**
 * @param hideAll (hidden: boolean) => void  キャラクターなどを一時的に隠す
 */
export function paintCamo(renderer, scene, char, viewPos, level, hideAll) {
  const L = LEVEL[level] || LEVEL.normal;
  char.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const m of char.parts) box.expandByObject(m);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const view = new THREE.Vector3(...viewPos);
  const dist = Math.max(0.5, view.distanceTo(center));
  const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((Math.max(size.x, size.y, size.z) * 0.8) / dist)), 8, 80);
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.05, 300);
  cam.position.copy(view);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);

  const S = L.size;
  hideAll(true);
  const buf = renderPixels(renderer, scene, cam, S);
  hideAll(false);
  const sample = toCanvas(buf, S);

  const v = new THREE.Vector3();
  for (let pi = 0; pi < char.parts.length; pi++) {
    const mesh = char.parts[pi];
    const pt = char.paint[pi];
    if (!pt) continue;
    const g = pt.ctx;
    const T = pt.size;
    g.imageSmoothingEnabled = false;
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    const idx = mesh.geometry.index;
    const n = pos.count;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(cam);
      ok[i] = v.z < 1 ? 1 : 0;
      sx[i] = ((v.x + 1) / 2) * S;
      sy[i] = ((1 - v.y) / 2) * S;
    }
    // 下地は中央付近の色
    const mid = buf.subarray(((S >> 1) * S + (S >> 1)) * 4);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = `rgb(${mid[0]},${mid[1]},${mid[2]})`;
    g.fillRect(0, 0, T, T);

    const tri = idx ? idx.count / 3 : n / 3;
    for (let t = 0; t < tri; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      if (!(ok[a] && ok[b] && ok[c])) continue;
      const dx0 = uv.getX(a) * T, dy0 = (1 - uv.getY(a)) * T;
      const dx1 = uv.getX(b) * T, dy1 = (1 - uv.getY(b)) * T;
      const dx2 = uv.getX(c) * T, dy2 = (1 - uv.getY(c)) * T;
      const darea = Math.abs((dx1 - dx0) * (dy2 - dy0) - (dx2 - dx0) * (dy1 - dy0));
      if (darea < 0.05) continue;
      const ux1 = sx[b] - sx[a], uy1 = sy[b] - sy[a];
      const ux2 = sx[c] - sx[a], uy2 = sy[c] - sy[a];
      const det = ux1 * uy2 - ux2 * uy1;
      // 三角形を少し広げてすき間を防ぐ
      const cx = (dx0 + dx1 + dx2) / 3;
      const cy = (dy0 + dy1 + dy2) / 3;
      const grow = (x, y) => {
        const ex = x - cx;
        const ey = y - cy;
        const l = Math.hypot(ex, ey) || 1;
        return [x + (ex / l) * 0.9, y + (ey / l) * 0.9];
      };
      g.save();
      g.beginPath();
      g.moveTo(...grow(dx0, dy0));
      g.lineTo(...grow(dx1, dy1));
      g.lineTo(...grow(dx2, dy2));
      g.closePath();
      g.clip();
      if (Math.abs(det) < 1e-3) {
        // 真横を向いている三角形：一点の色で塗る
        const px = Math.max(0, Math.min(S - 1, Math.round((sx[a] + sx[b] + sx[c]) / 3)));
        const py = Math.max(0, Math.min(S - 1, Math.round((sy[a] + sy[b] + sy[c]) / 3)));
        const o = ((S - 1 - py) * S + px) * 4;
        g.fillStyle = `rgb(${buf[o]},${buf[o + 1]},${buf[o + 2]})`;
        g.fill();
      } else {
        const ex1 = dx1 - dx0, ey1 = dy1 - dy0;
        const ex2 = dx2 - dx0, ey2 = dy2 - dy0;
        const A = (ex1 * uy2 - ex2 * uy1) / det;
        const C = (ex2 * ux1 - ex1 * ux2) / det;
        const B = (ey1 * uy2 - ey2 * uy1) / det;
        const D = (ey2 * ux1 - ey1 * ux2) / det;
        const E = dx0 - A * sx[a] - C * sy[a];
        const F = dy0 - B * sx[a] - D * sy[a];
        g.setTransform(A, B, C, D, E, F);
        g.drawImage(sample, 0, 0);
      }
      g.restore();
    }

    // 弱い CPU ほど塗りムラがある
    for (let k = 0; k < L.blotches; k++) {
      const x = Math.random() * T;
      const y = Math.random() * T;
      const d = g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      const f = 1 + (Math.random() - 0.5) * 2 * L.jitter;
      g.fillStyle = `rgb(${Math.min(255, d[0] * f) | 0},${Math.min(255, d[1] * f) | 0},${Math.min(255, d[2] * f) | 0})`;
      g.beginPath();
      g.arc(x, y, T * (0.05 + Math.random() * 0.08), 0, Math.PI * 2);
      g.fill();
    }
    char.dirty.add(pi);
  }
}
