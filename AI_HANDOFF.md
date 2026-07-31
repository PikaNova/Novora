# Novora AI Handoff

This document is the starting point for an AI or engineer taking over the
`dev` branch. It describes the codebase at commit `ad82f7b` (2026-07-31).

## Scope and working rules

- Work on `dev`. Do not switch to or merge `main` unless explicitly asked.
- Preserve existing worktree changes. Never use `git reset --hard` or discard
  changes just to get a clean tree.
- Commit completed, verified changes locally. Push `origin/dev` only when the
  user explicitly asks to push.
- The Vercel production branch was intentionally switched to `dev` during
  this project. Confirm the Vercel setting before changing deployment rules;
  older README instructions mentioning `main` may be historical.
- Do not expose or add database URLs, passwords, deploy hooks, recovery keys,
  tokens, cookies, or telemetry credentials to source files, logs, or docs.

## Product and stack

Novora is a school exam scheduling system with a class-facing display,
administrator backend, weekly test scheduling, devices, ClassIsland plugin
pairing, PDF printing, and Neon-backed cloud sync.

- Frontend: React 18, TypeScript, Vite 5, React Router 6.
- Backend: Vercel Functions in `api/`, Neon Postgres.
- Runtime: Node 24 (`package.json`).
- Current package version: `2.7.1`.
- Main routes: `/`, `/exam`, `/login`, `/admin`, `/settings`, `/preferences`,
  and `/plugin/connect`.

## Important directories

```text
src/
  pages/        Route-level screens. AdminPage and SettingsPage are large.
  components/   Reusable UI, including WeeklyPanel and user management.
  hooks/        Sync, alert, display, and weekly workflow hooks.
  services/     API client, offline/sync queue, notifications, dialogs.
  shared/       Frontend/backend shared permission rules.
  utils/        Scheduling, settings normalization, merge, display helpers.
  constants/    Presentation-only permission metadata and brand constants.
api/
  exams.ts      Thin HTTP handler for exam, school, device, and plugin actions.
  _exams/       Database, payload, diff, permission, and plugin submodules.
  _auth.ts      Authentication, role, and scope access helpers.
integrations/ClassIsland.ExamReminder/
  .NET 8 ClassIsland plugin source and release artifacts.
tests/          Node tests run through the TypeScript test config.
```

## Data, sync, and API boundaries

`ExamPayload` is the central cloud document. It contains large exams, weekly
plans, active plan IDs, grades, classes, initialization state, alerts, conflict
policy, and design policy. Avoid introducing a second persistence channel for
these fields.

- Use `src/services/examService.ts` for authenticated exam data writes. Do not
  add raw `fetch("/api/exams")` calls from pages.
- `src/services/syncQueue.ts` serializes cloud writes and coalesces compatible
  work. Device, plugin, exam, and auth-related writes share this protection.
- `src/hooks/useExamSync.ts` owns initial loading, cloud snapshots, polling,
  local/offline recovery, and stale-response protection.
- API GET responses intentionally use revalidation/no-cache behavior. Do not
  restore public short-lived response-body caching for `/api/exams`; that caused
  different Vercel hot instances to return stale school data after a write.
- JSON comparisons in `api/_exams/diff.ts` canonicalize object keys. Do not
  replace them with direct `JSON.stringify` equality; PostgreSQL `jsonb` key
  ordering caused false permission denials.

## Authentication and permissions

Permission semantics must remain identical on client and server.

- The single source of truth is `src/shared/permissionRules.ts`.
- `api/_auth.ts`, `api/_exams/permissions.ts`, and `examService` wrappers use
  those rules. Do not duplicate grade/class scope checks in a new form.
- `src/constants/permissions.ts` is display metadata only: modules, labels,
  descriptions, and audit action text.
- School-wide mutations use `allScope`; grade and class administrators are
  restricted through `canAccessGrade` and `canAccessClass`.
- A class administrator may edit, end, or delete only their own quick,
  temporary exam (`source: "quick"`, `temporary: true`, matching `createdBy`).
  Formal exams, other users' quick exams, and promotion to formal still require
  normal `major.edit` or `major.delete` permission.

## Scheduling behavior to preserve

