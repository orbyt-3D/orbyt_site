// Shared 3D code for orbyt3d.space: scene builders, renderer/post setup, the hero and showcase stills.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const TEAL = 0x2dd4bf, PINK = 0xe879f9, INDIGO = 0x818cf8;
let ANISO = 8;

/* ---------------- helpers ---------------- */
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: .1, ...o });
const glow = (color, k = 2.5) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: k });
const glowBasic = (color, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
function shadowed(m, cast = true) { m.castShadow = cast; m.receiveShadow = true; return m; }
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  m.position.set(x, y, z); parent && parent.add(m); return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, parent, seg = 24) {
  const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat));
  m.position.set(x, y, z); parent && parent.add(m); return m;
}
// merges many small parts into one draw call
class Merge {
  constructor() { this.parts = []; }
  add(geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
    this.parts.push(geo.index ? geo.toNonIndexed() : geo); return this;
  }
  box(w, h, d, pos, rot) { return this.add(new THREE.BoxGeometry(w, h, d), pos, rot); }
  beam(a, b, t = .4) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A);
    const g = new THREE.BoxGeometry(t, dir.length(), t);
    g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(1, 1, 1)));
    this.parts.push(g.toNonIndexed()); return this;
  }
  mesh(mat, cast = true) { return shadowed(new THREE.Mesh(mergeGeometries(this.parts), mat), cast); }
}
// Merge every non-moving mesh that shares a material into a single mesh (one draw call per material).
function bakeStatic(root, keep = new Set()) {
  root.updateMatrixWorld(true);
  const groups = new Map(), merged = [];
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    for (let p = o; p; p = p.parent) if (keep.has(p)) return;
    const g = o.geometry;
    if (!g.attributes.normal || !g.attributes.uv) return;
    const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
    const geo = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    geo.clearGroups();
    groups.get(key).geos.push(geo); merged.push(o);
  });
  merged.forEach(o => o.removeFromParent());
  for (const { mat, cast, recv, geos } of groups.values()) {
    const m = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], mat);
    m.castShadow = cast; m.receiveShadow = recv; m.matrixAutoUpdate = false; root.add(m);
  }
}
const texCache = new Map();
function canvasTex(key, w, h, draw, repeat = [1, 1], color = true) {
  if (!texCache.has(key)) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISO;
    texCache.set(key, t);
  }
  const t = texCache.get(key).clone(); t.repeat.set(...repeat); t.needsUpdate = true; return t;
}
function noise(c, W, H, n, a) {
  for (let i = 0; i < n; i++) { const v = Math.random() > .5 ? 255 : 0; c.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`; c.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
}
function stains(c, W, H, n, a) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 40 + Math.random() * 180, g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}
const concreteTex = (rep) => canvasTex('concrete', 1024, 1024, (c, W, H) => {
  c.fillStyle = '#80898c'; c.fillRect(0, 0, W, H); noise(c, W, H, 14000, .07); stains(c, W, H, 18, .12);
  c.fillStyle = 'rgba(20,26,28,.35)'; for (let i = 0; i <= 4; i++) { c.fillRect(i * W / 4 - 1, 0, 2, H); c.fillRect(0, i * H / 4 - 1, W, 2); }
}, rep);
const asphaltTex = (rep) => canvasTex('asphalt', 512, 512, (c, W, H) => {
  c.fillStyle = '#272e31'; c.fillRect(0, 0, W, H); noise(c, W, H, 9000, .1); stains(c, W, H, 8, .2);
}, rep);
const groundTex = (rep) => canvasTex('ground', 512, 512, (c, W, H) => {
  c.fillStyle = '#163236'; c.fillRect(0, 0, W, H); noise(c, W, H, 12000, .09); stains(c, W, H, 20, .25);
}, rep);
const gravelTex = (rep) => canvasTex('gravel', 512, 512, (c, W, H) => {
  c.fillStyle = '#5b6466'; c.fillRect(0, 0, W, H); noise(c, W, H, 20000, .22);
}, rep);
const rocketTex = () => canvasTex('rocket', 1024, 2048, (c, W, H) => {
  c.fillStyle = '#eef2f1'; c.fillRect(0, 0, W, H); noise(c, W, H, 6000, .025);
  c.fillStyle = 'rgba(30,40,45,.16)'; for (let i = 1; i < 12; i++) c.fillRect(0, i * H / 12, W, 3);
  c.fillStyle = 'rgba(30,40,45,.1)'; for (const u of [.375, .625, .875]) c.fillRect(u * W, 0, 3, H);
  c.fillStyle = '#2dd4bf'; c.fillRect(0, H * .16, W, 30); c.fillStyle = '#e879f9'; c.fillRect(0, H * .16 + 38, W, 10);
  c.fillStyle = '#1a2226'; c.fillRect(0, H * .94, W, H * .06);
  c.save(); c.translate(W * .125, H * .6); c.rotate(-Math.PI / 2); c.fillStyle = '#0b1215';
  c.font = '800 168px system-ui, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ORBYT', 0, 0); c.restore();
  c.font = '700 54px ui-monospace, monospace'; c.fillStyle = '#0b1215'; c.textAlign = 'center'; c.fillText('V-1', W * .125, H * .26);
  c.fillStyle = '#2dd4bf'; c.fillRect(W * .125 - 40, H * .29, 80, 50); c.fillStyle = '#0b1215'; c.fillRect(W * .125 - 40, H * .29 + 50, 80, 8);
}, [1, 1]);
const boosterTex = () => canvasTex('booster', 512, 1536, (c, W, H) => {
  c.fillStyle = '#e9eeed'; c.fillRect(0, 0, W, H); noise(c, W, H, 4000, .025);
  c.fillStyle = 'rgba(30,40,45,.16)'; for (let i = 1; i < 9; i++) c.fillRect(0, i * H / 9, W, 3);
  c.fillStyle = 'rgba(30,40,45,.1)'; for (const u of [.25, .5, .75]) c.fillRect(u * W, 0, 2, H);
  c.fillStyle = '#2dd4bf'; c.fillRect(0, H * .06, W, 16);
  c.fillStyle = '#1a2226'; c.fillRect(0, H * .9, W, H * .1);
  for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#1a2226' : '#e9eeed'; c.fillRect(i * W / 4, H * .86, W / 4, H * .04); }
}, [1, 1]);
const panelTex = (rep) => canvasTex('panels', 1024, 1024, (c, W, H) => {
  c.fillStyle = '#c3cbcc'; c.fillRect(0, 0, W, H); noise(c, W, H, 9000, .05);
  for (let x = 0; x < W; x += 32) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(x, 0, 2, H); }
  for (let y = 0; y < H; y += 128) { c.fillStyle = 'rgba(0,0,0,.14)'; c.fillRect(0, y, W, 3); }
  stains(c, W, H, 10, .08);
}, rep);
const logoTex = () => canvasTex('logo', 1024, 512, (c, W, H) => {
  c.clearRect(0, 0, W, H);
  // dark sign panel so the mark reads on the light facade
  c.fillStyle = '#08121a'; c.beginPath(); c.roundRect(8, 56, W - 16, H - 112, 60); c.fill();
  const cx = 230, cy = 256, rx = 168, ry = 55, tilt = -28 * Math.PI / 180;
  const ring = (a0, a1, col, w) => { c.save(); c.translate(cx, cy); c.rotate(tilt); c.beginPath(); c.ellipse(0, 0, rx, ry, 0, a0, a1); c.restore(); c.strokeStyle = col; c.lineWidth = w; c.stroke(); };
  ring(Math.PI, Math.PI * 2, 'rgba(232,251,248,.5)', 18);
  const g = c.createLinearGradient(cx - 70, cy - 80, cx + 70, cy + 90);
  g.addColorStop(0, '#5eead4'); g.addColorStop(.55, '#2dd4bf'); g.addColorStop(1, '#a855f7');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 94, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 16; c.lineCap = 'round'; c.beginPath(); c.arc(cx, cy, 68, Math.PI * 1.08, Math.PI * 1.45); c.stroke();
  ring(0, Math.PI, '#08121a', 36); ring(0, Math.PI, '#e8fbf8', 18);
  const sx = cx + rx * Math.cos(tilt), sy = cy + rx * Math.sin(tilt);
  c.fillStyle = '#08121a'; c.beginPath(); c.arc(sx, sy, 40, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#e879f9'; c.beginPath(); c.arc(sx, sy, 28, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#e8fbf8'; c.font = '700 176px system-ui, Segoe UI, sans-serif'; c.textBaseline = 'middle'; c.fillText('orbyt', 440, 262);
});
const padDecalTex = () => canvasTex('pad', 1024, 1024, (c, W, H) => {
  c.clearRect(0, 0, W, H); c.strokeStyle = 'rgba(245,208,97,.9)'; c.lineWidth = 22;
  c.beginPath(); c.arc(W / 2, H / 2, 440, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 8; c.beginPath(); c.arc(W / 2, H / 2, 400, 0, Math.PI * 2); c.stroke();
  c.fillStyle = 'rgba(232,251,248,.92)'; c.font = '800 300px system-ui, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('LC-1', W / 2, H / 2 + 10);
});
const puffTex = () => canvasTex('puff', 128, 128, (c, W, H) => {
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(.25, 'rgba(255,255,255,.45)'); g.addColorStop(.6, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
});
const beamTex = () => canvasTex('beam', 8, 256, (c, W, H) => {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
});

function sun(scene, color, intensity, pos, size = 140, map = 2048) {
  const d = new THREE.DirectionalLight(color, intensity);
  d.position.set(...pos); d.castShadow = true;
  d.shadow.mapSize.set(map, map);
  Object.assign(d.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 900 });
  d.shadow.bias = -.0003; d.shadow.normalBias = .35;
  scene.add(d, d.target); return d;
}
function skyDome(scene, top, mid, horizon, radius = 1400) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, horizon: { value: new THREE.Color(horizon) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vP;
      void main(){ float h = max(vP.y, 0.); vec3 c = mix(horizon, mid, smoothstep(0., .18, h)); c = mix(c, top, smoothstep(.12, .75, h)); gl_FragColor = vec4(c, 1.); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat); scene.add(m); return m;
}
function stars(scene, count = 1600, radius = 1300) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = .1 + Math.random() * .9, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: .85, fog: false })));
}
function mountains(scene, radius, color, base = 30, amp = 70) {
  const N = 240, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2;
    const h = base + amp * (.5 + .5 * Math.sin(a * 3.1 + 1)) * (.6 + .4 * Math.sin(a * 11.7)) + 12 * Math.sin(a * 37.3) + 6 * Math.sin(a * 71);
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, -5, z, x, Math.max(10, h), z);
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true })));
}
function catenary(a, b, sag, mat, parent, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t)); }
  parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
}
function ogive(R, H, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector2(Math.max(.001, R * Math.pow(Math.cos(t * Math.PI / 2), .62)), t * H)); }
  return new THREE.LatheGeometry(pts, 48);
}
function bellGeo() {
  return new THREE.LatheGeometry([[1.05, 0], [.92, .5], [.78, 1.1], [.62, 1.8], [.48, 2.4]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
}
function makeEnv(renderer, top, mid, horizon, warm = 0xffe2c4, cool = TEAL) {
  const s = new THREE.Scene();
  skyDome(s, top, mid, horizon, 50);
  const p1 = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(warm).multiplyScalar(4), side: THREE.DoubleSide }));
  p1.position.set(30, 18, 25); p1.lookAt(0, 0, 0); s.add(p1);
  const p2 = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(cool).multiplyScalar(1.5), side: THREE.DoubleSide }));
  p2.position.set(-30, 8, -20); p2.lookAt(0, 0, 0); s.add(p2);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0).texture; pm.dispose();
  return env;
}

/* ================= scene 1: launch complex (hero) ================= */
function buildLaunchSite(renderer) {
  const scene = new THREE.Scene();
  const SKY = [0x040b12, 0x12404a, 0x4a3350];
  skyDome(scene, ...SKY);
  scene.environment = makeEnv(renderer, 0x0a1a24, 0x2a6a74, 0x8a5a80);
  scene.fog = new THREE.Fog(0x123842, 260, 1150);
  stars(scene);
  mountains(scene, 900, 0x0b2128, 25, 80);
  mountains(scene, 760, 0x0f2c33, 10, 45);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(22, 32, 16), glowBasic(0xeaf6ff, 2.2));
  moon.position.set(-520, 330, -1000); scene.add(moon);

  scene.add(new THREE.HemisphereLight(0x8fd8e0, 0x2a1830, 1.1));
  sun(scene, 0xcfe8ff, 2.2, [150, 190, -70], 170, 4096);
  const rim = new THREE.DirectionalLight(PINK, .8); rim.position.set(-160, 50, -120); scene.add(rim);

  const animated = [];

  // --- ground layers
  const ground = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), std(0xffffff, { map: groundTex([160, 160]), roughness: 1 })), false);
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const apron = shadowed(new THREE.Mesh(new THREE.CircleGeometry(92, 96), std(0xffffff, { map: concreteTex([9, 9]), roughness: .92 })), false);
  apron.rotation.x = -Math.PI / 2; apron.position.y = .03; scene.add(apron);
  const road = shadowed(new THREE.Mesh(new THREE.RingGeometry(95, 106, 160, 1), std(0xffffff, { map: asphaltTex([30, 2]), roughness: .85 })), false);
  road.rotation.x = -Math.PI / 2; road.position.y = .05; scene.add(road);
  // road dashes + edge lines
  const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(3, .04, .35), new THREE.MeshStandardMaterial({ color: 0xf5d061, roughness: .6 }), 110);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 110; i++) {
    const a = i / 110 * Math.PI * 2;
    dash.setMatrixAt(i, m4.compose(v.set(Math.cos(a) * 100.5, .08, Math.sin(a) * 100.5), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2), one));
  }
  dash.receiveShadow = true; scene.add(dash);
  for (const r of [95.6, 105.4]) {
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - .18, r + .18, 200), new THREE.MeshStandardMaterial({ color: 0xdfe8e8, roughness: .6 }));
    edge.rotation.x = -Math.PI / 2; edge.position.y = .07; edge.receiveShadow = true; scene.add(edge);
  }
  // crawlerway to the assembly building
  for (const x of [-8, 8]) {
    const strip = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(10, 150), std(0xffffff, { map: gravelTex([2, 30]), roughness: 1 })), false);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, .09, -110); scene.add(strip);
  }
  // chase lights along the crawlerway
  const chaseN = 2 * 24;
  const chase = new THREE.InstancedMesh(new THREE.SphereGeometry(.35, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), chaseN);
  for (let i = 0; i < chaseN; i++) {
    const side = i % 2 ? 14 : -14, k = Math.floor(i / 2);
    chase.setMatrixAt(i, m4.compose(v.set(side, .4, -38 - k * 6), q.identity(), one));
    chase.setColorAt(i, new THREE.Color(TEAL));
  }
  scene.add(chase);
  const chaseColor = new THREE.Color();
  animated.push(t => {
    for (let i = 0; i < chaseN; i++) {
      const k = Math.floor(i / 2), s = Math.pow(Math.max(0, Math.sin(t * 4 + k * .55)), 6);
      chase.setColorAt(i, chaseColor.setHex(TEAL).multiplyScalar(.25 + s * 5));
    }
    chase.instanceColor.needsUpdate = true;
  });
  // painted decal on apron
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshStandardMaterial({ map: padDecalTex(), transparent: true, roughness: .8, depthWrite: false }));
  decal.rotation.x = -Math.PI / 2; decal.rotation.z = -.6; decal.position.set(48, .1, 52); decal.receiveShadow = true; scene.add(decal);

  // --- launch pad hardstand
  const padMat = std(0xffffff, { map: concreteTex([3, 1]), roughness: .95 });
  const hard = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(34, 42, 5, 8), padMat)); hard.position.y = 2.5; hard.rotation.y = Math.PI / 8; scene.add(hard);
  const trench = box(12, .2, 92, std(0x050708, { roughness: 1 }), 0, 5.02, 0, scene); trench.castShadow = false;
  for (const s of [-1, 1]) box(1.2, 1.2, 92, std(0x5f6a6d), s * 6.6, 5.6, 0, scene);
  const deflector = box(10, 4, 8, std(0x2a2f33, { metalness: .6, roughness: .5 }), 0, 3, 0, scene); deflector.rotation.x = .5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(33.2, .35, 8, 120), glowBasic(TEAL, 3)); ring.rotation.x = Math.PI / 2; ring.position.y = 5.08; scene.add(ring);
  animated.push(t => ring.material.color.setHex(TEAL).multiplyScalar(2 + Math.sin(t * 1.6) * 1.3));
  // launch mount
  const mountMat = std(0x3c4448, { metalness: .7, roughness: .45 });
  const mount = new Merge();
  mount.box(18, 2, 18, [0, 10, 0]);
  for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) mount.box(2.2, 5, 2.2, [x, 7.5, z]);
  for (const s of [-1, 1]) { mount.beam([s * 7, 5, -7], [s * 7, 9, 7], .6); mount.beam([-7, 5, s * 7], [7, 9, s * 7], .6); }
  scene.add(mount.mesh(mountMat));
  // water deluge towers
  for (const [x, z] of [[24, 18], [-24, 22]]) {
    cyl(.6, .6, 18, std(0xb7bdbf, { metalness: .6, roughness: .4 }), x, 14, z, scene, 12);
    cyl(1.5, 1.5, 3, std(0xdfe5e6), x, 23.5, z, scene, 16);
  }

  // --- rocket
  const rocket = new THREE.Group(); scene.add(rocket);
  const R = 3.6, y0 = 11;
  const body = new THREE.MeshStandardMaterial({ map: rocketTex(), roughness: .42, metalness: .15 });
  const white = std(0xe6ecea, { roughness: .42, metalness: .15 });
  const black = std(0x14191c, { roughness: .4, metalness: .55 });
  const metal = std(0x9aa3a7, { roughness: .25, metalness: .95 });
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: .35, metalness: .9, side: THREE.DoubleSide });
  const bg = bellGeo();
  const addBell = (x, z, s, yy) => { const b = shadowed(new THREE.Mesh(bg, bellMat)); b.scale.setScalar(s); b.position.set(x, yy, z); rocket.add(b); };
  addBell(0, 0, .9, y0);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; addBell(Math.cos(a) * 2.35, Math.sin(a) * 2.35, .8, y0); }
  cyl(R, R * .92, 2.6, black, 0, y0 + 2.4 + 1.3, 0, rocket, 48);
  const core = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 48, 64, 1, true), body)); core.position.y = y0 + 5 + 24; rocket.add(core);
  cyl(R + .04, R + .04, 4, black, 0, y0 + 53 + 2, 0, rocket, 64);
  // interstage ribs
  const ribs = new Merge();
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; ribs.box(.18, 4, .12, [Math.sin(a) * (R + .1), y0 + 55, Math.cos(a) * (R + .1)], [0, a, 0]); }
  rocket.add(ribs.mesh(black));
  cyl(R, R, 10, white, 0, y0 + 57 + 5, 0, rocket, 64);
  cyl(R + .02, R + .02, .7, glowBasic(TEAL, 1.6), 0, y0 + 64, 0, rocket, 64);
  cyl(R + .35, R, 1.6, white, 0, y0 + 67.8, 0, rocket, 64);
  cyl(R + .35, R + .35, 6, white, 0, y0 + 71.6, 0, rocket, 64);
  const nose = shadowed(new THREE.Mesh(ogive(R + .35, 13), white)); nose.position.y = y0 + 74.6; rocket.add(nose);
  // fairing seam
  box(.08, 19, .3, std(0xb9c2c4), 0, y0 + 77, R + .3, rocket).castShadow = false;
  // grid fins and raceway
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, fin = box(2.4, .25, 1.8, metal, Math.sin(a) * (R + 1.1), y0 + 51, Math.cos(a) * (R + 1.1), rocket);
    fin.rotation.y = a;
  }
  box(.6, 44, .5, std(0xd9dfe0), Math.sin(-.9) * (R + .2), y0 + 30, Math.cos(-.9) * (R + .2), rocket).rotation.y = -.9;
  // side boosters (on ±z so the tower can reach the core)
  for (const s of [-1, 1]) {
    const z = s * 6.4, br = 2.4;
    addBell(0, z, .7, y0 + .4);
    cyl(br, br * .9, 2, black, 0, y0 + 3.6, z, rocket, 40);
    const bb = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(br, br, 36, 48, 1, true), body)); bb.position.set(0, y0 + 4.6 + 18, z); rocket.add(bb);
    bb.material = new THREE.MeshStandardMaterial({ map: boosterTex(), roughness: .42, metalness: .15 });
    const bn = shadowed(new THREE.Mesh(ogive(br, 8), white)); bn.position.set(0, y0 + 40.6, z); rocket.add(bn);
    for (const yy of [y0 + 8, y0 + 38]) { const st = cyl(.25, .25, 1.7, metal, 0, yy, s * 4.45, rocket, 8); st.rotation.x = Math.PI / 2; }
  }
  // venting LOX + pad steam
  const puff = puffTex();
  const emitters = [
    { o: [R + .3, y0 + 60, 0], v: [9, -7, 3], n: 18, life: 4.5, s0: 2, s1: 9, op: .35, jit: 4 },
    { o: [-R - .3, y0 + 60, 2], v: [-6, -8, 4], n: 14, life: 5, s0: 2, s1: 8, op: .25, jit: 4 },
    { o: [0, 6, 46], v: [0, 16, 22], n: 22, life: 6, s0: 5, s1: 26, op: .32, jit: 8 },
    { o: [0, 6, -46], v: [0, 16, -22], n: 22, life: 6, s0: 5, s1: 26, op: .32, jit: 8 },
    { o: [0, 8, 0], v: [0, 3, 0], n: 16, life: 5, s0: 6, s1: 18, op: .18, jit: 14 },
  ];
  // all steam puffs live in one point cloud = one draw call
  const puffs = [];
  for (const e of emitters) for (let k = 0; k < e.n; k++)
    puffs.push({ e, phase: k / e.n + Math.random() * .05, jit: [(Math.random() - .5) * e.jit, Math.random() * e.jit * .5, (Math.random() - .5) * e.jit] });
  const steamGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(puffs.length * 3), sSize = new Float32Array(puffs.length), sAlpha = new Float32Array(puffs.length);
  steamGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  steamGeo.setAttribute('size', new THREE.BufferAttribute(sSize, 1));
  steamGeo.setAttribute('alpha', new THREE.BufferAttribute(sAlpha, 1));
  const steamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: puff }, color: { value: new THREE.Color(0x9fb8bc) }, scale: { value: 600 } },
    vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float scale;
      void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = min(size * scale / -mv.z, 900.); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
      void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < .004) discard; gl_FragColor = vec4(color, a); }`,
  });
  const steam = new THREE.Points(steamGeo, steamMat); steam.frustumCulled = false; scene.add(steam);
  const dbs = new THREE.Vector2();
  // keep puff size in world units whatever the resolution / fov
  steam.onBeforeRender = (r, s, cam) => { r.getDrawingBufferSize(dbs); const rt = r.getRenderTarget(); const h = rt ? rt.height : dbs.y; steamMat.uniforms.scale.value = h / (2 * Math.tan(cam.fov * Math.PI / 360)); };
  animated.push(t => {
    puffs.forEach(({ e, phase, jit }, i) => {
      const age = (t / e.life + phase) % 1;
      sPos[i * 3] = e.o[0] + (e.v[0] + jit[0]) * age; sPos[i * 3 + 1] = e.o[1] + (e.v[1] + jit[1]) * age; sPos[i * 3 + 2] = e.o[2] + (e.v[2] + jit[2]) * age;
      sSize[i] = e.s0 + (e.s1 - e.s0) * Math.sqrt(age);
      sAlpha[i] = e.op * Math.sin(Math.PI * age) * (1 - age * .4);
    });
    steamGeo.attributes.position.needsUpdate = steamGeo.attributes.size.needsUpdate = steamGeo.attributes.alpha.needsUpdate = true;
  });

  // --- service tower (one merged lattice)
  const TX = -15.5, S = 4.6, TH = 100;
  const red = std(0xa33b2f, { metalness: .55, roughness: .5 });
  const lat = new Merge();
  const C = [[-S, -S], [S, -S], [S, S], [-S, S]];
  for (const [x, z] of C) lat.box(.9, TH, .9, [TX + x, 5 + TH / 2, z]);
  for (let y = 5; y < TH + 5; y += 5) {
    const y1 = y + 5;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = C[i], [bx, bz] = C[(i + 1) % 4];
      lat.beam([TX + ax, y1, az], [TX + bx, y1, bz], .45);
      lat.beam([TX + ax, y, az], [TX + bx, y1, bz], .3);
      lat.beam([TX + bx, y, bz], [TX + ax, y1, az], .3);
    }
  }
  for (const y of [25, 45, 65, 85]) lat.box(12, .5, 12, [TX, y, 0]);
  // crew access arm + white room
  lat.box(8.6, .6, 2.6, [TX + S + 4.3, y0 + 71, 0]);
  for (const s of [-1, 1]) lat.beam([TX + S, y0 + 71, s * 1.2], [TX + S + 8.6, y0 + 73.5, s * 1.2], .25);
  // umbilical arms
  for (const yy of [y0 + 30, y0 + 50]) { lat.box(7, 1, 1.4, [TX + S + 3.5, yy, 0]); lat.beam([TX + S, yy - 4, 0], [TX + S + 6, yy, 0], .4); }
  // lightning mast
  lat.box(.6, 18, .6, [TX, TH + 14, 0]);
  scene.add(lat.mesh(red));
  box(3.6, 3.8, 3.6, white, TX + S + 9.6, y0 + 73, 0, scene);
  box(.1, 1.4, 2.4, glowBasic(0xfff1d0, 2.2), TX + S + 11.45, y0 + 73.4, 0, scene).castShadow = false;
  // hoses
  const hoseMat = std(0x1d2326, { roughness: .6 });
  for (const yy of [y0 + 30, y0 + 50]) for (const dz of [-.6, .6]) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(TX + S + 6.5, yy, dz), new THREE.Vector3(TX + S + 8, yy - 3, dz * 1.6), new THREE.Vector3(-R - .1, yy - 1.5, dz)]);
    scene.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, .22, 8), hoseMat)));
  }
  // elevator car
  const elevator = box(2.6, 3.2, 2.6, std(0xf5d061, { metalness: .3, roughness: .5 }), TX, 10, 0, scene);
  const elevLamp = box(.1, .5, 1.6, glowBasic(0xfff1d0, 3), TX + 1.35, 11, 0, scene);
  animated.push(t => { const y = 8 + (Math.sin(t * .22) * .5 + .5) * 84; elevator.position.y = y; elevLamp.position.y = y + 1; });
  // beacons share one blinking material
  const beaconMat = glowBasic(0xff3355, 4);
  const beacon = (x, y, z) => { const b = new THREE.Mesh(new THREE.SphereGeometry(.7, 12, 8), beaconMat); b.position.set(x, y, z); scene.add(b); };
  beacon(TX, TH + 23.5, 0); for (const [x, z] of C) beacon(TX + x, TH + 5.4, z);
  animated.push(t => beaconMat.color.setHex(0xff3355).multiplyScalar(Math.sin(t * 2.6) > .2 ? 5 : .15));

  // lightning protection towers + wires
  const wireMat = new THREE.LineBasicMaterial({ color: 0x2b3438 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, x = Math.cos(a) * 52, z = Math.sin(a) * 52;
    const m = new Merge();
    for (let k = 0; k < 3; k++) { const b = k / 3 * Math.PI * 2; m.beam([x + Math.cos(b) * 2.2, 0, z + Math.sin(b) * 2.2], [x + Math.cos(b) * .5, 78, z + Math.sin(b) * .5], .35); }
    for (let y = 6; y < 78; y += 8) for (let k = 0; k < 3; k++) {
      const b0 = k / 3 * Math.PI * 2, b1 = (k + 1) / 3 * Math.PI * 2, r0 = 2.2 - y / 78 * 1.7, r1 = 2.2 - (y + 8) / 78 * 1.7;
      m.beam([x + Math.cos(b0) * r0, y, z + Math.sin(b0) * r0], [x + Math.cos(b1) * r1, y + 8, z + Math.sin(b1) * r1], .18);
    }
    scene.add(m.mesh(std(0xb8c0c2, { metalness: .6, roughness: .45 })));
    beacon(x, 79, z);
    catenary([x, 78, z], [TX, TH + 22, 0], 9, wireMat, scene);
    for (let j = 1; j <= 2; j++) { const b = (i + j * .5) * Math.PI / 2 + Math.PI / 4; catenary([x, 78, z], [Math.cos(b) * 52, 78, Math.sin(b) * 52], 7, wireMat, scene); }
  }

  // floodlight masts with visible beams + real spotlights
  // soft volumetric-looking beam: bright near the lamp, fades along its length and at grazing edges
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(0xfff1da) }, strength: { value: .16 } },
    vertexShader: `varying float vL; varying vec3 vN; varying vec3 vV;
      void main(){ vL = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying float vL; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.5); float l = clamp(vL, 0., 1.); float a = l * l * edge * strength; gl_FragColor = vec4(color * a, a); }`,
  });
  const rocketAim = new THREE.Vector3(0, 48, 0);
  [20, 80, 150, 210, 275, 330].forEach((deg, i) => {
    const a = deg * Math.PI / 180, x = Math.cos(a) * 66, z = Math.sin(a) * 66, h = 34;
    cyl(.5, .8, h, std(0x6c7679, { metalness: .6, roughness: .4 }), x, h / 2, z, scene, 10);
    const head = new THREE.Group(); head.position.set(x, h + 1.5, z); scene.add(head);
    head.lookAt(rocketAim);
    box(5, 3.4, .8, std(0x2a3134, { metalness: .6 }), 0, 0, 0, head);
    for (let k = 0; k < 6; k++) { const l = box(1.3, 1.2, .1, glowBasic(0xfff3dc, 4), -1.6 + (k % 3) * 1.6, k < 3 ? .75 : -.75, .45, head); l.castShadow = false; }
    const len = rocketAim.clone().sub(head.position).length() * .95;
    const coneGeo = new THREE.ConeGeometry(11, len, 40, 1, true); coneGeo.translate(0, -len / 2, 0);
    const cone = new THREE.Mesh(coneGeo, beamMat);
    cone.position.copy(head.position);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), rocketAim.clone().sub(head.position).normalize());
    scene.add(cone);
    if (i % 2 === 0) {
      const sp = new THREE.SpotLight(0xfff0d8, 5200, 220, .32, .7, 2);
      sp.position.copy(head.position); sp.target.position.copy(rocketAim); scene.add(sp, sp.target);
    }
  });

  // perimeter fence
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.12, .12, 3.2, 6), std(0x8d989b, { metalness: .7 }), 120);
  for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2; posts.setMatrixAt(i, m4.compose(v.set(Math.cos(a) * 82, 1.6, Math.sin(a) * 82), q.identity(), one)); }
  posts.castShadow = true; scene.add(posts);
  for (const h of [1, 2, 3]) {
    const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 82, h, Math.sin(a) * 82)); }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x55605f })));
  }

  // road lamps with light pools
  const pool = new THREE.MeshBasicMaterial({ map: puff, color: 0xffd9a0, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + .1, x = Math.cos(a) * 109, z = Math.sin(a) * 109;
    cyl(.2, .28, 11, std(0x4b5558, { metalness: .6 }), x, 5.5, z, scene, 8);
    const arm = box(3, .25, .3, std(0x4b5558), x - Math.cos(a) * 1.4, 11, z - Math.sin(a) * 1.4, scene); arm.rotation.y = -a;
    const head = box(1.2, .25, .6, glowBasic(0xffe2b0, 4), x - Math.cos(a) * 2.8, 10.8, z - Math.sin(a) * 2.8, scene); head.rotation.y = -a; head.castShadow = false;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), pool); p.rotation.x = -Math.PI / 2; p.position.set(x - Math.cos(a) * 4, .12, z - Math.sin(a) * 4); scene.add(p);
  }

  // --- vehicle assembly building (backdrop)
  const vab = new THREE.Group(); vab.position.set(0, 0, -195); scene.add(vab);
  box(74, 96, 58, std(0xffffff, { map: panelTex([3, 4]), roughness: .7 }), 0, 48, 0, vab);
  box(28, 76, .6, std(0x0b1418, { roughness: .4, metalness: .5 }), 0, 38, 29.1, vab);
  for (let k = 0; k < 9; k++) box(28, .25, .3, std(0x1f2a2e), 0, 4 + k * 8.4, 29.5, vab);
  for (const s of [-1, 1]) box(.5, 76, .5, glowBasic(TEAL, 2.5), s * 14.4, 38, 29.6, vab).castShadow = false;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ map: logoTex(), transparent: true, emissive: 0xffffff, emissiveMap: logoTex(), emissiveIntensity: .35, roughness: .6 }));
  logo.position.set(37.1, 72, 0); logo.rotation.y = Math.PI / 2; vab.add(logo);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) { const w = box(4, 2.2, .2, glowBasic(Math.random() > .35 ? 0xbfefff : 0x16262a, 1.4), 37.2, 10 + r * 8, -22 + c * 8.8, vab); w.rotation.y = Math.PI / 2; w.castShadow = false; }
  for (const [x, z] of [[-37, -29], [37, -29], [-37, 29], [37, 29]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(.8, 10, 8), beaconMat); b.position.set(x, 96.6, z); vab.add(b); }
  // crawler transporter parked on the crawlerway
  const crawler = new THREE.Group(); crawler.position.set(0, 0, -142); scene.add(crawler);
  box(36, 5, 30, std(0x5a6366, { metalness: .5, roughness: .55 }), 0, 6.5, 0, crawler);
  box(36.2, .8, 30.2, std(0xf5d061), 0, 8.6, 0, crawler);
  for (const [x, z] of [[-13, -11], [13, -11], [-13, 11], [13, 11]]) box(9, 4, 7, std(0x1e2326, { metalness: .6 }), x, 2, z, crawler);
  box(4, 3, 4, std(0x3a4245), -15, 10.5, 12, crawler);

  // --- hangar with ribbed arch roof
  const hangar = new THREE.Group(); hangar.position.set(-112, 0, 52); hangar.rotation.y = .5; scene.add(hangar);
  const roof = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 64, 48, 1, true, 0, Math.PI), std(0xa9b6b8, { metalness: .65, roughness: .35, side: THREE.DoubleSide })));
  roof.rotation.z = Math.PI / 2; roof.position.y = 3; hangar.add(roof);
  const ribM = new Merge();
  for (let i = 0; i <= 8; i++) ribM.add(new THREE.TorusGeometry(19.15, .28, 6, 40, Math.PI), [-32 + i * 8, 3, 0], [0, Math.PI / 2, 0]);
  hangar.add(ribM.mesh(std(0x6c787b, { metalness: .7 })));
  box(64, 3, 38, std(0xb8c2c3), 0, 1.5, 0, hangar);
  const endCap = (x, doorGlow) => {
    const cap = shadowed(new THREE.Mesh(new THREE.CircleGeometry(19, 40, 0, Math.PI), std(0xc9d1d2, { side: THREE.DoubleSide })));
    cap.rotation.y = Math.PI / 2; cap.position.set(x, 3, 0); hangar.add(cap);
    if (doorGlow) {
      box(.3, 13, 22, glowBasic(0xffd9a8, 1.1), x + .2, 6.5, 0, hangar).castShadow = false;
      box(.4, .5, 23, glowBasic(TEAL, 3), x + .3, 13.4, 0, hangar).castShadow = false;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(30, 34), pool); p.rotation.x = -Math.PI / 2; p.position.set(x + 14, .13, 0); hangar.add(p);
    }
  };
  endCap(32, true); endCap(-32, false);
  // crates near hangar
  const crateMats = [std(0x2b6f73, { roughness: .6 }), std(0x8a3b6f, { roughness: .6 }), std(0xd6dcdc, { roughness: .6 })];
  for (let i = 0; i < 24; i++) box(5.8, 2.6, 2.4, crateMats[i % 3], -70 + (i % 6) * 6.2, 1.3 + Math.floor(i / 6) % 2 * 2.6, 78 + Math.floor(i / 12) * 3, scene);

  // --- tank farm + pipe rack
  const tankMat = std(0xeef3f2, { roughness: .25, metalness: .35 });
  const legMat = std(0x7d878a, { metalness: .7, roughness: .4 });
  [[78, -34], [98, -54], [72, -66]].forEach(([x, z]) => {
    const s = shadowed(new THREE.Mesh(new THREE.SphereGeometry(9, 48, 24), tankMat)); s.position.set(x, 13, z); scene.add(s);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; cyl(.4, .4, 13, legMat, x + Math.cos(a) * 7.6, 6.5, z + Math.sin(a) * 7.6, scene, 8); }
    const cw = new THREE.Mesh(new THREE.TorusGeometry(9.6, .25, 6, 48), legMat); cw.rotation.x = Math.PI / 2; cw.position.set(x, 13, z); scene.add(cw);
    box(.3, 26, .3, legMat, x + 9.2, 13, z, scene);
  });
  for (const [x, z] of [[108, -16], [114, -24]]) {
    const h = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(3.4, 20, 8, 32), tankMat)); h.rotation.z = Math.PI / 2; h.position.set(x, 5, z); scene.add(h);
    for (const dx of [-7, 7]) box(1, 2, 5, legMat, x + dx, 1, z, scene);
  }
  {
    const a = new THREE.Vector3(66, 0, -30), b = new THREE.Vector3(36, 0, -14), dir = b.clone().sub(a), L = dir.length(), ang = Math.atan2(dir.x, dir.z);
    const rack = new Merge();
    for (let d = 0; d <= L; d += 6) { const p = a.clone().addScaledVector(dir, d / L); for (const s of [-1.6, 1.6]) rack.box(.4, 6, .4, [p.x + Math.cos(ang) * s, 3, p.z - Math.sin(ang) * s]); rack.box(3.8, .4, .4, [p.x, 6, p.z], [0, ang, 0]); }
    scene.add(rack.mesh(legMat));
    const mid = a.clone().add(b).multiplyScalar(.5);
    [[0xe9e3d3, -1], [0xf5d061, 0], [0xbfc8ca, 1]].forEach(([c, o]) => {
      const p = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, L + 4, 12), std(c, { metalness: .5, roughness: .35 })));
      p.position.set(mid.x + Math.cos(ang) * o, 6.7, mid.z - Math.sin(ang) * o); p.rotation.set(Math.PI / 2, 0, 0); p.rotation.y = ang; p.rotation.order = 'YXZ'; p.rotation.x = Math.PI / 2;
      scene.add(p);
    });
  }
  // water tower
  {
    const x = 128, z = 30;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const m = new Merge(); m.beam([x + Math.cos(a) * 6, 0, z + Math.sin(a) * 6], [x + Math.cos(a) * 3.5, 40, z + Math.sin(a) * 3.5], .6); scene.add(m.mesh(legMat)); }
    cyl(7, 7, 12, std(0xdfe6e7, { roughness: .4, metalness: .3 }), x, 46, z, scene, 40);
    const cap = shadowed(new THREE.Mesh(new THREE.ConeGeometry(7.2, 4, 40), std(0xb9c3c4, { metalness: .4 }))); cap.position.set(x, 54, z); scene.add(cap);
    cyl(7.05, 7.05, 1.2, std(TEAL, { emissive: TEAL, emissiveIntensity: .25 }), x, 47, z, scene, 40);
    beacon(x, 56.3, z);
  }

  // --- trucks driving the ring road
  const trucks = [];
  const tColors = [0xf2f5f4, TEAL, 0xf5d061, 0xf2f5f4, PINK, 0xdfe5e6];
  tColors.forEach((c, i) => {
    const g = new THREE.Group();
    box(9, .9, 2.4, std(0x22292c, { metalness: .5 }), 0, 1.3, 0, g);
    box(2.8, 2.7, 2.6, std(c, { roughness: .35, metalness: .3 }), 3.3, 2.9, 0, g);
    box(.1, 1.1, 2.2, std(0x0d1417, { roughness: .1, metalness: .9 }), 4.72, 3.4, 0, g);
    const tank = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 4.2, 6, 20), std(i % 2 ? 0xdfe5e6 : c, { roughness: .25, metalness: .5 })));
    tank.rotation.z = Math.PI / 2; tank.position.set(-1.4, 3.1, 0); g.add(tank);
    for (const wx of [3.2, -.6, -2.6]) for (const s of [-1, 1]) { const w = cyl(.65, .65, .5, std(0x111416, { roughness: .8 }), wx, .65, s * 1.2, g, 14); w.rotation.x = Math.PI / 2; }
    for (const s of [-.8, .8]) { box(.1, .35, .5, glowBasic(0xffffff, 6), 4.76, 2.1, s, g).castShadow = false; box(.1, .3, .4, glowBasic(0xff2244, 4), -4.52, 1.5, s, g).castShadow = false; }
    const hl = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshBasicMaterial({ map: puff, color: 0xfff4e0, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false }));
    hl.rotation.x = -Math.PI / 2; hl.position.set(10, .15, 0); g.add(hl);
    scene.add(g); trucks.push({ g, off: i / tColors.length, dir: i % 2 ? -1 : 1 });
  });
  animated.push(t => {
    for (const { g, off, dir } of trucks) {
      const a = (off + dir * t * .018) * Math.PI * 2, r = dir > 0 ? 98 : 103;
      g.position.set(Math.cos(a) * r, .05, Math.sin(a) * r);
      g.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)) + (dir > 0 ? 0 : Math.PI);
    }
  });

  // moving parts keep their own meshes but stop casting shadows, so the shadow map can be drawn once
  const moving = [elevator, elevLamp, ...trucks.map(t => t.g)];
  moving.forEach(o => o.traverse(c => { c.castShadow = false; }));
  bakeStatic(scene, new Set(moving));
  return { scene, update: t => animated.forEach(f => f(t)) };
}

