import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareCountries, countryAt, borderSegments } from "../src/countries.js";

const list = prepareCountries(JSON.parse(readFileSync(new URL("../public/data/countries.json", import.meta.url), "utf8")));

test("kraj w punkcie", () => {
  assert.equal(countryAt(list, 48.6336, 12.8564)?.n, "Niemcy"); // Eichendorf
  assert.equal(countryAt(list, 50.0614, 19.9366)?.n, "Polska"); // Kraków
  assert.equal(countryAt(list, -33.92, 18.42)?.n, "Republika Południowej Afryki");
  assert.equal(countryAt(list, 40.71, -74.0)?.iso, "US");
  assert.equal(countryAt(list, 0, -30), null); // Atlantyk
  // Lesotho to dziura w RPA — punkt w Maseru nie może wyjść jako RPA
  assert.equal(countryAt(list, -29.4, 28.0)?.n, "Lesotho");
});

test("stolice i nazwy po polsku", () => {
  const pl = list.find((c) => c.iso === "PL");
  assert.equal(pl.cap, "Warszawa");
  assert.equal(list.find((c) => c.iso === "DE").cap, "Berlin");
  assert.ok(list.length > 170);
});

test("granice zagęszczone do 1°", () => {
  const segs = borderSegments(list);
  assert.ok(segs.length > 5000);
  for (const [a, b, c, d] of segs) assert.ok(Math.abs(c - a) <= 1.0001 && Math.abs(d - b) <= 1.0001);
});
