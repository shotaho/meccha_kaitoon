// ステージ（リビング＋キッチン＋倉庫っぽい部屋）を組み立てる

import * as THREE from 'three';
import { tex } from './textures.js';

export const ROOM = { x0: -12, x1: 12, z0: -8, z1: 8, h: 5 };

const FACE_DIRS = ['+x', '-x', '+y', '-y', '+z', '-z'];

export function buildWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const meshes = [];

  function mat(name, rx = 1, ry = 1, color) {
    if (!name) return new THREE.MeshLambertMaterial({ color: color || '#cccccc' });
    return new THREE.MeshLambertMaterial({ map: tex(name, rx, ry), color: color || '#ffffff' });
  }

  // 面ごとのワールドサイズから、テクスチャの繰り返し回数を決める
  function faceSize(dir, sx, sy, sz) {
    if (dir === '+x' || dir === '-x') return [sz, sy];
    if (dir === '+y' || dir === '-y') return [sx, sz];
    return [sx, sy];
  }

  /**
   * 箱を置く。spec = { tex, tile, faces: { '+x': {tex, stretch}, ... }, color }
   */
  function box(x0, x1, y0, y1, z0, z1, spec = {}, collide = true) {
    const sx = x1 - x0;
    const sy = y1 - y0;
    const sz = z1 - z0;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mats = FACE_DIRS.map((d) => {
      const f = (spec.faces && spec.faces[d]) || spec;
      const [w, h] = faceSize(d, sx, sy, sz);
      if (f.stretch) return mat(f.tex, 1, 1, f.color);
      const tile = f.tile || spec.tile || 1;
      const [tw, th] = Array.isArray(tile) ? tile : [tile, tile];
      return mat(f.tex, w / tw, h / th, f.color);
    });
    const m = new THREE.Mesh(geo, mats);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    group.add(m);
    meshes.push(m);
    if (collide) colliders.push({ x0, x1, y0, y1, z0, z1 });
    return m;
  }

  // 壁に貼る板（ポスターや絵）。normal は '+x' など、貼る面の向き
  function plate(cx, cy, cz, w, h, normal, texName, depth = 0.04) {
    let x0, x1, z0, z1;
    if (normal === '+z' || normal === '-z') {
      x0 = cx - w / 2;
      x1 = cx + w / 2;
      z0 = cz - depth / 2;
      z1 = cz + depth / 2;
    } else {
      z0 = cz - w / 2;
      z1 = cz + w / 2;
      x0 = cx - depth / 2;
      x1 = cx + depth / 2;
    }
    return box(x0, x1, cy - h / 2, cy + h / 2, z0, z1, {
      tex: 'wood',
      tile: 0.5,
      color: '#5a3a20',
      faces: { [normal]: { tex: texName, stretch: true } },
    }, false);
  }

  const { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H } = ROOM;
  const T = 0.5;

  // 床・天井
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'woodFloor', tile: 2.4 }, false);
  box(X0 - T, X1 + T, H, H + T, Z0 - T, Z1 + T, { tex: 'ceiling', tile: 1.2 }, false);

  // 壁
  box(X0 - T, X1 + T, 0, H, Z0 - T, Z0, { tex: 'brick', tile: 2 }); // 北：レンガ
  box(X0 - T, X1 + T, 0, 1.2, Z1, Z1 + T, { tex: 'wainscot', tile: [2.4, 1.2] }); // 南：腰板
  box(X0 - T, X1 + T, 1.2, H, Z1, Z1 + T, { tex: 'wallpaper', tile: 0.9 }); // 南：花柄
  box(X0 - T, X0, 0, H, Z0, Z1, { tex: 'stripes', tile: 1.2 }); // 西：ストライプ
  box(X1, X1 + T, 0, H, Z0, Z1, { tex: 'concrete', tile: 2.4 }); // 東：コンクリ

  // 本棚（西）
  box(-12, -11.4, 0, 3, -6, 0, {
    tex: 'wood', tile: 0.8,
    faces: { '+x': { tex: 'books', stretch: true } },
  });

  // ロッカー（西・南寄り）
  box(-12, -11.3, 0, 2.5, 2, 5, {
    tex: 'lockers', tile: 1, color: '#dddddd',
    faces: { '+x': { tex: 'lockers', stretch: true } },
  });

  // ソファ（南）
  const sofa = { tex: 'plaid', tile: 0.6 };
  box(-4, 0, 0, 0.5, 6.5, 8, sofa);
  box(-4, 0, 0.5, 1.25, 7.45, 8, sofa);
  box(-4.45, -4, 0, 0.85, 6.5, 8, sofa);
  box(0, 0.45, 0, 0.85, 6.5, 8, sofa);

  // ソファ上の絵
  plate(-2, 2.6, Z1 - 0.03, 3.2, 2, '-z', 'art');

  // ローテーブル
  box(-3.2, -0.8, 0, 0.5, 4, 5.1, { tex: 'wood', tile: 0.6, color: '#7a5a40' });

  // ラグ
  box(-6.5, 2.5, 0, 0.02, -2.5, 3.5, {
    tex: 'wood', color: '#7d1f2b',
    faces: { '+y': { tex: 'rug', stretch: true } },
  }, false);

  // キッチンカウンター（北）
  box(1, 8, 0, 1, -8, -7.3, {
    tex: 'tiles', tile: 0.6,
    faces: { '+y': { tex: 'marble', tile: 0.8 } },
  });
  // 吊り戸棚
  box(1, 8, 2.2, 3.2, -8, -7.55, {
    tex: 'cabinet', tile: 1, color: '#eeeeee',
    faces: { '+z': { tex: 'cabinet', tile: 1.75 } },
  });
  // 冷蔵庫
  box(8.3, 9.6, 0, 2.3, -8, -7, {
    tex: 'fridge', tile: 1, color: '#dddddd',
    faces: { '+z': { tex: 'fridge', stretch: true } },
  });

  // 窓とカーテン（北）
  plate(-6, 2.6, Z0 + 0.03, 3, 2.2, '+z', 'window');
  box(-8.1, -7.3, 0.6, 4.2, Z0, Z0 + 0.25, { tex: 'curtain', tile: 0.5 });
  box(-4.7, -3.9, 0.6, 4.2, Z0, Z0 + 0.25, { tex: 'curtain', tile: 0.5 });
  // 時計
  plate(-1.2, 3.6, Z0 + 0.03, 0.9, 0.9, '+z', 'clock');

  // 東の壁：自販機とポスター
  box(11.1, 12, 0, 2.4, -0.2, 1.4, {
    tex: 'wood', color: '#b71c2f',
    faces: { '-x': { tex: 'vending', stretch: true } },
  });
  plate(X1 - 0.03, 2.2, -5.5, 1.2, 1.7, '-x', 'poster1');
  plate(X1 - 0.03, 2.2, -3.6, 1.2, 1.7, '-x', 'poster2');
  plate(X1 - 0.03, 2.2, 4, 1.2, 1.7, '-x', 'poster3');

  // 木箱（南東）
  const crate = { tex: 'crate', tile: 1 };
  box(8.5, 9.5, 0, 1, 6.9, 7.9, crate);
  box(9.6, 10.6, 0, 1, 6.9, 7.9, crate);
  box(10.7, 11.7, 0, 1, 6.9, 7.9, crate);
  box(10.7, 11.7, 0, 1, 5.8, 6.8, crate);
  box(9.6, 10.6, 1, 2, 6.9, 7.9, crate);
  box(10.7, 11.7, 1, 2, 6.9, 7.9, crate);

  // 段ボール（東）
  const card = { tex: 'cardboard', tile: 0.8 };
  box(10.9, 11.7, 0, 0.8, -2.6, -1.8, card);
  box(10.9, 11.7, 0, 0.8, -1.7, -0.9, card);
  box(10.9, 11.7, 0.8, 1.6, -2.3, -1.5, card);

  // 柱（キャンディ柄）
  box(4, 5, 0, H, 1, 2, { tex: 'candy', tile: 1 });

  // 観葉植物
  function plant(x, z, s = 1) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35 * s, 0.26 * s, 0.6 * s, 14),
      mat('terracotta', 2, 1),
    );
    pot.position.set(x, 0.3 * s, z);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75 * s, 1), mat('leaves', 2, 2));
    leaf.position.set(x, 1.25 * s, z);
    leaf.scale.y = 1.2;
    group.add(pot, leaf);
    meshes.push(pot, leaf);
    colliders.push({ x0: x - 0.4 * s, x1: x + 0.4 * s, y0: 0, y1: 0.6 * s, z0: z - 0.4 * s, z1: z + 0.4 * s });
    colliders.push({ x0: x - 0.6 * s, x1: x + 0.6 * s, y0: 0.6 * s, y1: 2.1 * s, z0: z - 0.6 * s, z1: z + 0.6 * s });
  }
  plant(-11, 7, 1);
  plant(1.2, 7.2, 0.8);
  plant(10.8, -6.6, 1.1);
  plant(-11, -7, 0.9);

  // フロアランプ
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 8), mat(null, 1, 1, '#333333'));
  pole.position.set(-5.2, 0.85, 7.3);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 0.5, 16, 1, true), mat('lampshade', 3, 1));
  shade.material.side = THREE.DoubleSide;
  shade.position.set(-5.2, 1.85, 7.3);
  group.add(pole, shade);
  meshes.push(pole, shade);
  colliders.push({ x0: -5.6, x1: -4.8, y0: 0, y1: 2.1, z0: 6.9, z1: 7.7 });

  // ライト
  scene.add(new THREE.HemisphereLight('#ffffff', '#b59a7a', 1.6));
  const sun = new THREE.DirectionalLight('#fff6e6', 1.6);
  sun.position.set(6, 10, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.6);
  fill.position.set(-8, 6, -6);
  scene.add(fill);

  return { group, meshes, colliders };
}

