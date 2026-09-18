# Novora 工作区同步追踪

用途：NAS 同步任务进度。记录本工作区所有改动、时间和产物，供跨设备查看。

基线：Novora v2.7.3（`novora-remote-audit`，`main`，`0850b00`）。老仓库只读，不在本仓库范围内。

## 会话记录

### 会话 1：架构审查与代码质量评估（2026-08-30 上午）

**时间**：约 2026-08-30 09:00 – 10:15

**改动内容**：

- 读取 `architect-review` 和 `architecture` 技能及参考文档。
- 检查关键源文件：`api/_auth.ts`（1128 行）、`api/_exams/db.ts`、`examDataRoutes.ts`、`deviceAdminRoutes.ts`、`deviceSelfRoutes.ts`、`examService.ts`（683 行）、`examOutbox.ts`、`useMajorScheduleActions.ts`、`useWeeklyScheduleSync.ts`、`AdminPage.tsx`（986 行）等。
- 量化 lint 警告：130 条（`any` 73、unused 28、Hook 依赖 25、控制字符正则 2、无效 catch 1、无效转义 1）。
- 运行验证：`npm ci`（335 包）、`npm test`（427/427 通过）、`npm run typecheck:api`（通过）、`npm run serve:build`（通过）、`npm run build`（通过，2243 模块）。
- `npm run format:check` 失败：4 个文件未格式化（`InlineSelect.tsx`、`SchedulePrintPreview.tsx`、`LocalSettingsPage.tsx`、`typographySettings.ts`）。
- 生产依赖审计：2 moderate（`react-router`/`react-router-dom`，升级 Router 7 属破坏性变更）。

**关键发现**：

| ID | 级别 | 结论 |
|---|---|---|
| A1 | 高 | `exam_data` 单例 JSONB 承载多域，考试历史/分页前需关系化 |
| A2 | 高 | `temporary_command` 覆盖式单命令，不是可靠队列 |
| A3 | 高 | 浏览器 `localStorage` UUID 不是可信设备身份 |
| A4 | 中高 | 请求期 DDL 耦合迁移与 API 可用性 |
| A5 | 中 | `/api/exams` action 过载入口 |
| A6 | 中 | 遥测默认含完整校名，需明确同意和数据治理 |

**产物**：

- `novora-architecture-review.md`（架构结论与风险评估）
- `novora-code-quality-report.md`（质量基线与优先级）

**更新**：`task_plan.md`、`findings.md`、`progress.md`

### 会话 2：问题修复方案设计（2026-08-30 上午）

**时间**：约 2026-08-30 10:15 – 10:20

**改动内容**：

- 按风险分阶段制定修复顺序：Hook/同步正确性（P0）→ API 契约 → 集成/迁移门禁 → 设备命令队列 → 考试元数据 → 维护性清理。
- 明确每阶段范围、出口条件、回滚点和不做事项。

**产物**：

- `novora-remediation-plan.md`（分阶段修复方案）

**更新**：`task_plan.md`、`findings.md`、`progress.md`

### 会话 3：P0 同步/Hook 批次实施（2026-08-30，由并行会话完成）

**时间**：约 2026-08-30（具体时刻见 `task_plan.md` 顶部记录）

**改动内容**（在 `novora-remote-audit` 业务代码中，不在本仓库范围内）：

- 修复 `useExamNotify` 改名后旧 fired key 吞掉新提醒的真实缺陷。
- 修复 `useWeeklyScheduleSync` 合并重试失败后未回写 outbox 的时序缺口。
- 抽离 `deviceCommandReceipt` 纯函数。
- 新增 4 个测试文件、6 项时序测试。

**状态**：已在 `novora-remote-audit` 中完成，本仓库仅记录进度。

### 会话 4：完整版本任务规划（2026-08-30 下午）

**时间**：约 2026-08-30 17:00 – 17:25

**改动内容**：

- 合并未来路线和修复方案，生成逐版本任务清单（v2.7.x → v3.2+）。
- 每项任务带编号（T-XXX-XX）、前置依赖、验收条件和优先级。
- 版本依赖链：v2.7.4 → v2.7.5 → v2.8.0 → v2.8.x → v2.9.0 → v2.9.x → v3.0.x → v3.1.0 → v3.2+。
- v2.7.5（schema 版本 + 集成门禁 + 类型契约）是所有数据库改造的硬前置。

**产物**：

- `novora-version-tasks.md`（268 行，67 项任务/方向）

**更新**：`task_plan.md`、`findings.md`、`progress.md`

### 会话 5：NAS 同步准备（2026-08-30）

**时间**：当前会话

**改动内容**：

- 创建本跟踪文件 `nas-sync-tracker.md`。
- 创建 `.gitignore`，排除 `novora-remote-audit/`（老仓库）、`work/`（其他项目）、`node_modules/`、`deliveries/`/`outputs/`/`notion-audit/`（约 367 MB 构建产物）、系统目录（`.agents`/`.appdata`/`.codex*`/`.dotnet-home`/`.nuget-packages`/`.tmp*`）。
- 在工作区根目录初始化 Git 仓库，纳入所有根级文件（规划/报告/跟踪 MD、聊天导出 share*.{html,json,txt}、解析脚本 *.cjs、测试 JSON、源码压缩包、NuGet.Config）。
- 提交到 `main` 分支。

**产物**：

- `nas-sync-tracker.md`（本文件）
- `.gitignore`
- Git 仓库初始化和首次提交

**更新**：无（本文件即记录）

## 工作区文件清单

### 规划与报告（本仓库核心）

| 文件 | 说明 | 最后修改 |
|---|---|---|
| `novora-future-plan.md` | 未来项目路线（三端边界、版本阶段、技术决策） | 2026-08-30 10:03 |
| `novora-architecture-review.md` | v2.7.3 架构审查（模块化单体、6 项风险） | 2026-08-30 10:13 |
| `novora-code-quality-report.md` | 代码质量报告（lint/构建/依赖审计） | 2026-08-30 10:13 |
| `novora-remediation-plan.md` | 分阶段修复方案（P0→P2，6 阶段） | 2026-08-30 10:16 |
| `novora-version-tasks.md` | 完整版本任务（67 项，v2.7.x→v3.2+） | 2026-08-30 17:23 |
| `nas-sync-tracker.md` | 本跟踪文件 | 当前会话 |

### 持久化计划

| 文件 | 说明 |
|---|---|
| `task_plan.md` | 任务阶段与决策记录 |
| `findings.md` | 发现与证据记录 |
| `progress.md` | 会话进度日志 |

### 聊天导出与解析工具

| 文件 | 说明 |
|---|---|
| `share1/2/3.html` + `.messages.json` + `.router.txt` | 三个分享对话的抓取内容 |
| `decode.cjs`、`decode2.cjs`、`extract.cjs`、`extract2.cjs` | 聊天导出解析脚本 |
| `inspect*.cjs`、`trydecode.cjs` | 调试探针脚本 |

### 其他

| 文件 | 说明 |
|---|---|
| `exam-board-major-daily-test.json` | 大型考试每日测试数据 |
| `exam-board-weekly-daily-test.json` | 周测每日测试数据 |
| `exam-board-v2.0.0.zip` | 历史版本源码压缩包 |
| `novora-v2.7.1-dev-4b2d65b-source.zip` | v2.7.1 dev 源码压缩包 |
| `NuGet.Config` | NuGet 镜像配置 |

### 排除项（不入本仓库）

| 目录/文件 | 原因 |
|---|---|
| `novora-remote-audit/` | Novora 老仓库（main/0850b00），用户明确不动 |
| `work/` | 其他项目（ClassIsland、mariadb、历史 stage 等） |
| `node_modules/` | 依赖缓存 |
| `deliveries/`、`outputs/`、`notion-audit/` | 约 367 MB 构建产物，不适合 Git |
| `.agents/`、`.appdata/`、`.codex/`、`.codex-migration/`、`.dotnet-home/`、`.nuget-packages/`、`.tmp*` | 系统运行时目录 |
| `.git/`（根目录原有空目录） | 已被新仓库初始化覆盖 |

## NAS 同步说明

- 本仓库推送到远程 `main` 后，NAS 侧可通过 `git clone` / `git pull` 获取最新进度。
- 跟踪文件 `nas-sync-tracker.md` 是单一进度入口；每次会话结束追加新记录。
- `task_plan.md` / `findings.md` / `progress.md` 保留完整历史，适合审计。
- 老仓库 `novora-remote-audit` 不在本仓库内，需单独管理。

## 2026-08-30 17:35 增补：统一上传与最新进度

> 本节是最新权威说明。前文提到的“工作区根目录单独建仓”方案已被本次统一上传方案取代。

### 目标仓库与安全边界

| 项目 | 值 |
|---|---|
| 目标仓库 | `https://github.com/PikaNova/Novora-future.git` |
| 目标分支 | `main` |
| 远程基线提交 | `0850b00`（与本地上传起点一致） |
| 本地源码目录 | `novora-remote-audit/` |
| 旧 Novora remote | `https://github.com/PikaNova/Novora.git`，只保留为 `legacy` remote，本次绝不推送 |
| 本次上传时间 | 2026-08-30 17:35 +08:00 |

本次不使用 force push；`main` 的上传提交会以远程 `main` 当前提交 `0850b00` 为父提交。

### 新仓库布局

```text
/                            # Novora 源码，来自 Novora-future main + 本地 P0/P1 源码改动
/workspace/                  # 工作区规划、报告、聊天导出、解析脚本、测试数据和说明
/workspace/nas-sync-tracker.md
/workspace/source-snapshot/  # 源码目录中的本地说明文件
```

