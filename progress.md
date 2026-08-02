# Progress

## 2026-08-01

### Completed

- Inspected and selectively merged `novora-delete-exam-fix.zip`.
- Added deletion isolation for owned quick temporary majors.
- Added scope-aware stale snapshot sanitization before backend permission validation.
- Added regression coverage for deletion isolation, class-admin weekly-plan isolation, and grade-admin class editing.
- Updated `PROJECT_HANDOVER.md` with a dated change entry and safeguard notes.

### Validation

- Test suite: `162/162` passed.
- API type check/import: passed.
- Vite production build: passed.
- `git diff --check`: passed.

### Pending

- The patch is not committed or pushed. Wait for an explicit commit/push request.

### Latest Completed

- Inspected and merged `novora-builtin-roles-test.zip` without overwriting the newer handover and test-config edits.
- Exported `BUILTIN_ROLES` and added direct role-contract coverage.
- Validation passed: `171/171` tests, API type check, and production build.
- Removed temporary archive extraction, test output, API output, and build output directories.
- Created clean current-source and standalone-handover archives. The source archive contains 395 entries and no forbidden generated/dependency directories; both archives were re-opened successfully for integrity checks.
- Inspected `novora-settings-test-coverage.zip`; its executable route refactor is compatible, while its Chinese comment/document text is encoding-corrupted and will not be copied.
- Merged P1 settings coverage: 16 settings-route pure-logic tests and 5 settings-module contract tests.
- Validation passed: `192/192` tests, API type check, and production build.
- Removed the incoming archive extraction plus generated test, API-check, and build directories.
- Inspected and merged `novora-examMerge-zonedTime-test-coverage.zip` as test-only coverage.
- Added six `threeWayMergeExam()` contracts and eight `zonedTime` contracts; explicitly included `src/utils/examMerge.ts` in `tsconfig.test.json`.
- Updated `PROJECT_HANDOVER.md` with the new quick index entry and latest-update validation record.
- Validation passed: `256/256` tests, API type check, and production build.
- Inspected and merged `novora-weeklySchedule-test-coverage.zip` as a test-only change.
- Added the supplied 18 weekly-calendar test blocks; the package description said 19, but the source contained 18.
- Updated the handover quick index and latest-update record for weekly schedule coverage.
- Validation passed: `274/274` tests, API type check, and production build.
- Packaged the current `274/274` validated working tree and standalone handover as new delivery archives.
- Re-opened the archives and confirmed the source package has 473 structured entries, includes `tests/weeklySchedule.test.ts` and `PROJECT_HANDOVER.md`, and excludes dependencies, Git metadata, caches, and generated output.
- Committed the validated aggregate change set as `592fe3d test: expand coverage and protect scoped writes`.
- Pushed `592fe3d` to `origin/dev` successfully.
- Completed the database-integration test design pass. The real authenticated write path and migration entry points are identified, but execution is blocked because no isolated Neon/database credentials are configured locally.
- Next prerequisite: an `INTEGRATION_DATABASE_URL` for a disposable, non-production Neon branch, or restricted Neon API credentials that can create and remove such a branch.
- Implemented the protected `test:integration` command and real route-level Neon coverage for scope deletion, stale snapshots/owned quick exams, formal-exam authorization, and optimistic write conflicts.
- Integration validation passed: `4/4` against the user-supplied blank disposable Neon database. The suite's cleanup assertion confirmed no test users or scopes remain and only the default exam row remains.
- Full regression passed: `274/274` unit tests, API type check, and production build.
- Packaged the latest source and standalone handover after all current test coverage updates; archive validation confirmed 399 source entries and no generated/dependency directories.
- Inspected `novora-adminpageutils-test-coverage.zip`; it is compatible as a test-only addition and will extend the existing `syncMajorStateRef` test.
- Added 17 AdminPage utility tests without changing production code or test configuration.
- Validation passed: `242/242` tests, API type check, and production build.
- Removed the incoming archive extraction plus generated test, API-check, and build directories.
- Inspected `novora-plugin-db-test-coverage.zip`; it adds no production-code changes, but its encoding-corrupted test literals require a clean equivalent test implementation.
- Added clean plugin and database helper test coverage without changing production code.
- Validation passed: `225/225` tests, API type check, and production build.
- Removed the incoming archive extraction plus generated test, API-check, and build directories.

### Workflow Note

For every later turn, read `task_plan.md`, `findings.md`, and this file before performing new work. Update all three after each completed phase.

### 2026-08-02: Ghost-Save Detection Boundary Coverage

- Selectively merged the supplied boundary-test package without copying its stale process documents over the current project history.
- `detectGhostSave()` now accepts an optional clock for deterministic tests and is exported through `__detectGhostSaveForTests`; the production call remains unchanged and still uses the real clock by default.
- Added nine regression tests covering the 119-second, exact 120-second inclusive, and 120.001-second rejection boundaries, plus version, content, and missing-base cases.
- Validation passed: `315/315` tests, API type check, and production build.
- Delivered as commit `44b53f3 test: cover ghost save boundaries`, pushed to `origin/dev`.
- Exported both a clean latest-source archive and a standalone `PROJECT_HANDOVER.md` archive. Archive checks confirmed the source includes the new ghost-save test and handover while excluding Git metadata, dependencies, generated output, caches, local environment files, HAR captures, and logs.

