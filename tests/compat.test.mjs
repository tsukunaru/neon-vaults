import test from "node:test";
import assert from "node:assert/strict";
import { fromEntries, objectEntries, objectValues, pad2, setChildren } from "../src/compat.js";

test("compatibility helpers preserve the native operations they replace", () => {
  const source = Object.create({ inherited: 0 });
  source.first = 1; source.second = 2;
  assert.deepEqual(objectEntries(source), [["first", 1], ["second", 2]]);
  assert.deepEqual(objectValues(source), [1, 2]);

  const rebuilt = fromEntries(new Map([["__proto__", "safe"], ["first", 1]]));
  assert.equal(Object.getPrototypeOf(rebuilt), Object.prototype);
  assert.equal(rebuilt.__proto__, "safe");
  assert.equal(rebuilt.first, 1);

  const appended = [];
  const element = { textContent: "old", appendChild: (child) => appended.push(child) };
  setChildren(element, ["first", "second"]);
  assert.equal(element.textContent, "");
  assert.deepEqual(appended, ["first", "second"]);
  assert.equal(pad2(7), "07");
  assert.equal(pad2(12), "12");
});
