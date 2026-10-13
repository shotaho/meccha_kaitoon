// ステージの共通データ（three.js に依存しない）。
// 部屋のロジック（room.js：Node でもブラウザでも動く）とステージの描画（world.js）の両方から使う。
//
// spot = CPU が隠れる場所 { p:[x,y,z], yaw, pose, view?:[x,y,z] }
//   yaw は体の向き（0 で +z を向く）。view は擬態を合わせる視点（省略時は正面 5m・高さ 1.5m）

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PI = Math.PI;
const E = PI / 2; // +x を向く
const W = -PI / 2; // -x を向く
const S = PI; // -z を向く
const N = 0; // +z を向く

// ---------------------------------------------------------------------------
// ブロックの世界（地形は全員同じになるようシード固定で生成）
// ---------------------------------------------------------------------------

export const BLOCKS = { x0: -16, z0: -12, nx: 32, nz: 24 };

let blockCache = null;

export function genBlocks() {
  if (blockCache) return blockCache;
  const { x0, z0, nx, nz } = BLOCKS;
  const r = rng(2024);
  // なめらかな乱数（バリューノイズ）
  const grid = (n) => {
    const g = [];
    for (let i = 0; i <= n; i++) g.push(Array.from({ length: n + 1 }, () => r()));
    return g;
  };
  const g1 = grid(8);
  const g2 = grid(16);
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (g, n, u, v) => {
    const x = u * n;
    const y = v * n;
    const i = Math.min(n - 1, Math.floor(x));
    const j = Math.min(n - 1, Math.floor(y));
    const fx = smooth(x - i);
    const fy = smooth(y - j);
    const a = g[i][j] + (g[i + 1][j] - g[i][j]) * fx;
    const b = g[i][j + 1] + (g[i + 1][j + 1] - g[i][j + 1]) * fx;
    return a + (b - a) * fy;
  };

  const cells = new Map(); // "i,y,j" -> type
  const heights = [];
  const key = (i, y, j) => `${i},${y},${j}`;
  const set = (i, y, j, t) => cells.set(key(i, y, j), t);
  const pondC = [6, 17];

  for (let i = 0; i < nx; i++) {
    heights.push([]);
    for (let j = 0; j < nz; j++) {
      const u = i / nx;
      const v = j / nz;
      let h = 1 + Math.round(noise(g1, 8, u, v) * 4.2 + noise(g2, 16, u, v) * 1.6 - 1.4);
      // 家のまわりは平らに
      const hx = i - 16;
      const hz = j - 12;
      if (Math.abs(hx) <= 6 && Math.abs(hz) <= 5) h = 1;
      // 池
      const pd = Math.hypot(i - pondC[0], j - pondC[1]);
      if (pd < 3.2) h = 1;
      h = Math.max(1, Math.min(6, h));
      heights[i].push(h);
      for (let y = 0; y < h; y++) {
        let t;
        const top = y === h - 1;
        if (pd < 2.4 && top) t = 'water';
        else if (pd < 3.2 && top) t = 'sand';
        else if (top) t = h >= 5 ? 'stone' : 'grass';
        else if (y >= h - 3) t = 'dirt';
        else t = 'stone';
        if (t === 'stone' && r() < 0.12) t = ['coal', 'coal', 'iron', 'gold'][Math.floor(r() * 4)];
        set(i, y, j, t);
      }
    }
  }

  // 家（板材の壁・丸石の屋根・ガラス窓）
  const hi0 = 13;
  const hi1 = 18;
  const hj0 = 9;
  const hj1 = 14;
  for (let i = hi0; i <= hi1; i++) {
    for (let j = hj0; j <= hj1; j++) {
      const edgeI = i === hi0 || i === hi1;
      const edgeJ = j === hj0 || j === hj1;
      for (let y = 1; y <= 3; y++) {
        if (!(edgeI || edgeJ)) continue;
        const corner = edgeI && edgeJ;
        const door = j === hj1 && (i === 15 || i === 16) && y <= 2;
        if (door) continue;
        const win = !corner && y === 2 && ((edgeI && (j === 11 || j === 12)) || (j === hj0 && (i === 15 || i === 16)));
        set(i, y, j, corner ? 'log' : win ? 'glass' : 'planks');
      }
      set(i, 4, j, 'cobble');
    }
  }
  // 家の中の家具
  set(14, 1, 10, 'crafting');
  set(15, 1, 10, 'furnace');
  set(17, 1, 10, 'bookshelf');
  set(17, 2, 10, 'bookshelf');
  set(14, 1, 13, 'chest');

  // 木
  const trees = [];
  let tries = 0;
  while (trees.length < 9 && tries++ < 500) {
    const i = 2 + Math.floor(r() * (nx - 4));
    const j = 2 + Math.floor(r() * (nz - 4));
    if (i >= hi0 - 3 && i <= hi1 + 3 && j >= hj0 - 3 && j <= hj1 + 3) continue;
    if (Math.hypot(i - pondC[0], j - pondC[1]) < 5) continue;
    if (trees.some(([a, b]) => Math.abs(a - i) < 5 && Math.abs(b - j) < 5)) continue;
    if (cells.get(key(i, heights[i][j] - 1, j)) !== 'grass') continue;
    trees.push([i, j]);
  }
  for (const [i, j] of trees) {
    const b = heights[i][j];
    for (let y = b; y < b + 4; y++) set(i, y, j, 'log');
    for (let y = b + 2; y <= b + 3; y++) {
      for (let di = -2; di <= 2; di++) {
        for (let dj = -2; dj <= 2; dj++) {
          if (Math.abs(di) === 2 && Math.abs(dj) === 2) continue;
          const k = key(i + di, y, j + dj);
          if (!cells.has(k) && i + di >= 0 && i + di < nx && j + dj >= 0 && j + dj < nz) cells.set(k, 'leaves');
        }
      }
    }
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) set(i + di, b + 4, j + dj, 'leaves');
  }

  // おまけ
  set(24, heights[24][4], 4, 'tnt');
  set(25, heights[25][4], 4, 'tnt');
  set(8, heights[8][5], 5, 'pumpkin');

  const solid = (i, y, j) => cells.has(key(i, y, j));
  const topAt = (i, j) => {
    let y = 0;
    while (solid(i, y, j)) y++;
    return y;
  };

  // CPU の隠れ場所：2ブロック以上の高さの壁（崖・木・家の壁）の前
  const spots = [];
  const dirs = [[1, 0, W], [-1, 0, E], [0, 1, S], [0, -1, N]];
  for (let i = 1; i < nx - 1; i++) {
    for (let j = 1; j < nz - 1; j++) {
      const y = topAt(i, j);
      if (y > 6) continue;
      for (const [di, dj, yaw] of dirs) {
        if (!(solid(i + di, y, j + dj) && solid(i + di, y + 1, j + dj))) continue;
        // 正面（壁と反対側）が 3 マス開けていること
        let open = true;
        for (let k = 1; k <= 3; k++) {
          if (solid(i - di * k, y, j - dj * k) || solid(i - di * k, y + 1, j - dj * k)) open = false;
        }
        if (!open) continue;
        const x = x0 + i + 0.5 + di * 0.17;
        const z = z0 + j + 0.5 + dj * 0.17;
        spots.push({ p: [x, y, z], yaw, pose: 'stand' });
      }
    }
  }
  const sr = rng(77);
  for (let k = spots.length - 1; k > 0; k--) {
    const m = Math.floor(sr() * (k + 1));
    [spots[k], spots[m]] = [spots[m], spots[k]];
  }

  // CPU 鬼が歩き回る目標地点（高さ 1〜2 の場所）
  const nav = [];
  for (let i = 1; i < nx - 1; i += 3) {
    for (let j = 1; j < nz - 1; j += 3) {
      const y = topAt(i, j);
      if (y <= 3 && !solid(i, y, j) && !solid(i, y + 1, j)) nav.push([x0 + i + 0.5, y, z0 + j + 0.5]);
    }
  }

  blockCache = { cells, heights, solid, topAt, spots: spots.slice(0, 40), nav };
  return blockCache;
}