`.gitignore` 只排除依赖缓存、构建产物、运行数据、历史工作目录和系统目录；不排除源码和任务追踪文档。

### 完整时间线

| 时间（+08:00） | 阶段 | 内容与结果 |
|---|---|---|
| 2026-08-30 上午 | 项目熟悉 | 确认 `novora-remote-audit` 为 Novora v2.7.3 有效基线，提交 `0850b00`；`work/Novora` 是旧副本。读取架构、质量、修复方案和未来路线文档。 |
| 2026-08-30 上午 | 验证基线 | `npm ci`、`npm test` 427/427、API 类型检查、前端构建、本地服务构建均通过；lint 0 errors / 130 warnings；4 个文件未格式化；真实数据库集成测试未运行。 |
| 2026-08-30 上午 | 方案落盘 | 生成 `novora-architecture-review.md`、`novora-code-quality-report.md`、`novora-remediation-plan.md`、`novora-future-plan.md`。 |
| 2026-08-30 下午 | 标准复验 | 未提交原型改动共 15 个文件；标准验证通过后格式化 8 个文件；测试 444/444，lint 0 errors / 100 warnings。 |
| 2026-08-30 17:00–17:25 | 版本任务规划 | 生成 `novora-version-tasks.md`，细化为 v2.7.x 至 v3.2+ 共 67 项任务/方向。 |
| 2026-08-30 17:35 前 | P0 批次 | 清零阶段 1 目标 Hook 警告；修复 `useExamNotify` 改名提醒被旧 key 吞掉；修复周测合并重试失败未回写 outbox；抽离 `deviceCommandReceipt`；新增时序测试；验证 450/450。 |
| 2026-08-30 17:35 前 | P1 API/客户端契约 | 新增共享考试/设备契约和运行时解析；核心路径移除 `any` / `as never`；设备绑定、命令、冲突、考试 payload 均校验；新增契约测试；验证 453/453。 |
| 2026-08-30 17:35 | 上传准备 | 建立统一上传说明；准备以 `origin/main` 为父提交生成新提交。 |

### 源码改动清单

#### 修改

```text
api/_exams/db.ts
api/_exams/diff.ts
api/_exams/payload.ts
api/_exams/permissions.ts
api/_exams/plugin.ts
api/_exams/routes/deviceAdminRoutes.ts
api/_exams/routes/deviceSelfRoutes.ts
api/_exams/routes/examDataRoutes.ts
api/_exams/routes/settingsRoutes.ts
api/_exams/types.ts
scripts/run-integration-tests.cjs
src/components/DeviceHeartbeat.tsx
src/components/DeviceStatusPanel.tsx
src/components/InlineSelect.tsx
src/components/SchedulePrintPreview.tsx
src/components/TimeRangePickerModal.tsx
src/components/touch-datetime-picker/DateTimePicker.tsx
src/hooks/admin/useMajorScheduleActions.ts
src/hooks/admin/useWeeklyScheduleSync.ts
src/hooks/useAlertOverlay.ts
src/hooks/useExamNotify.ts
src/hooks/useExamSync.ts
src/pages/AdminPage.tsx
src/pages/LocalSettingsPage.tsx
src/services/classBinding.ts
src/services/examService.ts
src/utils/typographySettings.ts
tests/exams.payload.test.ts
tests/exams.permissions.test.ts
tests/integration/examData.integration.test.ts
tsconfig.test.json
```

#### 新增

```text
PROJECT_MIGRATION.md
src/shared/deviceContracts.ts
src/shared/examContracts.ts
src/shared/typeGuards.ts
src/utils/deviceCommandReceipt.ts
tests/apiContracts.test.ts
tests/deviceCommandReceipt.test.ts
tests/examOutbox.pipeline.test.ts
tests/useAlertOverlay.test.ts
tests/useExamNotify.test.ts
```

### 最新验证结果

| 检查 | 结果 |
|---|---|
| `npm test` | 通过，453/453 |
| `npm run typecheck:api` | 通过 |
| `npm run build` | 通过，2247 modules |
| `npm run serve:build` | 通过 |
| `npm run lint` | 通过，0 errors / 82 warnings |
| `npm run format:check` | 通过 |
| `git diff --check` | 通过 |
| `npm run test:integration` | 未运行；缺少独立 `INTEGRATION_DATABASE_URL`，且本机没有 Docker |

### P0 交付点

- `useMajorScheduleActions`、`useWeeklyScheduleSync`、通知 Hook、设备面板、时间选择器目标 Hook 警告清零。
- 修复同一考试同一时段改名后，`useExamNotify` 旧 fired key 吞掉新提醒的问题。
- 修复 `useWeeklyScheduleSync` 在 409 合并重试失败后未把合并结果写回 outbox，导致网络恢复时可能重放旧数据的问题。
- 抽出 `src/utils/deviceCommandReceipt.ts`，保证命令只消费一次，畸形命令不回执。
- 新增连续编辑、网络恢复、409 合并重试、通知替换和命令回执测试。

### P1 交付点

- 新增 `src/shared/examContracts.ts`：`ExamPayload`、`ExamSavePayload`、`parseExamPayload`。
- 新增 `src/shared/deviceContracts.ts`：设备绑定、绑定信息、插件绑定、命令、冲突、DB 行类型和解析器。
- API 和前端共用同一契约，避免前后端字段漂移。
- 考试 payload 会过滤畸形记录并复用现有归一化器；设备响应会过滤畸形行。
- 核心保存链 `useMajorScheduleActions`、`useWeeklyScheduleSync` 不再使用 `as never`。
- `api/_exams/payload.ts`、设备管理路由、设置路由移除目标 `any`。

### 工作区根级文件上传清单

以下文件会复制到新仓库 `workspace/`：

```text
.gitignore
NuGet.Config
nas-sync-tracker.md
novora-architecture-review.md
novora-code-quality-report.md
novora-future-plan.md
novora-remediation-plan.md
novora-version-tasks.md
task_plan.md
findings.md
progress.md
share1.html
share1.messages.json
share1.router.txt
share2.html
share2.messages.json
share2.router.txt
share3.html
share3.messages.json
share3.router.txt
decode.cjs
decode2.cjs
extract.cjs
extract2.cjs
inspect.cjs
inspect2.cjs
inspect3.cjs
inspect4.cjs
inspect5.cjs
inspect6.cjs
inspect7.cjs
inspect8.cjs
trydecode.cjs
exam-board-major-daily-test.json
exam-board-weekly-daily-test.json
exam-board-v2.0.0.zip
novora-v2.7.1-dev-4b2d65b-source.zip
```

`novora-remote-audit/PROJECT_MIGRATION.md` 会复制到 `workspace/source-snapshot/PROJECT_MIGRATION.md`。

### 不上传项

```text
work/
node_modules/
novora-remote-audit/node_modules/
novora-remote-audit/dist/
novora-remote-audit/server-build/
novora-remote-audit/.api-check/
novora-remote-audit/.test-check/
.nuget-packages/
.dotnet-home/
deliveries/
outputs/
notion-audit/
.agents/
.appdata/
.codex/
.codex-migration/
.tmp/
.tmp-log-analysis/
.tmp-novora-remote-audit/
nas-repo/
```

### 老仓库保护声明

本次只推送 `https://github.com/PikaNova/Novora-future.git` 的 `main`。不会推送、覆盖、删除或重置 `https://github.com/PikaNova/Novora.git` 的任何分支或 tag。

### NAS 使用方式

```bash
git clone https://github.com/PikaNova/Novora-future.git
cd Novora-future
cat workspace/nas-sync-tracker.md
```

后续同步：

```bash
git pull origin main
```

## 2026-08-30 17:40 上传结果

### 完成

| 项目 | 结果 |
|---|---|
| 首次统一上传提交 | `347f3ba feat: consolidate P0/P1 and workspace tracker` |
| 远程分支 | `https://github.com/PikaNova/Novora-future.git` `main` |
| 推送方式 | fast-forward：`0850b00..347f3ba`，未使用 force push |
| 提交规模 | 76 files changed，4553 insertions，471 deletions |
| 源码改动 | 31 个修改文件 + 10 个新增源码/测试文件 |
| 工作区文件 | 37 个根级文件复制到 `/workspace` |
| 追踪入口 | `/workspace/nas-sync-tracker.md` |
| 推送时间 | 2026-08-30 17:40 +08:00 |

推送前的远程 `main` 检查结果为 `0850b0042282089f6b8dea5d0073127620a0059b`，与预期基线一致；推送后远程 `main` 为 `347f3ba`。

### 结果记录提交

本节本身会在首次上传后作为一条独立的文档提交再次推送到远程 `main`。NAS 侧使用 `git pull origin main` 后，请以远程最新 HEAD 为准。

### 老仓库核验

本次只向 `Novora-future` 推送，没有向 `https://github.com/PikaNova/Novora.git` 执行任何推送、tag 删除、分支覆盖或历史重写。

## 2026-09-05 17:30 v2.7.5 数据库门禁进展

### 状态

| 项目 | 状态 |
|---|---|
| 任务 | v2.7.5 / `T-275-04`、`T-275-05`、`T-275-06` |
| 代码实现 | 已完成 |
| 单元测试 | 通过，453/453 |
| API / 集成 / 测试 TypeScript 检查 | 通过 |
| 本地服务构建 | 通过 |
| lint | 0 errors / 82 warnings |
| Prettier | 通过 |
| 真实数据库集成测试 | 未运行；缺少独立 `INTEGRATION_DATABASE_URL`，本机没有 Docker |
| 前端 Vite 构建 | 当前沙箱内 esbuild 读取祖先目录被拒绝；已记录为环境限制 |

