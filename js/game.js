// Paper Wings — the world. three.js scene, pooled obstacles, one-button input.
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import {
  CORRIDOR, planStretch, collides, nearMiss, ringPass, difficultyAt, speedAt,
} from './logic.js?v=13';

const STRETCH_AHEAD = 3;   // keep N stretches generated ahead of the plane
const KEY_DRIFT = 0.25;      // keyboard steer speed at first press: steerX units/s — a nudge, not a dodge
const KEY_DRIFT_MAX = 1.0;   // speed after KEY_DRIFT_T of continuous holding — keep pushing to really travel
const KEY_DRIFT_T = 1.5;     // seconds of holding to reach full speed

export class World {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme;
    this.seed = theme.seed;
    this.stretchIndex = 0;
    this.items = [];            // active obstacles {mesh, def}
    this.pool = { box: [], blade: [], ring: [] };
    this.narrow = 1;            // portrait screens squeeze the obstacle corridor toward center
    this.runSalt = 0;           // reshuffled every run — same sky, fresh traffic
    this.ridges = [];
    this.clouds = [];
    this.city = [];      // Shibuya tiles (async — empty until the glb lands)
    this.citySpan = 0;   // recycle jump, set when the city builds

    this.buildScenery();
    this.buildCity();
  }

  // ------------------------------------------------------------- scenery

  buildScenery() {
    const p = this.theme.palette;
    // paper mountains: recycled ridge lines on both sides
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.9, metalness: 0, flatShading: true });
    this.ridges = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 6; k++) {
        const g = new THREE.ConeGeometry(10 + Math.random() * 8, 16 + Math.random() * 14, 4);
        const m = new THREE.Mesh(g, ridgeMat);
        m.position.set(side * (34 + Math.random() * 10), -4, -k * 60);
        m.rotation.y = Math.random() * Math.PI;
        this.scene.add(m);
        this.ridges.push(m);
      }
    }
    // flat paper clouds drifting high
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let k = 0; k < 10; k++) {
      const g = new THREE.BoxGeometry(6 + Math.random() * 8, 0.4, 3 + Math.random() * 3);
      const m = new THREE.Mesh(g, cloudMat);
      m.position.set((Math.random() * 2 - 1) * 30, 18 + Math.random() * 12, -Math.random() * 360);
      this.scene.add(m);
      this.clouds.push(m);
    }
    // cloud sea: the "ground" reads as an ocean of cloud the city pokes out
    // of — wisps low across the corridor (flying through them is the point)
    // and thick under the tower walls
    const seaMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72 });
    for (let k = 0; k < 44; k++) {
      const g = new THREE.BoxGeometry(7 + Math.random() * 9, 0.5, 4 + Math.random() * 5);
      const m = new THREE.Mesh(g, seaMat);
      const side = Math.random() < 0.5 ? -1 : 1;
      m.position.set(side * (8 + Math.random() * 72), -3 + Math.random() * 5, -Math.random() * 400);
      this.scene.add(m);
      this.clouds.push(m);
    }
    // sun
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(9, 32),
      new THREE.MeshBasicMaterial({ color: p.sun, fog: false }),
    );
    sun.position.set(-30, 34, -420);
    this.scene.add(sun);
    // paper cloud decks: the floor and ceiling of the corridor, made VISIBLE —
    // the old invisible bounds crashed planes in empty air ("hit nothing").
    // The floor is a dusk-blue gray so the white crafts read against it, and
    // both decks take the sun's shadows (MeshBasic can't receive them).
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x8fa3b8 });
    const ceilMat = new THREE.MeshLambertMaterial({ color: 0xeef2f8 });
    this.decks = [];
    for (const [y, mat] of [[CORRIDOR.bottom, floorMat], [CORRIDOR.top + 4, ceilMat]]) {
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(320, 0.6, 130), mat); // 320 wide so the floor reaches under the city walls too
        m.position.set(0, y, -k * 130);
        m.receiveShadow = true;
        this.scene.add(m);
        this.decks.push(m);
      }
    }
    // home transforms so a fresh run can restore the opening landscape
    this.sceneryHome = [...this.ridges, ...this.clouds, ...this.decks].map((m) => ({ m, p: m.position.clone(), r: m.rotation.clone() }));
  }

  /** Shibuya from the Blender pipeline: the 24 glb pieces are jigsaw quadrants
   * of ONE big city — each keeps its native coordinates, so adding them
   * together reassembles the map (~1836×1415 model units, tallest spire 230).
   * Scaled so that summit tops out just under the flight line: the run skims
   * the tower tops above a cloud sea. Geometry is shared across row clones,
   * so memory is transforms only. Fails soft — piece loads that fail drop
   * out, and with none the paper mountains simply stay. */
  buildCity() {
    try {
      const loads = [];
      for (let i = 1; i <= 24; i++) {
        loads.push(new Promise((res) => new GLTFLoader().load(`assets/shibuya-${i}.glb`, (g) => res(g.scene), undefined, () => res(null))));
      }
      Promise.allSettled(loads).then((rs) => {
        const pieces = rs.map((r) => r.value).filter(Boolean);
        if (!pieces.length) return; // no pieces arrived — paper mountains stay
        const S = 0.06; // big map → 110×85-unit block; tallest tower tops ≈ 8, the flight line skims them
        const city = new THREE.Group(); // pieces keep their native jigsaw coords
        for (const p of pieces) city.add(p);
        city.scale.setScalar(S);
        const box = new THREE.Box3().setFromObject(city);
        const c = box.getCenter(new THREE.Vector3());
        city.position.set(-c.x, -box.min.y, -c.z); // pivot centered on x/z, base on the floor deck
        const tileD = box.getSize(new THREE.Vector3()).z; // box is post-scale — S already applied
        const proto = new THREE.Group();
        proto.add(city);
        const ROWS = 5; // 5 × ~85 deep ≈ 425 — past the fog line at 340
        for (let r = 0; r < ROWS; r++) {
          const t = proto.clone();
          t.rotation.y = (Math.random() - 0.5) * 0.03;
          t.position.set((Math.random() - 0.5) * 4, CORRIDOR.bottom, -20 - r * tileD + (Math.random() - 0.5) * 6);
          this.scene.add(t);
          this.city.push(t);
        }
        this.citySpan = ROWS * tileD;
        // the city replaces the paper mountains as ground dressing
        for (const m of this.ridges) this.scene.remove(m);
        this.ridges = [];
        this.sceneryHome = [...this.city, ...this.clouds, ...this.decks].map((m) => ({ m, p: m.position.clone(), r: m.rotation.clone() }));
      });
    } catch { /* headless/node has no fetch for the asset — fine, no city */ }
  }

  /** Clear the field and generation state for a fresh run. */
  reset() {
    for (const e of this.items) this.recycle(e);
    this.items.length = 0;
    this.stretchIndex = 0;
    this.runSalt = (Math.random() * 0xffffffff) >>> 0; // new traffic layout per run
    // scenery: without this the mountains/clouds sit kilometers past the new
    // start (they only wrap when passed), leaving runs 2+ with an empty field
    for (const h of this.sceneryHome) {
      h.m.position.copy(h.p);
      h.m.rotation.copy(h.r);
    }
  }

  // ------------------------------------------------------------ obstacles

  /** Generate stretches until the track extends 360 units past the plane. */
  ensureAhead(planeZ) {
    // on a narrowed corridor (portrait, or the capped 4:3 play strip) obstacles
    // must fit INSIDE it — a ring or blade centered on the edge would hang half
    // of itself out over the letterbox terrain
    const HALF_SPAN = { ring: 3.55, blade: 3.5 }; // ring tube outer radius, blade half-length
    while (this.stretchIndex * 120 < -planeZ + 360) {
      const diff = difficultyAt(-planeZ);
      const defs = planStretch(this.seed, this.stretchIndex, diff, this.runSalt);
      for (const d of defs) {
        if (this.narrow === 1) { this.spawn(d); continue; }
        const room = Math.max(1, 19 * this.narrow - (d.type === 'box' ? d.size / 2 : HALF_SPAN[d.type]));
        this.spawn({ ...d, x: Math.max(-room, Math.min(room, d.x * this.narrow)) });
      }
      this.stretchIndex += 1;
    }
  }

  spawn(def) {
    const mesh = this.take(def.type);
    mesh.position.set(def.x, def.y, def.z);
    mesh.rotation.set(0, 0, def.spin);
    if (def.type === 'box') mesh.scale.setScalar(def.size); // visual cube matches its hitbox
    this.scene.add(mesh);
    this.items.push({ mesh, def, passed: false, missed: false });
  }

  take(type) {
    const pooled = this.pool[type].pop();
    if (pooled) return pooled;
    if (type === 'ring') {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.2, 0.35, 8, 24),
        new THREE.MeshStandardMaterial({ color: this.theme.palette.accent, roughness: 0.5, metalness: 0.1 }),
      );
      ring.castShadow = true;
      return ring;
    }
    const mat = new THREE.MeshStandardMaterial({ color: type === 'blade' ? 0x8b93a6 : 0xfff8ef, roughness: 0.85, flatShading: true });
    const g = type === 'blade'
      ? new THREE.BoxGeometry(7, 0.5, 0.5)
      : new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  }

  recycle(entry) {
    this.scene.remove(entry.mesh);
    this.pool[entry.def.type].push(entry.mesh);
  }

  /** Update obstacle spins, recycle passed items, run proximity callbacks. */
  update(plane, dt, onRing, onNearMiss, onHit, onMissed) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      if (e.def.type === 'blade') { e.mesh.rotation.y += dt * 1.5; e.def.ang = e.mesh.rotation.y; } // collides() reads the bar's live angle
      if (e.def.type === 'ring') e.mesh.rotation.z += dt * 0.4;

      if (!e.passed && ringPass(plane, e.def)) {
        e.passed = true;
        onRing(e);
      } else if (!e.passed && !e.missed && nearMiss(plane, e.def, plane.userData?.hitR)) {
        e.missed = true;
        onNearMiss(e);
      }
      if (!e.passed && !e.missed && collides(plane, e.def, plane.userData?.hitR)) {
        onHit(e);
        return;
      }
      // behind the camera → recycle (a ring that slipped past unflown is a miss)
      if (e.def.z > plane.z + 30) {
        if (e.def.type === 'ring' && !e.passed && onMissed) onMissed(e);
        this.recycle(e);
        this.items.splice(i, 1);
      }
    }
    // scenery recycling
    for (const m of this.ridges) {
      if (m.position.z > plane.z + 60) m.position.z -= 360;
    }
    for (const c of this.clouds) {
      if (c.position.z > plane.z + 40) c.position.z -= 400;
    }
    for (const d of this.decks) {
      if (d.position.z > plane.z + 65) d.position.z -= 520; // 4 decks: floor past the 360-unit spawn line, so shadows land the moment objects show
    }
    for (const m of this.city) {
      if (m.position.z > plane.z + 60) m.position.z -= this.citySpan; // the whole grid leapfrogs like the decks
    }
  }
}

