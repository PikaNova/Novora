# Novora v2.8.0 设计方案（2026-09-24 按新约定修订）

状态：v2.8.0 主体已落地并经过 dev 实测；本文档的**状态机与验收口径已按 2026-09-19 的新约定更新**，
旧版里「新建考试默认草稿」「管理员手动开考（start）」「手动结束直接落 ended」的写法均已作废。

## 1. 目标与非目标

**目标**

- 考试管理从"单行 JSONB 快照整体覆盖"演进为 ExamRecord 关系模型 + 生命周期状态机。
- 支持考试列表、历史、归档、复制，不再依赖整行 `majors` 快照翻找。
- 旧客户端（离线 outbox、ETag、三方合并、ClassIsland 插件）零破坏兼容。

**非目标（本版不做）**

- 不拆微服务；不引入新 ORM 或迁移框架（延续 `api/_schemaMigration.ts` 门禁模式）。
- 不做跨校远程控制与设备命令队列（v2.9 前置设计，v2.8 不实现）。
- 不做多租户/商业化；不做考生账号、排考、阅卷、成绩。

## 2. 现状与问题（修订时点）

- `exam_data.majors` 是**权威存储**，`exam_records` 是服务端单向投影；两者的一致性靠"同事务双写 + 幂等 upsert"保证。
- 生命周期推进已经实现为**系统自动**：到点自动开考、到点自动收场、管理员只能"申请停止"，由系统判定后真正结束。
- 惰性推进挂在读接口与设备心跳上，不依赖 Cron（见 §9 的运行口径）。

## 3. 数据模型

### 3.1 表 `exam_records`（单向投影，非权威）

```sql
CREATE TABLE IF NOT EXISTS exam_records (
  id            TEXT PRIMARY KEY,              -- 与 MajorExam.id 一致
  runtime_major_id TEXT NOT NULL,              -- 运行时快照里的对应 id（与 id 一对一）
  name          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft', -- 持久化只有 draft|published|ended|archived
  items         JSONB NOT NULL DEFAULT '[]',   -- ExamItem[]
  target_grade_ids JSONB NOT NULL DEFAULT '[]',
  target_class_ids JSONB NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'regular',   -- regular|quick
  temporary     BOOLEAN NOT NULL DEFAULT FALSE,
  priority_over_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  config        JSONB NOT NULL DEFAULT '{}',
  created_by    BIGINT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  start_at      BIGINT,                        -- 计划窗口（由科目时间汇总）
  end_at        BIGINT,
  actual_start_at BIGINT,                      -- 系统自动开考写入
  actual_end_at   BIGINT,
  paused_at     BIGINT,                        -- 暂停起点；非空表示正在暂停
  paused_ms     BIGINT NOT NULL DEFAULT 0,     -- 累计暂停时长（结束时结算）
  stop_requested_at BIGINT,                    -- 管理员申请停止的时刻；非空=「停止中」
  published_at  BIGINT,
  ended_at      BIGINT,
  archived_at   BIGINT,
  version       INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
```

- `id` 复用 `MajorExam.id`：前端数据结构零改动，映射层唯一。
- **状态只落四态**：`draft / published / ended / archived`。`ongoing`（进行中）与 `stopping`（停止中）
  都是**派生**的显示态，不落库（见 §3.3）。

### 3.2 投影策略（单向投影 + 状态提升）

- 每次保存管道写 `majors` 成功后，**同事务**内从 `majors` 全量重建（幂等 upsert）`exam_records`。
- **任何一次生命周期写入都必须双写**：人工动作（`examRecordRoutes`）与系统推进（`examAutoLifecycle`）
  都在同一个事务里写 `exam_data.majors` + `exam_records` + 操作日志，快照写入带
  `updated_at` 乐观校验与 `pg_advisory_xact_lock`。只有这样才能保证"权威永远只有一份、投影永远可重建"。
  2026-09-24 之前系统推进只写投影，导致教室端/插件/心跳（都读快照）看不到自动开考与自动结束，已修正。
- 投影重建时，运行时字段是**粘性**的：`actual_start_at/actual_end_at/ended_at/paused_*/stop_requested_at`
  用 `COALESCE(EXCLUDED.x, exam_records.x)` 保留；`archived_at` 同样 `COALESCE`，
  避免"status=archived 但 archived_at 为空"。
- 一致性自检：`GET /api/exams?resource=record-consistency` 用**同一个投影函数**重算后逐字段比对，
  返回漏投影 / 孤儿行 / 字段漂移三类差异（最多各 20 条示例）。

### 3.3 生命周期状态机（新约定）