/* ================= scene 2: server hall ================= */
const rackFrontTex = () => canvasTex('rackfront', 256, 1024, (c, W, H) => {
  c.fillStyle = '#0c1013'; c.fillRect(0, 0, W, H);
  for (let y = 14; y < H - 14; y += 22) {
    const blank = Math.random() < .12;
    c.fillStyle = blank ? '#07090b' : '#1a2126'; c.fillRect(12, y, W - 24, 19);
    if (blank) continue;
    c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(12, y, W - 24, 2);
    c.fillStyle = '#0a0d10'; for (let x = 26; x < W - 70; x += 10) c.fillRect(x, y + 6, 6, 8);
  }
  c.strokeStyle = '#2b343a'; c.lineWidth = 8; c.strokeRect(4, 4, W - 8, H - 8);
}, [1, .5]);
const rackLedTex = (v) => canvasTex('rackled' + v, 256, 1024, (c, W, H) => {
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  const cols = ['#2dd4bf', '#2dd4bf', '#5eead4', '#5eead4', '#e879f9', '#818cf8', '#a3e635'];
  for (let y = 14; y < H - 14; y += 22) {
    if (Math.random() < .14) continue;
    const col = cols[Math.floor(Math.random() * cols.length)];
    for (let k = 0; k < 4; k++) if (Math.random() > .35) { c.fillStyle = col; c.fillRect(W - 62 + k * 11, y + 7, 6, 5); }
    if (Math.random() > .55) { c.fillStyle = 'rgba(45,212,191,.45)'; c.fillRect(22, y + 16, (W - 100) * Math.random(), 2); }
  }
}, [1, .5]);
const tileTex = (rep) => canvasTex('tiles', 512, 512, (c, W, H) => {
  c.fillStyle = '#a9b2b7'; c.fillRect(0, 0, W, H); noise(c, W, H, 5000, .04);
  const n = 4, s = W / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j * 3) % 5 === 0) {
    c.fillStyle = '#8c969b'; c.fillRect(i * s + 6, j * s + 6, s - 12, s - 12);
    c.fillStyle = 'rgba(0,0,0,.28)'; for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) c.fillRect(i * s + 16 + a * 16, j * s + 16 + b * 16, 7, 7);
  }
  c.fillStyle = 'rgba(40,48,52,.5)'; for (let k = 0; k <= n; k++) { c.fillRect(k * s - 1.5, 0, 3, H); c.fillRect(0, k * s - 1.5, W, 3); }
}, rep);
const gridTex = (rep) => canvasTex('grid', 512, 512, (c, W, H) => {
  c.fillStyle = '#0a0f15'; c.fillRect(0, 0, W, H); noise(c, W, H, 3000, .05);
  c.fillStyle = 'rgba(94,234,212,.14)'; c.fillRect(0, 0, W, 2); c.fillRect(0, 0, 2, H);
}, rep);

