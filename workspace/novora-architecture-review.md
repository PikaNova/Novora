# Novora v2.7.3 架构审查

审查对象：`novora-remote-audit`，`main`，提交 `0850b00`，版本 `2.7.3`。本报告只做分析，不修改业务代码。

## 结论

当前架构是“React/Vite 前端 + Vercel Functions（兼容本地 Node HTTP 适配器）+ PostgreSQL/Neon + ClassIsland 集成”的模块化单体。这个选择与当前规模、双部署目标和团队维护成本匹配，暂时没有拆分微服务的必要。建议沿着“模块化单体 + 明确数据边界 + 可靠命令协议”演进，而不是重写或引入微服务。

但当前实现还不适合直接承载跨学校远程运维、长期设备管理或复杂考试生命周期。原因不是框架选错，而是共享数据模型、设备身份和命令语义还停留在轻量应用阶段。

置信度：高（基于源码、测试、构建和配置检查）。

## 当前结构

```text
Browser React/Vite
  ├─ localStorage/IndexedDB：本地设置、快照、离线 outbox、设备实例标识
  ├─ /api/exams：考试快照、周测、插件、设备绑定/心跳/命令
  ├─ /api/login、/api/users、/api/emailAuth：鉴权与账号
  └─ /api/telemetry、/api/error-report：同源中转到作者端

Vercel Functions 或本地 Node adapter
  ├─ api/_auth.ts、api/_exams/*、api/_dbAdapter.ts
  └─ PostgreSQL/Neon
```

现有优点：

- Vercel 与本地 PostgreSQL 共用 handler，部署适配层隔离得较好。
- 权限、范围、审计、令牌版本和登录锁定已有明确实现。
- ETag、乐观并发、三方合并和本地 outbox 形成了可用的离线保存基础。
- ClassIsland 配对、能力/版本信息和心跳路径已经分模块。
- 前端路由和大型依赖采用懒加载，安全响应头已配置。

## 关键风险

### A1 高：`exam_data` 是单例共享快照，而不是领域数据模型

证据：[`api/_exams/db.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_exams/db.ts:47) 创建 `id=1` 的 `exam_data`，把 `items`、`majors`、`weekly_plans`、`grades`、`classes`、`design_policy` 等多个域放在一行 JSONB；[`api/_exams/routes/examDataRoutes.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_exams/routes/examDataRoutes.ts:221) 每次保存都更新整行。

影响：

- 任一域的小修改都读取和写入整个快照，写冲突范围大。
- 记录列表、历史、审计查询和分页无法利用正常的关系索引。
- 多管理员、自动任务和设备状态并发增长时，单行会成为热点。
- 后续新增 `ExamRecord` 如果只加一张表而继续把真实状态写回快照，会产生双写、漂移和迁移复杂度。

判断：当前规模可接受；对 v2.8 的考试管理列表和历史归档不够合理。建议保留快照作为客户端同步协议，新增关系化考试元数据和生命周期表，逐步减少快照承担的职责。

### A2 高：`temporary_command` 不是可靠命令队列

证据：[`api/_exams/db.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_exams/db.ts:95) 只保存一个 JSONB 字段；[`api/_exams/routes/deviceAdminRoutes.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_exams/routes/deviceAdminRoutes.ts:393) 用 `UPDATE` 覆盖旧命令；[`api/_exams/routes/deviceSelfRoutes.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_exams/routes/deviceSelfRoutes.ts:127) 仅按命令 ID 清空。

影响：连续发送两条命令时前一条会被覆盖；没有 pending/claimed/acknowledged/failed/expired 状态、幂等键、过期时间、失败原因或历史回执。设备离线、重复心跳、服务重启和多管理员操作时无法证明“命令不丢、不重复”。

判断：适合低频演示性控制，不满足 v2.9 运行中心或 v3.1 Agent 的可靠性承诺。应新增命令表，先支持刷新/重新同步/提醒等低风险动作。

### A3 高：浏览器实例 ID 不是可信设备身份

证据：[`src/services/telemetry.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/src/services/telemetry.ts:49) 从 `localStorage` 读取或生成 `crypto.randomUUID()`；[`src/services/classBinding.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/src/services/classBinding.ts:398) 直接以该 ID 发心跳；服务端公开的绑定/心跳路径按 `instanceId` 更新设备状态（[`api/_exams/routes/deviceSelfRoutes.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_exams/routes/deviceSelfRoutes.ts:112)）。

影响：清理存储、复制浏览器配置或伪造 ID 即可冒充设备；心跳内容也由客户端上报。现有访客令牌会再次检查绑定和签名，降低了直接越权风险，但不能把此身份当作设备证明，也不能据此开放关机、更新或系统级控制。