```
创建（即发布，无"草稿期"）
   │
   └─→ published ──(到计划开始时间，系统自动写 actualStartAt)──→ ongoing（派生态，不落库）
          │                                                        │
          │  管理员「申请停止」→ stopRequestedAt 非空 → stopping（派生态，不落库）
          │                                                        │
          └────────(到点 / 全员回执 / 无设备宽限到期，系统判定)──────┴─→ ended ──archive──→ archived
                                                                            ▲                │
                                                                            └── unarchive ────┘
```

- **创建即发布**：新建考试不再先进草稿；向导第 1 步落库时就写 `publishedAt`。
  （旧版"新建考试默认草稿""复制考试进草稿"里，复制仍保持进草稿，见 T-284-02。）
- **开考由系统完成**：到计划开始时间，系统写 `actual_start_at`（写入的是**计划时间**而不是 now，
  后台晚几分钟才有人打开页面也不影响开考时间准确性）。因此**没有 `start` 这个人工动作**。
- **结束也由系统判定**，判据优先级：① 到点（`now ≥ end_at + paused_ms`，时间到就结束，不看回执）
  ② 本场范围内绑定设备全部回执"本场结束" ③ 无在线设备且超过 10 分钟宽限（无人监考兜底）。
  管理员点「结束」只是**申请停止**（`request_stop`），进入派生 `stopping`；判定不出来的极端情况有逃生门
  `force_end`（权限同删除考试）。
- **暂停/继续/延长**只改时间字段（`paused_at/paused_ms/end_at`），不改状态；倒计时基准是
  `effectiveEndAt = end_at + paused_ms`。
- **归档 = 软隐藏 + 保留历史**；反归档回 `ended`。**快速考试**结束满宽限期（默认 24 小时，
  `QUICK_EXAM_ARCHIVE_GRACE_HOURS` 可调，0=立刻）后由系统自动归档。
- 每次推进都写操作日志 `exam_record_operations`（含动作、前后状态、操作者或"系统"、以及
  **时间变更说明**，例如「延长 15 分钟：结束 2026/09/19 10:30 → 10:45」），并写 `app_audit_logs`。

### 3.4 表 `exam_announcements`（学校侧考试公告，一期）

```sql
CREATE TABLE IF NOT EXISTS exam_announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL DEFAULT 'normal',   -- normal | urgent
  exam_id    TEXT,                             -- 可空：绑定某场考试
  scope_type TEXT NOT NULL DEFAULT 'all',      -- all | grade | class（一期不做楼栋）
  scope_ids  JSONB NOT NULL DEFAULT '[]',
  created_by BIGINT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  status     TEXT NOT NULL DEFAULT 'sent'
);
```

- 与**作者端统一公告**（`/api/announcements`）是两条独立通道：那条是全局内容，这条是学校自己发的。
- 一期口径：范围只做 全校/年级/班级；**不做楼栋**（学校结构暂无楼栋字段）；**不需要回执**；
  `urgent` 在大屏**置顶且不可关闭**，并优先于作者端公告。

## 4. 兼容矩阵

| 消费方 | 现状 | v2.8 影响 | 策略 |
|---|---|---|---|
| 客户端 outbox / 三方合并 | 读 `majors` JSONB | 不变 | 零改动 |
| ETag / 版本比较 | `exam_data.updated_at` | 不变 | 零改动（系统推进也会 bump，因此客户端会重新拉取） |
| ClassIsland `/api/plugin` | `examPayload → resolvePluginExams` | 不变 | 零改动 |
| 设备心跳 current_exam | 服务端从 majors 计算 | 不变 | 零改动；心跳顺带触发惰性推进 |
| 大屏公告 | 作者端统一公告 | 新增学校侧公告通道 | 新增 overlay 区块，紧急置顶不可关 |
| 管理端列表/历史 | 全量 majors 下发 | 新增 records 查询（分页/归档过滤/筛选下推 SQL） | 新接口，旧路径保留 |
| 复制考试 | 前端深拷贝 | 服务端 `record-copy`（幂等键），新考试进草稿 | 新 API |

## 5. API 增量

**读（GET `/api/exams`）**

- `?resource=records&preset=current|schedule|draft|history&page=&pageSize=&q=&gradeId=&source=&createdBy=&includeArchived=`
- `?resource=record-operations&id=…`：详情页的操作记录时间线（含时间变更说明）。
- `?resource=record-precheck&id=…`：**发布前检查**（科目时间完整性 + 目标范围设备在线情况），
  按产品口径**只提示、不阻断发布**。
- `?resource=record-consistency`：投影一致性自检（只读）。
- `?resource=announcements`：学校侧公告回看（管理端）。
- `?resource=device-announcements&instanceId=…`：教室端按绑定班级/年级拉取未过期公告（`urgent` 优先）。

**写（POST `/api/exams`）**

