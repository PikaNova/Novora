# v2.8.1 开发资料入口

本文档是 Novora v2.8.1 的文件索引、开发边界和验证入口。新改动先判断是否属于本版本；属于本版本的契约、测试、部署或文档都应从这里登记。

整理日期：2026-10-18。此处状态是开发基线，不代表已完成发布验收。

- [完整文件分类与历史资料索引](FILES.md)
- [收尾任务、执行顺序与发布检查表](RELEASE-CHECKLIST.md)
- [AI 编码规则](../../AGENTS.md)

## 当前状态

| 项目       | 值                                                                       |
| ---------- | ------------------------------------------------------------------------ |
| 应用版本   | `2.8.1`（见 `package.json`）                                             |
| 当前工作线 | `push/future-main-exam-copy-fix`                                         |
| 版本主题   | 考试管理基础、教室运行可观测性、时间同步、学校服务部署                   |
| 数据边界   | 学校考试正文留在学校服务端；作者端只接收脱敏的实例、版本、错误和诊断数据 |
| 稳定性重点 | `exam_data` 读契约、离线 outbox、ETag、域级 revision、设备命令幂等       |

## 文件地图

### 版本说明与路线

- [CHANGELOG-2.8.3.md](../CHANGELOG-2.8.3.md)：后台考试快照修改与教室端同步可靠性修复及发布验证状态。
- [FEATURES-2.8.1.md](../FEATURES-2.8.1.md)：面向用户的功能说明。
- [CHANGELOG-2.8.1.md](../CHANGELOG-2.8.1.md)：发布变更和升级说明。
- [WINDOWS-CONTROL-CENTER-TASKS.md](../WINDOWS-CONTROL-CENTER-TASKS.md)：Windows 控制中心已完成项和目标环境验收项。
- 2026-10-21 更新页卡片与操作反馈、记录/缓存/匿名统计展示已实现，合并设备 `pluginLastSeenAt` 解析；本轮验证和未重新打包的边界见上述实施清单。
- [novora-development-roadmap-2026-10-18.md](../../workspace/novora-development-roadmap-2026-10-18.md)：当前产品入口、阶段路线和出口条件，作为后续开发主路线。
- [novora-version-tasks.md](../../workspace/novora-version-tasks.md)：版本任务总表；其中 v2.7.x 和旧版本内容是历史参考，v2.8.x 条目按本入口的当前状态执行。
- [novora-future-plan.md](../../workspace/novora-future-plan.md)：产品边界和长期架构决策。
- [novora-v2.8-design.md](../../workspace/novora-v2.8-design.md)：v2.8 数据模型和状态机设计；开发前核对其中已废止的旧口径。
- [novora-sync-evolution-plan-2026-09-25.md](../../workspace/novora-sync-evolution-plan-2026-09-25.md)：同步演进和不变量记录。
- [novora-subexam-editor-modal-plan.md](../../workspace/novora-subexam-editor-modal-plan.md)：待拍板的界面方案，不能当作已实现功能。

### 运行日志、诊断与作者端上报

- [CLASSROOM_RUNTIME_LOGS.md](../CLASSROOM_RUNTIME_LOGS.md)：教室端日志字段、脱敏和上传边界。
- [RUNTIME_LOG_API.md](../RUNTIME_LOG_API.md)：运行日志 API 契约。
- [AUTHOR_DIAGNOSTIC_LOG_SYNC.md](../AUTHOR_DIAGNOSTIC_LOG_SYNC.md)：作者端诊断同步契约。
- `src/services/runtimeLogClient.ts`、`src/services/diagnosticLogs.ts`、`src/services/errorReport.ts`：客户端采集和上报。
- `api/_runtimeLogs/`、`api/_diagnosticQueue.ts`、`api/diagnostic-logs.ts`：学校服务端接收、存储和队列。

### 考试、同步和设备代码

- `api/_exams/`：考试 API 的内部模块；路由、数据库、payload、权限、考试记录、公告、设备和时间控制均在此处。
- `api/exams.ts`、`api/announcements.ts`：对外 API 入口。
- `src/services/examService.ts`、`src/services/examOutbox.ts`、`src/services/examRecords.ts`：考试读写、离线队列和考试记录。
- `src/sync/transport.ts`、`src/hooks/useExamSync.ts`、`src/hooks/admin/useAdminSyncEngine.ts`：同步传输和管理端同步。
- `src/shared/examContracts.ts`、`examRecordContracts.ts`、`examSaveDiff.ts`、`examSnapshotDelta.ts`、`deviceContracts.ts`：跨端契约；设备命令当前状态为 `pending → claimed → acknowledged|failed|expired`。
- `src/components/exam-center/`、`src/components/ExamRecordsPanel.tsx`、`src/components/DeviceStatusPanel.tsx`：当前考试、考试记录和设备状态 UI。
- `integrations/ClassIsland.ExamReminder/`：ClassIsland API v2 配对和考试同步插件。

