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
  }

  /** Clear the field and generation state for a fresh run. */
  reset() {
    for (const e of this.items) this.recycle(e);
    this.items.length = 0;
    this.stretchIndex = 0;
  }

  // ------------------------------------------------------------ obstacles

  /** Generate stretches until the track extends 360 units past the plane. */
  ensureAhead(planeZ) {
    while (this.stretchIndex * 120 < -planeZ + 360) {
      const diff = difficultyAt(-planeZ);
      const defs = planStretch(this.seed, this.stretchIndex, diff);
      for (const def of defs) this.spawn(def);
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
      } else if (!e.passed && !e.missed && nearMiss(plane, e.def)) {
        e.missed = true;
        onNearMiss(e);
      }
      if (!e.passed && !e.missed && collides(plane, e.def)) {
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
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xffc46b }));
  flame.rotation.x = Math.PI / 2; // apex toward +Z (trailing)
  flame.position.z = 1.7;
  g.userData.flame = flame;
  g.add(flame);
  g.rotation.x = 0.06;
  return g;
}

/** Load the Blender paper rocket (assets/rocket.glb) and fit it as the craft: nose toward -Z, ~3.4 units long. */
export function installRocket(plane) {
  return new Promise((resolve, reject) => {
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
      plane.add(fit);
      resolve(plane);
    }, undefined, reject);
  });
}

// ----------------------------------------------------------------- input

export class Input {
  constructor(el) {
    this.hold = false;
    this.steerX = 0; // -1..1
    const on = (v) => { this.hold = v; };
    el.addEventListener('pointerdown', (e) => { on(true); this.point(e); });
    el.addEventListener('pointerup', () => on(false));
    el.addEventListener('pointerleave', () => on(false));
    el.addEventListener('pointermove', (e) => this.point(e));
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') on(true); });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') on(false); });
  }
  point(e) {
    this.steerX = (e.clientX / window.innerWidth) * 2 - 1;
  }
}