- 状态机动作：`record-publish / record-end / record-archive / record-unarchive / record-copy`。
- 时间字段动作：`record-pause / record-resume / record-extend`（要求 `Idempotency-Key`）。
- 停止语义：`record-request-stop`（申请停止）、`record-force-end`（逃生门）。
- 公告：`announce-send`。
- **没有 `record-start`**：开考由系统按计划时间完成。
- 系统动作（`auto_start / auto_end / auto_archive`）只由服务端写入，不对外暴露成路由。
- 全部走 `requireActor` + `writeAudit` + 权限（见 §3.3）+ 全局写槽；`copy/extend` 需要幂等键。

## 6. 迁移与回滚

- `_schemaMigration` 步骤：建表 + 首次全量回填；运行时 DDL 与迁移文件双份维护（schema 版本记到 5）。
- 迁移文件：`migrations/0004_create_exam_record_tables.sql`（+ rollback）、
  `migrations/0005_create_exam_announcements.sql`（+ rollback）。
- 回滚：`DROP TABLE exam_records` / `DROP TABLE exam_announcements` 均为纯投影/独立表，无损；`majors` 始终权威。
- 集成测试覆盖：空库建表、旧库升级、重复执行、回滚、投影一致性、并发保存原子性、转换审计（见 §8）。

## 7. 任务拆分与状态（对应版本表 v2.8.0）

| 任务 | 内容 | 状态 |
|---|---|---|
| T-280-01 | `exam_records` 表结构 + 迁移门禁 + 回填 | ✅ |
| T-280-02 | 单向投影器 + 一致性自检 | ✅（自检接口 `record-consistency` 于 2026-09-24 补齐） |
| T-280-03 | 生命周期 API（publish/end/archive/copy）+ 审计 | ✅ |
| T-280-04 | 考试列表/历史/归档 UI（分页 + 归档过滤） | ✅ |
| T-280-05 | 复制考试 server action（幂等键） | ✅ |
| T-280-06 | 集成测试矩阵 | ✅ |
| — | 系统自动开考 / 判定结束 / 申请停止 / force_end | ✅（2026-09-19 新约定） |
| — | 暂停/继续/延长 + 时间变更说明（旧 → 新可见） | ✅ |
| — | 发布前检查 + 发布记录（范围与设备规模） | ✅ |
| — | 学校侧考试公告一期（全校/年级/班级） | ✅ |
| — | 快速考试结束归档策略（T-283-03） | ✅ |
| — | 考试中心三板块 / 左栏子项 / 分组与密度 / 统一控件 | ✅（详见 `workspace/nas-sync-tracker.md`） |
| — | 公告二期（楼栋、与考试自动联动、模板与撤销） | ⬜ |
| — | 完整闭环验收（T-286-07） | ⬜ 待部署后执行 |

## 8. 验收出口

- 单测与集成场景全过（含空库回填、旧库升级、投影逐字段一致、并发保存原子性、转换审计、
  系统自动开考 + 申请停止 + 到点判定结束的端到端）。
- 旧客户端（未刷新缓存的浏览器）在 v2.8 服务端上保存/同步成功；ClassIsland 插件与设备心跳契约回归通过。
- **时间变化可见**：延长 / 暂停恢复 / 系统判定结束之后，列表显示「时间已调整」、详情显示新旧时间原文。
- **发布前检查提示设备在线**，但不阻断发布；发布记录能回答"投给了哪些教室"。
- **学校侧公告**：范围过滤正确、过期不展示、紧急置顶不可关闭、审计可查。
- 完整闭环（创建→编辑→发布→大屏显示→控制→结束→归档→复制）在 dev 上跑通一次。

## 9. 运行口径：惰性推进（无 Cron）与"准点"的边界

**推进方式**：开考 / 判定结束 / 快速考试归档都挂在读接口（列表、详情）与设备心跳上，
每次请求顺带推进一次，不依赖 Cron——本地部署与 Vercel 行为一致，也不会因为进程重启丢任务。
并发安全靠条件更新（只有"还没开考/还该结束/还该归档"的那一次会写成功），写成功才记操作日志。

**验收口径（正式）**：

- 有读请求或设备心跳时，状态在**该次请求发生时**补记；开考时间写的是**计划时间**，不是请求时间。
- **没有任何读请求与心跳时不会推进**：那间教室断网关机、又没人打开后台时，
  记录会停在 `published`，直到下一次访问或心跳才补记。
- 因此现场"准点"的保证来自**客户端本地判时**（大屏按本地时间自己判断开考/结束的界面状态），
  服务端记录只保证"最终一致"，两者最多差一次请求间隔（考试期间设备心跳约 5 分钟一次）。
- 如果业务上要求"后台记录也必须准点"，再单独引入定时机制（Vercel Cron 或本地常驻定时器），
  不影响上面的惰性路径；这是显式的后续选项，不是当前实现的缺陷。
- 系统判定结束**只做状态同步**：教室端下一次心跳拉到新版本（`exam_version` 来自
  `exam_data.updated_at`）后同步状态，**不会把大屏踢出考试界面**。
