// ステージを組み立てる。ステージの種類は maps.js（共通データ）と対応する。

import * as THREE from 'three';
import { tex, rng } from './textures.js';
import { MAPS, genBlocks, BLOCKS } from './maps.js';
import { blockMaterials } from './blocktex.js';
import { buildSky } from './sky.js';
import { Character, POSES } from './character.js';

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

  // 円柱（当たり判定は内接する四角）
  function cyl(x, z, r, h, y0, spec = {}, collide = true, segs = 24) {
    const m = add(new THREE.Mesh(new THREE.CylinderGeometry(spec.rTop ?? r, r, h, segs), mat(spec.tex, spec.rx || 2, spec.ry || 1, spec.color)), x, y0 + h / 2, z);
    if (collide) {
      const q = r * 0.75;
      colliders.push({ x0: x - q, x1: x + q, y0, y1: y0 + h, z0: z - q, z1: z + q });
    }
    return m;
  }

  // 球（sy で上下につぶす）
  function sphere(x, y, z, r, spec = {}, collide = true, sy = 1) {
    const m = add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat(spec.tex, spec.rx || 2, spec.ry || 1, spec.color)), x, y, z);
    m.scale.y = sy;
    if (collide) {
      const q = r * 0.75;
      colliders.push({ x0: x - q, x1: x + q, y0: y - r * sy * 0.8, y1: y + r * sy * 0.8, z0: z - q, z1: z + q });
    }
    return m;
  }

  // 当たり判定もレイキャストもしない飾り
  function deco(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  const kit = { group, box, plate, plant, add, cyl, sphere, deco, mat, lights, colliders, meshes, bounds };
  const builders = { burger: buildBurger, blocks: buildBlocks, sea: buildSea, car: buildCar, candy: buildCandy, city: buildCity, space: buildSpace, island: buildIsland, sado: buildSado, shop: buildShop };
  (builders[mapId] || buildHouse)(kit);

  scene.background = new THREE.Color(def.sky || (def.outdoor ? '#9fd3f5' : '#222222'));
  scene.fog = def.fog ? new THREE.Fog(def.fog.color, def.fog.near, def.fog.far) : null;
  const sky = buildSky(group, mapId, bounds);

  return {
    id: MAPS[mapId] ? mapId : 'house',
    group,
    meshes,
    colliders,
    bounds,
    update() {
      if (sky) sky.update();
    },
    dispose() {
      group.removeFromParent();
      scene.fog = null;
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
  box(-14.3, 4.3, H, H + 0.6, -11.3, 1.3, { tex: 'yellowWall', tile: 1.5, faces: { '-y': { tex: 'ceiling', tile: 1.2 }, '+y': { tex: 'concrete', tile: 3 } } });
  // 屋上へのぼる外かいだん（西がわ）。おにも屋上まで行ける
  const RT = H + 0.6;
  const steps = 15;
  for (let i = 0; i < steps; i++) {
    const y1 = (RT * (i + 1)) / steps;
    const z1 = 10.2 - i * 0.6;
    box(-16.6, -14.3, 0, y1, z1 - 0.6, z1, { tex: 'concrete', tile: 1.2, faces: { '+y': { tex: 'checker', tile: 0.6, color: '#bfbfbf' } } });
    // てすり（横からはのぼれない）
    box(-14.42, -14.3, y1, y1 + 1.1, z1 - 0.6, z1, { color: '#9aa1a8' });
    box(-16.6, -16.48, y1, y1 + 1.1, z1 - 0.6, z1, { color: '#9aa1a8' });
  }
  box(-16.6, -14.3, 0, RT, -1.5, 1.2, { tex: 'concrete', tile: 1.2 }); // おどりば
  // 入口のひさし・窓
  box(-6.6, -2.4, 2.8, 3.05, 1, 2.1, { tex: 'awning', tile: 0.6 });
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
  box(4.6, 9.7, 2.75, 3.0, 9, 9.2, { tex: 'hazard', tile: 0.4 });

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
  plant(-16, 12.2, 1.4, 1.6);
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
// うみのなか（海底・岩・しずんだ船・サンゴ・海そう）
// ---------------------------------------------------------------------------

function buildSea(k) {
  const { box, cyl, sphere, deco, plate, mat } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = k.bounds;
  const T = 0.5;
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'seaSand', tile: 4 }, false);

  // 西の岩がけ
  const rock = { tex: 'rock', tile: 3 };
  box(-16, -13, 0, 4, -12, -2, rock);
  box(-16, -12, 0, 2.5, -2, 4, rock);
  box(-16, -14, 0, 3.5, 4, 12, rock);
  // 岩のアーチ
  box(-6, -4, 0, 3.5, -10, -8, rock);
  box(0, 2, 0, 3.5, -10, -8, rock);
  box(-6, 2, 3.5, 4.6, -10, -8, rock);
  // ごろごろした岩
  for (const [x, z, r] of [[-8, 0, 1.1], [6, 3, 0.9], [-1, 10, 1.2], [12, -12, 1.4]]) {
    const m = k.add(new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat('rock', 1, 1)), x, r * 0.6, z);
    m.rotation.set(x, z, 0);
    k.colliders.push({ x0: x - r * 0.7, x1: x + r * 0.7, y0: 0, y1: r * 1.3, z0: z - r * 0.7, z1: z + r * 0.7 });
  }

  // しずんだ船
  box(4, 13, 0, 2.6, -10, -5, { tex: 'shipHull', tile: [4.5, 2.6], faces: { '+y': { tex: 'wood', tile: 1, color: '#6b4a2e' } } });
  box(9, 12, 2.6, 4.6, -9.5, -5.5, { tex: 'wood', tile: 1, color: '#7a5a3a' });
  cyl(6.5, -7.5, 0.2, 7, 2.6, { tex: 'wood', color: '#6b4a2e' });
  box(5, 8, 6, 8.5, -7.6, -7.4, { color: '#d8cfb8' }); // やぶれた帆
  // 宝箱
  box(-2.6, -1.4, 0, 0.8, 1.6, 2.4, { tex: 'chest', stretch: true });

  // サンゴのかべとサンゴ
  box(14, 16, 0, 2.5, -2, 12, { tex: 'coralWall', tile: 2 });
  const coralCols = ['#ff7f6b', '#f7c66b', '#c76bd6', '#ff9fb2', '#6bd6c6'];
  let ci = 0;
  for (const [x, z] of [[11, 1], [12, 3.5], [10.5, 6], [12, 9], [9.5, 10.5]]) {
    const col = coralCols[ci++ % coralCols.length];
    cyl(x, z, 0.35, 1.6, 0, { color: col, rTop: 0.15 }, true, 10);
    cyl(x + 0.5, z + 0.3, 0.25, 1.1, 0, { color: col, rTop: 0.1 }, false, 10);
    sphere(x - 0.5, 0.45, z - 0.2, 0.5, { color: coralCols[ci % coralCols.length] }, true, 0.9);
  }
  for (const [x, z] of [[-9, -6], [3, 7], [-5, 1]]) sphere(x, 0.5, z, 0.7, { tex: 'coralWall', color: '#ffd0c8' }, true, 0.8);

  // 海そうの森
  for (let i = 0; i < 14; i++) {
    const x = -10 + (i % 7) * 1.1 + ((i * 37) % 5) * 0.1;
    const z = 6 + Math.floor(i / 7) * 2.4 + ((i * 13) % 7) * 0.15;
    const hgt = 3 + ((i * 7) % 5) * 0.4;
    const m = k.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, hgt, 0.12), mat('kelp', 1, 1)), x, hgt / 2, z);
    m.rotation.y = i * 0.7;
    k.colliders.push({ x0: x - 0.2, x1: x + 0.2, y0: 0, y1: hgt, z0: z - 0.2, z1: z + 0.2 });
  }
  // ヒトデ
  for (const [x, z, col] of [[2, -2, '#ff8a3d'], [-6, -4, '#ff5c8a'], [8, 6, '#ffd166']]) {
    const st = deco(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 5), new THREE.MeshLambertMaterial({ color: col })), x, 0.03, z);
    st.rotation.y = x;
  }
  // あわ
  const bubbleMat = new THREE.MeshBasicMaterial({ color: '#e6f8ff', transparent: true, opacity: 0.45 });
  for (let i = 0; i < 40; i++) {
    const x = ((i * 53) % 30) - 15;
    const z = ((i * 29) % 22) - 11;
    deco(new THREE.Mesh(new THREE.SphereGeometry(0.06 + (i % 4) * 0.04, 8, 6), bubbleMat), x, 1 + ((i * 17) % 80) / 10, z);
  }
  k.lights('#9fe0ff', '#2a6f86', 1.7, 1.5);
}

