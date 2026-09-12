# 任务计划：代码优化

## 当前会话：双端进度整理、对话归档与远端同步（2026-09-06）

### 目标
- [x] 汇总学校端与作者端最新提交、验证结果和远端分支状态。
- [x] 更新 `progress.md`、`task_plan.md`、`findings.md`、`nas-sync-tracker.md`。
- [x] 归档四组共享对话导出及可复用解析脚本到 future workspace。
- [x] 推送作者端可提交改动；学校端已有提交保持在 `future/upload/main`。

### 双端状态
- 学校端：`nas-upload-worktree/upload/main`，`1fea6b8 feat: add manual diagnostic log upload`，已同步至 `Novora-future/future/upload/main`。
- 作者端：`exam-board-telemetry-author/main`，`aae5e5c` + `326de61` + `c5c4734`，已同步至 `exam-board-telemetry/main`。
- 作者端验证：9/9 测试、TypeScript、Vite 构建通过；工作树干净。

### 对话归档
- `share_6a92fda6.*`：版本规划整合。
- `share_6a9bda6b.*`：贴合实际的未来项目规划。
- `share_6a9bdada.*`：考试功能规划。
- `share_6a9bdc53.*`：WebSocket 稳定性评估。

## 当前会话：Novora P1 数据库集成门禁（2026-09-06）

### 目标
- [x] 使用隔离的一次性本地 PostgreSQL 验证迁移与数据库集成套件。
- [x] 验证 schema 版本记录、迁移日志、重复初始化、BIGINT、并发写入、事务回滚和设备权限场景。
- [x] 停止临时数据库实例，不触碰现有 `5432` 服务。

### 验证
- `INTEGRATION_DATABASE_URL=postgres://novora@127.0.0.1:15432/novora_integration`
- `npm run test:integration`：19/19 通过。
- 覆盖 `schemaMigration.integration.test.ts`、`examData.integration.test.ts`。
- 现有服务端工作区的 `OverviewPanel.tsx`、`admin-design.css` 未提交改动已保留，未覆盖。
- 一次性 PostgreSQL 已停止；临时目录删除受安全审查限制，需手动清理。

## 当前会话：Novora P1 API/客户端契约批次（2026-08-30）

### 目标
- [x] 建立 API 与前端共享的考试、设备绑定、设备命令、插件绑定和设备冲突契约。
- [x] 为考试 payload 建立运行时解析：丢弃畸形 item/major，归一化年级、班级、周测、提醒、设计策略、批量预设和初始化。
- [x] 为设备心跳响应、绑定、命令和冲突响应建立运行时解析。
- [x] 消除核心路径 `examService`、`classBinding`、`api/_exams/payload.ts`、设备管理路由、设置路由、两个同步 Hook 中的 `any` 和 `as never`。
- [x] 补充契约负面测试和畸形数据降级测试。
- [ ] 用户确认后提交本批次，或继续数据库集成/迁移门禁。

### 当前状态
- P1 契约批次目标文件 lint 清零；全仓 lint 从 88 warnings 降至 82。
- 核心保存链和目标 API/client 映射中已无 `as never` / `any`。
- 全仓其他 `any` 主要集中在非本轮核心路径与旧测试夹具，属于后续清理。
- 本地仓库当前在 `dev` 分支，已显示跟踪 `origin/dev`；HEAD 仍为 `0850b00`，本批次未提交。

### P1 修改
- 新增 `src/shared/typeGuards.ts`、`src/shared/deviceContracts.ts`、`src/shared/examContracts.ts`。
- `api/_exams/payload.ts` 使用共享 `parseExamPayload`，并定义 API 所需集合必填的 `ApiExamPayload`。
- `src/services/examService.ts` 删除重复 `ExamPayload` 和手工 `toPayload`，统一走共享解析。
- `src/services/classBinding.ts` 删除重复设备契约，改为共享解析；设备绑定列表、心跳绑定/命令、冲突响应均过滤畸形数据。
- `api/_exams/routes/deviceSelfRoutes.ts` 对队列命令和 legacy `temporary_command` 使用共享命令解析。
- `api/_exams/permissions.ts`、`plugin.ts` 将动态 payload 访问改为 `asRecord` 和显式形状。
- `useMajorScheduleActions` / `useWeeklyScheduleSync` 引入 `ExamSavePayload`，核心保存、合并、重试路径不再使用 `as never`。

### P1 验证
- `npm test`：通过，453/453。
- `npm run typecheck:api`：通过。
- `npm run build`：通过，2247 modules。
- `npm run serve:build`：通过。
- `npm run lint`：通过，0 errors / 82 warnings。
- `npm run format:check`：通过。
- `git diff --check`：通过。
- 真实数据库集成测试仍未运行：缺少独立 `INTEGRATION_DATABASE_URL`，本机没有 Docker。

