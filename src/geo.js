// Geografia i astronomia bez zależności — testowane w tests/geo.test.js.

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const J2000_MS = 946728000000; // 2000-01-01 12:00 UTC

/** Punkt podsłoneczny (gdzie Słońce stoi w zenicie) dla danej chwili. Dokładność ok. 0,1°. */
export function subsolarPoint(date) {
  const d = (date.getTime() - J2000_MS) / 86400000;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const decl = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
  // równanie czasu w godzinach, sprowadzone do zakresu −12…12
  let eqt = (q - ra) / 15;
  eqt = ((((eqt + 12) % 24) + 24) % 24) - 12;
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return { lat: decl, lng: normLng(-15 * (utcHours - 12 + eqt)) };
}

/** Wysokość Słońca nad horyzontem w stopniach (bez refrakcji). */
export function sunAltitude(lat, lng, date) {
  const s = subsolarPoint(date);
  return 90 - angularDistance(lat, lng, s.lat, s.lng) / RAD;
}

export function normLng(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Kąt środkowy między punktami w radianach (wzór haversine). */
export function angularDistance(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  return angularDistance(lat1, lng1, lat2, lng2) * EARTH_KM;
}

/** Punkty łuku wielkiego koła (lat/lng) od a do b, włącznie z końcami. */
export function greatCircle(a, b, steps = 64) {
  const va = toUnit(a.lat, a.lng);
  const vb = toUnit(b.lat, b.lng);
  const omega = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let v;
    if (omega < 1e-6) v = va;
    else {
      const s = Math.sin(omega);
      const ka = Math.sin((1 - t) * omega) / s;
      const kb = Math.sin(t * omega) / s;
      v = [va[0] * ka + vb[0] * kb, va[1] * ka + vb[1] * kb, va[2] * ka + vb[2] * kb];
    }
    out.push({ lat: Math.asin(v[2]) / RAD, lng: Math.atan2(v[1], v[0]) / RAD, t });
  }
  return out;
}

function toUnit(lat, lng) {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lng * RAD), c * Math.sin(lng * RAD), Math.sin(lat * RAD)];
}

/** Punkty w quizie: 1000 za trafienie, połowa przy ok. 1100 km, prawie zero powyżej 8000 km. */
export function quizPoints(km) {
  if (km < 25) return 1000;
  return Math.max(0, Math.round(1000 * Math.exp(-km / 1600)));
}

/** Szacowany czas lotu: 850 km/h przelotowo + 30 min na start i lądowanie. */
export function flightMinutes(km) {
  return Math.round((km / 850) * 60 + 30);
}

const nf = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });

export function formatKm(km) {
  if (km < 10) return km.toFixed(1).replace(".", ",") + " km";
  return nf.format(Math.round(km)) + " km";
}

export function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

export function formatCoord(lat, lng) {
  return `${Math.abs(lat).toFixed(2).replace(".", ",")}° ${lat >= 0 ? "N" : "S"}   ${Math.abs(lng).toFixed(2).replace(".", ",")}° ${lng >= 0 ? "E" : "W"}`;
}

/** Czas lokalny w strefie IANA, a bez strefy — czas słoneczny z długości geograficznej. */
const timeFormats = new Map();
export function localTime(date, tz, lng) {
  if (tz) {
    let f = timeFormats.get(tz);
    if (!f) timeFormats.set(tz, (f = new Intl.DateTimeFormat("pl-PL", { timeZone: tz, hour: "2-digit", minute: "2-digit" })));
    return f.format(date);
  }
  const shifted = new Date(date.getTime() + (lng / 15) * 3600000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

/** Krótki opis światła w miejscu na podstawie wysokości Słońca. */
export function daylightLabel(alt) {
  if (alt > 6) return `dzień, Słońce ${Math.round(alt)}° nad horyzontem`;
  if (alt > -0.8) return "wschód albo zachód Słońca";
  if (alt > -6) return "zmierzch cywilny";
  if (alt > -18) return "zmierzch, niebo jeszcze nie całkiem ciemne";
  return "noc";
}
