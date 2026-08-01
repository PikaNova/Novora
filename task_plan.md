# Task Plan

## Active Task

Safely merge and validate the class-administrator temporary-exam deletion 403 fix together with direct builtin-role contract tests, update project handoff material, and prepare the changes for the requested delivery action.

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
| 32. Commit and push validated change set | In progress | Commit the complete current worktree and push it to `origin/dev`. |

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

## Next Action

Commit and push the validated `274/274` change set to `origin/dev`, then verify that the remote branch contains the new commit.
