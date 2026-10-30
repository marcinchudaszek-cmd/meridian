import * as THREE from "three";
import { twoline2satrec, propagate, gstime, eciToGeodetic } from "satellite.js";
import { latLngLocal } from "./globe.js";
import { borderSegments, prepareCountries } from "./countries.js";
import { parseQuakes, QUAKES_URL, ISS_TLE_URL } from "./live.js";

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const RAD = 180 / Math.PI;
const EARTH_KM = 6371;

function segmentsGeometry(segs, radius) {
  const pos = new Float32Array(segs.length * 6);
  segs.forEach(([la1, lo1, la2, lo2], i) => {
    const a = latLngLocal(la1, lo1, radius);
    const b = latLngLocal(la2, lo2, radius);
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

function circle(lat, radius) {
  const pts = [];
  for (let lng = -180; lng <= 180; lng += 1) pts.push(latLngLocal(lat, lng, radius));
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function textSprite(text, { size = 30, color = "#ece7db", weight = 500 } = {}) {
  const font = `${weight} ${size}px Outfit, system-ui, sans-serif`;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w;
  c.height = size + 16;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(5,7,12,0.85)";
  ctx.strokeText(text, 8, c.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  // bez testu głębokości: płaski napis przy brzegu kuli wchodziłby w jej krzywiznę i był ucinany;
  // napisy z tyłu globusu ukrywa onFrame po kierunku do kamery
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  s.userData.aspect = c.width / c.height;
  s.renderOrder = 500;
  return s;
}

function glowSprite(color) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.renderOrder = 510;
  return s;
}

export function createLayers(globe, { dataBase = "data/", onCountries, onQuakes, onIss }) {
  const root = globe.layerRoot;
  const state = { borders: false, grid: false, quakes: false, iss: false };
  let countries = [];

  // ---------- granice i nazwy państw ----------
  const borders = new THREE.Group();
  borders.visible = false;
  root.add(borders);
  const borderMat = new THREE.LineBasicMaterial({ color: 0xdfe6f2, transparent: true, opacity: 0.4, depthWrite: false });
  const labels = [];
  let countriesLoading = null;

  function loadCountries() {
    if (countriesLoading) return countriesLoading;
    countriesLoading = fetch(dataBase + "countries.json")
      .then((r) => r.json())
      .then(async (list) => {
        countries = prepareCountries(list);
        const lines = new THREE.LineSegments(segmentsGeometry(borderSegments(countries), 1.0008), borderMat);
        lines.renderOrder = 400;
        borders.add(lines);
        await document.fonts?.ready;
        for (const c of countries) {
          const s = textSprite(c.n, { size: c.r <= 2 ? 34 : 28, weight: c.r <= 2 ? 600 : 500 });
          s.position.copy(latLngLocal(c.ly, c.lx, 1.004));
          s.userData.base = s.position.clone();
          s.userData.rank = c.r;
          s.userData.pop = c.pop || 0;
          s.userData.normal = s.position.clone().normalize();
          borders.add(s);
          labels.push(s);
        }
        buildVisited();
        onCountries?.(countries);
        return countries;
      })
      .catch(() => {
        countriesLoading = null;
      });
    return countriesLoading;
  }

  // ---------- odwiedzone kraje („Byłem tu”) ----------
  const visitedMat = new THREE.MeshBasicMaterial({ color: 0x9fe0c0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  let visitedMesh = null;
  let visitedIsos = new Set();
  let visitedOn = true;

  // trójkąty większe niż ok. 2,5° dzielimy, żeby płaski trójkąt nie chował się pod krzywizną kuli
  function fillGeometry(list, radius) {
    const pos = [];
    const push = (a) => {
      const p = latLngLocal(a[1], a[0], radius);
      pos.push(p.x, p.y, p.z);
    };
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const tri = (a, b, c, depth) => {
      const len = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
      if (depth < 7 && len > 2.5) {
        const ab = mid(a, b);
        const bc = mid(b, c);
        const ca = mid(c, a);
        tri(a, ab, ca, depth + 1);
        tri(ab, b, bc, depth + 1);
        tri(ca, bc, c, depth + 1);
        tri(ab, bc, ca, depth + 1);
      } else {
        push(a);
        push(b);
        push(c);
      }
    };
    const ring = (r) => {
      const v = r.map(([x, y]) => new THREE.Vector2(x, y));
      if (v.length > 1 && v[0].equals(v[v.length - 1])) v.pop();
      return v;
    };
    for (const c of list) {
      for (const poly of c.p) {
        const contour = ring(poly[0]);
        const holes = poly.slice(1).map(ring);
        const all = contour.concat(...holes);
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
          tri([all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y], 0);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }

  function buildVisited() {
    if (visitedMesh) {
      root.remove(visitedMesh);
      visitedMesh.geometry.dispose();
      visitedMesh = null;
    }
    const list = countries.filter((c) => visitedIsos.has(c.iso));
    if (!list.length) return;
    visitedMesh = new THREE.Mesh(fillGeometry(list, 1.0007), visitedMat);
    visitedMesh.renderOrder = 390;
    visitedMesh.visible = visitedOn;
    root.add(visitedMesh);
  }

  // ---------- siatka ----------
  const grid = new THREE.Group();
  grid.visible = false;
  root.add(grid);
  {
    const R = 1.0009;
    const dashed = (color, opacity) => new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.012, gapSize: 0.01, depthWrite: false });
    const add = (geo, mat) => {
      const l = new THREE.Line(geo, mat);
      l.computeLineDistances();
      l.renderOrder = 400;
      grid.add(l);
    };
    add(circle(0, R), new THREE.LineBasicMaterial({ color: 0xe4b56a, transparent: true, opacity: 0.75, depthWrite: false }));
    add(circle(23.44, R), dashed(0xf0a060, 0.6));
    add(circle(-23.44, R), dashed(0xf0a060, 0.6));
    add(circle(66.56, R), dashed(0x8fd3ff, 0.6));
    add(circle(-66.56, R), dashed(0x8fd3ff, 0.6));
    // południki co 15° — tyle Ziemia obraca się w godzinę
    const segs = [];
    for (let lng = -180; lng < 180; lng += 15) for (let lat = -80; lat < 80; lat += 2) segs.push([lat, lng, lat + 2, lng]);
    const meridians = new THREE.LineSegments(segmentsGeometry(segs, R), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false }));
    meridians.renderOrder = 400;
    grid.add(meridians);
  }

  // ---------- trzęsienia ziemi ----------
  const MAX_QUAKES = 2000;
  let quakes = [];
  const quakeMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
    MAX_QUAKES,
  );
  quakeMesh.count = 0;
  quakeMesh.visible = false;
  quakeMesh.frustumCulled = false;
  quakeMesh.renderOrder = 450;
  quakeMesh.userData.pick = { kind: "quake" };
  quakeMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  root.add(quakeMesh);
  globe.addPickable(quakeMesh);
  let quakeTimer = null;

  function quakeColor(q, now) {
    const h = (now - q.time) / 3600000;
    if (h < 1) return new THREE.Color(0xff4d4d);
    if (h < 24) return new THREE.Color(0xff9a3c);
    return new THREE.Color(0xf3d27a);
  }

  function loadQuakes() {
    fetch(QUAKES_URL)
      .then((r) => r.json())
      .then((g) => {
        quakes = parseQuakes(g).slice(-MAX_QUAKES);
        const now = Date.now();
        quakes.forEach((q, i) => quakeMesh.setColorAt(i, quakeColor(q, now)));
        quakeMesh.count = quakes.length;
        if (quakeMesh.instanceColor) quakeMesh.instanceColor.needsUpdate = true;
        onQuakes?.(quakes, null);
      })
      .catch(() => onQuakes?.(quakes, "Nie udało się pobrać danych USGS — sprawdź internet."));
  }

  const qPos = new THREE.Vector3();
  const qQuat = new THREE.Quaternion();
  const qScale = new THREE.Vector3();
  const qMat = new THREE.Matrix4();
  function updateQuakes(scale, t) {
    const now = Date.now();
    for (let i = 0; i < quakes.length; i++) {
      const q = quakes[i];
      qPos.copy(latLngLocal(q.lat, q.lng, 1.0005));
      qQuat.setFromUnitVectors(Z_AXIS, qPos.clone().normalize());
      // siła rośnie wykładniczo z magnitudą — promień łagodniej, żeby duże nie zasłaniały kontynentów
      let r = (0.0045 + 0.0042 * Math.pow(Math.max(0, q.mag - 2.4), 1.35)) * scale;
      if (now - q.time < 86400000) r *= 1 + 0.18 * Math.sin(t * 3 + i);
      qScale.set(r, r, r);
      qMat.compose(qPos, qQuat, qScale);
      quakeMesh.setMatrixAt(i, qMat);
    }
    quakeMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- ISS ----------
  const iss = new THREE.Group();
  iss.visible = false;
  root.add(iss);
  const issGlow = glowSprite("rgba(143,211,255,0.9)");
  issGlow.userData.pick = { kind: "iss" };
  const issLabel = textSprite("ISS", { size: 30, color: "#bfe6ff", weight: 600 });
  iss.add(issGlow, issLabel);
  globe.addPickable(issGlow);
  const orbitMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
  let orbit = null;
  let satrec = null;
  let issState = null;
  let orbitAt = 0;
  let tleAt = 0;

  function loadTle() {
    tleAt = Date.now();
    fetch(ISS_TLE_URL)
      .then((r) => r.json())
      .then((t) => {
        satrec = twoline2satrec(t.line1, t.line2);
        orbitAt = 0;
      })
      .catch(() => {
        tleAt = 0;
        onIss?.(null, "Nie udało się pobrać orbity ISS — sprawdź internet.");
      });
  }

  function issAt(date) {
    const pv = propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const geo = eciToGeodetic(pv.position, gstime(date));
    const v = pv.velocity;
    return { lat: geo.latitude * RAD, lng: geo.longitude * RAD, alt: geo.height, speed: Math.hypot(v.x, v.y, v.z) * 3600 };
  }

  function buildOrbit(now) {
    if (orbit) {
      iss.remove(orbit);
      orbit.geometry.dispose();
    }
    const pts = [];
    const cols = [];
    // od 40 min wstecz do jednego pełnego okrążenia naprzód (ok. 92 min)
    for (let m = -40; m <= 92; m += 0.5) {
      const s = issAt(new Date(now + m * 60000));
      if (!s) continue;
      pts.push(latLngLocal(s.lat, s.lng, 1 + s.alt / EARTH_KM));
      const k = m < 0 ? 0.25 + 0.35 * (1 + m / 40) : 0.9 - 0.5 * (m / 92);
      cols.push(0.56 * k, 0.83 * k, 1.0 * k);
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    orbit = new THREE.Line(g, orbitMat);
    orbit.renderOrder = 480;
    iss.add(orbit);
  }

  // ---------- rozmieszczanie nazw państw ----------
  // Stała wielkość na ekranie (ok. 13–15 px) i bez nakładania: najpierw duże kraje, mniejsze tylko tam, gdzie jest miejsce.
  let labelFrame = 0;
  const lp = new THREE.Vector3();
  function placeLabels(alt, camera) {
    const tooClose = alt < 0.05; // niżej są już nazwy miast z kafelków satelitarnych
    const maxRank = alt > 1.1 ? 3 : alt > 0.5 ? 4 : alt > 0.15 ? 5 : 7;
    const camDir = camera.position.clone().normalize();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const boxes = [];
    const candidates = labels.filter((s) => {
      const ok = !tooClose && s.userData.rank <= maxRank && s.userData.normal.dot(camDir) > 0.3;
      if (!ok) s.visible = false;
      return ok;
    });
    candidates.sort((a, b) => a.userData.rank - b.userData.rank || b.userData.pop - a.userData.pop);
    // kierunek „w górę ekranu” w układzie globusu — do odsuwania etykiet, które się zderzają
    camUpLocal.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(root.getWorldQuaternion(rootQuat).invert());
    for (const s of candidates) {
      const base = s.userData.base;
      root.localToWorld(lp.copy(base));
      const d = camera.position.distanceTo(lp);
      const px = s.userData.rank <= 2 ? 15 : 13;
      const h = ((px * 1.6) / H) * 2 * d * tanHalf; // 1,6 — margines płótna wokół liter
      s.scale.set(h * s.userData.aspect, h, 1);
      const hw = (px * 1.6 * s.userData.aspect) / 2;
      const hh = (px * 1.6) / 2;
      let placed = false;
      // najpierw na swoim miejscu, potem trochę wyżej albo niżej
      for (const shift of [0, 0.75, -0.75]) {
        s.position.copy(base).addScaledVector(camUpLocal, shift * h);
        root.localToWorld(lp.copy(s.position)).project(camera);
        const x = ((lp.x + 1) / 2) * W;
        const y = ((1 - lp.y) / 2) * H;
        const box = [x - hw, y - hh * 0.8, x + hw, y + hh * 0.8];
        if (!boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) {
          boxes.push(box);
          placed = true;
          break;
        }
      }
      s.visible = placed;
    }
  }
  const camUpLocal = new THREE.Vector3();
  const rootQuat = new THREE.Quaternion();

  // ---------- co klatkę ----------
  let t = 0;
  const issRay = new THREE.Ray();
  const issHit = new THREE.Vector3();
  const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  globe.onFrame(({ dt, alt, markerScale, camera }) => {
    t += dt;
    if (state.borders && labels.length) {
      borderMat.opacity = 0.4 * THREE.MathUtils.smoothstep(alt, 0.004, 0.03);
      labelFrame = (labelFrame + 1) % 6;
      if (labelFrame === 0) placeLabels(alt, camera);
    }
    if (state.quakes && quakes.length) updateQuakes(Math.max(markerScale, 0.004), t);
    if (state.iss && satrec) {
      const now = Date.now();
      const s = issAt(new Date(now));
      if (s) {
        issState = s;
        const p = latLngLocal(s.lat, s.lng, 1 + s.alt / EARTH_KM);
        issGlow.position.copy(p);
        const wp = globe.layerRoot.localToWorld(p.clone());
        const d = camera.position.distanceTo(wp);
        const g = THREE.MathUtils.clamp(d * 0.05, 0.004, 0.2);
        issGlow.scale.set(g, g, 1);
        issLabel.position.copy(p).multiplyScalar(1 + g * 0.6);
        issLabel.scale.set(g * 0.6 * issLabel.userData.aspect, g * 0.6, 1);
        // napis ISS nie ma testu głębokości — chowamy go, gdy stację zasłania Ziemia
        issRay.set(camera.position, wp.clone().sub(camera.position).normalize());
        const hit = issRay.intersectSphere(unitSphere, issHit);
        issLabel.visible = !hit || camera.position.distanceTo(hit) > d;
      }
      if (now - orbitAt > 20000) {
        orbitAt = now;
        buildOrbit(now);
        onIss?.(issState, null);
      }
      if (now - tleAt > 6 * 3600000) loadTle();
    }
  });

  return {
    get countries() {
      return countries;
    },
    loadCountries,
    setBorders(on) {
      state.borders = on;
      borders.visible = on;
      if (on) loadCountries();
    },
    setVisited(isos) {
      visitedIsos = new Set(isos);
      if (countries.length) buildVisited();
    },
    showVisited(on) {
      visitedOn = on;
      if (visitedMesh) visitedMesh.visible = on;
    },
    setGrid(on) {
      state.grid = on;
      grid.visible = on;
    },
    setQuakes(on) {
      state.quakes = on;
      quakeMesh.visible = on;
      clearInterval(quakeTimer);
      if (on) {
        loadQuakes();
        quakeTimer = setInterval(loadQuakes, 10 * 60000);
      }
    },
    setIss(on) {
      state.iss = on;
      iss.visible = on;
      if (on && !satrec) loadTle();
    },
    quake(i) {
      return quakes[i];
    },
    get quakes() {
      return quakes;
    },
    get iss() {
      return issState;
    },
  };
}