// ---------------------------------------------------------------------------
// くるまのなか（小さくなって車の中に入った）
// ---------------------------------------------------------------------------

function buildCar(k) {
  const { box, cyl, sphere, plate, add, mat } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H } = k.bounds;
  const T = 0.5;
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'carpet', tile: 2 }, false);
  box(X0 - T, X1 + T, H, H + T, Z0 - T, Z1 + T, { tex: 'headliner', tile: 2 }, false);
  // ドア（左右）と窓
  box(X0 - T, X0, 0, H, Z0, Z1, { tex: 'doorPanel', tile: [7, 4.5], faces: { '+x': { tex: 'doorPanel', tile: [7, 4.5] } } });
  box(X1, X1 + T, 0, H, Z0, Z1, { tex: 'doorPanel', tile: [7, 4.5] });
  for (const z of [-6, 4]) {
    plate(X0 + 0.03, 6.4, z, 7, 3, '+x', 'carWindow');
    plate(X1 - 0.03, 6.4, z, 7, 3, '-x', 'carWindow');
  }
  // 後ろのかべとリアガラス
  box(X0 - T, X1 + T, 0, H, Z1, Z1 + T, { tex: 'headliner', tile: 2 });
  plate(0, 7.2, Z1 - 0.03, 12, 2.8, '-z', 'carWindow');
  // ダッシュボードとフロントガラス
  box(X0, X1, 0, 5, Z0 - T, -10, { tex: 'console', tile: 2, faces: { '+z': { tex: 'dashboard', stretch: true }, '+y': { color: '#2a2c30' } } });
  box(X0 - T, X1 + T, 5, H, Z0 - T, Z0, { tex: 'headliner', tile: 2 }, false);
  plate(0, 7, Z0 + 0.03, 18, 3.4, '+z', 'carWindow');
  // ハンドル
  const wheel = add(new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.28, 12, 32), mat(null, 1, 1, '#1d1e21')), -5, 5.6, -9.2);
  wheel.rotation.x = -0.35;
  cyl(-5, -9.6, 0.3, 1.2, 4.6, { color: '#1d1e21' }, false);
  // 前の座席（左右）
  const seat = { tex: 'seatFabric', tile: 1.5 };
  for (const sx of [-5, 5]) {
    box(sx - 3, sx + 3, 0, 2.5, -7, -2, seat);
    box(sx - 3, sx + 3, 2.5, 7.5, -2, -0.5, seat);
    box(sx - 1.4, sx + 1.4, 7.5, 9, -1.8, -0.7, seat); // ヘッドレスト
  }
  // まんなかのコンソールとシフトレバー
  box(-1.5, 1.5, 0, 2.2, -10, -2, { tex: 'console', tile: [3, 2.2] });
  cyl(0, -6, 0.15, 1.2, 2.2, { color: '#888c92' }, false);
  sphere(0, 3.5, -6, 0.45, { color: '#1d1e21' }, false);
  // うしろの座席
  box(-9, 9, 0, 2.5, 5, 10, seat);
  box(-9, 9, 2.5, 7.5, 10, 11.5, seat);
  // おもちゃばこ（うしろの座席にのぼる台）
  box(-1.2, 1.2, 0, 1.2, 3.7, 5, { tex: 'icing', tile: 1, color: '#ffd166' });
  // 落とし物いろいろ
  box(-7.5, -5, 2.5, 3.7, 7.6, 9, { tex: 'tissueBox', tile: [2.5, 1.2], faces: { '+y': { color: '#9fd6c8' } } });
  cyl(5.5, 7, 0.55, 2.6, 2.5, { color: '#7fd0ff', rTop: 0.4 });
  cyl(5.5, 7, 0.25, 0.4, 5.1, { color: '#ffffff' }, false);
  box(6.2, 8.4, 0, 0.35, 0.3, 1.4, { color: '#f2c94c' }); // まんが本
  box(1, 3.5, 2.5, 4, 6, 7.5, { color: '#e4572e' }); // おかしのふくろ
  k.lights('#fff5e6', '#5b5f66', 1.5, 1.2);
}

// ---------------------------------------------------------------------------
// おかしのまち
// ---------------------------------------------------------------------------

function buildCandy(k) {
  const { box, cyl, sphere, deco, mat, add } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = k.bounds;
  const T = 0.5;
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'candyGround', tile: 5 }, false);
  // クッキーの道
  box(-1.5, 1.5, 0, 0.02, -4, 13, { tex: 'cookie', tile: 1.5 }, false);
  box(-7, -1.5, 0, 0.02, -5, -2, { tex: 'cookie', tile: 1.5 }, false);

  // ジンジャーブレッドの家
  box(-15, -7, 0, 4.5, -12, -6, { tex: 'gingerbread', tile: [4, 4.5] });
  box(-15.4, -6.6, 4.5, 5.4, -12.4, -5.6, { tex: 'icing', tile: 2 });
  box(-12, -10, 0, 2.4, -5.98, -5.9, { color: '#6b3a1e' }, false); // ドア

  // ケーキのとう
  cyl(9, -7, 3.2, 2.6, 0, { tex: 'cakeLayer', rx: 3 }, true, 40);
  cyl(9, -7, 2.2, 2.2, 2.6, { tex: 'cakeLayer', rx: 2 }, true, 40);
  sphere(9, 5.4, -7, 0.6, { color: '#d61f3c' }, true);

  // チョコのかべ
  box(-4, 6, 0, 2.6, 7, 8.2, { tex: 'chocolate', tile: 1.3 });

  // アイス屋さん
  box(9, 15, 0, 3.5, 5, 11, { tex: 'waffle', tile: 1.2 });
  for (const [x, z, col] of [[10.5, 6.5, '#ffb3c8'], [13.5, 6.5, '#fff4e6'], [12, 9.5, '#9fd6c8']]) sphere(x, 4.2, z, 1.1, { color: col }, true, 0.8);

  // クッキーのへい
  box(-18, -6, 0, 1.2, 13, 14, { tex: 'cookie', tile: 1.2 });

  // ドーナツ
  const donut = add(new THREE.Mesh(new THREE.TorusGeometry(2, 0.7, 16, 40), mat(null, 1, 1, '#e8a25e')), -2, 2.7, -6);
  const glaze = add(new THREE.Mesh(new THREE.TorusGeometry(2, 0.72, 16, 40, Math.PI), mat(null, 1, 1, '#ff8fb8')), -2, 2.7, -6);
  glaze.position.z = -5.99;
  void donut;
  k.colliders.push({ x0: -4.7, x1: -3.3, y0: 0, y1: 4.5, z0: -6.7, z1: -5.3 });
  k.colliders.push({ x0: -0.7, x1: 0.7, y0: 0, y1: 4.5, z0: -6.7, z1: -5.3 });
  k.colliders.push({ x0: -4, x1: 0, y0: 4.3, y1: 5.4, z0: -6.7, z1: -5.3 });

  // ペロペロキャンディの木
  for (const [x, z] of [[-12, 3], [-14, 9], [3, -11], [14, -1], [6, 11.5]]) {
    cyl(x, z, 0.12, 3, 0, { color: '#ffffff' }, false, 8);
    k.colliders.push({ x0: x - 0.2, x1: x + 0.2, y0: 0, y1: 3, z0: z - 0.2, z1: z + 0.2 });
    const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.25, 32), mat('lollipop', 1, 1)), x, 3.9, z);
    disc.rotation.x = Math.PI / 2;
    k.colliders.push({ x0: x - 1.2, x1: x + 1.2, y0: 2.7, y1: 5.1, z0: z - 0.15, z1: z + 0.15 });
  }
  // キャンディケーン
  for (const [x, z] of [[4, -2], [-9, 6], [16, 2]]) {
    cyl(x, z, 0.3, 3.2, 0, { tex: 'candy', rx: 1, ry: 3 }, true, 16);
    sphere(x, 3.25, z, 0.3, { color: '#e63946' }, false);
  }
  // グミ
  const gumCols = ['#ff6f91', '#7bd389', '#ffd166', '#6ec6ff', '#c792ea'];
  [[-7, 4], [7, 2], [-4, 11], [12, -12], [-16, -2]].forEach(([x, z], i) => sphere(x, 0.45, z, 0.9, { tex: 'sugar', color: gumCols[i % gumCols.length] }, true, 0.75));
  // マカロン
  ['#ffb3c8', '#fff4e6', '#c792ea', '#fff4e6', '#7bd389'].forEach((col, i) => cyl(-11, -2, 1, i % 2 ? 0.2 : 0.4, [0, 0.4, 0.6, 1.0, 1.2][i], { color: col }, false, 28));
  k.colliders.push({ x0: -11.8, x1: -10.2, y0: 0, y1: 1.6, z0: -2.8, z1: -1.2 });
  // スプリンクル（飾り）
  for (let i = 0; i < 30; i++) {
    const m = deco(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.25, 2, 6), new THREE.MeshLambertMaterial({ color: gumCols[i % 5] })), ((i * 41) % 32) - 16, 0.08, ((i * 23) % 24) - 12);
    m.rotation.set(Math.PI / 2, 0, i);
  }
  k.lights('#fff0f8', '#c7a7c0', 1.7, 1.6);
}

