// ステージを組み立てる。ステージの種類は maps.js（共通データ）と対応する。

import * as THREE from 'three';
import { tex } from './textures.js';
import { MAPS, genBlocks, BLOCKS } from './maps.js';
import { blockMaterials } from './blocktex.js';

const FACE_DIRS = ['+x', '-x', '+y', '-y', '+z', '-z'];

export function buildWorld(scene, mapId) {
  const def = MAPS[mapId] || MAPS.house;
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const meshes = [];
  const bounds = def.bounds;

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

  function add(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  // 観葉植物・木（s で大きさ、trunk で幹を伸ばす）
  function plant(x, z, s = 1, trunk = 0) {
    if (trunk) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.24 * s, trunk, 10), mat('wood', 1, 2, '#7a5230')), x, trunk / 2, z);
    } else {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.26 * s, 0.6 * s, 14), mat('terracotta', 2, 1)), x, 0.3 * s, z);
    }
    const base = trunk || 0.6 * s;
    const leaf = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.75 * s, 1), mat('leaves', 2, 2)), x, base + 0.65 * s, z);
    leaf.scale.y = 1.2;
    colliders.push({ x0: x - 0.4 * s, x1: x + 0.4 * s, y0: 0, y1: base, z0: z - 0.4 * s, z1: z + 0.4 * s });
    colliders.push({ x0: x - 0.6 * s, x1: x + 0.6 * s, y0: base, y1: base + 1.5 * s, z0: z - 0.6 * s, z1: z + 0.6 * s });
  }

  function lights(sky, ground, hemi, sunI) {
    group.add(new THREE.HemisphereLight(sky, ground, hemi));
    const sun = new THREE.DirectionalLight('#fff6e6', sunI);
    sun.position.set(6, 10, 4);
    group.add(sun);
  }

  const kit = { group, box, plate, plant, add, mat, lights, colliders, meshes, bounds };
  if (mapId === 'burger') buildBurger(kit);
  else if (mapId === 'blocks') buildBlocks(kit);
  else buildHouse(kit);

  const background = new THREE.Color(def.outdoor ? '#9fd3f5' : '#222222');
  scene.background = background;

  return {
    id: MAPS[mapId] ? mapId : 'house',
    group,
    meshes,
    colliders,
    bounds,
    dispose() {
      group.removeFromParent();
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// おうち（リビング＋キッチン＋倉庫っぽい部屋）
// ---------------------------------------------------------------------------

function buildHouse(k) {
  const { box, plate, plant, mat, colliders } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H } = k.bounds;
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
  plant(-11, 7, 1);
  plant(1.2, 7.2, 0.8);
  plant(10.8, -6.6, 1.1);
  plant(-11, -7, 0.9);

  // フロアランプ
  k.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 8), mat(null, 1, 1, '#333333')), -5.2, 0.85, 7.3);
  const shade = k.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 0.5, 16, 1, true), mat('lampshade', 3, 1)), -5.2, 1.85, 7.3);
  shade.material.side = THREE.DoubleSide;
  colliders.push({ x0: -5.6, x1: -4.8, y0: 0, y1: 2.1, z0: 6.9, z1: 7.7 });


  k.lights('#ffffff', '#b59a7a', 1.6, 1.6);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.6);
  fill.position.set(-8, 6, -6);
  k.group.add(fill);
}

// ---------------------------------------------------------------------------
// ハンバーガーショップ（店内＋ドライブスルー＋駐車場）
// ---------------------------------------------------------------------------

