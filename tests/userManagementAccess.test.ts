import assert from "node:assert/strict";
import test from "node:test";
import {
  computeUserManagementPermissionFlags,
  computeUserManagementScopeAccess,
} from "../src/services/userManagementAccess.js";

const gradeAdminPermissions = [
  "major.quick_create",
  "user.read",
  "user.create",
  "user.edit",
  "user.reset_password",
  "user.delete",
];
const grades = [{ id: "g1", name: "Grade 1", order: 0, enabled: true }];
const classes = [{ id: "c1", gradeId: "g1", name: "Class 1", order: 0, enabled: true }];
const roles = [
  { id: "class_admin", permissions: ["major.quick_create"] },
  { id: "super_admin", permissions: ["*"] },
];

test("grade admin can delegate class admin after receiving quick create", () => {
  const current = {
    permissions: gradeAdminPermissions,
    scopes: [{ type: "grade" as const, gradeId: "g1", classId: "" }],
  };
  const access = computeUserManagementScopeAccess(current, roles, grades, classes);
  assert.deepEqual(access.delegableRoles.map((role) => role.id), ["class_admin"]);
  assert.deepEqual(access.visibleClasses.map((item) => item.id), ["c1"]);
});

test("user management flags use the shared permission implementation", () => {
  const flags = computeUserManagementPermissionFlags({ permissions: ["*"], scopes: [] });
  assert.equal(Object.values(flags).every(Boolean), true);
  assert.equal(
    Object.values(computeUserManagementPermissionFlags(null)).some(Boolean),
    false,
  );
});
