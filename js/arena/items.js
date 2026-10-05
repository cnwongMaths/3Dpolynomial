// Pickup items for the dogfight. Neon crates float in the canyon; E to use.
// Everything is adjudicated locally: offensive uses are handed to the bots
// (the potential victims) through ctx.broadcast, defensive ones just apply.
import * as THREE from 'three';

const RESPAWN = 8;
const PICKUP_R2 = 6 * 6;

export const ITEM_DEFS = {
  shock:  { label: '冲击波', w: 0.30, color: '#72adf7' },
  emp:    { label: '电磁脉冲', w: 0.22, color: '#c27bff' },
  shield: { label: '护盾', w: 0.24, color: '#7dffc7' },
  dash:   { label: '疾冲', w: 0.24, color: '#35e0ff' },
};

const ICONS = {
  shock: '<circle cx="16" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity=".65"/><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".35"/>',
  emp: '<path d="M17 3L7 18h7l-2 11 11-16h-7z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>',
  shield: '<path d="M16 4l10 4v8c0 7-4 11-10 13-6-2-10-6-10-13V8z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>',
  dash: '<path d="M5 8h12M3 16h16M5 24h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M20 8l7 8-7 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

function rollItem() {
  let total = 0;
  for (const k in ITEM_DEFS) total += ITEM_DEFS[k].w;
  let r = Math.random() * total;
  for (const k in ITEM_DEFS) { r -= ITEM_DEFS[k].w; if (r <= 0) return k; }
  return 'shock';
}

// ctx: { scene, glows, dzLoop, zHome, loop, P, leaderId(), applyHit(byId),
//        broadcast(payload), showMsg, sfx, isOn() }
export class ArenaItems {
  constructor(ctx) {
    this.ctx = ctx;
    this.held = null;
    this._buildSlot();
    this._buildCrates();
  }

  _buildSlot() {
    const slot = document.createElement('div');
    slot.id = 'item-slot';
    slot.style.cssText =
      'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:40;display:none;' +
      'width:64px;height:64px;border-radius:12px;align-items:center;justify-content:center;' +
      'background:rgba(5,9,16,.66);border:1.5px solid rgba(114,173,247,.5);' +
      'box-shadow:0 0 18px rgba(114,173,247,.22);pointer-events:none;';
    slot.innerHTML = '<span id="item-icon"></span>' +
      '<span style="position:absolute;right:-7px;bottom:-7px;width:20px;height:20px;border-radius:5px;' +
      'display:flex;align-items:center;justify-content:center;font:700 11px \'Geist Mono\',monospace;' +
      'color:#0a1526;background:linear-gradient(180deg,#cfe4ff,#72adf7)">E</span>';
    document.body.appendChild(slot);
    this.slotEl = slot;
    this.iconEl = slot.querySelector('#item-icon');
  }

  _setHeld(kind) {
    this.held = kind;
    if (!kind) { this.slotEl.style.display = 'none'; return; }
    this.slotEl.style.display = 'flex';
    this.iconEl.innerHTML =
      `<svg viewBox="0 0 32 32" style="width:36px;height:36px;display:block;color:${ITEM_DEFS[kind].color};filter:drop-shadow(0 0 7px currentColor)">${ICONS[kind]}</svg>`;
  }

  _buildCrates() {
    const group = new THREE.Group();
    this.ctx.scene.add(group);
    const shellGeo = new THREE.IcosahedronGeometry(1.6, 0);
    const shellMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#72adf7').multiplyScalar(2.0),
      wireframe: true, transparent: true, opacity: 0.9,
    });
    const coreGeo = new THREE.OctahedronGeometry(0.65, 0);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffffff').multiplyScalar(2.2),
      transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.boxes = [];
    // 4 rows down the loop × 3 crates (lateral + altitude spread)
    const rows = [40, 160, 280, 400];
    const spots = [[-14, 26], [0, 48], [14, 68]];
    for (let ri = 0; ri < rows.length; ri++) {
      const z = this.ctx.zHome - rows[ri];
      for (let k = 0; k < spots.length; k++) {
        const x = spots[k][0];
        const y = spots[(k + ri) % spots.length][1]; // stagger altitudes per row
        const grp = new THREE.Group();
        grp.position.set(x, y, z);
        grp.add(new THREE.Mesh(shellGeo, shellMat));
        grp.add(new THREE.Mesh(coreGeo, coreMat.clone()));
        group.add(grp);
        this.boxes.push({ grp, x, y, z, active: true, respawn: 0, phase: Math.random() * 6.28 });
      }
    }
  }

  // Back to a fresh board (between matches): no held item, every crate live.
  reset() {
    this._setHeld(null);
    for (const b of this.boxes) {
      b.active = true; b.respawn = 0;
      b.grp.visible = true;
      b.grp.scale.setScalar(1);
    }
  }

  use() {
    if (!this.held || !this.ctx.isOn()) return;
    const kind = this.held;
    this._setHeld(null);
    const P = this.ctx.P;
    const r = (v) => Math.round(v * 100) / 100;
    if (kind === 'shock') {
      this.ctx.broadcast({ sub: 'shock', x: r(P.pos.x), y: r(P.pos.y), z: r(P.pos.z) });
      this._burst(P.pos, 26);
      this.ctx.showMsg('SHOCKWAVE!');
      this.ctx.sfx.boom?.();
    } else if (kind === 'emp') {
      const target = this.ctx.leaderId();
      if (target == null) { this.ctx.showMsg('NO TARGET'); this._setHeld(kind); return; }
      this.ctx.broadcast({ sub: 'emp', targetId: target });
      this.ctx.showMsg('EMP FIRED!');
      this.ctx.sfx.zapOut?.();
    } else if (kind === 'shield') {
      P.itemShieldT = 8;
      this.ctx.showMsg('SHIELD UP');
    } else if (kind === 'dash') {
      P.dashUntil = performance.now() + 2500;
      this.ctx.showMsg('DASH!');
      this.ctx.sfx.go?.();
    }
  }

  // my shield eats one incoming hit (bolt or item)
  tryBlock() {
    const P = this.ctx.P;
    if (P.itemShieldT > 0) {
      P.itemShieldT = 0;
      this.ctx.showMsg('BLOCKED!');
      return true;
    }
    return false;
  }

  _burst(p, radius) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      const rr = radius * (0.3 + Math.random() * 0.7);
      this.ctx.glows.push(
        p.x + Math.cos(a) * Math.cos(b) * rr * 0.4,
        p.y + Math.sin(b) * rr * 0.3,
        p.z + Math.sin(a) * Math.cos(b) * rr * 0.4,
        1.4, 2.4, 3.6, 1.1, 0,
      );
    }
  }

  update(dt) {
    const P = this.ctx.P;
    const t = performance.now() / 1000;
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) { b.active = true; b.grp.visible = true; b.grp.scale.setScalar(0.01); }
        continue;
      }
      const pop = Math.min(1, b.grp.scale.x + dt * 3);
      if (pop < 1) b.grp.scale.setScalar(pop);
      b.grp.rotation.y += dt * 1.4;
      b.grp.position.y = b.y + Math.sin(t * 1.8 + b.phase) * 0.6;
      if (this.ctx.isOn() && !this.held) {
        const dz = this.ctx.dzLoop(b.z, P.pos.z);
        const dx = P.pos.x - b.x, dy = P.pos.y - b.grp.position.y;
        if (dx * dx + dy * dy + dz * dz < PICKUP_R2) {
          this._setHeld(rollItem());
          b.active = false; b.respawn = RESPAWN; b.grp.visible = false;
          this.ctx.showMsg(ITEM_DEFS[this.held].label, 900);
          this.ctx.sfx.tick?.();
        }
      }
    }
    if (P.itemShieldT > 0) P.itemShieldT -= dt;
  }
}
