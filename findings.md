# Findings

## Current Repository State

- Working branch: `dev`
- Last remote commit before this patch: `4b2d65b fix: strengthen permissions and sync feedback`
- Uncommitted files for the active patch:
  - `api/_exams/permissions.ts`
  - `api/_exams/routes/examDataRoutes.ts`
  - `tests/exams.permissions.test.ts`
  - `tsconfig.test.json`
  - `PROJECT_HANDOVER.md`

## Root Cause

Class and grade administrators submit a complete cached school snapshot. A class administrator deleting an owned quick temporary exam could include stale `weeklyPlans`, `classes`, or `grades` from unrelated scopes. Permission diffing interpreted those unrelated differences as unauthorized changes and returned 403 for the entire request.

## Implemented Safeguards

- `isolateQuickMajorCreate()` now also reconstructs the deletion of an actor-owned quick temporary exam from server-side majors.
- `sanitizeStaleSnapshot()` restores all out-of-scope weekly plans and classes from the current server payload before `validateMutation()` runs.
- For non-all-scope users, grades always come from the current server payload.
- Grade administrators retain allowed class changes inside their assigned grades. Class administrators retain allowed weekly-plan changes inside their assigned classes.

## Risks And Constraints

- All permission decisions remain server-side. Frontend visibility is not an authorization boundary.
- The payload is a full snapshot, so mutations that add new cross-domain fields must be considered by both snapshot sanitization and `validateMutation()`.
- Never replace current permission modules wholesale from an external patch when it overlaps newer commits.
- Do not commit generated `dist/`, `.test-check/`, `.api-check/`, `node_modules/`, or secrets.

## Builtin Role Test Package

- `novora-builtin-roles-test.zip` contains an export-only change to `api/_auth.ts`, one new direct unit test, a redundant test-config copy, and a handover-document copy that predates the current local deletion fix.
- The existing `tests/**/*.ts` include already covers the new test. Preserve the current `api/globals.d.ts` inclusion in `tsconfig.test.json`.
- Directly testing `BUILTIN_ROLES` is database-free and protects the role IDs, valid permission names, duplicate-free sets, exact privilege snapshots, viewer read/export restriction, and the grade-admin-to-class-admin delegation subset invariant.

## Validation

- Full unit suite passed: `171/171` tests, including the new nine built-in-role contract cases.
- `npm run typecheck:api` passed.
- `npm run build` passed.
- The test runner intentionally logs a malformed-localStorage parsing warning while verifying recovery behavior; its corresponding test passed and it is not a failure.
- The incoming archive plus generated `.test-check/`, `.api-check/`, and `dist/` directories were removed after validation; no generated artifacts remain to be committed.

## Delivery Artifacts

- Source archive: `C:\Users\Administrator\Documents\Codex\2026-07-23\nihao-2\deliveries\novora-v2.7.1-dev-local-20260801-source.zip`.
- Standalone handover archive: `C:\Users\Administrator\Documents\Codex\2026-07-23\nihao-2\deliveries\novora-v2.7.1-dev-local-20260801-handover.zip`.
- Packaging excludes Git metadata, dependencies, generated output, caches, local environment files, and log/temp files. Archive listings were opened successfully after creation.

## Settings Test Coverage Package

- The route change is behavior-preserving: it extracts the existing design-policy normalization and reset-category flag calculation into exported pure functions, after which the handlers call them at their original positions.
- The incoming test and documentation comments contain mojibake. Merge only the executable logic and reproduce tests with clean ASCII comments; do not copy corrupted text.
- `settingsRoutes.test.ts` adds 16 pure-logic cases. `settingsModules.test.ts` adds default-value and payload-shape contracts for motion, time-sync, typography, and save-payload settings modules.
- The four settings source modules must be added to `tsconfig.test.json`; route compilation follows from the test's direct import and existing API dependency entries.
- `buildExamSaveInput` reaches the telemetry module through `examService`. Its Node test sets `__APP_VERSION__` and `__COMMIT_SHA__` before dynamically importing the module, matching Vite-provided production constants without changing application code.
- Validation after merge: `192/192` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.
- The incoming extraction and generated `.test-check/`, `.api-check/`, and `dist/` directories were removed after validation.

