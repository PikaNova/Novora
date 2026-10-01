# v2.7.5 收口与并行合并清单

更新时间：2026-09-05 18:45 +08:00

## 当前原则

- 开发 1 / 开发 3 运行期间，本清单只做合并协调和验证记录，不改业务代码。
- 所有并行任务必须在独立分支运行，禁止直接共用同一个 `main` 工作区。
- 不使用 force push；每次合并后完整跑质量门禁。

## 当前主分支状态

| 项目 | 状态 |
|---|---|
| 目标仓库 | `https://github.com/PikaNova/Novora-future.git` |
| 分支 | `main` |
| 本地 HEAD | `9789bc3 fix: preserve unnamed legacy grades and classes` |
| 远端基线 | `ba2169c docs: record database gate merge progress` |
| 待推送 | 1 commit |

## 数据库门禁已通过

| 检查 | 结果 |
|---|---|
| `npm test` | 453/453 |
| `npm run test:integration` | 19/19 |
| `npm run typecheck:api` | 通过 |
| `npm run serve:build` | 通过 |
| `npm run lint` | 0 errors / 82 warnings |
| `npm run format:check` | 通过 |

真实数据库环境：本机 PostgreSQL 17 一次性集群，`127.0.0.1:15432/novora_integration`。

## 开发 1 / 开发 3 合并登记

| 任务 | 分支 | 负责范围 | 状态 | 最近提交 |
|---|---|---|---|---|
| 开发 1 | 待登记 | 运行中 | 运行中 | 待登记 |
| 开发 3 | 待登记 | 运行中 | 运行中 | 待登记 |

分支推送到远端后，请把实际分支名、HEAD 和改动面填入上表。

## 已知冲突风险

### 开发 1：共享契约

根据当前任务记录，重点关注：

- `src/shared/authContracts.ts`
- `src/shared/apiErrorContract.ts`
- `src/shared/deviceContracts.ts`
- `api/_auth.ts`
- `src/services/adminUsers.ts`
- `src/services/examService.ts`

### 开发 3：类型清理 / lint 收口

根据当前任务记录，重点关注：

- `api/update-check.ts`
- `src/designs/registry.ts`
- 多个测试文件的 mock 类型与 fixture
- `api/_auth.ts` 中的 unused / no-op catch 清理

### 与数据库门禁重叠

数据库门禁已进入 `main`，涉及：

- `api/_schemaMigration.ts`
- `api/_auth.ts`
- `api/_exams/db.ts`
- `api/system.ts`
- `src/shared/examContracts.ts`

其中 `api/_auth.ts` 是开发 1、开发 3 和数据库门禁都可能触及的文件，合并时必须优先保留双方语义，再统一格式。

## 合并顺序

```text
main（含数据库门禁修复）
  <- 开发 1
  <- 开发 3
  <- integration/v2.7.5
```

推荐操作：

1. 推送当前 `main` 的 `9789bc3`。
2. 等开发 1 / 开发 3 推送独立分支。
3. 从最新 `main` 创建 `integration/v2.7.5`。
4. 先合并开发 1，解决冲突并跑门禁。
5. 再合并开发 3，解决冲突并跑门禁。
6. 全部通过后 fast-forward 或 PR 合入 `main`。

## 每次合并后的门禁

```powershell
npm test
npm run typecheck:api
npx tsc -p tsconfig.test.json --noEmit
npm run build
npm run serve:build
npm run lint
npm run format:check
npm run test:integration
```

集成测试必须继续使用独立一次性数据库：

```powershell
$env:INTEGRATION_DATABASE_URL='postgres://novora@127.0.0.1:15432/novora_integration'
$env:INTEGRATION_TEST_CONFIRM='novora-disposable'
npm run test:integration
```

## 冲突处理规则

1. 不自动接受一边；先读双方提交目的。
2. 类型契约冲突：保留共享定义，删除本地重复类型。
3. lint 清理冲突：保留更严格的类型，不把 `any` 加回来。
4. 数据库迁移冲突：保留 schema 版本、迁移日志和失败记录语义。
5. Hook / 定时器冲突：保留依赖修正，不允许为了消警告破坏时序。
6. 冲突解决后必须 `git diff --check`，再跑全量门禁。

## 完成定义

- 开发 1 / 开发 3 分支全部合并进 `integration/v2.7.5`。
- 全部质量门禁通过。
- 无 `<<<<<<<` / `>>>>>>>` 冲突标记。
- `task_plan.md`、`findings.md`、`progress.md`、`nas-sync-tracker.md` 更新。
- 不再遗留未解释的 lint warning。
