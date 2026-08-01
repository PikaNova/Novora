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
| Exam/weekly mutation authorization | `api/_exams/permissions.ts` |
| Exam data writes and conflict response | `api/_exams/routes/examDataRoutes.ts` |
| Admin page orchestration | `src/pages/AdminPage.tsx` |
| Weekly-plan UI and domain hooks | `src/components/WeeklyPanel.tsx`, `src/hooks/weekly/` |
| Client cloud sync and retry UI | `src/hooks/useExamSync.ts`, `src/components/ExamSyncAction.tsx` |
| Serialized write queue | `src/services/syncQueue.ts` |
| System settings normalization | `src/utils/appSettings.ts`, `src/utils/settings/` |
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

- A class administrator posts a full local exam snapshot. `isolateQuickMajorCreate()` in `api/_exams/permissions.ts` retains only that actor's newly created class-scoped quick exam before permission validation. This prevents unrelated stale exams from being interpreted as unauthorized `major.create` changes.
- `computeRemovedScopeIds()` plus `examDataRoutes.ts` removes authorization scopes pointing to deleted grades/classes only after the structure update succeeds.
- Quick temporary exams can be co-managed only when the actor is their creator or the target class/grade is inside the actor's visible scope.

## Sync And Data Rules

- Database state uses optimistic `updatedAt` versions. A `409 DATA_CONFLICT` must merge or reload; do not overwrite server data blindly.
- A major-exam save may carry weekly data and vice versa. Preserve cross-domain fields when changing a payload builder.
- `max-retries` means automatic sync stopped. `ExamSyncAction` must display a visible error and allow a manual retry; it is not equivalent to ordinary pending work.
- API reads use no shared public cache. Do not reintroduce in-memory multi-instance response caching for `/api/exams`.

## Latest Update

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