### 改动

- 新增 `api/_schemaMigration.ts`，当前 schema 版本为 `3`。
- 新增 `app_schema_versions` 与 `app_schema_migration_logs`。
- auth 与 exams 迁移的成功/失败都会记录 request id、耗时和错误摘要。
- `/api/health` 和 `/api/status` 报告 schema 版本、最近迁移日志；版本不匹配返回 degraded。
- 新增 `tests/integration/schemaMigration.integration.test.ts`，覆盖版本、日志、request id、幂等迁移和 BIGINT 时间戳。
- `scripts/run-integration-tests.cjs` 新增防护：`INTEGRATION_DATABASE_URL` 禁止与生产 `DATABASE_URL` 相同。
- Docker Compose 新增 `db-integration` 服务，使用 `test` profile、独立数据库 `novora_integration`、独立数据卷。
- README、`DEPLOY_LOCAL.md` 和 `.env.example` 已记录独立数据库启动/清理方式。
- 系统状态页显示 auth/exams schema 版本。

### 待完成

1. 启动独立数据库：
   ```bash
   docker compose --profile test up -d db-integration
   ```
2. 设置：
   ```bash
   export INTEGRATION_DATABASE_URL='postgres://novora:novora@localhost:15432/novora_integration'
   export INTEGRATION_TEST_CONFIRM=novora-disposable
   ```
3. 运行：
   ```bash
   npm run test:integration
   ```
4. 通过后再更新任务状态并统一上传到 `Novora-future/main`。

本节记录的是本地工作区进度；截至记录时间，v2.7.5 数据库门禁代码尚未作为新提交推送到远程 `main`。

## 2026-09-05 18:50 免费版通信优化第一批

### 改动

- `/api/exams` 普通 GET 改为版本优先：先只查 `exam_data.updated_at`；命中 ETag 直接返回 304，未命中才读取完整 JSONB 快照。
- 考试大屏轮询从固定 5 秒改为自适应：空闲 60 秒，考试中或 30 分钟内临近开始 30 秒。
- `useExamSync` 与设备心跳增加 0–15% 随机 jitter，避免多设备同秒请求。
- 设备/插件心跳从固定 25 秒改为考试中 30 秒、空闲 60 秒；收到命令后的快速回执保持不变。
- 设备在线窗口统一为 180 秒，供服务端、仪表盘和管理界面共用。
- 新增 `tests/freeTierPolling.test.ts` 覆盖 jitter、考试轮询间隔、心跳间隔、在线窗口和 ETag。

### 状态

- 单元测试：460/460 通过。
- API 类型检查、前端构建、本地服务构建、lint、Prettier 检查：通过。
- 变更尚未提交/推送；本节记录的是实施完成时间。
## 2026-09-05 17:46 数据库门禁合并完成

### 合并结果

| 项目 | 状态 |
|---|---|
| 冲突文件 | `api/_exams/db.ts` |
| 解决方式 | 保留 `feature/v2-7-5-db-gate` 的迁移日志包装 |
| merge commit | `341a29f merge: v2.7.5 database gate` |
| 当前分支 | `Novora-future` 本地 `main` |
| 推送状态 | 未推送；本机 Git 凭据返回 `SEC_E_NO_CREDENTIALS` |

### 合并后验证

| 检查 | 结果 |
|---|---|
| `npm test` | 通过，453/453 |
| `npm run typecheck:api` | 通过 |
| `npx tsc -p tsconfig.integration.json` | 通过 |
| `npm run serve:build` | 通过 |
| `npm run lint` | 通过，0 errors / 82 warnings |
| `npm run format:check` | 通过 |
| `git diff --cached --check` | 通过 |
| 真实数据库集成测试 | 未运行；缺少独立 `INTEGRATION_DATABASE_URL`，本机没有 Docker |
| Vite build | 未通过；当前沙箱内 esbuild 读取祖先目录被拒绝 |

### 质量检查调整

- `.integration-check/` 已加入 `.prettierignore`，避免集成编译产物影响格式检查。
- `workspace/` 已加入 `eslint.config.js` 忽略清单，避免 NAS 工作区脚本阻塞 Novora 源码 lint。
- `.github/workflows/docker-image.yml` 已格式化。

### 待执行推送

```powershell
cd 'C:\Users\Administrator\Documents\Codex\2026-07-23\nihao-2\novora-remote-audit'
git push origin main
```

## 2026-09-05 18:35 独立 PostgreSQL 集成测试通过

### 环境

| 项目 | 值 |
|---|---|
| PostgreSQL | 本机 PostgreSQL 17.11 |
| 集群 | 工作区外一次性 `pg-integration-data` |
| 监听地址 | `127.0.0.1:15432` |
| 数据库 | `novora_integration` |
| 连接 | `postgres://novora@127.0.0.1:15432/novora_integration` |

### 结果

- 首次集成测试 17/19 通过，发现 `parseExamPayload` 会过滤缺少 `name` 的旧年级/班级。
- 该回归会让保存请求误判为删除全部结构，并清空用户 scope。
- 已修复为保留缺名记录，并用 `未命名年级` / `未命名班级` 兜底。
- 修复后集成测试 19/19 通过，覆盖并发写入、全局写槽、事务回滚、BIGINT、schema 版本、迁移日志和设备替换。

### 其他验证

- `npm test`：453/453 通过。
- `npm run typecheck:api`：通过。
- `npm run serve:build`：通过。
- `npm run lint`：0 errors / 82 warnings。
- `npm run format:check`：通过。
- `git diff --check`：通过。

## 2026-09-05 会话间合并记录

### 开发2 剩余提交合入

| 项目 | 结果 |
|---|---|
| 合入提交 | `9789bc3 fix: preserve unnamed legacy grades and classes` → cherry-pick 为 `dcd8b98` |
| 合入方式 | 从 `novora-remote-audit` fetch 后 cherry-pick，保持线性历史 |
| 自动合并 | `src/shared/examContracts.ts`（改动区域不同）与 `workspace/nas-sync-tracker.md` 均无冲突 |
| 验证 | `npm test` 460/460（含开发3 新增 4 项）、typecheck:api、lint 0/0、format:check 通过 |

### 时序说明

- 开发2 的数据库门禁主体（`9cd5570`/`341a29f`/`ba2169c`）已在之前 rebase 时进入本仓库历史；`9789bc3` 是最后剩余提交。
- 开发3 的免费版 P0 批次（`8fbf345` ETag/轮询/心跳降频）先提交，再执行本次 cherry-pick，未卷入任何未提交状态。

## 2026-09-05 19:10 开发 1 / 开发 3 合并验证

### 合并内容

| 任务 | 提交 | 说明 |
|---|---|---|
| 开发 1 / T-275-01 | `e2d62b0` | 将登录失败告警、API 错误响应、心跳请求体等线契约收敛到 `src/shared` |
| 开发 3 / 免费版通信优化 | `8fbf345` | ETag 版本优先查询、自适应考试轮询、设备心跳降频和 jitter |
| 数据库修复收口 | `dcd8b98` | 保留缺少 `name` 的旧年级/班级，避免误删 scope |

### 合并后验证

| 检查 | 结果 |
|---|---|
| `npm test` | 460/460 通过 |
| `npm run typecheck:api` | 通过 |
| `npm run lint` | 通过，0 errors |
| `npm run format:check` | 通过 |
| `npm run serve:build` | 通过 |
| 前端 Vite 构建 | 通过，2249 modules |
| `npm run test:integration` | 19/19 通过 |
| `git diff --check` | 通过 |

### 构建说明

- 沙箱内直接运行 `npm run build` 仍受 esbuild 读取祖先目录权限限制。
- 已改用 Vite Node API（`configFile: false`）完成生产构建验证；未修改业务源码。

## 2026-09-05 18:50 并行合并协调启动

### 状态

| 项目 | 状态 |
|---|---|
| 数据库门禁修复 | 本地 `main` 已有 `9789bc3`，待推送 |
| 开发 1 | 运行中，分支待登记 |
| 开发 3 | 运行中，分支待登记 |
| 收口清单 | `workspace/v2-7-5-integration-checklist.md` |
| 本会话改动 | 仅新增合并协调文档，不改业务代码 |

### 协调规则

- 开发 1 / 开发 3 各自使用独立分支，不共用 `main` 工作区。
- 合并顺序：先推送 `main` 数据库修复，再合并开发 1、开发 3。
- 每次合并后必须完整执行单元、类型、构建、lint、format 和真实数据库集成测试。
- Agent 推送仍被 `SEC_E_NO_CREDENTIALS` 拦截；用户可直接执行 `git push origin main`。

### 当前状态（v2.7.5 收口后更新）

- `upload/main` 当前 HEAD 为 `f238038`（v2.7.5 版本发布），开发 1 / 开发 3 与数据库修复已全部合入，v2.7.5 发布检查清单全绿。
- 数据库门禁提交 `9789bc3` 已通过 cherry-pick（`dcd8b98`）进入主线；本清单文档 `4242765` 亦已合入。
- `novora-remote-audit` 工作区使命完成，主线内容齐平后可归档。

## 2026-09-05 v2.8.0 作者端 T-280-07 实施

| 项目 | 状态 |
|---|---|
| 目标仓库 | `exam-board-telemetry/exam-board-telemetry-main`，`main` / `6b592de` / v1.16.0 |
| 实例契约 | 已新增共享解析与摘要白名单 |
| 采集/概览 API | 已统一字段清理、通道归类和 10 分钟在线窗口 |
| 兼容性 | 保留旧 `X-Telemetry-Key`、短期 token 和现有 snake_case 概览字段 |
| 测试 | 5/5 契约测试、TypeScript 检查、服务端构建通过 |
| 前端构建 | Vite Node API workaround 通过；普通 `npm run build` 受沙箱 esbuild 权限限制 |
| Git 状态 | 作者端修改尚未提交或推送 |