// ---------------------------------------------------------------------------
// まち
// ---------------------------------------------------------------------------

function buildCity(k) {
  const { box, plate, plant, cyl, sphere, deco, add, mat } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = k.bounds;
  const T = 0.5;
  const SW = 0.15; // 歩道の高さ

  // 道路と歩道
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'asphalt', tile: 4 }, false);
  const walk = { tex: 'sidewalk', tile: 2, faces: { '+x': { tex: 'curb', tile: [1, SW] }, '-x': { tex: 'curb', tile: [1, SW] }, '+z': { tex: 'curb', tile: [1, SW] }, '-z': { tex: 'curb', tile: [1, SW] } } };
  box(X0, -3, 0, SW, Z0, -3, walk);
  box(3, X1, 0, SW, Z0, -3, walk);
  box(3, X1, 0, SW, 3, Z1, walk);
  box(X0, -3, 0, SW, 3, Z1, { ...walk, tex: 'lawn', tile: 3 }); // こうえん
  // 白線・横断歩道（飾り）
  const white = new THREE.MeshLambertMaterial({ color: '#f1f1f1' });
  const line = (x0, x1, z0, z1) => deco(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.01, z1 - z0), white), (x0 + x1) / 2, 0.006, (z0 + z1) / 2);
  for (let x = X0 + 1; x < X1; x += 3) if (Math.abs(x) > 6) line(x, x + 1.6, -0.08, 0.08);
  for (let z = Z0 + 1; z < Z1; z += 3) if (Math.abs(z) > 6) line(-0.08, 0.08, z, z + 1.6);
  for (let i = 0; i < 7; i++) {
    const t = -2.7 + i * 0.8;
    line(-5.5, -3.5, t, t + 0.45);
    line(3.5, 5.5, t, t + 0.45);
    line(t, t + 0.45, -5.5, -3.5);
    line(t, t + 0.45, 3.5, 5.5);
  }
  for (const [x, z] of [[-9, 1.6], [7, -1.6], [-1.5, 10]]) {
    const mh = deco(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 20), mat('shutter', 1, 1, '#777777')), x, 0.01, z);
    void mh;
  }

  // ビル（北西）
  box(-19, -9, SW, 13, -15.5, -7, { tex: 'officeFacade', tile: 6, faces: { '+y': { tex: 'concrete', tile: 3 } } });
  plate(-14, SW + 1.2, -6.98, 2.4, 2.3, '+z', 'glassDark');
  // 自動はんばいき
  for (const x of [-8.6, -7.7]) box(x, x + 0.85, SW, SW + 1.9, -7, -6.2, { color: '#d7263d', faces: { '+z': { tex: 'vending', stretch: true } } });
  box(-6.6, -6, SW, SW + 0.9, -7, -6.4, { tex: 'trashBin', tile: [0.6, 0.9] });
  plant(-17.5, -5, 0.9);

  // コンビニ（北東）。うらのゴミばことにもつから屋根にのぼれる
  box(6, 16, SW, 3.6, -14, -7.5, { tex: 'concrete', tile: 2, faces: { '+z': { tex: 'shopWindow', tile: [2.5, 3.45] }, '+y': { tex: 'concrete', tile: 3 } } });
  plate(11, 3.2, -7.47, 10, 0.7, '+z', 'konbiniSign');
  box(4.2, 5.8, SW, 1.35, -13, -11.5, { color: '#2f6d3a', faces: { '+y': { color: '#24552d' } } });
  box(4.2, 5.8, SW, 2.5, -11.5, -10.4, { tex: 'cardboard', tile: 1 });
  box(5, 5.6, SW, SW + 1, -7.4, -6.8, { tex: 'trashBin', tile: [0.6, 1] });

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
  car(13, -5, '#f2c94c', 'x');
  car(-15, 1.5, '#c62828', 'x');
  car(1.5, -11, '#f2f2f2', 'z');
  car(10, 1.5, '#2a7bd0', 'x');
  car(15, 6, '#6f9d4a', 'x');

  // マンション（南東）
  box(7, 19, SW, 12, 9, 15.5, { tex: 'apartment', tile: 3, faces: { '+y': { tex: 'concrete', tile: 3 } } });
  plate(9.5, SW + 1.1, 8.98, 1.6, 2.2, '-z', 'doorPanel');
  box(13, 13.8, SW, SW + 1.9, 8.2, 9, { color: '#1c7ed6', faces: { '-z': { tex: 'vending', stretch: true } } });
  // ゆうびんポスト
  cyl(5, 5.2, 0.3, 1.2, SW, { color: '#d62828' }, true, 16);
  sphere(5, SW + 1.2, 5.2, 0.3, { color: '#d62828' }, false);
  // バスてい
  box(8.3, 10.7, SW, 0.6, 4, 4.4, { tex: 'wood', tile: 0.6 });
  box(8, 11, SW, 2.2, 4.4, 4.5, { tex: 'glassDark', tile: 1 });
  box(7.8, 11.2, 2.2, 2.35, 3.3, 4.7, { color: '#9aa1a8' });
  box(11.4, 12, SW, 1.15, 3.6, 4.2, { tex: 'trashBin', tile: [0.6, 1] });
  cyl(7.3, 3.6, 0.05, 2.3, SW, { color: '#9aa1a8' }, true, 8);
  const busSign = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 24), mat('busSign', 1, 1)), 7.3, 2.6, 3.6);
  busSign.rotation.x = Math.PI / 2;

  // こうえん（南西）
  box(-20, -6, SW, 1.1, 3.3, 3.8, { tex: 'hedge', tile: 1 });
  plant(-17, 13, 1.3, 1.6);
  plant(-5, 14.5, 1.2, 1.5);
  plant(-18.5, 6, 1.2, 1.5);
  // すべりだい
  box(-13, -11.8, SW, 2.0, 8, 9.2, { color: '#e03131' });
  const slide = deco(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 3.2), mat(null, 1, 1, '#ffd43b')), -12.4, 1.1, 10.6);
  slide.rotation.x = 0.6;
  // すなば
  box(-9, -6, SW, 0.4, 10, 13, { tex: 'wood', tile: 0.6, faces: { '+y': { tex: 'seaSand', tile: 1.5 } } });
  // ブランコ
  for (const x of [-9, -5.5]) cyl(x, 5.6, 0.08, 2.6, SW, { color: '#4a7bd0' }, true, 10);
  box(-9, -5.5, 2.6 + SW, 2.75 + SW, 5.5, 5.7, { color: '#4a7bd0' });
  for (const x of [-8, -6.5]) {
    deco(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.3), mat(null, 1, 1, '#7a5230')), x, 0.65, 5.6);
    for (const dx of [-0.22, 0.22]) deco(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.1, 4), mat(null, 1, 1, '#555555')), x + dx, 1.7, 5.6);
  }
  // ベンチ
  box(-16, -14, SW, 0.6, 11, 11.5, { tex: 'wood', tile: 0.6 });

  // しんごう・でんちゅう
  for (const [x, z] of [[3.6, 3.6], [-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6]]) {
    cyl(x, z, 0.08, 3.4, SW, { color: '#7a7f85' }, true, 10);
    const head = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.32, 0.3), [mat(null, 1, 1, '#2b2b2b'), mat(null, 1, 1, '#2b2b2b'), mat(null, 1, 1, '#2b2b2b'), mat(null, 1, 1, '#2b2b2b'), mat('signal', 1, 1), mat('signal', 1, 1)]), x, 3.5, z);
    head.rotation.y = Math.abs(x - z) < 0.1 ? Math.PI / 4 : -Math.PI / 4;
  }
  for (const [x, z] of [[-12, -3.6], [12, 3.6], [-12, 3.0], [12, -3.6], [3.6, -12], [-3.6, 12]]) cyl(x, z, 0.15, 6.8, 0, { color: '#b5b5b5' }, true, 10);

  k.lights('#e6f4ff', '#8a8f96', 1.6, 1.8);
}

