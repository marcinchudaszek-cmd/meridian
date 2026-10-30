// Państwa z Natural Earth (public/data/countries.json, generowane przez scripts/kraje.py).
// Rekord: { n: nazwa, iso, cap: stolica, lx, ly: punkt etykiety, r: ranga etykiety, pop, p: wielokąty [[pierścień [lng, lat]…]…] }

/** Dokłada ramki ograniczające, żeby wyszukiwanie kraju w punkcie było szybkie. */
export function prepareCountries(list) {
  for (const c of list) {
    c.box = c.p.map((poly) => {
      let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
      for (const [x, y] of poly[0]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      return [x0, y0, x1, y1];
    });
  }
  return list;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Państwo, w którym leży punkt, albo null (morze, ocean). */
export function countryAt(list, lat, lng) {
  for (const c of list) {
    for (let k = 0; k < c.p.length; k++) {
      const [x0, y0, x1, y1] = c.box[k];
      if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
      const poly = c.p[k];
      if (inRing(poly[0], lng, lat) && !poly.slice(1).some((hole) => inRing(hole, lng, lat))) return c;
    }
  }
  return null;
}

/** Odcinki granic zagęszczone do ok. 1°, żeby linia nie wpadała pod powierzchnię kuli. */
export function borderSegments(list, maxStep = 1) {
  const out = [];
  for (const c of list) {
    for (const poly of c.p) {
      for (const ring of poly) {
        for (let i = 1; i < ring.length; i++) {
          const [ax, ay] = ring[i - 1];
          const [bx, by] = ring[i];
          if (Math.abs(bx - ax) > 180) continue; // odcinek przez antypołudnik — pomijamy
          const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / maxStep));
          for (let k = 0; k < n; k++) {
            const t0 = k / n;
            const t1 = (k + 1) / n;
            out.push([ay + (by - ay) * t0, ax + (bx - ax) * t0, ay + (by - ay) * t1, ax + (bx - ax) * t1]);
          }
        }
      }
    }
  }
  return out;
}
