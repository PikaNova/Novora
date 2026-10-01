# Novora v2.7.3 问题修复方案

基线：`novora-remote-audit`，`main`，`0850b00`，版本 `2.7.3`。

原则：先处理可能改变数据正确性的缺陷，再治理接口契约，最后做需要迁移和兼容窗口的架构改造。每批改动独立验证、可回滚，不做大范围自动 `lint:fix`，不在没有集成环境时宣称数据库改造已验证。

## 总体顺序

```text
P0 同步闭包与 Hook 依赖
  -> API/客户端契约收紧
  -> 数据库集成门禁
  -> 持久化设备命令队列
  -> 考试元数据与生命周期
  -> 大文件拆分与依赖升级评估
```

## 阶段 0：建立修复基线

范围：不改业务行为。

- 固定 v2.7.3 基线和当前测试快照。
- 保留 `npm test`、API 类型检查、前端构建、本地服务构建作为合并门禁。
- 为真实 PostgreSQL 准备独立 `INTEGRATION_DATABASE_URL`，禁止使用生产库。
- 将集成测试纳入 CI 或发布前流程，至少覆盖迁移、事务回滚、并发写入、权限和设备状态。

出口条件：单元测试、构建和 API 类型检查通过；集成环境可重复初始化和清理。

## 阶段 1：修复同步与定时 Hook 风险（P0）

目标：消除 25 条 `react-hooks/exhaustive-deps` 警告中会影响保存、心跳、时间和通知行为的部分。

首批文件：

- `src/hooks/admin/useMajorScheduleActions.ts`
- `src/hooks/admin/useWeeklyScheduleSync.ts`
- `src/hooks/useExamNotify.ts`
- `src/hooks/useAlertOverlay.ts`
- `src/components/DeviceStatusPanel.tsx`
- `src/components/TimeRangePickerModal.tsx`
- `src/components/touch-datetime-picker/DateTimePicker.tsx`

做法：

1. 逐条判断是“真实遗漏”还是“通过 ref 保证稳定引用的有意设计”。
2. 真实遗漏补依赖或重构为 reducer/命令函数；有意省略则补局部注释和针对性测试。
3. 不直接依赖 `eslint --fix`，避免把时序逻辑自动改坏。
4. 增加保存回调读取最新 majors、weekly、alerts、scope 的回归测试，以及组件卸载后的 timer 清理测试。

出口条件：目标文件不再有未解释的 Hook 警告；单元测试和构建通过；至少覆盖一次“连续编辑 + 网络恢复 + 冲突重试”和“设备心跳收到命令”的时序测试。

回滚点：每个 Hook 单独提交；若行为回归，只回滚对应 Hook，不回滚测试和其他模块。

## 阶段 2：收紧 API 与客户端契约（P1）

目标：减少 `any`/`as never` 导致的字段漂移，先覆盖高风险边界，不追求一次清零所有警告。

顺序：

1. 为 `ExamPayload`、设备心跳响应、设备命令、错误响应建立共享 TypeScript 类型。
2. 在 `unknown -> validated type` 边界使用现有校验工具或小型解析函数。
3. 优先处理 `src/services/examService.ts`、`src/hooks/useExamSync.ts`、`src/services/classBinding.ts`、`api/_exams/payload.ts`、`api/_exams/diff.ts`、`api/_exams/permissions.ts`。
4. 测试中的 `any` 和确有必要的第三方动态加载暂不作为第一批目标。

出口条件：核心 API/设备类型不再依赖 `as never` 传递；非法响应能被拒绝或降级；现有 427 项测试不回归。

## 阶段 3：数据库集成与迁移门禁（P1）

目标：把当前只能靠单元测试证明的数据库行为变成可重复验证的门禁。

- 为 `ensureAuthTables`、`ensureTableOnce` 增加 schema 版本记录和迁移日志。
- 保留请求期兼容兜底，但正式部署先执行迁移；健康检查报告 schema 版本。
- 扩充集成测试：BIGINT 返回类型、并发 ETag 写入、全局写槽、事务回滚、设备替换和重启后的迁移状态。
- 迁移脚本必须可重复执行，失败时不得把半完成状态静默当作成功。

出口条件：空库、旧版模拟库和已升级库都能通过迁移；失败可定位到明确版本和请求 ID。

## 阶段 4：持久化设备命令队列（P1，v2.9 前置）

目标：替换 `temporary_command` 的“最后一条覆盖”语义，但保持旧客户端可用。

建议表字段：`id`、`device_instance_id`、`action`、`payload`、`status`、`idempotency_key`、`created_by`、`created_at`、`expires_at`、`claimed_at`、`acknowledged_at`、`failure_reason`。

实施：

1. 先支持 `refresh`、`resync`、`notify` 等低风险命令；暂不开放关机、更新和系统级操作。
2. 心跳读取一条可执行命令并返回，客户端回执使用命令 ID；服务端状态转换必须原子化。
3. 旧 `temporary_command` 只作为兼容读取/迁移字段，不再作为新命令写入目标。
4. 增加重复心跳、重复回执、离线超时、过期命令、两管理员并发下单和服务重启测试。

出口条件：命令不被覆盖、不重复执行；成功、失败、超时可查询；学校审计日志包含操作者、目标和结果。

## 阶段 5：考试元数据与生命周期（P1，v2.8 前置）

目标：让考试列表、历史、归档和复制不再依赖整行 JSONB 快照。

- 新增 `exam_records` 或等价关系模型，明确草稿、发布、进行中、结束、归档状态。
- 明确 `ExamRecord` 与现有 `MajorExam` 的唯一关联、删除和复制规则。
- `exam_data` 暂时保留为客户端同步投影；先双读或单向投影，禁止无设计的双写。
- 离线 outbox、ETag、三方合并和 ClassIsland 读取契约必须保持兼容。

出口条件：创建→编辑→发布→显示→结束→归档→复制闭环可测试；旧客户端仍可读取同步快照；迁移可回滚。

## 阶段 6：维护性清理（P2）

在正确性和数据模型稳定后执行：

- 拆分 `api/_auth.ts`、`src/services/examService.ts`、`AdminPage.tsx` 等大文件，页面只保留编排。
- 清理 unused 变量、4 个 Prettier 失败文件和可安全移除的无效 catch。
- 对控制字符正则逐条写明安全意图，使用窄范围 lint 抑制。
- 单独评估 React Router 7，不运行 `npm audit fix --force`，不把破坏性升级混入业务修复。

## 明确不做

- 不立即拆微服务。
- 不在没有集成数据库的情况下提交未经验证的 schema 迁移。
- 不把浏览器 `localStorage` ID 当作 Agent 的可信身份。
- 不在命令队列、授权和审计完成前实现跨学校远程控制或系统级控制。

## 推荐首个实施批次

先执行阶段 1：只改同步/定时 Hook 及其测试，目标是把高风险 Hook 警告从“未解释”变成“已修复或有证据的稳定设计”。完成后再进入阶段 2；阶段 4 和阶段 5 必须先完成设计评审再编码。
