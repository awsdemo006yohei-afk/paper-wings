// Paper Wings — bootstrap, game loop, UI states.
import * as THREE from './three.module.min.js';
import { dailyTheme, newScore, applyScore, rankFor, speedAt, ringPoints, themeInk } from './logic.js?v=15';
import { World, makePlane, installCraft, CRAFTS, Input } from './game.js?v=23';
import { renderCard, shareCard } from './share.js';
import { showInterstitial } from './ads.js';

const $ = (id) => document.getElementById(id);
const els = {
  hud: $('hud'), score: $('score'), auto: $('autoPilot'),
  start: $('start'), go: $('go'), over: $('over'),
  finalScore: $('finalScore'), finalDetail: $('finalDetail'),
  best: $('best'), share: $('share'), seeCrash: $('seeCrash'), flyWith: $('flyWith'), overTitle: $('overTitle'),
  craftPrev: $('craftPrev'), craftNext: $('craftNext'), craftName: $('craftName'),
  flash: $('flash'),
};

const dateStr = new Date().toISOString().slice(0, 10);
const theme = { ...dailyTheme(dateStr), seed: [...dateStr].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5) };
const SITE_URL = `${location.origin}${location.pathname}`;

// ------------------------------------------------------------------ three

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; // craft + obstacles drop shadows on the cloud floor
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('gl').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const p = theme.palette;
const sky = new THREE.Color(p.skyTop).lerp(new THREE.Color(p.skyBot), 0.35);
scene.background = sky;
scene.fog = new THREE.Fog(p.fog, 60, 340);
scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(p.skyBot), 1.4));
const SUN_OFF = { x: 0, y: 50, z: -6 }; // sun overhead, a touch ahead: shadows stay under their objects, and vertical rings cast a readable oval instead of a hairline
const sunLight = new THREE.DirectionalLight(p.sun, 2.0);
sunLight.position.set(SUN_OFF.x, SUN_OFF.y, SUN_OFF.z);
sunLight.up.set(1, 0, 0); // lookAt-up for a near-vertical light — the default (0,1,0) is nearly parallel to the view direction
// shadows: one ortho frustum that travels with the plane (endless world) —
// fitted to the whole visible corridor AHEAD so a shadow shows up the moment
// its object does, never a beat later
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 1024);
sunLight.shadow.normalBias = 0.4; // flat-shaded paper needs the slack, or stripes appear
scene.add(sunLight, sunLight.target);
{
  // fit the shadow box to the playable volume (plane-relative: floor to
  // obstacle tops, plus everything ahead out to the fog line). The box is
  // aligned to the light, so project the volume onto the light's own axes —
  // measured from the LIGHT, not the plane (near/far run from the sun out).
  const dir = new THREE.Vector3(-SUN_OFF.x, -SUN_OFF.y, -SUN_OFF.z).normalize();
  // straight-down light: world-up is parallel to dir, so build the basis from
  // world-x instead — same axes sunLight.up hands the shadow camera
  const helper = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, helper).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir);
  const rel = new THREE.Vector3();
  let L = 0, R = 0, B = 0, T = 0, N = 0, F = 0;
  for (const dx of [-45, 45]) for (const dy of [-12, 34]) for (const dz of [24, -370]) {
    rel.set(dx - SUN_OFF.x, dy - SUN_OFF.y, dz - SUN_OFF.z);
    const s = rel.dot(right), t = rel.dot(up), u = rel.dot(dir);
    L = Math.min(L, s); R = Math.max(R, s);
    B = Math.min(B, t); T = Math.max(T, t);
    N = Math.min(N, u); F = Math.max(F, u);
  }
  const pad = 6; // keep bias/softening from clipping box edges
  Object.assign(sunLight.shadow.camera, { left: L - pad, right: R + pad, top: T + pad, bottom: B - pad, near: N - pad, far: F + pad });
  sunLight.shadow.camera.updateProjectionMatrix();
}

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
const plane = makePlane();
scene.add(plane);
const world = new World(scene, theme);
// title framing = the flight chase view, but with the craft floated above
// the start panel so the hangar preview is actually visible. Without the
// camera setup the idling camera sat at the world origin — INSIDE the
// craft — and the preview rendered a dark backface blob (the jet, big
// enough to show it, finally exposed that).
plane.position.set(0, 13.5, 0);
camera.position.set(0, 9.2, 11);
camera.lookAt(0, 6, -14);
const input = new Input(renderer.domElement);