function blocksHeightAt(x, z) {
  const b = genBlocks();
  const i = Math.floor(x - BLOCKS.x0);
  const j = Math.floor(z - BLOCKS.z0);
  if (i < 0 || j < 0 || i >= BLOCKS.nx || j >= BLOCKS.nz) return 0;
  return b.topAt(i, j);
}

// ---------------------------------------------------------------------------
// ステージ一覧
// ---------------------------------------------------------------------------

export const MAPS = {
  house: {
    name: 'おうち',
    outdoor: false,
    bounds: { x0: -12, x1: 12, z0: -8, z1: 8, h: 5 },
    seekerSpawn: [8, 0, 5],
    seekerLook: 1.0,
    hiderSpawn: { c: [-1, 1], rx: 2.5, rz: 2 },
    spots: [
      { p: [-9.4, 0, -7.68], yaw: N, pose: 'star' },
      { p: [-2.6, 0, -7.68], yaw: N, pose: 'stand' },
      { p: [-1.2, 1.9, -7.68], yaw: N, pose: 'curl' },
      { p: [4.5, 0, -6.98], yaw: N, pose: 'crouch' },
      { p: [-7.7, 0, -7.45], yaw: N, pose: 'stand' },
      { p: [-11.1, 0, -3], yaw: E, pose: 'stand' },
      { p: [-11.0, 0, 3.5], yaw: E, pose: 'banzai' },
      { p: [-11.68, 0, 1.0], yaw: E, pose: 'stand' },
      { p: [11.68, 0, -5.5], yaw: W, pose: 'stand' },
      { p: [11.68, 0.5, 4], yaw: W, pose: 'star' },
      { p: [10.78, 0, 0.6], yaw: W, pose: 'stand' },
      { p: [-7.5, 0, 7.68], yaw: S, pose: 'stand' },
      { p: [6.5, 0, 7.68], yaw: S, pose: 'star' },
      { p: [4.5, 0, 2.32], yaw: N, pose: 'stand' },
      { p: [4.5, 0, 0.68], yaw: S, pose: 'banzai' },
      { p: [9, 0, 6.56], yaw: S, pose: 'crouch' },
      { p: [-2, 0, 0.5], yaw: N, pose: 'lie', view: [-2, 4.5, 3.5] },
    ],
    nav: [[-8, 0, -4], [-3, 0, -5], [2, 0, -5], [7, 0, -4], [9, 0, 0], [7, 0, 4], [2, 0, 4], [-3, 0, 2.5], [-8, 0, 3], [-9, 0, 0], [0, 0, 0], [3, 0, -2], [-6, 0, 6]],
  },

  burger: {
    name: 'マック',
    outdoor: true,
    bounds: { x0: -18, x1: 18, z0: -14, z1: 14, h: 10 },
    seekerSpawn: [14, 0, 12],
    seekerLook: PI / 4,
    hiderSpawn: { c: [-4.5, 4], rx: 3, rz: 1.5 },
    spots: [
      { p: [-0.75, 0, -9.42], yaw: N, pose: 'stand' },
      { p: [-7, 0, -6.86], yaw: N, pose: 'crouch' },
      { p: [-10.5, 0, -6.86], yaw: N, pose: 'crouch' },
      { p: [-13.36, 0.5, -4], yaw: E, pose: 'stand' },
      { p: [-13.36, 0, -0.8], yaw: E, pose: 'star' },
      { p: [-10, 0, 0.38], yaw: S, pose: 'stand' },
      { p: [-0.9, 0, -1.36], yaw: S, pose: 'crouch' },
      { p: [2.6, 0, -6.86], yaw: S, pose: 'crouch' },
      { p: [-7.5, 0, -9.46], yaw: N, pose: 'crouch' },
      { p: [4.36, 0, -8.5], yaw: E, pose: 'stand' },
      { p: [4.36, 0, -1], yaw: E, pose: 'star' },
      { p: [-10, 0, 1.36], yaw: N, pose: 'stand' },
      { p: [0.5, 0, 1.36], yaw: N, pose: 'banzai' },
      { p: [-5, 0, -11.36], yaw: S, pose: 'stand', view: [-3, 1.5, -13.6] },
      { p: [9.66, 0.5, 4.5], yaw: W, pose: 'stand' },
      { p: [8.26, 0, -2], yaw: E, pose: 'crouch' },
      { p: [-6, 0, 12.66], yaw: S, pose: 'crouch' },
      { p: [12, 0, 12.66], yaw: S, pose: 'crouch' },
    ],
    nav: [
      [-9.5, 0, -3], [-5, 0, -5.8], [-2, 0, -3], [-4.5, 0, -0.5], [0, 0, -8.6], [-6, 0, -8.8], [2.5, 0, -2],
      [-4.5, 0, 3], [-10, 0, 5], [0, 0, 6], [5.5, 0, 9], [7, 0, 4], [7.5, 0, -7], [7, 0, -12], [13, 0, -8],
      [13, 0, 0], [14, 0, 8], [-14, 0, 8], [-16, 0, -5], [-12.5, 0, 11.5], [-5, 0, -12.6], [3, 0, -12.6],
      [-10, 5.1, -5], [-2, 5.1, -8], [2, 5.1, -2], [-12, 5.1, 0],
    ],
    // 屋上へのかいだん（CPU のおにが屋上へ行き来するときに使う）
    stairs: { bottom: [-15.45, 0, 11], top: [-15.45, 5.1, -0.5], exit: [-13.4, 0, 11.6] },
  },

  blocks: {
    name: 'マイクラ',
    outdoor: true,
    bounds: { x0: -16, x1: 16, z0: -12, z1: 12, h: 14 },
    seekerSpawn: [12, null, 9],
    seekerLook: 0.9,
    hiderSpawn: { c: [0, 4.6], rx: 3, rz: 0.8 },
    get spots() {
      return genBlocks().spots;
    },
    get nav() {
      return genBlocks().nav;
    },
    heightAt: blocksHeightAt,
  },
};