function buildServerHall(renderer) {
  const scene = new THREE.Scene();
  skyDome(scene, 0x04060c, 0x0a1020, 0x1a1430);
  scene.environment = makeEnv(renderer, 0x0a1020, 0x1c2648, 0x3a2c48, 0xdde7ff, PINK);
  scene.fog = new THREE.Fog(0x080c16, 170, 460);
  scene.add(new THREE.HemisphereLight(0xb6c6ff, 0x140a1a, .5));
  sun(scene, 0xe6ecff, 1.2, [70, 120, 50], 95);

  const ground = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(900, 900), std(0xffffff, { map: gridTex([90, 90]), roughness: .9 })), false);
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  box(86, 1.2, 62, std(0x4f585d, { roughness: .9 }), 0, .6, 0, scene);
  box(82, .3, 58, std(0xffffff, { map: tileTex([20, 14]), roughness: .5, metalness: .1 }), 0, 1.35, 0, scene);

  // cut-away walls with a glowing cut line
  const wallMat = std(0xaab3ba, { roughness: .8 }), cut = glowBasic(TEAL, 1.3);
  const wall = (w, h, d, x, z) => { box(w, h, d, wallMat, x, 1.5 + h / 2, z, scene); box(w, .22, d, cut, x, 1.5 + h + .11, z, scene).castShadow = false; };
  wall(82, 13, 1, 0, -29); wall(1, 13, 58, -41, 0); wall(82, 2.4, 1, 0, 29); wall(1, 2.4, 58, 41, 0);

  // racks: 3 pods, each two rows facing a contained cold aisle
  const side = std(0x14181b, { metalness: .75, roughness: .35 }), back = std(0x0b0e10, { roughness: .6 });
  const rackGeo = new THREE.BoxGeometry(2.4, 7.5, 2.6);
  const glass = new THREE.MeshStandardMaterial({ color: 0xa8f0ff, transparent: true, opacity: .13, roughness: .05, metalness: .3, depthWrite: false });
  const PER = 22, step = 2.5, x0 = -(PER - 1) * step / 2;
  [-17, 0, 17].forEach((cz, pod) => {
    for (const dir of [-1, 1]) {
      const front = new THREE.MeshStandardMaterial({ map: rackFrontTex(), emissive: 0xffffff, emissiveMap: rackLedTex((pod * 2 + (dir > 0 ? 1 : 0)) % 3), emissiveIntensity: 2.4, roughness: .4, metalness: .5 });
      front.map.offset.y = front.emissiveMap.offset.y = (pod + dir) % 2 ? .5 : 0;
      const inst = new THREE.InstancedMesh(rackGeo, [side, side, side, side, front, back], PER);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dir > 0 ? Math.PI : 0);
      for (let i = 0; i < PER; i++) inst.setMatrixAt(i, m4.compose(new THREE.Vector3(x0 + i * step, 1.5 + 3.75, cz + dir * 2.9), q, new THREE.Vector3(1, 1, 1)));
      inst.castShadow = inst.receiveShadow = true; scene.add(inst);
      // overhead cable tray
      box(PER * step, .2, 1.1, std(0xb8913a, { metalness: .5, roughness: .45 }), 0, 10.3, cz + dir * 2.9, scene);
      for (const s of [-.5, .5]) box(PER * step, .4, .07, std(0x9c7a30, { metalness: .5 }), 0, 10.55, cz + dir * 2.9 + s, scene);
    }
    // containment: glass roof, end doors, floor light strips
    box(PER * step, .12, 5.6, glass, 0, 9.15, cz, scene).castShadow = false;
    for (const s of [-1, 1]) {
      box(.12, 7.5, 5.6, glass, s * (PER * step / 2 + .1), 5.25, cz, scene).castShadow = false;
      box(.2, .2, 5.8, glowBasic(TEAL, 2), s * (PER * step / 2 + .1), 9.1, cz, scene).castShadow = false;
      box(PER * step - 1, .05, .22, glowBasic(TEAL, 2.6), 0, 1.53, cz + s * .9, scene).castShadow = false;
    }
    const pl = new THREE.PointLight(TEAL, 260, 34, 2); pl.position.set(0, 6, cz); scene.add(pl);
  });

  // cooling units along the left wall, chilled-water pipes on the back wall
  for (let i = 0; i < 5; i++) {
    box(2.6, 7, 6, std(0xe7ebee, { roughness: .5 }), -38.6, 5, -20 + i * 10, scene);
    box(.1, 5, 5, std(0x2a3136), -37.25, 5, -20 + i * 10, scene);
    box(.1, .3, 1.2, glowBasic(TEAL, 3), -37.2, 8, -20 + i * 10, scene).castShadow = false;
  }
  for (const [c, y] of [[0xd14b4b, 11.6], [0x3b82f6, 12.6]]) { const p = cyl(.45, .45, 80, std(c, { metalness: .5, roughness: .35 }), 0, y, -28, scene, 14); p.rotation.z = Math.PI / 2; }

  // chiller yard + generators
  box(30, .8, 58, std(0xffffff, { map: concreteTex([3, 5]), roughness: .9 }), 60, .4, 0, scene);
  const fanM = new Merge(), unitM = new Merge();
  for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) {
    const x = 51 + j * 9, z = -24 + i * 5.3;
    unitM.box(7.4, 3, 4.6, [x, 2.3, z]);
    for (const dx of [-1.8, 1.8]) {
      fanM.add(new THREE.CylinderGeometry(1.5, 1.5, .2, 24), [x + dx, 3.9, z]);
      for (let b = 0; b < 5; b++) fanM.box(1.3, .08, .35, [x + dx + Math.cos(b * 1.2566) * .6, 3.98, z + Math.sin(b * 1.2566) * .6], [0, -b * 1.2566, .3]);
    }
  }
  scene.add(unitM.mesh(std(0xe3e7ea, { roughness: .5, metalness: .2 })));
  scene.add(fanM.mesh(std(0x1d2227, { metalness: .6, roughness: .4 })));
  for (const z of [36, 42]) box(14, 4, 4, std(0xf0f2f2, { roughness: .45 }), 58, 2, z, scene);

  const rim = new THREE.PointLight(PINK, 500, 90, 2); rim.position.set(-30, 18, 30); scene.add(rim);
  return { scene, update() {} };
}

