// CPU 鬼の頭脳。部屋のホストのブラウザだけで動かし、動きと射撃をサーバー（部屋）に送る。
//
// 見つけ方：視界に入った隠れている人を、その人「あり」「なし」の2枚で小さく描画して比べる。
// 背景とよく馴染んでいれば差が小さく、見つかりにくい。

import * as THREE from 'three';
import { MAPS } from './maps.js';
import { collide, groundAt, ceilingAt } from './world.js';
import { renderPixels } from './camo.js';

const LEVEL = {
  easy: { t0: 0.42, mult: 0.35, speed: 2.6, react: 1.4, miss: 0.05, check: 0.8 },
  normal: { t0: 0.26, mult: 0.6, speed: 3.4, react: 0.9, miss: 0.025, check: 0.6 },
  hard: { t0: 0.13, mult: 0.9, speed: 4.2, react: 0.5, miss: 0.01, check: 0.45 },
};

const PROBE = 96;
const R = 0.3;
const H = 1.7;

/**
 * ctx = { renderer, scene, chars, send, getState, getWorld, myId(), setProbe(targetId, show), endProbe() }
 */
export function createCpuBrains(ctx) {
  const brains = new Map();
  const ray = new THREE.Raycaster();
  const probeCam = new THREE.PerspectiveCamera(40, 1, 0.05, 200);

  function centerOf(char) {
    const box = new THREE.Box3();
    for (const m of char.parts) box.expandByObject(m);
    return box.getCenter(new THREE.Vector3());
  }

  function forward(b) {
    return new THREE.Vector3(-Math.sin(b.yaw) * Math.cos(b.pitch), Math.sin(b.pitch), -Math.cos(b.yaw) * Math.cos(b.pitch));
  }

  function lineOfSight(world, from, to) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    ray.set(from, dir.normalize());
    ray.far = dist;
    const hit = ray.intersectObjects(world.meshes, false)[0];
    return !hit || hit.distance > dist - 0.6;
  }

  function pickTarget(b, world, mapId) {
    const nav = MAPS[mapId].nav;
    let best = null;
    for (let i = 0; i < 6; i++) {
      const p = nav[Math.floor(Math.random() * nav.length)];
      const d = Math.hypot(p[0] - b.pos.x, p[2] - b.pos.z);
      if (d > 2 && (!best || Math.random() < 0.5)) best = p;
    }
    b.target = new THREE.Vector3(...(best || nav[0]));
    b.stuck = 0;
    b.path = [];
  }

  // 隠れている人がどれくらい目立つか（0〜1）と見えている大きさ
  function probe(world, eye, targetId, center) {
    probeCam.position.copy(eye);
    probeCam.lookAt(center);
    probeCam.updateMatrixWorld(true);
    ctx.setProbe(targetId, true);
    const a = renderPixels(ctx.renderer, ctx.scene, probeCam, PROBE);
    ctx.setProbe(targetId, false);
    const b = renderPixels(ctx.renderer, ctx.scene, probeCam, PROBE);
    ctx.endProbe();
    let area = 0;
    let strong = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 15) area++;
      if (d > 70) strong++;
    }
    return { area, ratio: strong / Math.max(1, area) };
  }

  function update(dt) {
    const S = ctx.getState();
    const world = ctx.getWorld();
    if (!S || S.phase !== 'hunt' || S.hostId !== ctx.myId() || world.id !== S.settings.map) {
      brains.clear();
      return;
    }
    const L = LEVEL[S.settings.cpuLevel] || LEVEL.normal;
    const mapId = S.settings.map;
    const alive = new Set();

    for (const p of S.players) {
      if (!p.cpu || p.role !== 'seeker') continue;
      alive.add(p.id);
      let b = brains.get(p.id);
      if (!b) {
        const ch = ctx.chars.get(p.id);
        if (!ch || !ch.target) continue;
        const t = ch.target;
        b = {
          pos: new THREE.Vector3(...t.p),
          yaw: t.look ? t.look[0] : 0,
          pitch: 0,
          vy: 0,
          onGround: true,
          mode: 'wander',
          chaseId: null,
          reactT: 0,
          checkT: Math.random() * L.check,
          sendT: 0,
          time: Math.random() * 10,
          stuck: 0,
          path: [],
        };
        pickTarget(b, world, mapId);
        brains.set(p.id, b);
      }
      b.time += dt;

      // ----- 目標を決める -----
      let goal = b.target;
      let goalDist = 0.8;
      if (b.mode === 'chase') {
        const tp = S.players.find((q) => q.id === b.chaseId);
        const tc = ctx.chars.get(b.chaseId);
        if (!tp || tp.found || tp.role !== 'hider' || !tc) {
          b.mode = 'wander';
          pickTarget(b, world, mapId);
          goal = b.target;
        } else {
          goal = tc.root.position.clone();
          goalDist = 4.5;
        }
      }
      // 高さがちがう場所へはかいだんを通って行く
      const st = MAPS[mapId].stairs;
      if (st && !b.path.length) {
        const up = goal.y > 2.5;
        const high = b.pos.y > 2.5;
        if (up && !high) b.path = [st.bottom, st.top].map((q) => new THREE.Vector3(...q));
        else if (!up && high) b.path = [st.top, st.bottom, st.exit].map((q) => new THREE.Vector3(...q));
      }
      if (b.path.length) {
        const w = b.path[0];
        if (Math.hypot(w.x - b.pos.x, w.z - b.pos.z) < 0.5 && Math.abs(w.y - b.pos.y) < 0.8) b.path.shift();
      }
      const onWay = b.path.length > 0;
      if (onWay) {
        goal = b.path[0];
        goalDist = 0.3;
      }

      // ----- 移動 -----
      const zeroG = !!MAPS[mapId].zeroG;
      const to = goal.clone().sub(b.pos);
      if (zeroG) to.y += b.mode === 'chase' ? 0.3 : 0;
      else to.y = 0;
      const dist = to.length();
      const before = b.pos.clone();
      let wantYaw = b.yaw;
      if (dist > goalDist) {
        to.normalize();
        if (Math.hypot(to.x, to.z) > 0.05) wantYaw = Math.atan2(-to.x, -to.z);
        b.pos.addScaledVector(to, L.speed * dt);
      } else if (b.mode === 'wander' && !onWay) {
        pickTarget(b, world, mapId);
      }
      if (zeroG) {
        // うちゅう：重力なしで、行きたいほうへまっすぐとぶ
        collide(world.colliders, b.pos, R, H, world.bounds);
        const g = groundAt(world.colliders, b.pos.x, b.pos.z, b.pos.y, R, 0.02);
        const top = ceilingAt(world.colliders, b.pos.x, b.pos.z, b.pos.y, R, H, world.bounds);
        b.pos.y = Math.min(Math.max(b.pos.y, g), Math.max(g, top));
        b.vy = 0;
        b.onGround = true;
      } else {
        b.vy -= 13 * dt;
        b.pos.y += b.vy * dt;
        const g0 = groundAt(world.colliders, b.pos.x, b.pos.z, Math.max(b.pos.y, 0), R, 0.42);
        if (b.pos.y <= g0 && b.vy <= 0) {
          b.pos.y = g0;
          b.vy = 0;
        }
        collide(world.colliders, b.pos, R, H, world.bounds, 0.42);
        const g = groundAt(world.colliders, b.pos.x, b.pos.z, Math.max(b.pos.y, 0), R, 0.42);
        if (b.pos.y <= g) {
          b.pos.y = g;
          b.vy = 0;
          b.onGround = true;
        } else {
          b.onGround = false;
        }
        const top = ceilingAt(world.colliders, b.pos.x, b.pos.z, b.pos.y, R, H, world.bounds);
        if (b.pos.y > top) {
          b.pos.y = top;
          b.vy = Math.min(0, b.vy);
        }
      }
      // 段差に引っかかったらジャンプ（うちゅうでは上へよける）、ずっと進めなければ行き先を変える
      if (dist > goalDist) {
        const moved = zeroG ? b.pos.distanceTo(before) : Math.hypot(b.pos.x - before.x, b.pos.z - before.z);
        if (moved < L.speed * dt * 0.3) {
          if (zeroG) b.pos.y = Math.min(b.pos.y + L.speed * dt, world.bounds.h - H);
          else if (b.onGround) b.vy = 6;
          b.stuck += dt;
          if (b.stuck > 1.5) {
            b.mode = 'wander';
            pickTarget(b, world, mapId);
          }
        } else {
          b.stuck = Math.max(0, b.stuck - dt);
        }
      }

      // ----- 視線（進む方向を見つつ、きょろきょろする） -----
      let lookYaw = wantYaw + Math.sin(b.time * 1.3) * 0.7;
      let lookPitch = -0.12 + Math.sin(b.time * 0.7) * 0.18;
      const eye = b.pos.clone().add(new THREE.Vector3(0, 1.55, 0));
      if (b.mode === 'chase') {
        const tc = ctx.chars.get(b.chaseId);
        if (tc) {
          const c = centerOf(tc).sub(eye);
          lookYaw = Math.atan2(-c.x, -c.z);
          lookPitch = Math.atan2(c.y, Math.hypot(c.x, c.z));
        }
      }
      b.yaw = lerpAngle(b.yaw, lookYaw, Math.min(1, dt * 5));
      b.pitch += (lookPitch - b.pitch) * Math.min(1, dt * 5);

      // ----- 撃つ（追跡中） -----
      if (b.mode === 'chase') {
        b.reactT -= dt;
        const tc = ctx.chars.get(b.chaseId);
        if (tc && b.reactT <= 0) {
          const c = centerOf(tc);
          if (eye.distanceTo(c) < 9 && lineOfSight(world, eye, c)) {
            ctx.send({ t: 'cpu', id: p.id, msg: { t: 'shoot', target: b.chaseId, point: c.toArray().map((v) => +v.toFixed(3)) } });
            b.mode = 'wander';
            b.chaseId = null;
            pickTarget(b, world, mapId);
          }
        }
      }

      // ----- 探す -----
      b.checkT -= dt;
      if (b.mode !== 'chase' && b.checkT <= 0) {
        b.checkT = L.check;
        const fw = forward(b);
        let best = null;
        for (const q of S.players) {
          if (q.role !== 'hider' || q.found) continue;
          const tc = ctx.chars.get(q.id);
          if (!tc || !tc.root.visible) continue;
          const c = centerOf(tc);
          const d = c.distanceTo(eye);
          if (d > 18) continue;
          const dir = c.clone().sub(eye).normalize();
          if (dir.dot(fw) < Math.cos(THREE.MathUtils.degToRad(55))) continue;
          if (!lineOfSight(world, eye, c)) continue;
          if (!best || d < best.d) best = { id: q.id, c, d };
        }
        if (best) {
          const { area, ratio } = probe(world, eye, best.id, best.c);
          const sizeF = Math.min(1, area / 150);
          const prob = area < 6 ? 0 : THREE.MathUtils.clamp((ratio - L.t0) / (1 - L.t0), 0, 1) * Math.sqrt(sizeF) * L.mult;
          if (Math.random() < prob) {
            b.mode = 'chase';
            b.path = [];
            b.chaseId = best.id;
            b.reactT = L.react * (0.7 + Math.random() * 0.6);
          } else if (prob > 0.08 && best.d > 4) {
            // あやしいので近づいてみる
            b.target = best.c.clone();
            b.target.y = Math.max(0, best.c.y - 0.9);
          }
        } else if (Math.random() < L.miss) {
          // 早とちりで撃ってしまう（はずれ）
          ray.set(eye, fw);
          ray.far = 30;
          const hit = ray.intersectObjects(world.meshes, false)[0];
          if (hit) ctx.send({ t: 'cpu', id: p.id, msg: { t: 'shoot', target: null, point: hit.point.toArray().map((v) => +v.toFixed(3)) } });
        }
      }

      // ----- 送信 -----
      b.sendT -= dt;
      if (b.sendT <= 0) {
        b.sendT = 0.1;
        const r3 = (v) => Math.round(v * 1000) / 1000;
        ctx.send({
          t: 'cpu',
          id: p.id,
          msg: { t: 'tf', p: [r3(b.pos.x), r3(b.pos.y), r3(b.pos.z)], r: [r3(b.yaw + Math.PI), 0, 0], pose: 'stand', look: [r3(b.yaw), r3(b.pitch)] },
        });
      }
    }
    for (const id of brains.keys()) if (!alive.has(id)) brains.delete(id);
  }

  return { update };
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