// うみのなか
MAPS.sea = {
  name: 'うみのなか',
  outdoor: true,
  sky: '#1d6fa3',
  fog: { color: '#1d6fa3', near: 8, far: 42 },
  bounds: { x0: -16, x1: 16, z0: -12, z1: 12, h: 10 },
  seekerSpawn: [12, 0, 10],
  seekerLook: PI / 4,
  hiderSpawn: { c: [2, 3], rx: 2.5, rz: 1.5 },
  spots: [
    { p: [-12.68, 0, -7], yaw: E, pose: 'stand' },
    { p: [-11.68, 0, 1], yaw: E, pose: 'star' },
    { p: [-13.68, 0, 8], yaw: E, pose: 'stand' },
    { p: [-5, 0, -7.68], yaw: N, pose: 'stand' },
    { p: [1, 0, -7.68], yaw: N, pose: 'banzai' },
    { p: [6, 0, -4.68], yaw: N, pose: 'stand' },
    { p: [10.5, 0, -4.68], yaw: N, pose: 'star' },
    { p: [3.68, 0, -7.5], yaw: W, pose: 'stand' },
    { p: [13.68, 0, 4], yaw: W, pose: 'stand' },
    { p: [13.68, 0, 8.5], yaw: W, pose: 'banzai' },
    { p: [-2, 0, 2.72], yaw: N, pose: 'crouch' },
    { p: [8.68, 2.6, -7.5], yaw: W, pose: 'stand' },
    { p: [5, 0, 5], yaw: N, pose: 'lie', view: [5, 4.5, 8.5] },
  ],
  nav: [[-9, 0, -5], [-8, 0, 2.5], [-3, 0, -4], [-2, 0, -9], [0, 0, 0], [3, 0, 5], [8, 0, 0], [11, 0, -2.5],
    [7, 0, 9], [-1, 0, 7.5], [-6, 0, 10.5], [-11, 0, -10], [2, 0, -11.3], [8, 0, -11.2], [-4, 0, 4]],
};