/* ================= scene 3: wind farm at sunset ================= */
const SUNSET_SKY = `uniform vec3 sunDir; varying vec3 vP;
  void main(){ vec3 d = normalize(vP); float h = d.y;
    vec3 top = vec3(.02,.02,.08), mid = vec3(.2,.08,.24), hor = vec3(1.,.42,.2), below = vec3(.1,.05,.12);
    vec3 c = mix(hor, mid, smoothstep(0., .25, h)); c = mix(c, top, smoothstep(.2, .85, h));
    if (h < 0.) c = mix(hor, below, smoothstep(0., -.15, h));
    float s = max(dot(d, normalize(sunDir)), 0.);
    c += vec3(1., .5, .25) * pow(s, 6.) * .35 + vec3(1., .75, .45) * pow(s, 80.) * 1.;
    c += vec3(1., .95, .85) * smoothstep(.9990, .9995, s) * 4.;
    gl_FragColor = vec4(c, 1.); }`;
function sunsetSky(scene, sunDir, radius = 1600) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sunDir: { value: sunDir } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: SUNSET_SKY,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat));
}
function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-.55, 0); s.quadraticCurveTo(-1.35, 4, -.95, 10); s.lineTo(-.22, 28); s.lineTo(.14, 28.2); s.quadraticCurveTo(.75, 12, .95, 3); s.lineTo(.55, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: .28, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 1.1, -.14); return g;
}