### 数据库迁移

- `migrations/0003_create_diagnostic_log_tables.sql`
- `migrations/0004_create_exam_record_tables.sql` 及对应 rollback
- `migrations/0005_create_exam_announcements.sql` 至 `0008_exam_announcement_ops.sql` 及对应 rollback
- `migrations/0009_exam_data_revisions.sql` 及对应 rollback
- `migrations/0010_runtime_logs.sql`

修改迁移时验证空库、旧库、重复执行和回滚/备份恢复；不是所有迁移都有独立 rollback SQL。变更前后都要确认 `exam_data` 旧客户端仍可读写。

### 部署和打包

- [packaging/windows/README.md](../../packaging/windows/README.md)：Windows 自包含安装器、控制中心、服务、托盘、备份和冒烟验证。
- [packaging/windows/UPDATES.md](../../packaging/windows/UPDATES.md)：Windows 签名应用更新、发行信任配置、作者端推荐、离线包与恢复边界。
- `packaging/windows/`：Windows 安装、初始化、服务、控制中心和 smoke 脚本。
- [DEPLOY_LOCAL.md](../../DEPLOY_LOCAL.md)、[DEPLOY_NAS.md](../../DEPLOY_NAS.md)：本地 Node/PostgreSQL/Docker 部署。
- `server/`：本地学校服务端；`docker-compose.yml`、`Dockerfile`：容器部署。
- `integrations/ClassIsland.ExamReminder/`：插件工程和 manifest。

Linux 原生安装包尚未纳入 v2.8.1；当前只把 Docker/Node 部署作为基线，systemd 和发行包属于后续阶段。

### 测试

- `tests/`：单元和契约测试；考试、同步、公告、设备、诊断、运行日志、权限和部署配置均有对应用例。
- `tests/apiContracts.test.ts`：覆盖设备列表 `pluginLastSeenAt` 心跳解析，防止 ClassIsland 正常同步时误报离线；2026-10-21 定向 `verify:fast` 的 31 项测试及编译、lint/format 通过，尚未发布。
- `tests/integration/`：真实 PostgreSQL 集成测试。
- `packaging/windows/smoke-controlcenter.ps1`、`smoke-install-progress.ps1`、`smoke-install-runner.ps1`、`smoke-initialize-services.ps1`、`smoke-native-process.ps1`、`smoke-initialize-atomic.ps1`、`smoke-backups.ps1`、`smoke-updates.ps1`：Windows 界面、安装失败传播、数据库配置修复、初始化启动与建库、备份恢复和更新迁移的隔离冒烟测试；验证状态见 Windows 实施清单。
- [package.json](../../package.json)：`verify:fast`、`verify:full`、`test:integration` 和 Windows 命令入口。

## v2.8.1 不变量

1. `exam_data` 仍是教室端和 ClassIsland 的运行读源，字段语义不得破坏。
2. 离线编辑必须进入 outbox；网络恢复、重复提交和冲突处理不得静默丢数据。
3. ETag、`updated_at`/域级 revision 和条件写入必须保留；新增写接口必须说明基线版本。
4. 设备命令必须有权限检查、过期时间、幂等键、状态回执和审计记录；不得执行任意 shell。
5. 作者端不得读取考试正文、班级名单或学校业务明细。
6. 新增字段先写共享契约和测试，再接 UI；兼容旧客户端后才能改变读写路径。

## 开发顺序与完成标准

1. 先完成考试闭环、同步回归、设备命令状态和作者端上报文档。
2. 再验证数据库迁移、Windows 打包和本地部署。
3. 代码改动按范围执行 `npm run verify:fast`；纯文档检查格式、链接和 diff。发布前执行 `npm run verify:full`、前端类型检查、服务构建和真实 PostgreSQL 集成测试，见发布检查表。
4. Windows 发布还需要控制中心、备份 smoke，以及目标 Windows 10/11 或 Server 的安装、升级、卸载验收。
5. 每项完成的任务同时更新本入口、变更日志和对应路线任务的状态；未完成项写明阻塞证据，不用“基本完成”代替验收。

## 文件状态约定

- **当前有效**：本入口、`docs/` 中 v2.8.1 文档、实现代码、迁移和测试。
- **路线参考**：`workspace/novora-development-roadmap-2026-10-18.md`、`novora-future-plan.md`、`novora-version-tasks.md` 中与当前基线一致的部分。
- **历史参考**：v2.7.x、v2.8.0 计划和审查记录；除非任务明确要求，不按历史计划直接改代码。
- **生成物/临时文件**：`dist/`、`server-build/`、`.test-check/`、`.api-check/`、`.tmp-*`、`artifacts/` 和 Windows `bin/obj` 不作为源码或文档依据，也不提交到版本库。