### 2026-08-02: Six-Model Quality Review Consolidation

- Consolidated six external reports without modifying application code or deployment state.
- Verified the repeated user-list permission projection bug, unscoped audit-log read, pre-auth global-write-slot consumption, and non-canonical ghost-save object comparison.
- Recorded conditional and false-positive findings separately so future work prioritizes evidence-backed changes.
- Removed the temporary report extraction after the review. No commit or push was requested.

### Latest Diagnosis

- Investigated the report that large exams still ignore subject tracks using the deployed API and the current delivery code.
- The subject-track feature is enabled and class 5 is correctly saved as 历史+化学+地理.
- The active exam's political-science and biology items still contain class 5 in their persisted `targetClassIds`. Those scopes were generated before the class track changed and now override the current class metadata during schedule resolution.
- No production data or code was changed during diagnosis. The next repair must preserve explicit manual class targets while allowing auto-generated track targets to follow current class tracks.

### Latest Completed

- Repaired the nested time-range picker placement reported in the administration workflow.
- Added owner-modal-aware boundary anchoring and pure placement tests for right placement, automatic left flip, and constrained screen/dialog bounds.
- Validation passed: `277/277` tests, API type check, and production build.
- Removed generated `.test-check/`, `.api-check/`, and `dist/` output after validation.
- Repaired device-management scope visibility: grade and class filters, device rows/statistics, bulk-removal targets, and design-policy inputs now use the current administrator's shared scope instead of global school lists.
- Added scope tests for grade administrators, class administrators, and all-school administrators.
- Validation passed: `280/280` tests, API type check, and production build.
- Packaged the current working tree, including uncommitted validated changes, as `novora-v2.7.1-dev-local-20260801-device-scope-source.zip`.
- Archive validation passed: 1,280 entries; required handover/device-scope files present; excluded dependency, build, test-output, environment, HAR, and log entries absent.
- Repaired subject-track delivery for formal large exams. The shared target-scope helper is used by single-item editing, batch creation, and class-track updates; quick temporary major exams remain excluded because their scope is manually dispatched.
- Added a guarded historical backfill command with explicit database and commit confirmations plus optimistic concurrency protection.
- Validation passed: `287/287` tests, API type check, and production build. The backfill command safely rejects a missing dedicated database URL and cleans its temporary output.

### 2026-08-02: Global Write-Throttle Merge

- Inspected `novora-v2.7.1-dev-local-20260801-write-throttle-source.zip` and found its new database slot helper was never called by the copied routes, so it would not have throttled any request.
- Added `write_throttle` migration/seed and an atomic 900ms global slot helper. Connected it at the `api/exams.ts` dispatcher for formal shared-state writes only; reads and heartbeat traffic remain unthrottled.
- Added `429 RATE_LIMITED` responses with request ID and retry header, an outbox 1/2/4/8-second retry tier, and one automatic device-write retry with final server message preservation.
- Added ten regression tests for action coverage, error behavior, outbox retry timing, and device retry behavior.
- Validation passed: `297/297` tests, API type check, and production build. A true concurrent database-slot test remains pending against an explicitly isolated database; no production credential or database was used.

### 2026-08-02: Per-Source Entry Rate-Limiter Merge

- Inspected `novora-v2.7.1-dev-local-20260801-entry-ratelimit-source.zip`. Its dispatcher patch would have removed the existing database-backed global write slot, so it was merged selectively rather than copied.
- Added a hardened in-memory source limiter before route dispatch and retained the database gate after it. General limits default to 30 requests/10 seconds; non-exempt POST limits default to 8 requests/10 seconds. Both are configurable through `ENTRY_RATE_LIMIT_*` variables.
- Token-derived keys are SHA-256 hashes, bucket memory is capped through oldest-entry eviction, and `Retry-After` now reflects the remaining entry window. Only actual polling/heartbeats bypass the write tier; pairing creation and confirmation remain protected writes.
- Added nine regression tests for thresholds, reset timing, retry duration, bounded storage, configuration, hashed keys, source fallback, and action exemptions.
- Validation passed: `306/306` tests, API type check, and production build. Remaining production-only work is a staging burst test and multi-instance observation; no production database or credentials were used.

### 2026-08-02: Remote Delivery

- Committed the accumulated validated changes as `30600e3 feat: add layered API rate limits`.
- Pushed `30600e3` successfully to `origin/dev`.

### 2026-08-02: P0 User Visibility And Audit Scope

- Merged the first two P0 fixes from `users-permission-fix-2026-08-02.zip` without overwriting the newer external-quality-review documentation.
- User-list filtering now retains permissions internally while enforcing both delegable-permission and grade/class scope checks, then strips permissions only from the public DTO.
- Audit reads retain the `audit.read` permission requirement and now additionally require wildcard permission or all-school scope, because legacy audit records cannot be safely scoped by grade/class.
- Added nine regression tests in `tests/users.visibility.test.ts` and compiled `api/users.ts` through `tsconfig.test.json`.
- Validation passed: `324/324` tests, API type check, and production build.
- Delivered as commit `9b9593f fix: enforce scoped user visibility`, pushed successfully to `origin/dev`.