// ---------------------------------------------------------------------------
// うちゅう
// ---------------------------------------------------------------------------

function buildSpace(k) {
  const { box, cyl, sphere, deco, add, mat, group } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = k.bounds;
  const T = 0.5;

  // 月の地面
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'moonGround', tile: 6 }, false);
  for (const [x, z, r] of [[-4, 3, 2], [10, -1, 1.4], [-11, -6, 1.7]]) {
    const rim = deco(new THREE.Mesh(new THREE.TorusGeometry(r, 0.25, 8, 28), mat('moonGround', 2, 0.3, '#b0b0b4')), x, 0.02, z);
    rim.rotation.x = Math.PI / 2;
    rim.scale.z = 0.5;
  }

  // 月面きち（ドーム）
  sphere(7, 0, 5, 3, { tex: 'stationPanel', rx: 4, ry: 2 }, true);
  box(6.2, 7.8, 0, 1.8, 7.4, 8.3, { tex: 'stationPanel', tile: 1, faces: { '+z': { color: '#495057' } } });
  // コンテナ
  box(1, 3, 0, 1.5, -1, 1, { tex: 'stationPanel', tile: 1 });
  box(1.2, 2.8, 1.5, 2.7, -0.8, 0.8, { tex: 'foil', tile: 1 });

  // ロケット
  box(10, 14, 0, 0.3, -8, -4, { tex: 'concrete', tile: 2 });
  cyl(12, -6, 1, 7, 0.3, { tex: 'rocket', rx: 1, ry: 1 }, true, 28);
  cyl(12, -6, 1, 2, 7.3, { color: '#e03131', rTop: 0.02 }, true, 28);
  box(12.9, 13.6, 0.3, 2, -6.1, -5.9, { color: '#e03131' });
  box(10.4, 11.1, 0.3, 2, -6.1, -5.9, { color: '#e03131' });
  box(11.9, 12.1, 0.3, 2, -7.6, -6.9, { color: '#e03131' });

  // ローバー
  box(-9.5, -6.5, 0.6, 1.4, 5, 7, { tex: 'stationPanel', tile: 1 });
  k.colliders.push({ x0: -9.5, x1: -6.5, y0: 0, y1: 0.6, z0: 5, z1: 7 });
  const wheel = mat('tire', 2, 1);
  for (const x of [-9.1, -8, -6.9]) {
    for (const z of [5, 7]) {
      const w = add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14), wheel), x, 0.45, z);
      w.rotation.x = Math.PI / 2;
    }
  }
  cyl(-7, 6, 0.04, 1.2, 1.4, { color: '#adb5bd' }, false, 6);

  // はた
  cyl(0, 8, 0.05, 2.6, 0, { color: '#dee2e6' }, true, 8);
  box(0.05, 1.45, 1.8, 2.6, 7.97, 8.03, { color: '#ffffff', faces: { '+z': { tex: 'planetEarth', stretch: true }, '-z': { tex: 'planetEarth', stretch: true } } }, false);

  // パラボラアンテナ
  cyl(-13, -2, 0.15, 2, 0, { color: '#adb5bd' }, true, 10);
  const dish = add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), new THREE.MeshLambertMaterial({ color: '#e9ecef', side: THREE.DoubleSide })), -13, 2.6, -2);
  dish.rotation.x = Math.PI;
  dish.rotation.z = 0.5;

  // うかんでいる宇宙ステーション
  const mod = add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 12, 28), mat('stationPanel', 6, 1)), -5, 6.5, -6);
  mod.rotation.z = Math.PI / 2;
  k.colliders.push({ x0: -11, x1: 1, y0: 5.1, y1: 7.9, z0: -7.4, z1: -4.6 });
  sphere(2, 6.5, -6, 1.8, { tex: 'foil', rx: 2, ry: 1 }, true);
  const solar = { tex: 'foil', tile: 1, faces: { '+y': { tex: 'solarPanel', tile: 1.5 }, '-y': { tex: 'solarPanel', tile: 1.5 } } };
  box(-7, -3, 6.45, 6.55, -12, -7.6, solar);
  box(-7, -3, 6.45, 6.55, -4.4, 0, solar);

  // 人工衛星
  box(8.2, 9.8, 9.2, 10.8, 2.2, 3.8, { tex: 'foil', tile: 1 });
  box(3.5, 8.2, 9.95, 10.05, 2.5, 3.5, solar);
  box(9.8, 14.5, 9.95, 10.05, 2.5, 3.5, solar);
  const sd = deco(new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.6, 18, 1, true), new THREE.MeshLambertMaterial({ color: '#f1f3f5', side: THREE.DoubleSide })), 9, 8.8, 3);
  sd.rotation.x = Math.PI;

  // いんせき
  for (const [x, y, z, r] of [[-12, 9, 6, 1.8], [-2, 11, 4, 1.3], [4, 7, -10, 1.4], [-7, 13, -1, 1.1], [13, 5, 9, 1.2]]) {
    const m = sphere(x, y, z, r, { tex: 'rock', rx: 2, ry: 1, color: '#9a9490' }, true);
    m.rotation.set(x, y, z);
  }
  for (const [x, z, r] of [[-3, -2, 0.9], [-13, -9, 1.2], [3, 10, 0.7]]) sphere(x, 0, z, r, { tex: 'rock', color: '#8f8f93' }, true, 0.6);

  // 遠くのわく星（飾り）
  const earth = new THREE.Mesh(new THREE.SphereGeometry(14, 40, 24), new THREE.MeshLambertMaterial({ map: mat('planetEarth', 1, 1).map, emissive: '#1c3f7a', emissiveIntensity: 0.25 }));
  earth.position.set(-60, 35, -70);
  group.add(earth);
  const ringed = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 20), new THREE.MeshLambertMaterial({ map: mat('planetStripes', 1, 1).map }));
  ringed.position.set(75, 22, 40);
  const ring = new THREE.Mesh(new THREE.RingGeometry(9, 13, 48), new THREE.MeshBasicMaterial({ color: '#d9b77a', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  ring.rotation.x = 1.2;
  ringed.add(ring);
  group.add(ringed);

  k.lights('#b8c4ff', '#3a3a48', 1.0, 2.4);
}

// ---------------------------------------------------------------------------
// 島のステージで使う海・トキ
// ---------------------------------------------------------------------------

// ステージのまわりの海（飾り）。y は地面より少しだけ下
function ocean(k, y = -0.03) {
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ map: tex('water', 60, 60), color: '#9fe3ff' }));
  sea.rotation.x = -Math.PI / 2;
  k.deco(sea, 0, y, 0);
}

