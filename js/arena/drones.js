// 答案無人機：每題三架，攜帶選項標籤在玩家前方巡航。
// 射中正確答案 → onResolve(true)；射中錯誤答案 → onResolve(false)，
// 該機報銷（紅色殘骸墜落），玩家受罰離線。全部邏輯在本地判定。
import * as THREE from 'three';
import { makeDrone } from '../assets.js';

const DRONE_KEYS = ['drone08', 'drone10', 'drone06'];
const TINTS = [0x53d5fd, 0xff5cc8, 0xffb54d];
const LANES_X = [-13, 0, 13];
const LANES_Y = [25, 39, 53];
const HIT_R = 3.4;          // 命中球半徑（對學生友善一點）
const DRONE_SPEED = 24;     // 略慢於玩家巡航 27–40，保證追得上

function drawLabel(cv, text, state) {
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  const colors = {
    idle: { bd: 'rgba(83,213,253,.85)', fg: '#eaf6ff', bg: 'rgba(5,9,16,.78)' },
    correct: { bd: 'rgba(110,255,170,.95)', fg: '#c9ffe2', bg: 'rgba(8,32,20,.85)' },
    wrong: { bd: 'rgba(255,84,112,.9)', fg: '#ffb9c4', bg: 'rgba(36,8,14,.85)' },
  }[state];
  c.font = '500 58px "Geist Mono", ui-monospace, monospace';
  const w = Math.min(c.measureText(text).width + 72, cv.width - 12);
  const x = (cv.width - w) / 2;
  c.fillStyle = colors.bg;
  c.strokeStyle = colors.bd;
  c.lineWidth = 3;
  c.beginPath(); c.roundRect(x, 26, w, 108, 14); c.fill(); c.stroke();
  // corner ticks
  c.fillStyle = colors.bd;
  for (const [tx, ty] of [[x - 5, 80], [x + w + 5, 80]]) {
    c.beginPath(); c.arc(tx, ty, 5, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = colors.fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let fs = 58;
  while (fs > 26 && c.measureText(text).width > w - 48) { fs -= 4; c.font = `500 ${fs}px "Geist Mono", ui-monospace, monospace`; }
  c.fillText(text, cv.width / 2, 82);
}

export class AnswerDrones {
  // ctx: { scene, glows, playerP, dzLoop, loop, sfx, onResolve(correct, dronePos) }
  constructor(ctx) {
    this.ctx = ctx;
    this.drones = [];
    this.question = null;   // { answer, choices[3] }
    this.solved = false;    // 正確答案已被擊中，等待下一題
    for (let i = 0; i < 3; i++) {
      const d = makeDrone(DRONE_KEYS[i], { emissiveBoost: 2.4, tint: TINTS[i] });
      const cv = document.createElement('canvas');
      cv.width = 640; cv.height = 160;
      const tex = new THREE.CanvasTexture(cv);
      tex.anisotropy = 4;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
      }));
      sprite.scale.set(11, 2.75, 1);
      sprite.position.set(0, 3.1, 0);
      sprite.renderOrder = 30;
      d.group.add(sprite);
      d.group.visible = false;
      ctx.scene.add(d.group);
      this.drones.push({
        ...d, cv, tex, sprite, text: '', state: 'idle',
        x: 0, y: 40, z: 0, phase: Math.random() * Math.PI * 2,
        fall: 0, vy: 0, spin: 0,
      });
    }
  }

  // 佈置新一題；三架無人機在玩家前方重新就位
  setQuestion(q) {
    this.question = q;
    this.solved = false;
    const P = this.ctx.playerP;
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    q.choices.forEach((text, i) => {
      const d = this.drones[i];
      d.text = text;
      d.state = 'idle';
      d.x = LANES_X[lanes[i]] + (Math.random() - 0.5) * 4;
      d.y = LANES_Y[lanes[i]] + (Math.random() - 0.5) * 6;
      d.z = P.pos.z - 72 - i * 18 - Math.random() * 8;
      d.fall = 0; d.vy = 0;
      d.group.visible = true;
      d.group.rotation.set(0, 0, 0);
      drawLabel(d.cv, text, 'idle');
      d.tex.needsUpdate = true;
    });
  }

  wrap() { for (const d of this.drones) d.z += this.ctx.loop; }

  hide() { for (const d of this.drones) d.group.visible = false; }

  update(dt, time, active, combat) {
    const P = this.ctx.playerP;
    for (const d of this.drones) {
      if (!d.group.visible) continue;
      d.mixer && d.mixer.update(dt);

      if (d.state === 'wrong') {
        // 被擊落的錯誤答案：翻滾墜落
        d.fall += dt;
        d.vy -= 26 * dt;
        d.y += d.vy * dt;
        d.z -= DRONE_SPEED * 0.3 * dt;
        d.group.rotation.z += d.spin * dt;
        d.group.rotation.x += d.spin * 0.6 * dt;
        d.group.position.set(d.x, d.y, d.z);
        this.ctx.glows.push(d.x, d.y, d.z, 2.4, 0.7, 0.4, 0.8, 0);
        if (d.y < 1.5 || d.fall > 3) d.group.visible = false;
      } else {
        // 巡航 + 蛇形漂移，讓瞄準有點挑戰但可預判
        if (active) {
          d.z -= DRONE_SPEED * dt;
          // 飛到玩家身後 → 繞回前方（同一題繼續）
          if (this.ctx.dzLoop(d.z, P.pos.z) > 25) d.z = P.pos.z - 92 - Math.random() * 20;
        }
        const wx = Math.sin(time * 0.9 + d.phase) * 2.6;
        const wy = Math.sin(time * 0.7 + d.phase * 1.7) * 1.8;
        d.group.position.set(d.x + wx, d.y + wy, d.z);
        d.group.rotation.z = Math.sin(time * 0.9 + d.phase + 0.6) * -0.28;
      }

      // 命中判定：只有玩家自己的彈、題目未解、無人機存活時才計
      if (active && !this.solved && d.state === 'idle' && combat) {
        for (const b of combat.bolts) {
          if (!b.active || !b.mine) continue;
          const dz = this.ctx.dzLoop(b.p.z, d.z);
          const dx = b.p.x - d.group.position.x, dy = b.p.y - d.group.position.y;
          if (dx * dx + dy * dy + dz * dz < HIT_R * HIT_R) {
            combat.killBolt(b);
            const correct = d.text === this.question.answer;
            if (correct) {
              this.solved = true;
              drawLabel(d.cv, d.text, 'correct');
              d.tex.needsUpdate = true;
              d.group.visible = false;
            } else {
              d.state = 'wrong';
              d.spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3);
              drawLabel(d.cv, d.text, 'wrong');
              d.tex.needsUpdate = true;
            }
            this.ctx.onResolve(correct, d.group.position.clone());
            break;
          }
        }
      }
    }
  }
}
