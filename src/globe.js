import * as THREE from "three";
import { greatCircle } from "./geo.js";
import { createTileLayer } from "./tiles.js";

const TILT = THREE.MathUtils.degToRad(23.4);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
// wysokość kamery nad powierzchnią w promieniach Ziemi: 0,0016 ≈ 10 km, 3,8 ≈ 24 000 km
const MIN_ALT = 0.0016;
const MAX_ALT = 3.8;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Pozycja na kuli w układzie lokalnym globusu (przed nachyleniem osi). */
export function latLngLocal(lat, lng, radius) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  const s = Math.sin(phi);
  return new THREE.Vector3(-radius * s * Math.cos(theta), radius * Math.cos(phi), radius * s * Math.sin(theta));
}

function latLngWorld(lat, lng, radius) {
  return latLngLocal(lat, lng, radius).applyAxisAngle(Z_AXIS, TILT);
}

function worldToLatLng(v) {
  const p = v.clone().applyAxisAngle(Z_AXIS, -TILT).normalize();
  const lat = 90 - (Math.acos(THREE.MathUtils.clamp(p.y, -1, 1)) * 180) / Math.PI;
  let lng = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
  if (lng < -180) lng += 360;
  return { lat, lng };
}

function dampAngle(current, target, lambda, dt) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-lambda * dt));
}

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D waterMap;
  uniform sampler2D photoMap;
  uniform float photoMix;
  uniform vec3 sunDir;
  uniform float nightGain;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float ndl = dot(n, sunDir);
    float dayMix = smoothstep(-0.1, 0.16, ndl);
    vec3 day = texture2D(dayMap, vUv).rgb;
    // „Ziemia z wczoraj”: dzienne zdjęcie NASA; czarne pola (noc polarna, brak danych) zostają z tekstury bazowej
    vec3 photo = texture2D(photoMap, vUv).rgb;
    float photoLum = dot(photo, vec3(0.299, 0.587, 0.114));
    day = mix(day, photo, photoMix * smoothstep(0.004, 0.03, photoLum));
    vec3 lit = day * (0.035 + 1.18 * max(ndl, 0.0));
    vec3 night = texture2D(nightMap, vUv).rgb * nightGain;
    vec3 col = mix(night + day * 0.025, lit, dayMix);
    // pomarańczowa poświata na linii terminatora
    // (kolor jest jeszcze liniowy — po zamianie na sRGB nawet mała wartość mocno świeci)
    float dusk = 1.0 - smoothstep(0.0, 0.07, abs(ndl - 0.02));
    col += vec3(1.0, 0.4, 0.12) * dusk * 0.012 * (1.0 - dayMix * 0.5);
    // odblask słońca tylko na wodzie
    float water = texture2D(waterMap, vUv).r;
    vec3 h = normalize(sunDir + v);
    float spec = pow(max(dot(n, h), 0.0), 60.0) * water * dayMix * (1.0 - photoMix * smoothstep(0.08, 0.3, photoLum));
    col += vec3(1.0, 0.93, 0.8) * spec * 0.55;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float opacity;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(vN);
    float ndl = dot(n, sunDir);
    float a = texture2D(cloudMap, vUv).r;
    float light = 0.04 + 0.96 * smoothstep(-0.12, 0.35, ndl);
    vec3 col = mix(vec3(1.0, 0.7, 0.5), vec3(1.0), smoothstep(-0.02, 0.25, ndl)) * light;
    gl_FragColor = vec4(col, a * opacity * (0.12 + 0.88 * light));
    #include <colorspace_fragment>
  }
`;

const ATMO_FRAG = /* glsl */ `
  uniform vec3 sunDir;
  uniform float power;
  uniform float strength;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float rim = pow(1.0 - abs(dot(n, v)), power);
    float d = dot(n, sunDir);
    float sunSide = 0.08 + 0.92 * smoothstep(-0.3, 0.4, d);
    // na nocnej stronie przygaszony granat, pomarańcz tylko wąsko przy terminatorze
    vec3 col = mix(vec3(0.95, 0.52, 0.3), vec3(0.42, 0.64, 1.0), smoothstep(-0.05, 0.3, d));
    col = mix(vec3(0.18, 0.26, 0.5), col, smoothstep(-0.35, -0.1, d));
    gl_FragColor = vec4(col, rim * strength * sunSide);
  }
