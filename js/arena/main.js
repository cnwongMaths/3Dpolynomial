// 多項式戰機 — 數學特訓：飛越霓虹雨峽谷，射中載有正確答案的無人機。
// 場景模組（engine/city/sky/life）把峽谷渲染成無縫 480 米循環。
// 題目來自 mathquiz.js（指數定律 / 多項式加減 / 乘法 / 因式分解），
// 答案由三架無人機攜帶：射中正確答案得分連擊，射錯系統離線 2 秒。
// 無網絡、無伺服器 —— 開啟即玩。
import * as THREE from 'three';
import { Engine } from '../engine.js';
import { loadAssets } from '../assets.js';
import { makeSky, makeEnvironment } from '../sky.js';
import { City } from '../city.js';
import { Life, GlowPool } from '../life.js';
import { WORLD, PLAYER, QUALITY_PRESETS } from '../config.js';
import { clamp, damp, GlobalUniforms, FogUniforms } from '../utils.js';
import { buildShip, poseShip, stepShip, feedHeroLights } from './ship.js';
import { Combat } from './combat.js';
import { AnswerDrones } from './drones.js';
import { genQuestion } from './mathquiz.js';
import { Menu } from './menu.js';

const LOOP = WORLD.chunkLen * WORLD.loopChunks; // 480 m
const Z_HOME = -160;                            // loop window: (Z_HOME - LOOP, Z_HOME]
const MATCH_MS = 180000;                        // 3 分鐘特訓
const COUNTDOWN_MS = 4200;                      // 倒數 3…
const STUN_S = 2.0;                             // 答錯 = 系統離線 2 秒
const STUN_GRACE_S = 1.2;
const RESPAWN_S = 2.6;
const INVULN_S = 2.0;

const MY_COLOR = 0x2a6fe6;

const dzLoop = (z, ref) => {
  let d = (z - ref) % LOOP;
  if (d > LOOP / 2) d -= LOOP;
  if (d < -LOOP / 2) d += LOOP;
  return d;
};

// ------------------------------------------------------------------ sfx ----
const sfx = (() => {
  let ctx = null;
  let enabled = true;
  const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  const env = (dur, gain = 0.05) => {
    const g = ac().createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    g.connect(ctx.destination);
    return g;
  };
  const tone = (freq, type, dur, gain, slide = 0) => {
    if (!enabled) return;
    try {
      const o = ac().createOscillator();
      o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
      o.connect(env(dur, gain));
      o.start(); o.stop(ctx.currentTime + dur + 0.02);
    } catch { /* audio unavailable */ }
  };
  return {
    shot: () => { tone(920, 'sawtooth', 0.09, 0.028, -600); tone(1840, 'square', 0.05, 0.012, -900); },
    hurt: () => { tone(160, 'sawtooth', 0.22, 0.06, -70); tone(70, 'sine', 0.3, 0.07); },
    boom: () => { tone(90, 'sawtooth', 0.65, 0.09, -55); tone(46, 'sine', 0.8, 0.1, -18); },
    kill: () => { tone(660, 'square', 0.09, 0.04); setTimeout(() => tone(990, 'square', 0.12, 0.04), 90); setTimeout(() => tone(1320, 'square', 0.14, 0.035), 190); },
    tick: () => tone(1320, 'sine', 0.07, 0.045),
    go: () => { tone(880, 'square', 0.1, 0.05); setTimeout(() => tone(1320, 'square', 0.16, 0.05), 100); },
    set enabled(v) { enabled = v; },
  };
})();