// ------------------------------------------------------------------ plane

export function makePlane() {
  const g = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.65, 8), new THREE.MeshBasicMaterial({ color: 0xffc46b }));
  flame.rotation.x = Math.PI / 2; // apex toward +Z (trailing)
  flame.position.z = 1.6;
  g.userData.flame = flame;
  g.userData.hitR = 1.1; // default until a craft is installed
  g.add(flame);
  g.rotation.x = 0.06;
  return g;
}

/** Load a GLB craft asset, normalized once per path; cloned per install. */
const glbCache = new Map(); // path → Promise<Group>
function loadGlb(path, { upright = false } = {}) {
  if (!glbCache.has(path)) {
    glbCache.set(path, new Promise((resolve, reject) => {
      new GLTFLoader().load(path, (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center); // pivot at the middle of the craft
        const fit = new THREE.Group();
        fit.rotation.x = upright ? -Math.PI / 2 : 0; // authored +Y-up → nose to -Z
        fit.scale.setScalar(3.4 / (upright ? size.y : Math.max(size.x, size.z)));
        fit.add(model);
        resolve(fit);
      }, undefined, reject);
    }));
  }
  return glbCache.get(path);
}
const loadRocketScene = () => loadGlb('assets/rocket.glb', { upright: true });

// --------------------------------------------------------------- hangar