本批次不修改学校端仓库，不引入考试正文、班级名单、用户数据或远程控制能力。

## 2026-09-12 服务端诊断上传重试队列收口

| 项目 | 状态 |
|---|---|
| 目标仓库 | `Novora-future`，分支 `upload/main`，远端 `future` |
| 重试领取 | 已改为事务内 `FOR UPDATE SKIP LOCKED`，多实例不会重复领取 |
| 故障恢复 | `sending` 记录使用 10 分钟租约，超时自动回收为 `failed` |
| 重试策略 | 最多 3 次，退避 60/120/240 秒，过期包不再发送 |
| 数据库 | 新增 `next_attempt_at` 到期索引；运行时迁移与 SQL 迁移同步 |
| 验证 | `npm test` 479/479；API 类型检查通过；`git diff --check` 通过 |
| 推送 | 本次提交将与追踪文件一起推送到 `future/upload/main` |

## 2026-09-12 诊断日志手动发送 401 修复

| 项目 | 状态 |
|---|---|
| 现象 | 学校端设置页「发送日期日志 / 发送错误日志」返回 401「登录状态已失效，请重新登录」 |
| 现场证据 | `dev.pikachu2026.space.har` 中 `POST /api/diagnostic-logs` 请求不含任何 `Authorization`/Cookie，服务端按无凭据处理 |
| 根因 | `src/services/diagnosticLogs.ts` 使用裸 `fetch`，只设置 `Content-Type`，从未附加管理员令牌；同页面的设置读取 401 被静默忽略，因此页面一直显示本地默认配置（`captureOnError=false`，也就不会保留错误日志包） |
| 修复 | 请求封装统一附加 `Authorization: Bearer <admin_auth_token>` 并加 `cache: 'no-store'` |
| 附带修复 | 错误日志包列表在进入设置页和保存策略后刷新（原先 `setBundles` 从未调用，列表不会更新） |
| 回归测试 | 新增 `tests/diagnosticLogAuth.test.ts`，修复前两条断言为红，修复后转绿 |
| 验证 | `npm test` 481/481；`typecheck:api`；lint 0 errors / 0 warnings；`npm run build`；`serve:build`；`git diff --check` |
| 说明 | 修复在前端，dev 站点需重新构建部署后生效；管理员会话本身 24 小时有效，真正过期时仍需重新登录 |
| 推送 | 待用户确认后推送 `future/upload/main` |

## 2026-09-12 诊断队列运行闭环（P0）

| 项目 | 状态 |
|---|---|
| 背景 | 重试端点此前没有任何调用方，失败包只会停在 `failed`；队列也无法从状态页观察 |
| 共享实现 | 新增 `api/_diagnosticQueue.ts`（领取/租约/退避/发送/drain/统计）与纯策略 `api/_diagnosticQueuePolicy.ts`，管理员端点与 Cron worker 共用同一份逻辑 |
| Cron 入口 | 新增 `GET /api/diagnostic-worker`（并入 `system.ts`，同步 `vercel.json` rewrite 与 `server/routes.ts`）；默认 10 条、上限 25 条、8 秒预算，返回 `considered/sent/failed/released/remaining/durationMs` |
| 鉴权 | 可选 `DIAGNOSTIC_WORKER_SECRET`：配置后要求 `Authorization: Bearer` 或 `x-cron-secret`；未配置时与 `/api/email-worker` 一致开放，只返回计数 |
| 可观测性 | `/api/status` 新增 `diagnosticQueue`：`retained/queued/sending/sent/failed/expired/dueNow/nextAttemptAt/lastError` |
| 单元测试 | `tests/diagnosticQueuePolicy.test.ts`：退避 60/120/240s 封顶 1 小时、3 次上限、非法 limit 夹取 |
| 集成测试 | `tests/integration/diagnosticQueue.integration.test.ts`：真实 PostgreSQL 下并发领取不重复、未到期/已过期/超次数不领取、租约回收与统计 |
| 端到端 | 本地服务 + 临时库实测：无密钥 401；带密钥返回 `{ok:true,...}`；`/api/status` 返回 `diagnosticQueue`；管理员 retry 与 settings 正常 |
| 验证 | `npm test` 484/484；`typecheck:api`；lint 0 errors / 0 warnings；`serve:build`；`test:integration` 23/23；`git diff --check` |
| 说明 | 集成测试使用临时 PostgreSQL（55433，已停止并清理），未触碰本机 5432；`format:check` 仍剩 3 个本次未触及的既有文件 |

## 2026-09-12 诊断留存策略与过期清理（S1）

| 项目 | 状态 |
|---|---|
| S1-1 保留期失效 | 发送时写死 30 天，设置页的 `retentionDays` 完全不生效；改为按 `app_diagnostic_settings.retention_days`（1-30 天，默认 7）从创建时刻计算 `expires_at`，夹取逻辑统一进 `_diagnosticQueuePolicy.ts` |
| S1-2 过期包堆积 | 过期只改状态，`entries`（单包最大 1MB）永不回收；新增 `purgeExpiredDiagnosticBundles()`：过期即清空正文（`entry_count` 保留为历史计数），再过 30 天宽限期删除整行 |
| 触发方式 | worker / 管理员重试的 drain 每次先清理；设置页列表读取也会触发一次，未挂 Cron 的部署同样不会堆积 |
| S1-3 死状态 | `retained` / `queued` 从未被写入，已从 `/api/status` 的 `diagnosticQueue` 移除；数据库 CHECK 保留原值不做破坏性迁移，避免在旧库上重建约束失败 |
| 可观测性 | `diagnosticQueue` 新增 `expiredWithEntries`（过期但正文未清理的积压量）；drain 返回值新增 `purged: {clearedEntries, deletedRows}` |
| 索引 | 新增 `idx_diagnostic_bundles_expiry (status, expires_at)`，同步运行时建表与 `0003` 迁移 |
| 测试 | 单元：保留期夹取与过期时间（含 null → 默认 7 天、非 30 天断言）；集成：`diagnosticLogsHandler.integration.test.ts` 用真实 handler + 真实管理员令牌验证 3 天策略落地；`diagnosticQueue.integration.test.ts` 新增清正文/删行/保留活跃包三类断言 |
| 验证 | `npm test` 486/486；`typecheck:api`；lint 0 errors / 0 warnings；`serve:build`；`test:integration` 25/25；`git diff --check` |
| 端到端 | 本地服务实测：worker 返回 `purged` 计数，插入过期包后实际被清理（`clearedEntries:1, deletedRows:1`），`/api/status` 返回新的 `diagnosticQueue` 结构 |
| 环境 | 集成测试仍使用临时 PostgreSQL（55433），测试后已停止并删除；本机 5432 未改动 |

## 2026-09-12 管理后台：页面控件移出导航栏

| 项目 | 状态 |
|---|---|
| 诉求 | 进入「大型考试」「周测计划」时，左侧导航栏底部挂着运行模式/年级/班级选择，导航栏承担了页面状态；要求把这些内容放回页面本身，所有界面统一 |
| 结构 | 新增 `src/components/admin/AdminContextBar.tsx`：页面内上下文栏（运行模式/年级/班级），状态仍由 `AdminPage` 持有 |
| 导航栏 | `AdminTabBar` 只保留 8 个功能切换按钮，移除 modes 区块与 `has-context` 标记，相关 props 一并删除 |
| 页面接入 | `AdminPage` 在 `.admin-content` 内、页面正文之上渲染上下文栏，仅「大型考试 / 周测计划」显示（与原行为一致，其他页本就没有这些控件） |
| 样式 | `admin.css` / `admin-design.css` 的 `admin-tabbar__mode*` 规则迁移为 `admin-context-bar*`；桌面端为吸顶横排，移动端为页面内两列网格，左侧栏在 ≤700px 整体隐藏，功能切换交给底部 mobile-nav |
| 验证 | 真实界面实测（临时库 + 本地服务）：导航容器内 `admin-context-bar` 计数 0、页面内为 1；大型考试页 2 个字段、周测页 3 个字段；390px 宽度下左栏 `display:none`、上下文栏为两列网格、底部导航正常 |
| 回归 | `npm test` 486/486；lint 0 errors / 0 warnings；`npm run build`；`typecheck:api`；`git diff --check` |

## 2026-09-12 后台左侧栏滚动边界修复

| 项目 | 状态 |
|---|---|
| 现象 | 页面滚动时左侧导航栏"会一起滚动"、底部边界断层：栏顶钻到 sticky 页头下面，栏底距视口底还差 58px |
| 复现 | 缩小视口使文档可滚动（1280×300，滚动 286px）后实测：`rail.top=0`、`rail.bottom=242`、`viewport=300` → 底部空隙 58px，正好等于页头高度 |
| 根因 | 左栏在 `.admin-workspace` 里是 `position: sticky; top: 0; height: calc(100dvh - 58px)`：`top: 0` 会被 58px 高的 sticky 页头（z-index 100 > 24）盖住，而高度又按减去页头算，两者基准不一致 |
| 修复 | 在 `.admin-page` 上抽出 `--admin-header-h: 58px`，左栏改为 `top: var(--admin-header-h)` + `height: calc(100dvh - var(--admin-header-h))`，让 sticky 偏移与高度共用同一基准（701–900px 断点同步） |
| 验证 | 修复后同样条件下实测：`rail.top=58`、`rail.bottom=300`、底部空隙 0；常规视口（921×912）下左栏底边同样贴齐视口；大型考试页上下文栏仍吸顶在内容区顶部（`bar.top=content.top=58`）；390px 宽度左栏仍隐藏、底部导航正常 |
| 回归 | `npm test` 486/486；lint 0 errors / 0 warnings；`npm run build`；`git diff --check` |
| 环境 | 验证用临时 PostgreSQL（55433）与两个本地服务（3100/3101）已停止并删除；本机 5432 未改动 |