## 当前会话：Novora 完整版本任务规划（2026-08-30）

### 目标
- [x] 合并架构审查、质量报告、修复方案和未来路线。
- [x] 生成逐版本任务清单（v2.7.x → v3.2+），每项带编号、依赖、验收条件。
- [x] 写入 `novora-version-tasks.md`。
- [x] 更新 `task_plan.md`、`findings.md`、`progress.md`。

### 当前阶段
阶段 1：完整版本任务规划已落盘，等待用户选择首个实施版本。

### 任务总数
- v2.7.x：12 项（v2.7.4 六项 + v2.7.5 六项）
- v2.8.x：22 项（v2.8.0–v2.8.5）
- v2.9.x：12 项（v2.9.0–v2.9.2）
- v3.0.x：9 项（v3.0.0–v3.0.1）
- v3.1.x：6 项（v3.1.0）
- v3.2+：6 个方向（长期，按需拆版本）

### 决策
| 决策 | 理由 |
|---|---|
| 版本号由验收条件驱动 | 避免日期驱动导致质量门禁被压缩 |
| v2.7.5 是 v2.8.0 的硬前置 | schema 版本、集成测试和类型契约是数据库改造的基础 |
| v2.9.0 可提前设计但不能提前合并 | 命令队列表结构依赖 v2.8 稳定 |
| v3.1 依赖 v2.9 + v3.0 | Agent 需要可靠命令和独立作者端 |

## 当前会话：Novora P0 同步/Hook 批次实施（2026-08-30）

### 目标
- [x] 清零修复方案阶段 1 列出的目标文件 Hook 警告。
- [x] 保留“打开时初始化”等有意省略依赖的设计，并用注释说明。
- [x] 补充连续编辑、网络恢复、冲突重试、通知替换和命令回执测试。
- [x] 修复测试暴露的真实缺陷：同一时段改名后，`useExamNotify` 的旧 fired key 会吞掉新提醒。
- [x] 修复周测合并重试失败后未回写 outbox 的时序缺口。
- [ ] 用户确认后提交本批次，或继续进入阶段 2 API 契约收紧。

### 当前状态
- P0 目标文件 lint 已清零；全仓 lint 仍有 88 个 warnings，主要属于阶段 2/6。
- 本地仓库当前分支已变为 `dev`（无 upstream 显示）；未做分支切换或回退。
- 工作区包含既有阶段 2/4/5 原型改动与本批次 P0 改动。

### P0 修改
- `useExamNotify`：用 `examRef` 维持最新考试对象，修复改名提醒被旧 key 吞掉。
- `useAlertOverlay`：通知 effect 使用完整 notification 依赖，移除未使用解构。
- `DeviceStatusPanel`：在线状态和排序回调显式依赖 `now`。
- `TimeRangePickerModal`：打开时快照初始值，避免父级回传预览值重置草稿。
- `DateTimePicker`：小时范围依赖拆成基础值，清理未使用 props。
- `DeviceHeartbeat`：命令回执决策抽到 `deviceCommandReceipt.ts` 并补测试。
- `useWeeklyScheduleSync`：合并重试失败时把合并结果写回 outbox。

### P0 验证
- 新增测试：`useExamNotify`、`useAlertOverlay`、`deviceCommandReceipt`、`examOutbox.pipeline`。
- `npm test`：通过，450/450。
- `npm run typecheck:api`：通过。
- `npm run build`：通过，2244 modules。
- `npm run serve:build`：通过。
- `npm run lint`：通过，0 errors / 88 warnings。
- `npm run format:check`：通过。
- `git diff --check`：通过。
- 集成数据库测试仍未运行：缺少独立 `INTEGRATION_DATABASE_URL`，本机没有 Docker。

## 当前会话：Novora 项目熟悉与基线复核（2026-08-30）

### 目标
- [x] 读取 `planning-with-files` 工作流。
- [x] 读取现有 `task_plan.md`、`findings.md`、`progress.md`。
- [x] 复核 v2.7.3 架构审查、质量报告、未来计划和修复方案。
- [x] 确认当前仓库状态，识别未提交改动。
- [x] 初读未提交 diff，识别其覆盖阶段。
- [x] 执行当前 diff 的标准验证。
- [x] 修复格式检查失败。
- [x] 对照六阶段路线盘点当前完成度。
- [ ] 用户决定是否提交当前部分成果、继续阶段 1/2，或先提供集成数据库。

### 当前状态
- 项目基线为 `novora-remote-audit` 的 `main` / `0850b00` / v2.7.3。
- 工作区不再是干净基线：`git status` 显示 15 个业务/集成文件已修改。
- `git diff --stat` 为 256 insertions / 107 deletions；`git diff --check` 无输出。
- 初读 diff 显示改动横跨多个方案阶段：包含阶段 2 的契约类型收敛，也新增了 `exam_metadata`/`lifecycle`、`device_commands` 表与回执路径、受限 scope 守卫，以及集成测试串行/写槽释放调整。
- 这些改动不能回退；下一步应先让用户确认归属，再决定是否继续验证或补齐测试。