/** Paper materials shared by the folded crafts. */
function paperMats(accent) {
  return {
    white: new THREE.MeshStandardMaterial({ color: 0xfff8ef, roughness: 0.6, flatShading: true, side: THREE.DoubleSide }),
    accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55, flatShading: true, side: THREE.DoubleSide }),
  };
}

function tri(mat, a, b, c) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b, c]);
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Classic paper dart, nose toward -Z. */
function buildPaperPlane(theme) {
  const g = new THREE.Group();
  const { white } = paperMats(theme.palette.accent);
  const Z = (z, y = 0, x = 0) => new THREE.Vector3(x, y, z);
  g.add(
    tri(white, Z(1.15), Z(-1.55), new THREE.Vector3(-1.35, 0.28, 1.05)),  // left wing
    tri(white, Z(1.15), Z(-1.55), new THREE.Vector3(1.35, 0.28, 1.05)),   // right wing
    tri(white, Z(1.15), Z(-1.55), Z(1.05, -0.55)),                        // keel
  );
  return g;
}

/** Origami crane (orizuru) — diamond body, broad swept wings, long neck with
 *  a beak kink and a sharp tail spike, nose toward -Z. */
function buildCrane(theme) {
  const g = new THREE.Group();
  const { white, accent } = paperMats(theme.palette.accent);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // body: folded diamond — top ridge from neck root to tail root, keel point
  // below, two side points the wings fold from
  const TF = V(0, 0.28, -0.5), TB = V(0, 0.28, 0.6), K = V(0, -0.5, 0.05);
  for (const s of [1, -1]) {
    g.add(
      tri(white, TF, TB, V(s * 0.3, 0.05, 0.05)), // upper side facet
      tri(white, TF, V(s * 0.3, 0.05, 0.05), K),  // lower facet down to the keel
    );
  }
  // wings: one broad triangle per side, swept back, tips a touch raised
  for (const s of [1, -1]) {
    g.add(tri(accent, V(s * 0.12, 0.26, -0.42), V(s * 2.3, 0.6, 0.5), V(s * 0.12, 0.26, 0.55)));
  }
  // neck: slim spike rising forward-up, head folded down-forward at the tip;
  // two crossing slivers so it reads from every angle, not just edge-on
  const NK = V(0, 0.95, -1.55);
  g.add(
    tri(white, V(-0.09, 0.24, -0.46), V(0.09, 0.24, -0.46), NK),
    tri(white, V(0, 0.2, -0.42), V(0, 0.3, -0.54), NK),
    tri(accent, NK, V(0, 0.8, -1.6), V(0, 0.86, -1.92)), // beak
  );
  // tail: matching slim spike, straight back and up
  g.add(
    tri(white, V(-0.09, 0.26, 0.56), V(0.09, 0.26, 0.56), V(0, 0.75, 1.75)),
    tri(white, V(0, 0.22, 0.6), V(0, 0.32, 0.52), V(0, 0.75, 1.75)),
  );
  g.scale.setScalar(0.6); // raw build out-sizes everything — same footprint as the fighter jet
  return g;
}