// くるまのなか（小さくなって車の中）
MAPS.car = {
  name: 'くるまのなか',
  outdoor: false,
  sky: '#c9dff0',
  bounds: { x0: -10, x1: 10, z0: -14, z1: 14, h: 10 },
  seekerSpawn: [9, 0, -1],
  seekerLook: 1.86,
  viewDist: 3.2, // 車の中はせまいので、近くから見て合わせる
  hiderSpawn: { c: [0, 2.5], rx: 4, rz: 1 },
  spots: [
    { p: [-9.68, 0, -8.5], yaw: E, pose: 'stand' },
    { p: [-9.68, 0, 2], yaw: E, pose: 'star' },
    { p: [9.68, 0, -8.5], yaw: W, pose: 'stand' },
    { p: [9.68, 0, 3], yaw: W, pose: 'banzai' },
    { p: [-7.5, 0, -9.68], yaw: N, pose: 'stand', view: [-9.2, 1.6, -6.5] },
    { p: [7.5, 0, -9.68], yaw: N, pose: 'star', view: [9.2, 1.6, -6.5] },
    { p: [-5, 0, -0.18], yaw: N, pose: 'stand' },
    { p: [5, 0, -0.18], yaw: N, pose: 'banzai' },
    { p: [-5, 0, -7.32], yaw: S, pose: 'crouch', view: [-9.2, 1.6, -8.6] },
    { p: [-5, 0, 4.68], yaw: S, pose: 'crouch' },
    { p: [4, 0, 4.68], yaw: S, pose: 'crouch' },
    { p: [-2, 2.5, 9.68], yaw: S, pose: 'stand' },
    { p: [7, 2.5, 9.68], yaw: S, pose: 'star' },
  ],
  nav: [[-9, 0, -8.5], [-5, 0, -8.5], [5, 0, -8.5], [9, 0, -8.5], [-9, 0, -1], [9, 0, -1], [0, 0, 1], [-6, 0, 2.5],
    [6, 0, 2.5], [0, 0, 3.0], [-9, 0, 4], [9, 0, 4]],
};

