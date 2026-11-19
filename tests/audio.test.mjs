import test from "node:test";
import assert from "node:assert/strict";
import { SECTOR_AUDIO_THEMES } from "../src/audio.js";

test("sector audio keeps a shared groove with distinct instrument profiles", () => {
  assert.equal(SECTOR_AUDIO_THEMES.length, 13);
  assert.equal(new Set(SECTOR_AUDIO_THEMES.map((theme) => `${theme.pad}:${theme.lead}:${theme.percussion}`)).size, 13);
  assert.ok(SECTOR_AUDIO_THEMES.every((theme) => ["sine", "square", "sawtooth", "triangle"].includes(theme.pad)));
});