// ------------------------------------------------------------------ boot ---
export async function boot(rootEl) {
  const $ = id => document.getElementById(id);
  const hud = $('hud'), fade = $('fade');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  rootEl.appendChild(canvas);

  const menu = new Menu({
    onStart: () => startMatch(),
    onResume: () => resumeGame(),
    onRestart: () => startMatch(),
    onQuit: () => quitToMenu(),
    onQuality: (name) => applyQuality(name),
    onSound: (on) => { sfx.enabled = on; },
    onMode: () => {},
  });

  const engine = new Engine(canvas);
  engine.applyQuality(QUALITY_PRESETS[menu.quality]);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.35, 3600);
  camera.position.set(0, 30, Z_HOME + 30);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0x1d2a40, 0x100c14, 1.1));
  const key = new THREE.DirectionalLight(0x8fb4d8, 0.5);
  key.position.set(-40, 90, 30);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xff3d7f, 0.22);
  fill.position.set(50, 30, -60);
  scene.add(fill);
  scene.add(makeSky());
  scene.environment = makeEnvironment(engine.renderer);

  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  window.addEventListener('resize', onResize);
  onResize();

  fade.textContent = '多 項 式 戰 機';
  await loadAssets((p) => { fade.textContent = `載入中 ${Math.round(p * 100)}%`; });
  fade.textContent = '多 項 式 戰 機';

  const city = new City(scene);
  const life = new Life(scene, city);
  life.applyQuality(QUALITY_PRESETS[menu.quality]);
  const glows = new GlowPool(scene, 200);
  city.groundMat.uniforms.tRefl.value = engine.reflRT.texture;

  function applyQuality(name) {
    const q = QUALITY_PRESETS[name];
    engine.applyQuality(q);
    life.applyQuality(q);
  }

  // ---------------------------------------------------------- local state --
  const P = {
    pos: new THREE.Vector3(0, PLAYER.startY, Z_HOME),
    vel: new THREE.Vector3(0, 0, -PLAYER.cruise),
    speed: PLAYER.cruise,
    speedHold: PLAYER.cruise,
    heat: 0, overheated: 0, burnCd: 0, boosting: false, bank: 0,
    alive: true, respawnT: 0, invulnT: 0,
    stunT: 0, stunSpin: 0, stunGraceT: 0,
  };
  let mode = 'menu'; // menu | countdown | playing | paused | over

  // 特訓計分
  let score = 0, combo = 0, bestCombo = 0, nRight = 0, nWrong = 0;
  let current = null;   // 現行題目
  let qTimer = 0;       // 答對後到下一題的延遲（秒）

  function parkAtStart() {
    P.pos.set(0, PLAYER.startY, Z_HOME);
    P.vel.set(0, 0, 0);
    P.speed = 0;
    P.speedHold = PLAYER.cruise;
    P.bank = 0;
    P.heat = 0; P.overheated = 0;
    P.stunT = 0; P.stunGraceT = 0;
    P.alive = true; P.invulnT = 0;
    myShip.group.visible = true;
  }
  let matchStartAt = 0, matchEndAt = 0, pauseStart = 0;
  let shake = 0;
  const sparks = [];

  const myShip = buildShip({ color: MY_COLOR, name: '', showTag: false });
  myShip.group.position.copy(P.pos);
  scene.add(myShip.group);

  // 答錯懲罰：系統離線（操作失靈、機身翻滾下墜）— 與被擊中同一代碼路徑
  function stunPlayer() {
    if (!P.alive || mode !== 'playing') return;
    if (P.stunT > 0 || P.invulnT > 0) return;
    P.stunT = STUN_S;
    P.stunSpin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
    shake = Math.min(1.2, shake + 0.7);
    engine.params.flash = Math.max(engine.params.flash, 0.35);
    sfx.hurt();
    showCenter('系統離線', false, STUN_S * 1000);
  }

  const combat = new Combat({
    scene, glows, dzLoop,
    getMyPos: () => (P.alive ? P.pos : null),
    sfx,
    onSelfHit: () => {}, // 沒有敵方炮火 —— 全部懲罰來自答錯與撞樓
  });

  const drones = new AnswerDrones({
    scene, glows, playerP: P, dzLoop, loop: LOOP, sfx,
    onResolve: (correct, pos) => {
      if (correct) {
        nRight++; combo++; bestCombo = Math.max(bestCombo, combo);
        const gain = 100 + (combo - 1) * 20;
        score += gain;
        explodeAt(pos, 44);
        sfx.kill();
        showCenter(`正確！ +${gain}`, false, 950);
        feedRow(true, `+${gain}${combo > 1 ? ` · ${combo} 連擊` : ''}`);
        qTimer = 1.15; // 短暫慶祝後出下一題
      } else {
        nWrong++;
        combo = 0;
        explodeAt(pos, 22);
        stunPlayer();
        feedRow(false, '答錯 — 離線 2 秒');
      }
      updateScore();
    },
  });

  // --------------------------------------------------------------- input ---
  const keys = new Set();
  const mouse = { x: 0, y: 0 };
  let firing = false, burnQueued = false, boostHeld = false;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { burnQueued = true; e.preventDefault(); }
    if (e.code === 'KeyJ') firing = true;
    if (e.code === 'Escape' && mode === 'playing') pauseGame();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyJ') firing = false; });
  window.addEventListener('mousemove', (e) => {
    mouse.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
    mouse.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
  });
  window.addEventListener('mousedown', () => { firing = true; });
  window.addEventListener('mouseup', () => { firing = false; });
  window.addEventListener('blur', () => { keys.clear(); firing = false; });

  // ---- 觸控：拖動轉向 + 開火 / 加速 / 暫停按鈕
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');
  let steerTouch = null;
  window.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('.tbtn')) continue;
      if (steerTouch === null) steerTouch = { id: t.identifier, x0: t.clientX, y0: t.clientY };
    }
    if (mode === 'playing') e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!steerTouch) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== steerTouch.id) continue;
      mouse.x = clamp((t.clientX - steerTouch.x0) / 100, -1, 1);
      mouse.y = clamp((t.clientY - steerTouch.y0) / 100, -1, 1);
    }
    if (mode === 'playing') e.preventDefault();
  }, { passive: false });
  const endTouch = (e) => {
    if (!steerTouch) return;
    for (const t of e.changedTouches) {
      if (t.identifier === steerTouch.id) {
        steerTouch = null;
        mouse.x = 0; mouse.y = 0;
      }
    }
  };
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);
  const bindBtn = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); up && up(); }, { passive: false });
    el.addEventListener('touchcancel', () => up && up());
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); down(); });
    el.addEventListener('mouseup', () => up && up());
  };
  bindBtn('btn-fire', () => { firing = true; }, () => { firing = false; });
  bindBtn('btn-boost', () => { boostHeld = true; }, () => { boostHeld = false; });
  bindBtn('btn-pause', () => { if (mode === 'playing') pauseGame(); }, null);

  // ----------------------------------------------------------------- hud ---
  const centerEl = $('center-msg'), timerEl = $('timer'), killsEl = $('kills'),
    comboEl = $('combo'), hpFill = $('hp-fill'), heatFill = $('heat-fill'), speedEl = $('speed'),
    feedEl = $('feed'), qtopicEl = $('qtopic'), qtextEl = $('qtext');
  let centerTimer = 0;
  function showCenter(text, sticky = false, ms = 1400) {
    centerEl.textContent = text;
    centerEl.style.opacity = '1';
    clearTimeout(centerTimer);
    if (!sticky) centerTimer = setTimeout(() => { centerEl.style.opacity = '0'; }, ms);
  }
  function feedRow(ok, text) {
    const row = document.createElement('div');
    row.className = ok ? 'ok' : 'no';
    row.textContent = (ok ? '✓ ' : '✗ ') + text;
    feedEl.prepend(row);
    while (feedEl.children.length > 4) feedEl.lastChild.remove();
    setTimeout(() => { row.style.opacity = '0'; setTimeout(() => row.remove(), 600); }, 4200);
  }
  // top bar doubles as the stun-recovery meter: full cyan when in control,
  // draining red while systems are offline
  function updateStunBar() {
    if (P.stunT > 0) {
      hpFill.style.width = `${(P.stunT / STUN_S) * 100}%`;
      hpFill.style.background = '#ff5470';
    } else {
      hpFill.style.width = '100%';
      hpFill.style.background = '#53d5fd';
    }
  }
  function updateScore() {
    killsEl.textContent = String(score);
    comboEl.textContent = combo > 1 ? `連擊 ×${combo}` : '';
  }
  updateStunBar(); updateScore();

  function nextQuestion() {
    current = genQuestion(menu.mode);
    drones.setQuestion(current);
    qtopicEl.textContent = current.topic;
    qtextEl.textContent = current.q;
  }

  function updateChrome() {
    hud.style.opacity = mode === 'menu' ? '0' : '1';
    document.body.classList.toggle('playing', mode === 'countdown' || mode === 'playing');
  }

  // ------------------------------------------------------------ lifecycle --
  function startMatch() {
    score = 0; combo = 0; bestCombo = 0; nRight = 0; nWrong = 0;
    qTimer = 0;
    combat.reset();
    resultsShown = false;
    parkAtStart();
    nextQuestion();
    matchStartAt = Date.now() + COUNTDOWN_MS;
    matchEndAt = matchStartAt + MATCH_MS;
    lastTickShown = -1;
    timerEl.textContent = '3:00';
    mode = 'countdown';
    updateChrome();
    updateScore(); updateStunBar();
  }

  function pauseGame() {
    if (mode !== 'playing') return;
    mode = 'paused';
    firing = false;
    pauseStart = Date.now();
    updateChrome();
    menu.openPause();
  }

  function resumeGame() {
    if (mode !== 'paused') return;
    const held = Date.now() - pauseStart;
    matchStartAt += held; // the clock ignores the pause
    matchEndAt += held;
    mode = 'playing';
    updateChrome();
  }

  function quitToMenu() {
    mode = 'menu';
    firing = false;
    centerEl.style.opacity = '0';
    drones.hide();
    updateChrome();
    menu.toMain();
  }

  // crashing into the grid is the only way to blow up
  function die() {
    if (!P.alive) return;
    P.alive = false;
    P.respawnT = RESPAWN_S;
    P.stunT = 0;
    combo = 0;
    feedRow(false, '撞樓墜毀 — 連擊歸零');
    explodeAt(P.pos);
    engine.params.flash = 0.6;
    shake = 1.6;
    sfx.boom();
    myShip.group.visible = false;
    showCenter('撞上格柵！', false, 1800);
    updateScore();
  }

  function respawn() {
    P.alive = true;
    P.invulnT = INVULN_S;
    P.pos.set((Math.random() - 0.5) * 24, PLAYER.startY, P.pos.z);
    P.vel.set(0, 0, -PLAYER.cruise);
    P.speed = P.speedHold = PLAYER.cruise;
    P.heat = 0; P.overheated = 0; P.bank = 0;
    myShip.group.visible = true;
  }

  function explodeAt(p, n = 60) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      const sp = 5 + Math.random() * 24;
      sparks.push({
        p: p.clone(),
        v: new THREE.Vector3(Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + 5, Math.sin(a) * Math.cos(b) * sp),
        life: 0.5 + Math.random() * 1.0, t: 0, hot: Math.random(),
      });
    }
  }

  let resultsShown = false;
  function showResults() {
    resultsShown = true;
    const total = nRight + nWrong;
    const acc = total ? Math.round((nRight / total) * 100) : 0;
    const title = score >= 1200 ? '王牌 <b>機師</b>'
      : score >= 600 ? '任務 <b>完成</b>'
      : '繼續 <b>操練</b>';
    menu.showResults(title, [
      { k: '課題', v: menu.modeLabel() },
      { k: '分數', v: String(score), me: true },
      { k: '答對', v: `${nRight} 題` },
      { k: '答錯', v: `${nWrong} 題` },
      { k: '準確率', v: `${acc}%` },
      { k: '最佳連擊', v: `×${bestCombo}` },
    ]);
  }

  // ------------------------------------------------------------ main loop --
  let last = performance.now();
  let lastTickShown = -1;
  let menuT = 0, menuZ = Z_HOME + 30; // attract-flight camera state
  const _lastCamPos = new THREE.Vector3().copy(camera.position);
  const camVel = new THREE.Vector3();

  updateChrome();
  menu.toMain();
  fade.style.opacity = '0';
  setTimeout(() => { fade.style.display = 'none'; }, 2700);

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const time = engine.time;
    GlobalUniforms.uTime.value = time;
    const nowMs = Date.now();

    if (mode === 'paused') {
      // frozen sim, live render — the pause menu floats over the held frame
      engine.renderReflection(scene, camera);
      city.groundMat.uniforms.uMirrorVP.value.copy(engine.mirrorVP);
      engine.render(scene, camera, dt);
      return;
    }

    // ---- mode transitions
    if (mode === 'countdown') {
      const remain = matchStartAt - nowMs;
      const c = Math.ceil(remain / 1000);
      if (remain <= 0) { mode = 'playing'; updateChrome(); showCenter('出擊！', false, 1000); sfx.go(); }
      else if (c !== lastTickShown) { lastTickShown = c; showCenter(`準備 ${c}`, true); sfx.tick(); }
    }
    if (mode === 'playing' && nowMs >= matchEndAt && !resultsShown) {
      mode = 'over';
      firing = false;
      updateChrome();
      showCenter('時間到', false, 1600);
      sfx.boom();
      setTimeout(showResults, 1200);
    }

    // ---- 答對後的出題節奏
    const playing = mode === 'playing';
    if (playing && qTimer > 0) {
      qTimer -= dt;
      if (qTimer <= 0) nextQuestion();
    }

    // ---- local ship
    const parked = mode === 'menu' || mode === 'countdown';
    if (P.alive && !playing && !parked) {
      // match over: cruise straight while the results are up
      stepShip(P, dt, { keys: new Set(), mx: 0, my: 0, burn: false });
      if (P.pos.z < Z_HOME - LOOP) { P.pos.z += LOOP; camera.position.z += LOOP; _lastCamPos.z += LOOP; drones.wrap(); }
      myShip.group.position.copy(P.pos);
      poseShip(myShip, P.vel.x, P.vel.y, P.speed, P.bank, dt);
      feedHeroLights(P, myShip.accent);
    } else if (P.alive && parked) {
      // parked on the start line: hover, no forward motion
      burnQueued = false;
      P.pos.x = damp(P.pos.x, 0, 4, dt);
      P.pos.z = damp(P.pos.z, Z_HOME, 4, dt);
      P.pos.y = PLAYER.startY + Math.sin(time * 1.7) * 0.5;
      P.vel.set(0, 0, 0);
      P.speed = damp(P.speed, 0, 3, dt);
      P.bank = damp(P.bank, 0, 4, dt);
      myShip.group.position.copy(P.pos);
      poseShip(myShip, 0, 0, PLAYER.minSpeed, P.bank, dt); // idle thruster shimmer
      feedHeroLights(P, myShip.accent);
    } else if (P.alive) {
      const stunned = P.stunT > 0;
      if (stunned) {
        // systems offline: controls dead, the ship coasts and tumbles
        P.stunT -= dt;
        P.vel.x = damp(P.vel.x, 0, 1.2, dt);
        P.vel.y = damp(P.vel.y, -6, 1.5, dt); // sags out of the sky
        P.speed = damp(P.speed, PLAYER.minSpeed * 0.5, 1.4, dt);
        P.vel.z = -P.speed;
        P.pos.addScaledVector(P.vel, dt);
        if (P.pos.y < 2.0) { P.pos.y = 2.0; P.vel.y = 0; }
        P.bank += P.stunSpin * dt; // uncontrolled roll
        for (let i = 0; i < 2; i++) {
          glows.push(P.pos.x + (Math.random() - 0.5), P.pos.y + 0.3, P.pos.z + Math.random(), 2.6, 1.0, 0.3, 0.7, 0);
        }
        if (P.stunT <= 0) {
          P.stunGraceT = STUN_GRACE_S;
          P.bank = P.bank % (Math.PI * 2);
          showCenter('系統回復', false, 800);
        }
        updateStunBar();
      }
      if (P.stunGraceT > 0) P.stunGraceT -= dt;
      const inputKeys = boostHeld ? new Set([...keys, 'ShiftLeft']) : keys;
      const input = stunned
        ? { keys: new Set(), mx: 0, my: 0, burn: false }
        : { keys: inputKeys, mx: mouse.x, my: mouse.y, burn: burnQueued };
      burnQueued = false;
      if (!stunned) {
        if (P.speed < PLAYER.minSpeed) P.speed = Math.max(P.speed, PLAYER.minSpeed * 0.6); // spool up off the line
        stepShip(P, dt, input);
        if (hpFill.style.width !== '100%') updateStunBar();
      }

      // seamless loop wrap (the city repeats every LOOP meters)
      if (P.pos.z < Z_HOME - LOOP) {
        P.pos.z += LOOP;
        camera.position.z += LOOP;
        _lastCamPos.z += LOOP;
        drones.wrap();
        for (const s of sparks) s.p.z += LOOP;
      }

      // obstacle crash → explode + respawn
      if (playing && P.invulnT <= 0) {
        for (const o of city.obstaclesNear(P.pos.z - 60, P.pos.z + 30)) {
          if (o.isHolo) continue;
          const dx = Math.max(o.min.x - P.pos.x, 0, P.pos.x - o.max.x);
          const dy = Math.max(o.min.y - P.pos.y, 0, P.pos.y - o.max.y);
          const dz = Math.max(o.min.z - P.pos.z, 0, P.pos.z - o.max.z);
          if (Math.hypot(dx, dy, dz) - PLAYER.radius <= 0) { die(); break; }
        }
      }

      if (P.alive) {
        // street skim: sparks + shake, not death
        if (P.pos.y < 2.0) {
          P.pos.y = 2.0;
          P.vel.y = Math.max(P.vel.y, 0);
          shake = Math.max(shake, 0.25);
        }
        myShip.group.position.copy(P.pos);
        poseShip(myShip, P.vel.x, P.vel.y, P.speed, P.bank, dt);
        // invulnerability shimmer after respawn
        if (P.invulnT > 0) {
          P.invulnT -= dt;
          myShip.group.visible = Math.sin(time * 30) > -0.6;
          if (P.invulnT <= 0) myShip.group.visible = true;
        }
        if (playing && firing) combat.tryFire(P, dt);
        else combat.fireCd = Math.min(combat.fireCd, 0.05);
        feedHeroLights(P, myShip.accent);
      }
    } else {
      P.respawnT -= dt;
      if (P.respawnT <= 0 && mode !== 'over') respawn();
    }

    // ---- combat + drones + sparks
    glows.begin();
    combat.update(dt, true); // invulnerable=true：沒有敵彈可傷玩家
    drones.update(dt, time, playing && P.alive, combat);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += dt;
      if (s.t > s.life) { sparks.splice(i, 1); continue; }
      s.v.y -= 22 * dt;
      s.p.addScaledVector(s.v, dt);
      const k = 1 - s.t / s.life;
      const col = s.hot > 0.6 ? [3.4, 2.2, 0.6] : [3.0, 0.8, 0.3];
      glows.push(s.p.x, s.p.y, s.p.z, col[0] * k, col[1] * k, col[2] * k, 0.5 + k * 0.5, 0);
    }
    glows.end();

    // ---- camera: attract flight (menu) / chase (alive) / wreck orbit (dead)
    if (mode === 'menu') {
      menuT += dt;
      menuZ -= 22 * dt;
      if (menuZ < Z_HOME - LOOP) menuZ += LOOP;
      camera.position.set(
        Math.sin(menuT * 0.12) * 14,
        36 + Math.sin(menuT * 0.23) * 6,
        menuZ,
      );
      camera.lookAt(Math.sin(menuT * 0.12 + 0.5) * 8, 30 + Math.sin(menuT * 0.17) * 4, menuZ - 46);
      camera.fov = damp(camera.fov, 62, 4, dt);
    } else if (P.alive) {
      const back = 8.6 + P.speed * 0.022;
      const tp = new THREE.Vector3(
        P.pos.x * 0.92 - P.vel.x * 0.055,
        Math.max(P.pos.y + 2.9 - P.vel.y * 0.03, 2.2),
        P.pos.z + back,
      );
      const look = new THREE.Vector3(P.pos.x + P.vel.x * 0.22, P.pos.y + P.vel.y * 0.16 - 0.4, P.pos.z - 17);
      if (camera.position.distanceTo(tp) > 100) camera.position.copy(tp);
      else {
        camera.position.x = damp(camera.position.x, tp.x, 7.5, dt);
        camera.position.y = damp(camera.position.y, tp.y, 7.5, dt);
        camera.position.z = damp(camera.position.z, tp.z, 14, dt);
      }
      const m = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), P.bank * 0.5));
      camera.quaternion.slerp(q, 1 - Math.exp(-9 * dt));
      const speedN = clamp((P.speed - PLAYER.minSpeed) / (PLAYER.boostSpeed - PLAYER.minSpeed), 0, 1);
      camera.fov = damp(camera.fov, 62 + speedN * 12 + (P.boosting ? 5 : 0), 4, dt);
    } else {
      const t = time * 0.4 + 2.2;
      const c = P.pos;
      const pos = new THREE.Vector3(c.x + Math.cos(t) * 12, Math.max(c.y + 4, 6), c.z + 10 + Math.sin(t) * 5);
      camera.position.lerp(pos, 1 - Math.exp(-2.2 * dt));
      camera.lookAt(c.x, c.y, c.z);
    }
    if (shake > 0.003) {
      camera.rotation.x += (Math.random() - 0.5) * shake * 0.012;
      camera.rotation.y += (Math.random() - 0.5) * shake * 0.012;
      camera.rotation.z += (Math.random() - 0.5) * shake * 0.017;
    }
    shake = Math.max(0, shake - dt * 3.2);
    camera.updateProjectionMatrix();

    // ---- world systems
    const camZ = camera.position.z;
    city.update(camZ, time);
    camVel.copy(camera.position).sub(_lastCamPos).divideScalar(Math.max(dt, 1e-4));
    if (camVel.length() > 400) camVel.set(0, 0, -P.speed); // wrap frame
    _lastCamPos.copy(camera.position);
    life.update(dt, time, camZ, camera.position, camVel, playing);

    engine.params.warp = damp(engine.params.warp, P.boosting && playing ? 1 : 0, 4, dt);
    engine.params.flash = Math.max(0, engine.params.flash - dt * 2.6);
    engine.params.rain = damp(engine.params.rain, 0.55, 1.2, dt);
    FogUniforms.uFogDensity.value = 0.0027;

    // ---- HUD
    if (playing || mode === 'over') {
      const remain = Math.max(0, matchEndAt - nowMs);
      const mm = Math.floor(remain / 60000), ss = Math.floor((remain % 60000) / 1000);
      timerEl.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    }
    speedEl.textContent = `${Math.round(P.speed * 3.6)} 公里/時`;
    heatFill.style.width = `${P.heat}%`;
    heatFill.style.background = P.overheated > 0 ? '#ff5470' : '#53d5fd';

    // ---- render
    engine.renderReflection(scene, camera);
    city.groundMat.uniforms.uMirrorVP.value.copy(engine.mirrorVP);
    engine.render(scene, camera, dt);
  }
  function loop(now) {
    requestAnimationFrame(loop);
    frame(now);
  }
  requestAnimationFrame(loop);

  // debug surface
  window.__arena = {
    get P() { return P; }, get mode() { return mode; },
    get score() { return score; }, get current() { return current; },
    combat, drones,
    LOOP, dzLoop,
    startMatch, quitToMenu,
    endNow: () => { matchEndAt = Math.min(matchEndAt, Date.now()); }, // tests: close out the match
    step: (now) => frame(now), // headless tests: drive frames manually if rAF stalls
  };
}