// あさい水（歩ける）
function shallow(k, x0, x1, z0, z1, y = 0.012) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshLambertMaterial({ map: tex('water', (x1 - x0) / 4, (z1 - z0) / 4), transparent: true, opacity: 0.85, color: '#bfefff' }));
  w.rotation.x = -Math.PI / 2;
  k.deco(w, (x0 + x1) / 2, y, (z0 + z1) / 2);
}

// トキ（飾り）
function toki(k, x, y, z, rot = 0) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: '#f8e3dc' });
  const wing = new THREE.MeshLambertMaterial({ color: '#f2b8ae' });
  const red = new THREE.MeshLambertMaterial({ color: '#e03131' });
  const black = new THREE.MeshLambertMaterial({ color: '#222222' });
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), body);
  b.scale.set(0.8, 0.8, 1.4);
  b.position.y = 0.42;
  const w1 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), wing);
  w1.scale.set(0.9, 0.5, 1.3);
  w1.position.set(0, 0.48, -0.05);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), red);
  head.position.set(0, 0.62, 0.26);
  const crest = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), body);
  crest.position.set(0, 0.66, 0.2);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.28, 8), black);
  beak.rotation.x = Math.PI / 2 + 0.5;
  beak.position.set(0, 0.55, 0.42);
  g.add(b, w1, head, crest, beak);
  for (const sx of [-0.06, 0.06]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), red);
    leg.position.set(sx, 0.15, 0);
    g.add(leg);
  }
  g.rotation.y = rot;
  k.deco(g, x, y, z);
}

// ---------------------------------------------------------------------------
// むじんとう
// ---------------------------------------------------------------------------

function buildIsland(k) {
  const { box, cyl, sphere, deco, add, mat } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = k.bounds;
  const T = 0.5;
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'seaSand', tile: 3 }, false);
  ocean(k);
  shallow(k, X0 - T, X1 + T, 10.6, Z1 + T);

  // ヤシの木
  const leafMat = mat('palmLeaf', 1, 1);
  leafMat.side = THREE.DoubleSide;
  function palm(x, z, h, lean = 0.25, dir = 0) {
    const n = 6;
    let px = x;
    let pz = z;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const off = lean * t * t * h;
      const nx = x + Math.sin(dir) * off;
      const nz = z + Math.cos(dir) * off;
      const seg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2 - 0.05 * t, 0.24 - 0.05 * t, h / n + 0.05, 10), mat('palmTrunk', 1, 1)), (px + nx) / 2, (h / n) * (i + 0.5), (pz + nz) / 2);
      seg.rotation.set(Math.cos(dir) * lean * 0.5 * t, 0, -Math.sin(dir) * lean * 0.5 * t);
      px = nx;
      pz = nz;
    }
    k.colliders.push({ x0: x - 0.25, x1: x + 0.25, y0: 0, y1: h * 0.6, z0: z - 0.25, z1: z + 0.25 });
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.PlaneGeometry(0.7, 2.6);
      geo.translate(0, 1.3, 0);
      const leaf = new THREE.Mesh(geo, leafMat);
      leaf.rotation.x = -Math.PI / 2 - (0.35 + (i % 2) * 0.3);
      const g = new THREE.Group();
      g.add(leaf);
      g.rotation.y = (i / 8) * Math.PI * 2;
      deco(g, px, h, pz);
    }
    for (let i = 0; i < 3; i++) deco(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(null, 1, 1, '#6b4a24')), px + Math.cos(i * 2.1) * 0.25, h - 0.2, pz + Math.sin(i * 2.1) * 0.25);
  }
  palm(-8, 2, 4.5, 0.3, 0.5);
  palm(6, -2, 5, 0.25, -2);
  palm(-14, 10, 4.2, 0.35, 2.5);
  palm(16, 8, 4.8, 0.3, -1);
  palm(-3, -12.5, 4.6, 0.2, 1);
  palm(10, 4, 4, 0.3, 3);
  palm(-16, -4, 4.4, 0.25, 0.3);

  // ほったて小屋（竹のかべ・わらの屋根）。にもつとたるから屋根にのぼれる
  const bam = { tex: 'bamboo', tile: 1.5 };
  box(-4, 2, 0, 2.6, -10, -9.8, bam);
  box(-4, -3.8, 0, 2.6, -9.8, -5, bam);
  box(1.8, 2, 0, 2.6, -9.8, -5, bam);
  box(-4, -2, 0, 2.6, -5.2, -5, bam);
  box(0, 2, 0, 2.6, -5.2, -5, bam);
  box(-2, 0, 2.0, 2.6, -5.2, -5, bam);
  box(-4.6, 2.6, 2.6, 3.2, -10.6, -4.4, { tex: 'thatch', tile: 1.5 });
  box(-3.6, -2.4, 0, 0.7, -9.6, -8.6, { tex: 'crate', tile: 0.7 });
  box(2.7, 3.9, 0, 2.2, -7.5, -6.3, { tex: 'crate', tile: 1.1 });
  cyl(3.3, -4.3, 0.45, 1.0, 0, { tex: 'wood', color: '#9a6a3a', rx: 2 }, true, 16);

  // がけ（ジャンプでのぼれる）
  const rockSpec = { tex: 'rock', tile: 2, color: '#f5e9cf' };
  box(-18, -10, 0, 1.2, -14, -8, rockSpec);
  box(-18, -12, 1.2, 2.4, -14, -10, rockSpec);
  box(-18, -14.5, 2.4, 3.6, -14, -12, rockSpec);

  // こわれたボート・いかだ
  const hull = { tex: 'shipHull', tile: 1 };
  box(6.5, 9.5, 0, 0.3, 8, 10, hull);
  box(6.5, 9.5, 0.3, 0.9, 7.8, 8, hull);
  box(6.5, 9.5, 0.3, 0.9, 10, 10.2, hull);
  box(6.3, 6.5, 0.3, 0.9, 7.8, 10.2, hull);
  box(9.5, 9.7, 0.3, 0.9, 7.8, 10.2, hull);
  box(-11.5, -8.5, 0, 0.35, 8, 10, { tex: 'palmTrunk', tile: 0.6 });

  // 大きな岩・たからばこ
  sphere(12, 0, -8, 2.2, { tex: 'rock', color: '#a39a8a' }, true, 0.7);
  sphere(15, 0, 4, 1.5, { tex: 'rock', color: '#a39a8a' }, true, 0.8);
  box(13.8, 15.2, 0, 0.9, -11.6, -10.8, { tex: 'chest', stretch: true });

  // たき火
  for (let i = 0; i < 8; i++) deco(new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat('rock', 1, 1, '#888888')), Math.cos(i * 0.785) * 0.6, 0.1, 2 + Math.sin(i * 0.785) * 0.6);
  for (const a of [0.3, 1.9]) {
    const log = deco(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8), mat('wood', 1, 1, '#6b4a24')), 0, 0.12, 2);
    log.rotation.set(Math.PI / 2, 0, a);
  }
  const fire = deco(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), new THREE.MeshBasicMaterial({ color: '#ff8c1a' })), 0, 0.45, 2);
  void fire;
  k.colliders.push({ x0: -0.7, x1: 0.7, y0: 0, y1: 0.35, z0: 1.3, z1: 2.7 });

  // すなにかいた SOS（石）
  const stone = mat('rock', 1, 1, '#9a9a9a');
  const dot = (x, z) => deco(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), stone), x, 0.08, z);
  const S = (ox) => {
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * Math.PI * 1.5;
      dot(ox + Math.cos(t + Math.PI / 2) * 0.5, -6.5 + Math.sin(t + Math.PI / 2) * 0.5);
      dot(ox - Math.cos(t + Math.PI / 2) * 0.5, -5.5 - Math.sin(t + Math.PI / 2) * 0.5);
    }
  };
  S(6);
  for (let i = 0; i < 14; i++) dot(8.5 + Math.cos((i / 14) * Math.PI * 2) * 0.6, -6 + Math.sin((i / 14) * Math.PI * 2) * 1.0);
  S(11);
  // ココナッツの山・びん
  for (let i = 0; i < 5; i++) deco(new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat(null, 1, 1, '#6b4a24')), -6.5 + (i % 3) * 0.3, 0.17 + Math.floor(i / 3) * 0.25, -1 + (i % 2) * 0.2);
  const bottle = deco(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 10), new THREE.MeshLambertMaterial({ color: '#7fd18b', transparent: true, opacity: 0.8 })), 3, 0.06, 11);
  bottle.rotation.z = Math.PI / 2;

  k.lights('#e9fbff', '#d6c49a', 1.6, 2.0);
}

