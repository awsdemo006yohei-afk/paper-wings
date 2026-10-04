import assert from 'node:assert/strict';
import {
  rng, hashSeed, dailyTheme, newScore, applyScore, rankFor,
  planStretch, collides, nearMiss, ringPass, difficultyAt, speedAt, ringPoints,
  CORRIDOR, RING_BONUS, NEAR_MISS_BONUS,
} from '../js/logic.js';

let passed = 0;
const fails = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.log(`# FAIL ${name}\n#       ${e.message}`); }
}

await test('rng is deterministic for the same seed', () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});
await test('rng values stay in [0,1)', () => {
  const r = rng(7);
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});
await test('hashSeed is stable and spreads', () => {
  assert.equal(hashSeed('paper-wings:2026-09-28'), hashSeed('paper-wings:2026-09-28'));
  assert.notEqual(hashSeed('2026-09-28'), hashSeed('2026-09-29'));
});
await test('dailyTheme: same date, same sky — different date, (very likely) different name', () => {
  const a = dailyTheme('2026-09-28'), b = dailyTheme('2026-09-28'), c = dailyTheme('2026-09-29');
  assert.equal(a.name, b.name);
  assert.deepEqual(a.palette, b.palette);
  assert.equal(a.wind, b.wind);
  assert.notEqual(a.name, c.name);
});
await test('dailyTheme: wind stays in a sane band and name is two words', () => {
  for (let d = 1; d <= 28; d++) {
    const t = dailyTheme(`2026-02-${String(d).padStart(2, '0')}`);
    assert.ok(t.wind >= 0.85 && t.wind <= 1.25, `wind ${t.wind} out of band on day ${d}`);
    assert.equal(t.name.split(' ').length, 2);
    assert.ok(t.palette.skyTop && t.palette.accent);
  }
});
await test('scoring: distance accumulates, ring/near-miss bonuses add', () => {
  const s = newScore();
  applyScore(s, { meters: 10 });
  applyScore(s, { meters: 5.5, ring: RING_BONUS });
  applyScore(s, { nearMiss: true });
  assert.equal(s.rings, 1);
  assert.equal(s.nearMisses, 1);
  assert.equal(s.total, 15 + RING_BONUS + NEAR_MISS_BONUS);
});
await test('ring combo climbs linearly (50, 100, 150) and resets on a miss', () => {
  assert.equal(ringPoints(1), 50);
  assert.equal(ringPoints(2), 100);
  assert.equal(ringPoints(3), 150);
  assert.equal(ringPoints(4), 200);
  const s = newScore();
  for (const c of [1, 2, 3]) applyScore(s, { ring: ringPoints(c) });
  assert.equal(s.ringBonus, 300);
  s.combo = 0; // a ring slipped past unflown
  applyScore(s, { ring: ringPoints(s.combo + 1) });
  assert.equal(s.ringBonus, 350, 'chain restarts at 50 after a miss');
});
await test('rankFor climbs with score', () => {
  assert.equal(rankFor(0), 'Gust Guest');
  assert.equal(rankFor(300), 'Breezy Cadet');
  assert.equal(rankFor(9500), 'Wing Poet');
});
const OBSTACLE_TYPES_SAFE = ['box', 'blade', 'ring'];
await test('planStretch is deterministic and in-bounds', () => {
  const a = planStretch('seed-x', 3, 0.5), b = planStretch('seed-x', 3, 0.5);
  assert.deepEqual(a, b);
  for (const it of a) {
    assert.ok(OBSTACLE_TYPES_SAFE.includes(it.type), `bad type ${it.type}`);
    assert.ok(Math.abs(it.x) <= CORRIDOR.halfWidth - 3 + 1e-9);
    assert.ok(it.y >= CORRIDOR.bottom && it.y <= CORRIDOR.top);
    assert.ok(it.z < 0);
  }
});
await test('harder stretches get denser', () => {
  const easy = planStretch('s', 2, 0).length;
  const hard = planStretch('s', 2, 1).length;
  assert.ok(hard >= easy);
});
await test('the run salt reshuffles traffic; stretch 0 opens with a welcome ring', () => {
  const a = planStretch('seed-x', 3, 0.5, 1), b = planStretch('seed-x', 3, 0.5, 2);
  assert.notDeepEqual(a, b, 'different salt should give a different layout');
  const open = planStretch('seed-x', 0, 0, 7);
  const ring = open[0];
  assert.equal(ring.type, 'ring');
  assert.equal(ring.x, 0);
  assert.equal(ring.y, 8);
  assert.equal(ring.z, -20, 'first ring ~1s ahead of the spawn line');
  assert.equal(ring.start, true, 'first ring is the START gate that unlocks controls');
});
await test('rings have a clean approach: no obstacle within ±28 z-units', () => {
  for (const salt of [1, 7, 42, 999]) {
    for (const diff of [0, 0.5, 1]) {
      const items = planStretch('runway-seed', 4, diff, salt);
      for (const ring of items.filter((i) => i.type === 'ring')) {
        for (const it of items) {
          if (it.type === 'ring') continue;
          assert.ok(
            Math.abs(it.z - ring.z) >= 28,
            `box/blade at ${it.z.toFixed(1)} crowds ring at ${ring.z.toFixed(1)}`,
          );
        }
      }
    }
  }
});
await test('collision: direct overlap hits, clear distance does not', () => {
  const box = { type: 'box', x: 0, y: 0, z: 0, size: 2 };
  assert.ok(collides({ x: 0.5, y: 0, z: 0 }, box));
  assert.ok(!collides({ x: 10, y: 0, z: 0 }, box));
});
await test('hitboxes match the visuals (no more phantom crashes)', () => {
  // box: faces at ±size/2 — the old fat sphere killed ~2u short of the mesh
  const box = { type: 'box', x: 0, y: 0, z: 0, size: 2 };
  assert.ok(collides({ x: 1.9, y: 0, z: 0 }, box), 'just inside the face');
  assert.ok(!collides({ x: 2.2, y: 0, z: 0 }, box), 'clear of the face is clear');
  // ring: the hole is genuinely open; only the visible tube hurts
  const ring = { type: 'ring', x: 0, y: 0, z: 0, size: 3.2 };
  assert.ok(!collides({ x: 1.6, y: 0, z: 0 }, ring), 'open hole, wingtip short of the tube');
  assert.ok(!collides({ x: 0, y: 0, z: 5 }, ring), 'beyond the ring plane is free');
  // blade: segment test — beside the bar is safe even though a sphere would hit
  const blade = { type: 'blade', x: 0, y: 0, z: 0, spin: 0, ang: 0 };
  assert.ok(collides({ x: 3.4, y: 0, z: 0 }, blade), 'on the bar');
  assert.ok(!collides({ x: 3.4, y: 1.5, z: 0 }, blade), 'above the thin bar is free');
  const turned = { type: 'blade', x: 0, y: 0, z: 0, spin: 0, ang: Math.PI / 2 };
  assert.ok(collides({ x: 0, y: 0, z: 3.4 }, turned), 'bar follows its live angle');
});
await test('ring: center passes free, rim hits', () => {
  const ring = { type: 'ring', x: 0, y: 0, z: 0, size: 3.2 };
  assert.ok(!collides({ x: 0, y: 0, z: 0 }, ring), 'center should be free');
  assert.ok(ringPass({ x: 0, y: 0, z: 0 }, ring));
  assert.ok(collides({ x: 2.4, y: 0, z: 0 }, ring), 'rim should hit');
  assert.ok(!ringPass({ x: 2.6, y: 0, z: 0 }, ring));
});
await test('per-craft hit radius: sharp rocket slips where broad plane clips', () => {
  const box = { type: 'box', x: 0, y: 0, z: 0, size: 2 };
  // 1.9u out: the face is at 1 — plane radius 1.1 reaches it, rocket's 0.55 does not
  const spot = { x: 1.9, y: 0, z: 0 };
  assert.ok(collides(spot, box, 1.1), 'broad paper plane clips it');
  assert.ok(!collides(spot, box, 0.55), 'sharp rocket slips past');
  // near-miss band follows the craft radius too
  assert.ok(nearMiss({ x: 2.9, y: 0, z: 0 }, box, 0.55), 'sharp craft still earns near-miss');
});
await test('near-miss fires just outside, not far away', () => {
  const box = { type: 'box', x: 0, y: 0, z: 0, size: 2 };
  assert.ok(nearMiss({ x: 4.5, y: 0, z: 0 }, box));
  assert.ok(!nearMiss({ x: 30, y: 0, z: 0 }, box));
  assert.ok(!nearMiss({ x: 0.5, y: 0, z: 0 }, box), 'overlap is a hit, not a near miss');
});
await test('difficulty and speed curves rise monotonically', () => {
  let lastD = -1, lastS = -1;
  for (let m = 0; m <= 5000; m += 250) {
    const d = difficultyAt(m), s = speedAt(m, 1);
    assert.ok(d >= lastD); assert.ok(s >= lastS);
    lastD = d; lastS = s;
  }
  assert.equal(difficultyAt(5000), 1); // max difficulty ≈ 5 minutes in
});
await test('daily wind applies to speed', () => {
  assert.ok(speedAt(0, 1.2) > speedAt(0, 0.9));
});

