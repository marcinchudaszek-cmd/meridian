import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuakes, ago, quakeLabel, formatMag, inSunlight, yesterdayUTC, photoUrl } from "../src/live.js";

test("trzęsienia z USGS: filtr i kolejność", () => {
  const q = parseQuakes({
    features: [
      { id: "a", properties: { mag: 5.2, time: 1, place: "Japan" }, geometry: { coordinates: [140, 35, 10] } },
      { id: "b", properties: { mag: null }, geometry: { coordinates: [0, 0, 0] } },
      { id: "c", properties: { mag: 3.1, time: 2, tsunami: 1 }, geometry: { coordinates: [-120, 36, 5] } },
    ],
  });
  assert.deepEqual(q.map((x) => x.id), ["c", "a"]);
  assert.equal(q[1].lat, 35);
  assert.equal(q[0].tsunami, true);
});

test("czas „temu” po polsku", () => {
  const now = Date.UTC(2026, 9, 30, 12);
  assert.equal(ago(now - 30000, now), "przed chwilą");
  assert.equal(ago(now - 25 * 60000, now), "25 min temu");
  assert.equal(ago(now - 3 * 3600000, now), "3 godz. temu");
  assert.equal(ago(now - 26 * 3600000, now), "wczoraj");
  assert.equal(ago(now - 5 * 86400000, now), "5 dni temu");
});

test("siła trzęsienia", () => {
  assert.equal(formatMag(5.25), "M 5,3");
  assert.equal(quakeLabel(7.1), "bardzo silne");
  assert.equal(quakeLabel(2.6), "słabe");
});

test("ISS w słońcu: przy -15° pod nią jeszcze świeci, przy -30° już cień", () => {
  // północ w Krakowie w październiku: Słońce ok. -52° → cień
  assert.equal(inSunlight(50.06, 19.94, 420, new Date("2026-10-30T23:00:00Z")), false);
  // południe → słońce
  assert.equal(inSunlight(50.06, 19.94, 420, new Date("2026-10-30T11:00:00Z")), true);
});

test("adres zdjęcia NASA z wczoraj", () => {
  assert.equal(yesterdayUTC(new Date("2026-10-30T01:00:00Z")), "2026-10-29");
  assert.match(photoUrl("2026-10-29", 2048), /WIDTH=2048&HEIGHT=1024.*TIME=2026-10-29$/);
});