// ---------------------------------------------------------------------------
// さどがしま
// ---------------------------------------------------------------------------

function buildSado(k) {
  const { box, plate, plant, cyl, sphere, deco, add, mat } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1, h: HB } = k.bounds;
  const T = 0.5;
  // 屋根の上には行けないように、当たり判定を天井までのばす
  const cap = (x0, x1, y0, z0, z1) => k.colliders.push({ x0, x1, y0, y1: HB + 1, z0, z1 });

  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'lawn', tile: 3 }, false);
  ocean(k);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 + 1, 9.5), mat('seaSand', 12, 3));
  sand.rotation.x = -Math.PI / 2;
  deco(sand, 0, 0.006, 10.75);
  shallow(k, X0 - T, X1 + T, 8, Z1 + T);

  // 佐渡金山（がけとトンネル）
  const cliff = { tex: 'rock', tile: 2, color: '#9a8f80' };
  box(-20, -15.2, 0, 9, -15, -9, cliff);
  box(-12.8, -8, 0, 9, -15, -9, cliff);
  box(-15.2, -12.8, 2.8, 9, -15, -9, cliff);
  box(-15.2, -12.8, 0, 2.8, -15, -14, { color: '#2b2622' });
  const timber = { tex: 'wood', tile: 0.5, color: '#6b4a2b' };
  box(-15.3, -15.0, 0, 2.9, -9.1, -8.8, timber);
  box(-13.0, -12.7, 0, 2.9, -9.1, -8.8, timber);
  box(-15.3, -12.7, 2.6, 2.9, -9.1, -8.8, timber);
  plate(-10.4, 3.4, -8.98, 2.6, 0.95, '+z', 'kinzanSign');
  const railMat = mat(null, 1, 1, '#555a60');
  for (const x of [-14.45, -13.55]) deco(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 9), railMat), x, 0.03, -9.5);
  for (let z = -13.8; z < -5; z += 0.7) deco(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.15), mat('wood', 1, 1, '#5a3b20')), -14, 0.02, z);
  box(-14.6, -13.4, 0.2, 1.0, -8, -6.6, { color: '#6b4f3a' });
  k.colliders.push({ x0: -14.6, x1: -13.4, y0: 0, y1: 0.2, z0: -8, z1: -6.6 });
  for (let i = 0; i < 6; i++) deco(new THREE.Mesh(new THREE.DodecahedronGeometry(0.2), mat('goldOre', 1, 1)), -14.3 + (i % 3) * 0.3, 1.05, -7.6 + Math.floor(i / 3) * 0.5);
  deco(new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffd8a0' })), -14, 2.4, -12);
  sphere(-17.5, 0, -7.5, 1.0, { tex: 'goldOre', rx: 2 }, true, 0.7);
  sphere(-9, 0, -6.8, 0.7, { tex: 'goldOre', rx: 2 }, true, 0.7);

  // たなだ（だんだんの田んぼ。歩いてのぼれる）
  for (let i = 0; i < 6; i++) {
    const z1 = -4 - 1.8 * i;
    const z0 = i === 5 ? -15 : -4 - 1.8 * (i + 1);
    box(8, 20, 0, 0.4 * (i + 1), z0, z1, { tex: 'dirt', tile: [1.5, 0.4], faces: { '+y': { tex: 'ricePaddy', tile: 2 } } });
  }
  // はさがけ（いねをほす）
  for (const x of [9.5, 11, 12.5]) cyl(x, -10.3, 0.07, 2.0, 1.6, { tex: 'wood', color: '#7a5230' }, true, 8);
  for (const y of [2.6, 3.2]) box(9.4, 12.6, y, y + 0.1, -10.35, -10.25, { tex: 'wood', color: '#7a5230' });
  const ine = mat('thatch', 1, 1, '#e8c96a');
  for (let x = 9.7; x < 12.4; x += 0.35) for (const y of [2.3, 2.9]) deco(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.35), ine), x, y, -10.3);
  // かかし
  cyl(17, -6.7, 0.05, 1.6, 0.8, { tex: 'wood', color: '#7a5230' }, true, 6);
  deco(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), mat('wood', 1, 1, '#7a5230')), 17, 1.9, -6.7);
  deco(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.25), mat(null, 1, 1, '#3b6fb0')), 17, 1.75, -6.7);
  deco(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat('thatch', 1, 1, '#f0e0b0')), 17, 2.3, -6.7);
  deco(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.25, 16), mat('thatch', 1, 1)), 17, 2.55, -6.7);

  // 宿根木のような木の家
  box(-19, -11, 0, 4.2, -5, 3, { tex: 'sadoWood', tile: 2 });
  plate(-10.98, 1.1, 1, 1.4, 2.2, '+x', 'doorPanel');
  plate(-10.98, 2.6, -2.5, 2.4, 1.2, '+x', 'window');
  box(-19.4, -10.6, 4.2, 4.8, -5.4, 3.4, { tex: 'kawara', tile: 1, faces: { '-y': { tex: 'sadoWood', tile: 2 } } });
  cap(-19.4, -10.6, 4.2, -5.4, 3.4);
  // いど
  cyl(-8, 6, 0.7, 0.8, 0, { tex: 'concrete', color: '#b8b2a6', rx: 3 }, true, 20);
  for (const x of [-8.65, -7.35]) cyl(x, 6, 0.05, 1.6, 0.8, { tex: 'wood', color: '#6b4a2b' }, false, 6);
  box(-8.9, -7.1, 2.4, 2.5, 5.5, 6.5, { tex: 'kawara', tile: 1 });

  // のうぶたい（おにだいこ）
  box(-4, 3, 0, 0.9, -13, -7, { tex: 'wood', tile: 1, color: '#8a6a45', faces: { '+y': { tex: 'woodFloor', tile: 2.4 } } });
  box(-1.5, 0.5, 0, 0.45, -7, -6.4, { tex: 'wood', tile: 1, color: '#8a6a45' });
  for (const [x, z] of [[-3.7, -7.3], [2.7, -7.3], [-3.7, -12.6], [2.7, -12.6]]) cyl(x, z, 0.15, 3.3, 0.9, { tex: 'wood', color: '#6b4a2b' }, true, 12);
  box(-4, 3, 0.9, 4.2, -13, -12.8, { tex: 'sadoWood', tile: 2, faces: { '+z': { tex: 'pinePanel', stretch: true } } });
  box(-4.5, 3.5, 4.2, 4.8, -13.5, -6.5, { tex: 'kawara', tile: 1, faces: { '-y': { tex: 'wood', tile: 1, color: '#6b4a2b' } } });
  cap(-4.5, 3.5, 4.2, -13.5, -6.5);
  box(-1.1, 0.1, 0.9, 1.15, -10.1, -9.5, { tex: 'wood', tile: 0.5, color: '#5a3b20' });
  const drum = add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.9, 28), [mat('taiko', 3, 1), mat('drumSkin', 1, 1), mat('drumSkin', 1, 1)]), -0.5, 1.75, -9.8);
  drum.rotation.z = Math.PI / 2;
  k.colliders.push({ x0: -0.95, x1: -0.05, y0: 1.15, y1: 2.35, z0: -10.4, z1: -9.2 });
  // 石どうろう
  box(4.7, 5.3, 0, 0.3, -6.3, -5.7, { tex: 'concrete', tile: 1, color: '#b8b2a6' });
  cyl(5, -6, 0.12, 0.8, 0.3, { tex: 'concrete', color: '#b8b2a6' }, true, 10);
  box(4.75, 5.25, 1.1, 1.5, -6.25, -5.75, { tex: 'concrete', tile: 1, color: '#d8d0c0' });
  deco(new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.35, 4), mat('concrete', 1, 1, '#b8b2a6')), 5, 1.68, -6).rotation.y = Math.PI / 4;

  // かき（おけさがき）の木・まつ
  plant(2, 2, 1.3, 1.6);
  const kaki = mat(null, 1, 1, '#f28c28');
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4;
    const yy = 2.1 + (i % 3) * 0.35;
    deco(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), kaki), 2 + Math.cos(a) * 0.95, yy, 2 + Math.sin(a) * 0.95);
  }
  plant(-14, 7, 1.2, 1.8);
  plant(16, 4, 1.2, 1.8);

  // さんばし・たらいぶね
  box(4, 6, 0, 0.3, 8, 14.5, { tex: 'wood', tile: 0.8, color: '#9a7a55' });
  const inner = mat(null, 1, 1, '#5a3b20');
  for (const [x, z] of [[-6, 11], [-2, 13], [10, 11.5], [14, 9.5]]) {
    cyl(x, z, 0.85, 0.55, 0, { tex: 'wood', color: '#b07a45', rx: 3 }, true, 24);
    deco(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.02, 24), inner), x, 0.56, z);
    deco(new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 6, 28), mat(null, 1, 1, '#3b2a1a')), x, 0.42, z).rotation.x = Math.PI / 2;
  }
  // かんばん
  plate(0, 1.8, 7.5, 2.4, 0.9, '+z', 'sadoSign');
  for (const x of [-1.1, 1.1]) cyl(x, 7.5, 0.06, 1.35, 0, { tex: 'wood', color: '#6b4a2b' }, true, 8);

  // トキ
  toki(k, 11, 0.4, -5.2, 0.3);
  toki(k, 15, 1.2, -8.5, -2);
  toki(k, 2, 3.75, 2, 1);
  toki(k, -9, 0.02, 9.6, 2.5);
  toki(k, 0.5, 4.8, -10, -0.7);

  k.lights('#e6f4ff', '#8a9a6a', 1.6, 1.8);
}