## 2026-09-12 商业化分层与开发差距定稿

| 项目 | 状态 |
|---|---|
| 新增文档 | `workspace/novora-commercial-readiness.md`：分界线、三条底线、现状能力归属、免费/专业/企业三档套餐、License 与 Entitlement 模型、`canUse()` 标识清单、版本映射、过渡策略、**开发差距（详细）**、最短收费路径 |
| 新增文档 | `workspace/novora-update-backup-plan.md`：镜像分发版升级与备份恢复方案（`.nbk` 包、updater sidecar、白名单操作、跨机恢复） |
| 分界线结论 | "让一间教室正常上课"的功能免费；"让一个人管住整个学校/多校区"的功能收费。Agent 是收费核心，组件免费、能力收费 |
| 收费版本定位 | **不是 v2.10**。v2.10 是闭源镜像起点；v2.11 埋 License 骨架（内测免费签发）；v2.12 Agent 就位；建议 v2.13 停止免费签发＝实际开始收费；v4.0 才接支付 |
| 差距 A（v2.8） | 迁移与回滚脚本缺失；考试详情页/编辑入口缺失；考试级操作 API 与操作日志缺失（`exam_record_operations` 表已建但从未写入）；发布前检查与发布记录缺失；旧数据端到端迁移测试缺失 |
| 差距 B（v2.9） | 设备 ID 仍是浏览器随机 UUID；无楼栋/教室空间模型（设备只能绑班级）；本校错误存储与学校运行日志 API 缺失。前两项是 Agent 硬前置 |
| 差距 C（v2.10） | compose 仍现场 `build`；`.github/workflows/docker-image.yml` 只 build 不 push；无 updater、无备份恢复实现 |
| 差距 D（v2.11） | 权限枚举里没有任何 License/套餐/功能开关概念 |
| 差距 E（v2.12） | Agent 完全未开始；作者端目前只有实例概览与错误中心 |
| 差距 F（v3.x） | 到期/宽限/设备数软限、作者端运营台、灰度与版本分组均未开始 |
| 非代码差距 | 仓库当前公开 MIT，需转专有许可并补 EULA/隐私/退款政策；定价、内测学校名单、支持渠道 |
| 进度盘点 | 学校服务端 2.7.6（HEAD 与 `future/upload/main` 一致）；v2.8 约完成 2/3（280 主干、281 服务端与列表、283 投影、284 归档复制已完成）；v2.9 心跳/在线判定/错误上报/本地日志/作者端错误中心已提前完成；作者端 1.16.0 今天仍在提交（错误趋势、诊断包分页筛选、实例报告） |

## 2026-09-12 推送记录（诊断 S1 + 后台导航改造 + 左栏边界修复）

| 项目 | 状态 |
|---|---|
| 远端 | `future/upload/main`，`6a81412 → 8fad953`（快进推送，无冲突） |
| 提交 | `35f2a37` 诊断留存与过期清理；`0c68384` 对应追踪文档；`eb296f0` 页面控件移出导航栏；`9ede747` 对应追踪文档；`a44bfeb` 左栏滚动边界修复；`8fad953` 对应追踪文档 |
| 说明 | 本次为前端外壳与诊断链路改动，dev 站点需重新构建部署后生效；`DIAGNOSTIC_WORKER_SECRET` 与 `/api/diagnostic-worker` 的 Cron 挂载仍待部署侧配置 |

## 2026-09-12 诊断日志界面控件统一

| 项目 | 状态 |
|---|---|
| 诉求 | 诊断日志界面的输入框、选择器、时间选择器全部改用项目统一格式，并要求以后新增界面同样遵守 |
| 替换 | 布尔复选框 → `Switch`；错误前/后秒数 → `set-input set-input--sm` + `inputMode="numeric"`；开始/结束日期 → `DateTimeField(mode="date", className="set-date-time-field")`；布局改为 `set-card__head` / `set-fieldset` + `set-row` + `set-label`，行内按钮包 `set-inline-actions` |
| 补齐 | 原先「保存保留策略」能保存却无法修改的 `retentionDays`，新增 `InlineSelect`（1/3/7/14/30 天，当前值不在预设时自动补入），与后端 1-30 天限制一致 |
| 约定沉淀 | 新增仓库根目录 `AGENTS.md`：写明「前端表单控件必须用统一组件」，附开关/选择器/日期时间/文本数字/行布局对照表与参考示例，供后续会话与新增界面遵循 |
| 验证 | 真实界面实测（临时库 + 本地服务 3102）：诊断日志区块内原生 `input[type=date]` 0 个、原生 `select` 0 个、`.set-switch` 1 个、数字输入 class 均为 `set-input set-input--sm`、`.set-date-time-field` 2 个、`.inline-select` 1 个；点击日期字段弹出项目自带 `.tdp-field` 选择器而非原生日期控件 |
| 回归 | `npm test` 486/486；lint 0 errors / 0 warnings；`npm run build`；`git diff --check`；`format:check` 仅剩 3 个既有文件 |

## 2026-09-12 大屏全屏体验三项改造（需求 4/5/6）

| 项目 | 状态 |
|---|---|
| 需求 4 结束提醒双层化 | 考试结束且仍全屏时先弹中央 `alertdialog`（「本场考试已结束」+ 主按钮「退出全屏」+「若画面仍全屏，请按 Esc 或 F11 退出」，自动聚焦退出按钮），6 秒后收缩为常驻提醒条；提醒条保留到真正退出全屏，关闭只收起、可用小图标重新展开；桌面贴顶部、移动端贴底部安全区；新增 `fullscreenchange` 驱动的清理（Esc / 系统手势退出同样生效） |
| 需求 5 双击指引 | 7 个设计组件的全屏按钮加 `data-fullscreen-toggle`；全屏下双击（`pointerup` 双触发，兼容鼠标与触摸）记录点击点，用 `getBoundingClientRect()` 定位真实按钮，绘制聚光圈 + 指向箭头，不再写死坐标；遮罩点击、Esc、退出全屏均可关闭；气泡与箭头按视口/安全区翻转收敛 |
| 需求 6 不再强制全屏 | 删除静置 1 分钟自动 `enterFullscreen` 与全屏遮罩；改为非阻塞提示条「建议全屏展示，画面更完整」+ 进入全屏 / 稍后（10 分钟静默）/ 不再提示（localStorage 永久静默），无人操作 20 秒自动收起；真正的自动全屏前移到欢迎页「进入大屏」点击手势内，并新增 `?autofs=1` 供同源 `window.open` 场景加载后尝试一次 |
| 坐标工具 | 新增 `src/utils/fullscreenGuide.ts`（`ringRect` / `arrowLine` / `placeBubble` / `clampNumber` 等纯函数）与 `tests/fullscreenGuide.test.ts`（10 条：边界夹取、安全区、边缘翻转、箭头落边、点击点落在按钮内等） |
| 约定沉淀 | `AGENTS.md` 追加「大屏设计组件必须标记全屏按钮」，新增设计漏标记会导致指引静默失效 |
| 验证 | 真实界面（临时库 + 本地服务 3104，用 SQL 造结束/进行中两场考试）：结束态弹窗 `role=alertdialog` 且焦点在退出按钮 → 6 秒后顶部条（top=14）出现并含收起按钮 → 收起/重新展开正常；双击后聚光圈覆盖真实按钮（ringCoversButton=true）、箭头从点击点指到按钮外沿、气泡在点击点旁，遮罩点击与 Esc 均可关闭；切到进行中考试后静置 60 秒只弹提示条（`fullscreen=false`、设计按钮仍为「进入全屏」），20 秒后自动收起 |
| 回归 | `npm test` 496/496；lint 0 errors / 0 warnings；`npm run build`；`git diff --check`；`format:check` 仅剩 3 个既有文件 |
| 环境 | 验证用临时 PostgreSQL（55433）与本地服务 3104 已停止并删除；本机 5432 未改动 |

## 2026-09-05 v2.8.0 学校服务端 T-280-01~03 收口

| 项目 | 状态 |
|---|---|
| `exam_records` 模型与迁移 | 已完成；含首次幂等回填、索引、健康检查和组件版本 `exams=4` |
| 单向投影与状态机 | 已完成；`exam_data.majors` 仍为权威来源，支持 `draft/published/ended/archived`，`ongoing` 列表层派生 |
| 生命周期 API | 已完成；列表分页/搜索/状态/作用域过滤，发布、结束、归档、反归档、复制 |
| 权限与一致性 | 已完成；权限、全局写槽、审计、幂等复制、`updated_at` 乐观并发保护 |
| 验证 | `npm test` 467/467；API/测试 TypeScript、lint、serve build、Prettier 全部通过 |
| 集成测试 | 未运行；当前环境未提供 `INTEGRATION_DATABASE_URL`，`127.0.0.1:15432` 无 PostgreSQL |

复制幂等键复用时返回冲突，且命中历史幂等结果会再次执行作用域校验，避免跨作用域泄露结果。下一步建议进入管理 UI 列表（v2.8.1 T-281-03/04），或先补齐独立 PostgreSQL 后执行集成矩阵。

