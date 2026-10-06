// Paper Wings — pure game logic. No DOM, no three.js: node-testable.

/** mulberry32 — tiny seeded PRNG. Returns a float in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit seed (FNV-1a). */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ------------------------------------------------------------- daily theme

// Everyone flying on the same calendar date gets the same sky. Deterministic
// from YYYY-MM-DD, so no server and no drift between players' timezones
// beyond the local date they see.
const SKY_WORDS = [
  ['Crimson', 'Cobalt', 'Copper', 'Milk', 'Ember', 'Glacier', 'Violet', 'Saffron',
   'Jade', 'Rose', 'Storm', 'Honey', 'Indigo', 'Salt', 'Foxglove', 'Lantern'],
  ['Harbor', 'Meridian', 'Drift', 'Atlas', 'Reverie', 'Current', 'Aria', 'Basin',
   'Signal', 'Mirage', 'Ledger', 'Nocturne', 'Canyon', 'Parade', 'Interval', 'Lull'],
];

const PALETTES = [
  { skyTop: '#2b1c3d', skyBot: '#ff9e6d', fog: '#e8a07a', sun: '#ffd27d', ink: '#33223f', accent: '#ff6b6b' },
  { skyTop: '#0e2233', skyBot: '#8fd3ff', fog: '#bfe3ff', sun: '#fff3b0', ink: '#123047', accent: '#4cc9f0' },
  { skyTop: '#1d1a2f', skyBot: '#f7b2ad', fog: '#f2c9c4', sun: '#ffe0ac', ink: '#2a2440', accent: '#ef476f' },
  { skyTop: '#13291e', skyBot: '#d8f3a3', fog: '#c9e4a5', sun: '#fff1b8', ink: '#1c3a2a', accent: '#80ed99' },
  { skyTop: '#241a10', skyBot: '#ffd166', fog: '#f4c97b', sun: '#ff7b54', ink: '#3d2b16', accent: '#ef8354' },
  { skyTop: '#101426', skyBot: '#b8c1ec', fog: '#cfd6f6', sun: '#f9f5ff', ink: '#1b2038', accent: '#8f7bff' },
  { skyTop: '#2e1420', skyBot: '#ffb3c6', fog: '#f6c6d3', sun: '#ffe3e3', ink: '#3a1c2a', accent: '#ff8fa3' },
];

/** Today's theme from a local date string 'YYYY-MM-DD'. */
export function dailyTheme(dateStr) {
  const r = rng(hashSeed('paper-wings:' + dateStr));
  const a = SKY_WORDS[0][Math.floor(r() * SKY_WORDS[0].length)];
  const b = SKY_WORDS[1][Math.floor(r() * SKY_WORDS[1].length)];
  const palette = PALETTES[Math.floor(r() * PALETTES.length)];
  const wind = 0.85 + r() * 0.4; // daily global speed multiplier
  return { name: `${a} ${b}`, palette, wind };
}

// The name wears its own color: the first word is the pigment ("Glacier" reads
// glacier-blue, "Ember" ember-orange), the second is mood, not pigment.
export const THEME_INK = {
  Crimson: '#e8394a', Cobalt: '#3f6fe0', Copper: '#c97e45', Milk: '#f7f3e8',
  Ember: '#ff7f3f', Glacier: '#7fd0f0', Violet: '#9d6cf2', Saffron: '#f4b62d',
  Jade: '#3ecf95', Rose: '#ff92a6', Storm: '#8b9ab0', Honey: '#edc06d',
  Indigo: '#6266e8', Salt: '#f1f6fa', Foxglove: '#cf7ae0', Lantern: '#ffc258',
};

/** Ink for a theme name ("Glacier Lull" → glacier blue); `fallback` otherwise. */
export function themeInk(name, fallback = '#ffffff') {
  return THEME_INK[name.split(' ')[0]] ?? fallback;
}

// ------------------------------------------------------------------ scoring

