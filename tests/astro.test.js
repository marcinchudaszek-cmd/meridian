import { test } from "node:test";
import assert from "node:assert/strict";
import { moonState, phaseName, nextPhases, gmstDeg } from "../src/astro.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} ± ${tol}`);

test("fazy Księżyca w październiku 2026", () => {
  // nów 10.10.2026 ok. 15:50 UTC, pełnia 26.10.2026 ok. 04:12 UTC
  const nowiu = moonState(new Date("2026-10-10T15:50:00Z"));
  assert.ok(nowiu.illum < 0.01, "nów: " + nowiu.illum);
  assert.equal(phaseName(nowiu), "nów");
  const pelnia = moonState(new Date("2026-10-26T04:12:00Z"));
  assert.ok(pelnia.illum > 0.99, "pełnia: " + pelnia.illum);
  assert.equal(phaseName(pelnia), "pełnia");
  const kwadra = moonState(new Date("2026-10-18T16:13:00Z"));
  near(kwadra.illum, 0.5, 0.05);
  assert.equal(kwadra.waxing, true);
});

test("przykład z Meeusa: 12 kwietnia 1992, 0:00 TT", () => {
  // λ = 133,162°, β = −3,229°, Δ = 368 409,7 km → RA 134,688°, Dec 13,768°
  const m = moonState(new Date("1992-04-12T00:00:00Z"));
  near(m.ra, 134.688, 0.4);
  near(m.dec, 13.768, 0.4);
  near(m.dist, 368410, 1500);
});

test("czas gwiazdowy i punkt podksiężycowy w zakresie", () => {
  // GMST 1.01.2000 12:00 UTC ≈ 280,46°
  near(gmstDeg(new Date("2000-01-01T12:00:00Z")), 280.46, 0.05);
  const m = moonState(new Date());
  assert.ok(m.lng >= -180 && m.lng < 180);
  assert.ok(Math.abs(m.lat) < 29);
  const n = nextPhases(m);
  assert.ok(n.toFull >= 0 && n.toFull < 29.6 && n.toNew >= 0 && n.toNew < 29.6);
});