/** Fighter jet — delta-wing interceptor, nose toward -Z. */
function buildFighterJet(theme) {
  const g = new THREE.Group();
  const { white, accent } = paperMats(theme.palette.accent);
  const gray = new THREE.MeshStandardMaterial({ color: 0xc4cbd6, roughness: 0.55, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5d6774, roughness: 0.35, metalness: 0, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x24384e, roughness: 0.15, metalness: 0 }); // no envMap: metalness would black out
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // fuselage: slim hexagonal body tapering toward the nose, +Z is the tail
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2.8, 6), gray);
  body.rotation.x = -Math.PI / 2; // hex prism along z, small end (nose) forward
  body.position.z = 0.35;
  g.add(body);
  // side engine intakes
  for (const s of [1, -1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 1.15), dark);
    intake.position.set(s * 0.32, -0.06, 0.35);
    g.add(intake);
  }
  // pointed nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.95, 6), gray);
  nose.rotation.x = -Math.PI / 2; // apex toward -Z
  nose.position.z = -1.5;
  g.add(nose);
  // cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), glass);
  canopy.scale.set(1, 0.8, 2.1);
  canopy.position.set(0, 0.2, -0.7);
  g.add(canopy);
  // delta wings: one flat swept triangle per side, accent tips painted on
  for (const s of [1, -1]) {
    g.add(tri(gray, V(s * 0.22, -0.04, -0.45), V(s * 2.0, -0.02, 1.25), V(s * 0.22, -0.04, 1.3)));
    g.add(tri(white, V(s * 1.35, -0.03, 0.62), V(s * 2.0, -0.02, 1.25), V(s * 1.3, -0.03, 1.05))); // tip stripe
    // wingtip missile rails
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.85, 6), accent);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(s * 1.95, 0.02, 0.55);
    g.add(rail);
  }
  // canted twin tail fins
  for (const s of [1, -1]) {
    g.add(tri(gray, V(s * 0.18, 0.18, 0.85), V(s * 0.5, 0.85, 1.6), V(s * 0.42, 0.18, 1.6)));
    g.add(tri(white, V(s * 0.46, 0.72, 1.5), V(s * 0.5, 0.85, 1.6), V(s * 0.42, 0.18, 1.6))); // fin stripe
  }
  // horizontal stabilizers
  for (const s of [1, -1]) {
    g.add(tri(gray, V(s * 0.24, 0, 1.15), V(s * 0.85, 0, 1.75), V(s * 0.24, 0, 1.75)));
  }
  // engine nozzle
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.4, 6), dark);
  nozzle.rotation.x = -Math.PI / 2;
  nozzle.position.z = 1.95;
  g.add(nozzle);
  g.scale.setScalar(0.7); // sit between the paper plane and the rocket, not dwarf them
  return g;
}