// crash marker: a pulsing ring at the exact collision point — yellow on
// reddish skies, red otherwise — so the player can always see what they hit
const crashMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.8, 1.15, 32),
  new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
);
crashMarker.renderOrder = 999;
crashMarker.visible = false;
scene.add(crashMarker);
const bgHsl = { h: 0, s: 0, l: 0 };
function markCrash(point) {
  crashMarker.position.copy(point);
  scene.background.getHSL(bgHsl);
  crashMarker.material.color.set(bgHsl.s > 0.15 && (bgHsl.h < 0.09 || bgHsl.h > 0.92) ? 0xffd60a : 0xff3b30);
  crashMarker.scale.setScalar(1);
  crashMarker.visible = true;
}
let crashView = false; // "see crash" mode: modal hidden, camera framing the wreck
let crashTimer = null;
function endCrashView() {
  crashView = false;
  els.over.hidden = false;
}
function seeCrash() {
  els.over.hidden = true;
  crashView = true;
  clearTimeout(crashTimer);
  crashTimer = setTimeout(endCrashView, 3200); // back to the modal after a look
}

// ------------------------------------------------------------------ state

const BEST_KEY = 'paperWings.best';
const best = Number(localStorage.getItem(BEST_KEY) || 0);
let score = null;
let state = 'title'; // title | flying | crashed
let steer = 0;
let vy = 0;
let awaitingStart = true; // controls lock until the START ring is cleared
let touchedSinceStart = false; // gravity only joins after the player's first touch post-gate
let autoPilot = false; // straight & level from the current spot — Z or the HUD button

function reset() {
  score = newScore();
  world.reset();
  plane.position.set(0, 8, 0);
  plane.rotation.set(0.06, 0, 0);
  camera.position.set(0, 9.2, 11);
  vy = 0; steer = 0;
  awaitingStart = true;
  touchedSinceStart = false;
  input.steerX = 0; // touch steering holds between runs — clear it on (re)start
  input.clearKeys();
  setAutoPilot(false);
  els.auto.hidden = false;
  // hands-free takeoff: nothing held down at the start → autopilot cruises
  // (the countdown on the pill says it's temporary)
  if (!input.hold && !input.keys.rise && !input.keys.left && !input.keys.right) setAutoPilot(true);
  crashMarker.visible = false;
  crashView = false;
  clearTimeout(crashTimer);
  state = 'flying';
  els.start.hidden = true;
  els.over.hidden = true;
  els.hud.style.opacity = 1;
}

function crash() {
  state = 'crashed';
  els.auto.hidden = true; // no autopilot to toggle when you're folded
  markCrash(plane.position);
  const total = score.total;
  if (total > best) localStorage.setItem(BEST_KEY, String(total));
  showOver(total);
}

function showOver(total) {
  els.finalScore.textContent = String(total);
  const craft = CRAFTS.find((c) => c.id === craftId);
  els.overTitle.textContent = craft?.verb || 'folded.'; // every craft meets its own end
  els.finalDetail.textContent = `${rankFor(total)} · ${Math.floor(score.distance)} m · ${score.rings} rings · ${score.nearMisses} thrills`;
  els.best.textContent = `personal best ${Math.max(best, total)}`;
  refreshFlyWith();
  els.over.hidden = false;
  try { showInterstitial(document.getElementById('interstitialAd')); } catch {} // ads must never break the game-over flow
}

els.go.addEventListener('click', () => reset());