// ---------------------------------------------------------------------------
// 100えんショップ
// ---------------------------------------------------------------------------

// プレイヤーとおなじ体のお客さん（うごかない。撃つとはずれになる）
function customer(k, c, seed) {
  const r = rng(seed);
  const ch = new Character({ id: 'npc' + seed, kind: 'hider', name: '' });
  const pick = (a) => a[Math.floor(r() * a.length)];
  const skin = pick(['#f5d0b0', '#e9b48f', '#c98d63', '#f9dcc4']);
  const hair = pick(['#2b1d14', '#4a2e1a', '#1b1b1b', '#7a4b26', '#9a9a9a', '#c8a165']);
  const shirt = pick(['#e03131', '#1c7ed6', '#2b8a3e', '#f08c00', '#7048e8', '#ffffff', '#f783ac', '#ffd43b', '#495057', '#15aabf']);
  const pants = pick(['#1e3a5f', '#343a40', '#5c4033', '#868e96', '#2f4f4f', '#e9ecef']);
  const fill = (i, col) => {
    const pt = ch.paint[i];
    pt.ctx.fillStyle = col;
    pt.ctx.fillRect(0, 0, pt.size, pt.size);
  };
  fill(0, shirt);
  fill(2, shirt);
  fill(3, shirt);
  fill(4, pants);
  fill(5, pants);
  // かお（球の u=0.25 が正面）
  const hd = ch.paint[1];
  const S = hd.size;
  const g = hd.ctx;
  g.fillStyle = skin;
  g.fillRect(0, 0, S, S);
  g.fillStyle = hair;
  g.fillRect(0, 0, S, S * 0.3);
  g.beginPath();
  g.ellipse(S * 0.75, S * 0.3, S * 0.3, S * (r() < 0.5 ? 0.32 : 0.18), 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#222';
  for (const dx of [-0.035, 0.035]) {
    g.beginPath();
    g.ellipse(S * (0.25 + dx), S * 0.47, S * 0.012, S * 0.03, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#a5523a';
  g.lineWidth = S * 0.012;
  g.beginPath();
  g.arc(S * 0.25, S * 0.56, S * 0.025, 0.2, Math.PI - 0.2);
  g.stroke();
  for (const p of ch.paint) p.tex.needsUpdate = true;
  for (const m of ch.parts) {
    m.userData = {};
    k.meshes.push(m);
  }
  ch.pose = POSES[c.pose] ? c.pose : 'stand';
  ch.poseNow = structuredClone(POSES[ch.pose]);
  ch.applyPose();
  ch.root.position.set(c.p[0], c.p[1], c.p[2]);
  ch.root.rotation.y = c.yaw;
  if (c.basket) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.28), new THREE.MeshLambertMaterial({ color: '#e03131' }));
    b.position.set(-0.36, 0.62, 0.08);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 6, 16, Math.PI), b.material);
    handle.position.y = 0.11;
    b.add(handle);
    ch.root.add(b);
  }
  if (ch.label) ch.label.visible = false;
  k.group.add(ch.root);
  const hgt = ch.pose === 'crouch' ? 1.3 : 1.75;
  k.colliders.push({ x0: c.p[0] - 0.3, x1: c.p[0] + 0.3, y0: c.p[1], y1: c.p[1] + hgt, z0: c.p[2] - 0.3, z1: c.p[2] + 0.3 });
}