// おかしのまち
MAPS.candy = {
  name: 'おかしのまち',
  outdoor: true,
  sky: '#ffd6ec',
  bounds: { x0: -18, x1: 18, z0: -14, z1: 14, h: 12 },
  seekerSpawn: [16, 0, 12],
  seekerLook: PI / 4,
  hiderSpawn: { c: [0, 3], rx: 3, rz: 1.2 },
  spots: [
    { p: [-13, 0, -5.68], yaw: N, pose: 'stand' },
    { p: [-8.5, 0, -5.68], yaw: N, pose: 'star' },
    { p: [-6.68, 0, -9], yaw: E, pose: 'stand' },
    { p: [-1, 0, 6.68], yaw: S, pose: 'stand' },
    { p: [4, 0, 6.68], yaw: S, pose: 'banzai' },
    { p: [1, 0, 8.52], yaw: N, pose: 'star' },
    { p: [8.68, 0, 10], yaw: W, pose: 'stand' },
    { p: [12, 0, 4.68], yaw: S, pose: 'stand' },
    { p: [-12, 0, 12.68], yaw: S, pose: 'crouch' },
    { p: [9, 0, -3.5], yaw: N, pose: 'stand' },
    { p: [-11, 0, -0.68], yaw: N, pose: 'crouch' },
    { p: [0, 0, 2], yaw: N, pose: 'lie', view: [0, 4.5, 5.5] },
  ],
  nav: [[-9, 0, -3.5], [-4, 0, 0], [2, 0, -3], [6, 0, 1], [13, 0, -3], [14, 0, 2.5], [4, 0, 11], [-8, 0, 11],
    [-14, 0, 2], [-3, 0, -9], [4, 0, -12.5], [14, 0, -12], [-16.5, 0, -4], [0, 0, 10.5], [10, 0, 1], [-5, 0, -13]],
};

