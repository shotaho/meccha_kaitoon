// ステージ用のテクスチャを Canvas で生成する。
// 全員の画面で模様が一致するよう、乱数はシード固定。

import * as THREE from 'three';

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

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function hsl(h, s, l) {
  return `hsl(${h},${s}%,${l}%)`;
}

const cache = new Map();

// 生成した Canvas をキャッシュし、繰り返し回数ごとに Texture を作る
export function tex(name, repeatX = 1, repeatY = 1) {
  let c = cache.get(name);
  if (!c) {
    c = GEN[name]();
    cache.set(name, c);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

const GEN = {
  brick() {
    const [c, g] = canvas(256, 256);
    const r = rng(11);
    g.fillStyle = '#cfc6b8';
    g.fillRect(0, 0, 256, 256);
    const bh = 32;
    const bw = 64;
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < 5; col++) {
        const x = col * bw + off;
        const y = row * bh;
        g.fillStyle = hsl(8 + r() * 14, 45 + r() * 20, 36 + r() * 12);
        g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
        // ざらつき
        for (let i = 0; i < 18; i++) {
          g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
          g.fillRect(x + 3 + r() * (bw - 8), y + 3 + r() * (bh - 8), 3, 2);
        }
      }
    }
    return c;
  },

  woodFloor() {
    const [c, g] = canvas(256, 256);
    const r = rng(22);
    const pw = 256 / 4;
    for (let i = 0; i < 4; i++) {
      for (let seg = 0; seg < 2; seg++) {
        const y0 = seg * 128 + (i % 2) * 64;
        g.fillStyle = hsl(28 + r() * 8, 45 + r() * 10, 48 + r() * 10);
        g.fillRect(i * pw, y0, pw, 128);
        g.fillRect(i * pw, y0 - 256, pw, 128);
        for (let k = 0; k < 10; k++) {
          g.strokeStyle = `rgba(80,40,10,${0.08 + r() * 0.12})`;
          g.lineWidth = 1 + r() * 2;
          const x = i * pw + 4 + r() * (pw - 8);
          g.beginPath();
          g.moveTo(x, y0);
          g.bezierCurveTo(x + r() * 8 - 4, y0 + 40, x + r() * 8 - 4, y0 + 80, x, y0 + 128);
          g.stroke();
        }
        g.fillStyle = 'rgba(40,20,5,.5)';
        g.fillRect(i * pw, y0, pw, 2);
      }
      g.fillStyle = 'rgba(40,20,5,.55)';
      g.fillRect(i * pw, 0, 2, 256);
    }
    return c;
  },

  wallpaper() {
    // 小花柄
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#f3e3c8';
    g.fillRect(0, 0, 128, 128);
    const flower = (x, y, col) => {
      g.fillStyle = col;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.beginPath();
        g.arc(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f2c94c';
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    };
    flower(32, 32, '#e07a8b');
    flower(96, 96, '#7aa6e0');
    g.fillStyle = '#9bbf7a';
    for (const [x, y] of [[96, 32], [32, 96]]) {
      g.beginPath();
      g.ellipse(x, y, 9, 4, 0.6, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  },

  stripes() {
    const [c, g] = canvas(128, 128);
    const cols = ['#4a7bd0', '#e9eef7', '#2f5aa8', '#e9eef7'];
    const w = [44, 12, 8, 64];
    let x = 0;
    for (let i = 0; i < cols.length; i++) {
      g.fillStyle = cols[i];
      g.fillRect(x, 0, w[i], 128);
      x += w[i];
    }
    return c;
  },

  wainscot() {
    const [c, g] = canvas(256, 128);
    g.fillStyle = '#5b3a24';
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#6e4a30';
      g.fillRect(i * 64 + 8, 14, 48, 100);
      g.strokeStyle = '#3e2615';
      g.lineWidth = 3;
      g.strokeRect(i * 64 + 8, 14, 48, 100);
    }
    g.fillStyle = '#3e2615';
    g.fillRect(0, 0, 256, 6);
    return c;
  },

  concrete() {
    const [c, g] = canvas(256, 256);
    const r = rng(33);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        g.fillStyle = hsl(210, 6, 70 + r() * 8);
        g.fillRect(x * 128, y * 128, 128, 128);
      }
    }
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.08})`;
      g.fillRect(r() * 256, r() * 256, 2, 2);
    }
    g.strokeStyle = 'rgba(60,60,70,.45)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, 127, 127);
    g.strokeRect(129, 1, 126, 127);
    g.strokeRect(1, 129, 127, 126);
    g.strokeRect(129, 129, 126, 126);
    // 型枠の穴
    g.fillStyle = 'rgba(40,40,50,.5)';
    for (const [x, y] of [[20, 20], [108, 20], [20, 108], [108, 108]]) {
      for (const [ox, oy] of [[0, 0], [128, 0], [0, 128], [128, 128]]) {
        g.beginPath();
        g.arc(x + ox, y + oy, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
    return c;
  },

  ceiling() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#efefea';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#d4d4cc';
    g.strokeRect(0.5, 0.5, 63, 63);
    return c;
  },

  books() {
    const [c, g] = canvas(512, 512);
    const r = rng(44);
    g.fillStyle = '#6b4426';
    g.fillRect(0, 0, 512, 512);
    const shelves = 5;
    const sh = 512 / shelves;
    for (let s = 0; s < shelves; s++) {
      const y0 = s * sh + 8;
      g.fillStyle = '#3d2412';
      g.fillRect(8, y0, 496, sh - 16);
      let x = 10;
      while (x < 500) {
        const w = 12 + r() * 20;
        const h = (sh - 22) * (0.65 + r() * 0.35);
        if (r() < 0.08) {
          x += w; // すき間
          continue;
        }
        const hue = Math.floor(r() * 360);
        g.fillStyle = hsl(hue, 40 + r() * 40, 30 + r() * 35);
        g.fillRect(x, y0 + (sh - 16) - h, Math.min(w, 502 - x), h);
        g.fillStyle = 'rgba(255,255,255,.35)';
        g.fillRect(x + 2, y0 + (sh - 16) - h + 8, Math.min(w, 502 - x) - 4, 3);
        g.fillRect(x + 2, y0 + (sh - 16) - 14, Math.min(w, 502 - x) - 4, 3);
        x += w + 1;
      }
    }
    return c;
  },

  wood() {
    const [c, g] = canvas(128, 128);
    const r = rng(55);
    g.fillStyle = '#8a5a34';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = `rgba(60,30,10,${0.1 + r() * 0.15})`;
      g.lineWidth = 1 + r() * 2;
      const y = r() * 128;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(40, y + r() * 10 - 5, 80, y + r() * 10 - 5, 128, y);
      g.stroke();
    }
    return c;
  },

  plaid() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#b8323a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(30,30,60,.45)';
    g.fillRect(0, 40, 128, 24);
    g.fillRect(40, 0, 24, 128);
    g.fillStyle = 'rgba(255,230,120,.7)';
    g.fillRect(0, 100, 128, 4);
    g.fillRect(100, 0, 4, 128);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, 10, 128, 6);
    g.fillRect(10, 0, 6, 128);
    return c;
  },

  art() {
    const [c, g] = canvas(512, 320);
    const r = rng(66);
    g.fillStyle = '#f6efe1';
    g.fillRect(0, 0, 512, 320);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = hsl(Math.floor(r() * 360), 70, 55);
      if (r() < 0.5) {
        g.beginPath();
        g.arc(r() * 512, r() * 320, 20 + r() * 70, 0, Math.PI * 2);
        g.fill();
      } else {
        g.save();
        g.translate(r() * 512, r() * 320);
        g.rotate(r() * Math.PI);
        g.fillRect(-60, -20, 60 + r() * 100, 20 + r() * 40);
        g.restore();
      }
    }
    g.strokeStyle = '#111';
    g.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(r() * 512, r() * 320);
      g.lineTo(r() * 512, r() * 320);
      g.stroke();
    }
    // 額縁
    g.strokeStyle = '#c9a227';
    g.lineWidth = 22;
    g.strokeRect(0, 0, 512, 320);
    return c;
  },

  rug() {
    const [c, g] = canvas(512, 384);
    g.fillStyle = '#7d1f2b';
    g.fillRect(0, 0, 512, 384);
    g.fillStyle = '#e8d6a8';
    g.fillRect(20, 20, 472, 344);
    g.fillStyle = '#204a6b';
    g.fillRect(36, 36, 440, 312);
    // ひし形模様
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 8; x++) {
        const cx = 36 + 27.5 + x * 55;
        const cy = 36 + 26 + y * 52;
        g.fillStyle = (x + y) % 2 ? '#e8d6a8' : '#c0443f';
        g.beginPath();
        g.moveTo(cx, cy - 22);
        g.lineTo(cx + 22, cy);
        g.lineTo(cx, cy + 22);
        g.lineTo(cx - 22, cy);
        g.closePath();
        g.fill();
      }
    }
    return c;
  },

  tiles() {
    const [c, g] = canvas(128, 128);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#ffffff' : '#7fb2d9';
        g.fillRect(x * 32, y * 32, 32, 32);
      }
    }
    g.strokeStyle = '#b7c3cc';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo(i * 32, 0);
      g.lineTo(i * 32, 128);
      g.moveTo(0, i * 32);
      g.lineTo(128, i * 32);
      g.stroke();
    }
    return c;
  },

  marble() {
    const [c, g] = canvas(128, 128);
    const r = rng(77);
    g.fillStyle = '#e7e5e0';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 8; i++) {
      g.strokeStyle = `rgba(110,110,120,${0.2 + r() * 0.3})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      let x = r() * 128;
      let y = 0;
      g.moveTo(x, y);
      while (y < 128) {
        x += r() * 20 - 10;
        y += 10 + r() * 10;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return c;
  },

  cabinet() {
    const [c, g] = canvas(256, 128);
    g.fillStyle = '#f2efe6';
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = '#c9c3b2';
      g.lineWidth = 3;
      g.strokeRect(i * 64 + 4, 6, 56, 116);
      g.fillStyle = '#8c8c8c';
      g.fillRect(i * 64 + (i % 2 ? 10 : 50), 56, 4, 18);
    }
    return c;
  },

  fridge() {
    const [c, g] = canvas(128, 256);
    const grd = g.createLinearGradient(0, 0, 128, 0);
    grd.addColorStop(0, '#c9ced3');
    grd.addColorStop(0.5, '#eef1f4');
    grd.addColorStop(1, '#b8bec5');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#7d848c';
    g.fillRect(0, 88, 128, 3);
    g.fillRect(104, 20, 6, 50);
    g.fillRect(104, 110, 6, 80);
    // マグネット
    g.fillStyle = '#ff6b6b';
    g.fillRect(20, 30, 16, 16);
    g.fillStyle = '#ffd93d';
    g.beginPath();
    g.arc(60, 140, 9, 0, Math.PI * 2);
    g.fill();
    return c;
  },

  crate() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#c08a4e';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#8a5a2b';
    g.fillRect(0, 0, 128, 14);
    g.fillRect(0, 114, 128, 14);
    g.fillRect(0, 0, 14, 128);
    g.fillRect(114, 0, 14, 128);
    g.save();
    g.translate(64, 64);
    g.rotate(Math.PI / 4);
    g.fillRect(-80, -8, 160, 16);
    g.restore();
    g.strokeStyle = 'rgba(70,40,10,.4)';
    for (let i = 1; i < 5; i++) {
      g.beginPath();
      g.moveTo(14, i * 25);
      g.lineTo(114, i * 25);
      g.stroke();
    }
    return c;
  },

  cardboard() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#c9a26b';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#a77f49';
    g.fillRect(0, 60, 128, 8);
    g.fillStyle = 'rgba(230,220,180,.85)';
    g.fillRect(54, 0, 20, 128);
    g.fillStyle = '#333';
    g.font = 'bold 18px sans-serif';
    g.fillText('↑↑', 14, 40);
    return c;
  },

  vending() {
    const [c, g] = canvas(128, 256);
    g.fillStyle = '#d7263d';
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#f5f5f5';
    g.fillRect(10, 14, 108, 130);
    const cols = ['#1b998b', '#f46036', '#2e294e', '#ffd166', '#06d6a0', '#118ab2'];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = cols[(i + row * 2) % cols.length];
        g.fillRect(16 + i * 17, 22 + row * 42, 12, 28);
        g.fillStyle = '#ccc';
        g.fillRect(16 + i * 17, 52 + row * 42, 12, 4);
      }
    }
    g.fillStyle = '#222';
    g.fillRect(18, 200, 92, 26);
    g.fillStyle = '#ffd166';
    g.fillRect(96, 160, 14, 24);
    return c;
  },

  candy() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e63946';
    for (let i = -2; i < 6; i++) {
      g.beginPath();
      g.moveTo(i * 32, 0);
      g.lineTo(i * 32 + 16, 0);
      g.lineTo(i * 32 + 16 + 128, 128);
      g.lineTo(i * 32 + 128, 128);
      g.closePath();
      g.fill();
    }
    return c;
  },

  lockers() {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#3f7d5a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = '#2b5a40';
      g.lineWidth = 4;
      g.strokeRect(i * 64 + 2, 2, 60, 252);
      g.fillStyle = '#2b5a40';
      for (let k = 0; k < 4; k++) g.fillRect(i * 64 + 14, 20 + k * 10, 36, 4);
      g.fillStyle = '#c0c0c0';
      g.fillRect(i * 64 + 48, 120, 6, 20);
    }
    return c;
  },

  poster1() {
    const [c, g] = canvas(128, 180);
    g.fillStyle = '#ffd166';
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = '#ef476f';
    g.beginPath();
    g.arc(64, 70, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#073b4c';
    for (let i = 0; i < 4; i++) g.fillRect(14, 126 + i * 12, 100 - i * 18, 6);
    return c;
  },

  poster2() {
    const [c, g] = canvas(128, 180);
    g.fillStyle = '#073b4c';
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = '#06d6a0';
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 4; x++) {
        g.beginPath();
        g.arc(16 + x * 32, 16 + y * 30, 9, 0, Math.PI * 2);
        g.fill();
      }
    }
    return c;
  },

  poster3() {
    const [c, g] = canvas(128, 180);
    const cols = ['#ef476f', '#f78c6b', '#ffd166', '#06d6a0', '#118ab2', '#073b4c'];
    cols.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(0, i * 30, 128, 30);
    });
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(64, 30);
    g.lineTo(104, 150);
    g.lineTo(24, 150);
    g.closePath();
    g.fill();
    return c;
  },

  window() {
    const [c, g] = canvas(256, 192);
    const grd = g.createLinearGradient(0, 0, 0, 192);
    grd.addColorStop(0, '#6fb7f2');
    grd.addColorStop(1, '#cfeafc');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#fff';
    for (const [x, y, s] of [[60, 50, 1], [180, 80, 0.7]]) {
      g.beginPath();
      g.arc(x, y, 18 * s, 0, Math.PI * 2);
      g.arc(x + 20 * s, y - 8 * s, 22 * s, 0, Math.PI * 2);
      g.arc(x + 42 * s, y, 16 * s, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#6f9d4a';
    g.fillRect(0, 160, 256, 32);
    g.strokeStyle = '#f4f4f4';
    g.lineWidth = 12;
    g.strokeRect(0, 0, 256, 192);
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 192);
    g.moveTo(0, 96);
    g.lineTo(256, 96);
    g.stroke();
    return c;
  },

  curtain() {
    const [c, g] = canvas(64, 64);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f6f1e7' : '#d64550';
      g.fillRect(i * 8, 0, 8, 64);
    }
    const grd = g.createLinearGradient(0, 0, 64, 0);
    for (let i = 0; i <= 4; i++) grd.addColorStop(i / 4, i % 2 ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  },

  clock() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(64, 64, 64, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fffaf0';
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(64 + Math.cos(a) * 46 - 3, 64 + Math.sin(a) * 46 - 3, 6, 6);
    }
    g.strokeStyle = '#222';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64, 28);
    g.moveTo(64, 64);
    g.lineTo(90, 72);
    g.stroke();
    return c;
  },

  terracotta() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#c8663b';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#a84f2a';
    g.fillRect(0, 0, 64, 10);
    return c;
  },

  leaves() {
    const [c, g] = canvas(128, 128);
    const r = rng(88);
    g.fillStyle = '#2f7a3a';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = hsl(100 + r() * 40, 50, 25 + r() * 25);
      g.beginPath();
      g.ellipse(r() * 128, r() * 128, 10, 4, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  },

  lampshade() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#f7e7b4';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e2c46f';
    g.fillRect(0, 0, 64, 6);
    g.fillRect(0, 58, 64, 6);
    return c;
  },

  // ===== ハンバーガーショップ =====

  asphalt() {
    const [c, g] = canvas(256, 256);
    const r = rng(101);
    g.fillStyle = '#5b5e63';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) {
      const v = 70 + Math.floor(r() * 60);
      g.fillStyle = `rgba(${v},${v},${v + 4},.5)`;
      g.fillRect(r() * 256, r() * 256, 2, 2);
    }
    return c;
  },

  checker() {
    const [c, g] = canvas(128, 128);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#f4efe6' : '#c8242c';
        g.fillRect(x * 32, y * 32, 32, 32);
      }
    }
    return c;
  },

  redBrick() {
    const [c, g] = canvas(256, 256);
    const r = rng(102);
    g.fillStyle = '#d9cfc2';
    g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 16; row++) {
      const off = row % 2 ? 32 : 0;
      for (let col = -1; col < 5; col++) {
        g.fillStyle = hsl(356 + r() * 8, 55 + r() * 15, 30 + r() * 8);
        g.fillRect(col * 64 + off + 2, row * 16 + 2, 60, 12);
      }
    }
    return c;
  },

  yellowWall() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#f6c533';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 128; i += 16) g.fillRect(i, 0, 6, 128);
    return c;
  },

  wallBand() {
    // 下が赤、上が黄色の内壁
    const [c, g] = canvas(64, 256);
    g.fillStyle = '#f6c533';
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#c8242c';
    g.fillRect(0, 170, 64, 86);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 164, 64, 6);
    return c;
  },

  menuBoard() {
    const [c, g] = canvas(1024, 192);
    g.fillStyle = '#1d1d1f';
    g.fillRect(0, 0, 1024, 192);
    const items = ['burger', 'fries', 'drink', 'burger2', 'nugget', 'ice'];
    items.forEach((it, i) => {
      const x = 12 + i * 168;
      g.fillStyle = i % 2 ? '#c8242c' : '#f6c533';
      g.fillRect(x, 12, 156, 168);
      drawFood(g, it, x + 78, 80, 1.1);
      g.fillStyle = '#ffffff';
      g.fillRect(x + 20, 146, 116, 10);
      g.fillRect(x + 40, 162, 76, 8);
    });
    return c;
  },

  driveMenu() {
    const [c, g] = canvas(256, 192);
    g.fillStyle = '#1d1d1f';
    g.fillRect(0, 0, 256, 192);
    for (let k = 0; k < 6; k++) {
      const x = 10 + (k % 3) * 82;
      const y = 10 + Math.floor(k / 3) * 90;
      g.fillStyle = k % 2 ? '#c8242c' : '#f6c533';
      g.fillRect(x, y, 74, 82);
      drawFood(g, ['burger', 'fries', 'drink', 'nugget', 'ice', 'burger2'][k], x + 37, y + 36, 0.5);
      g.fillStyle = '#fff';
      g.fillRect(x + 10, y + 66, 54, 6);
    }
    return c;
  },

  posterBurger() {
    const [c, g] = canvas(160, 210);
    g.fillStyle = '#c8242c';
    g.fillRect(0, 0, 160, 210);
    drawFood(g, 'burger', 80, 95, 1.2);
    g.fillStyle = '#f6c533';
    g.fillRect(20, 170, 120, 14);
    return c;
  },

  posterFries() {
    const [c, g] = canvas(160, 210);
    g.fillStyle = '#f6c533';
    g.fillRect(0, 0, 160, 210);
    drawFood(g, 'fries', 80, 95, 1.2);
    g.fillStyle = '#c8242c';
    g.fillRect(20, 170, 120, 14);
    return c;
  },

  posterDrink() {
    const [c, g] = canvas(160, 210);
    g.fillStyle = '#2a7bd0';
    g.fillRect(0, 0, 160, 210);
    drawFood(g, 'drink', 80, 95, 1.2);
    g.fillStyle = '#fff';
    g.fillRect(20, 170, 120, 14);
    return c;
  },

  signBurger() {
    const [c, g] = canvas(256, 192);
    g.fillStyle = '#c8242c';
    g.fillRect(0, 0, 256, 192);
    g.strokeStyle = '#f6c533';
    g.lineWidth = 12;
    g.strokeRect(6, 6, 244, 180);
    drawFood(g, 'burger', 128, 96, 1.5);
    return c;
  },

  counterFront() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#c8242c';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f6c533';
    g.fillRect(0, 20, 128, 14);
    g.fillStyle = 'rgba(0,0,0,.15)';
    for (let i = 0; i < 128; i += 32) g.fillRect(i, 40, 2, 88);
    return c;
  },

  stainless() {
    const [c, g] = canvas(128, 128);
    const grd = g.createLinearGradient(0, 0, 128, 128);
    grd.addColorStop(0, '#c7ccd1');
    grd.addColorStop(0.5, '#eef1f3');
    grd.addColorStop(1, '#b4bac0');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(80,90,100,.35)';
    g.strokeRect(1, 1, 126, 126);
    return c;
  },

  grill() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#2b2b2b';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#555';
    g.lineWidth = 3;
    for (let i = 8; i < 128; i += 12) {
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(128, i);
      g.stroke();
    }
    g.fillStyle = '#6b3a1e';
    for (const [x, y] of [[30, 40], [80, 40], [55, 85], [100, 90]]) {
      g.beginPath();
      g.arc(x, y, 14, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  },

  drinkMachine() {
    const [c, g] = canvas(128, 256);
    g.fillStyle = '#d9dde1';
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#c8242c';
    g.fillRect(0, 0, 128, 60);
    const cols = ['#3b1f12', '#f28c28', '#2bb24c', '#2a7bd0'];
    cols.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(10 + i * 29, 70, 22, 40);
      g.fillStyle = '#555';
      g.fillRect(16 + i * 29, 112, 10, 18);
    });
    g.fillStyle = '#9aa1a8';
    g.fillRect(6, 150, 116, 10);
    return c;
  },

  trashBin() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#8a5a34';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#5b3a20';
    g.fillRect(14, 24, 40, 16);
    g.fillRect(74, 24, 40, 16);
    g.fillStyle = '#f6c533';
    g.fillRect(14, 50, 40, 6);
    g.fillStyle = '#2a7bd0';
    g.fillRect(74, 50, 40, 6);
    return c;
  },

  register() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#2b2b2b';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#5fd0ff';
    g.fillRect(8, 8, 48, 24);
    g.fillStyle = '#888';
    for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) g.fillRect(8 + i * 12, 40 + k * 10, 8, 6);
    return c;
  },

  racks() {
    const [c, g] = canvas(128, 256);
    const r = rng(103);
    g.fillStyle = '#9aa1a8';
    g.fillRect(0, 0, 128, 256);
    for (let s = 0; s < 4; s++) {
      g.fillStyle = '#6c7278';
      g.fillRect(0, s * 64 + 58, 128, 6);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = r() < 0.5 ? '#c8242c' : r() < 0.5 ? '#f6c533' : '#e8e2d6';
        g.fillRect(6 + k * 30, s * 64 + 18, 26, 40);
      }
    }
    return c;
  },

  shopWindow() {
    const [c, g] = canvas(256, 128);
    const grd = g.createLinearGradient(0, 0, 256, 128);
    grd.addColorStop(0, '#8fc8ea');
    grd.addColorStop(0.5, '#d8eef9');
    grd.addColorStop(1, '#7dbbe0');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#3a3a3a';
    g.lineWidth = 8;
    g.strokeRect(0, 0, 256, 128);
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 128);
    g.stroke();
    return c;
  },

  awning() {
    const [c, g] = canvas(64, 64);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#c8242c';
      g.fillRect(i * 16, 0, 16, 64);
    }
    return c;
  },

  parking() {
    const [c, g] = canvas(256, 256);
    const r = rng(104);
    g.fillStyle = '#5b5e63';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      const v = 70 + Math.floor(r() * 60);
      g.fillStyle = `rgba(${v},${v},${v + 4},.5)`;
      g.fillRect(r() * 256, r() * 256, 2, 2);
    }
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, 8, 200);
    return c;
  },

  laneArrow() {
    const [c, g] = canvas(128, 256);
    g.clearRect(0, 0, 128, 256);
    g.fillStyle = '#5b5e63';
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#f2f2f2';
    g.fillRect(52, 90, 24, 150);
    g.beginPath();
    g.moveTo(64, 20);
    g.lineTo(110, 100);
    g.lineTo(18, 100);
    g.closePath();
    g.fill();
    return c;
  },

  hazard() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#f6c533';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1d1d1f';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 32, 64);
      g.lineTo(i * 32 + 16, 64);
      g.lineTo(i * 32 + 48, 0);
      g.lineTo(i * 32 + 32, 0);
      g.closePath();
      g.fill();
    }
    return c;
  },

  curb() {
    const [c, g] = canvas(64, 32);
    g.fillStyle = '#c9c9c4';
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#f6c533';
    g.fillRect(0, 0, 32, 32);
    return c;
  },

  hedge() {
    const [c, g] = canvas(128, 128);
    const r = rng(105);
    g.fillStyle = '#2f6b2f';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = hsl(95 + r() * 35, 45, 22 + r() * 22);
      g.beginPath();
      g.arc(r() * 128, r() * 128, 2 + r() * 4, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  },

  glassDark() {
    const [c, g] = canvas(64, 64);
    const grd = g.createLinearGradient(0, 0, 64, 64);
    grd.addColorStop(0, '#2c3e50');
    grd.addColorStop(1, '#5d7a93');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  },

  tire() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#1b1b1b';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3a3a3a';
    for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 3, 64);
    return c;
  },
};

