// Paper Wings — the world. three.js scene, pooled obstacles, one-button input.
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import {
  CORRIDOR, planStretch, collides, nearMiss, ringPass, difficultyAt, speedAt,
} from './logic.js';

const STRETCH_AHEAD = 3;   // keep N stretches generated ahead of the plane

export class World {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme;
    this.seed = theme.seed;
    this.stretchIndex = 0;
    this.items = [];            // active obstacles {mesh, def}
    this.pool = { box: [], blade: [], ring: [] };
    this.narrow = 1;            // portrait screens squeeze the obstacle corridor toward center
    this.ridges = [];
    this.clouds = [];

    this.buildScenery();
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
    // sun
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(9, 32),
      new THREE.MeshBasicMaterial({ color: p.sun, fog: false }),
    );
    sun.position.set(-30, 34, -420);
    this.scene.add(sun);
    // home transforms so a fresh run can restore the opening landscape
    this.sceneryHome = [...this.ridges, ...this.clouds].map((m) => ({ m, p: m.position.clone(), r: m.rotation.clone() }));
  }

  /** Clear the field and generation state for a fresh run. */
  reset() {
    for (const e of this.items) this.recycle(e);
    this.items.length = 0;
    this.stretchIndex = 0;
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
    while (this.stretchIndex * 120 < -planeZ + 360) {
      const diff = difficultyAt(-planeZ);
      const defs = planStretch(this.seed, this.stretchIndex, diff);
      for (const d of defs) this.spawn(this.narrow === 1 ? d : { ...d, x: d.x * this.narrow });
      this.stretchIndex += 1;
    }
  }

  spawn(def) {
    const mesh = this.take(def.type);
    mesh.position.set(def.x, def.y, def.z);
    mesh.rotation.z = def.spin;
    this.scene.add(mesh);
    this.items.push({ mesh, def, passed: false, missed: false });
  }

  take(type) {
    const pooled = this.pool[type].pop();
    if (pooled) return pooled;
    if (type === 'ring') {
      return new THREE.Mesh(
        new THREE.TorusGeometry(3.2, 0.35, 8, 24),
        new THREE.MeshStandardMaterial({ color: this.theme.palette.accent, roughness: 0.5, metalness: 0.1 }),
      );
    }
    const mat = new THREE.MeshStandardMaterial({ color: type === 'blade' ? 0x8b93a6 : 0xfff8ef, roughness: 0.85, flatShading: true });
    const g = type === 'blade'
      ? new THREE.BoxGeometry(7, 0.5, 0.5)
      : new THREE.BoxGeometry(1, 1, 1);
    return new THREE.Mesh(g, mat);
  }

  recycle(entry) {
    this.scene.remove(entry.mesh);
    this.pool[entry.def.type].push(entry.mesh);
  }

  /** Update obstacle spins, recycle passed items, run proximity callbacks. */
  update(plane, dt, onRing, onNearMiss, onHit) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      if (e.def.type === 'blade') e.mesh.rotation.y += dt * 1.5;
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
      // behind the camera → recycle
      if (e.def.z > plane.z + 30) {
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

/** Load the Blender paper rocket (assets/rocket.glb), normalized once; cloned per use. */
let rocketScene = null;
function loadRocketScene() {
  if (!rocketScene) {
    rocketScene = new Promise((resolve, reject) => {
      new GLTFLoader().load('assets/rocket.glb', (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center); // pivot at the middle of the craft
        const fit = new THREE.Group();
        fit.rotation.x = -Math.PI / 2; // asset is authored +Y-up → nose to -Z
        fit.scale.setScalar(3.4 / size.y);
        fit.add(model);
        resolve(fit);
      }, undefined, reject);
    });
  }
  return rocketScene;
}

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