// まち
MAPS.city = {
  name: 'まち',
  outdoor: true,
  bounds: { x0: -20, x1: 20, z0: -16, z1: 16, h: 7 },
  seekerSpawn: [18, 0, 1.5],
  seekerLook: PI / 2,
  hiderSpawn: { c: [-6, 0], rx: 2.5, rz: 1.2 },
  spots: [
    { p: [-12, 0.15, -6.75], yaw: N, pose: 'stand' },
    { p: [-8.2, 0.15, -5.95], yaw: N, pose: 'stand' },
    { p: [11, 0.15, -7.25], yaw: N, pose: 'banzai' },
    { p: [16.25, 0.15, -10], yaw: E, pose: 'stand', view: [19.6, 1.6, -10] },
    { p: [13.4, 0.15, 7.95], yaw: S, pose: 'stand' },
    { p: [10, 0.15, 8.75], yaw: S, pose: 'star' },
    { p: [9.5, 0.15, 4.75], yaw: N, pose: 'stand', view: [9.5, 1.6, 8.0] },
    { p: [-12.4, 0.15, 7.75], yaw: S, pose: 'stand' },
    { p: [-15, 0.15, 4.05], yaw: N, pose: 'crouch' },
    { p: [-7.5, 0.15, 13.3], yaw: N, pose: 'crouch', view: [-7.5, 1.6, 15.6] },
    { p: [11, 3.6, -11], yaw: N, pose: 'lie', view: [11, 6.5, -8] },
    { p: [-17, 0.15, -6.75], yaw: N, pose: 'star' },
  ],
  nav: [[-12, 0, 0], [-6, 0, -1.5], [0, 0, 0], [6, 0, 1.5], [12, 0, -1], [17, 0, 0], [-17, 0, -1], [0, 0, -8], [0, 0, -14],
    [1.5, 0, 8], [0, 0, 14], [-12, 0.15, -5], [-6, 0.15, -12], [10, 0.15, -5], [17, 0.15, -12], [3.5, 0.15, -15], [-12, 0.15, 6],
    [-15, 0.15, 13], [-6, 0.15, 9], [12, 0.15, 6], [17, 0.15, 7.5], [5, 0.15, 13]],
};

// うちゅう（おにもうちゅうふくで、どこへでもとんでいける）
MAPS.space = {
  name: 'うちゅう',
  outdoor: true,
  zeroG: true,
  sky: '#05060f',
  bounds: { x0: -16, x1: 16, z0: -12, z1: 12, h: 16 },
  seekerSpawn: [13, 0, 10],
  seekerLook: PI / 4,
  hiderSpawn: { c: [0, 3], rx: 3, rz: 1.2 },
  spots: [
    { p: [7, 0, 8.55], yaw: N, pose: 'stand', view: [7, 1.5, 11.5] },
    { p: [3.25, 0, 0], yaw: E, pose: 'stand' },
    { p: [12, 0.3, -4.85], yaw: N, pose: 'star' },
    { p: [-8, 0, 7.3], yaw: N, pose: 'crouch', view: [-8, 1.6, 11.5] },
    { p: [-5, 7.9, -6], yaw: N, pose: 'stand' },
    { p: [-5, 6.55, -10], yaw: N, pose: 'lie', view: [-5, 11.5, -8] },
    { p: [9, 10.8, 3], yaw: N, pose: 'crouch' },
    { p: [-12, 10.44, 6], yaw: N, pose: 'crouch' },
    { p: [-3, 0, -1.1], yaw: N, pose: 'crouch' },
  ],
  nav: [[-10, 1, -9], [-4, 1, -2], [0, 1, 4], [5, 1, -2], [10, 1, 8], [-12, 1, 2], [13, 1, 0], [-6, 4, 8], [0, 9, -6],
    [-8, 10, -6], [6, 12, -4], [9, 13, 3], [-12, 12, 7], [2, 14, 2], [-2, 5, -10], [12, 8, -10], [0, 3, 10]],
};

