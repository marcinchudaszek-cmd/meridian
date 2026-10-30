import * as THREE from "three";
import { latLngLocal } from "./globe.js";
import { gmstDeg, moonState } from "./astro.js";

// Prawdziwe niebo: gwiazdy do 6 mag (katalog Yale przez d3-celestial), linie i polskie nazwy gwiazdozbiorów, Księżyc z fazą.
// Gwiazda o rektascensji α stoi nad długością geograficzną α − GMST, więc całe niebo obraca się o −GMST wokół osi Ziemi.
const SKY_R = 60;
const MOON_DIST = 7;
const MOON_R = 0.45;

const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vSize;
  uniform float pixelRatio;
  void main() {
    vColor = color;
    vSize = size;
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vSize;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * clamp(vSize / 2.2, 0.35, 1.0));
  }
`;

const MOON_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    float ndl = dot(normalize(vN), sunDir);
    vec3 c = texture2D(map, vUv).rgb * (0.02 + 1.1 * smoothstep(-0.03, 0.25, ndl));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;
const MOON_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

function label(text) {
  const size = 26;
  const font = `500 ${size}px Outfit, system-ui, sans-serif`;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 12;
  c.height = size + 12;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(170, 190, 225, 0.85)";
  ctx.fillText(text, 6, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.userData.aspect = c.width / c.height;
  return s;
}

export function createSky(globe, { dataBase = "data/", texturesBase = "textures/", onMoon }) {
  const root = globe.layerRoot;
  const sky = new THREE.Group(); // w układzie nieba; obracany o −GMST
  root.add(sky);
  const lines = new THREE.Group();
  lines.visible = false;
  sky.add(lines);
  const names = [];
  let loaded = false;

  fetch(dataBase + "sky.json")
    .then((r) => r.json())
    .then(async (data) => {
      const n = data.s.length;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const size = new Float32Array(n);
      data.s.forEach(([ra, dec, mag, r, g, b], i) => {
        const p = latLngLocal(dec, ra > 180 ? ra - 360 : ra, SKY_R);
        pos.set([p.x, p.y, p.z], i * 3);
        col.set([r, g, b], i * 3);
        // jasność rośnie 2,512× na każdą wielkość gwiazdową — rozmiar punktu łagodniej
        size[i] = Math.max(0.9, 4.2 * Math.pow(10, -0.16 * (mag + 1)));
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
      const stars = new THREE.Points(
        geo,
        new THREE.ShaderMaterial({
          uniforms: { pixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) } },
          vertexShader: STAR_VERT,
          fragmentShader: STAR_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      stars.frustumCulled = false;
      sky.add(stars);

      const segs = [];
      for (const line of data.l) {
        for (let i = 1; i < line.length; i++) {
          const a = latLngLocal(line[i - 1][1], line[i - 1][0] > 180 ? line[i - 1][0] - 360 : line[i - 1][0], SKY_R * 0.99);
          const b = latLngLocal(line[i][1], line[i][0] > 180 ? line[i][0] - 360 : line[i][0], SKY_R * 0.99);
          segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
      lines.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x6f86b8, transparent: true, opacity: 0.45, depthWrite: false })));

      await document.fonts?.ready;
      for (const [ra, dec, name, rank] of data.n) {
        const s = label(name);
        s.position.copy(latLngLocal(dec, ra > 180 ? ra - 360 : ra, SKY_R * 0.98));
        s.userData.rank = rank;
        lines.add(s);
        names.push(s);
      }
      loaded = true;
      globe.hideRandomStars();
    })
    .catch(() => {});

  // ---------- Księżyc ----------
  const moonTex = new THREE.TextureLoader().load(texturesBase + "moon.webp");
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_R, 64, 48),
    new THREE.ShaderMaterial({ uniforms: { map: { value: moonTex }, sunDir: { value: globe.sunDir } }, vertexShader: MOON_VERT, fragmentShader: MOON_FRAG }),
  );
  moon.userData.pick = { kind: "moon" };
  root.add(moon);
  globe.addPickable(moon);
  let moonInfo = null;
  const X_AXIS = new THREE.Vector3(1, 0, 0);

  function updateSky(date) {
    sky.rotation.y = (-gmstDeg(date) * Math.PI) / 180;
    moonInfo = moonState(date);
    const dir = latLngLocal(moonInfo.lat, moonInfo.lng, 1);
    moon.position.copy(dir).multiplyScalar(MOON_DIST);
    // Księżyc zawsze zwraca się do Ziemi tą samą stroną; środek tekstury (0°, 0°) leży na lokalnej osi +X
    moon.quaternion.setFromUnitVectors(X_AXIS, dir.clone().negate());
    onMoon?.(moonInfo);
  }

  let clockDate = () => new Date();
  let timer = 0;
  const lp = new THREE.Vector3();
  globe.onFrame(({ dt, camera }) => {
    timer -= dt;
    if (timer <= 0) {
      timer = 20;
      updateSky(clockDate());
    }
    if (loaded && lines.visible) {
      const H = window.innerHeight;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const alt = camera.position.length() - 1;
      const maxRank = alt > 2.5 ? 1 : alt > 1.2 ? 2 : 3;
      for (const s of names) {
        s.visible = s.userData.rank <= maxRank;
        if (!s.visible) continue;
        root.localToWorld(lp.copy(s.position));
        const h = ((12 * 1.45) / H) * 2 * camera.position.distanceTo(lp) * tanHalf;
        s.scale.set(h * s.userData.aspect, h, 1);
      }
    }
  });

  return {
    setConstellations(on) {
      lines.visible = on;
    },
    setMoon(on) {
      moon.visible = on;
    },
    /** Niebo idzie za zegarem aplikacji (z przesunięciem czasu z ustawień). */
    setClock(fn) {
      clockDate = fn;
      timer = 0;
    },
    get moon() {
      return moonInfo;
    },
  };
}
