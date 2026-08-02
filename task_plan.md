# Task Plan

## Active Task

Inspect, selectively merge, and statically validate login lockout and Markdown URL restrictions on top of the uncommitted write-slot and JSON-comparison repair.

## Phases

| Phase | Status | Scope |
| --- | --- | --- |
| 1. Inspect incoming patch and current `dev` state | Complete | Compared the supplied zip against commit `4b2d65b`. |
| 2. Merge permission and stale-snapshot protections | Complete | Applied changes in `api/_exams/permissions.ts` and `examDataRoutes.ts`. |
| 3. Add regression coverage and validate | Complete | Added tests and ran test/API/build validation. |
| 4. Update handoff documentation | Complete | Updated `PROJECT_HANDOVER.md` with this fix. |
| 5. Delivery | Pending user direction | Changes are local and uncommitted; push was not requested for this patch. |
| 6. Inspect builtin-role test package | Complete | Package adds a direct contract test only; it does not alter role permissions. |
| 7. Merge role contracts and revalidate | Complete | Exported role metadata, added contracts, and passed tests/API/build validation. |
| 8. Clean temporary artifacts and handoff | Complete | Removed temporary extraction/build output and updated handoff material. |
| 9. Delivery | Pending user direction | Local changes are validated but not committed or pushed. |
| 10. Package latest source and handover | Complete | Created and verified clean source and standalone handover archives from the current validated `dev` worktree. |
| 11. Inspect settings test-coverage package | Complete | Confirmed the route refactor preserves control flow; incoming documentation/comments contain text-encoding corruption. |
| 12. Merge and validate settings test coverage | Complete | Added clean test coverage; tests, API type check, and production build passed. |
| 13. Update handoff and clean artifacts | Complete | Recorded P1 validation and removed temporary extraction/build output. |
| 14. Delivery | Pending user direction | All local changes are validated but remain uncommitted and unpushed. |
| 15. Inspect plugin and database test package | Complete | Package contains only tests, but its comments and several expected string literals are encoding-corrupted. |
| 16. Merge and validate plugin/database tests | Complete | Added clean test-only coverage; tests, API type check, and production build passed. |
| 17. Update handoff and clean artifacts | Complete | Recorded test-only scope and validation, then removed temporary extraction/build output. |
| 18. Delivery | Pending user direction | All accumulated local changes are validated but remain uncommitted and unpushed. |
| 19. Inspect admin page utility test package | Complete | Verified the test-only package matches current helper behavior and needs no test-config change. |
| 20. Merge and validate admin page utility tests | Complete | Added timezone-resilient tests; tests, API type check, and production build passed. |
| 21. Update handoff and clean artifacts | Complete | Recorded test-only scope and validation, then removed temporary extraction/build output. |
| 22. Delivery | Pending user direction | All accumulated local changes are validated but remain uncommitted and unpushed. |
| 23. Package current source and handover | Complete | Created and verified clean archives including all accumulated test coverage through `242/242`. |
| 24. Delivery | Pending user direction | Current source package is ready; working-tree changes remain uncommitted and unpushed. |
| 25. Inspect exam-merge/timezone test package | Complete | Confirmed the package contains compatible, clean UTF-8 test-only additions. |
| 26. Merge and validate exam-merge/timezone coverage | Complete | Added 14 tests and the compiler entry; tests, API type check, and build passed. |
| 27. Update handoff and clean artifacts | Complete | Updated handoff and process records; generated output will be removed before handoff. |
| 28. Inspect weekly-schedule test package | Complete | Confirmed test-only scope and compatible coverage of the current weekly calendar helpers. |
| 29. Merge and validate weekly-schedule coverage | Complete | Added the 18 test blocks in the supplied file; tests, API type check, and build passed. |
| 30. Update handoff and clean artifacts | Complete | Updated handoff/process records and removed generated output before handoff. |
| 31. Package latest source and handover | Complete | Created and structure-verified current source and standalone handover archives from the `274/274` baseline. |
| 32. Commit and push validated change set | Complete | Pushed commit `592fe3d` to `origin/dev`; a final documentation-status commit will record the delivery result. |
| 33. Design disposable Neon integration coverage | Complete | Mapped the authenticated database write path, test isolation requirements, and initial high-risk scenarios. |
| 34. Provision isolated integration database | Complete | Confirmed a reachable blank Neon database and used it only for the isolated integration suite. |
| 35. Implement and run database integration tests | Complete | Added opt-in route-level coverage; `4/4` Neon tests, `274/274` unit tests, API type check, and build passed. |
| 36. Record integration coverage and clean artifacts | Complete | Updated handoff/process records and removed generated test/build output. |
| 37. Diagnose subject-track exam delivery regression | Complete | Confirmed the live feature flag and class track are correct; stale item-level target scopes override the updated class tracks. |
| 38. Add regression coverage and repair the shared filtering contract | Complete | Added shared formal-major target-scope logic, class-track resynchronization, temporary-major protection, and a guarded historical backfill command. |
| 39. Revalidate and update handoff material | Complete | Added seven regression tests; full tests, API type check, production build, and the no-database safety guard passed. |
| 40. Repair time-picker boundary anchoring | Complete | Added owner-modal-aware placement for the time-range picker portal. |
| 41. Verify picker placement and record the UI fix | Complete | Added focused placement coverage; tests, API type check, and production build passed. |
| 42. Restrict device filters to administrator scope | Complete | Applied one shared scoped view to device filters, operations, statistics, and design-policy inputs so grade administrators cannot see other grades. |
| 43. Verify scoped-device UI and update handoff material | Complete | Added pure scope regression coverage; unit tests, API type check, and production build passed. |
| 44. Package current source and handover | Complete | Created and structure-verified a fresh archive of the current working tree, including uncommitted validated fixes and updated handover documentation. |
| 45. Inspect global write-throttle package | Complete | Package contains a useful database-slot helper and frontend retry ideas, but no server route invokes the helper, so it cannot throttle requests as delivered. |
| 46. Merge, validate, and document write throttling | Complete | Added controller-level enforcement, clean 429 response/recovery behavior, ten regression tests, full validation, and handover documentation. |
| 47. Delivery | Pending user direction | Changes are local and validated; do not commit or push without an explicit request. |
| 48. Inspect entry-rate-limit package | Complete | Incoming dispatcher would remove the current database write gate. Its memory limiter is useful only as a preceding, per-instance defensive layer and needs safer keying, configuration parsing, and action exemptions. |
| 49. Merge, validate, and document entry rate limiting | Complete | Preserved the database gate, added hardened per-source entry limits, verified every stated behavior, passed all validation, and updated handoff documentation. |
| 50. Delivery | Complete | Pushed `30600e3 feat: add layered API rate limits` to `origin/dev`; final documentation commit records the delivery state. |
| 51. Inspect ghost-save boundary package | Complete | The package contains exactly four declared files. Only the optional clock and direct test export are production-file changes; its process documents predate the current branch and will not be overwritten. |
| 52. Merge, validate, and document ghost-save coverage | Complete | Added deterministic boundary coverage; `315/315` tests, API type check, and production build passed. |
| 53. Commit and push ghost-save coverage | Complete | Pushed `44b53f3 test: cover ghost save boundaries` to `origin/dev`. |
| 54. Package latest source and handover | Complete | Created and inspected clean source and standalone-handover archives; final archives are regenerated from the delivery-record commit. |
| 55. Inspect six quality-analysis reports | Complete | Identified Gemini 3.5 Flash, Sonnet 5, GPT-5.4, Kimi K3, DeepSeek, and GLM-5.2; compared their claims with current `dev` code. |
| 56. Consolidate by model and priority | Complete | Grouped repeated findings, separated verified defects from conditional risks and static-analysis false positives, and prepared a unified action order. |
| 57. Inspect P0 user-visibility package | Complete | Package contains the first two P0 fixes, nine regression tests, test configuration, and a handover copy that must be merged selectively. |
| 58. Merge and validate P0 user visibility and audit policy | Complete | Preserved internal permissions through filtering, restricted audit reads to all-scope actors, added 9 regressions, and passed tests/API/build validation. |
| 59. Delivery | Complete | Pushed `9b9593f fix: enforce scoped user visibility` to `origin/dev`; documentation delivery status is recorded in a follow-up commit. |
| 60. Inspect write-slot and JSON-comparison package | Complete | The package must be selectively merged: route-level slots are valid, but its dispatcher removes the current gate, copied text is corrupted, and its test config drops `api/users.ts`. |
| 61. Merge and validate compatible fixes | Complete | Moved slot acquisition to validated write routes, shared canonical comparison across API/client paths, retained existing limiter/test entries, and passed `333/333` tests/API/build. |
| 62. Delivery | Pending user direction | Keep any validated change local until an explicit commit/push request. |
| 63. Inspect login-lockout and safe-URL package | Complete | Preserve `api/users.ts` test coverage, recreate encoding-damaged test text, and return 429 immediately on the fifth recorded failure. |
| 64. Merge and validate compatible fixes | Complete | Added immediate fifth-failure lockout behavior and URL allowlisting; `343/343` tests, API typecheck, and production build passed. |
| 65. Delivery | Pending user direction | Do not commit or push the cumulative local changes unless explicitly requested. |
| 66. Inspect legacy shared-token invalidation package | Complete | Confirmed the three-part token uses global `app_auth.token_version` and maps to the default admin account. |
| 67. Merge compatible invalidation safeguards | Complete | Added seven global invalidation call sites before sensitive user writes and clean source-invariant coverage. |
| 68. Validate and update handoff material | Complete | Passed `351/351` tests, API typecheck, and production build; updated handoff/process records. |
| 69. Delivery | Pending user direction | Keep the cumulative local changes uncommitted and do not push unless requested. |
| 70. Inspect telemetry IP-salt package | Complete | Confirmed the fixed repository salt is a privacy weakness; identified unnecessary disabled-event database access and unsafe error propagation in the incoming relay path. |
| 71. Merge compatible telemetry privacy safeguard | Complete | Added a persistent singleton salt with in-instance promise caching, optional override, deferred relay resolution, safe no-relay failure behavior, and clean coverage. |
| 72. Validate and update handoff material | Complete | Passed `356/356` tests, API typecheck, and production build; updated handoff/process records. |
| 73. Delivery | Pending user direction | Keep the cumulative local changes uncommitted and do not push unless requested. |
| 74. Extend disposable Neon integration coverage | Complete | Added real-database coverage for the global write slot, scope deletion, stale snapshots, formal-exam denial, device scope denial, reset scope denial, and role-change token invalidation. The response double mirrors Vercel implicit success statuses; the runner retries once only for known Neon transport disconnects. |
| 75. Revalidate and record database integration results | Complete | Passed `7/7` Neon integration tests, `356/356` unit tests, API typecheck, and production build. |
| 76. Delivery | Pending user direction | Keep the cumulative local changes uncommitted and do not push unless requested. |
| 77. Package current source and handover | Complete | Create a clean archive of the current worktree, including the in-progress Neon integration-test changes and current handover documentation. |
| 78. Export validated source and handover | Complete | Created clean post-validation archives after removing generated test/build directories; archives exclude credentials, environment files, Git metadata, dependencies, and logs. |
| 79. Inspect login alerts and retry-feedback package | Complete | The package has compatible alert/countdown goals but is based on older security code, contains encoding-corrupted text, removes scoped user/audit safeguards, and moves legacy-token invalidation after mutations. Merge only isolated compatible behavior. |
| 80. Merge compatible alert and regression coverage | Complete | Added all-scope login-failure alerts, precise recovery/login countdown feedback, pure token guards, and clean regressions without weakening existing scope or token-invalidation safeguards. |
| 81. Validate and update handover | Complete | Passed `367/367` unit tests, API typecheck, production build, and `8/8` Neon integration tests; updated handover and process documents. |
| 82. Delivery | Complete | Pushed `915507c feat: harden auth feedback and database integration coverage` to `origin/dev`. |
| 83. Export validated source and handover | Complete | Created clean archives containing this validated merge and updated handover, excluding incoming extraction, generated output, credentials, environment files, Git metadata, dependencies, and logs. |

