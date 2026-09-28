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

// ------------------------------------------------------------------ scoring

export const RING_BONUS = 50;
export const NEAR_MISS_BONUS = 10;

export function newScore() {
  return { distance: 0, rings: 0, nearMisses: 0, total: 0 };
}

/** Distance in meters maps 1:1; bonuses add. */
export function applyScore(score, { meters = 0, ring = false, nearMiss = false } = {}) {
  score.distance += meters;
  if (ring) { score.rings += 1; score.total += RING_BONUS; }
  if (nearMiss) { score.nearMisses += 1; score.total += NEAR_MISS_BONUS; }
  score.total = Math.floor(score.distance) + score.rings * RING_BONUS + score.nearMisses * NEAR_MISS_BONUS;
  return score;
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
 * Deterministic obstacle plan for one stretch of track.
 * `difficulty` 0..1 grows with distance; the same (seed, index, difficulty)
 * always yields the same layout, so replays/tests are stable.
 */
export function planStretch(seed, index, difficulty) {
  const r = rng(hashSeed(`stretch:${seed}:${index}`));
  const count = 4 + Math.floor(r() * 3 + difficulty * 4); // 4..10 obstacles
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
      z: -(index + 1) * 120 - i * (14 - difficulty * 4) - r() * 6,
      size: type === 'ring' ? 3.2 : 1.6 + r() * 2.2,
      spin: r() * Math.PI * 2,
    });
  }
  return items;
}

/** Sphere-vs-obstacle overlap. Plane hitbox radius ~1.1. */
export function collides(plane, item) {
  const dx = plane.x - item.x, dy = plane.y - item.y, dz = plane.z - item.z;
  const rr = (item.type === 'ring' ? item.size * 0.55 : item.size) + 1.1;
  // rings are forgiving: pass through the hole, only the rim hurts
  const d2 = dx * dx + dy * dy + dz * dz;
  if (item.type === 'ring') {
    const radial = Math.hypot(dx, dy);
    return Math.abs(dz) < 1.6 && Math.abs(radial - item.size * 0.8) < rr * 0.5;
  }
  return d2 < rr * rr;
}

/** Near miss: passed close by a solid obstacle (not a ring). */
export function nearMiss(plane, item) {
  if (item.type === 'ring') return false;
  const dx = plane.x - item.x, dy = plane.y - item.y, dz = plane.z - item.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const rr = item.size + 1.1;
  return d2 < (rr + 2.2) * (rr + 2.2) && d2 >= rr * rr && Math.abs(dz) < 2.5;
}

/** Ring pass: plane center inside the ring hole. */
export function ringPass(plane, item) {
  if (item.type !== 'ring') return false;
  const radial = Math.hypot(plane.x - item.x, plane.y - item.y);
  return Math.abs(plane.z - item.z) < 1.6 && radial < item.size * 0.55;
}

/** Difficulty curve: 0 at takeoff, approaches 1 around 4km. */
export function difficultyAt(meters) {
  return Math.min(1, meters / 4000);
}

/** Base forward speed (units/s) with the daily wind and distance ramp. */
export function speedAt(meters, wind) {
  return (16 + difficultyAt(meters) * 14) * wind;
}