export const RING_BONUS = 100;
export const BOOST_T = 10; // seconds of ×2 a thrill (near miss) lights or refills

export function newScore() {
  return { distance: 0, rings: 0, nearMisses: 0, combo: 0, ringBonus: 0, boostT: 0, total: 0 };
}

/**
 * Ring combo: each clean pass in a row adds one more RING_BONUS — 100, 200,
 * 300… (linear on purpose: doubling per level ran away — a 4-streak outscored
 * a minute of flying). A ring that slips past unflown (a miss) resets the
 * chain back to 100. Rings tucked near the floor or the ceiling (`hard`) pay
 * double — they take a deliberate climb or dive to reach.
 */
export function ringPoints(combo, hard = false) {
  return RING_BONUS * (hard ? 2 : 1) * Math.max(1, combo);
}

/** The spawn band runs −2…22; past ±6 from its middle (10) a ring reads as
 * clearly "up top" or "down low" — that's the hard band. */
export const HARD_RING_BAND = { center: 10, reach: 6 };
export function isHardRing(y) {
  return Math.abs(y - HARD_RING_BAND.center) > HARD_RING_BAND.reach;
}

/** Distance in meters maps 1:1; ring bonuses add. Near misses only count —
 * their payoff is the ×2 boost they light (see thrillBoost), not points. */
export function applyScore(score, { meters = 0, ring = 0, nearMiss = false } = {}) {
  score.distance += meters;
  if (ring) { score.rings += 1; score.ringBonus += ring; }
  if (nearMiss) { score.nearMisses += 1; }
  score.total = Math.floor(score.distance) + score.ringBonus;
  return score;
}

/** A thrill ignites the ×2 boost, or — while it's already burning — fills it
 * back UP TO a full 10s. Never stacks past 10. Returns whether it was already
 * on (true = "refilled", false = "fresh boost"). */
export function thrillBoost(score) {
  const wasOn = score.boostT > 0;
  score.boostT = BOOST_T;
  return wasOn;
}

const RANKS = [
  [0, 'Gust Guest'], [300, 'Breezy Cadet'], [800, 'Paper Ace'], [1500, 'Thermalmancer'],
  [2500, 'Sky Whisperer'], [4000, 'Jet-Stream Pilot'], [6000, 'Cloud Legend'], [9000, 'Wing Poet'],
];

export function rankFor(total) {
  let title = RANKS[0][1];
  for (const [min, name] of RANKS) if (total >= min) title = name;
  return title;
}

// -------------------------------------------------------------- spawn plan

// Corridor the plane flies through (units are world units).
export const CORRIDOR = { halfWidth: 22, bottom: -6, top: 26 };

export const OBSTACLE_TYPES = ['box', 'blade', 'ring'];

/**
 * Obstacle plan for one stretch of track. `salt` reshuffles the layout every
 * run (the day's sky stays themed; the traffic is fresh each flight), while
 * the same (seed, index, salt) always yields the same layout so tests hold.
 */
