import assert from "node:assert/strict";
import test from "node:test";
import { shouldThrottleWrite } from "../api/_exams/writeThrottle.js";

test("shared data writes consume the global write slot", () => {
  assert.equal(shouldThrottleWrite("POST", ""), true);
  assert.equal(shouldThrottleWrite("POST", "initialize"), true);
  assert.equal(shouldThrottleWrite("POST", "design-policy"), true);
  assert.equal(shouldThrottleWrite("POST", "reset-data"), true);
});

test("managed device writes consume the global write slot", () => {
  for (const action of [
    "device-binding",
    "managed-device-setup",
    "device-role-update",
    "device-command",
    "device-revoke",
  ]) {
    assert.equal(shouldThrottleWrite("POST", action), true, action);
  }
});

test("read and heartbeat requests bypass the global write slot", () => {
  assert.equal(shouldThrottleWrite("GET", ""), false);
  assert.equal(shouldThrottleWrite("GET", "device-binding"), false);
  assert.equal(shouldThrottleWrite("POST", "device-heartbeat"), false);
  assert.equal(shouldThrottleWrite("POST", "plugin-viewer-heartbeat"), false);
  assert.equal(shouldThrottleWrite("POST", "plugin-bootstrap"), false);
});

test("unknown POST actions do not consume a slot before their own validation", () => {
  assert.equal(shouldThrottleWrite("POST", "not-a-real-action"), false);
  assert.equal(shouldThrottleWrite("PUT", ""), false);
});