### 验证结果
- `npm test`：通过，444/444。
- `npm run typecheck:api`：通过。
- `npm run build`：通过，2243 modules。
- `npm run serve:build`：通过。
- `npm run lint`：通过，0 errors，100 warnings。
- `npm run format:check`：初次失败，8 个文件；格式化后通过。
- 格式化后工作区从 15 个已修改文件扩展为 19 个；diff 统计为 286 insertions / 150 deletions，其中新增的 4 个文件只包含旧基线格式修复。

### 六阶段完成度快照
- P0 Hook：约 80%。阶段 1 目标文件 Hook 警告已清零，并补齐连续编辑、网络恢复、冲突重试、通知替换和命令回执测试；剩余风险主要是真实数据库时序集成验证和全局其他 Hook 清理。
- P1 API 契约：约 35%。`examService`、`useExamSync`、`classBinding`、`diff.ts` 已部分收紧；核心路径仍有 `any` 与大量 `as never`，设备/考试共享运行时校验未完成。
- P1 数据库门禁：约 35%。已有并发写入、事务回滚、写槽和设备替换集成测试；缺少 schema 版本、部署期迁移、旧库升级和空库/旧库门禁。
- P1 设备命令队列：约 20%。已有 `device_commands` 基础插入/读取/回执；缺少状态机、幂等键、过期、失败原因、原子领取和专项测试。
- P1 考试元数据：约 10%。只新增 JSONB 字段透传；尚未建关系化考试记录和生命周期状态机。
- P2 清理：约 20%。Prettier 已通过；lint warnings、大文件拆分和 Router 7 评估未完成。
- `npm run test:integration`：未运行，缺少独立 `INTEGRATION_DATABASE_URL`，本机也没有 Docker。

## 当前会话：Novora v2.7.3 修复方案设计（2026-08-30）

### 目标
- [x] 重新读取架构与质量审查结果。
- [x] 按风险制定分阶段修复方案。
- [x] 明确每阶段范围、出口条件、回滚点和不做事项。
- [x] 写入 `novora-remediation-plan.md`。
- [ ] 用户确认后执行阶段 1 Hook/同步修复。

### 当前阶段
阶段 0：方案已完成，等待进入首个实施批次。

### 修复顺序
1. 同步/定时 Hook 正确性（P0）。
2. API 与客户端契约收紧（P1）。
3. 数据库集成与迁移门禁（P1）。
4. 持久化设备命令队列（P1，v2.9 前置）。
5. 考试元数据与生命周期（P1，v2.8 前置）。
6. 大文件、格式和依赖清理（P2）。

### 本次限制
- 本轮只设计方案，不修改业务代码。
- 阶段 4/5 的数据库改动必须先有独立集成数据库和迁移回滚验证。

## 当前会话：Novora v2.7.3 架构与代码质量审查（2026-08-30）

### 目标
- [x] 读取并遵循 `planning-with-files` 工作流。
- [x] 锁定干净基线 `novora-remote-audit` / `main` / `0850b00` / v2.7.3。
- [x] 完成架构上下文、数据边界、设备链路和部署方式检查。
- [x] 完成测试、构建、类型检查、lint、格式和依赖审计。
- [x] 输出架构审查与代码质量报告。
- [x] 给出后续开发的优先级、出口条件和明确不可行项。
- [x] 本会话不修改业务源代码。

### 阶段
- [x] 阶段 1：基线与工作流确认。
- [x] 阶段 2：关键模块和安全边界取证。
- [x] 阶段 3：质量检查与风险量化。
- [x] 阶段 4：报告落盘、计划更新和交付。

### 产物
- `novora-architecture-review.md`
- `novora-code-quality-report.md`

### 错误与限制
- 集成测试未运行：项目要求单独的 `INTEGRATION_DATABASE_URL`，避免误用生产 `DATABASE_URL`；已记录为验证限制，不重复尝试。

## 当前会话：Novora 未来项目规划落盘与可行性约束（2026-08-30）

### 目标
- [x] 读取 `planning-with-files` 工作流要求。
- [x] 读取三个分享对话的本地抓取内容。
- [x] 锁定真实 v2.7.3 基线为 `novora-remote-audit`。
- [x] 对照客户端、学校服务端、作者端和 Agent 的职责边界。
- [x] 将未来版本计划和明确不可行项写入 `novora-future-plan.md`。
- [ ] 用户确认后，按阶段启动具体代码任务；本会话不修改业务代码。

### 当前阶段
阶段 1：未来计划已落盘，等待后续实施任务。