// むじんとう
MAPS.island = {
  name: 'むじんとう',
  outdoor: true,
  bounds: { x0: -26, x1: 26, z0: -18, z1: 18, h: 5.4 },
  seekerSpawn: [22, 0, 4],
  seekerLook: PI / 2,
  hiderSpawn: { c: [-3, 6], rx: 3, rz: 1.2 },
  spots: [
    { p: [-1, 0, -9.55], yaw: N, pose: 'stand' },
    { p: [4.15, 0, -6.9], yaw: E, pose: 'stand' },
    { p: [-14, 0, -7.75], yaw: N, pose: 'crouch' },
    { p: [-16, 3.6, -13], yaw: N, pose: 'crouch' },
    { p: [8, 0.3, 9], yaw: N, pose: 'lie', view: [8, 4, 11.8] },
    { p: [12, 0, -5.9], yaw: N, pose: 'crouch' },
    { p: [-8, 0, 2.5], yaw: N, pose: 'stand' },
    { p: [6, 0, -1.5], yaw: N, pose: 'star' },
    { p: [14.5, 0, -10.55], yaw: N, pose: 'crouch' },
    { p: [-10, 0.35, 9], yaw: N, pose: 'lie', view: [-10, 3.5, 12.5] },
    // もり
    { p: [-19, 0, -0.25], yaw: N, pose: 'stand' },
    { p: [-21.5, 0, 4.3], yaw: S, pose: 'crouch' },
    { p: [-22, 0, 9.0], yaw: N, pose: 'crouch' },
    { p: [-24, 0, 3.75], yaw: N, pose: 'stand' },
    // ちんぼつせん
    { p: [23.75, 0.4, 14], yaw: W, pose: 'stand' },
    { p: [12.55, 0.4, 13], yaw: E, pose: 'crouch' },
    { p: [16.6, 0.4, 14.75], yaw: S, pose: 'stand', view: [16.6, 1.9, 12.4] },
    { p: [22, 2.6, 15.95], yaw: S, pose: 'stand' },
  ],
  nav: [[-6, 0, 4], [0, 0, -2], [6, 0, 2], [12, 0, 0], [-12, 0, 0], [-8, 0, -4], [5, 0, -9], [15, 0, -6], [-14, 0, 11],
    [0, 0, 10], [11, 0, 9], [16, 0, 6], [-16, 0, 4], [0, 0, -12.5], [-1, 0, -7.5], [-14, 1.2, -9], [-16, 3.6, -13],
    [-21, 0, 0], [-22, 0, 7], [-25, 0, -6], [-17, 0, 9.5], [22, 0, 0], [22, 0, -10], [0, 0, -16], [-20, 0, -16], [10, 0, -16],
    [18.2, 0, 10.5], [16.5, 0.4, 13.5], [21, 0.4, 14], [21.5, 2.6, 13]],
};

// さどがしま（たらいぶね・金山・たなだ・のうぶたい・トキ）
MAPS.sado = {
  name: 'さどがしま',
  outdoor: true,
  bounds: { x0: -20, x1: 20, z0: -15, z1: 15, h: 5.2 },
  seekerSpawn: [17, 0, 12],
  seekerLook: PI / 4,
  hiderSpawn: { c: [-3, 5], rx: 3, rz: 1.2 },
  spots: [
    { p: [-14, 0, -13.75], yaw: N, pose: 'stand' },
    { p: [-10, 0, -8.75], yaw: N, pose: 'star' },
    { p: [-10.75, 0, -1], yaw: E, pose: 'stand' },
    { p: [-15, 0, 3.25], yaw: N, pose: 'stand' },
    { p: [-2, 0.9, -12.55], yaw: N, pose: 'stand' },
    { p: [12, 0.8, -7.35], yaw: N, pose: 'crouch' },
    { p: [16, 2.4, -14], yaw: N, pose: 'lie', view: [16, 4.6, -11] },
    { p: [-6, 0.55, 11], yaw: N, pose: 'curl', view: [-6, 2.2, 14.2] },
    { p: [6.25, 0, 11], yaw: E, pose: 'crouch' },
    { p: [2, 0, 2.75], yaw: N, pose: 'stand' },
    { p: [-17.5, 0, -6.5], yaw: N, pose: 'crouch', view: [-13, 1.6, -6.2] },
  ],
  nav: [[0, 0, 0], [-6, 0, -3], [6, 0, -2], [-6, 0, 6], [4, 0, 5], [12, 0, 4], [17, 0, 0], [-17, 0, 6], [-11.5, 0, -7],
    [-14, 0, -12], [-2.5, 0.9, -10], [0, 0, -5], [11, 0.4, -5], [14, 1.2, -9], [17, 2.4, -14], [8, 0, 11], [-3, 0, 9], [16, 0, 12]],
};

