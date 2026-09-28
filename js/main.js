// Paper Wings — bootstrap, game loop, UI states.
import * as THREE from './three.module.min.js';
import { dailyTheme, newScore, applyScore, rankFor, speedAt } from './logic.js';
import { World, makePlane, installCraft, CRAFTS, Input } from './game.js';
import { renderCard, shareCard } from './share.js';
import { showInterstitial } from './ads.js';

const $ = (id) => document.getElementById(id);
const els = {
  hud: $('hud'), score: $('score'), theme: $('theme'),
  start: $('start'), go: $('go'), over: $('over'),
  finalScore: $('finalScore'), finalDetail: $('finalDetail'),
  best: $('best'), share: $('share'), again: $('again'),
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
$('gl').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const p = theme.palette;
const sky = new THREE.Color(p.skyTop).lerp(new THREE.Color(p.skyBot), 0.35);
scene.background = sky;
scene.fog = new THREE.Fog(p.fog, 60, 340);
scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(p.skyBot), 1.4));
const sunLight = new THREE.DirectionalLight(p.sun, 1.6);
sunLight.position.set(-20, 40, -30);
scene.add(sunLight);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
const plane = makePlane();
scene.add(plane);
const world = new World(scene, theme);
const input = new Input(renderer.domElement);

// ------------------------------------------------------------------ state

const BEST_KEY = 'paperWings.best';
const best = Number(localStorage.getItem(BEST_KEY) || 0);
let score = null;
let state = 'title'; // title | flying | crashed
let steer = 0;
let vy = 0;

function reset() {
  score = newScore();
  world.reset();
  plane.position.set(0, 8, 0);
  plane.rotation.set(0.06, 0, 0);
  camera.position.set(0, 9.2, 11);
  vy = 0; steer = 0;
  state = 'flying';
  els.start.hidden = true;
  els.over.hidden = true;
  els.hud.style.opacity = 1;
}

function crash() {
  state = 'crashed';
  const total = score.total;
  if (total > best) localStorage.setItem(BEST_KEY, String(total));
  showOver(total);
}

function showOver(total) {
  els.finalScore.textContent = String(total);
  els.finalDetail.textContent = `${rankFor(total)} · ${Math.floor(score.distance)} m · ${score.rings} rings · ${score.nearMisses} near misses`;
  els.best.textContent = `personal best ${Math.max(best, total)}`;
  els.over.hidden = false;
  try { showInterstitial(document.getElementById('interstitialAd')); } catch {} // ads must never break the game-over flow
}

els.go.addEventListener('click', () => reset());
els.again.addEventListener('click', () => reset());

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

// ?play=1 (from the root landing): straight into the air, no title panel.
// The start panel ships hidden so it never flashes while the modules load.
if (new URLSearchParams(location.search).has('play')) {
  reset();
} else {
  els.start.hidden = false;
}
els.share.addEventListener('click', () => {
  const card = renderCard({ themeName: theme.name, palette: p, score, best: Math.max(best, score.total), rank: rankFor(score.total), url: SITE_URL });
  card.dataset.total = score.total;
  shareCard(card, SITE_URL);
});

els.theme.textContent = `today's sky — ${theme.name}`;
document.getElementById('themeNameSlot').textContent = theme.name;

// ------------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'flying') {
    const speed = speedAt(score.distance, theme.wind);
    plane.position.z -= speed * dt;

    // one button: hold = rise; otherwise gravity. Steering follows pointer X.
    vy += (input.hold ? 26 : -22) * dt;
    vy = Math.max(-18, Math.min(14, vy));
    plane.position.y += vy * dt;

    const targetSteer = input.steerX * 18;
    steer += (targetSteer - steer) * Math.min(1, dt * 8);
    plane.position.x += (steer - plane.position.x) * Math.min(1, dt * 12);

    // banking follows vertical motion for feel
    plane.rotation.z = THREE.MathUtils.clamp(-(steer - plane.position.x) * 0.08 - input.steerX * 0.25, -0.6, 0.6);
    plane.rotation.x = THREE.MathUtils.clamp(0.06 + vy * 0.02, -0.4, 0.5);
    const flame = plane.userData.flame;
    if (flame) flame.scale.y = 0.85 + Math.random() * 0.4;

    // corridor bounds: floor/ceiling/walls are all crashes (paper needs sky)
    if (plane.position.y < -6 || plane.position.y > 30 || Math.abs(plane.position.x) > 24) crash();

    applyScore(score, { meters: speed * dt });

    world.ensureAhead(plane.position.z);
    world.update(plane.position,
      dt,
      () => { applyScore(score, { ring: true }); flash('+50'); },
      () => { applyScore(score, { nearMiss: true }); flash('near miss +10'); },
      () => crash());

    els.score.textContent = String(Math.floor(score.total));

    // camera chase with lag
    camera.position.x += (plane.position.x * 0.55 - camera.position.x) * Math.min(1, dt * 4);
    camera.position.y += (plane.position.y * 0.4 + 6 - camera.position.y) * Math.min(1, dt * 4);
    camera.position.z = plane.position.z + 11;
    camera.lookAt(plane.position.x * 0.5, plane.position.y * 0.5 + 2, plane.position.z - 14);
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

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
requestAnimationFrame(frame);
