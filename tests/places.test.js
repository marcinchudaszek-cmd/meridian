import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACES, CATEGORIES } from "../src/places.js";

const cats = new Set(CATEGORIES.map((c) => c.id).filter((id) => !["all", "fav", "own"].includes(id)));

test("identyfikatory są unikalne i bez polskich znaków", () => {
  const ids = PLACES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "powtórzony id: " + ids.filter((id, i) => ids.indexOf(id) !== i));
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id);
});

test("współrzędne, kategorie i opisy", () => {
  for (const p of PLACES) {
    assert.ok(p.lat >= -90 && p.lat <= 90, `${p.id}: szerokość ${p.lat}`);
    assert.ok(p.lng >= -180 && p.lng <= 180, `${p.id}: długość ${p.lng}`);
    assert.ok(cats.has(p.cat), `${p.id}: nieznana kategoria ${p.cat}`);
    assert.ok(p.name && p.region, `${p.id}: brak nazwy albo regionu`);
    assert.ok(p.blurb.length > 20 && p.blurb.length < 160, `${p.id}: opis ma ${p.blurb.length} znaków`);
    assert.ok(p.blurb.endsWith("."), `${p.id}: opis bez kropki`);
  }
});

test("strefy czasowe istnieją", () => {
  for (const p of PLACES) {
    if (p.tz === null) continue;
    assert.doesNotThrow(() => new Intl.DateTimeFormat("pl-PL", { timeZone: p.tz }), `${p.id}: zła strefa ${p.tz}`);
  }
});

test("w każdym poziomie quizu wystarczy miejsc na 10 rund", () => {
  for (const cat of ["m", "p", "d"]) assert.ok(PLACES.filter((p) => p.cat === cat).length >= 10, cat);
});

test("nazwy się nie dublują", () => {
  const names = PLACES.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, "powtórzona nazwa: " + names.filter((n, i) => names.indexOf(n) !== i));
});