export const CRAFTS = [
  { id: 'plane', name: 'Paper Plane', build: buildPaperPlane, hitR: 1.1, verb: 'folded.' },
  { id: 'rocket', name: 'Paper Rocket', build: null, hitR: 0.55, verb: 'burned up.' }, // the Blender glTF — sharp nose slips through gaps
  { id: 'crane', name: 'Origami Crane', build: buildCrane, hitR: 0.6, verb: 'folded.' },
  { id: 'jet', name: 'Fighter Jet', build: buildFighterJet, hitR: 0.6, verb: 'shot down.' },
];

/**
 * Swap the plane's craft. Curated hangar only — every model here is
 * hand-reviewed, family-friendly paper art; nothing user-generated
 * ever loads at runtime (keeps the site AdSense-safe by construction).
 */
export async function installCraft(plane, id, theme) {
  const craft = CRAFTS.find((c) => c.id === id) || CRAFTS[0];
  let model;
  if (craft.build) {
    model = craft.build(theme);
  } else {
    model = (await loadRocketScene()).clone(true);
  }
  if (plane.userData.craft) plane.remove(plane.userData.craft); // swap in place
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; }); // every craft drops a shadow
  plane.add(model);
  plane.userData.craft = model;
  plane.userData.hitR = craft.hitR ?? 1.1; // sharpness matters: the collision radius rides on the craft
  if (plane.userData.flame) {
    plane.userData.flame.visible = craft.id === 'rocket' || craft.id === 'jet'; // afterburner
    plane.userData.flame.position.z = 1.6; // clears both nozzles
  }
  return craft;
}