// autopilot: straight and level from wherever the plane is. Z or the HUD
// button toggles; any manual control takes over immediately. It's a
// breather, not a cruise: the pill counts down and it lets go after 10s —
// "on" → 10 → 9 → … → off — so the surrender never comes as a surprise.
const AUTO_HINT = matchMedia('(pointer: coarse)').matches ? '' : ' — z'; // no keyboard hint where there's no keyboard
const AUTO_T_MS = 10000;
let autoTimer = null;
let autoCount = null;
let autoSteerMark = 0; // steerX when autopilot engaged — any change past this means hands on
function setAutoPilot(v) {
  autoPilot = v;
  clearTimeout(autoTimer);
  clearInterval(autoCount);
  if (v) {
    autoSteerMark = input.steerX;
    let n = 0;
    els.auto.classList.add('on');
    els.auto.textContent = `autopilot on${AUTO_HINT}`;
    autoCount = setInterval(() => {
      n += 1;
      if (n < AUTO_T_MS / 1000) els.auto.textContent = `autopilot ${11 - n}`; // 10 … 2, then off
    }, 1000);
    autoTimer = setTimeout(() => {
      setAutoPilot(false);
      els.auto.textContent = 'autopilot off'; // the pill says it too, then settles back
      setTimeout(() => { if (!autoPilot) els.auto.textContent = `autopilot${AUTO_HINT}`; }, 1200);
      if (state === 'flying') flash('autopilot off'); // say WHY the plane started sinking
    }, AUTO_T_MS);
  } else {
    els.auto.classList.remove('on');
    els.auto.textContent = `autopilot${AUTO_HINT}`;
  }
}
els.auto.addEventListener('click', () => setAutoPilot(!autoPilot));
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyZ' && !e.repeat) setAutoPilot(!autoPilot);
});
// Enter = the panel's primary action: Take flight on the title,
// Fly with [craft] on the score modal
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
    if (!els.start.hidden) { e.preventDefault(); els.go.click(); }
    else if (!els.over.hidden) { e.preventDefault(); els.flyWith.click(); }
  }
});
window.__pw = { plane, input, state: () => state, auto: () => autoPilot }; // test hook (headless verification)

// hangar: pick your craft — curated, family-friendly models only
const CRAFT_KEY = 'paperWings.craft';
let craftId = localStorage.getItem(CRAFT_KEY);
if (!CRAFTS.some((c) => c.id === craftId)) craftId = CRAFTS[0].id;
function applyCraft() {
  installCraft(plane, craftId, theme)
    .then((c) => { els.craftName.textContent = c.name; })
    .catch(() => {}); // a failed asset load must never take the game down
}
function cycleCraft(d) {
  const i = CRAFTS.findIndex((c) => c.id === craftId);
  craftId = CRAFTS[(i + d + CRAFTS.length) % CRAFTS.length].id;
  localStorage.setItem(CRAFT_KEY, craftId);
  applyCraft();
}
els.craftPrev.addEventListener('click', () => cycleCraft(-1));
els.craftNext.addEventListener('click', () => cycleCraft(1));
applyCraft();

// score modal: fly with a different craft (restart) · share the card
const nextCraft = () => CRAFTS[(CRAFTS.findIndex((c) => c.id === craftId) + 1) % CRAFTS.length];
function refreshFlyWith() { els.flyWith.textContent = `Fly with ${nextCraft().name}`; }
els.flyWith.addEventListener('click', () => {
  craftId = nextCraft().id;
  localStorage.setItem(CRAFT_KEY, craftId);
  applyCraft();
  refreshFlyWith();
  reset();
});
const scoreCard = () => {
  const card = renderCard({ themeName: theme.name, palette: p, score, best: Math.max(best, score.total), rank: rankFor(score.total), url: SITE_URL });
  card.dataset.total = score.total;
  return card;
};
els.share.addEventListener('click', () => shareCard(scoreCard(), `I scored ${Math.floor(score.total)} — beat me?`));
els.seeCrash.addEventListener('click', seeCrash);
renderer.domElement.addEventListener('pointerdown', () => { if (crashView) endCrashView(); }); // tap = done looking

// ?play=1 (from the root landing): straight into the air, no title panel.
// The start panel ships hidden so it never flashes while the modules load.
if (new URLSearchParams(location.search).has('play')) {
  reset();
} else {
  els.start.hidden = false;
}
// the sky's name wears the color it says ("Glacier Lull" in glacier blue) —
// on the start panel; the in-flight HUD stays minimal (just the score)
document.getElementById('themeNameSlot').style.color = themeInk(theme.name, p.accent);

