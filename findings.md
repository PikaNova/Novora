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

## Ghost-Save Boundary Coverage

- `detectGhostSave()` accepts an optional `now` value strictly for deterministic unit testing; the production caller still passes only the pending payload and remote payload, so it continues to use `Date.now()`.
- The detector's existing recent-save window remains inclusive at exactly 120,000ms because the rejection condition remains `age > 120_000`, not `>=`.
- `tests/detectGhostSave.test.ts` adds nine contracts for the valid window, exact and just-over boundaries, base-version progression, content equality, and an absent base snapshot.
- Validation after merge: `npm test` `315/315` passed, `npm run typecheck:api` passed, and `npm run build` passed.
- This batch changes no synchronisation threshold, retry behavior, server response, or production save flow.

## Latest Remote Delivery

- The validated aggregate change set was committed as `592fe3d test: expand coverage and protect scoped writes`.
- `origin/dev` advanced from `4b2d65b` to `592fe3d` successfully.

## Disposable Neon Integration-Test Plan

- The real write path is `handleExamDataPost()`: it loads the current `exam_data` row, applies `isolateQuickMajorCreate()` and `sanitizeStaleSnapshot()`, calls `validateMutation()`, writes with optimistic `updated_at`, then removes obsolete `app_user_scopes` rows through `authSql()`.
- `ensureTableOnce()` and `ensureAuthTables()` are idempotent and can prepare a blank database. Route tests can use a minimal Vercel request/response double and real bearer tokens from the auth module.
- No `INTEGRATION_DATABASE_URL`, `DATABASE_URL`, `NEON_API_KEY`, or `NEON_PROJECT_ID` is configured locally. Integration execution is intentionally blocked rather than risking a production connection.
- Recommended isolation is an opt-in `INTEGRATION_DATABASE_URL` that points only to a fresh Neon branch from an empty test parent. A later CI automation may create/delete that branch using restricted `NEON_API_KEY` and project/parent-branch identifiers. Never branch from production because Neon branches clone data.
- The integration command must reject absent credentials and reject a URL not explicitly marked as integration-only. It must be separate from `npm test` so unit tests remain offline and deterministic.

## Disposable Neon Integration-Test Results

- The supplied database was reachable and empty before test setup: no `exam_data` or `app_users` tables existed.
- `tests/integration/examData.integration.test.ts` invokes `handleExamDataPost()` with real bearer-token authentication and production migrations. It covers scope cleanup, stale snapshot sanitization plus owned quick-major isolation, forbidden formal-major writes, and optimistic concurrency.
- `scripts/run-integration-tests.cjs` requires `INTEGRATION_DATABASE_URL` and `INTEGRATION_TEST_CONFIRM=novora-disposable`, never accepts `DATABASE_URL` as fallback, generates a process-only admin password, and clears `.integration-check` through `finally` on both success and failure.
- Final result: `4/4` integration tests passed in approximately 83 seconds. The database cleanup assertion passed: `app_users` and `app_user_scopes` are empty, and `exam_data` contains only its default row.
- Full regression after the change: `274/274` unit tests, API type check, and production build passed.

## Subject-Track Delivery Diagnosis

- Live API inspection confirmed `initialization.subjectTrackModeEnabled` is `true` and the screenshot's class 5 has `track: ['历史', '化学', '地理']`.
- The active large exam stores item-level `targetClassIds` for every elective. Both `思想政治` and `生物` contain class 5, even though neither belongs to its current track.
- This is a historical-scope problem: batch creation materializes the matching classes at that moment. If tracks are set or changed later, the old item scopes remain.
- `resolveEffectiveSchedule()` intentionally treats a non-empty `item.targetClassIds` as authoritative and skips its legacy/current-track fallback. Consequently stale generated targets override live class track data.
- A repair must distinguish auto-generated subject-track scopes from deliberately manual per-item targeting. Blindly re-filtering all `targetClassIds` would break explicit class-level exams.

## Subject-Track Scope Repair

- `src/utils/trackClassIds.ts` is now the shared implementation for calculating formal large-exam elective-item `targetClassIds`. It respects the large exam's manually selected grade/class scope, then filters classes by their current track.
- Class-track edits use that shared helper before `commitWeekly()` queues its write. This ordering is required: the serialized payload now includes both the new class track and recomputed formal-major items, rather than writing a stale major snapshot.
- Quick temporary majors are explicitly excluded from recomputation. Their class scope is a manual dispatch choice held on the major itself and must never be replaced by track logic.
- `scripts/backfillTrackClassIds.ts` repairs pre-existing formal-major snapshots only through `npm run backfill:track-class-ids`. It requires an explicit `BACKFILL_DATABASE_URL`; `--commit` also requires `BACKFILL_CONFIRM=novora-track-backfill`, uses an optimistic `updated_at` condition, and never falls back to `DATABASE_URL`.
- Validation after merge: `287/287` unit tests, API type check, and production build passed. The no-credential command test confirmed a safe refusal and removal of `.backfill-check`.

## Time Picker Boundary Anchoring

