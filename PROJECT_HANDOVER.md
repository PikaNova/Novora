# Novora Project Handover

Updated: 2026-08-01

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
| Admin page orchestration | `src/pages/AdminPage.tsx` |
| Weekly-plan UI and domain hooks | `src/components/WeeklyPanel.tsx`, `src/hooks/weekly/` |
| Weekly calendar rules and coverage | `src/utils/weeklySchedule.ts`, `tests/weeklySchedule.test.ts` |
| Client cloud sync and retry UI | `src/hooks/useExamSync.ts`, `src/components/ExamSyncAction.tsx` |
| Serialized write queue | `src/services/syncQueue.ts` |
| System settings normalization | `src/utils/appSettings.ts`, `src/utils/settings/` |
| Merge and display-time utilities | `src/utils/examMerge.ts`, `src/utils/zonedTime.ts` |
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
npm run build
npm run typecheck:api
```

The test suite is compiled with `tsconfig.test.json` to `.test-check/`, then executed with Node. Keep runtime ESM imports in test-covered modules explicit (`.js`) when required by emitted Node code.

## Required Manual Regression Before Deploy

1. Super admin: create/edit/delete a formal major exam; create grade/class; manage a user.
2. Grade admin: manage only assigned grades; create a class admin; verify other grades remain inaccessible.
3. Class admin: publish a temporary unified exam for an assigned class, then edit/delete it; create/edit a weekly plan for that class; verify another class is denied.
4. Remove a class or grade and confirm a user previously scoped only to it no longer carries a stale scope.
5. Simulate a failed sync and confirm the display changes to the manual-retry state after automatic retries are exhausted.
6. Verify a fresh device/browser reads a recently saved grade/class/exam without a manual refresh.

## Deployment

Push only verified commits to `dev`; Vercel is configured to deploy that branch. In Vercel, confirm the new deployment references the expected `dev` commit before checking production. Investigate API failures using Vercel request IDs and logs; never upload secrets or authorization headers to issue trackers.

## Current Follow-Up Areas

- Add an integration test against a disposable Neon database for scope deletion and permission-protected writes.
- Add React-level tests for critical administrator forms once jsdom and React Testing Library are introduced.
- Keep the AdminPage and settings/weekly refactors incremental; validate each extraction with build and behavior tests before merging another package.

## Handover Maintenance Rule

Every project update must also update this document before handoff. Add a dated entry to **Latest Update**, revise affected Quick Index entries, and keep the validation result current. Deliver this file together with any source package or pushed revision.
