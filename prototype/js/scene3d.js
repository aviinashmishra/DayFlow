/*
 * Day Orb: a Three.js scene that shows the day's progress as a glowing ring
 * and every task as a moon. Moons fall toward the core as their status level
 * rises (Queued far out, Done docked on the core). Blocked moons stall and pulse.
 * Falls back to the SVG ring when WebGL or three.js is unavailable.
 */
const Orb = (() => {
  const RADIUS = [2.35, 1.95, 2.15, 1.5, 1.12]; // orbit radius per status level
  const SPEED = [0.12, 0.34, 0.02, 0.2, 0.08];
  let THREE, renderer, scene, camera, root, ring, track, core, shell, stars, moonGroup, glow;
  let canvas, raf = 0, running = false, visible = true, reduced = false, enabled = true;
  let progress = 0, shown = 0, energy = 0, targetEnergy = 0;
  let colors = [];
  const moons = new Map();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, dragging: false, lastX: 0, spin: 0 };
  let clock = 0, last = 0;

  function webgl() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }

  function init(el, opts = {}) {
    THREE = window.THREE;
    if (!THREE || !webgl()) return false;
    canvas = el;
    reduced = !!opts.reduced;
    colors = opts.colors;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 8.8);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.PointLight(0x9fb6ff, 1.3, 30); key.position.set(4, 5, 6); scene.add(key);
    const rim = new THREE.PointLight(0xff7ad9, 0.8, 30); rim.position.set(-5, -3, 3); scene.add(rim);

    root = new THREE.Group();
    scene.add(root);

    // Progress ring and its track.
    track = new THREE.Mesh(
      new THREE.TorusGeometry(2.7, 0.05, 12, 180),
      new THREE.MeshBasicMaterial({ color: 0x8892b0, transparent: true, opacity: 0.18 })
    );
    root.add(track);
    ring = new THREE.Mesh(ringGeometry(0.0001), new THREE.MeshStandardMaterial({ color: 0x5b8cff, emissive: 0x3a6cff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 }));
    ring.rotation.z = -Math.PI / 2;
    ring.scale.x = -1; // clockwise from 12 o'clock
    root.add(ring);

    // Low-poly core gem + wireframe shell.
    core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshStandardMaterial({ color: 0x7c9cff, emissive: 0x2b3fb8, emissiveIntensity: 0.6, flatShading: true, roughness: 0.25, metalness: 0.35 })
    );
    root.add(core);
    shell = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 1)),
      new THREE.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.35 })
    );
    root.add(shell);

    // Soft glow sprite behind the core.
    glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6f8dff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(3.6, 3.6, 1);
    root.add(glow);

    moonGroup = new THREE.Group();
    root.add(moonGroup);

    // Star dust.
    const g = new THREE.BufferGeometry();
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 3.2 + Math.random() * 3.5, a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      pos[i * 3] = r * Math.cos(a) * Math.cos(b); pos[i * 3 + 1] = r * Math.sin(b); pos[i * 3 + 2] = r * Math.sin(a) * Math.cos(b) - 2;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaab8ff, size: 0.035, transparent: true, opacity: 0.7 }));
    scene.add(stars);

    bindPointer();
    resize();
    new ResizeObserver(resize).observe(canvas.parentElement);
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; kick(); }).observe(canvas);
    document.addEventListener('visibilitychange', kick);
    kick();
    return true;
  }

  function ringGeometry(p) {
    return new THREE.TorusGeometry(2.7, 0.1, 14, 200, Math.max(0.0001, p) * Math.PI * 2);
  }

  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function bindPointer() {
    const host = canvas.parentElement;
    host.addEventListener('pointermove', (e) => {
      const r = host.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (pointer.dragging) { pointer.spin += (e.clientX - pointer.lastX) * 0.01; pointer.lastX = e.clientX; }
      kick();
    }, { passive: true });
    host.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; pointer.dragging = false; });
    host.addEventListener('pointerdown', (e) => { pointer.dragging = true; pointer.lastX = e.clientX; });
    window.addEventListener('pointerup', () => { pointer.dragging = false; });
  }

  function resize() {
    if (!renderer) return;
    const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderFrame(0);
  }

  function hex(c) { return new THREE.Color(c); }

  /** Sync moons with tasks and set ring progress. */
  function update(tasks, p, timerTaskId) {
    if (!renderer) return;
    progress = p;
    targetEnergy = timerTaskId ? 1 : 0;
    const seen = new Set();
    tasks.forEach((t) => {
      seen.add(t.id);
      let m = moons.get(t.id);
      if (!m) {
        const size = t.priority === 'high' ? 0.13 : t.priority === 'low' ? 0.075 : 0.1;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(size, 20, 16),
          new THREE.MeshStandardMaterial({ color: hex(colors[t.status]), emissive: hex(colors[t.status]), emissiveIntensity: 0.55, roughness: 0.4 })
        );
        const h = hash(t.id);
        m = {
          mesh, angle: h * Math.PI * 2, tiltX: (hash(t.id + 'x') - 0.5) * 1.2, tiltZ: (hash(t.id + 'z') - 0.5) * 0.9,
          r: RADIUS[t.status] + 0.6, status: t.status, focus: false
        };
        moonGroup.add(mesh);
        moons.set(t.id, m);
      }
      if (m.status !== t.status) {
        m.status = t.status;
        m.mesh.material.color = hex(colors[t.status]);
        m.mesh.material.emissive = hex(colors[t.status]);
      }
      m.focus = t.id === timerTaskId;
    });
    moons.forEach((m, id) => {
      if (!seen.has(id)) { moonGroup.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); moons.delete(id); }
    });
    kick();
  }

  function setColors(c) {
    colors = c;
    moons.forEach((m) => { m.mesh.material.color = hex(colors[m.status]); m.mesh.material.emissive = hex(colors[m.status]); });
    kick();
  }

  function setReduced(v) { reduced = v; kick(); }
  function setEnabled(v) { enabled = v; kick(); }

  function kick() {
    if (!renderer) return;
    const should = enabled && visible && !document.hidden;
    if (should && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
    if (!should && running) { running = false; cancelAnimationFrame(raf); }
    if (reduced && running) {
      // Reduced motion: settle to the final pose, render once, and stop.
      running = false; cancelAnimationFrame(raf);
      shown = progress; energy = targetEnergy;
      moons.forEach((m) => { m.r = RADIUS[m.status]; });
      renderFrame(0);
    }
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    renderFrame(dt);
    raf = requestAnimationFrame(loop);
  }

  let ringShown = -1;
  function renderFrame(dt) {
    clock += dt;
    // Ease values.
    shown += (progress - shown) * Math.min(1, dt * 3 || 1);
    energy += (targetEnergy - energy) * Math.min(1, dt * 2 || 1);
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4 || 1);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4 || 1);

    if (Math.abs(shown - ringShown) > 0.002) {
      ring.geometry.dispose();
      ring.geometry = ringGeometry(shown);
      ringShown = shown;
      const c = new THREE.Color().lerpColors ? new THREE.Color().lerpColors(hex('#5b8cff'), hex('#22c55e'), shown) : hex('#5b8cff');
      ring.material.color = c; ring.material.emissive = c;
    }

    root.rotation.x = -0.35 + pointer.y * 0.25;
    root.rotation.y = pointer.x * 0.35 + pointer.spin;
    pointer.spin *= 0.985;

    const spinRate = 0.25 + energy * 1.2;
    core.rotation.y += dt * spinRate;
    core.rotation.x += dt * spinRate * 0.4;
    shell.rotation.y -= dt * (0.15 + energy * 0.6);
    shell.rotation.z += dt * 0.05;
    const pulse = 1 + Math.sin(clock * (2 + energy * 4)) * (0.03 + energy * 0.05);
    core.scale.setScalar(0.85 + shown * 0.25);
    glow.scale.setScalar((3 + shown * 1.4 + energy * 0.8) * pulse);
    glow.material.opacity = 0.35 + shown * 0.3 + energy * 0.2;
    stars.rotation.y += dt * 0.01;

    moons.forEach((m) => {
      const targetR = RADIUS[m.status];
      m.r += (targetR - m.r) * Math.min(1, dt * 2.2 || 1);
      const blocked = m.status === 2;
      m.angle += dt * (SPEED[m.status] + (m.focus ? 0.9 : 0)) * (blocked ? Math.sin(clock * 2) * 0.5 + 0.5 : 1);
      const x = Math.cos(m.angle) * m.r, z = Math.sin(m.angle) * m.r;
      m.mesh.position.set(x, z * Math.sin(m.tiltX) + Math.sin(m.angle * 2) * 0.05, z * Math.cos(m.tiltX));
      m.mesh.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), m.tiltZ);
      const s = blocked ? 1 + Math.sin(clock * 6) * 0.25 : m.focus ? 1.35 + Math.sin(clock * 5) * 0.12 : m.status === 4 ? 0.8 : 1;
      m.mesh.scale.setScalar(s);
    });
    renderer.render(scene, camera);
  }

  return { init, update, setColors, setReduced, setEnabled, get ready() { return !!renderer; } };
})();