- The nested `TimeRangePickerModal` is rendered through a document-body portal. Its original placement considered only the viewport, so a control inside a workflow modal could open the nested picker outside that modal's visual boundary.
- `resolveAnchoredOverlayPosition()` intersects the viewport and owning-dialog bounds, opens on the side with more room, flips where necessary, and clamps to a 10px safety edge.
- `TimeRangePickerModal` captures the triggering element's closest `.admin-modal` or parent `.time-range-modal` and supplies that rectangle as the placement boundary. Standalone callers still fall back to the viewport.
- `tests/anchoredOverlay.test.ts` covers normal right placement, left-side flip, and a constrained viewport/dialog. Validation after the change: `277/277` tests, API type check, and production build passed.

## Device Management Scope Filtering

- `DeviceStatusPanel` calculated scoped grade/class options but still fed the global grade/class lists into the grade dropdown, class picker, design-policy manager, device statistics, and bulk operation targets. A grade administrator could therefore see an unrelated grade even though server-side actions remained scoped.
- `src/utils/deviceScope.ts` now centralizes the visible grades, classes, and device-group membership for all-scope, grade-scope, and class-scope administrators. `DeviceStatusPanel` uses that one resolved scope everywhere it renders or selects devices.
- `tests/deviceScope.test.ts` protects the grade-admin, class-admin, and all-scope paths. Validation after the change: `280/280` tests, API type check, and production build passed.

## Latest Source Delivery

- Source archive: `C:\\Users\\Administrator\\Documents\\Codex\\2026-07-23\\nihao-2\\deliveries\\novora-v2.7.1-dev-local-20260801-device-scope-source.zip`.
- The archive contains 1,280 structured source entries, including `PROJECT_HANDOVER.md`, the device-scope utility, its tests, and the updated device panel.
- Archive validation confirmed no Git metadata, dependency directories, generated build/test output, environment files, HAR captures, or log files.

## Global Write-Throttle Merge

- The supplied package created the `write_throttle` table and `acquireGlobalWriteSlot()` helper, but its copied exam/device route files were byte-identical to the current routes. No request could acquire a slot or return `429`, so wholesale merging would have delivered an inert feature.
- The repaired implementation uses `api/_exams/writeThrottle.ts` as a pure controller-level action classifier. It throttles only known shared-state mutations: default exam saves, initialization, device binding/setup/role/command/revoke, design-policy saves, and reset-data.
- `api/exams.ts` calls `ensureTableOnce()` and then `acquireGlobalWriteSlot()` before dispatching a classified mutation. The slot update is atomic across serverless instances. A rejection uses the typed `sendRateLimited()` response with `Retry-After: 1`, `RATE_LIMITED`, `retryable: true`, and a request ID.
- Device and viewer heartbeats are deliberately excluded. They are frequent status traffic and must not be delayed by administrator data saves. Plugin pairing and polling are also excluded from this change because the supplied package did not establish their intended concurrency behavior.
- The exam outbox retries `RATE_LIMITED` after 1/2/4/8 seconds. Device writes perform one delayed retry and preserve the API's final message. This reduces ordinary two-device collisions without hiding persistent failures.
- Validation: `297/297` unit tests, API type check, and production build passed. Unit tests cover classification, error mapping, retry tiers, and device retry behavior. They cannot prove database-level cross-instance atomicity; add an opt-in disposable-database concurrent handler test before treating the throttle as load-tested.

## Entry Rate-Limiter Merge

- The supplied `api/exams.ts` removed the current imports and call site for `acquireGlobalWriteSlot()`. It must not replace the dispatcher because it would downgrade multi-instance write protection to a per-instance memory counter.
- `api/_rateLimiter.ts` is now a separate, preceding defensive layer. It enforces a source-specific fixed window for every request and a stricter window for non-exempt POST actions. The default limits are 30 requests/10 seconds and 8 writes/10 seconds, with four `ENTRY_RATE_LIMIT_*` environment settings for deployment tuning.
- Bearer tokens are SHA-256 hashed before becoming memory keys. Key derivation then falls back to a bounded device ID or IP. Bucket capacity is bounded to 5,000 entries by evicting the oldest entry rather than clearing every active counter.
- The entry response uses the shared rate-limit formatter, but now passes the actual remaining fixed-window duration as `Retry-After`. Existing database-gate responses retain the default one-second header.
- Heartbeats and pair-status/bootstrap polling bypass only the entry write tier; pairing start and confirmation remain limited because they write pairing state. The general tier still applies to every request.
- Validation: `306/306` unit tests, API type check, and production build passed. Unit coverage establishes local fixed-window semantics, safe configuration/key behavior, and exemptions. It cannot establish Vercel's cross-instance behavior, so retain the database gate and perform a staging request-burst smoke test.

## Latest Remote Delivery

- Commit `30600e3 feat: add layered API rate limits` was pushed successfully to `origin/dev` on 2026-08-02.
- The commit contains the current accumulated validated work: subject-track scope repair and guarded backfill support, time-picker boundary anchoring, device scope filtering, database-backed global write throttling, per-source entry limiting, integration-test infrastructure, test coverage, and updated handoff records.