function buildWindFarm(renderer) {
  const scene = new THREE.Scene();
  const sunDir = new THREE.Vector3(-.81, .07, -.58).normalize();
  sunsetSky(scene, sunDir);
  { // environment map from the same sky so water and metal reflect the sunset
    const es = new THREE.Scene(); sunsetSky(es, sunDir, 50);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0).texture; pm.dispose();
  }
  scene.fog = new THREE.Fog(0xd88a6c, 200, 1100);
  scene.add(new THREE.HemisphereLight(0xa88ac0, 0x3a3428, 1.35));
  const key = sun(scene, 0xffb07a, 2.6, sunDir.clone().multiplyScalar(420).toArray(), 320, 4096);
  key.target.position.set(0, 0, 0);

  // terrain with height + slope colouring, coast falling into the sea
  const SIZE = 1500, SEG = 240;
  const H = (x, z) => {
    const coast = THREE.MathUtils.smoothstep(z, -190, -70);
    const hills = 9 + 16 * Math.sin(x * .011 + 1) * Math.cos(z * .014) + 7 * Math.sin(x * .029 + z * .021) + 3 * Math.sin(x * .08) * Math.sin(z * .07);
    return Math.max(-6, hills * coast - (1 - coast) * 6);
  };
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, H(pos.getX(i), -pos.getY(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xc9a27a), grass = new THREE.Color(0x4f7a4a), grass2 = new THREE.Color(0x2f5238), rock = new THREE.Color(0x77705f), col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getZ(i), slope = nrm.getZ(i), n = .5 + .5 * Math.sin(pos.getX(i) * .05) * Math.cos(pos.getY(i) * .043);
    col.copy(grass).lerp(grass2, n);
    if (h < 2.5) col.lerp(sand, THREE.MathUtils.clamp((2.5 - h) / 3, 0, 1));
    if (slope < .88) col.lerp(rock, THREE.MathUtils.clamp((.88 - slope) * 5, 0, 1));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const land = shadowed(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })), false);
  land.rotation.x = -Math.PI / 2; scene.add(land);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x1c2a44, roughness: .12, metalness: .9 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = .2; sea.receiveShadow = true; scene.add(sea);

  // trees scattered on the hills
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 5.5, 7), std(0x24452f, { roughness: .9, flatShading: true }), 700);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let n = 0;
  for (let k = 0; k < 4000 && n < 700; k++) {
    const x = (Math.random() - .5) * 520, z = -60 + Math.random() * 300, h = H(x, z);
    if (h < 4 || Math.sin(x * .07) * Math.cos(z * .05) < -.1) continue;
    const s = .7 + Math.random() * .8;
    trees.setMatrixAt(n++, m4.compose(v.set(x, h + 2.4 * s, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), sc.set(s, s, s)));
  }
  trees.count = n; trees.castShadow = trees.receiveShadow = true; scene.add(trees);

  // soft cloud bands
  const puff = puffTex();
  [[-520, 150, -820, 520, 70, 0xff9a7a, .5], [-160, 210, -900, 680, 80, 0xd47a8a, .45], [240, 170, -860, 520, 60, 0xff8a6a, .4],
   [-700, 260, -700, 600, 90, 0x7a4a7a, .5], [420, 260, -760, 700, 90, 0x6a4a7a, .45], [-300, 120, -700, 380, 40, 0xffc09a, .55]]
    .forEach(([x, y, z, w, h, c, o]) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: c, transparent: true, opacity: o, depthWrite: false, fog: false })); s.position.set(x, y, z); s.scale.set(w, h, 1); scene.add(s); });

  // turbines
  const white = std(0xf1efec, { roughness: .35, metalness: .1 }), red = std(0xd23a3a, { roughness: .4 });
  const bladeGeo = bladeGeometry(), lamp = glowBasic(0xff3355, 5);
  const rotors = [];
  const turbine = (x, z, offshore) => {
    const base = offshore ? 0 : H(x, z);
    const g = new THREE.Group(); g.position.set(x, base, z); g.rotation.y = .62; scene.add(g);
    if (offshore) { cyl(2.2, 2.2, 8, std(0xf2c14e, { roughness: .5 }), 0, 2, 0, g, 20); cyl(3.4, 3.4, .6, std(0x8d969a, { metalness: .6 }), 0, 6.2, 0, g, 20); }
    cyl(.75, 1.75, 62, white, 0, 31, 0, g, 28);
    const nac = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 5.5, 6, 18), white)); nac.rotation.x = Math.PI / 2; nac.position.set(0, 62.5, -.6); g.add(nac);
    const l = new THREE.Mesh(new THREE.SphereGeometry(.35, 8, 6), lamp); l.position.set(0, 64.2, -2.4); g.add(l);
    const rotor = new THREE.Group(); rotor.position.set(0, 62.5, 3.6); g.add(rotor);
    const spinner = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 16), white)); spinner.scale.set(1, 1, 1.6); rotor.add(spinner);
    for (let b = 0; b < 3; b++) {
      const piv = new THREE.Group(); piv.rotation.z = b * Math.PI * 2 / 3; rotor.add(piv);
      const blade = shadowed(new THREE.Mesh(bladeGeo, white)); blade.rotation.y = .22; piv.add(blade);
      box(.55, 1.3, .32, red, -.05, 26.4, 0, piv).rotation.y = .22;
    }
    rotor.rotation.z = Math.random() * 6; rotors.push(rotor);
  };
  [[118, 90], [-18, 52], [-96, 18], [-168, -10], [22, -8], [-58, -46], [118, 30], [-140, 80], [170, -36]].forEach(([x, z]) => turbine(x, z, false));
  [[-240, -300], [-140, -330], [-40, -350], [60, -340], [160, -320], [-340, -270], [-90, -470], [40, -490], [-220, -460]].forEach(([x, z]) => turbine(x, z, true));

  return { scene, update(t) { rotors.forEach((r, i) => r.rotation.z = i * 1.3 + t * .9); } };
}