// ------------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'flying') {
    const speed = speedAt(score.distance, theme.wind);
    plane.position.z -= speed * dt;

    // one button: hold = rise; otherwise gravity. Steering follows pointer X
    // or A/D / ←/→, which drift the held line a little and never recenter.
    // W/S/↑ rise. Any manual control takes over from the autopilot.
    const holding = input.hold || input.keys.rise;
    // any manual control takes over — including moving the mouse/touch, i.e.
    // steering away from where the plane sat when autopilot engaged
    if (autoPilot && (holding || input.keys.left || input.keys.right
      || Math.abs(input.steerX - autoSteerMark) > 0.02)) setAutoPilot(false);
    const steerIn = input.steer(dt);

    // START gate: until the first ring is cleared the plane flies straight
    // and level and input is ignored — the opening is the same clean
    // line for everyone, and taking off on a phone never means an instant dive.
    if (awaitingStart || autoPilot) {
      vy = 0; // autopilot: straight and level from wherever the plane is
    } else {
      if (holding || input.steerX !== 0 || input.keys.left || input.keys.right) touchedSinceStart = true;
      if (!touchedSinceStart) {
        vy = 0; // coast level after the gate until the player's first touch — no surprise dive
      } else {
        vy += (holding ? 26 : -22) * dt;
        vy = Math.max(-18, Math.min(14, vy));
      }
    }
    plane.position.y += vy * dt;

    const targetSteer = (awaitingStart || autoPilot) ? plane.position.x : steerIn * layout.reach;
    steer += (targetSteer - steer) * Math.min(1, dt * 8);
    plane.position.x += (steer - plane.position.x) * Math.min(1, dt * 12);

    // banking follows vertical motion for feel (locked level before the gate / on autopilot)
    plane.rotation.z = (awaitingStart || autoPilot) ? 0
      : THREE.MathUtils.clamp(-(steer - plane.position.x) * 0.08 - steerIn * 0.25, -0.6, 0.6);
    plane.rotation.x = THREE.MathUtils.clamp(0.06 + vy * 0.02, -0.4, 0.5);
    const flame = plane.userData.flame;
    if (flame) flame.scale.y = 0.85 + Math.random() * 0.4;

    // keep the shadow frustum centered on the plane (same sun direction as always)
    sunLight.position.set(plane.position.x + SUN_OFF.x, plane.position.y + SUN_OFF.y, plane.position.z + SUN_OFF.z);
    sunLight.target.position.copy(plane.position);

    // corridor bounds: only the VISIBLE cloud decks are crashes now (paper
    // needs sky) — steering can never reach the sides, so no wall deaths
    if (plane.position.y < -6 || plane.position.y > 29.5) crash();

    applyScore(score, { meters: speed * dt });

    world.ensureAhead(plane.position.z);
    world.update(plane.position,
      dt,
      (e) => {
        if (e.def.start) { awaitingStart = false; flash('start'); return; } // gate, not a score
        score.combo += 1;
        const pts = ringPoints(score.combo);
        applyScore(score, { ring: pts });
        flash(score.combo > 1 ? `+${pts} ×${score.combo}` : `+${pts}`);
      },
      () => { applyScore(score, { nearMiss: true }); flash('thrill +10'); },
      () => crash(),
      () => { // ring slipped past unflown — the combo chain breaks
        if (score.combo > 1) flash('combo lost');
        score.combo = 0;
      });

    els.score.textContent = String(Math.floor(score.total));

    // camera chase with lag — the classic framing (a deeper pitch to show the
    // plane's shadow read as a balance change, so it stays retired)
    camera.position.x += (plane.position.x * 0.55 - camera.position.x) * Math.min(1, dt * 4);
    camera.position.y += (plane.position.y * 0.4 + 6 - camera.position.y) * Math.min(1, dt * 4);
    camera.position.z = plane.position.z + layout.camDist;
    camera.lookAt(plane.position.x * 0.5, plane.position.y * 0.5 + 2, plane.position.z - 14);
  }

  if (state === 'crashed') {
    crashMarker.lookAt(camera.position);
    crashMarker.scale.setScalar(1 + 0.18 * Math.sin(now / 140));
    if (crashView) camera.lookAt(crashMarker.position);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

let flashTimer = null;
function flash(text) {
  els.flash.textContent = text;
  els.flash.style.opacity = 1;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { els.flash.style.opacity = 0; }, 700);
}

// portrait phones are a different game: pull the camera back, squeeze the
// steering reach and the obstacle corridor into what's actually on screen.
// Landscape caps the playfield at 4:3 even on ultrawide monitors — the extra
// screen shows more mountains, not more obstacles (letterbox with terrain,
// not black bars)
const layout = { camDist: 11, reach: 18 };
function updateLayout() {
  const playAspect = Math.min(camera.aspect, 4 / 3);
  layout.camDist = camera.aspect >= 1 ? 11 : 11 + (1 - camera.aspect) * 10;
  const halfW = Math.tan((camera.fov * Math.PI) / 360) * layout.camDist * playAspect;
  layout.reach = Math.min(18, halfW * 0.9);
  world.narrow = Math.min(1, (layout.reach + 1.5) / 19);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  updateLayout();
});
updateLayout();
requestAnimationFrame(frame);