function buildBurger(k) {
  const { box, plate, plant, add, mat } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = k.bounds;
  const T = 0.5;
  const H = 4.5;

  // 地面（アスファルト）と駐車場
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'asphalt', tile: 4 }, false);
  box(-17, 2.6, 0, 0.012, 4, 12, { tex: 'parking', tile: [2.6, 5] }, false);
  for (const z of [7, -8]) {
    box(6.4, 7.6, 0, 0.012, z - 1.2, z + 1.2, { tex: 'asphalt', faces: { '+y': { tex: 'laneArrow', stretch: true } } }, false);
  }

  // 建物の外壁（外はレンガ、中は黄色と赤）
  const outer = { tex: 'redBrick', tile: 2 };
  const inner = { tex: 'wallBand', tile: [2, H] };
  box(-14, 4, 0, H, -11, -10.7, { ...outer, faces: { '+z': inner } }); // 北
  box(-14, -13.7, 0, H, -10.7, 0.7, { ...outer, faces: { '+x': inner } }); // 西
  box(-14, -6, 0, H, 0.7, 1, { ...outer, faces: { '-z': inner } }); // 南（入口の左）
  box(-3, 4, 0, H, 0.7, 1, { ...outer, faces: { '-z': inner } }); // 南（入口の右）
  box(-6, -3, 2.7, H, 0.7, 1, { ...outer, faces: { '-z': inner } }); // 入口の上
  box(3.7, 4, 0, H, -10.7, -6, { ...outer, faces: { '-x': inner } }); // 東
  box(3.7, 4, 0, H, -4.5, 0.7, { ...outer, faces: { '-x': inner } });
  box(3.7, 4, 0, 1, -6, -4.5, { ...outer, faces: { '-x': inner } }); // 受け渡し窓の下
  box(3.7, 4, 2.2, H, -6, -4.5, { ...outer, faces: { '-x': inner } }); // 受け渡し窓の上
  // 屋根
  box(-14.3, 4.3, H, H + 0.6, -11.3, 1.3, { tex: 'yellowWall', tile: 1.5, faces: { '-y': { tex: 'ceiling', tile: 1.2 }, '+y': { tex: 'concrete', tile: 3 } } }, false);
  // 入口のひさし・窓
  box(-6.6, -2.4, 2.8, 3.05, 1, 2.1, { tex: 'awning', tile: 0.6 }, false);
  for (const x of [-11, -8.4, -0.4, 2.2]) plate(x, 1.9, 1.03, 2.2, 1.5, '+z', 'shopWindow');
  plate(-6.5, 3.6, 1.03, 3.4, 1.2, '+z', 'signBurger');

  // 店内の床
  box(-13.7, 3.7, 0, 0.02, -10.7, 0.7, { tex: 'checker', tile: 1.2 }, false);

  // カウンター・レジ・メニューボード
  box(-12, -1, 0, 1.1, -8, -7.2, { tex: 'counterFront', tile: [2, 1.1], faces: { '+y': { tex: 'stainless', tile: 1 } } });
  for (const x of [-9, -6, -3]) box(x - 0.25, x + 0.25, 1.1, 1.45, -7.75, -7.4, { tex: 'register', stretch: true }, false);
  plate(-6.5, 3.3, -10.67, 9, 1.7, '+z', 'menuBoard');

  // キッチン
  box(-13.7, -11.5, 0, 1, -10.7, -9.8, { tex: 'stainless', tile: 1 });
  box(-9, -6, 0, 0.95, -10.7, -9.8, { tex: 'stainless', tile: 1, faces: { '+y': { tex: 'grill', stretch: true } } });
  box(-5, -2, 0, 2.2, -10.7, -10.1, { tex: 'stainless', tile: 1, faces: { '+z': { tex: 'racks', stretch: true } } });
  box(-1.5, 0, 0, 1.8, -10.7, -9.8, { tex: 'stainless', tile: 1, faces: { '+z': { tex: 'drinkMachine', stretch: true } } });

  // ドライブスルーの受け渡しカウンター
  box(1.5, 3.7, 0, 1.1, -6.5, -4, { tex: 'counterFront', tile: [2, 1.1], faces: { '+y': { tex: 'stainless', tile: 1 } } });

  // テーブル席
  for (const [tx, tz] of [[-11, -4.5], [-8, -4.5], [-11, -1.5], [-8, -1.5]]) {
    box(tx - 0.7, tx + 0.7, 0, 0.75, tz - 0.45, tz + 0.45, { color: '#c8242c' });
    box(tx - 0.7, tx + 0.7, 0, 0.45, tz - 0.95, tz - 0.6, { color: '#f6c533' });
    box(tx - 0.7, tx + 0.7, 0, 0.45, tz + 0.6, tz + 0.95, { color: '#f6c533' });
  }
  // ゴミ箱・ポスター
  box(-1.5, -0.3, 0, 1.1, -1, 0.6, { tex: 'trashBin', tile: [1.2, 1.1], faces: { '+y': { color: '#5b3a20' } } });
  plate(-13.67, 2.4, -4, 1.4, 1.8, '+x', 'posterBurger');
  plate(-13.67, 2.4, -1, 1.4, 1.8, '+x', 'posterFries');
  plate(-10, 2.4, 0.67, 1.4, 1.8, '-z', 'posterDrink');

  // ドライブスルーの道
  box(9.3, 9.5, 0, 0.15, -12, 10, { tex: 'curb', tile: [1, 0.15] });
  box(10, 10.4, 0.7, 2.7, 3, 6, { color: '#2b2b2b', faces: { '-x': { tex: 'driveMenu', stretch: true } } });
  box(10.1, 10.3, 0, 0.7, 3.2, 3.4, { color: '#2b2b2b' });
  box(10.1, 10.3, 0, 0.7, 5.6, 5.8, { color: '#2b2b2b' });
  box(9.6, 9.9, 0, 1.3, 1.3, 1.6, { color: '#3a3a3a' });
  // 高さ制限バー
  box(4.6, 4.8, 0, 3, 9, 9.2, { tex: 'hazard', tile: 0.4 });
  box(9.5, 9.7, 0, 3, 9, 9.2, { tex: 'hazard', tile: 0.4 });
  box(4.6, 9.7, 2.75, 3.0, 9, 9.2, { tex: 'hazard', tile: 0.4 }, false);

  // 車
  function car(x, z, color, along = 'z') {
    const [hx, hz] = along === 'z' ? [0.9, 2.1] : [2.1, 0.9];
    box(x - hx, x + hx, 0.3, 1.1, z - hz, z + hz, { color });
    box(x - hx + 0.1, x + hx - 0.1, 1.1, 1.7, z - hz * 0.55, z + hz * 0.55, { tex: 'glassDark', tile: 1 });
    k.colliders.push({ x0: x - hx, x1: x + hx, y0: 0, y1: 0.3, z0: z - hz, z1: z + hz });
    const tireMat = mat('tire', 2, 1);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 14), tireMat);
        w.rotation.z = Math.PI / 2;
        if (along !== 'z') w.rotation.set(Math.PI / 2, 0, 0);
        add(w, x + sx * (along === 'z' ? hx : hx * 0.7), 0.32, z + sz * (along === 'z' ? hz * 0.7 : hz));
      }
    }
  }
  car(7, -2.1, '#c62828');
  car(-11, 8, '#2a7bd0');
  car(-1.5, 8.5, '#f2f2f2');

  // ポールサイン
  box(15.4, 15.6, 0, 5.5, -3.1, -2.9, { color: '#9aa1a8' });
  box(15.3, 15.7, 5.5, 7.5, -4.5, -1.5, { color: '#c8242c', faces: { '-x': { tex: 'signBurger', stretch: true }, '+x': { tex: 'signBurger', stretch: true } } });

  // 生け垣・植え込み・木・ベンチ・ゴミ箱
  box(-18, 4, 0, 1.2, 13, 14, { tex: 'hedge', tile: 1 });
  box(10, 18, 0, 1.2, 13, 14, { tex: 'hedge', tile: 1 });
  box(-18, -17, 0, 1.2, -14, 13, { tex: 'hedge', tile: 1 });
  plant(-16, 11, 1.4, 1.6);
  plant(12.5, -12.5, 1.4, 1.6);
  plant(16.5, 6, 1.4, 1.6);
  plant(-2.2, 1.7, 0.9);
  box(-1, 2, 0, 0.45, 3, 3.5, { tex: 'wood', tile: 0.6 });
  box(-1, 2, 0.45, 1.0, 3.4, 3.5, { tex: 'wood', tile: 0.6 });
  box(-7.2, -6.6, 0, 1, 1.4, 2.0, { tex: 'trashBin', tile: [0.6, 1] });

  k.lights('#dff1ff', '#8a8f96', 1.7, 1.8);
}