export function planStretch(seed, index, difficulty, salt = 0) {
  const r = rng(hashSeed(`stretch:${seed}:${index}:${salt}`));
  const count = 4 + Math.floor(r() * 2 + difficulty * 6); // 4..11, thickening by the minute
  const items = [];
  for (let i = 0; i < count; i++) {
    const roll = r();
    // rings get rarer as difficulty rises; boxes/blades dominate
    const type = roll < Math.max(0.12, 0.3 - difficulty * 0.18) ? 'ring'
      : roll < 0.75 ? 'box' : 'blade';
    items.push({
      type,
      x: (r() * 2 - 1) * (CORRIDOR.halfWidth - 3),
      y: CORRIDOR.bottom + 4 + r() * (CORRIDOR.top - CORRIDOR.bottom - 8),
      z: -(index + 1) * 120 - i * (15 - difficulty * 7) - r() * 6,
      size: type === 'ring' ? 3.2 : 1.6 + r() * 2.2,
      spin: r() * Math.PI * 2,
    });
  }
  if (index === 0) {
    // welcome ring: dead ahead of the spawn line, ~1 second in — the first
    // thing everyone meets is a clean, centered scoring ring, not traffic.
    // It's the START gate: controls lock until the plane flies through it.
    items.unshift({ type: 'ring', x: 0, y: 8, z: -20, size: 3.2, spin: 0, start: true });
  }
  // rings own their approach: nothing else within ±28 z-units of a ring, so
  // there's always a clean line in and out — players want to thread them
  // perfectly, and a box hiding next to the rim made that a coin flip.
  // Iterative because close rings' exclusion zones overlap.
  for (const it of items) {
    if (it.type === 'ring') continue;
    for (let guard = 0; guard < 8; guard++) {
      const ring = items.find((o) => o.type === 'ring' && Math.abs(o.z - it.z) < 28);
      if (!ring) break;
      it.z = ring.z + 28 + r() * 6; // shoved to the player side, met before the ring
    }
  }
  return items;
}

/**
 * Craft-vs-obstacle overlap, matched to what the player actually SEES.
 * The old fat spheres killed planes in mid-air next to obstacles ("hit
 * nothing but folded") — now every shape checks its own true volume, and
 * each craft brings its own hitbox radius (sharp rocket = small).
 */
export function collides(plane, item, planeR = 1.1) {
  const dx = plane.x - item.x, dy = plane.y - item.y, dz = plane.z - item.z;
  if (item.type === 'ring') {
    // only the visible torus tube hurts: rim circle radius = size, tube 0.35;
    // the hole is genuinely open — fly through the middle and nothing happens
    if (Math.abs(dz) > 1.6) return false;
    const radial = Math.hypot(dx, dy);
    return Math.abs(radial - item.size) < 0.35 + planeR;
  }
  if (item.type === 'blade') {
    // the spinning bar as it lies RIGHT NOW (def.ang is synced each frame):
    // closest approach from the craft to the 7-long, 0.5-thick segment
    const c = Math.cos(item.spin || 0), s = Math.sin(item.spin || 0);
    const ca = Math.cos(item.ang || 0), sa = Math.sin(item.ang || 0);
    const ux = c * ca, uy = s, uz = -c * sa; // bar direction in world space
    const t = Math.max(-3.5, Math.min(3.5, dx * ux + dy * uy + dz * uz));
    const ex = dx - ux * t, ey = dy - uy * t, ez = dz - uz * t;
    const rr = 0.3 + planeR;
    return ex * ex + ey * ey + ez * ez < rr * rr;
  }
  // box: the mesh is a size×size×size cube — hit its faces, not a sphere around it
  const h = item.size / 2;
  return Math.abs(dx) < h + planeR && Math.abs(dy) < h + planeR && Math.abs(dz) < h + planeR;
}

/** Near miss: passed close by a solid obstacle (not a ring). */
export function nearMiss(plane, item, planeR = 1.1) {
  if (item.type === 'ring') return false;
  const dx = plane.x - item.x, dy = plane.y - item.y, dz = plane.z - item.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const rr = item.size + planeR;
  return d2 < (rr + 2.2) * (rr + 2.2) && d2 >= rr * rr && Math.abs(dz) < 2.5;
}

/** Ring pass: plane center inside the ring hole. */
export function ringPass(plane, item) {
  if (item.type !== 'ring') return false;
  const radial = Math.hypot(plane.x - item.x, plane.y - item.y);
  return Math.abs(plane.z - item.z) < 1.6 && radial < item.size * 0.55;
}

/** Difficulty curve: 0 at takeoff, maxes ~5 minutes in (unbeatable territory). */
export function difficultyAt(meters) {
  return Math.min(1, meters / 5000);
}

/** Base forward speed (units/s) with the daily wind and distance ramp. */
export function speedAt(meters, wind) {
  return (16 + difficultyAt(meters) * 14) * wind;
}