// 100えんショップ（プレイヤーとおなじ形のお客さんがいる）
MAPS.shop = {
  name: '100えんショップ',
  outdoor: false,
  sky: '#dfe6ec',
  bounds: { x0: -12, x1: 12, z0: -10, z1: 10, h: 3.4 },
  seekerSpawn: [10, 0, 9],
  seekerLook: 0,
  hiderSpawn: { c: [-2, 7.5], rx: 3, rz: 1 },
  spots: [
    { p: [-7.3, 0, -2], yaw: E, pose: 'stand' },
    { p: [-4.7, 0, 1], yaw: W, pose: 'crouch' },
    { p: [0.7, 0, -4], yaw: E, pose: 'star' },
    { p: [4.7, 0, 2], yaw: E, pose: 'stand' },
    { p: [-6, 0, -9.25], yaw: N, pose: 'stand' },
    { p: [-11.25, 0, 4], yaw: E, pose: 'stand' },
    { p: [11.25, 0, -6], yaw: W, pose: 'banzai' },
    { p: [6, 0, 5.75], yaw: S, pose: 'stand' },
    { p: [0, 0, -6.75], yaw: S, pose: 'crouch', view: [0, 1.6, -9.2] },
    { p: [7.8, 0, -2.55], yaw: N, pose: 'crouch' },
  ],
  // お客さん { p, yaw, pose, basket }
  customers: [
    { p: [-10, 0, -3], yaw: W, pose: 'stand', basket: true },
    { p: [-6, 0, 1.2], yaw: E, pose: 'stand' },
    { p: [-2, 0, -4.5], yaw: W, pose: 'crouch' },
    { p: [2, 0, -1.5], yaw: E, pose: 'stand', basket: true },
    { p: [6.2, 0, -5.5], yaw: W, pose: 'stand' },
    { p: [7, 0, 7.8], yaw: S, pose: 'stand', basket: true },
    { p: [10, 0, -8.6], yaw: S, pose: 'crouch' },
    { p: [-9, 0, 8], yaw: N, pose: 'stand' },
    { p: [-2, 0, 4.6], yaw: S, pose: 'stand' },
  ],
  nav: [[-10, 0, -7], [-10, 0, 0], [-10, 0, 5], [-6, 0, -7], [-6, 0, -1], [-6, 0, 5], [-2, 0, -7], [-2, 0, 0], [-2, 0, 6.5],
    [2, 0, -7], [2, 0, 1], [2, 0, 5], [6, 0, -7.5], [6, 0, 0], [9, 0, -6], [10, 0, 4], [5, 0, 8.6], [-5, 0, 8.5], [9.6, 0, 8.6]],
};

export const MAP_IDS = Object.keys(MAPS);

// 地面の高さ（ブロックの世界以外は 0）
export function groundY(mapId, x, z) {
  const m = MAPS[mapId];
  return m && m.heightAt ? m.heightAt(x, z) : 0;
}

// 擬態を合わせる視点
export function spotView(s, dist = 5) {
  if (s.view) return s.view;
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  return [s.p[0] + fx * dist, s.p[1] + 1.5, s.p[2] + fz * dist];
}