// ---------------------------------------------------------------------------
// ブロックの世界
// ---------------------------------------------------------------------------

function buildBlocks(k) {
  const b = genBlocks();
  const { x0, z0, nx, nz } = BLOCKS;
  const mats = blockMaterials();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const byType = new Map();
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const opaque = (i, y, j) => {
    const t = b.cells.get(`${i},${y},${j}`);
    return t && t !== 'glass' && t !== 'leaves' && t !== 'water';
  };
  for (const [key, t] of b.cells) {
    const [i, y, j] = key.split(',').map(Number);
    // 周りを全部ふさがれているブロックは描かない
    if (dirs.every(([di, dy, dj]) => opaque(i + di, y + dy, j + dj)) && y > 0) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push([i, y, j]);
  }
  const m4 = new THREE.Matrix4();
  for (const [t, list] of byType) {
    const im = new THREE.InstancedMesh(geo, mats[t] || mats.stone, list.length);
    list.forEach(([i, y, j], n) => {
      m4.makeTranslation(x0 + i + 0.5, y + 0.5, z0 + j + 0.5);
      im.setMatrixAt(n, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    k.group.add(im);
    k.meshes.push(im);
  }
  // 当たり判定：列ごとに縦に連続したブロックをまとめる
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      let y = 0;
      while (y < 20) {
        if (!b.solid(i, y, j)) {
          y++;
          continue;
        }
        const y0 = y;
        while (b.solid(i, y, j)) y++;
        k.colliders.push({ x0: x0 + i, x1: x0 + i + 1, y0, y1: y, z0: z0 + j, z1: z0 + j + 1 });
      }
    }
  }
  // 外側の地面
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: '#6aa84f' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  k.group.add(ground);

  k.lights('#e6f4ff', '#7a8a5a', 1.5, 1.9);
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
export function collide(colliders, pos, r, h, bounds) {
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
  pos.x = Math.max(bounds.x0 + m, Math.min(bounds.x1 - m, pos.x));
  pos.z = Math.max(bounds.z0 + m, Math.min(bounds.z1 - m, pos.z));
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
export function ceilingAt(colliders, x, z, footY, r, h, bounds) {
  let top = bounds.h - h;
  for (const c of colliders) {
    if (c.y0 < footY + h - 0.001) continue;
    if (overlapsXZ(c, x, z, r * 0.7)) top = Math.min(top, c.y0 - h);
  }
  return top;
}
