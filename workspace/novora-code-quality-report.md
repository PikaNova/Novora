# Novora v2.7.3 代码质量报告

审查对象：`novora-remote-audit`，提交 `0850b00`。本报告不修改业务代码。

## 总体判断

代码可以构建和测试，核心权限、同步和认证逻辑已有较好的单元覆盖；但维护成本已经开始由“大文件 + 宽松类型 + Hook 依赖警告”主导。质量问题目前更像可控的技术债，而不是立即阻塞发布的故障。同步、设备心跳和时间计算路径应优先处理，不能按普通格式问题排队。

## 已验证结果

| 检查 | 结果 |
|---|---|
| `npm ci` | 通过，安装 335 个包 |
| `npm test` | 通过，完整单元套件 427/427 |
| `npm run typecheck:api` | 通过 |
| `npm run serve:build` | 通过 |
| `npm run build` | 通过，Vite 转换 2243 个模块 |
| `npm run lint` | 0 errors，130 warnings |
| `npm run format:check` | 失败，4 个文件未格式化 |
| 生产依赖审计 | 2 个 moderate（`react-router`/`react-router-dom`）；升级到 Router 7 属破坏性变更 |
| 全量安装审计 | 9 个漏洞：5 moderate、4 high |
| 集成测试 | 未运行，需要独立 disposable `INTEGRATION_DATABASE_URL` |

未格式化文件：

- `src/components/InlineSelect.tsx`
- `src/components/SchedulePrintPreview.tsx`
- `src/pages/LocalSettingsPage.tsx`
- `src/utils/typographySettings.ts`

## 规模与维护热点

源码/测试目录共 335 个 TypeScript/TSX/JavaScript 文件；测试文件 63 个，其中真实数据库集成测试 1 个。最大文件如下：

| 文件 | 行数 | 风险 |
|---|---:|---|
| `api/_auth.ts` | 1128 | 鉴权、迁移、角色、令牌、审计职责集中 |
| `src/pages/AdminPage.tsx` | 986 | 页面编排与大量后台状态耦合 |
| `src/components/UserManagementPanel.tsx` | 946 | 用户、角色、审计和菜单交互集中 |
| `src/components/MajorBatchAddModal.tsx` | 883 | 表单、校验、批量模型和视图集中 |
| `api/emailAuth.ts` | 709 | 邮箱登录、验证码、锁定和令牌流程集中 |
| `src/components/WeeklyPanel.tsx` | 716 | 周测编辑、冲突、批量操作集中 |
| `src/services/examService.ts` | 683 | API、持久化、权限缓存和登录辅助集中 |

这些数字本身不是缺陷，但说明后续每次改动都容易触及多个行为面。建议新增功能前先把纯协议、数据映射和副作用拆开，并为拆分后的模块建立边界测试。

## Lint 警告分类

| 规则 | 数量 | 评价 |
|---|---:|---|
| `@typescript-eslint/no-explicit-any` | 73 | API/服务边界最需要治理；测试中的 `any` 优先级较低 |
| `@typescript-eslint/no-unused-vars` | 28 | 主要是清理项，通常不改变行为 |
| `react-hooks/exhaustive-deps` | 25 | 高优先级，可能形成过期闭包/错误定时器行为 |
| `no-control-regex` | 2 | 看起来是输入安全检查，应逐条注释或窄范围抑制 |
| `no-useless-catch` | 1 | `api/_auth.ts` 的透明转发 catch，可清理 |
| `no-useless-escape` | 1 | 格式清理项 |

重点 Hook 警告位于：`useMajorScheduleActions`、`useWeeklyScheduleSync`、`DeviceStatusPanel`、`ExamAlertOverlay`、`TimeRangePickerModal`、`DateTimePicker`、`useAlertOverlay`、`useExamNotify` 等。尤其 `useMajorScheduleActions.ts:361`、`useWeeklyScheduleSync.ts:231` 的保存回调缺少多个闭包依赖；目前通过 ref 维持部分最新状态，但这种约定没有被类型系统或测试完整证明。

## 代码边界问题

### P0：同步回调依赖约定不透明

`useMajorScheduleActions` 和 `useWeeklyScheduleSync` 使用大量 `MutableRefObject`、`as never` 和手工保存链来绕过闭包依赖。它们确实降低了重建回调的频率，但任何新增引用都可能读取旧状态。应把“稳定 ref 是有意设计”与“遗漏依赖”分开：对前者写局部注释和测试，对后者补依赖或改成 reducer/命令对象。

### P1：API 契约仍有宽类型

`src/services/examService.ts:61` 的 `toPayload(data: any)`、`src/hooks/useExamSync.ts:99-111` 的一组 `any` 字段、`api/_exams/payload.ts`/`diff.ts`/`permissions.ts` 的 `any` 会让前后端字段漂移只能在运行时暴露。优先为 `ExamPayload`、设备命令、遥测 payload 建立 `unknown -> validated type` 的解析函数；不要直接把 `any` 替换成大量无约束的 `Record<string, unknown>`。

### P1：设备接口缺少契约测试深度

已有路由测试覆盖参数错误和部分权限，但心跳重复、命令覆盖、断网重连、旧命令回执和设备 ID 重建没有真实数据库级测试。v2.9 前必须补状态机测试和并发测试。

### P1：数据库集成验证不在默认质量门禁内

`npm test` 主要是无数据库单元测试；`npm run test:integration` 强制要求独立 `INTEGRATION_DATABASE_URL`，本次没有执行。因此迁移兼容、BIGINT 返回形态、并发锁和 PostgreSQL 事务仍依赖人工或部署环境验证。CI 应提供临时 PostgreSQL/Neon 分支并把集成套件设为合并前门禁。

### P2：格式和依赖审计未闭环

4 个文件未通过 Prettier 检查；不应在功能开发中顺手大范围 `lint:fix`，因为可能改动控制字符正则和 JSX。依赖漏洞中 Router 7 升级是破坏性路线，应单独评估，不要运行 `npm audit fix --force`。

## 建议的质量门禁

1. 合并前：`npm test`、`npm run typecheck:api`、`npm run build`、`npm run serve:build`、`npm run format:check`。
2. 夜间或发布前：独立数据库上的 `npm run test:integration`，覆盖迁移、并发写、回滚、权限和设备命令。
3. lint 分阶段收敛：先处理同步/定时 Hook 警告，再处理 API 边界 `any`，最后清理 unused。
4. 新 API 必须有请求/响应类型和负面测试；禁止在业务 hook 里继续使用 `as never` 扩散契约。
5. 对大型模块设软上限：新增职责应拆到 domain service/hook，页面只做编排。

## 优先级排序

| 优先级 | 工作项 | 原因 |
|---|---|---|
| P0 | 审核 25 条 Hook 依赖警告 | 可能产生实际同步和计时错误 |
| P1 | 设备命令状态机与集成测试 | 关系到 v2.9/v3.1 是否可承诺可靠控制 |
| P1 | API payload/设备命令去 `any` | 防止前后端契约漂移 |
| P1 | 独立数据库 CI | 验证迁移、BIGINT、并发和事务 |
| P2 | 拆分 `api/_auth.ts`、`examService.ts` 和后台页面 | 降低后续变更 blast radius |
| P2 | 处理格式检查和 unused | 清理维护噪音 |
| P3 | Router 7 升级评估 | 需要单独迁移窗口，不是当前质量修复 |