// 食べ物のイラスト（ロゴではない簡単な絵）
function drawFood(g, kind, cx, cy, s) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  const ell = (x, y, rx, ry, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  if (kind === 'burger' || kind === 'burger2') {
    ell(0, -18, 46, 26, '#e0a84a');
    g.fillStyle = '#e0a84a';
    g.fillRect(-46, -18, 92, 12);
    g.fillStyle = '#5bb33a';
    g.fillRect(-50, -6, 100, 8);
    if (kind === 'burger2') {
      g.fillStyle = '#f2c230';
      g.fillRect(-46, 2, 92, 6);
    }
    g.fillStyle = '#5a2d16';
    g.fillRect(-48, 6, 96, 14);
    ell(0, 26, 46, 10, '#d8963c');
    g.fillStyle = '#fff6d8';
    for (const [x, y] of [[-20, -30], [0, -36], [18, -28], [-6, -22]]) ell(x, y, 3, 2, '#fff6d8');
  } else if (kind === 'fries') {
    g.fillStyle = '#f2c230';
    for (let i = -4; i <= 4; i++) g.fillRect(i * 9 - 4, -44 + Math.abs(i) * 4, 8, 50);
    g.fillStyle = '#c8242c';
    g.beginPath();
    g.moveTo(-40, -6);
    g.lineTo(40, -6);
    g.lineTo(30, 44);
    g.lineTo(-30, 44);
    g.closePath();
    g.fill();
  } else if (kind === 'drink') {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(-28, -30);
    g.lineTo(28, -30);
    g.lineTo(20, 44);
    g.lineTo(-20, 44);
    g.closePath();
    g.fill();
    g.fillStyle = '#c8242c';
    g.fillRect(-26, -2, 52, 14);
    g.fillStyle = '#f6c533';
    g.fillRect(4, -56, 6, 30);
  } else if (kind === 'nugget') {
    for (const [x, y] of [[-20, -10], [16, -14], [-6, 14], [24, 16]]) ell(x, y, 18, 13, '#d9a14a');
  } else if (kind === 'ice') {
    g.fillStyle = '#e0a84a';
    g.beginPath();
    g.moveTo(-20, -4);
    g.lineTo(20, -4);
    g.lineTo(0, 46);
    g.closePath();
    g.fill();
    ell(0, -16, 24, 20, '#fff6e8');
    ell(0, -34, 14, 12, '#fff6e8');
  }
  g.restore();
}