function buildShop(k) {
  const { box, plate, cyl, deco, mat } = k;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H } = k.bounds;
  const T = 0.5;
  const cap = (x0, x1, y0, z0, z1) => k.colliders.push({ x0, x1, y0, y1: H + 1, z0, z1 });

  // 床・天井・かべ
  box(X0 - T, X1 + T, -T, 0, Z0 - T, Z1 + T, { tex: 'shopFloor', tile: 1.2 }, false);
  box(X0 - T, X1 + T, H, H + T, Z0 - T, Z1 + T, { tex: 'ceiling', tile: 1.2 }, false);
  const wall = { tex: 'shopWall', tile: [1, H] };
  box(X0 - T, X1 + T, 0, H, Z0 - T, Z0, wall);
  box(X0 - T, X0, 0, H, Z0, Z1, wall);
  box(X1, X1 + T, 0, H, Z0, Z1, wall);
  box(X0 - T, 0, 0, H, Z1, Z1 + T, { ...wall, faces: { '-z': { tex: 'shopWindow', tile: [3, H] } } });
  box(3, X1 + T, 0, H, Z1, Z1 + T, { ...wall, faces: { '-z': { tex: 'shopWindow', tile: [3, H] } } });
  box(0, 3, 0, H, Z1, Z1 + T, { tex: 'glassDark', tile: 1.5 }); // 自動ドア
  // 天井のあかり（飾り）
  const lamp = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (let x = -8; x <= 8; x += 4) for (let z = -7; z <= 7; z += 3.5) deco(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.3), lamp), x, H - 0.03, z);

  // かべのたな
  const shelfBody = { tex: 'stainless', tile: 1, color: '#e9ecef' };
  box(-11.5, 11.5, 0, 2.2, Z0, -9.5, { ...shelfBody, faces: { '+z': { tex: 'goodsSnack', tile: [2.5, 2.2] } } });
  cap(-11.5, 11.5, 2.2, Z0, -9.5);
  box(X0, -11.5, 0, 2.2, -9.5, 6, { ...shelfBody, faces: { '+x': { tex: 'goodsKitchen', tile: [2.5, 2.2] } } });
  cap(X0, -11.5, 2.2, -9.5, 6);
  box(11.5, X1, 0, 2.2, -9.5, 2, { ...shelfBody, faces: { '-x': { tex: 'goodsClean', tile: [2.5, 2.2] } } });
  cap(11.5, X1, 2.2, -9.5, 2);
  plate(0, 2.8, -9.48, 4.4, 0.85, '+z', 'sign100');

  // まんなかのたな（りょうめん）。上には行けない
  const kinds = [['goodsKitchen', 'goodsSnack', 'catKitchen'], ['goodsToy', 'goodsStationery', 'catToy'], ['goodsStationery', 'goodsClean', 'catStationery'], ['goodsClean', 'goodsKitchen', 'catClean']];
  [-8, -4, 0, 4].forEach((x, i) => {
    const [a, b, sign] = kinds[i];
    box(x - 0.45, x + 0.45, 0, 1.8, -6.5, 3.5, { ...shelfBody, faces: { '-x': { tex: a, tile: [2.5, 1.8] }, '+x': { tex: b, tile: [2.5, 1.8] }, '+z': { tex: 'goodsToy', tile: [0.9, 1.8] } } });
    cap(x - 0.45, x + 0.45, 1.8, -6.5, 3.5);
    // ぶらさがりかんばん
    const sg = deco(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.04), [mat(null, 1, 1, '#ffffff'), mat(null, 1, 1, '#ffffff'), mat(null, 1, 1, '#ffffff'), mat(null, 1, 1, '#ffffff'), mat(sign, 1, 1), mat(sign, 1, 1)]), x, 2.75, -1.5);
    sg.rotation.y = Math.PI / 2;
    deco(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.02), mat('pop100', 1, 1)), x, 1.95, 3.52);
  });

  // レジ
  box(4, 9.5, 0, 1.0, 6, 7, { tex: 'counterFront', tile: [2, 1], faces: { '+y': { tex: 'stainless', tile: 1 } } });
  for (const x of [5.2, 8.2]) box(x - 0.25, x + 0.25, 1.0, 1.35, 6.2, 6.55, { tex: 'register', stretch: true }, false);
  // かごおき
  for (let i = 0; i < 5; i++) deco(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.36), new THREE.MeshLambertMaterial({ color: '#e03131' })), 10.8, 0.13 + i * 0.12, 8.6);
  k.colliders.push({ x0: 10.5, x1: 11.1, y0: 0, y1: 0.75, z0: 8.4, z1: 8.8 });

  // ワゴン（ボール・トイレットペーパー・バケツ）
  box(7, 8.6, 0, 0.8, -4, -2.8, { tex: 'stainless', tile: 1, color: '#ced4da' });
  const ballCols = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2'];
  for (let i = 0; i < 18; i++) deco(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(null, 1, 1, ballCols[i % 5])), 7.15 + (i % 6) * 0.25, 0.9, -3.8 + Math.floor(i / 6) * 0.38);
  for (let i = 0; i < 12; i++) cyl(9.6 + (i % 4) * 0.42, -0.8 + Math.floor(i / 4) * 0.42, 0.2, 0.36, 0, { color: '#f8f9fa' }, false, 14);
  k.colliders.push({ x0: 9.4, x1: 11.2, y0: 0, y1: 0.36, z0: -1, z1: 0.3 });
  ['#4dabf7', '#ffd43b', '#ff8787'].forEach((col, i) => cyl(9.8, 3 + i * 0.01, 0.3 - i * 0.02, 0.4, i * 0.3, { color: col, rTop: 0.33 - i * 0.02 }, false, 18));
  k.colliders.push({ x0: 9.5, x1: 10.1, y0: 0, y1: 1.0, z0: 2.7, z1: 3.3 });

  // お客さん
  MAPS.shop.customers.forEach((c, i) => customer(k, c, 900 + i * 7));

  k.lights('#ffffff', '#b8b2a6', 1.5, 0.9);
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
// step: これ以下の段差は押し返さずに乗り越える（かいだん用）
export function collide(colliders, pos, r, h, bounds, step = 0) {
  for (let iter = 0; iter < 3; iter++) {
    for (const c of colliders) {
      if (pos.y >= c.y1 - 0.001 - step || pos.y + h <= c.y0) continue;
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

// 体を小さな球の集まりとして、箱にめり込んでいたら押し出す量を返す（めり込みがなければ null）
// spheres: [{ x, y, z, r }]
export function pushOut(colliders, spheres, bounds) {
  let best = null;
  let bestLen = 0.002;
  const consider = (px, py, pz) => {
    const l = Math.hypot(px, py, pz);
    if (l > bestLen) {
      bestLen = l;
      best = [px, py, pz];
    }
  };
  for (const s of spheres) {
    // 床・天井・外側の見えない壁
    if (s.y - s.r < 0) consider(0, s.r - s.y, 0);
    if (s.y + s.r > bounds.h) consider(0, bounds.h - s.r - s.y, 0);
    if (s.x - s.r < bounds.x0) consider(bounds.x0 + s.r - s.x, 0, 0);
    if (s.x + s.r > bounds.x1) consider(bounds.x1 - s.r - s.x, 0, 0);
    if (s.z - s.r < bounds.z0) consider(0, 0, bounds.z0 + s.r - s.z);
    if (s.z + s.r > bounds.z1) consider(0, 0, bounds.z1 - s.r - s.z);
    for (const c of colliders) {
      const qx = Math.max(c.x0, Math.min(s.x, c.x1));
      const qy = Math.max(c.y0, Math.min(s.y, c.y1));
      const qz = Math.max(c.z0, Math.min(s.z, c.z1));
      const dx = s.x - qx;
      const dy = s.y - qy;
      const dz = s.z - qz;
      const d = Math.hypot(dx, dy, dz);
      if (d >= s.r) continue;
      if (d > 1e-6) {
        const k = (s.r - d) / d;
        consider(dx * k, dy * k, dz * k);
      } else {
        // 球の中心が箱の中：いちばん近い面から外へ
        const opts = [
          [c.x0 - s.r - s.x, 0, 0], [c.x1 + s.r - s.x, 0, 0],
          [0, c.y0 - s.r - s.y, 0], [0, c.y1 + s.r - s.y, 0],
          [0, 0, c.z0 - s.r - s.z], [0, 0, c.z1 + s.r - s.z],
        ];
        opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        consider(...opts[0]);
      }
    }
  }
  return best;
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
