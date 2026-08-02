import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRows,
  AuthDataIntegrityError,
  isBoolean,
  isDatabaseInt8,
  isNumberLike,
  isString,
  rowShape,
} from "../api/_validation.js";

const isUserIdentity = rowShape<{ id: number; username: string; active: boolean }>({
  id: isNumberLike,
  username: isString,
  active: isBoolean,
});

const isDatabaseUserIdentity = rowShape<{ id: number | string; last_login_at: number | string | null }>({
  id: isDatabaseInt8,
  last_login_at: (value): value is number | string | null => value === null || isDatabaseInt8(value),
});

test("auth row validation accepts an array of valid SQL rows", () => {
  const rows = assertRows([{ id: 7, username: "admin", active: true }], isUserIdentity, "app_users");
  assert.deepEqual(rows, [{ id: 7, username: "admin", active: true }]);
});

test("auth row validation rejects a non-array query result", () => {
  assert.throws(
    () => assertRows({ id: 7 }, isUserIdentity, "app_users"),
    (error: unknown) => error instanceof AuthDataIntegrityError && /expected an array/.test(error.message),
  );
});

test("auth row validation rejects malformed fields before they reach auth code", () => {
  assert.throws(
    () => assertRows([{ id: "7", username: "admin", active: true }], isUserIdentity, "app_users"),
    (error: unknown) => error instanceof AuthDataIntegrityError && /index 0/.test(error.message),
  );
});

test("database int8 validation accepts safe Neon number and string results", () => {
  for (const value of [1, "1", "1785673612547", -1]) {
    assert.equal(isDatabaseInt8(value), true, String(value));
  }
  const rows = assertRows(
    [{ id: "1", last_login_at: "1785673612547" }],
    isDatabaseUserIdentity,
    "app_users",
  );
  assert.deepEqual(rows, [{ id: "1", last_login_at: "1785673612547" }]);
});

test("database int8 validation rejects malformed and unsafe values", () => {
  for (const value of ["", "1.2", "not-a-number", "9007199254740992", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isDatabaseInt8(value), false, String(value));
  }
  assert.equal(isNumberLike("1"), false, "normal numeric validation must remain strict");
});
