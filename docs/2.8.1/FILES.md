# v2.8.1 文件分类与资料状态

整理日期：2026-10-18。采用索引归档，保留原路径，避免破坏构建、导入和既有链接。下列目录覆盖当前仓库的源码、工具、文档和本地资料；共享模块属于版本依赖，不表示所有文件都在 v2.8.1 新增。

## 根目录与实现目录

| 位置                                                                 | 用途和维护方式                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/`                                                               | 前端入口、页面、组件、样式、设计方案、Hook、services、shared、utils 和类型；按功能修改，不按版本复制源码 |
| `api/`                                                               | Vercel HTTP 入口和 `_` 内部模块；包含学校业务、权限、初始化、平台用量、错误、诊断、运行日志和系统功能    |
| `server/`                                                            | 本地 Node 服务入口；需要与云端 API 行为一致                                                              |
| `migrations/`                                                        | 0003–0010 SQL 和已提供的 rollback；还须核对 API 中按需建表逻辑                                           |
| `tests/`                                                             | 根级单测与契约用例、`helpers/`、`integration/` 真实数据库用例                                            |
| `scripts/`                                                           | 增量验证、测试产物准备、集成测试运行、回填、清理和本地更新；回填/清理需先检查目标库和影响范围            |
| `public/`、`background.png`、`index.html`                            | 网站/PWA 静态资源、字体声明、预览图和 HTML 入口                                                          |
| `integrations/ClassIsland.ExamReminder/`                             | 插件源码、共享响应模型、配对/同步、提醒和设置；版本以 csproj/manifest 为准，不强制等于主应用版本         |
| `packaging/windows/`                                                 | Windows 工程、图标、Inno Setup、构建/安装/初始化/备份/恢复/卸载与 smoke；以该目录 README 为当前构建依据  |
| `package.json`、`package-lock.json`                                  | Node 版本、依赖和实际命令；使用锁文件保持可重复安装                                                      |
| `tsconfig*.json`、`vite.config.ts`、`eslint.config.js`、`.prettier*` | 前端/API/服务/单测/集成/回填配置与格式规则                                                               |
| `.github/`、`vercel.json`、`.vercelignore`                           | CI、部署与 rewrite；当前 CI 包含单测、构建、API/前端类型检查、服务构建和真实数据库集成                   |
| `Dockerfile`、`docker-compose.yml`、`.dockerignore`                  | 学校本地部署构建与数据库服务配置                                                                         |
| `.env.example`、`update-local.bat`、`update-local.sh`                | 环境模板和本地更新入口；真实 `.env` 属于本地配置                                                         |
| `.gitignore`、`.gitattributes`、`LICENSE`、`AGENTS.md`               | 源码边界、文本属性、许可证和 AI 开发约定                                                                 |

## 按功能定位代码与验证

| 功能                           | 主要入口（相对仓库根目录）                                                                                                                 | 现有验证入口                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 考试列表、详情、复制、生命周期 | `api/_exams/routes/examRecordRoutes.ts`、`examRecordProjection.ts`；`src/components/ExamRecordsPanel.tsx`、`ExamRecordDetailDrawer.tsx`    | `tests/examRecord*.test.ts`、`examLifecycle*.test.ts`、`tests/integration/examRecord*.integration.test.ts`                   |
| 同步与离线                     | `api/_exams/routes/examDataRoutes.ts`、`examSnapshotPatch.ts`；`src/services/examService.ts`、`examOutbox.ts`、`src/sync/transport.ts`     | `tests/examOutbox*.test.ts`、`examSnapshot*.test.ts`、`examMerge*.test.ts`、`tests/integration/examData.integration.test.ts` |
| 调度、当前考试与创建锁         | `api/_exams/scheduleCreationGuard.ts`、`src/components/exam-center/`、`src/utils/majorExamLock.ts`                                         | `tests/examCenterStatus.test.ts`、`examWindow.test.ts`、`quickMajor*.test.ts`、`scheduleConflict.test.ts`                    |
| 设备和命令                     | `api/_exams/routes/deviceAdminRoutes.ts`、`deviceSelfRoutes.ts`；`src/shared/deviceContracts.ts`、`src/components/DeviceHeartbeat.tsx`     | `tests/deviceCommandState.test.ts`、`deviceCommandReceipt.test.ts`、`deviceScope.test.ts`                                    |
| 学校/考试公告                  | `api/announcements.ts`、`api/_exams/routes/examAnnouncementRoutes.ts`、`src/services/announcements.ts`、`examAnnouncements.ts`             | `tests/announcement*.test.ts`、`schoolAnnouncement*.test.ts`、`tests/integration/examAnnouncement.integration.test.ts`       |
| 校时                           | `api/_system/time.ts`、`api/_exams/routes/timeControlRoutes.ts`、`src/services/timeControl.ts`、`src/utils/timeSource.ts`、`timeSync.ts`   | `tests/timeSource.test.ts`、`timeSync.test.ts`、`zonedTime.test.ts`                                                          |
| 运行日志                       | `api/_runtimeLogs/`、`src/utils/runtimeJournal.ts`、`src/services/runtimeLogClient.ts`、`src/components/settings/RuntimeDashboard.tsx`     | `tests/runtimeJournal.test.ts`、`tests/integration/runtimeLogs.integration.test.ts`                                          |
| 错误/诊断/遥测                 | `api/_telemetry/`、`api/_diagnosticQueue.ts`、`api/diagnostic-logs.ts`、`src/services/errorReport.ts`、`diagnosticLogs.ts`、`telemetry.ts` | `tests/errorReport*.test.ts`、`diagnostic*.test.ts`、`telemetry*.test.ts`、诊断集成用例                                      |
| 平台用量                       | `api/_platformUsage/`、`src/services/platformUsage.ts`、`src/components/settings/PlatformUsageSection.tsx`                                 | `tests/platformUsage.test.ts`、`platformForecast.test.ts`                                                                    |
| 插件兼容                       | `api/_exams/plugin.ts`、`routes/pluginRoutes.ts`、`integrations/ClassIsland.ExamReminder/`                                                 | `tests/plugin.test.ts`；插件真实配对/同步需另做联调                                                                          |
| Windows                        | `packaging/windows/README.md`、`Novora.ControlCenter/`、`Novora.ServiceHost/`、`Novora.Tray/`                                              | `Novora.ControlCenter.Tests/`、两个 smoke 脚本、目标机安装验收                                                               |

表中省略目录前缀的相邻文件沿用前一个目录。测试文件存在只说明已有验证入口，不等于本次已运行，也不代表覆盖所有产品验收场景。

## 所有正式说明文档

| 文件                                                                                                           | 状态/用途                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [README](../../README.md)                                                                                      | 用户入口与部署概览；v2.8.1 开发入口已挂在版本说明处                                  |
| [DEPLOY_LOCAL](../../DEPLOY_LOCAL.md)、[DEPLOY_NAS](../../DEPLOY_NAS.md)                                       | 当前部署参考；实际参数需核对配置                                                     |
| [UPGRADE-NOTES](../../UPGRADE-NOTES.md)                                                                        | 升级历史与兼容参考                                                                   |
| [PROJECT_MIGRATION](../../PROJECT_MIGRATION.md)                                                                | 迁移背景，执行前核对当前实现                                                         |
| [FEATURES-2.8.1](../FEATURES-2.8.1.md)、[CHANGELOG-2.8.1](../CHANGELOG-2.8.1.md)                               | 当前用户说明与变更记录                                                               |
| [CHANGELOG-2.8.0](../CHANGELOG-2.8.0.md)                                                                       | 历史发布记录                                                                         |
| [CLASSROOM_RUNTIME_LOGS](../CLASSROOM_RUNTIME_LOGS.md)                                                         | 一期客户端设计记录；“后台由另一条对话实现”等状态描述需核对后端，不能当成当前缺失结论 |
| [RUNTIME_LOG_API](../RUNTIME_LOG_API.md)                                                                       | 运行日志接口参考                                                                     |
| [AUTHOR_DIAGNOSTIC_LOG_SYNC](../AUTHOR_DIAGNOSTIC_LOG_SYNC.md)                                                 | 跨仓联调契约；“必须新增”是对接清单，不代表作者端当前一定未实现                       |
| [WINDOWS-CONTROL-CENTER-TASKS](../WINDOWS-CONTROL-CENTER-TASKS.md)                                             | Windows 已记录验证和目标机待验收项                                                   |
| [Windows README](../../packaging/windows/README.md)、[Assets README](../../packaging/windows/Assets/README.md) | 当前 Windows 构建/验证与资源约定                                                     |
| [ClassIsland README](../../integrations/ClassIsland.ExamReminder/README.md)                                    | 插件构建与配置                                                                       |
| [API 拆分记录](../../api/_exams/README.md)                                                                     | 历史模块拆分背景；不能按“覆盖/合并压缩包”步骤覆盖当前实现                            |
| [字体声明](../../public/fonts/FONT-NOTICES.md)                                                                 | 字体来源和许可，随资源保留                                                           |

## workspace 全部 Markdown 资料

| 文件（均位于 `workspace/`）                  | 使用状态                                               |
| -------------------------------------------- | ------------------------------------------------------ |
| `novora-development-roadmap-2026-10-18.md`   | 当前主路线；具体存储选型、阈值和版本排期仍需设计验证   |
| `novora-sync-evolution-plan-2026-09-25.md`   | 同步专项演进记录；开头的“现状”属于 2.8.0 当时基线      |
| `novora-version-tasks.md`                    | 旧版本任务库；不能按旧“未开始”推断当前未实现           |
| `novora-future-plan.md`                      | 旧总体路线；六个产品入口及新顺序以 2026-10-18 路线为准 |
| `novora-v2.8-design.md`                      | 2.8.0 设计/状态口径历史参考                            |
| `novora-subexam-editor-modal-plan.md`        | 待核对/待决策 UI 方案，不能默认批准实施                |
| `novora-update-backup-plan.md`               | 旧升级备份方案；Windows 实现以当前 packaging 文档为准  |
| `novora-architecture-review.md`              | 历史架构审查；发现项必须在当前代码中复核               |
| `novora-code-quality-report.md`              | 历史质量审查，旧错误数量不作为当前结论                 |
| `novora-remediation-plan.md`                 | 历史修复任务，与当前实现对照后再选任务                 |
| `novora-commercial-readiness.md`             | 长期商业化评估，不纳入 2.8.1 默认范围                  |
| `v2-7-5-integration-checklist.md`            | 历史 v2.7.5 集成验收记录                               |
| `task_plan.md`、`findings.md`、`progress.md` | 历史会话记录，保留追溯；当前任务以本目录发布检查表为准 |
| `nas-sync-tracker.md`                        | 历史 NAS 同步记录，不能据此直接推送旧工作线            |
| `conversation-index.md`                      | 历史对话索引                                           |
| `source-snapshot/PROJECT_MIGRATION.md`       | 历史源码快照内文档，不修改为当前规范                   |

## 本地资料、生成物与其它仓库

- `workspace/share*.html`、`*.messages.json`、`*.router.txt`：对话导出；`decode*.cjs`、`extract*.cjs`、`inspect*.cjs`、`trydecode.cjs` 为历史提取工具。保留作来源，不能作为产品运行依赖。
- `workspace/*.zip`、`source-snapshot/`：历史发行/源码快照；不覆盖当前源码。`exam-board-*-daily-test.json` 是样例，不导入学校库。
- `workspace/NuGet.Config`、`.gitignore`：工作区辅助配置，不替代正式插件/打包配置。
- `node_modules/`、`dist/`、`server-build/`、`.api-check/`、`.test-check/`、`.integration-check/`、`.tmp/`、`.tmp-*/`：依赖、输出和临时验证目录；本次不删除。
- `artifacts/`、`packaging/windows/artifacts/`、Windows 各工程 `bin/obj`：安装包、下载缓存、旧 UI 发布和 smoke 夹具。本次补齐忽略规则；保留磁盘文件，禁止将夹具凭据混入提交。
- Windows 旧 `Novora.Launcher*`、`Novora.Ui` 工程保留参考，当前构建以 WPF `Novora.ControlCenter` 为准，不在整理中删除或切换入口。
- 作者端、独立插件/同步仓库、外部部署文档仓库是本仓库之外的交付单元；本次仅登记接口与联调要求，不宣称已整理或验证它们的内部文件。

## 后续维护

新文件先归入上述类别；功能变更更新对应契约和发布清单。已有 Markdown 中若有旧结论，保留原始历史并在当前入口说明，不把历史测试结果冒充新验证。确需迁移或删除文件时另列来源、目标、引用修复和恢复方法。