## 2026-09-06 会话整理与追踪同步

### 同步内容

- 将根工作区最新的 `progress.md`、`task_plan.md`、`findings.md` 同步到 `workspace/`，并将其纳入版本控制。
- 记录 P1 数据库集成门禁结果：隔离 PostgreSQL 17（`127.0.0.1:15432`）上的 `npm run test:integration` 为 19/19 通过。
- 保留 future 仓库已更新的 v2.8 设计稿和 `novora-version-tasks.md`，未用旧工作区副本覆盖。

### 当前状态

- 追踪入口：`workspace/nas-sync-tracker.md`
- 最新进度：`workspace/progress.md`
- 当前任务计划：`workspace/task_plan.md`
- 当前发现与证据：`workspace/findings.md`
- 数据库集成门禁已通过；临时 PostgreSQL 已停止，`.tmp-pg-integration` 尚待手动清理。

## 2026-09-06 双端进度整理、对话归档与远端同步

### 双端更新

- 学校端 `nas-upload-worktree/upload/main`：`1fea6b8 feat: add manual diagnostic log upload`，远端 `Novora-future/future/upload/main` 已同步。
- 作者端 `exam-board-telemetry-author/main`：`aae5e5c feat: add diagnostic bundle intake and error sections`、`326de61 fix: persist diagnostic device and event ids`，均已推送到 `exam-board-telemetry/main`。
- 作者端随后提交 `c5c4734 feat: audit diagnostic bundle access` 也已推送，补充访问审计与后台关联展示。
- 作者端验证：`npm test` 9/9、`npm run typecheck`、`npm run build` 通过，工作树干净。

### 对话归档

- 索引：`workspace/conversation-index.md`。
- 原始导出：`share_6a92fda6.*`、`share_6a9bda6b.*`、`share_6a9bdada.*`、`share_6a9bdc53.*`。
- 主题覆盖版本规划、未来路线、考试功能和 WebSocket 稳定性评估。
- 不上传旧仓库、依赖目录、临时运行目录或数据库内容。

## 2026-09-13 考试中心合并、新建考试向导与 dev 巡检

### 本周改动（学校端 `nas-upload-worktree/upload/main`）

| 提交 | 内容 |
|---|---|
| `aba0617` | 服务端列表板块预设 `preset=current\|schedule\|draft\|history`，今天之内用上海自然日，四者互不重叠 |
| `622610c` | 一级菜单合并为「考试中心」，内部四板块；旧深链 `?tab=records\|major\|weekly` 映射到对应视图 |
| `02fc6b3` / `e27886e` / `ce6adfa` | 新建考试向导：类型选择 + 4 步；第 1 步落草稿；补齐科目编辑与 AI/JSON 导入入口 |
| `8eb8dbb` | 考试详情抽屉 + `GET /api/exams?resource=record-operations` 操作记录接口 |
| `f7aa7db` | 列表筛选与分页下推 SQL（一条 CTE 同时取总数与当前页） |
| `ac22b49` | 生命周期动作接入路由（start/pause/resume/extend + 幂等键 + 操作日志），发布时写考试窗口 |
| `3bd5eb2` | 修 `/local-settings` 桌面端无法滚动（固定外壳只应作用于系统设置页） |
| `9ffbacf` | 修 auth 配置缓存回归：清空 `app_auth` 后缓存仍返回已删除的行，导致密码正确却登录失败 |

### 验证

- `npm test` 542/542、`npm run typecheck:api`、lint、`format:check`、`npm run build` 通过。
- 真实库集成 42/43；唯一失败为 `diagnosticLogsHandler` 保留期用例（全量跑失败、单跑通过，与本批无关）。
- 界面核验：本机 Chrome 无头 + CDP 逐视图抓取截图（考试中心三板块、草稿折叠、归档开关、周测视图、详情抽屉、向导第 2/3 步）。

### dev 巡检关键发现

| 级别 | 结论 |
|---|---|
| P0 | 点「创建并继续」后背后视图被切成编辑器，显示的是旧草稿「111」而非新建的那场——即用户反馈的"不是我创建的考试" |
| P0 | 四次新建尝试均未出现在草稿列表，疑未落库，待服务端/DB 核对 |
| P1 | 关闭创建向导后主列表瞬间为空且不回来源视图 |
| P2 | 子页未进 rail 分层；选择器/复选框/输入框不统一；文字未挂 `--font-region-*` |
| 事实 | 列表里那条「大型考试」由初始化向导生成（`initializationData.ts:78` 写死名字，创建人"系统"） |

### 决定

- 初始化不再生成默认考试；关闭创建向导时对空草稿询问「保留 / 丢弃」（A 方案）；四个子页移入左侧 rail；标题统一为「考试中心」；全局统一控件样式并与字体分区联动。

### 产物

- `workspace/progress.md`、`workspace/findings.md`、`workspace/task_plan.md` 与本节同步更新。
- dev 巡检截图：`workspace/dev-exam-center-2026-09-13/`（`focus-after-close.png`、`focus-settled.png` 为 P0 证据，`dev-30-placeholder-detail.png` 为初始化占位考试详情）。

## 2026-09-12 ~ 09-13 两日全量清单

### 学校端 · 9/12（`nas-upload-worktree/upload/main`）

- 诊断链路：`1061daf` 上传重试加固、`dd776cd` 请求补 admin token、`83b96ea` 队列 worker 与状态统计、`35f2a37` 按保留期清理过期包。
- 后台外壳：`eb296f0` 运行模式/年级/班级移出 rail、`a44bfeb` 修 rail 滚动边界。
- 全屏体验：`060911b` 双层退出提醒 + `fullscreenchange` + 双击指引 + 静置改提示条，`4ee6e11` 记录。
- 控件统一：`b3be70c` 诊断日志页换统一表单控件，`2ee7af9` 记录。
- 系统设置：`eac5cf2` 左栏分组 + 分组视图、`aebd7d9` 隐藏分组 chip、`5d5353c` 诊断默认开启与内容居中。
- 备份/恢复：`550c1ec` 落地 → `ba851ab` 撤回（代码保留 `feature/db-backup-restore`）。
- 考试记录：`61b8e33` 暂停列与契约、`e247581` 操作规划器 + 单测、`5f0bef6` 投影与路由映射、`a0178cd` 操作日志列、`ac22b49` 动作接入路由、`8eb8dbb` 详情抽屉 + 操作记录接口、`49db5b1` 快速考试生命周期日志与归档只读。
- 性能：`f7aa7db` 列表筛选分页下推 SQL；`66c777b`/`e28d8ac`/`cd6edf4`/`35c6197` Vercel 心跳、快照 URL、同步传输与公告缓存优化。
- 修复：`9ffbacf` auth 配置缓存回归、`3bd5eb2` `/local-settings` 桌面滚动。
- 文档：`e840a37` 商用就绪与更新/备份方案。

### 学校端 · 9/13

- `aba0617` 服务端板块预设 + `622610c` 一级菜单合并为「考试中心」。
- `02fc6b3`/`e27886e`/`ce6adfa` 新建考试向导（类型选择、4 步、科目编辑、AI/JSON 导入）。
- `96473b6`/`fd34942` dev 巡检问题清单与截图入库。

### 作者端 · 9/12（`exam-board-telemetry-author/main`）

- 诊断包接入：`dae7fde` 隔离脱敏、`1ebfd7c` 剥离 URL host、`ad6c273` 体积配置、`22d19d2` token 能力测试、`a804ecc` Postgres 集成、`8a1fc29` 事件数组导入。
- 错误中心：`9f87117` P1 字段/筛选/白名单、`fb56717` 移动底部导航 + 生命周期测试、`cf35dc5` UNDEFINED_VALUE 修复、`9ba395b` 布局重建、`bc2afb8` 界面刷新、`7c03384` 诊断筛选。
- 实例与统计：`c7388ef` 归档/恢复、`1926b7b` 停用实例排除统计、`68f0ba1` 分页 + 全量统计、`bf314d0` 概览冒烟 + 绑定修复。
- 上报与趋势：`c62288e`/`20f6ebb` 上报学校展示与筛选、`0b2e0b5` 错误趋势、`a9551fb` 实例诊断报告导出、`2146e5a` 上报健康改按来数判定。
- 状态与审计：`91020f3` reviewed 状态、`98e9ea1` 契约更正、`70c693f` 审计日志页 + 内容预览 + 契约文档、`3a3995d` 集成夹具修复。
- 平台与数据：`6cb30d2` update-check、`abcfebd` 发布清单、`1aaa5a8` 单实例诊断面板、`9c5c77e` 健康看板、`f0ab56a`/`b92e1ed` JSONB 双编码修复、`97a1238`/`5fbb37f` 资产陈旧与中断归因。

### 作者端 · 9/13

- `beeb8f3` 作者端表格与标签的手机端可用性。

### 两日合计

- 学校端约 40 个提交（含 7 次远端 PR 合并）；作者端约 30 个提交。
- 学校端验证：`npm test` 542/542、`typecheck:api`、lint、format、build 通过；真实库集成 42/43（唯一失败为诊断包保留期用例，全量跑失败、单跑通过）。

## 2026-09-18 考试中心：详情「编辑考试」定位与返回保留筛选

### 学校端（`nas-upload-worktree/upload/main`）

