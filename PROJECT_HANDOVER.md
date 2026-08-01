# Novora Project Handover

Updated: 2026-08-02

## Table Of Contents

1. [Source Of Truth](#source-of-truth)
2. [Quick Index](#quick-index)
3. [Application Layout](#application-layout)
4. [Permission Model](#permission-model)
5. [Sync And Data Rules](#sync-and-data-rules)
6. [Latest Update](#latest-update)
7. [Local Validation](#local-validation)
8. [Required Manual Regression Before Deploy](#required-manual-regression-before-deploy)
9. [Deployment](#deployment)
10. [Current Follow-Up Areas](#current-follow-up-areas)

## Source Of Truth

- Repository: `PikaNova/Novora`
- Active production branch: `dev`
- Current version: `2.7.1`
- Frontend: React 18, TypeScript, Vite
- API: Vercel Functions under `api/`
- Persistence: Neon PostgreSQL

Do not commit `dist/`, credentials, Neon connection strings, recovery keys, tokens, HAR authorization values, or `.test-check/` output.

## Quick Index

| Need | Primary location |
| --- | --- |
| Admin permissions and roles | `api/_auth.ts`, `src/shared/permissionRules.ts` |
| Built-in role permission contracts | `tests/builtinRoles.test.ts` |
| Exam/weekly mutation authorization | `api/_exams/permissions.ts` |
| Exam data writes and conflict response | `api/_exams/routes/examDataRoutes.ts` |
| Database integration coverage | `tests/integration/examData.integration.test.ts`, `scripts/run-integration-tests.cjs` |
| Admin page orchestration | `src/pages/AdminPage.tsx` |
| Weekly-plan UI and domain hooks | `src/components/WeeklyPanel.tsx`, `src/hooks/weekly/` |
| Weekly calendar rules and coverage | `src/utils/weeklySchedule.ts`, `tests/weeklySchedule.test.ts` |
| Client cloud sync and retry UI | `src/hooks/useExamSync.ts`, `src/components/ExamSyncAction.tsx` |
| Ghost-save conflict detection and coverage | `src/services/examOutbox.ts`, `tests/detectGhostSave.test.ts` |
| Serialized write queue | `src/services/syncQueue.ts` |
| Cross-device write throttle | `api/_exams/writeThrottle.ts`, `api/_exams/db.ts`, `tests/writeThrottle.test.ts` |
| Per-source entry rate limiting | `api/_rateLimiter.ts`, `api/exams.ts`, `tests/rateLimiter.test.ts` |
| System settings normalization | `src/utils/appSettings.ts`, `src/utils/settings/` |
| Merge and display-time utilities | `src/utils/examMerge.ts`, `src/utils/zonedTime.ts` |
| Modal and popover boundary anchoring | `src/utils/anchoredOverlay.ts`, `src/components/TimeRangePickerModal.tsx` |
| Device-management scope filtering | `src/utils/deviceScope.ts`, `src/components/DeviceStatusPanel.tsx` |
| Subject-track target scope and historical backfill | `src/utils/trackClassIds.ts`, `scripts/backfillTrackClassIds.ts` |
| Tests | `tests/`, `tsconfig.test.json` |
| Deployment/API type check | `vercel.json`, `tsconfig.api.json` |

## Application Layout

- `src/pages/AdminPage.tsx`: administrator workflow orchestrator.
- `src/components/WeeklyPanel.tsx` and `src/components/weekly/`: weekly-plan workflow.
- `src/pages/ExamPage.tsx`: classroom display.
- `src/hooks/useExamSync.ts`: client pull/push lifecycle and retry state.
- `src/services/syncQueue.ts`: debounced, serialized local write queue.
- `src/services/examService.ts`: authenticated client API and shared frontend access helpers.
- `api/exams.ts`: thin API action dispatcher.
- `api/_exams/routes/`: exam, device, plugin, and settings API handlers.
- `api/_exams/permissions.ts`: authoritative mutation permission checks.
- `api/_auth.ts`: users, roles, scopes, session validation, and audit writes.
- `src/shared/permissionRules.ts`: permissions and scope helpers shared by browser and API.

## Permission Model

- `super_admin`: wildcard permission and all-school scope.
- `grade_admin`: manages only assigned grades/classes and can delegate `class_admin` within that range. It includes `major.quick_create` so delegation is valid.
- `class_admin`: can manage weekly plans in assigned classes and create/edit/delete valid class-scoped quick temporary exams.
- `viewer`: read-only.

All new permission work must change both the UI guard and `validateMutation()` where applicable. Never trust a frontend condition alone.

### Important Recent Safeguards

- A class administrator posts a full local exam snapshot. `isolateQuickMajorCreate()` in `api/_exams/permissions.ts` retains only that actor's newly created class-scoped quick exam before permission validation. It also rebuilds an owned quick-temporary exam deletion from the server snapshot, so unrelated stale major records cannot make a valid deletion look unauthorized.
- `sanitizeStaleSnapshot()` runs before `validateMutation()` for non-all-scope accounts. It preserves only in-scope weekly-plan and class changes, restores out-of-scope records from the server, and always restores grades. This prevents stale data for other classes from causing a false 403 when a class administrator deletes a temporary exam or edits their own weekly plan.
- `computeRemovedScopeIds()` plus `examDataRoutes.ts` removes authorization scopes pointing to deleted grades/classes only after the structure update succeeds.
- Quick temporary exams can be co-managed only when the actor is their creator or the target class/grade is inside the actor's visible scope.

## Sync And Data Rules

- Database state uses optimistic `updatedAt` versions. A `409 DATA_CONFLICT` must merge or reload; do not overwrite server data blindly.
- A major-exam save may carry weekly data and vice versa. Preserve cross-domain fields when changing a payload builder.
- `max-retries` means automatic sync stopped. `ExamSyncAction` must display a visible error and allow a manual retry; it is not equivalent to ordinary pending work.
- API reads use no shared public cache. Do not reintroduce in-memory multi-instance response caching for `/api/exams`.

## Latest Update

### 2026-08-02: Ghost-Save Detection Boundary Coverage

- Added deterministic regression coverage for the sync outbox's ghost-save detector. The detector now accepts an optional clock only for unit tests and exposes a test-only named export; the production save flow continues to call it unchanged and therefore uses `Date.now()`.
- The recent-save window is intentionally inclusive at exactly 120 seconds: a remote version at `120,000ms` is accepted, while one at `120,001ms` is treated as a normal conflict. Nine tests also cover base-version advancement, equal payload contents, and absent base snapshots.
- No sync threshold, retry policy, API behavior, or user-facing behavior changed in this batch.
- Validation: `npm test` `315/315` passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-02: Per-Source Entry Rate Limiting

- Added an in-process fixed-window limiter before API route dispatch and before the database-backed global write gate. It applies a general default of 30 requests per 10 seconds and a write default of 8 POST requests per 10 seconds; both tiers are configurable with `ENTRY_RATE_LIMIT_*` environment variables.
- Sources are isolated by a SHA-256 bearer-token digest, then device `instanceId`, then the first forwarded IP or socket address. Tokens are never retained in the in-memory bucket keys. The limiter retains at most 5,000 source buckets and evicts the oldest bucket when full.
- Only true polling and heartbeat actions bypass the stricter write tier: pairing status/bootstrap, plugin-viewer heartbeat, and device heartbeat. Pairing start and confirmation remain write-limited because they change shared database state.
- Rejected requests use the existing `429 RATE_LIMITED` shape with an accurate rounded-up `Retry-After` value. The database-backed 900ms write slot remains active after the entry limiter accepts a request, so this is defense in depth rather than a replacement for cross-instance protection.
- Validation: `npm test` `306/306` passed, `npm run typecheck:api` passed, and `npm run build` passed. This limiter is per serverless instance and resets on cold start; it is not a globally consistent quota mechanism.
- Delivery: commit `30600e3 feat: add layered API rate limits` was pushed to `origin/dev` on 2026-08-02.

### 2026-08-02: Global Write Throttling

- Added a shared database-backed write slot with a 900ms minimum interval. It uses an atomic PostgreSQL `UPDATE ... WHERE ... RETURNING` against the one-row `write_throttle` table, so it applies across browser tabs, devices, and serverless instances.
- `api/exams.ts` now consumes that slot only for shared exam saves/initialization, managed-device mutations, design-policy saves, and data resets. Reads, device heartbeats, and plugin viewer heartbeats bypass it.
- A rejected write returns `429 RATE_LIMITED`, `Retry-After: 1`, a request ID, and a retryable Chinese message. The exam outbox retries this condition at 1/2/4/8 seconds; device-management writes retry once after one second and retain the server message if the retry is also limited.
- The supplied package added the table helper but did not call it from any route. The merge fixes that missing controller-level connection rather than copying its incomplete files wholesale.
- Validation: `npm test` `297/297` passed, `npm run typecheck:api` passed, and `npm run build` passed. The atomic database behavior still needs an opt-in concurrent-write test against a disposable database before relying on it as production load evidence.

### 2026-08-02: Subject-Track Scope Repair

- Formal large-exam elective items now use a shared class-scope calculation when they are created, edited in batch, or affected by a class track change. The calculation first respects the large exam's assigned grade/class scope, then applies the class's current track.
- Track changes update the major state before queueing the class save, so the resulting cloud payload cannot retain an older item scope. Quick temporary majors are deliberately excluded because their class assignment is a manual dispatch decision.
- Historical records can be inspected with `npm run backfill:track-class-ids`. It is dry-run by default, requires `BACKFILL_DATABASE_URL`, never reads `DATABASE_URL`, and requires both `--commit` and `BACKFILL_CONFIRM=novora-track-backfill` before writing. The final update uses optimistic version checking.
- Validation: `npm test` `287/287` passed, `npm run typecheck:api` passed, `npm run build` passed, and the no-database backfill guard refused safely while cleaning its temporary output.

### 2026-08-01: Device Management Scope Filtering

- Device management now derives one shared grade/class/device scope from the signed-in administrator. A grade administrator sees only their assigned grade and classes in the filters, device list, statistics, bulk actions, and design-policy selector.
- Added `src/utils/deviceScope.ts` and regression coverage for grade, class, and all-school administrator scopes. Server-side device authorization remains authoritative.
- Validation: `npm test` `280/280` passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Time Picker Boundary Anchoring

- `TimeRangePickerModal` now uses the triggering control's owning modal as a placement boundary, in addition to the browser viewport.
- The picker first opens beside its trigger, flips to the other side when needed, and clamps to a 10px safety edge when neither side has enough room. This prevents nested time selectors from escaping to the left of the workflow modal.
- Added `src/utils/anchoredOverlay.ts` and three pure positioning regression tests covering normal placement, side flipping, and constrained dialog/viewport bounds.
- Validation: `npm test` `277/277` passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Disposable Neon Permission Integration Tests

- Added an opt-in `npm run test:integration` command. It only accepts `INTEGRATION_DATABASE_URL`; it never falls back to `DATABASE_URL`, requires `INTEGRATION_TEST_CONFIRM=novora-disposable`, injects an in-process temporary admin password, and deletes its compiled output on success or failure.
- Added four real-database tests through `handleExamDataPost()`: grade/class deletion removes matching authorization scopes, stale out-of-scope snapshots cannot block or overwrite an owned quick temporary exam change, class administrators cannot alter formal exams, and concurrent writes produce one success plus one `409 DATA_CONFLICT`.
- The suite starts from a blank database using the production migration functions and real bearer-token authentication. Its final cleanup assertion verifies zero users and zero scopes, with only the required default `exam_data` row remaining.
- Validation: `npm test` `274/274` passed, `npm run test:integration` `4/4` passed against the disposable Neon database, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Weekly Schedule Test Coverage

- Added direct coverage for Shanghai date helpers, weekly cadence, A/B week selection, exclusions, official holidays, one-off cancellation and rescheduling, and weekly-plan validation.
- The replacement-override case confirms that a moved event keeps its original occurrence identity, applies the target date to an overnight end time, and carries the forced-run marker.
- This is test-only coverage. `weeklySchedule.ts`, its settings helpers, and official holiday data were already in the Node test compiler scope, so no production or configuration code changed.
- Validation: `274/274` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Merge And Display-Time Test Coverage

- Added six direct contracts for `threeWayMergeExam()`: independent edits, concurrent major additions, active-major deletion fallback, local conflict preference, optional defaults, and the remote version baseline.
- Added eight direct contracts for Shanghai display-time conversion and formatting, explicit timezone selection, invalid-time handling, and local time parsing.
- This is test-only coverage. No production merge or timezone behavior changed. `src/utils/examMerge.ts` is now explicitly included in the Node test compiler scope; `zonedTime.ts` was already included.
- Validation: `256/256` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Admin Page Utility Test Coverage

- Extended `tests/adminPageUtils.test.ts` from the existing cross-domain save regression to cover ID generation, date-time formatting/conversion, duration formatting, phase calculation, and announcement timestamp formatting.
- Time conversion tests use a round-trip assertion rather than a fixed timezone offset, so the suite is stable across developer machines and CI agents.
- No production code or test configuration changed. This batch deliberately uses ASCII test fixture values to avoid adding encoding-sensitive text assertions.
- Validation: `242/242` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Plugin And Database Helper Test Coverage

- Added direct tests for all database-free helpers in `api/_exams/plugin.ts`: hashing, constant-time hash equality guards, pairing credentials, API metadata, scope labels, and active exam projection.
- Added tests for `missingRelation()` and `updatedAtIntegerOverflow()` in `api/_exams/db.ts`, including the strict Postgres code-and-message requirement for integer-overflow recovery.
- No production code or test configuration changed. Database connection and migration behavior still needs integration coverage against a disposable PostgreSQL database.
- Validation: `225/225` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Settings Pure-Logic Test Coverage

- Extracted the existing design-policy rule sanitizer and data-reset category resolver from `api/_exams/routes/settingsRoutes.ts` without changing authorization, database writes, audit logging, or HTTP responses.
- Added pure-function coverage for design-policy normalization and reset-category cascades, plus contracts for motion, time synchronization, typography, and exam-save payload defaults.
- Route handlers still require a real database before their authorization branches can run. Full handler integration coverage needs a disposable database or injected database/auth dependencies.
- Validation: `192/192` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Built-In Role Contract Tests

- Exported `BUILTIN_ROLES` from `api/_auth.ts` for direct, database-free unit testing.
- Added role-contract coverage for the fixed built-in role IDs, valid and duplicate-free permission values, exact permission snapshots, the super-admin wildcard, and the viewer read/export-only restriction.
- Added the delegation invariant that `grade_admin` must include every `class_admin` permission. This prevents a regression of the missing `major.quick_create` permission that blocked grade administrators from delegating class-administrator accounts.
- The existing `tests/**/*.ts` test configuration automatically includes this test; retain the current `api/globals.d.ts` entry required by API test compilation.
- Validation: `171/171` tests passed, `npm run typecheck:api` passed, and `npm run build` passed.

### 2026-08-01: Class Administrator Delete And Stale Snapshot Fix

- Fixed false `403 PERMISSION_DENIED` responses when a class administrator deleted their own quick temporary exam while the browser held stale weekly-plan data for another class.
- Extended quick-major isolation to reconstruct an owned temporary-exam deletion from the authoritative server major list.
- Added scope-aware snapshot sanitization for weekly plans, classes, and grades before permission diffs are calculated. It preserves valid in-scope changes while replacing unrelated stale data with the current server value.
- Added regression tests for temporary-exam deletion isolation, class-admin weekly-plan isolation, and grade-admin class edits. Full validation after merge: tests, API type check, and production build.

### 2026-08-01: Full Update Package Merge

- Added `major.quick_create` to the grade administrator built-in role. Grade administrators can now delegate the class administrator role without violating the permission-subset rule.
- Added post-save scope cleanup. Deleting a grade or class also deletes the corresponding orphaned `app_user_scopes` entries.
- Extracted and tested the rules used to co-manage quick temporary exams. A creator or an administrator whose visible grade/class matches the target may manage the quick exam; formal exams remain protected by normal permissions.
- Added a dedicated `max-retries` sync state presentation with an alert icon, visible failure reason, attention animation, and manual retry action.
- Added pure-logic tests for user management access, temporary-exam ownership, orphan-scope detection, and sync status.
- Fixed `.js` ESM specifiers in app-settings runtime dependencies so Node/Vercel test output resolves correctly.
- Added API compile-time global declarations for build metadata and restored `typecheck:api` validation.

### Merge Note

The provided package contained corrupted text in two page-level refactor files. Those files were not copied over wholesale. Functional changes were reapplied to the current source so the already-fixed class-administrator 403 write path remained intact.

## Local Validation

```bash
npm test
npm run test:integration
npm run build
npm run typecheck:api
```

The test suite is compiled with `tsconfig.test.json` to `.test-check/`, then executed with Node. Keep runtime ESM imports in test-covered modules explicit (`.js`) when required by emitted Node code.

`npm run test:integration` is deliberately separate from the offline suite. It requires an empty, disposable Neon database configured as `INTEGRATION_DATABASE_URL` and the explicit environment value `INTEGRATION_TEST_CONFIRM=novora-disposable`. Never point it at production or allow it to fall back to `DATABASE_URL`.

## Required Manual Regression Before Deploy

1. Super admin: create/edit/delete a formal major exam; create grade/class; manage a user.
2. Grade admin: manage only assigned grades; create a class admin; verify other grades remain inaccessible.
3. Class admin: publish a temporary unified exam for an assigned class, then edit/delete it; create/edit a weekly plan for that class; verify another class is denied.
4. Remove a class or grade and confirm a user previously scoped only to it no longer carries a stale scope.
5. Simulate a failed sync and confirm the display changes to the manual-retry state after automatic retries are exhausted.
6. Verify a fresh device/browser reads a recently saved grade/class/exam without a manual refresh.
7. With two signed-in devices, save a change from each within one second. Confirm one response receives `429 RATE_LIMITED`, the pending exam save retries automatically, and a device-management write either succeeds after its one retry or shows the server message.
8. On a staging deployment, issue a 30-request read burst and a 9-request write burst from the same source. Confirm the next request in each tier returns `429 RATE_LIMITED` with a nonzero `Retry-After`, while device/plugin heartbeats continue normally.

## Deployment

Push only verified commits to `dev`; Vercel is configured to deploy that branch. In Vercel, confirm the new deployment references the expected `dev` commit before checking production. Investigate API failures using Vercel request IDs and logs; never upload secrets or authorization headers to issue trackers.

## Current Follow-Up Areas

- Configure the disposable Neon integration command as a protected CI job using test-only secrets; do not run it on untrusted pull requests.
- Extend database integration coverage to user-management routes, device bindings, reset-data behavior, and failure/rollback behavior.
- Add an opt-in disposable-database concurrency test that invokes the top-level API handler twice and proves exactly one global write slot is granted in a 900ms window.
- Add a staging smoke script for per-source entry-rate-limit thresholds because serverless cold starts and multiple instances cannot be represented by the unit tests.
- Add React-level tests for critical administrator forms once jsdom and React Testing Library are introduced.
- Keep the AdminPage and settings/weekly refactors incremental; validate each extraction with build and behavior tests before merging another package.

## Handover Maintenance Rule

Every project update must also update this document before handoff. Add a dated entry to **Latest Update**, revise affected Quick Index entries, and keep the validation result current. Deliver this file together with any source package or pushed revision.