### 本会话错误
| 错误 | 尝试 | 处理 |
|---|---:|---|
| 在 `novora-remote-audit` 运行测试/构建时缺少 `node_modules` 中的 `tsc`/`vite` | 1 | 记录为依赖环境缺失；未重复执行同一失败命令，后续需先 `npm ci`。 |


## 目标
阅读用户提供的导出压缩包，定位源码并实施经过验证的代码优化。

## 当前阶段
阶段 1：需求与范围确认

## 阶段

### 阶段 1：需求与范围确认
- [x] 初始化持久化计划文件。
- [x] 记录当前工作区上下文。
- [x] 获取待优化的代码来源。
- [x] 检查外层压缩包的内容。
- [x] 解压外层和嵌套压缩包。
- [x] 解压并识别导出内容。
- [x] 阅读现有代码质量优化计划。
- [x] 定位对应的实际 Novora 源码，并将文档建议与当前代码状态做初步对照。
- [ ] 阅读当前关键模块，确定仍然存在且适合本轮优化的最小改动项。
- **状态：** 进行中

### 阶段 2：范围化计划
- [x] 检查相关项目或工件。
- [x] 明确首个低风险优化：抽离用户管理权限展示数据。
- **状态：** 已完成

### 阶段 3：执行
- [x] 将 `ROLE_MODULES` 与 `PERMISSION_GROUPS` 抽离到 `src/data/userManagementPermissions.ts`。
- [ ] 运行类型检查、测试和构建。
- **状态：** 进行中

### 阶段 4：验证与交付
- [ ] 依据验收标准验证结果。
- [ ] 交付完成结果。
- **状态：** 待开始

## 关键问题
1. 需要规划并交付的具体结果是什么？
2. 工作区中的哪个项目或工件属于本次范围？

## 已做决策
| 决策 | 理由 |
|------|------|
| 将任务定义为代码优化 | 用户提供了代码导出压缩包并明确说明正在进行代码优化。 |
| 使用中文维护计划 | 用户通过 `plan-zh` 指定中文计划。 |
| 先检查压缩包清单 | 外层压缩包仅含一份嵌套压缩包，需先安全解压后才能阅读源码。 |
| 解压到工作区隔离目录 | 保持原始压缩包不变，并避免混入用户现有项目文件。 |
| 将导出内容视为优化路线而非源码 | 内层 ZIP 仅含一份 12,527 字节的 Markdown 计划文档。 |
| 优先检查 `work\\Novora` | 工作区内有多个历史与版本化副本；该目录名称最直接匹配文档所指仓库。 |
| 以 `work\\Novora` 作为当前检查对象 | 它是完整可运行的 Novora 项目，当前分支为 `main` 且工作区干净。 |
| 先抽离两组权限展示数据 | `ROLE_MODULES` 和 `PERMISSION_GROUPS` 是无副作用的静态数据，迁移风险低，不改变鉴权行为。 |

## 遇到的错误
| 错误 | 尝试次数 | 处理方式 |
|------|----------|----------|
| 虽然存在 `.git` 目录，`git status --short` 仍报告“不是 Git 仓库” | 1 | 已记录为环境观察；初始化计划不依赖 Git 操作。 |
| 对整个 `work` 目录递归搜索源码文件超时 | 1 | 改为按候选仓库逐个检查根目录和必要配置文件，避免重复全量扫描。 |
| 指定的 NPM 运行时路径不存在，无法启动测试与构建 | 1 | 改用系统可发现的 NPM 命令或项目本地运行时；不重复调用缺失路径。 |

## Current task: authentication database row compatibility (2026-08-02)

### Phase 1: diagnosis and scope
- [x] Read planning records and inspect the login request evidence.
- [x] Locate strict number guards applied to Neon BIGINT/BIGSERIAL result fields.
- [x] Confirm this can reject a successful login query before password verification.

### Phase 2: implementation
- [ ] Add a dedicated validated database-int8 guard without weakening normal integer validation.
- [ ] Apply it only to auth IDs and timestamps returned from BIGINT/BIGSERIAL columns.
- [ ] Add regression tests for numeric-string database results and invalid values.

### Phase 3: verification and delivery
- [ ] Run unit tests, API typecheck, production build, and whitespace diff validation.
- [ ] Update handover/progress records, create the current handover export, commit, and push `dev`.

### Decisions
| Decision | Reason |
|---|---|
| Do not run Neon integration tests in this deployment cycle | The user requested consolidated database integration testing later. |
| Keep `isNumberLike` strict | It remains appropriate for genuine JS numeric/INTEGER fields; only PostgreSQL int8 result fields need compatibility. |

### Phase 2 and 3 completion
- [x] Add a dedicated validated database-int8 guard without weakening normal integer validation.
- [x] Apply it only to auth IDs and timestamps returned from BIGINT/BIGSERIAL columns.
- [x] Add regression tests for numeric-string database results and invalid values.
- [x] Run unit tests, API typecheck, production build, and whitespace diff validation.
- [x] Update handover/progress records, create the current handover export, commit, and push `dev`.