/** Origami crane — folded bird with raised wings, nose (head) toward -Z. */
function buildCrane(theme) {
  const g = new THREE.Group();
  const { white, accent } = paperMats(theme.palette.accent);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // body: slim folded diamond along z
  g.add(
    tri(white, V(0, 0.1, 0.55), V(0, 0.1, -0.75), V(0, -0.3, 0.1)),
    tri(white, V(0, 0.1, 0.55), V(0, 0.1, -0.75), V(0.06, -0.3, 0.1)),
  );
  // wings: big raised triangles
  g.add(
    tri(accent, V(0.12, 0.05, 0.35), V(0.12, 0.05, -0.5), V(1.35, 0.75, -0.1)),
    tri(accent, V(-0.12, 0.05, 0.35), V(-0.12, 0.05, -0.5), V(-1.35, 0.75, -0.1)),
  );
  // neck with head fold, pointing forward (-Z)
  g.add(
    tri(white, V(0, 0.1, -0.5), V(0, 0.42, -1.25), V(0, 0.2, -0.45)),
    tri(accent, V(0, 0.42, -1.25), V(0, 0.62, -1.16), V(0, 0.38, -1.1)),  // beak/head
  );
  // tail spike
  g.add(tri(white, V(0, 0.1, 0.65), V(0, 0.42, 1.45), V(0, 0.16, 0.6)));
  return g;
}

/** Paper butterfly — twin upper/lower wing pairs, head toward -Z. */
function buildButterfly(theme) {
  const g = new THREE.Group();
  const { white, accent } = paperMats(theme.palette.accent);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // body along z, head forward
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.5, 6), paperMats(theme.palette.accent).white);
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  // upper wings (broad, swept back with a little lift) + lower wings (smaller)
  for (const s of [1, -1]) {
    g.add(
      tri(accent, V(s * 0.08, 0.05, 0.35), V(s * 1.4, 0.35, -0.35), V(s * 0.12, 0.02, -0.5)),
      tri(white, V(s * 0.08, 0, -0.05), V(s * 1.0, -0.18, -0.6), V(s * 0.1, 0, -0.75)),
    );
  }
  return g;
}

export const CRAFTS = [
  { id: 'plane', name: 'Paper Plane', build: buildPaperPlane, hitR: 1.1 },
  { id: 'rocket', name: 'Paper Rocket', build: null, hitR: 0.55 }, // the Blender glTF — sharp nose slips through gaps
  { id: 'crane', name: 'Origami Crane', build: buildCrane, hitR: 0.9 },
  { id: 'butterfly', name: 'Paper Butterfly', build: buildButterfly, hitR: 1.05 },
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
  plane.add(model);
  plane.userData.craft = model;
  plane.userData.hitR = craft.hitR ?? 1.1; // sharpness matters: the collision radius rides on the craft
  if (plane.userData.flame) plane.userData.flame.visible = craft.id === 'rocket';
  return craft;
}

// ----------------------------------------------------------------- input

export class Input {
  constructor(el) {
    this.hold = false;
    this.steerX = 0; // -1..1 — kept on release: the plane HOLDS its lateral spot
    // Touch steers by slide DIRECTION only — where the finger lands and
    // starts is irrelevant: slide left → drift left, slide right → drift
    // right, proportional to how far you slide. Stop sliding (or lift the
    // finger) and the plane STAYS put — slide the other way to come back.
    // Mouse keeps absolute hover steering.
    let dragging = false;
    let lastX = 0;
    const DRAG = 100; // px of slide for full left/right
    const on = (v) => { this.hold = v; };
    const release = () => { on(false); dragging = false; };
    el.addEventListener('pointerdown', (e) => {
      on(true);
      dragging = e.pointerType === 'touch';
      lastX = e.clientX;
      if (!dragging) this.steerX = (e.clientX / window.innerWidth) * 2 - 1;
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointermove', (e) => {
      if (dragging) {
        this.steerX = Math.max(-1, Math.min(1, this.steerX + (e.clientX - lastX) / DRAG));
        lastX = e.clientX;
      } else if (e.pointerType !== 'touch') this.steerX = (e.clientX / window.innerWidth) * 2 - 1;
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') on(true); });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') on(false); });
  }
}
