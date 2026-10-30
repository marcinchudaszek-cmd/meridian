// Księżyc i czas gwiazdowy — testowane w tests/astro.test.js.
// Pozycja Księżyca: skrócona teoria z „Astronomical Algorithms” J. Meeusa (rozdz. 47), dokładność ok. 0,3°.
import { gstime } from "satellite.js";

const RAD = Math.PI / 180;
const SYNODIC = 29.530588;

const norm = (deg) => ((deg % 360) + 360) % 360;

/** Średni czas gwiazdowy Greenwich w stopniach. */
export function gmstDeg(date) {
  return norm(gstime(date) / RAD);
}

function sunLongitude(d) {
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  return norm(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
}

// [D, M, M', F, współczynnik] — największe wyrazy szeregów długości (1e-6°) i odległości (m)
const LON = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116],
  [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758],
  [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720], [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163],
];
const DIST = [
  [0, 0, 1, 0, -20905355], [2, 0, -1, 0, -3699111], [2, 0, 0, 0, -2955968], [0, 0, 2, 0, -569925], [0, 1, 0, 0, 48888],
  [0, 0, 0, 2, -3149], [2, 0, -2, 0, 246158], [2, -1, -1, 0, -152138], [2, 0, 1, 0, -170733], [2, -1, 0, 0, -204586],
  [0, 1, -1, 0, -129620], [1, 0, 0, 0, 108743], [0, 1, 1, 0, 104755],
];
const LAT = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
];

/**
 * Księżyc w danej chwili: ra/dec (°), odległość (km), punkt podksiężycowy (lat/lng),
 * oświetlona część tarczy (0–1), czy przybywa i wiek od nowiu (dni).
 */
export function moonState(date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // dni od J2000.0
  const T = d / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = (297.8501921 + 445267.1114034 * T) * RAD;
  const M = (357.5291092 + 35999.0502909 * T) * RAD;
  const Mp = (134.9633964 + 477198.8675055 * T) * RAD;
  const F = (93.272095 + 483202.0175233 * T) * RAD;
  const arg = ([a, b, c, e]) => a * D + b * M + c * Mp + e * F;
  let sl = 0, sr = 0, sb = 0;
  for (const t of LON) sl += t[4] * Math.sin(arg(t));
  for (const t of DIST) sr += t[4] * Math.cos(arg(t));
  for (const t of LAT) sb += t[4] * Math.sin(arg(t));
  const lambda = norm(Lp + sl / 1e6);
  const beta = sb / 1e6;
  const dist = 385000.56 + sr / 1000;
  const eps = (23.4393 - 0.013 * T) * RAD;
  const l = lambda * RAD;
  const b = beta * RAD;
  const ra = norm(Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l)) / RAD);
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l)) / RAD;
  const elong = norm(lambda - sunLongitude(d));
  const cosPsi = Math.cos(b) * Math.cos(elong * RAD);
  const lng = ((((ra - gmstDeg(date)) % 360) + 540) % 360) - 180;
  return {
    ra,
    dec,
    dist,
    lat: dec,
    lng,
    illum: (1 - cosPsi) / 2,
    waxing: elong < 180,
    age: (elong / 360) * SYNODIC,
  };
}

/** Polska nazwa fazy Księżyca. */
export function phaseName(m) {
  const a = m.age;
  if (a < 1.2 || a > SYNODIC - 1.2) return "nów";
  if (Math.abs(a - SYNODIC / 2) < 1.2) return "pełnia";
  if (Math.abs(a - SYNODIC / 4) < 1.2) return "pierwsza kwadra";
  if (Math.abs(a - (3 * SYNODIC) / 4) < 1.2) return "ostatnia kwadra";
  if (a < SYNODIC / 4) return "przybywający sierp";
  if (a < SYNODIC / 2) return "przybywający garb";
  if (a < (3 * SYNODIC) / 4) return "ubywający garb";
  return "ubywający sierp";
}

/** Ile dni do najbliższej pełni i nowiu (z wieku Księżyca). */
export function nextPhases(m) {
  const toFull = (SYNODIC / 2 - m.age + SYNODIC) % SYNODIC;
  const toNew = (SYNODIC - m.age) % SYNODIC;
  return { toFull, toNew };
}