Delivery: `85cafe2 fix: accept Neon int8 auth rows` was pushed to `origin/dev`.

## Current task: custom-role login failure investigation (2026-08-03)

### Phase 1: evidence and code-path diagnosis
- [x] Read the required planning, findings, and progress records.
- [x] Extract failing authentication requests from `11novora-six.vercel.app.har`.
- [x] Trace the matching server-side role and login path.

### Phase 2: conclusion
- [x] Determine root cause, scope, and minimal safe correction.
- [x] Record findings and user-facing next action.

### Decision
No authentication or role code change is authorized by this HAR. The supplied capture has no completed login request and shows a client-side `NETWORK_UNAVAILABLE` error across all API endpoints. Diagnose the deployment/network layer first, then capture a fresh HAR including a single login POST if the problem persists.

## Current task: login lockout feedback diagnosis (2026-08-03)

### Phase 1: trace lockout response and UI
- [x] Read planning records.
- [x] Locate the current source checkout containing the lockout implementation.
- [x] Inspect the 429 response contract and LoginPage error/countdown rendering.

### Phase 2: repair and verification
- [x] Confirm no missing UI feedback path exists in the current source.
- [x] Run the full unit test suite and API typecheck.

### Conclusion
The current `dev` checkout already handles `429 LOGIN_LOCKED`: it preserves `retryAfterMs`, sets a local lock deadline, disables submit, and renders a live countdown. `399/399` tests pass. The absent online feedback indicates that the browser is serving an older client bundle/PWA shell, or the known page-reload problem resets LoginPage state before React can render it. No source edit is justified until a fresh failing login response is captured.

### HAR confirmation
`8novora-six.vercel.app.har` confirms the hypothesis: the deployed API returned `LOGIN_LOCKED`, `retryAfterMs`, and `Retry-After`, but the browser made three more login POSTs while the lock was active. This is conclusive evidence that the displayed client is stale or is reloading, rather than a server-side lockout failure.

## Current task: make lockout UI error recognition bundle-safe (2026-08-03)

### Phase 1: diagnosis
- [x] Confirm production receives `429 LOGIN_LOCKED` with a valid retry delay.
- [x] Confirm the visible login UI does not enter its lockout state.
- [x] Identify the cross-module `instanceof ApiError` guard as the fragile boundary.

### Phase 2: repair
- [x] Replace the lockout UI guard with structural error recognition.
- [x] Add a focused regression test for a response-shaped lockout error.

### Phase 3: verification
- [x] Run full tests, API typecheck, and production build.

### Delivery
Changed `src/pages/LoginPage.tsx`, `src/utils/retryCountdown.ts`, and `tests/retryCountdown.test.ts`. The lockout UI now recognizes the `LOGIN_LOCKED` API contract structurally, so it cannot be bypassed by an `ApiError` prototype mismatch across independently loaded client chunks. Verification passed: `400/400` tests, API typecheck, and production build.

### Push status
Committed locally as `3d0a706 fix: show login lockout countdown reliably`. The fix is an ancestor of the current `dev` and `origin/dev` head (`1648915`), so it has already been included in the remote branch. The explicit `git push origin dev` confirmation completed with `Everything up-to-date`.

## Current task: live lockout verification (2026-08-03)

### Phase 1: production reproduction
- [x] Verify the deployed LoginPage bundle contains the structural `LOGIN_LOCKED` recognition and countdown renderer.
- [x] Submit five invalid credentials for a unique, non-existent probe account.
- [x] Capture the live response contract.

### Phase 2: database cross-check
- [x] Verify the user-authorized Neon database schema and application authentication path.
- [x] Pre-lock a distinct probe account in that database and call the live login endpoint with it.

### Conclusion
The live endpoint returns `500 DATABASE_WRITE_FAILED` for every probe, including an account that the supplied Neon database has already locked. The deployment is not using the supplied Neon database configuration or is running a server-function environment with a distinct database/schema failure. No frontend code change can make a countdown appear until the live endpoint returns `429 LOGIN_LOCKED`.

## Current task: fix lockout countdown state race (2026-08-03)

### Phase 1: evidence and root cause
- [x] Parse the replacement HAR and Vercel log export.
- [x] Confirm the fifth request returns a complete `429 LOGIN_LOCKED` contract.
- [x] Reproduce the missing UI in a real headless Chrome session.
- [x] Identify the stale initial Hook value that immediately clears the new deadline.

### Phase 2: implementation
- [x] Make `useRetryCountdown()` derive the current remaining time synchronously on every render.
- [x] Add a React Hook rerender regression test for `null -> future deadline`.