/* ---------------- camera + renderer ---------------- */
function toOrbit(eye, target) {
  const d = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], dist = Math.hypot(...d);
  return { yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(d[1] / dist), distance: dist, target: [...target] };
}
function placeCamera(cam, o) {
  const cp = Math.cos(o.pitch);
  cam.position.set(o.target[0] + Math.sin(o.yaw) * cp * o.distance, o.target[1] + Math.sin(o.pitch) * o.distance, o.target[2] + Math.cos(o.yaw) * cp * o.distance);
  cam.lookAt(...o.target);
}
function makeRenderer(canvas, opts = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', ...opts });
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.3;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  ANISO = r.capabilities.getMaxAnisotropy();
  return r;
}
// gentle film look for the showcase stills: saturation, lifted blacks, vignette
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vig: { value: .42 }, sat: { value: 1.1 }, lift: { value: new THREE.Color(0x0b0716) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float sat; uniform vec3 lift; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(.2126, .7152, .0722));
      c.rgb = mix(vec3(l), c.rgb, sat); c.rgb += lift * (1. - c.rgb);
      vec2 d = vUv - .5; c.rgb *= 1. - vig * dot(d, d) * 2.2; gl_FragColor = c; }`,
};
function makeComposer(renderer, scene, cam, w, h, bloom = [.55, .5, .88], grade = false) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const rp = new RenderPass(scene, cam);
  const bp = new UnrealBloomPass(new THREE.Vector2(w, h), ...bloom);
  composer.addPass(rp); composer.addPass(bp); composer.addPass(new OutputPass());
  if (grade) composer.addPass(new ShaderPass(GradeShader));
  return { composer, rp, bp };
}

/* ---------------- hero ---------------- */
const PRESETS = {
  wide:    { eye: [170, 64, 150], target: [-34, 40, 28], fov: 34, label: 'live · wide pad framing' },
  fairing: { eye: [34, 92, 46],   target: [-8, 80, 4],   fov: 40, label: 'live · fairing close-up' },
  low:     { eye: [58, 7, 66],    target: [-12, 50, 12], fov: 48, label: 'live · ramp-level sweep' },
  tower:   { eye: [-46, 40, 118], target: [-22, 50, 0], fov: 38, label: 'live · tower orbit' },
  top:     { eye: [110, 230, 110], target: [-34, 0, 14], fov: 36, label: 'live · overhead plan' },
};
const CYCLE_MS = 7500;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

function initHero() {
  const canvas = document.getElementById('hero-viewport');
  if (!canvas) return;
  const frame = canvas.parentElement;
  let renderer;
  try { renderer = makeRenderer(canvas); } catch (e) { canvas.remove(); return; }
  const mobile = matchMedia('(max-width: 760px)').matches;
  // native resolution (4x MSAA keeps edges clean), capped so huge screens don't push too many pixels
  const dpr = window.devicePixelRatio || 1;
  const MAX_PX = mobile ? 1.1e6 : 2.2e6;
  let prCap = Math.min(dpr, 1.5), pr = prCap;
  renderer.setPixelRatio(pr);
  const world = buildLaunchSite(renderer);
  // nothing that casts a shadow moves, so draw the shadow map once
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  const cam = new THREE.PerspectiveCamera(34, 1, .5, 4000);
  const { composer, bp } = makeComposer(renderer, world.scene, cam, 2, 2);
  const modeEl = document.getElementById('hero-mode');
  const keys = Object.keys(PRESETS);
  let key = 'wide';
  const goal = { ...toOrbit(PRESETS.wide.eye, PRESETS.wide.target), fov: PRESETS.wide.fov };
  const cur = { ...goal, target: [...goal.target] };
  let dragging = false, touched = false, start = [0, 0], startAngles = [0, 0], visible = true, last = performance.now(), clock = 0;

  // presets are framed for wide screens (rocket on the right, copy on the left);
  // on tall/narrow screens centre the rocket above the copy and pull the camera back
  function framed(p) {
    if (frame.clientWidth / Math.max(1, frame.clientHeight) >= 1) return p;
    const t = [0, p.target[1] + 10, 0];
    const eye = p.eye.map((v, i) => t[i] + (v - p.target[i]) * 1.45);
    return { ...p, eye, target: t };
  }
  function setPreset(k) {
    key = k; const p = framed(PRESETS[k]);
    Object.assign(goal, toOrbit(p.eye, p.target), { fov: p.fov });
    if (modeEl) modeEl.textContent = p.label;
  }
  // jump straight to a preset (handy for checking framing from the console)
  window.__orbytHero = {
    presets: keys,
    show(k) { touched = true; setPreset(k); Object.assign(cur, goal, { target: [...goal.target] }); },
    // average milliseconds per frame over n synchronous renders (works even when the tab is in the background)
    bench(n = 20, forcePr) {
      if (forcePr) { prCap = pr = forcePr; resize(); }
      const gl = renderer.getContext(); composer.render(); gl.finish();
      const t = performance.now(); for (let i = 0; i < n; i++) composer.render(); gl.finish();
      const ms = +((performance.now() - t) / n).toFixed(2);
      renderer.info.autoReset = false; renderer.info.reset(); composer.render();
      const { calls, triangles } = renderer.info.render; renderer.info.autoReset = true;
      return { ms, calls, tris: triangles, px: [canvas.width, canvas.height], pr };
    },
  };
  setInterval(() => { if (!touched && !document.hidden && visible) setPreset(keys[(keys.indexOf(key) + 1) % keys.length]); }, CYCLE_MS);

  canvas.addEventListener('pointerdown', e => { dragging = true; touched = true; start = [e.clientX, e.clientY]; startAngles = [goal.yaw, goal.pitch]; canvas.setPointerCapture?.(e.pointerId); if (modeEl) modeEl.textContent = 'live · manual orbit'; });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    goal.yaw = startAngles[0] - (e.clientX - start[0]) * .0055;
    goal.pitch = Math.max(.03, Math.min(1.35, startAngles[1] + (e.clientY - start[1]) * .0045));
  });
  const end = () => { dragging = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

  function resize() {
    const w = frame.clientWidth, h = frame.clientHeight;
    pr = Math.min(prCap, Math.sqrt(MAX_PX / Math.max(1, w * h)));
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    bp.resolution.set(w * pr, h * pr);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(frame); resize();
  // start on the first preset, framed for this screen shape
  setPreset('wide'); Object.assign(cur, goal, { target: [...goal.target] });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(frame);

  // if frames run slower than ~45fps, step resolution down (then turn bloom off as a last resort)
  let frames = 0, acc = 0;
  function adapt(raw) {
    if (raw > .1) return; // throttled/background frame, not a real measurement
    acc += raw; frames++;
    if (frames < 45) return;
    const avg = acc / frames; frames = 0; acc = 0;
    if (avg < .022) return;
    if (pr > .7) { prCap = pr = Math.max(.7, pr - .15); resize(); }
    else if (bp.enabled) bp.enabled = false;
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible || document.hidden) { last = now; return; }
    const raw = (now - last) / 1000, dt = Math.min(.05, Math.max(.001, raw)); last = now; clock += dt;
    adapt(raw);
    const k = 1 - Math.exp(-dt * 2.6 * (reduce.matches ? 4 : 1));
    if (!dragging && !reduce.matches) goal.yaw += dt * .035;
    cur.yaw += (goal.yaw - cur.yaw) * k; cur.pitch += (goal.pitch - cur.pitch) * k; cur.distance += (goal.distance - cur.distance) * k;
    for (let i = 0; i < 3; i++) cur.target[i] += (goal.target[i] - cur.target[i]) * k;
    cur.fov += (goal.fov - cur.fov) * k;
    cam.fov = cur.fov; cam.updateProjectionMatrix();
    placeCamera(cam, cur);
    world.update(reduce.matches ? 3 : clock);
    composer.render();
  }
  requestAnimationFrame(tick);
  const fb = frame.querySelector('.hero-fallback'); if (fb) fb.style.opacity = 0;
}

/* ---------------- showcase stills ---------------- */
// one shot per idle slot, so the hero animation never stalls behind a long render
const nextIdle = () => new Promise(res => (window.requestIdleCallback ? requestIdleCallback(res, { timeout: 600 }) : setTimeout(res, 50)));
async function renderStills() {
  const c = document.createElement('canvas');
  let r;
  try { r = makeRenderer(c, { preserveDrawingBuffer: true }); } catch (e) { return; }
  r.setPixelRatio(1);
  const shots = {
    launch:  { build: buildLaunchSite, eye: [52, 30, 126], target: [-8, 46, 0], fov: 40, w: 1240, h: 1400, t: 3, bloom: [.4, .45, .92] },
    servers: { build: buildServerHall, eye: [40, 66, 80], target: [2, 0, -4], fov: 34, w: 1920, h: 1080, bloom: [.5, .4, .85] },
    wind:    { build: buildWindFarm,   eye: [150, 26, 196], target: [-40, 42, -60], fov: 38, w: 1920, h: 1080, t: 1, bloom: [.32, .45, .96] },
    code:    { build: buildServerHall, eye: [-64, 56, 78], target: [6, 0, 0], fov: 36, w: 1600, h: 1200, bloom: [.5, .4, .85] },
  };
  for (const [name, s] of Object.entries(shots)) {
    await nextIdle();
    const world = s.build(r);
    world.update(s.t || 0);
    r.setSize(s.w, s.h, false);
    const cam = new THREE.PerspectiveCamera(s.fov, s.w / s.h, .5, 4000);
    cam.position.set(...s.eye); cam.lookAt(...s.target);
    const { composer } = makeComposer(r, world.scene, cam, s.w, s.h, s.bloom, true);
    composer.render();
    const url = c.toDataURL('image/webp', .9);
    const targets = name === 'code' ? [document.getElementById('code-result')] : document.querySelectorAll(`[data-shot="${name}"]`);
    targets.forEach(img => { if (!img) return; img.src = url; img.closest('.work-media')?.classList.add('is-ready'); });
    composer.dispose?.();
    world.scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
  r.dispose(); r.forceContextLoss();
}

export { THREE, buildLaunchSite, buildServerHall, buildWindFarm, makeRenderer, makeComposer, toOrbit, placeCamera, initHero, renderStills };
