// ブロックの世界のテクスチャ（16x16 のドット絵をコードで生成）

import * as THREE from 'three';
import { rng } from './maps.js';

const S = 16;

function pix(seed, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng(seed);
  const put = (x, y, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  fn({ g, r, put });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  return t;
}

// 色をランダムに少し揺らして塗りつぶす
function noisy(base, spread) {
  return ({ r, put }) => {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = 1 + (r() - 0.5) * spread;
        put(x, y, `rgb(${base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`);
      }
    }
  };
}

function specks(base, spread, specCol, n) {
  return (ctx) => {
    noisy(base, spread)(ctx);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(ctx.r() * 14);
      const y = Math.floor(ctx.r() * 14);
      ctx.put(x, y, specCol);
      ctx.put(x + 1, y, specCol);
      ctx.put(x, y + 1, specCol);
    }
  };
}

let cache = null;

export function blockMaterials() {
  if (cache) return cache;
  const T = {
    grassTop: pix(1, noisy([96, 160, 64], 0.35)),
    grassSide: pix(2, (c) => {
      noisy([134, 96, 67], 0.3)(c);
      for (let x = 0; x < S; x++) {
        const d = 3 + Math.floor(c.r() * 3);
        for (let y = 0; y < d; y++) c.put(x, y, `rgb(${80 + c.r() * 30},${150 + c.r() * 30},${55 + c.r() * 20})`);
      }
    }),
    dirt: pix(3, noisy([134, 96, 67], 0.35)),
    stone: pix(4, noisy([128, 128, 128], 0.25)),
    cobble: pix(5, (c) => {
      noisy([110, 110, 110], 0.3)(c);
      c.g.fillStyle = 'rgba(40,40,40,.6)';
      for (const [x, y, w, h] of [[0, 4, 16, 1], [0, 10, 16, 1], [5, 0, 1, 4], [11, 4, 1, 6], [3, 10, 1, 6], [9, 10, 1, 6]]) c.g.fillRect(x, y, w, h);
    }),
    planks: pix(6, (c) => {
      noisy([162, 130, 78], 0.18)(c);
      c.g.fillStyle = 'rgba(70,45,20,.55)';
      for (const y of [3, 7, 11, 15]) c.g.fillRect(0, y, 16, 1);
      for (const [x, y] of [[4, 0], [12, 4], [7, 8], [2, 12]]) c.g.fillRect(x, y, 1, 3);
    }),
    logSide: pix(7, (c) => {
      for (let x = 0; x < S; x++) {
        const v = x % 3 === 0 ? 0.7 : 1;
        for (let y = 0; y < S; y++) {
          const k = v * (0.85 + c.r() * 0.3);
          c.put(x, y, `rgb(${Math.round(104 * k)},${Math.round(80 * k)},${Math.round(48 * k)})`);
        }
      }
    }),
    logTop: pix(8, (c) => {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          const ring = Math.floor(d) % 2 ? 0.85 : 1;
          const bark = d > 6.5;
          c.put(x, y, bark ? 'rgb(100,78,46)' : `rgb(${Math.round(176 * ring)},${Math.round(140 * ring)},${Math.round(88 * ring)})`);
        }
      }
    }),
    leaves: pix(9, (c) => {
      noisy([58, 120, 40], 0.5)(c);
      for (let i = 0; i < 30; i++) c.put(Math.floor(c.r() * S), Math.floor(c.r() * S), 'rgb(30,70,22)');
    }),
    sand: pix(10, noisy([219, 205, 150], 0.12)),
    water: pix(11, (c) => {
      noisy([52, 96, 200], 0.15)(c);
      c.g.fillStyle = 'rgba(160,200,255,.6)';
      for (const [x, y, w] of [[2, 3, 5], [9, 6, 4], [4, 10, 6], [11, 13, 3]]) c.g.fillRect(x, y, w, 1);
    }),
    glass: pix(12, ({ g }) => {
      g.clearRect(0, 0, S, S);
      g.fillStyle = 'rgba(210,235,245,.25)';
      g.fillRect(1, 1, 14, 14);
      g.fillStyle = '#dfeff5';
      g.fillRect(0, 0, 16, 1);
      g.fillRect(0, 15, 16, 1);
      g.fillRect(0, 0, 1, 16);
      g.fillRect(15, 0, 1, 16);
      g.fillStyle = 'rgba(255,255,255,.8)';
      g.fillRect(3, 3, 1, 2);
      g.fillRect(4, 2, 2, 1);
    }),
    craftTop: pix(13, (c) => {
      noisy([162, 130, 78], 0.15)(c);
      c.g.fillStyle = '#5c3d1c';
      c.g.fillRect(0, 0, 16, 2);
      c.g.fillRect(0, 14, 16, 2);
      c.g.fillRect(0, 0, 2, 16);
      c.g.fillRect(14, 0, 2, 16);
      c.g.fillRect(5, 2, 1, 12);
      c.g.fillRect(10, 2, 1, 12);
      c.g.fillRect(2, 5, 12, 1);
      c.g.fillRect(2, 10, 12, 1);
    }),
    craftSide: pix(14, (c) => {
      noisy([150, 115, 70], 0.15)(c);
      c.g.fillStyle = '#5c3d1c';
      c.g.fillRect(0, 0, 16, 3);
      c.g.fillStyle = '#9a9a9a';
      c.g.fillRect(3, 6, 4, 2);
      c.g.fillRect(4, 8, 2, 5);
      c.g.fillStyle = '#7a5230';
      c.g.fillRect(10, 6, 1, 7);
      c.g.fillRect(9, 6, 3, 2);
    }),
    furnace: pix(15, (c) => {
      noisy([110, 110, 110], 0.25)(c);
      c.g.fillStyle = '#2a2a2a';
      c.g.fillRect(4, 8, 8, 5);
      c.g.fillStyle = '#ff8c1a';
      c.g.fillRect(5, 11, 6, 2);
      c.g.fillStyle = '#555';
      c.g.fillRect(3, 3, 10, 2);
    }),
    bookshelf: pix(16, (c) => {
      noisy([162, 130, 78], 0.15)(c);
      for (const y0 of [1, 9]) {
        for (let x = 1; x < 15; x += 2) {
          const col = ['#a83232', '#3268a8', '#3a8a3a', '#c7a43a', '#7a3aa8'][Math.floor(c.r() * 5)];
          c.g.fillStyle = col;
          c.g.fillRect(x, y0, 2, 6);
        }
      }
    }),
    chest: pix(17, (c) => {
      noisy([170, 110, 40], 0.15)(c);
      c.g.fillStyle = '#3b2410';
      c.g.fillRect(0, 0, 16, 1);
      c.g.fillRect(0, 6, 16, 1);
      c.g.fillRect(0, 15, 16, 1);
      c.g.fillStyle = '#d0d0d0';
      c.g.fillRect(7, 5, 2, 4);
    }),
    coal: pix(18, specks([128, 128, 128], 0.2, '#1e1e1e', 6)),
    iron: pix(19, specks([128, 128, 128], 0.2, '#d8b48c', 6)),
    gold: pix(20, specks([128, 128, 128], 0.2, '#f7d23c', 6)),
    tntSide: pix(21, (c) => {
      noisy([200, 40, 30], 0.15)(c);
      c.g.fillStyle = '#eeeeee';
      c.g.fillRect(0, 5, 16, 6);
      c.g.fillStyle = '#222';
      c.g.fillRect(3, 7, 3, 1);
      c.g.fillRect(4, 7, 1, 3);
      c.g.fillRect(7, 7, 1, 3);
      c.g.fillRect(8, 7, 1, 1);
      c.g.fillRect(9, 8, 1, 2);
      c.g.fillRect(11, 7, 3, 1);
      c.g.fillRect(12, 7, 1, 3);
    }),
    tntTop: pix(22, (c) => {
      noisy([200, 40, 30], 0.15)(c);
      c.g.fillStyle = '#ddd';
      c.g.fillRect(6, 6, 4, 4);
    }),
    pumpkinSide: pix(23, (c) => {
      for (let x = 0; x < S; x++) {
        const k = x % 4 === 0 ? 0.8 : 1;
        for (let y = 0; y < S; y++) c.put(x, y, `rgb(${Math.round(222 * k)},${Math.round(130 * k)},${Math.round(30 * k)})`);
      }
    }),
    pumpkinFace: pix(24, (c) => {
      for (let x = 0; x < S; x++) {
        const k = x % 4 === 0 ? 0.8 : 1;
        for (let y = 0; y < S; y++) c.put(x, y, `rgb(${Math.round(222 * k)},${Math.round(130 * k)},${Math.round(30 * k)})`);
      }
      c.g.fillStyle = '#3a2208';
      c.g.fillRect(3, 4, 3, 3);
      c.g.fillRect(10, 4, 3, 3);
      c.g.fillRect(3, 10, 10, 2);
      c.g.fillRect(5, 12, 2, 1);
      c.g.fillRect(9, 12, 2, 1);
    }),
    pumpkinTop: pix(25, noisy([200, 120, 30], 0.2)),
  };
  const m = (t, opts = {}) => new THREE.MeshLambertMaterial({ map: t, ...opts });
  const six = (side, top, bottom, front) => [m(side), m(side), m(top), m(bottom || top), m(front || side), m(side)];
  const one = (t, opts) => {
    const mm = m(t, opts);
    return [mm, mm, mm, mm, mm, mm];
  };
  cache = {
    grass: six(T.grassSide, T.grassTop, T.dirt),
    dirt: one(T.dirt),
    stone: one(T.stone),
    cobble: one(T.cobble),
    planks: one(T.planks),
    log: six(T.logSide, T.logTop),
    leaves: one(T.leaves),
    sand: one(T.sand),
    water: one(T.water),
    glass: one(T.glass, { transparent: true, alphaTest: 0.05 }),
    crafting: six(T.craftSide, T.craftTop, T.planks),
    furnace: six(T.cobble, T.stone, T.stone, T.furnace),
    bookshelf: six(T.bookshelf, T.planks),
    chest: one(T.chest),
    coal: one(T.coal),
    iron: one(T.iron),
    gold: one(T.gold),
    tnt: six(T.tntSide, T.tntTop),
    pumpkin: six(T.pumpkinSide, T.pumpkinTop, T.pumpkinTop, T.pumpkinFace),
  };
  return cache;
}