## Decisions

- Do not directly overwrite package files when they overlap newer fixes in `dev`; merge the behavior into the current source.
- Keep formal exam permissions unchanged. Snapshot sanitization applies only to non-all-scope users and only replaces out-of-scope data.
- Treat a push as an explicit delivery action. Do not push this patch until requested.
- Keep builtin-role assertions as direct unit tests against the exported role definition; do not introduce database dependencies.
- `tsconfig.test.json` already includes `tests/**/*.ts`, so no redundant config change is needed for this test.
- Archives must reflect the current working tree, including uncommitted validated fixes, while excluding dependencies, Git metadata, generated output, caches, and secrets.
- Keep database-backed route authorization and response behavior unchanged when extracting pure validation helpers for tests.
- The plugin/database coverage package must not modify `api/_exams/plugin.ts` or `api/_exams/db.ts`; only compatible test additions and documentation updates are in scope.
- The exam-merge/timezone package is test-only. Preserve the current production implementations unless a verified defect requires separate user direction.
- The weekly-schedule package is test-only. Keep all existing scheduling behavior unchanged unless tests expose a demonstrable defect requiring separate approval.
- Delivery archives must include the current uncommitted, validated changes and exclude Git metadata, dependencies, generated output, caches, environment files, and logs.
- Database integration tests must run only against an explicitly designated isolated database or an ephemeral branch created from an empty test parent. They must never fall back to `DATABASE_URL` or production data.
- A supplied integration connection is used only as a transient process environment value and is never written to files, Git, logs, documentation, or delivery archives.
- The ghost-save detector's optional clock and direct test export exist solely to make its existing time-window rule deterministic under unit tests. Production calls retain the default clock and the 120-second rule remains unchanged.
- Any write-slot ordering repair must retain both layers: per-source entry limiting before dispatch and database-backed cross-instance write gating for classified mutations.
- Do not copy encoding-corrupted comments or documentation from this package; retain the current handover and write new plain-ASCII technical records where needed.
- Do not run `npm install` for this batch. Run the already-available test, API typecheck, and build commands after merging, per the user's latest instruction.
- The legacy three-part compatibility token has a single global `app_auth.token_version`; incrementing it invalidates all such legacy tokens, not one named user's token. Describe that behavior accurately and retain it only as a compatibility-window safeguard.

## Next Action

Await an explicit commit/push request for the validated cumulative local changes. Keep the scoped-audit guard until audit records have trustworthy grade/class ownership.
