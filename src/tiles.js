import * as THREE from "three";

// Szczegółowe zdjęcia przy zbliżeniu: kafelki Web Mercator rozpięte na kuli.
// Zdjęcia: Sentinel-2 cloudless 2017 (EOX, CC BY 4.0), nazwy: OpenStreetMap w opracowaniu EOX.
const EOX = "https://tiles.maps.eox.at/wmts/1.0.0/";
const IMAGERY = (z, x, y) => `${EOX}s2cloudless-2017_3857/default/g/${z}/${y}/${x}.jpg`;
const LABELS = (z, x, y) => `${EOX}overlay_bright_3857/default/g/${z}/${y}/${x}.png`;

const MAX_ZOOM = 14; // ok. 10 m na piksel; wyżej EOX tylko powiększa
const MAX_TILES = 64; // na jeden poziom w kadrze
const CACHE = 240;
const PARALLEL = 8;
const R_IMAGE = 1.0001;
const R_LABEL = 1.00015;
const MAX_LAT = 85.0511;

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

// to samo światło co na globusie; nocą kafelki znikają i widać światła miast z tekstury bazowej
const IMAGE_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 sunDir;
  uniform float opacity;
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    float ndl = dot(normalize(vN), sunDir);
    float dayMix = smoothstep(-0.1, 0.16, ndl);
    // zdjęcie satelitarne ma już własne cienie — oświetlamy łagodniej niż teksturę globusu, żeby było czytelne
    vec3 c = texture2D(map, vUv).rgb * (0.22 + 0.9 * smoothstep(-0.05, 0.45, ndl));
    gl_FragColor = vec4(c, opacity * dayMix);
    #include <colorspace_fragment>
  }
`;

const LABEL_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(t.rgb, t.a * opacity);
    #include <colorspace_fragment>
  }
`;

function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function lngToX(lng, z) {
  return ((lng + 180) / 360) * 2 ** z;
}