- Major exams and weekly tests resolve into one effective timeline.
- Automatic scheduling gives major exams priority and applies the configured
  conflict policy. Do not delete recurring weekly rules to resolve one conflict;
  use occurrence overrides.
- Subject-track mode filters selectable subjects by a class's track. Untracked
  classes receive all subjects; disabling track mode restores legacy universal
  distribution.
- "English" is normalized to "Foreign Language" (`外语`) and old `政治`
  values are normalized compatibly with `思想政治`.
- The ClassIsland plugin API shares `/api/exams`; maintain backward-compatible
  plugin pairing and API-version handling.

## Recent high-risk changes

| Commit | Change |
| --- | --- |
| `ad82f7b` | Repaired WeeklyPanel hook extraction. Plan/item mutation logic is in hooks; import, exception, copy, and print workflow mutations still remain in WeeklyPanel. |
| `b9234a0` | Settings cloud reset now goes through `examService`; repeated exam-save payload construction was centralized. |
| `ccb1045` | Safe class-admin ownership rules for quick temporary exams. |
| `dfa2f33` | Split the former monolithic `api/exams.ts` into `api/_exams/*`. See `api/_exams/README.md`. |
| `ac5cda3`, `2c960da` | Removed unsafe stale cache behavior and strengthened initial sync recovery. |

## Refactor status from the Notion plan

Completed:

- Permission metadata moved from `UserManagementPanel` to
  `src/constants/permissions.ts`.
- Shared permission rules are used by client and server.
- `api/exams.ts` responsibilities were split into `api/_exams/*` modules.
- `SettingsPage` reset writes use the service layer.
- Weekly plan and item modal logic has been extracted to weekly hooks.

Partially complete:

- `src/utils/appSettings.ts` is smaller and several domains were extracted to
  `src/utils/settings/`, but it is still a 384-line settings aggregator.
- `WeeklyPanel.tsx` remains about 2,500 lines. Import/export, exceptions,
  rescheduling, copy/batch actions, printing, and much JSX still need gradual
  extraction into focused hooks/components.
- `SettingsPage.tsx` remains about 1,800 lines. It needs domain components for
  time sync, appearance, telemetry, deployment/update, announcements, school
  settings, and data maintenance.

Not started:

- Targeted tests for settings normalization, shared permission rules,
  `api/_exams` diff/permissions, sync conflicts, and weekly scheduling hooks.
- `AdminPage.tsx` domain extraction. It remains about 3,800 lines with many
  modal states and permission checks.

Needs a product decision:

- `integrations/ClassIsland.ExamReminder` is a real .NET 8 plugin with source
  and built artifacts, not an empty placeholder. Decide whether it stays in
  this repository and receives integration tests, or is moved to its own repo.

## Safe implementation order

1. Add focused tests before moving more behavior.
2. Split `SettingsPage` by domain while preserving its public route and service
   interfaces.
3. Extract one WeeklyPanel workflow at a time, retaining behavior and running
   schedule tests after each move.
4. Split `AdminPage` into domain hooks/components only after the shared
   permission contract is covered by tests.
5. Confirm and document ClassIsland ownership and release workflow.

## Required checks

Run these after TypeScript or API changes:

```powershell
npx.cmd tsc --noEmit
npm.cmd run typecheck:api
npm.cmd test
git diff --check
```

`npm run build` is useful before a release, but do not run it solely for a
narrow code review if the user asked for type checks only.

## Manual regression checklist

When touching authorization or sync, test all of the following against a real
deployment:

1. Super administrator, grade administrator, class administrator, and custom
   role access to major exams, weekly tests, grades/classes, devices, calendar,
   users, and roles.
2. A grade-scoped user may operate only their own grades/classes; UI visibility
   and API acceptance/rejection must match.
3. Class administrators can manage only their own quick temporary exams.
4. Two devices: create/update/delete school data on one, then verify the other
   receives it without a manual refresh.
5. Offline mutation, page reload, reconnect, and automatic queue replay.
6. Weekly conflict policies, overrides, and track-based subject distribution.

## Release handoff

The source package should be produced from a committed `dev` HEAD with
`git archive`, excluding `node_modules`, `dist`, and `.git`. Record the commit
SHA in the package filename and do not claim that a Git push proves a Vercel
production deployment succeeded; confirm that separately in Vercel.