| 提交 | 内容 |
|---|---|
| `dde0491` | 详情抽屉的「编辑考试」不再只跳 `?tab=major`：按记录 id 在快照里定位到**那一场**，当前年级看不到它就先把年级切到它所属的年级，再进编辑器；快照里没有这个 id（已删除的草稿或不是大型考试）给提示而不是乱跳。落点规则抽成纯函数 `resolveExamEditTarget`，补 7 条单测 |
| `dde0491` | 顺带补「返回保留筛选」：列表面板的筛选条件（关键词/年级/来源/创建人/归档开关/草稿区展开）改存内存快照（`utils/examListFilterMemory`），切板块、进编辑器再回来时保持原口径；分页刻意不记，回来从第一页开始 |
| `dde0491` | `majorAppliesToGrade` 收敛成一份实现（`utils/examRecordEditTarget`），`useMajorScheduleActions` 转调，避免「某年级能不能看到这场考试」出现两套判定 |

### 背景

- 抽屉里的「编辑考试」原来的 `navigate('/admin?tab=major')` 只落到编辑器视图，而编辑器展示的是「当前年级范围内按 `editingMajorId` 命中的那一场」——点开的常常不是用户点的那场，与 09-13 巡检反馈的「不是我创建的考试」是同一类问题。
- 列表面板由 `AdminPage` 用 `key={tab:view}` 挂载，切板块即卸载，`useState` 里的筛选条件原本会静默清零。

### 验证

- `npm test` 572/572（新增 7 条）；`npm run build` 通过。
- 全量 `npx tsc -p tsconfig.json` 仍有 5 条既有报错（`useMajorScheduleActions` 3 条、`useWeeklyScheduleSync` 1 条、`AdminPage(100)` 1 条），逐条与 `HEAD` 对比确认改动前既有，本轮未新增。
- **未做浏览器实测**：「点抽屉 → 编辑考试 → 返回看筛选」这条界面路径本轮只有单测与构建覆盖，需要一次 dev 站手工确认。

### 考试中心遗留

- 关闭创建向导时对空草稿询问「保留 / 丢弃」。
- 初始化不再生成默认考试（`src/utils/initializationData.ts` 仍写死名字「大型考试」）。
- 全局选择器/复选框/输入框统一（已起步：考试中心筛选换成 `InlineSelect`）、文字挂 `--font-region-*`。

## 2026-09-18 考试中心：板块进左栏 + 统一控件第一批

### 学校端（`nas-upload-worktree/upload/main`）

| 提交 | 内容 |
|---|---|
| `269401e` | 三个板块（当前考试/考试安排/历史考试）从内容区 rail 改成**左侧主导航栏里的缩进子项**：点击直接切板块并选中父项；`.admin-content--exam-rail` 与它的 208px 栅格、吸顶样式一并删除。为 `AdminTabBar` 加了通用子项能力（`.admin-tab-group` + `.admin-subnav`），其它一级菜单以后可直接挂。`ExamCenterNav` 只在 ≤700px（左栏整体收起）作为顶部分段条兜底；板块元数据收敛成一份 `EXAM_CENTER_NAV_ITEMS`，左栏子项与移动端分段条共用 |
| `6264d06` | 统一控件第一批：① 复选框——删除 `admin-item__select`、`admin-import-preview` 各自复制的一份方框实现，把 `major-wizard-items__toggle`、`time-range-cross-day`（原本是浏览器原生方框 + `accent-color`）等并入同一份规则；行内标签统一字号/间距/颜色，卡片式勾选行只共用方框、保留自己的网格；② 输入框与选择器——`admin-input`、`admin-date-time-field .tdp-field`、`InlineSelect` 触发器收敛到同一组 `--adm-ctl-*` 变量（36px 高、6px 圆角）；③ 字体分区——后台外壳补上导航/标题/数字三个 `--font-region-*` 区域（正文原本已挂），与教室大屏消费同一组变量 |

### 验证

- `npm test` 572/572；`npm run build` 通过。
- 全量 `npx tsc -p tsconfig.json` 剩余 5 条既有报错，与改动前一致（`useMajorScheduleActions` 3、`useWeeklyScheduleSync` 1、`AdminPage(100)` 1），本轮未新增。
- **未做浏览器实测**：左栏子项的观感、移动端分段条、统一后的复选框/输入框外观都需要在 dev 站确认一次（dev 上已有样本数据）。

### 统一控件剩余

- 开关类仍是三种实现（`set-switch` / `admin-switch` / `quick-major-track-match__switch`，前两者画在兄弟 `span` 上、后者画在 `input::after` 上），收敛需要改 3 处组件标记。
- `ExamRecordsPanel` 之外的列表/表格里的按钮、徽标等还没有统一到一套原语。
- 顶部标题文案仍是「考试管理」，与「考试中心」并存（09-13 巡检 P1-3）。

## 2026-09-18（第二批）开关收敛、标题、空草稿与初始化

| 提交 | 内容 |
|---|---|
| `6e0f09a` | 开关收敛成一份实现：新增 `styles/controls.css`（由 `admin.css` 与 `settings.css` 各自 `@import`，覆盖后台与系统设置两条互不相交的加载路径），轨道画在 `input` 自身、42×24、18px 圆钮、统一配色；`.set-switch` / `.admin-switch` / `.quick-major-track-match__switch` 三处旧实现删除，`Switch.tsx` 与提醒弹窗里那个空 `<span />` 一并去掉。顶栏标题从「考试管理」改为「管理后台」（旁边本来就渲染当前模块名，原来等于一页两个名字，巡检 P1-3）；归档只读提示里的「考试管理」改为「考试中心」 |
| `1289b9c` | 关闭创建向导时对空草稿追问「保留 / 丢弃」（A 方案）：只有本次向导建出来、且一条科目都没有的草稿会被追问，丢弃时按 id 删除并推送快照；有科目的草稿不打扰。初始化不再生成默认考试（以前非演示模式会写死一条名叫「大型考试」、创建人显示「系统」的占位考试） |
| `6769cc8` | 初始化行为补回归测试：非演示模式不产出任何考试、`activeMajorId` 为空；演示模式仍给一条 3 科示例 + 周测 |

### 验证

- `npm test` 574/574（新增 2 条）；`npm run build`、`npm run typecheck:api` 通过；全量 `tsc` 仍只有 3 条既有的 `useMajorScheduleActions` 报错。
- 构建产物核对：`AdminPage-*.css` 与 `settings-*.css` 两个 chunk 都含有统一的开关选择器（各 7 处），说明 `@import` 在两条加载路径上都生效；第一版曾把 `@import` 插到 `settings.css` 末尾（CSS 要求 `@import` 置顶），导致设置页拿不到规格，已修正。
- 仍未做浏览器实测（按用户指示 dev 由用户部署）。

### 考试中心总剩余

- 列表/表格里的按钮、徽标尚未统一成一套原语（按钮目前有 `admin-btn` / `set-btn` / `admin-item-btn` 三个族，尺寸分别是中/大/小，配色一致）。
- 巡检 P0-2「新建草稿未出现在草稿列表」需要在部署后到 dev 复核一次（本轮的空草稿改动与它相邻，但只覆盖「关掉空草稿」这一半）。

## 2026-09-18 dev 实测修复四项（弹窗边框 / 搜索框 / 科目行 / 草稿）

用户反馈四个现象，均在 dev 上用无头 Chrome + CDP 复现并定位（当时 dev 为 `6264d06` 版：左栏子项已在、顶栏仍是「考试管理」）。修复提交 `c10921b`。

| 现象 | 根因（dev 实测证据） | 修复 |
|---|---|---|
| 弹窗里输入框没有边框 | `--adm-ctl-*` 定义在 `.admin-page`，弹窗 portal 渲染到 body → `var()` 失效、`border` 整条作废回退 `none`（实测 `border: 0px none`、高度 33px） | 令牌搬到 `controls.css` 的 `:root`，使用处全部补兜底值 |
| 搜索框排版错误 | `class="sr-only"` 全项目未定义（自 `39799e1` 起），标签文字直接显示（实测 291×17）把输入框挤到第二行；标签同时被通用 label 规则改成单列 grid | 补通用 `.sr-only`；搜索标签用更高选择器锁回 flex 一行 |
| 复选框/控件重叠 | `.major-wizard-items li` 只定义 4 列却有 5 个子元素，末位按钮掉行压在科目名下 | 补齐第 5 列；≤820px 改两行布局；按钮文案回到「改时间」 |
| 草稿无法再次编辑 | `detailRecord` 只查主列表 `records`，草稿来自 `preset=draft` 请求，永远取不到 → 点草稿无反应（实测抽屉 `open:false`） | `records`+`drafts` 一起查；草稿行新增「编辑」按钮直达编辑器 |

另按需求调整：创建向导第 2 步不再在弹窗内联编辑科目，「+ 添加科目」与每行「改时间」直接打开编辑器（内联表单、`onSaveItem` 与相关状态一并删除），弹窗只保留只读清单与启用/删除。

### 验证

- `npm test` 574/574、`npm run build` 通过；`tsc` 仍只有 3 条既有 `useMajorScheduleActions` 报错。
- 用 `dist` 里的真实 CSS 搭本地静态页 + 无头 Chrome 量几何：`.admin-input` = `1px solid rgba(255,255,255,.14)`；搜索标签 `display:flex`、`.sr-only` 1×1；向导科目行 5 个子元素同处一行（行高 49px）。
- 桌面版看图工具不可用（`describe_ui`/`analyze_image`/`diagnose_error` 均返回 `Qwen3-VL-8B-Instruct has no provider supported`），用户截图内容未能读取，四项按文字描述 + dev 实测反推。
- 待用户部署后回 dev 复验。

## 2026-09-18 统一控件收口（按钮）