function latToY(lat, z) {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** Siatka kafelka na kuli; gęstość tak dobrana, żeby cięciwy nie wpadały pod powierzchnię globusu. */
function tileGeometry(z, x, y, radius, latLngLocal) {
  const n = Math.max(4, Math.min(64, Math.ceil(360 / 2 ** z / 0.5)));
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= n; j++) {
    const lat = tileLat(y + j / n, z);
    for (let i = 0; i <= n; i++) {
      const lng = ((x + i / n) / 2 ** z) * 360 - 180;
      const p = latLngLocal(lat, lng, radius);
      pos.push(p.x, p.y, p.z);
      p.normalize();
      nor.push(p.x, p.y, p.z);
      uv.push(i / n, 1 - j / n);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function createTileLayer({ parent, sunDir, latLngLocal, onActive }) {
  const group = new THREE.Group();
  parent.add(group);
  const loader = new THREE.TextureLoader();
  const cache = new Map(); // klucz → { mesh, used, state }
  const queue = [];
  let inFlight = 0;
  let labelsOn = true;
  let enabled = true;
  let active = false;
  let frame = 0;

  function get(kind, z, x, y) {
    const key = `${kind}/${z}/${x}/${y}`;
    let t = cache.get(key);
    if (!t) {
      const label = kind === "l";
      const mat = new THREE.ShaderMaterial({
        uniforms: label ? { map: { value: null }, opacity: { value: 0 } } : { map: { value: null }, sunDir: { value: sunDir }, opacity: { value: 0 } },
        vertexShader: VERT,
        fragmentShader: label ? LABEL_FRAG : IMAGE_FRAG,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(tileGeometry(z, x, y, label ? R_LABEL : R_IMAGE, latLngLocal), mat);
      mesh.renderOrder = (label ? 200 : 100) + z;
      mesh.visible = false;
      mesh.frustumCulled = false;
      group.add(mesh);
      t = { key, mesh, z, x, y, label, used: 0, state: "new", fade: 0 };
      cache.set(key, t);
    }
    return t;
  }

  function load(t) {
    t.state = "loading";
    inFlight += 1;
    const url = (t.label ? LABELS : IMAGERY)(t.z, t.x, t.y);
    loader.load(
      url,
      (tex) => {
        inFlight -= 1;
        if (t.state === "gone") return tex.dispose();
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        t.mesh.material.uniforms.map.value = tex;
        t.state = "ready";
        pump();
      },
      undefined,
      () => {
        inFlight -= 1;
        t.state = "error";
        pump();
      },
    );
  }

  function pump() {
    while (inFlight < PARALLEL && queue.length) {
      const t = queue.shift();
      if (t.state === "new") load(t);
    }
  }

  function evict() {
    if (cache.size <= CACHE) return;
    const old = [...cache.values()].filter((t) => t.used < frame).sort((a, b) => a.used - b.used);
    for (const t of old.slice(0, cache.size - CACHE)) {
      t.state = "gone";
      group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.uniforms.map.value?.dispose();
      t.mesh.material.dispose();
      cache.delete(t.key);
    }
  }

  function setActive(on) {
    if (on === active) return;
    active = on;
    onActive?.(on);
  }

  /** Wybór kafelków dla bieżącego kadru. view: { lat, lng, alt, fovV, aspect, heightPx } */
  function update(view) {
    frame += 1;
    const wanted = new Set();
    // pod 0,9 promienia Ziemi wysokości tekstura bazowa (10–20 km na piksel) przestaje wystarczać
    if (enabled && view.alt < 0.9) {
      const cosLat = Math.max(0.05, Math.cos((view.lat * Math.PI) / 180));
      const tanV = Math.tan((view.fovV * Math.PI) / 360);
      const viewKm = 2 * view.alt * tanV * 6371;
      // fizyczne piksele ekranu (na telefonie 2–3× więcej niż CSS), inaczej zdjęcie wychodzi rozmyte
      const kmPerPx = viewKm / (view.heightPx * Math.min(2, window.devicePixelRatio || 1));
      let z = Math.floor(Math.log2((40075 * cosLat) / (256 * kmPerPx)) + 0.3);
      z = Math.max(3, Math.min(MAX_ZOOM, z));
      // zasięg kadru, najwyżej do horyzontu
      const horizon = Math.acos(1 / (1 + view.alt));
      const half = Math.min(horizon, Math.atan(view.alt * tanV * Math.max(1, view.aspect) * 1.1));
      const halfDeg = (half * 180) / Math.PI;
      const pick = (zz) => {
        const lngHalf = Math.min(180, halfDeg / cosLat);
        const x0 = Math.floor(lngToX(view.lng - lngHalf, zz));
        const x1 = Math.floor(lngToX(view.lng + lngHalf, zz));
        const y0 = Math.max(0, Math.floor(latToY(view.lat + halfDeg, zz)));
        const y1 = Math.min(2 ** zz - 1, Math.floor(latToY(view.lat - halfDeg, zz)));
        return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
      };
      let r = pick(z);
      while (r.count > MAX_TILES && z > 3) r = pick(--z);
      const levels = [z, Math.max(2, z - 3)]; // grubszy poziom pod spodem, żeby nie było dziur przy wczytywaniu
      const cx = lngToX(view.lng, z);
      const cy = latToY(view.lat, z);
      const list = [];
      for (const zz of levels) {
        const rr = zz === z ? r : pick(zz);
        const n = 2 ** zz;
        for (let y = rr.y0; y <= rr.y1; y++) {
          for (let xr = rr.x0; xr <= rr.x1; xr++) {
            const x = ((xr % n) + n) % n;
            const kinds = labelsOn && zz === z && z >= 5 ? ["i", "l"] : ["i"];
            for (const k of kinds) {
              const t = get(k, zz, x, y);
              t.used = frame;
              wanted.add(t);
              list.push({ t, d: zz === z ? Math.hypot(xr + 0.5 - cx, y + 0.5 - cy) : -1 });
            }
          }
        }
      }
      // najpierw grubszy poziom, potem od środka kadru
      list.sort((a, b) => a.d - b.d);
      queue.length = 0;
      for (const { t } of list) if (t.state === "new") queue.push(t);
      pump();
    }
    for (const t of cache.values()) {
      const show = wanted.has(t) && t.state === "ready";
      if (!show) {
        t.mesh.visible = false;
        t.fade = 0;
        t.mesh.material.uniforms.opacity.value = 0;
      } else t.mesh.visible = true;
    }
    setActive(wanted.size > 0);
    evict();
  }

  /** Płynne pojawianie się wczytanych kafelków — wywoływane co klatkę. */
  function animate(dt) {
    for (const t of cache.values()) {
      if (!t.mesh.visible || t.fade >= 1) continue;
      t.fade = Math.min(1, t.fade + dt * 4);
      t.mesh.material.uniforms.opacity.value = t.fade;
    }
  }

  return {
    update,
    animate,
    setLabels(on) {
      labelsOn = on;
    },
    setEnabled(on) {
      enabled = on;
    },
  };
}
