/*
 * Day Orb: a Three.js scene showing the day's progress as a glowing ring and
 * every task as a moon. Moons fall toward the core as their status level rises
 * (Queued far out, Done docked on the core). Blocked moons stall and pulse.
 */
type THREEType = typeof import('three');
type Mesh = import('three').Mesh<import('three').SphereGeometry, import('three').MeshStandardMaterial>;

const RADIUS = [2.35, 1.95, 2.15, 1.5, 1.12];
const SPEED = [0.12, 0.34, 0.02, 0.2, 0.08];

interface Moon { mesh: Mesh; angle: number; tiltX: number; tiltZ: number; r: number; status: number; focus: boolean }
export interface OrbTask { id: string; status: number; priority: string }

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export class DayOrb {
  private renderer: import('three').WebGLRenderer;
  private scene: import('three').Scene;
  private camera: import('three').PerspectiveCamera;
  private root: import('three').Group;
  private ring: import('three').Mesh<import('three').TorusGeometry, import('three').MeshStandardMaterial>;
  private core: import('three').Mesh;
  private shell: import('three').LineSegments;
  private glow: import('three').Sprite;
  private stars: import('three').Points;
  private moonGroup: import('three').Group;
  private moons = new Map<string, Moon>();
  private raf = 0;
  private running = false;
  private visible = true;
  private reduced: boolean;
  private colors: string[];
  private progress = 0;
  private shown = 0;
  private ringShown = -1;
  private energy = 0;
  private targetEnergy = 0;
  private clock = 0;
  private last = 0;
  private pointer = { x: 0, y: 0, tx: 0, ty: 0, dragging: false, lastX: 0, spin: 0 };
  private cleanups: Array<() => void> = [];
  private axis: import('three').Vector3;

  constructor(private T: THREEType, private canvas: HTMLCanvasElement, opts: { reduced: boolean; colors: string[] }) {
    this.reduced = opts.reduced;
    this.colors = opts.colors;
    const THREE = T;
    this.axis = new THREE.Vector3(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 0, 8.8);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const key = new THREE.PointLight(0x9fb6ff, 60); key.position.set(4, 5, 6); this.scene.add(key);
    const rim = new THREE.PointLight(0xff7ad9, 30); rim.position.set(-5, -3, 3); this.scene.add(rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    const track = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.05, 12, 180), new THREE.MeshBasicMaterial({ color: 0x8892b0, transparent: true, opacity: 0.18 }));
    this.root.add(track);
    this.ring = new THREE.Mesh(this.ringGeometry(0.0001), new THREE.MeshStandardMaterial({ color: 0x5b8cff, emissive: 0x3a6cff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 }));
    this.ring.rotation.z = -Math.PI / 2;
    this.ring.scale.x = -1; // clockwise from 12 o'clock
    this.root.add(this.ring);

    this.core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshStandardMaterial({ color: 0x7c9cff, emissive: 0x2b3fb8, emissiveIntensity: 0.6, flatShading: true, roughness: 0.25, metalness: 0.35 })
    );
    this.root.add(this.core);
    this.shell = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 1)),
      new THREE.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.35 })
    );
    this.root.add(this.shell);

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: 0x6f8dff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.set(3.6, 3.6, 1);
    this.root.add(this.glow);

    this.moonGroup = new THREE.Group();
    this.root.add(this.moonGroup);

    const g = new THREE.BufferGeometry();
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 3.2 + Math.random() * 3.5, a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      pos[i * 3] = r * Math.cos(a) * Math.cos(b); pos[i * 3 + 1] = r * Math.sin(b); pos[i * 3 + 2] = r * Math.sin(a) * Math.cos(b) - 2;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaab8ff, size: 0.035, transparent: true, opacity: 0.7 }));
    this.scene.add(this.stars);

    this.bindPointer();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas.parentElement!);
    const io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; this.kick(); });
    io.observe(canvas);
    const onVis = () => this.kick();
    document.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => ro.disconnect(), () => io.disconnect(), () => document.removeEventListener('visibilitychange', onVis));
    this.resize();
    this.kick();
  }

  private ringGeometry(p: number) {
    return new this.T.TorusGeometry(2.7, 0.1, 14, 200, Math.max(0.0001, p) * Math.PI * 2);
  }

  private glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    return new this.T.CanvasTexture(c);
  }

  private bindPointer() {
    const host = this.canvas.parentElement!;
    const p = this.pointer;
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      p.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      p.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (p.dragging) { p.spin += (e.clientX - p.lastX) * 0.01; p.lastX = e.clientX; }
      this.kick();
    };
    const leave = () => { p.tx = 0; p.ty = 0; p.dragging = false; };
    const down = (e: PointerEvent) => { p.dragging = true; p.lastX = e.clientX; };
    const up = () => { p.dragging = false; };
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerleave', leave);
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    this.cleanups.push(() => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    });
  }

  private resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame(0);
  }

  update(tasks: OrbTask[], progress: number, focusTaskId: string | null) {
    const THREE = this.T;
    this.progress = progress;
    this.targetEnergy = focusTaskId ? 1 : 0;
    const seen = new Set<string>();
    for (const t of tasks) {
      seen.add(t.id);
      let m = this.moons.get(t.id);
      if (!m) {
        const size = t.priority === 'high' ? 0.13 : t.priority === 'low' ? 0.075 : 0.1;
        const c = new THREE.Color(this.colors[t.status]);
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 16), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.4 }));
        m = { mesh, angle: hash(t.id) * Math.PI * 2, tiltX: (hash(t.id + 'x') - 0.5) * 1.2, tiltZ: (hash(t.id + 'z') - 0.5) * 0.9, r: RADIUS[t.status] + 0.6, status: t.status, focus: false };
        this.moonGroup.add(mesh);
        this.moons.set(t.id, m);
      }
      if (m.status !== t.status) {
        m.status = t.status;
        m.mesh.material.color.set(this.colors[t.status]);
        m.mesh.material.emissive.set(this.colors[t.status]);
      }
      m.focus = t.id === focusTaskId;
    }
    for (const [id, m] of this.moons) {
      if (!seen.has(id)) {
        this.moonGroup.remove(m.mesh);
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
        this.moons.delete(id);
      }
    }
    this.kick();
  }

  setColors(colors: string[]) {
    this.colors = colors;
    for (const m of this.moons.values()) { m.mesh.material.color.set(colors[m.status]); m.mesh.material.emissive.set(colors[m.status]); }
    this.kick();
  }

  setReduced(v: boolean) { this.reduced = v; this.kick(); }

  private kick() {
    const should = this.visible && !document.hidden;
    if (should && !this.running) { this.running = true; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
    if (!should && this.running) { this.running = false; cancelAnimationFrame(this.raf); }
    if (this.reduced && this.running) {
      // Reduced motion: settle to the final pose, render once, stop.
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.shown = this.progress;
      this.energy = this.targetEnergy;
      for (const m of this.moons.values()) m.r = RADIUS[m.status];
      this.frame(0);
    }
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  private frame(dt: number) {
    const THREE = this.T;
    const ease = (k: number) => Math.min(1, dt * k || 1);
    const p = this.pointer;
    this.clock += dt;
    this.shown += (this.progress - this.shown) * ease(3);
    this.energy += (this.targetEnergy - this.energy) * ease(2);
    p.x += (p.tx - p.x) * ease(4);
    p.y += (p.ty - p.y) * ease(4);

    if (Math.abs(this.shown - this.ringShown) > 0.002) {
      this.ring.geometry.dispose();
      this.ring.geometry = this.ringGeometry(this.shown);
      this.ringShown = this.shown;
      const c = new THREE.Color().lerpColors(new THREE.Color('#5b8cff'), new THREE.Color('#22c55e'), this.shown);
      this.ring.material.color.copy(c);
      this.ring.material.emissive.copy(c);
    }

    this.root.rotation.x = -0.35 + p.y * 0.25;
    this.root.rotation.y = p.x * 0.35 + p.spin;
    p.spin *= 0.985;

    const spin = 0.25 + this.energy * 1.2;
    this.core.rotation.y += dt * spin;
    this.core.rotation.x += dt * spin * 0.4;
    this.shell.rotation.y -= dt * (0.15 + this.energy * 0.6);
    this.shell.rotation.z += dt * 0.05;
    const pulse = 1 + Math.sin(this.clock * (2 + this.energy * 4)) * (0.03 + this.energy * 0.05);
    this.core.scale.setScalar(0.85 + this.shown * 0.25);
    this.glow.scale.setScalar((3 + this.shown * 1.4 + this.energy * 0.8) * pulse);
    (this.glow.material as import('three').SpriteMaterial).opacity = 0.35 + this.shown * 0.3 + this.energy * 0.2;
    this.stars.rotation.y += dt * 0.01;

    for (const m of this.moons.values()) {
      m.r += (RADIUS[m.status] - m.r) * ease(2.2);
      const blocked = m.status === 2;
      m.angle += dt * (SPEED[m.status] + (m.focus ? 0.9 : 0)) * (blocked ? Math.sin(this.clock * 2) * 0.5 + 0.5 : 1);
      const x = Math.cos(m.angle) * m.r, z = Math.sin(m.angle) * m.r;
      m.mesh.position.set(x, z * Math.sin(m.tiltX) + Math.sin(m.angle * 2) * 0.05, z * Math.cos(m.tiltX));
      m.mesh.position.applyAxisAngle(this.axis, m.tiltZ);
      const s = blocked ? 1 + Math.sin(this.clock * 6) * 0.25 : m.focus ? 1.35 + Math.sin(this.clock * 5) * 0.12 : m.status === 4 ? 0.8 : 1;
      m.mesh.scale.setScalar(s);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
    this.renderer.dispose();
  }
}