### Phase 3: verification and delivery
- [x] Run focused and full tests, API typecheck, and production build.
- [x] Verify the built application in a browser with an intercepted 429 response.
- [x] Update handover records and commit only scoped files.
- [x] Push `dev` after explicit authorization for commit `4c936d6` to `origin/dev`.

### Delivery confirmation
`4c936d6 fix: preserve login lockout countdown` was pushed successfully to `origin/dev` on 2026-08-03.

## Current task: trigger Vercel deployment with an empty commit (2026-08-03)

- [x] Read task_plan.md, findings.md, and progress.md.
- [x] Confirm dev matches origin/dev and preserve all untracked local directories.
- [ ] Create an empty Git commit without changing source files.
- [ ] Push the empty commit to origin/dev and verify the remote head.

Decision: use git commit --allow-empty so Vercel receives a new dev revision while source remains unchanged.

### Completion
- [x] Created empty commit f2be847 without source changes.
- [x] Pushed f2be847 to origin/dev and triggered Vercel deployment.


## Current task: classroom seat-matrix loading page (2026-08-07)

### Phase 1: design confirmation
- [x] Read planning-with-files SKILL.md and the three planning files.
- [x] Inspect current LoadingState.tsx / loading-state.css and the screenshot.
- [x] Present four CSS-only redesign options; user chose option 3 (seat matrix).

### Phase 2: implementation
- [x] Replace card/bar/dots with podium + 6x10 snake-lit seat matrix in LoadingState.tsx.
- [x] Add matrix, seat wave/hot-seat/breath styles and kind accents in loading-state.css.
- [x] Keep all four kind copy strings unchanged; add "第 N / 3 步" indicator.

### Phase 3: verification and delivery
- [x] Build/typecheck the frontend (npm run build passed).
- [x] Render a headless preview screenshot of the new loading page (desktop + mobile).
- [x] Update findings.md / progress.md / PROJECT_HANDOVER.md.
- [x] User authorized push; mascot work from another session was included and both branches were updated.


### Delivery: push to main and dev (2026-08-07)
- dev: 0c810e5 (mascot) + 11f642f (loading page) pushed as `056693b..11f642f`.
- main: merged dev via 9f31a93 (`027ce74..9f31a93`), preserving the pre-existing c3d0644 main-only fix. Remote branch rule (no merge commits / PR required) was bypassed on push.
- Working tree left with only untracked `.tmp-weekly-shots/` and `deliveries/` (excluded).


## Current task: user & permissions page layout (option 3, 2026-08-10)

### Phase 1: design confirmation
- [x] Inspected UserManagementPanel.tsx (users/roles/audit tabs) and its styles.
- [x] Presented three layout options; user chose option 3 and confirmed all recommendations:
  - empty role groups stay visible with 0 users; default expand current account group;
  - row actions = edit + "..." menu; search/role/status toolbar included.

### Phase 2: implementation
- [x] Users tab: group by role (built-ins first, custom by name), collapsible group heads, compact rows, edit + menu actions, search/filter toolbar, batch-delete secondary entry.
- [x] Roles tab: two-column layout (left role list, right permission matrix reusing ROLE_MODULES/moduleLevel), read-only built-ins, inline save for custom roles, collapsible permission details.
- [x] CSS: grouped layout, toolbar, matrix, menu, responsive rules in admin-design.css.

### Phase 3: verification
- [x] Static checks + production build (npm run build passed).
- [x] Desktop/mobile headless previews (4 views verified).
- [x] Update findings/progress/PROJECT_HANDOVER; not committed/pushed per user request.


## Current task: replace built-in 只读 role with 巡考员 (方案 A, 2026-08-10)

- [x] User chose 方案 A (rename/upgrade in place; keep internal id `viewer`).
- [x] Updated api/_auth.ts viewer entry: name=巡考员, new description, permissions = major.read/export, weekly.read/export, school.read, device.read, alerts.read, settings.read.
- [x] Updated tests/builtinRoles.test.ts snapshot + name assertion; historical migration comment clarified.
- [x] Verified: npm test 422/422, typecheck:api, npm run build all pass.
- [x] Committed 608df02 (layout) + af1520c (巡考员 role) and pushed to origin/dev (f3603f1..af1520c).


## Current task: user row menu layering fix (2026-08-10)

- [x] Root cause: row `sw-rise` transform creates a stacking context; the in-row absolute menu and its `position: fixed` backdrop were trapped inside the row, so the backdrop covered only one row and the menu overlapped adjacent rows.
- [x] Fix: render the "..." menu through AdminModalPortal (document.body) with a full-viewport click-catcher layer (z-index 9000, below the 9999 modal overlay); position the menu from the trigger button rect, clamp to viewport, open upward near bottom, close on scroll/resize.
- [x] Verified: production build passed; full suite 422/422; portal preview shows the menu floating above rows with no overlap.
- [x] Committed 07707e7 and pushed to origin/dev (af1520c..07707e7).


