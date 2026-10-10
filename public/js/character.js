// プレイヤーのキャラクター（真っ白な人形）。
// 隠れる側は体の各パーツに Canvas テクスチャを持ち、そこに直接ペイントする。

import * as THREE from 'three';

export const BODY_RADIUS = 0.3;
export const BODY_HEIGHT = 1.7;

// パーツ定義：capsule(r, len) / sphere(r)
const PARTS = [
  { name: 'torso', kind: 'capsule', r: 0.25, len: 0.32, tex: 512 },
  { name: 'head', kind: 'sphere', r: 0.21, tex: 256 },
  { name: 'armL', kind: 'capsule', r: 0.085, len: 0.42, tex: 256 },
  { name: 'armR', kind: 'capsule', r: 0.085, len: 0.42, tex: 256 },
  { name: 'legL', kind: 'capsule', r: 0.12, len: 0.38, tex: 256 },
  { name: 'legR', kind: 'capsule', r: 0.12, len: 0.38, tex: 256 },
];

const HIP_Y = 0.65;

// ポーズ： root=[y, z, rx, rz], torso, head, 手足=[rx, rz]
export const POSES = {
  stand: { label: '立つ', root: [0, 0, 0, 0], torso: 0, head: 0, armL: [0, 0.12], armR: [0, -0.12], legL: [0, 0], legR: [0, 0] },
  crouch: { label: 'しゃがむ', root: [-0.43, 0, 0, 0], torso: 0.15, head: 0, armL: [-0.9, 0.15], armR: [-0.9, -0.15], legL: [-1.45, 0.08], legR: [-1.45, -0.08] },
  curl: { label: '丸まる', root: [-0.4, -0.15, 0, 0], torso: 1.15, head: 0.45, armL: [-1.7, 0.25], armR: [-1.7, -0.25], legL: [-1.9, 0.05], legR: [-1.9, -0.05] },
  lie: { label: '寝そべる', root: [0.26, -0.85, Math.PI / 2, 0], torso: 0, head: -0.3, armL: [-Math.PI + 0.15, 0.2], armR: [-Math.PI + 0.15, -0.2], legL: [0, 0.08], legR: [0, -0.08] },
  banzai: { label: 'バンザイ', root: [0, 0, 0, 0], torso: 0, head: 0, armL: [0, Math.PI - 0.25], armR: [0, -Math.PI + 0.25], legL: [0, 0], legR: [0, 0] },
  star: { label: '大の字', root: [0, 0, 0, 0], torso: 0, head: 0, armL: [0, 1.35], armR: [0, -1.35], legL: [0, 0.35], legR: [0, -0.35] },
  flip: { label: '逆立ち', root: [1.78, 0, 0, Math.PI], torso: 0, head: 0, armL: [0, Math.PI - 0.15], armR: [0, -Math.PI + 0.15], legL: [0, 0.2], legR: [0, -0.2] },
};

function partGeometry(p) {
  if (p.kind === 'sphere') return new THREE.SphereGeometry(p.r, 32, 20);
  return new THREE.CapsuleGeometry(p.r, p.len, 10, 24);
}

// テクスチャ1ピクセルあたりの大きさ（ブラシの太さをメートルで揃えるため）
function texelDensity(p) {
  const circ = 2 * Math.PI * p.r;
  const prof = p.kind === 'sphere' ? Math.PI * p.r : p.len + Math.PI * p.r;
  return Math.sqrt((p.tex / circ) * (p.tex / prof));
}

function makeLabel(text, color) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = 'bold 44px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w;
  c.height = 68;
  g.font = font;
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.beginPath();
  g.roundRect(0, 0, w, 68, 22);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 20, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set((w / 68) * 0.32, 0.32, 1);
  s.renderOrder = 10;
  return s;
}