`;

export function createGlobe(container, { texturesBase = "textures/", onPlace, onGround, onTiles, onPick }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070c);
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
  const sunWorld = new THREE.Vector3(1, 0.3, 0.6).normalize();

  // gwiazdy
  {
    const count = 1800;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 30 + Math.random() * 40;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)], i * 3);
      const warm = Math.random();
      const b = 0.55 + Math.random() * 0.45;
      col.set([b, b * (0.9 + warm * 0.08), b * (1.05 - warm * 0.2)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })));
  }

  const pivot = new THREE.Group();
  pivot.rotation.z = TILT;
  scene.add(pivot);

  const loader = new THREE.TextureLoader();
  const blankTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blankTex.needsUpdate = true;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const maxTex = renderer.capabilities.maxTextureSize;
  let pending = 4;
  let onReady = null;
  const tex = (name, srgb) => {
    const t = loader.load(texturesBase + name, () => {
      pending -= 1;
      if (pending === 0 && onReady) onReady();
    });
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, maxAniso);
    return t;
  };

  // 4K tylko na dużych ekranach z myszą; telefony dostają 2K (mniej pamięci, brak zawieszeń WebView)
  const big = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1) > 2200 && !matchMedia("(pointer: coarse)").matches && maxTex >= 4096;
  const suffix = big ? "" : "-2k";
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: tex(`earth-day${suffix}.webp`, true) },
      nightMap: { value: tex(`earth-night${suffix}.webp`, true) },
      waterMap: { value: tex("earth-water.webp", false) },
      sunDir: { value: sunWorld },
      nightGain: { value: 1.35 },
      photoMap: { value: blankTex },
      photoMix: { value: 0 },
    },
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), earthMat);
  pivot.add(earth);

  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { cloudMap: { value: tex("earth-clouds.webp", false) }, sunDir: { value: sunWorld }, opacity: { value: 0.62 } },
    vertexShader: EARTH_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 72), cloudMat);
  clouds.renderOrder = 300; // chmury nad kafelkami szczegółów
  pivot.add(clouds);

  const tiles = createTileLayer({ parent: pivot, sunDir: sunWorld, latLngLocal, onActive: onTiles });

  const atmo = (scale, side, power, strength) =>
    new THREE.Mesh(
      new THREE.SphereGeometry(scale, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: sunWorld }, power: { value: power }, strength: { value: strength } },
        vertexShader: EARTH_VERT,
        fragmentShader: ATMO_FRAG,
        transparent: true,
        depthWrite: false,
        side,
        blending: THREE.AdditiveBlending,
      }),
    );
  scene.add(atmo(1.075, THREE.BackSide, 2.4, 0.95), atmo(1.012, THREE.FrontSide, 3.2, 0.35));

  // znaczniki
  const pickables = [];
  const frameHooks = [];
  const markerRoot = new THREE.Group();
  markerRoot.rotation.z = TILT;
  scene.add(markerRoot);
  const markers = new Map();
  const geoCore = new THREE.SphereGeometry(0.011, 16, 12);
  const geoRing = new THREE.RingGeometry(0.02, 0.027, 40);
  const geoHit = new THREE.SphereGeometry(0.045, 8, 6);
  const geoBeam = new THREE.CylinderGeometry(0.0022, 0.0006, 0.16, 8);

  function makeMarker(place, color = 0xffd48a) {
    const pos = latLngLocal(place.lat, place.lng, 1.0003);
    const group = new THREE.Group();
    group.position.copy(pos);
    group.quaternion.setFromUnitVectors(Z_AXIS, pos.clone().normalize());
    const core = new THREE.Mesh(geoCore, new THREE.MeshBasicMaterial({ color }));
    const ring = new THREE.Mesh(geoRing, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.z = 0.002;
    const hit = new THREE.Mesh(geoHit, new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.placeId = place.id;
    const beam = new THREE.Mesh(geoBeam, new THREE.MeshBasicMaterial({ color: 0xffe7b8, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.rotation.x = Math.PI / 2;
    beam.position.z = 0.08;
    beam.visible = false;
    group.add(core, ring, hit, beam);
    return { group, core, ring, beam, place, color };
  }

  // pinezki pomocnicze: dotknięty punkt, mój punkt, odpowiedź w quizie
  const pins = new Map();
  function setPin(name, point, color = 0x8fd3ff) {
    const old = pins.get(name);
    if (old) {
      markerRoot.remove(old.group);
      pins.delete(name);
    }
    if (!point) return;
    const m = makeMarker({ id: null, ...point }, color);
    m.beam.visible = true;
    m.beam.material = m.beam.material.clone();
    m.beam.material.color.set(color);
    m.ring.material.opacity = 0.9;
    markerRoot.add(m.group);
    pins.set(name, m);
  }

  let arc = null;
  function setArc(a, b) {
    if (arc) {
      markerRoot.remove(arc);
      arc.geometry.dispose();
      arc = null;
    }
    if (!a || !b) return;
    const pts = greatCircle(a, b, 96);
    const span = Math.acos(THREE.MathUtils.clamp(latLngLocal(a.lat, a.lng, 1).dot(latLngLocal(b.lat, b.lng, 1)), -1, 1));
    const lift = 0.02 + span * 0.09;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => latLngLocal(p.lat, p.lng, 1.0006 + Math.sin(p.t * Math.PI) * lift)));
    arc = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 160, 0.0028, 6, false),
      new THREE.MeshBasicMaterial({ color: 0xf3c47a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    arc.renderOrder = 2;
    markerRoot.add(arc);
  }

  let selectedId = null;
  function setPlaces(list) {
    for (const m of markers.values()) markerRoot.remove(m.group);
    markers.clear();
    for (const p of list) {
      const m = makeMarker(p, p.cat === "own" ? 0x9fe0c0 : 0xffd48a);
      markerRoot.add(m.group);
      markers.set(p.id, m);
    }
    paintMarkers();
  }

  function paintMarkers() {
    for (const m of markers.values()) {
      const on = m.place.id === selectedId;
      m.core.material.color.set(on ? 0xfff7e6 : m.color);
      m.ring.material.opacity = on ? 0.95 : 0.45;
      m.beam.visible = on;
    }
  }

  // kamera
  const start = new THREE.Spherical().setFromVector3(latLngWorld(30, 15, 3.4));
  const rig = { theta: start.theta, phi: start.phi, radius: 3.4, velT: 0, velP: 0, resumeAt: 0, focus: null, spin: !reduceMotion };
  const spherical = new THREE.Spherical();

  function focus(lat, lng, radius) {
    const s = new THREE.Spherical().setFromVector3(latLngWorld(lat, lng, 1));
    rig.focus = { theta: s.theta, phi: s.phi, radius: radius ?? THREE.MathUtils.clamp(rig.radius, 1.75, 2.3) };
  }

  function release() {
    rig.focus = null;
    rig.resumeAt = performance.now() + 600;
  }

  function select(id, { fly = true } = {}) {
    selectedId = id;
    paintMarkers();
    const m = markers.get(id);
    if (m && fly) focus(m.place.lat, m.place.lng, rig.radius > 2.3 ? 2.05 : undefined);
  }

  // wejście: przeciąganie, szczypanie, kółko, dotknięcie
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), alt: rig.radius - 1 };
      drag = null;
    } else {
      drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
      rig.velT = rig.velP = 0;
    }
    canvas.classList.add("grabbing");
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setAlt(pinch.alt * (pinch.dist / Math.max(d, 1)));
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved < 5) return;
    rig.focus = null;
    // punkt pod palcem ma iść razem z palcem: przy samej ziemi kąt na piksel = wysokość × pole widzenia / wysokość ekranu
    const alt = rig.radius - 1;
    const follow = (2 * alt * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, container.clientHeight);
    const k = Math.min(0.0052 * ((rig.radius - 0.85) / 2), follow * THREE.MathUtils.lerp(1, 3, THREE.MathUtils.smoothstep(alt, 0.05, 1)));
    rig.velT = -dx * k;
    rig.velP = -dy * k;
    rig.theta += rig.velT;
    rig.phi = THREE.MathUtils.clamp(rig.phi + rig.velP, 0.12, Math.PI - 0.12);
  });

  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) canvas.classList.remove("grabbing");
    if (!drag) return;
    const wasTap = drag.moved < 8 && performance.now() - drag.t < 600;
    drag = null;
    rig.resumeAt = performance.now() + 2500;
    if (wasTap && e.type === "pointerup") tap(e);
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      setAlt((rig.radius - 1) * Math.exp(e.deltaY * 0.0016));
      rig.resumeAt = performance.now() + 1500;
    },
    { passive: false },
  );

  function tap(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    // obiekty warstw (ISS, trzęsienia ziemi) mają pierwszeństwo przed miejscami
    const layerHit = raycaster.intersectObjects(pickables.filter((o) => o.visible), true).find((h) => h.object.userData.pick);
    if (layerHit) {
      onPick?.(layerHit.object.userData.pick, layerHit.instanceId);
      return;
    }
    const shown = [...markers.values()].filter((m) => m.group.visible).map((m) => m.group);
    const hit = raycaster.intersectObjects(shown, true).find((h) => h.object.userData.placeId);
    if (hit) {
      onPlace?.(hit.object.userData.placeId);
      return;
    }
    const point = groundPoint(raycaster.ray);
    if (!point) return;
    const now = performance.now();
    if (lastTap && now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null;
      const ll = worldToLatLng(point);
      focus(ll.lat, ll.lng, 1 + Math.max(MIN_ALT, (rig.radius - 1) / 3.5));
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    onGround?.(worldToLatLng(point));
  }

  let lastTap = null;
  const hitPoint = new THREE.Vector3();
  const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  function groundPoint(ray) {
    return ray.intersectSphere(unitSphere, hitPoint) ? hitPoint.clone() : null;
  }

  function setAlt(alt) {
    rig.radius = 1 + THREE.MathUtils.clamp(alt, MIN_ALT, MAX_ALT);
    if (rig.focus) rig.focus.radius = rig.radius;
  }

  // słońce
  let sunMode = { real: true, date: new Date() };
  function setSun(real, date) {
    sunMode = { real, date };
    updateSun();
  }
  const camDir = new THREE.Vector3();
  function updateSun() {
    if (sunMode.real) {
      // punkt podsłoneczny liczy main.js; tutaj tylko kierunek
      sunWorld.copy(latLngWorld(sunMode.lat ?? 0, sunMode.lng ?? 0, 1));
    } else {
      // „zawsze dzień”: światło zza lewego ramienia obserwatora
      camDir.copy(camera.position).normalize();
      const side = new THREE.Vector3().crossVectors(camera.up, camDir).normalize();
      sunWorld.copy(camDir).addScaledVector(side, -0.55).addScaledVector(camera.up, 0.35).normalize();
    }
  }
  function setSubsolar(lat, lng) {
    sunMode.lat = lat;
    sunMode.lng = lng;
    updateSun();
  }

  // przesunięcie widoku, żeby globus nie chował się pod panelem
  let view = { x: 0, y: 0 };
  function setViewShift(x, y) {
    view = { x, y };
    resize();
  }
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // na pionowym ekranie trzymamy stałe pole widzenia w poziomie, żeby globus mieścił się w szerokości
    camera.fov = camera.aspect < 1 ? (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) / camera.aspect) * 180) / Math.PI : 38;
    camera.setViewOffset(w, h, -view.x, view.y, w, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const clock = new THREE.Clock();
  let cloudsOn = true;
  let photoOn = false;
  let tileTimer = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (cloudsOn && !reduceMotion) clouds.rotation.y += dt * 0.004;
    const lambda = reduceMotion ? 14 : 2.8;

    if (!drag && rig.focus) {
      rig.theta = dampAngle(rig.theta, rig.focus.theta, lambda, dt);
      rig.phi = THREE.MathUtils.clamp(dampAngle(rig.phi, rig.focus.phi, lambda, dt), 0.12, Math.PI - 0.12);
      // wysokość wygaszana w skali logarytmicznej — lot z orbity do miasta trwa tyle samo co krótkie zbliżenie
      const logAlt = THREE.MathUtils.damp(Math.log(rig.radius - 1), Math.log(rig.focus.radius - 1), lambda * 0.9, dt);
      rig.radius = 1 + Math.exp(logAlt);
      rig.velT = rig.velP = 0;
    } else if (!drag) {
      rig.theta += rig.velT;
      rig.phi = THREE.MathUtils.clamp(rig.phi + rig.velP, 0.12, Math.PI - 0.12);
      const decay = Math.exp(-dt * 3.1);
      rig.velT *= decay;
      rig.velP *= decay;
      if (rig.spin && !pinch && rig.radius > 1.5 && performance.now() > rig.resumeAt && Math.abs(rig.velT) < 0.0003) {
        rig.theta += dt * 0.05 * ((rig.radius - 0.9) / 2);
      }
    }

    // znaczniki nie puchną przy zbliżeniu
    const markerScale = THREE.MathUtils.clamp((rig.radius - 1) / 2.7, 0.0007, 1.2);
    for (const m of markers.values()) {
      const on = m.place.id === selectedId;
      const pulse = 1 + Math.sin(t * 2.3 + m.place.lat) * (on ? 0.14 : 0.05);
      m.group.scale.setScalar(markerScale);
      m.core.scale.setScalar((on ? 1.6 : 1) * pulse);
    }
    for (const m of pins.values()) m.group.scale.setScalar(markerScale);

    spherical.set(rig.radius, rig.phi, rig.theta);
    camera.position.setFromSpherical(spherical);
    camera.lookAt(0, 0, 0);

    // przy samej ziemi bliska płaszczyzna cięcia musi zejść niżej, inaczej obetnie powierzchnię
    const alt = rig.radius - 1;
    const near = THREE.MathUtils.clamp(alt * 0.25, 0.0002, 0.05);
    if (Math.abs(camera.near - near) > near * 0.05) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    cloudMat.uniforms.opacity.value = 0.62 * THREE.MathUtils.smoothstep(alt, 0.08, 0.5);
    tileTimer -= dt;
    if (tileTimer <= 0) {
      tileTimer = 0.15;
      const c = worldToLatLng(camera.position);
      tiles.update({ lat: c.lat, lng: c.lng, alt, fovV: camera.fov, aspect: camera.aspect, heightPx: container.clientHeight });
    }
    tiles.animate(dt);
    for (const fn of frameHooks) fn({ dt, alt, markerScale, camera });
    if (!sunMode.real) updateSun();
    renderer.render(scene, camera);
  });

  return {
    setPlaces,
    select,
    focus,
    release,
    setPin,
    setArc,
    setSun,
    setSubsolar,
    setViewShift,
    setClouds(on) {
      cloudsOn = on;
      clouds.visible = on && !photoOn;
    },
    setSpin(on) {
      rig.spin = on && !reduceMotion;
    },
    setMarkersVisible(on) {
      for (const m of markers.values()) m.group.visible = on;
    },
    get radius() {
      return rig.radius;
    },
    /** tylko do testów */
    get debug() {
      return { radius: rig.radius, theta: rig.theta, phi: rig.phi, velT: rig.velT, velP: rig.velP, focus: rig.focus, drag: !!drag, pinch: !!pinch };
    },
    /** factor < 1 przybliża, > 1 oddala */
    zoomBy(factor) {
      const target = THREE.MathUtils.clamp((rig.radius - 1) * factor, MIN_ALT, MAX_ALT);
      const s = new THREE.Spherical().setFromVector3(camera.position);
      rig.focus = { theta: rig.focus?.theta ?? s.theta, phi: rig.focus?.phi ?? s.phi, radius: 1 + target };
    },
    zoomTo(lat, lng, alt) {
      focus(lat, lng, 1 + THREE.MathUtils.clamp(alt, MIN_ALT, MAX_ALT));
    },
    setTiles(on) {
      tiles.setEnabled(on);
    },
    /** Grupa w układzie globusu (z nachyleniem osi) — tu warstwy dokładają swoje obiekty. */
    layerRoot: markerRoot,
    addPickable(obj) {
      pickables.push(obj);
    },
    onFrame(fn) {
      frameHooks.push(fn);
    },
    setPhoto(texture) {
      earthMat.uniforms.photoMap.value = texture || blankTex;
      earthMat.uniforms.photoMix.value = texture ? 1 : 0;
      // zdjęcie ma prawdziwe chmury z tego dnia — mozaika chmur by je dublowała
      clouds.visible = cloudsOn && !texture;
      photoOn = !!texture;
    },
    get maxTextureSize() {
      return maxTex;
    },
    setLabels(on) {
      tiles.setLabels(on);
    },
    setLabelMinZoom(z) {
      tiles.setLabelMinZoom(z);
    },
    whenReady(fn) {
      if (pending === 0) fn();
      else onReady = fn;
    },
  };
}