判断：当前“看板状态 + 低风险页面命令”可用；Agent 阶段必须改为注册密钥/证书、撤销、轮换和恢复流程。

### A4 中高：请求期建表/迁移将部署健康与业务请求耦合

证据：[`api/_auth.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_auth.ts:219) 和 [`api/_exams/db.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_exams/db.ts:41) 使用模块级 Promise，在首次请求中执行 DDL；多条路由直接调用 `ensureAuthTables()`/`ensureTableOnce()`。

优点是新部署零配置，且 advisory lock 避免并发迁移冲突。代价是冷启动首请求变慢，DDL 权限/锁等待会表现为登录或考试 API 故障，多个函数实例也各自维护缓存。建议保留兼容兜底，但把正式迁移移入部署步骤，并增加 schema 版本和启动前检查。

### A5 中：`/api/exams` 仍是过载入口

证据：[`api/exams.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/exams.ts:36) 通过 action 字符串分发考试、插件、绑定、设备管理、设置和仪表盘；Vercel 路由配置也将通用 `/api/:path*` 交给函数。

当前拆分的子模块已经改善维护性，但公共契约仍混在一个端点，容易出现 action 漏校验、权限规则复用困难和文档不完整。短期无需改 URL；后续应按领域定义内部 command/query handler 和版本化契约。

### A6 中：作者端中转的隐私与可用性依赖外部服务

证据：[`api/_telemetryConfig.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/_telemetryConfig.ts:17) 默认指向作者域名；[`api/telemetry.ts`](C:/Users/Administrator/Documents/Codex/2026-07-23/nihao-2/novora-remote-audit/api/telemetry.ts:73) 上报实例、版本、校名、省份、UA 等元数据；中转失败会降级，不阻塞主业务。

这符合“作者端不持有考试正文”的边界，但默认开启且包含完整校名，需要在产品层明确同意、数据保留、删除和跨境传输政策。作者端配置不可用时的默认 `DEFAULT_CONFIG` 还会允许继续尝试上报，部署者应能显式关闭并验证关闭结果。

## 可扩展性评估

| 维度 | 当前状态 | 结论 |
|---|---|---|
| 单校、低并发看板 | PostgreSQL 单快照 + ETag | 可行 |
| 多管理员协作 | 乐观锁 + 三方合并 | 可行，但冲突粒度偏大 |
| 考试历史/分页 | JSONB 快照 | 不适合，需关系化元数据 |
| 设备状态展示 | 心跳 + 轮询 | 可行，非实时 |
| 可靠远程命令 | 单 JSONB 命令 | 不可承诺 |
| 跨学校控制 | 当前学校 API/身份模型 | 不可行 |
| Windows Agent 试点 | 现有心跳可复用 | 需先补设备身份和命令协议 |

## 建议的目标架构

保持模块化单体，划分四个内部边界：

1. **School Core**：学校、年级、班级、考试元数据、周测、账号、权限、审计。
2. **Sync Projection**：保留 `exam_data` 作为客户端兼容快照，由领域数据生成并带版本号。
3. **Device Runtime**：设备注册、绑定、心跳、命令、回执和设备审计。
4. **Author Relay**：只发送实例级运行质量数据，采用显式配置、采样、脱敏和保留策略。

推荐演进顺序：

1. v2.7.x：冻结现有协议，补真实数据库集成和契约测试。
2. v2.8：新增考试元数据/生命周期表；快照仍作为投影，不做破坏性替换。
3. v2.9：命令表、幂等键、状态机、回执和过期处理。
4. v3.0：作者端只读观测与数据治理。
5. v3.1：Windows Agent 注册密钥、撤销、签名命令和小规模试点。

## 不应做的架构动作

- 现在拆微服务：会增加部署、鉴权、观测和数据一致性成本，不能解决上述三个核心问题。
- 只新增 `exam_records` 表：如果保存路径仍以整行 JSONB 为准，会形成双写漂移。
- 仅延长心跳频率宣称实时控制：轮询不能提供实时或可靠投递语义。
- 仅依赖前端隐藏按钮保护设备和作者操作：必须由服务端权限、授权期限和审计保证。

## 验证限制

本次已完成依赖安装、单元测试、API 类型检查、前端构建、本地服务构建和 lint/格式检查。真实数据库集成测试未执行，因为项目要求独立的 `INTEGRATION_DATABASE_URL`；因此数据库吞吐、迁移耗时和真实并发结论属于架构风险判断，不是压测实测结果。