export class Character {
  constructor({ id, kind = 'hider', name = '' }) {
    this.id = id;
    this.kind = kind; // hider | seeker
    this.root = new THREE.Group();
    this.poseRoot = new THREE.Group();
    this.root.add(this.poseRoot);
    this.root.rotation.order = 'YXZ';
    this.pose = 'stand';
    this.poseNow = structuredClone(POSES.stand);
    this.target = null;
    this.parts = [];
    this.paint = [];
    this.dirty = new Set();
    this.outlines = [];

    this.hip = new THREE.Group();
    this.hip.position.y = HIP_Y;
    this.poseRoot.add(this.hip);

    this.torsoPivot = new THREE.Group();
    this.hip.add(this.torsoPivot);
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.72;
    this.torsoPivot.add(this.headPivot);
    this.armL = new THREE.Group();
    this.armL.position.set(0.3, 0.6, 0);
    this.armR = new THREE.Group();
    this.armR.position.set(-0.3, 0.6, 0);
    this.torsoPivot.add(this.armL, this.armR);
    this.legL = new THREE.Group();
    this.legL.position.set(0.13, 0.02, 0);
    this.legR = new THREE.Group();
    this.legR.position.set(-0.13, 0.02, 0);
    this.hip.add(this.legL, this.legR);

    const pivots = [this.torsoPivot, this.headPivot, this.armL, this.armR, this.legL, this.legR];
    const offsets = [0.36, 0.17, -0.27, -0.27, -0.31, -0.31];

    this.outlineMat = new THREE.MeshBasicMaterial({ color: '#ffd400', side: THREE.BackSide });
    const seekerMat = new THREE.MeshLambertMaterial({ color: '#e23b3b' });

    PARTS.forEach((p, i) => {
      const geo = partGeometry(p);
      let material;
      if (kind === 'hider') {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = p.tex;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        this.paint.push({ canvas, ctx, tex, size: p.tex, density: texelDensity(p) });
        material = new THREE.MeshBasicMaterial({ map: tex });
      } else {
        material = seekerMat;
      }
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.y = offsets[i];
      mesh.userData = { owner: id, part: i };
      pivots[i].add(mesh);
      this.parts.push(mesh);

      const ol = new THREE.Mesh(geo, this.outlineMat);
      ol.scale.setScalar(1 + 0.05 / p.r);
      ol.visible = false;
      ol.raycast = () => {};
      mesh.add(ol);
      this.outlines.push(ol);
    });

    if (kind === 'seeker') {
      // ゴーグル
      const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const black = new THREE.MeshBasicMaterial({ color: '#111111' });
      for (const sx of [-0.08, 0.08]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), white);
        eye.position.set(sx, 0.2, 0.16);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), black);
        pupil.position.set(0, 0, 0.05);
        eye.add(pupil);
        this.headPivot.add(eye);
      }
    }

    this.clearPaint();
    this.setName(name);
  }

  setName(name) {
    if (name === this.name) return;
    this.name = name;
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map.dispose();
    }
    this.label = makeLabel(name, this.kind === 'seeker' ? '#ff9a9a' : '#ffffff');
    this.label.position.y = 2.15;
    this.label.visible = false;
    this.root.add(this.label);
  }

  setOutline(color) {
    for (const o of this.outlines) o.visible = !!color;
    if (color) this.outlineMat.color.set(color);
  }

  setPose(name) {
    if (POSES[name]) this.pose = name;
  }

  // ネットワークから来た位置（補間して近づける）
  setTarget(p, r, pose, look) {
    this.target = { p, r, look };
    this.setPose(pose);
    if (!this.placed) {
      this.placed = true;
      this.snap();
    }
  }

  snap() {
    if (!this.target) return;
    const { p, r } = this.target;
    this.root.position.set(p[0], p[1], p[2]);
    this.root.rotation.set(r[1], r[0], r[2]);
    this.poseNow = structuredClone(POSES[this.pose]);
    this.applyPose();
  }

  update(dt) {
    if (this.target) {
      const k = 1 - Math.exp(-dt * 14);
      const { p, r, look } = this.target;
      this.root.position.x += (p[0] - this.root.position.x) * k;
      this.root.position.y += (p[1] - this.root.position.y) * k;
      this.root.position.z += (p[2] - this.root.position.z) * k;
      this.root.rotation.y = lerpAngle(this.root.rotation.y, r[0], k);
      this.root.rotation.x = lerpAngle(this.root.rotation.x, r[1], k);
      this.root.rotation.z = lerpAngle(this.root.rotation.z, r[2], k);
      if (this.kind === 'seeker' && look) this.lookPitch = look[1];
    }
    // ポーズの補間
    const goal = POSES[this.pose];
    const k = 1 - Math.exp(-dt * 12);
    const n = this.poseNow;
    for (let i = 0; i < 4; i++) n.root[i] += (goal.root[i] - n.root[i]) * k;
    n.torso += (goal.torso - n.torso) * k;
    n.head += (goal.head - n.head) * k;
    for (const key of ['armL', 'armR', 'legL', 'legR']) {
      n[key][0] += (goal[key][0] - n[key][0]) * k;
      n[key][1] += (goal[key][1] - n[key][1]) * k;
    }
    this.applyPose();

    if (this.dirty.size) {
      for (const i of this.dirty) this.paint[i].tex.needsUpdate = true;
      this.dirty.clear();
    }
  }

  applyPose() {
    const n = this.poseNow;
    this.poseRoot.position.set(0, n.root[0], n.root[1]);
    this.poseRoot.rotation.set(n.root[2], 0, n.root[3]);
    this.torsoPivot.rotation.x = n.torso;
    this.headPivot.rotation.x = n.head - (this.kind === 'seeker' ? this.lookPitch || 0 : 0);
    this.armL.rotation.set(n.armL[0], 0, n.armL[1]);
    this.armR.rotation.set(n.armR[0], 0, n.armR[1]);
    this.legL.rotation.set(n.legL[0], 0, n.legL[1]);
    this.legR.rotation.set(n.legR[0], 0, n.legR[1]);
  }

  // ----- ペイント -----

  clearPaint() {
    for (let i = 0; i < this.paint.length; i++) {
      const pt = this.paint[i];
      pt.ctx.fillStyle = '#ffffff';
      pt.ctx.fillRect(0, 0, pt.size, pt.size);
      this.dirty.add(i);
    }
  }

  applyOp(op) {
    if (!this.paint.length) return;
    if (op.k === 'c') return this.clearPaint();
    const pt = this.paint[op.p];
    if (!pt) return;
    const g = pt.ctx;
    const S = pt.size;
    if (op.k === 'f') {
      g.fillStyle = op.c;
      g.fillRect(0, 0, S, S);
    } else if (op.k === 's') {
      g.strokeStyle = g.fillStyle = op.c;
      g.lineWidth = op.r * 2;
      g.lineCap = g.lineJoin = 'round';
      // 横方向はつなぎ目をまたいで描く
      for (const ox of [-S, 0, S]) {
        const pts = op.pts;
        if (pts.length === 2) {
          g.beginPath();
          g.arc(pts[0] * S + ox, (1 - pts[1]) * S, op.r, 0, Math.PI * 2);
          g.fill();
        } else {
          g.beginPath();
          g.moveTo(pts[0] * S + ox, (1 - pts[1]) * S);
          for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * S + ox, (1 - pts[i + 1]) * S);
          g.stroke();
        }
      }
    }
    this.dirty.add(op.p);
  }

  replay(ops) {
    this.clearPaint();
    for (const op of ops) this.applyOp(op);
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of this.parts) m.geometry.dispose();
    for (const p of this.paint) p.tex.dispose();
    if (this.label) this.label.material.map.dispose();
  }
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