await test('World.reset restores the opening field for runs 2+', async () => {
  const { World } = await import('../js/game.js');
  const stubScene = { add() {}, remove() {} };
  const theme = { seed: 42, palette: { accent: 0xff6b6b, sun: 0xffd98e, fog: 0xffffff, skyTop: '#fff', skyBot: '#000' } };
  const w = new World(stubScene, theme);
  // simulate a long run: plane 2km out, scenery wrapped to trail it, obstacles spawned
  const plane = { x: 0, y: 0, z: -2000 };
  for (const m of [...w.ridges, ...w.clouds]) m.position.z = plane.z + 100; // behind the plane → will wrap
  w.ensureAhead(plane.z);
  w.update(plane, 0.016, () => {}, () => {}, () => {});
  assert.ok(w.ridges.every((m) => m.position.z < -2000), 'scenery trailed the far-out plane');
  w.reset();
  assert.equal(w.items.length, 0, 'field cleared');
  assert.equal(w.stretchIndex, 0, 'generation restarted');
  assert.ok(w.ridges.every((m, i) => m.position.equals(w.sceneryHome[i].p)), 'mountains back at the start');
  assert.ok(w.clouds.every((m, i) => m.position.equals(w.sceneryHome[w.ridges.length + i].p)), 'clouds back at the start');
  // and the regenerated field covers the same opening stretch as a fresh boot
  w.ensureAhead(0);
  assert.ok(w.items.some((e) => e.def.z < -120), 'obstacles near the opening stretch');
});

await test('hangar: every code-built craft folds into a game-sized group', async () => {
  const { CRAFTS } = await import('../js/game.js');
  const THREE = await import('../js/three.module.min.js');
  const theme = { palette: { accent: 0xff6b6b } };
  for (const c of CRAFTS.filter((c) => c.build)) {
    const m = c.build(theme);
    assert.ok(m.isGroup && m.children.length > 0, `${c.id} builds a non-empty group`);
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    assert.ok(size.z > 1.2 && size.z < 6, `${c.id} spans the flight axis like a craft (z=${size.z.toFixed(2)})`);
    assert.ok(Math.max(size.x, size.y, size.z) < 8, `${c.id} stays game-sized`);
  }
  assert.ok(CRAFTS.some((c) => c.id === 'rocket' && !c.build), 'rocket stays the Blender glTF');
});

console.log(`\n${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