// ---------------------------------------------------------------------------
// 当たり判定（円柱 vs 箱）
// ---------------------------------------------------------------------------

export function overlapsXZ(c, x, z, r) {
  const nx = Math.max(c.x0, Math.min(x, c.x1));
  const nz = Math.max(c.z0, Math.min(z, c.z1));
  const dx = x - nx;
  const dz = z - nz;
  return dx * dx + dz * dz < r * r;
}

// 水平方向の押し出し。pos は THREE.Vector3（足元）
export function collide(colliders, pos, r, h) {
  for (let iter = 0; iter < 3; iter++) {
    for (const c of colliders) {
      if (pos.y >= c.y1 - 0.001 || pos.y + h <= c.y0) continue;
      if (!overlapsXZ(c, pos.x, pos.z, r)) continue;
      const nx = Math.max(c.x0, Math.min(pos.x, c.x1));
      const nz = Math.max(c.z0, Math.min(pos.z, c.z1));
      let dx = pos.x - nx;
      let dz = pos.z - nz;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        pos.x = nx + (dx / d) * r;
        pos.z = nz + (dz / d) * r;
      } else {
        // 中心が箱の中：一番近い面へ
        const opts = [
          [c.x0 - r - pos.x, 0],
          [c.x1 + r - pos.x, 0],
          [0, c.z0 - r - pos.z],
          [0, c.z1 + r - pos.z],
        ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        pos.x += opts[0][0];
        pos.z += opts[0][1];
      }
    }
  }
  const m = r + 0.02;
  pos.x = Math.max(ROOM.x0 + m, Math.min(ROOM.x1 - m, pos.x));
  pos.z = Math.max(ROOM.z0 + m, Math.min(ROOM.z1 - m, pos.z));
}

// 足元の床の高さ（step 以内の段差は乗れる）
export function groundAt(colliders, x, z, footY, r, step) {
  let g = 0;
  for (const c of colliders) {
    if (c.y1 > footY + step) continue;
    if (c.y1 <= g) continue;
    if (overlapsXZ(c, x, z, r * 0.7)) g = c.y1;
  }
  return g;
}

// 頭上の天井（これ以上は上がれない）
export function ceilingAt(colliders, x, z, footY, r, h) {
  let top = ROOM.h - h;
  for (const c of colliders) {
    if (c.y0 < footY + h - 0.001) continue;
    if (overlapsXZ(c, x, z, r * 0.7)) top = Math.min(top, c.y0 - h);
  }
  return top;
}