## Plugin And Database Test Coverage Package

- The supplied package changes only test files and handover documentation; current `api/_exams/plugin.ts` and `api/_exams/db.ts` remain untouched.
- The supplied test source has mojibake in comments and fixture/expected strings, including syntax-damaging text. Recreate tests with ASCII fixture values and semantic assertions instead of copying those strings.
- Coverage targets are pure helpers only: plugin hashing, credential parsing, metadata, labels, effective-exam filtering, and database error classifiers. Database connection/migration functions remain integration-test work.
- Clean replacement tests cover 23 plugin-helper cases and 10 database-error-classifier cases. They use project-valid local date-time strings rather than UTC `toISOString()` values, because plugin schedule parsing expects local time strings.
- Validation after merge: `225/225` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.
- The incoming archive extraction and generated `.test-check/`, `.api-check/`, and `dist/` directories were removed after validation.

## Current Delivery Request

- Package the current `dev` working tree, including validated but uncommitted changes and the current handover document.
- Use new archive names so the prior 171-test delivery remains available for comparison.
- Source archive has 399 entries, contains the handover and AdminPage utility test, and contains no excluded dependency or generated-output directory.

## Admin Page Utility Test Package

- Scope is test-only coverage for `src/hooks/admin/adminPageUtils.ts`; production helper behavior and `tsconfig.test.json` should remain unchanged.
- Time conversion assertions must avoid hard-coded timezone offsets. Use round-trip or format-shape contracts for `toISO()` and `toLocalInput()`.
- The current `tests/adminPageUtils.test.ts` already covers `syncMajorStateRef`; append 17 cases for the other utility helpers rather than overwriting that regression test.
- Validation after merge: `242/242` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.
- The incoming archive extraction and generated `.test-check/`, `.api-check/`, and `dist/` directories were removed after validation.

## Exam Merge And Zoned Time Test Coverage

- The package is test-only: `tests/examMerge.test.ts`, `tests/zonedTime.test.ts`, the `src/utils/examMerge.ts` test compiler entry, and older handover text. The current handover was retained and extended instead of being overwritten.
- The 6 merge tests cover independent changes, concurrent additions by id, active-major fallback after deletion, local precedence for a true conflict, optional-field defaults, and the remote `updatedAt` baseline.
- The 8 timezone tests use a fixed UTC instant and check Shanghai conversion, explicit zone selection, formatting, invalid input handling, and local time parsing. They use ISO-local input without a trailing `Z`, matching `parseZonedTime()`.
- Validation after merge: `256/256` tests passed, `npm run typecheck:api` passed, and `npm run build` passed. The test runner logs intentional localStorage recovery warnings during existing settings tests; all affected tests passed.

## Weekly Schedule Test Coverage

- The supplied package is test-only: one weekly-schedule test file and an older handover copy. Existing source/configuration remained intact because `weeklySchedule.ts`, `settings/weekly.ts`, and `officialHolidays.ts` were already test-compiled.
- The package description says 19 tests, but its source contains 18 `test()` blocks. All 18 were added, covering date boundaries, cadence, A/B weeks, exclusions, holidays, cancel/replace overrides, default plan construction, and structural validation.
- Validation after merge: `274/274` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.

## Latest Delivery Artifacts

- Source archive: `C:\Users\Administrator\Documents\Codex\2026-07-23\nihao-2\deliveries\novora-v2.7.1-dev-local-20260801-274-tests-source.zip`.
- Standalone handover archive: `C:\Users\Administrator\Documents\Codex\2026-07-23\nihao-2\deliveries\novora-v2.7.1-dev-local-20260801-274-tests-handover.zip`.
- The source archive has 473 structured entries, includes the weekly-schedule test and handover, and excludes `.git`, `node_modules`, generated build/test output, npm caches, temporary directories, environment files, and logs.