// ----------------------------------------------------------------- input

export class Input {
  constructor(el) {
    this.hold = false;
    this.steerX = 0; // -1..1 — kept on release: the plane HOLDS its lateral spot
    this.keys = { rise: false, left: false, right: false }; // W/S/↑/↓ rise (nothing dives), A/D + ←/→ steer
    this.keyHold = 0; // seconds the current steer key has been down — drift accelerates while held
    // Touch steers by slide DIRECTION only — where the finger lands and
    // starts is irrelevant: slide left → drift left, slide right → drift
    // right, proportional to how far you slide. Stop sliding (or lift the
    // finger) and the plane STAYS put — slide the other way to come back.
    // Mouse keeps absolute hover steering.
    let dragging = false;
    let lastX = 0;
    const DRAG = 100; // px of slide for full left/right
    // Mouse maps across the 4:3 PLAY strip, not the whole window — widescreen
    // shows extra scenery the plane can't reach, so the cursor's controllable
    // range must stop where the plane's does (portrait: the strip IS the width).
    const playX = (clientX) => {
      const w = Math.min(window.innerWidth, window.innerHeight * 4 / 3);
      const x = ((clientX - (window.innerWidth - w) / 2) / w) * 2 - 1;
      return Math.max(-1, Math.min(1, x));
    };
    const on = (v) => { this.hold = v; };
    const release = () => { on(false); dragging = false; };
    el.addEventListener('pointerdown', (e) => {
      on(true);
      dragging = e.pointerType === 'touch';
      lastX = e.clientX;
      if (!dragging) this.steerX = playX(e.clientX);
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointermove', (e) => {
      if (dragging) {
        this.steerX = Math.max(-1, Math.min(1, this.steerX + (e.clientX - lastX) / DRAG));
        lastX = e.clientX;
      } else if (e.pointerType !== 'touch') this.steerX = playX(e.clientX);
    });
    const RISE = ['Space', 'KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'];
    const LEFT = ['KeyA', 'ArrowLeft'];
    const RIGHT = ['KeyD', 'ArrowRight'];
    window.addEventListener('keydown', (e) => {
      if (RISE.includes(e.code)) { if (e.code !== 'Space') this.keys.rise = true; on(true); e.preventDefault(); }
      else if (LEFT.includes(e.code)) { this.keys.left = true; e.preventDefault(); }
      else if (RIGHT.includes(e.code)) { this.keys.right = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (RISE.includes(e.code)) { if (e.code !== 'Space') this.keys.rise = false; on(false); }
      else if (LEFT.includes(e.code)) this.keys.left = false;
      else if (RIGHT.includes(e.code)) this.keys.right = false;
    });
  }
  // once per frame: keys DRIFT the held steering spot — gently at first, and
  // the longer you keep the key down the faster it goes (tap = trim, hold =
  // travel). Release never recenters: the line is kept, same as lifting a
  // finger off a touch slide.
  steer(dt) {
    const dir = (this.keys.right ? 1 : 0) + (this.keys.left ? -1 : 0);
    if (!dir) { this.keyHold = 0; return this.steerX; }
    this.keyHold = Math.min(this.keyHold + dt, KEY_DRIFT_T);
    const rate = KEY_DRIFT + (KEY_DRIFT_MAX - KEY_DRIFT) * (this.keyHold / KEY_DRIFT_T);
    this.steerX = Math.max(-1, Math.min(1, this.steerX + dir * rate * dt));
    return this.steerX;
  }
  clearKeys() { this.keys.rise = this.keys.left = this.keys.right = false; this.keyHold = 0; }
}
