import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { LEVELS } from "../src/levels.js";
import { VISUAL_CHECKPOINT_LEVELS, visualFrameDescriptor } from "../src/visual-checkpoints.js";

const checkpoints = Object.freeze({
  1: "015259dea3ca729ea139e2d4251f178313edc8efbad513ea9f6f51a2a4c250c7",
  20: "f8920297d3bb8bf26b0eee081fc3292dcb9cceb1215b74e62110f1d6d2d272a5",
  100: "2c1fcbc6536a2946bab26064c7d719b994b02320adfa432f2ab646ef8ad91867",
  200: "71062300ef1bb983acbb491ea332e0eb09ab58c07263d01f3048172d0d79eca5",
  250: "5805aad60de370a45e17c43828a822363c8562e3fe925c26de5587b4c2052259",
});

test("visual checkpoints keep campaign anchors stable", () => {
  for (const id of VISUAL_CHECKPOINT_LEVELS) {
    const descriptor = visualFrameDescriptor(LEVELS[id - 1]);
    const digest = createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
    assert.equal(digest, checkpoints[id], `visual checkpoint ${id} changed`);
  }
});