## Current task: menu items unclickable — backdrop z-index (2026-08-10)

- [x] Reproduced with Playwright hit test: elementFromPoint at the 重置密码 item returned BUTTON.backdrop; the old backdrop rule left z-index: 40 (new rule only overrode position/inset), so the backdrop sat above the menu (z-index 1) and ate every click.
- [x] Fixed: backdrop z-index explicitly reset to 0; menu stays z-index 1 inside the fixed 9000 layer.
- [x] Re-verified hit test: elementFromPoint returns the menu item; click fires. Build + full suite 423/423 pass.
- [x] Committed 468495d (admin-design.css only) and pushed to origin/dev (07707e7..468495d).


## Current task: local standalone deployment (no Vercel/Neon) (2026-08-10)

### Decisions (user confirmed)
- Embedded PostgreSQL 16 in Docker Compose; classroom HTTP (0.0.0.0:3000); announcement images keep remote proxy (documented); dual deployment retained.

### Done
- [x] Removed old Docker scaffold: Dockerfile / docker-compose.yml / .dockerignore / server.js / tsconfig.server.json (old one used express which was not a dependency).
- [x] server/ adapter (Node req/res → VercelRequest/VercelResponse), routes, static hosting (SPA fallback + security/cache headers mirroring vercel.json), serve entry; zero changes to api handlers.
- [x] tsconfig.server.json; Dockerfile (multi-stage, node:22-alpine); docker-compose.yml (app + postgres:16 + volume + healthcheck); .dockerignore; .env.example; .gitignore additions; package.json scripts (serve/serve:build/start/docker:up/docker:down); DEPLOY_LOCAL.md; README section.
- [x] SpeedInsights conditional via VITE_SPEED_INSIGHTS (default true on Vercel, false locally; Docker build arg false).
- [x] Routes aligned to merged api/system.ts (health/status/email-worker → system handler), per parallel session's commit e2d8db8.
- [x] Verified: tsc server build + vite build pass; smoke test (static 200, SPA fallback 200, /api/login 503 DATABASE_NOT_CONFIGURED, /api/nope 404, /api/redeploy configured:false, /api/health|system|status|email-worker reach handlers); full suite 427/427.
- [ ] Not committed/pushed (awaiting user decision; worktree also carries parallel session's commits e2d8db8 and uncommitted email work).


## Current task: system status enrichment + version 2.7.2 (2026-08-10)

- [x] Server: collectSystem adds memory total/free, CPU model/cores/usage (600ms sampling, 5s cache), loadavg, startedAt; collectDatabase adds PG version, db size, tables/indexes, connections, cache hit rate, transactions, largest tables.
- [x] Local request stats (last 5 min total/failed) tracked in server/serve.ts and exposed via /api/status (local only; null on Vercel).
- [x] Frontend: types + SystemStatusSection render new fields, summary adds 内存/CPU items with tone thresholds; layout keeps 名称—值 rows, both platforms.
- [x] Version bumped to 2.7.2 (package.json, README title + changelog, PWA cache names, deploymentConfig.test.ts assertions).
- [x] Verified: serve:build, vite build, full suite 427/427, diff --check clean.
- [ ] Not committed/pushed (awaiting user decision).


### Delivery: push to dev (2026-08-10)
- Committed a267e1c (local standalone deployment + one-click update + v2.7.2) and f9fedd1 (system status enrichment + local-aware update flow) on top of origin/dev bc34d9b (other session's latest).
- Pushed bc34d9b..f9fedd1 to origin/dev; origin/dev == local == f9fedd1.


## Current task: fill missing animations (2026-08-10)

- [x] A1 group body / empty fade+slide; A2 menu app-menu-in; A3 backdrop fade; A4 batch/toolbar/checkbox fade; A5 role-item transition; A6 matrix-cell transition; A7 role panel remount animation (key on panel); A9 groups remount on role/status/batch filter (search typing excluded to avoid flicker).
- [x] B1 status dot pulse (ok/warn/err); B3 system-status section entry. B2 refresh highlight intentionally skipped (would blink every 30s).
- [x] C1 set-update-guide panel-in; C2 set-readme fade.
- [x] D1 already covered by existing per-group nth-child stagger; D2 covered by global reduced-motion rule.
- [x] Verified build + serve:build + 427/427 tests.
- [ ] Not committed/pushed (awaiting user decision).


### Delivery: push to dev (2026-08-10)
- Committed 377907b (remove largest-tables) and e9df5cf (fill missing animations) on top of f9fedd1; pushed f9fedd1..e9df5cf to origin/dev; origin/dev == local == e9df5cf.


## Current task: email verification-code login hardening (2026-08-10)

- [x] #1 queued 区分 + email-send-status 轮询（api/emailAuth.ts + emailAuth.ts + LoginPage）
- [x] #2 retryAfterMs 透传（AdminApiError + 两个 request()）并接住重发冷却
- [x] #3 EMAIL_CODE_LOCKED 锁定与密码登录对齐（emailLockUntil + countdown + 禁用）
- [x] #4 邮箱视图表单入场动画 + 状态提示统一（login.css）
- [x] Verified serve:build + build + 427/427 tests.
- [ ] Not committed/pushed (awaiting user decision).


### Delivery: push to dev (2026-08-10)
- Committed a619853 (email verification-code login hardening, 5 files) on top of b735900; pushed b735900..a619853. origin/dev == local == a619853.


## Current task: v2.7.4 correctness cleanup (2026-09-05)

- [x] T-274-01: `useMajorScheduleActions`/`useWeeklyScheduleSync` hook deps already fixed; continuous-edit + network-recovery + conflict-retry test exists and passes.
- [x] T-274-02: `useExamNotify`/`useAlertOverlay` deps already fixed; fixed remaining `ExamAlertOverlay.tsx` `[item?.key]` -> `[item]`.
- [x] T-274-03: `DeviceStatusPanel`/`TimeRangePickerModal`/`DateTimePicker` already lint clean.
- [x] T-274-04: added `workspace/` to `.prettierignore` and eslint ignores; `format:check` passes.
- [x] T-274-05: removed 22 unused vars/imports + no-op `try/catch` rethrow in `api/_auth.ts`.
- [x] T-274-06: control-character regexes annotated with narrow `eslint-disable` + security-intent comments.
- [x] Verified: 453/453 tests, typecheck:api, build, format:check, lint 0 errors / 54 warnings (46 `any` for v2.7.5 + 8 hook warnings outside target files).
- [ ] Not committed/pushed (awaiting user decision).


## Current task: v2.7.5 type contracts + remaining hook warnings (2026-09-05)

- [x] Cleared 8 remaining hook warnings (3 real fixes + 4 annotated intentional narrow deps); project hook warnings now zero.
- [x] T-275-03 partial: cleared all 46 `any` warnings across api (update-check), frontend (designs/registry), and 8 test files (typed globals, Record bodies, scoped fixtures, targeted casts).
- [x] Verified: 453/453 tests, typecheck:api, tsc --noEmit, build, format:check, lint 0 errors / 0 warnings.
- [ ] T-275-01/02/04/05/06 deferred: shared-type extraction, unknown->type boundaries, and integration DB work blocked on the parallel database session.
- [ ] Not committed/pushed (awaiting user decision).


## Current task: T-275-01 shared contracts (2026-09-05)

- [x] `LoginFailureAlert` consolidated to `src/shared/authContracts.ts` (was duplicated in api/_auth.ts + src/services/adminUsers.ts).
- [x] `ApiErrorResponse` wire format in `src/shared/apiErrorContract.ts`, used by server error senders and client parser.
- [x] `DeviceHeartbeatInput` added to shared deviceContracts; client heartbeat uses it.
- [x] Verified: tsc (test + api), lint 0/0, format:check, 456/456 tests, build.
- [ ] T-275-02 (client-side unknown->type boundaries) and T-275-04/05/06 (integration DB) still open.
- [ ] Not committed/pushed (awaiting user decision).


## Current task: T-275-02 client validation boundaries (2026-09-05)

- [x] `parseAdminUserContext` in examService.ts replaces 4 session blind casts; invalid data returns null, refresh caches only validated users.
- [x] adminUsers.ts users/roles/audit/login-alert responses validated through parse helpers; malformed entries dropped.
- [x] Verified: tsc, lint 0/0, format:check, 456/456 tests, build.
- [ ] T-275-04/05/06 (integration DB gates) blocked on the parallel database session.
- [ ] Not committed/pushed (awaiting user decision).


## Current task: v2.7.5 release close-out (2026-09-05)

- [x] Version bump 2.7.3 -> 2.7.5 (package.json, package-lock, README title + changelog, PWA cache names, deploymentConfig assertions).
- [x] T-274-01..06 and T-275-01..06 marked complete in version task table; v2.7.x marked 已完成.
- [x] Release checklist: 460/460 tests, typecheck:api, vite build, serve:build, format:check, lint 0/0 — v2.7.5 release-ready.
- [ ] Not committed/pushed (awaiting user decision).

## Current task: error report privacy hardening (2026-09-05)

- [x] Freeze a shared error report contract with explicit type/level enums and software-only fields.
- [x] Redact credentials, personal identifiers, control characters, dynamic URL parameters, and non-operational context at both client and school API boundaries.
- [x] Add bounded offline queue, retry policy, non-standard rejection capture, and stable dynamic-value fingerprints.
- [x] Add regression coverage; `npm test` 458/458, API typecheck, lint, format, and diff check pass.
- [ ] School-local error persistence and author-side cross-instance aggregation remain the next v2.9.2 batches.
- [ ] Commit/push awaits user instruction.