| 提交 | 内容 |
|---|---|
| `b5dfa1d` | 三族按钮收成一份规格：`.admin-btn`（中）/ `.set-btn`（大）/ `.admin-item-btn`（小）原本各写一套边框、圆角、字号、字重、过渡与禁用态（配色本来就是同一组）。现在 `styles/controls.css` 里是一份基础外观 + 三个尺寸档 + 一组语义变体（主要/幽灵/危险 + 启用/停用/编辑/删除），`admin.css` 与 `settings.css` 只留各自的排布与图标尺寸。按钮规格刻意不用 `var()`（弹窗 portal 到 body，页面级变量取不到会让整条声明作废） |

### 「统一控件」整体状态（09-13 巡检 P2 的三条）

| 项 | 状态 |
|---|---|
| 选择器 | 全仓无原生 `<select>`，筛选/设置都用 `InlineSelect`；选择器与输入框共用同一组尺寸令牌 |
| 复选框 | 一份方框+对勾规则覆盖全部写法（原先十几处各写一套，其中两处复制、两处用浏览器原生框）；行内标签统一排版，卡片式勾选行只共用方框 |
| 输入框 | `admin-input` 与日期时间字段共用一组令牌（36px/6px/同描边），令牌挂在 `:root` 以适配弹窗 |
| 开关 | 三处实现（set-switch / admin-switch / quick-major-track-match__switch）收成一份 |
| 按钮 | 三族收成一份（`b5dfa1d`） |
| 状态徽标 | 检查过：`.exam-records-status` 本来就是单一来源，无分叉 |
| 字体分区 | 后台外壳已挂导航/标题/正文/数字四个 `--font-region-*`，与教室大屏同一组 |

### 验证

- `npm test` 574/574、`npm run build` 通过。
- 用 `dist` 真实 CSS 搭静态页量几何：三个尺寸档分别为 `5px 12px/12.8px`、`8px 14px/13px/8px 圆角`、`4px 10px/12px`，变体配色一致（主要 `#3498db`、危险 `rgba(231,76,60,.08)`+`#ff8a7d`、启用绿、停用琥珀）。

## 2026-09-18 部署后复验（dev = `b9706b5`）

用户部署后，用无头 Chrome + CDP 逐项复验（读 DOM 几何与 computed style）：

| 复验项 | 结果 |
|---|---|
| 站点版本 | 左栏子项 3 个；顶栏「管理后台 · 考试中心」——最新构建已上线 |
| 产物断言 | `--adm-ctl-*` 在 `:root`、`.sr-only` 规则存在、向导行 5 列规则存在、按钮统一规格存在、旧 `admin-content--exam-rail` 已消失（6 张样式表 / 266KB 全库检索） |
| 弹窗输入框边框 | `1px solid rgba(89,184,241,.72)`（该框自动聚焦，所以是聚焦色）、高度 36px、`min-height` 生效 |
| 搜索框 | `display:flex`，图标与输入框同一行，`.sr-only` 为 1×1（不可见） |
| 草稿 | 列表 3 条，每条都有「编辑」；点行 → 抽屉打开（标题 77，按钮：编辑考试 / 发布 / 复制）；点「编辑」→ 编辑器打开 |
| 归档复选框 | 18×18、`appearance:none`、标签 `inline-flex`，与文字无重叠 |
| 字体分区 | `.admin-tabbar` / `.admin-tab` / `.admin-header__title` 的 font-family 等于对应 `--font-region-*` 变量值 |

**顺带发现并修复**：关闭创建向导后列表会先闪一块空白（关掉瞬间 `rows:0` + 「正在读取考试记录…」，几秒后回到 4 行）——即巡检 P1-1。列表面板刷新时无条件把表格换成占位；现在只有「首次加载且还没有任何行」才用占位，有数据时保留列表并轻微降透明度（`6ff2922`，待部署复验）。

dev 遗留数据：草稿 3 条（`77`、`Codex巡检-可删`、`122`），其中 `Codex巡检-可删` 为 09-13 巡检留下的 0 科草稿；目前没有显式删除草稿的入口，已列入任务清单第 1 项。

## 2026-09-18 向导流程、编辑器工具栏与筛选栏重叠（`ad38ac7`）

| 项 | 处理 |
|---|---|
| 新建向导第 3 步 | 不在弹窗里编辑：草稿落库后弹窗立即收起、直接进编辑器填科目，左下角常驻提示「编辑完成后点击下一步」；提示里的「下一步」把向导按原填写内容恢复到「确认」步骤（快照 `wizardSnapshotRef`），继续存草稿或保存并发布 |
| 编辑器工具栏 | 去掉「切换考试 / 快速发布 / 新建大型考试」三个入口——编辑器只管这一场的科目与时间；切考试、快速发布、新建都走考试中心的「创建考试」菜单，相关 props 一并清理 |
| 筛选栏重叠 | 年级/来源的 InlineSelect 渲染成 `span.set-input`，拿不到筛选栏那条统一外观，却继承了设置页 `.set-input` 的 `min-width:220px`，而网格列只有 120px → 溢出压住右边控件。网格改为与控件数一致的 4 列，并给 `.exam-records-filters .inline-select/.inline-select__trigger` 与输入框一致的外观（38px、同描边底色）；组件不再借用设置页类名 |

本地量测（真实 dist CSS）：4 列 398/249/249/249px，三个筛选控件与列宽完全对齐，无溢出、无相交。

另：考试安排的「信息密度」优化方案已写入 `workspace/task_plan.md`（分组可折叠 → 行内信息收敛 → 筛选与分页 → 视图切换），待用户选定后实施。

## 2026-09-18 考试安排信息密度：方案 1+2 落地（`0383713`）

用户选定方案 1 与 2，已实施：

| 方案 | 落地内容 |
|---|---|
| 1 分组可折叠 | 今天/明天/本周内/更晚（历史页自然月）的分组头改成可点折叠 + 数量徽标 + 展开箭头；默认只展开最近两组（安排页=今天/明天，历史页=最近一个月），其余折叠；折叠状态与筛选条件同存内存快照，切板块回来保持 |
| 2 行内信息收敛 | 「创建人」列移出列表（详情抽屉可见），列数 7 → 6；适用范围在班级 > 2 时显示「高二 · 12 个班」；时间列改为「今天 08:30–10:30 / 明天 09:00–11:00 / 9/25 08:00–09:30」，跨天才补结束日期（抽成纯函数 `examTimeRange` + 4 条单测）；「科目数 + 来源」合成胶囊徽标 |

### 验证

- `npm test` **591/591 全绿**（并行那条线的两条失败已消失）；`npm run build` 通过。
- 本地真实 dist CSS 量测：表头与数据行均 6 列、顺序排布不换行；数量徽标为胶囊；分组头是可点按钮并带计数。
- 待部署后到 dev 复验（折叠默认态、分组计数、行内时间文案）。

### 方案 4 仍待选

「创建人」收进更多筛选、分页 12/25/50、周测区只显示前 5 条 + 还有 N 条。

## 2026-09-18 考试安排信息密度：方案 3+4 落地（`0ca45ad`）

| 方案 | 落地内容 |
|---|---|
| 4 筛选与分页 | 「来源」「创建人」收进「更多筛选」（收起时若有生效值，按钮显示数量）；筛选栏由固定列 grid 改为 flex 换行（列数本来就会随更多筛选变化，固定列数一旦对不上就出现空列/控件被挤出格子）；分页每页可选 12/25/50（默认 25）；周测区只列前 5 条 + 「还有 N 条」 |
| 3 视图与密度 | 「视图」切换：按考试 / 按班级；「密度」切换：舒适 / 紧凑（紧凑行高 40px、隐藏「科目」列，6 → 5 列）。按班级视图以班级为行（班级/年级/考试数/最近一场），展开列出该班命中的考试；口径为「当前筛选的当前页」，全校考试对每个班都算命中 |

视图、密度、每页条数、「更多筛选」展开态都随筛选项一起存内存快照，切板块回来保持。

### 验证

- `npm test` 591/591、`npm run build` 通过。
- 本地真实 dist CSS 量测：筛选栏一行放得下（搜索 603 / 年级 306 / 工具区 245，无溢出）；紧凑模式表头与数据行均为 5 列且「科目」单元格 0×0（已隐藏）；班级视图行 5 列。
- 待部署后到 dev 复验：更多筛选的默认收起与计数、视图/密度切换、分页每页条数、周测「还有 N 条」。

## 2026-09-18 刷新约定：状态只在按钮上（`6d82da9`）

用户要求：刷新时不要在前端把列表清空 / 置灰再刷，状态只显示在刷新按钮上（已刷新 + 时间），全站一致。

| 页面 | 处理 |
|---|---|
| 考试中心 | 去掉 `is-refreshing` 置灰；列表在刷新期间保持原样（占位只用于「首次加载且一行都没有」）；按钮换成 `RefreshButton` |
| 设备管理 | 按钮换成 `RefreshButton`；删掉列表上方「正在读取设备状态…」 |
| 系统设置 → 系统状态 | 按钮换成 `RefreshButton`（原来只有「刷新中…/刷新」，没有已刷新时间） |
| 用户与权限 | 加载时不再整块替换成占位，只在首次加载且无数据时显示；其余保留上一次的用户/角色列表 |
| 仪表盘 / 数据大屏 | 已符合约定（「更新于 HH:mm」／仅首次加载显示占位），未改动 |

新增 `components/admin/RefreshButton`：busy → 「刷新中…」+ 图标转圈；busy 转 false 时记时间 → 「已刷新 12:34」（悬停显示完整时间）；外观可传 `className`（后台 `admin-btn`、设置页 `set-btn`）。

验证：`npm test` 591/591、`npm run build` 通过。待部署后到 dev 复验。
