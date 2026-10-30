import { test } from "node:test";
import assert from "node:assert/strict";
import { subsolarPoint, sunAltitude, distanceKm, greatCircle, quizPoints, normLng, formatKm, localTime } from "../src/geo.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} ± ${tol}`);

test("deklinacja: równonoc ~0°, przesilenia ±23,4°", () => {
  near(subsolarPoint(new Date("2026-03-20T14:46:00Z")).lat, 0, 0.3);
  near(subsolarPoint(new Date("2026-06-21T08:24:00Z")).lat, 23.44, 0.1);
  near(subsolarPoint(new Date("2026-12-21T20:50:00Z")).lat, -23.44, 0.1);
});

test("w południe UTC Słońce stoi blisko południka 0 (± równanie czasu)", () => {
  // 3 listopada równanie czasu ≈ +16,4 min: południe słoneczne w Greenwich już było, Słońce ~4,1° na zachód
  near(subsolarPoint(new Date("2026-11-03T12:00:00Z")).lng, -4.1, 0.3);
  // 12 lutego ≈ −14,2 min: Słońce jeszcze ~3,6° na wschód
  near(subsolarPoint(new Date("2026-02-12T12:00:00Z")).lng, 3.55, 0.3);
});

test("w Krakowie o północy jest noc, w lipcowe południe dzień", () => {
  assert.ok(sunAltitude(50.06, 19.94, new Date("2026-10-30T23:00:00Z")) < -18);
  near(sunAltitude(50.06, 19.94, new Date("2026-06-21T10:40:00Z")), 63.4, 1);
});

test("odległości", () => {
  near(distanceKm(50.0614, 19.9366, 52.2297, 21.0122), 252, 3); // Kraków–Warszawa
  near(distanceKm(40.7128, -74.006, 51.5074, -0.1278), 5570, 15); // Nowy Jork–Londyn
  near(distanceKm(10, 10, 10, 10), 0, 1e-9);
});

test("łuk wielkiego koła zaczyna się i kończy w punktach, przechodzi przez antypołudnik", () => {
  const pts = greatCircle({ lat: 35.68, lng: 139.69 }, { lat: 37.77, lng: -122.42 }, 32);
  near(pts[0].lat, 35.68, 1e-6);
  near(pts[32].lng, -122.42, 1e-6);
  assert.ok(pts.some((p) => Math.abs(p.lng) > 175), "trasa Tokio–SF powinna iść przez Pacyfik");
  assert.ok(Math.max(...pts.map((p) => p.lat)) > 45, "łuk wygina się na północ");
});

test("punkty quizu", () => {
  assert.equal(quizPoints(5), 1000);
  near(quizPoints(1100), 503, 5);
  assert.ok(quizPoints(9000) < 5);
  assert.equal(quizPoints(20000), 0);
});

test("formatowanie", () => {
  assert.equal(normLng(190), -170);
  assert.equal(normLng(-180), -180);
  assert.equal(formatKm(3.25), "3,3 km");
  assert.match(formatKm(12345), /^12\s345 km$/);
  assert.equal(localTime(new Date("2026-10-30T12:00:00Z"), "Asia/Tokyo"), "21:00");
  assert.equal(localTime(new Date("2026-10-30T12:00:00Z"), null, 90), "18:00");
});
