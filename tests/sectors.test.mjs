import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS } from "../src/i18n.js";
import { isSectorCore, isSectorStart, SECTORS, sectorForLevel } from "../src/sectors.js";

test("thirteen sectors cover every campaign level without gaps", () => {
  assert.equal(SECTORS.length, 13);
  assert.deepEqual(SECTORS.map(({ start, end }) => [start, end]), [
    [1, 20], [21, 40], [41, 60], [61, 80], [81, 100], [101, 120], [121, 140],
    [141, 160], [161, 180], [181, 200], [201, 220], [221, 240], [241, 250],
  ]);
  assert.equal(sectorForLevel(250).index, 12);
  assert.equal(isSectorStart(41), true);
  assert.equal(isSectorCore(40), true);
  assert.equal(isSectorCore(250), false);
});

test("every sector intro has RU and EN atmosphere and signature text", () => {
  for (const sector of SECTORS) for (const language of ["ru", "en"]) {
    assert.ok(STRINGS[language][sector.lineKey]);
    assert.ok(STRINGS[language][sector.signatureKey]);
  }
});
