import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRows,
  AuthDataIntegrityError,
  isBoolean,
  isNumberLike,
  isString,
  rowShape,
} from "../api/_validation.js";

const isUserIdentity = rowShape<{ id: number; username: string; active: boolean }>({
  id: isNumberLike,
  username: isString,
  active: isBoolean,
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
