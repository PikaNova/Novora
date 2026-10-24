# 仓库约定

## 前端表单控件必须用统一组件

设置页、后台弹窗、向导等所有表单里的控件复用项目统一实现，保持交互与视觉一致；不要用浏览器原生样式的控件（尤其是原生 `<select>` 和 `<input type="date">`）。

| 场景            | 统一用法                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 布尔开关        | `src/components/settings/Switch.tsx` 的 `<Switch checked onChange disabled>`                                                                                                                                 |
| 下拉/单选选择器 | `src/components/InlineSelect.tsx`，配 `className="set-input"`                                                                                                                                                |
| 日期 / 时间     | `src/components/touch-datetime-picker` 的 `<DateTimeField mode="date\|time\|datetime" className="set-date-time-field" showFieldPreview={false}>`，值为 `YYYY-MM-DD`（日期）或 `YYYY-MM-DDTHH:mm`（日期时间） |
| 文本 / 数字输入 | `<input className="set-input">`；窄数字加 `set-input--sm`，并补 `type="number"` + `inputMode="numeric"`                                                                                                      |
| 行布局          | `set-fieldset`（禁用态加 `is-dim`）+ `set-row` + `set-label`，行内操作按钮包一层 `set-inline-actions`                                                                                                        |

新增界面时按上表选控件。示例可参考 `src/components/settings/TimeSyncSection.tsx`（开关 + 选择器 + 数字输入）和 `src/components/settings/WeeklyCalendarSection.tsx`（日期字段）。

## 大屏设计组件必须标记全屏按钮

`src/designs/` 下每个设计组件的全屏切换按钮都加 `data-fullscreen-toggle`。大屏的「双击退出全屏指引」靠这个标记用 `getBoundingClientRect()` 定位真实按钮，从而在不同设计下都能指对位置；新增设计若漏掉该属性，指引会静默不显示。

## 会话验证：默认快路径，推送或发布前跑全量

两档验证，不要每个会话都跑全套。本机（4 核）实测：全套链 ≈ 65–130s，快路径 ≈ 10–20s，
而省下的时间跟用例数量几乎无关——瓶颈是「每个测试文件一个 node 进程」，
102 个文件 ×（~0.35s 启动 + 模块加载）≈ 36s，628+ 个用例本身只跑几秒。

| 时机               | 命令                   | 做什么                                                   | 实测   |
| ------------------ | ---------------------- | -------------------------------------------------------- | ------ |
| 改完一个点         | `npm run verify:fast`  | 增量编译 + 只跑受影响的测试文件 + 改动文件的 lint/format | 10–20s |
| 只想跑测试         | `npm run test:changed` | 同上，跳过 lint/format                                   | 5–15s  |
| push 前            | `npm run verify:full`  | 全量 `npm test` + `build` + `typecheck:api`              | 70–90s |
| 怀疑编译产物不同步 | `npm run test:rebuild` | 删掉 `.test-check` 重新编译再全量                        | 60–90s |

- 代码改动收尾默认跑 `verify:fast`；推送或发布前跑全量。有明确失败或覆盖缺口时补跑对应检查。纯文档改动检查本次文件格式、链接和 diff，无需因此跑业务测试。
- `verify:fast` 会打印选中了哪些测试文件。如果它说「全量」，说明改动里有配置/样式/脚本文件，
  或者某个源文件没有任何测试（含间接）引用——后者全量也覆盖不到，别把它当成"已验证"。
- `npm test` 现在是增量编译（不再每次删 `.test-check`）；产物与源码的一致性由
  `scripts/prepare-test-output.cjs` 负责清理旧产物，脚本还会在产物缺失时自动重建。
- `verify:fast` 的 lint/format **只报告不阻断**：共享工作树里它会连带看到并行会话在改的文件，
  所以只对**自己改的**文件跑 `prettier --write`，不要去改别人的文件。
- 全量闸门由 GitHub Actions 兜底（`.github/workflows/verify.yml`，push 到 `main` / `upload/main` 触发）。
  push 之后检查 CI 结果；当前 `src-typecheck` 是阻断门禁，另有服务构建和真实 PostgreSQL 集成任务。以工作流实际配置为准，不沿用历史错误数量。
- **不要**用 `node --test --test-isolation=none` 把所有测试塞进一个进程来提速：Node 会把各文件顶层
  `before/after` 注册到同一个根上，文件级全局打桩互相覆盖（2026-09-24 实测 12 个用例因此失败，
  且会拖出 30s 的真实网络等待）。真要走这条路，得先把测试改成"每个用例自备全局"。

## AI 编码规则

以下规则适用于 AI 辅助的设计、编码、审查和重构。它们把需求转换成可验证的最小改动，不能替代具体任务的验收条件。

编码、审查、重构前使用全局 `andrej-karpathy` 技能。Windows 本机路径为 `C:/Users/Administrator/.codex/skills/andrej-karpathy/SKILL.md`；其它环境按技能目录查找，不能把本机路径作为构建依赖。

### 开始前

1. 先读本文件、`docs/2.8.1/README.md` 和相关模块文档；确认当前版本、分支、工作树和已有未提交改动。
2. 先写出关键假设、成功标准和需要触碰的文件。需求存在多种解释且会影响数据或 API 时才询问；否则按现有契约推进。
3. 优先选择最小实现，不为一次性需求新增抽象、配置项或未来功能。每一行改动都要能对应用户需求或兼容性要求。
4. 修改前用 `git diff` 和 `git status --short` 检查工作树；不得重置、覆盖、格式化或删除他人未提交的文件。

### v2.8.1 数据与 API

1. 保持 `exam_data` 的现有运行读写契约。`exam_records` 与 `majors` 的投影方向以当前实现和集成测试为准，不能仅按旧设计反转权威来源；新增关系数据不能让旧客户端失去读写能力。
2. 写入必须遵守 `exam_data` 的携带域语义：未携带字段保持原值，显式 `null` 只在契约允许时清空；不得把局部编辑重新变成全量覆盖。
3. 所有条件写都要保留 ETag、`updated_at` 或域级 revision 的基线校验，并在冲突时返回可处理的结构化错误；禁止静默覆盖远端更新。
4. 已支持离线的考试写入继续经过现有 outbox，保留账号/作用域隔离、重试退避、失败可见性和重连后的幂等处理。重试耗尽不能删除未同步编辑；不得为文档整理另造队列。
5. 新 API 先定义共享类型、输入边界、权限、审计和错误契约，再实现 handler；不得用未验证的 `any` 穿过边界。
6. 数据库迁移必须可重复执行，验证空库、旧库、重复升级及对应回滚/恢复；涉及并发写时补充并发验证。集成测试只用可清空的独立 `INTEGRATION_DATABASE_URL`，且不同于业务 `DATABASE_URL`；执行前设置 `INTEGRATION_TEST_CONFIRM=novora-disposable`，禁止用现有学校库替代。

### 设备命令、上报与隐私

1. 设备命令必须校验设备和作用域，保留现有命令 ID、幂等键、创建时间、过期时间、授权、回执和审计。版本握手、签名属于未来 Agent 协议设计，不能把尚未实现的能力写成当前保证，也不能在普通修复中擅自升级协议。
2. 命令状态至少区分 `pending`、`claimed`、`acknowledged`、`failed`、`expired`；当前协议以 `acknowledged` 表示成功回执，不得擅自引入未定义的 `completed` 状态。重复领取和重复回执不得产生重复副作用。
3. 保留现有临时考试 `pause/resume/extend/end` 和校时行为；新增系统级控制属于独立需求。不得加入任意 shell、默认关机、默认重启或绕过学校授权的远程控制。
4. 作者端只接收脱敏的版本、实例、错误、诊断摘要和运行统计；不得读取考试正文、班级名单、用户凭据或可还原的学校业务数据。
5. 区分学校运行日志、自动错误摘要和手动作者诊断包。按各自文档维护开关/审批、脱敏、容量和重试策略；完整作者诊断包须由管理员主动发送，不能改成静默上传。上报失败不阻塞看板核心功能。

### 部署、打包与生成物

1. Windows 安装器、服务、托盘和控制中心行为变化时更新 `packaging/windows/README.md`；仅在验收场景变化时更新相关 smoke，不能为改文案强制改测试。安装/恢复/卸载前确认目标服务、端口、数据目录和备份，优先隔离环境，不能误改本机既有实例。
2. Linux 先以 Docker/Node 可重复部署为基线；systemd、发行包和 Agent 发行方案必须单独记录平台假设与回滚路径。
3. 不把 `dist/`、`server-build/`、`.test-check/`、`.api-check/`、`.tmp-*`、`artifacts/`、`bin/obj` 或本地凭据当作源码提交；除非任务明确要求，禁止批量清理它们。
4. 不修改 `.env` 或 `docker-compose.yml` 中的数据库角色、库名和凭据指向，除非先检查现有配置并确认变更目标；本地 PostgreSQL 密码只从本机秘密文件读取，不写入聊天或日志。

### 文档和任务状态

1. v2.8.1 相关契约、迁移、测试、部署和路线文件从 `docs/2.8.1/README.md` 登记；新增或变更文件要补充索引。
2. 完成任务时同步更新变更日志、路线任务和验收状态；未完成项写明证据、限制和下一步，不把计划描述成已实现。
3. 旧版本计划、审查报告和工作区快照只作历史参考；除非任务明确要求，不根据历史文件直接恢复旧实现。
4. 文档改动也要通过格式检查；命令、路径、版本号和验收结果必须与当前仓库实际内容一致。

### 交付前检查

1. 代码改动按范围运行 `npm run verify:fast`；纯文档按前述轻量检查。快路径退回全量或未选中覆盖时说明原因；退出码通过不代表 lint/format 已通过。不要编写只复述实现的测试或为低影响可逆文案改动新增测试。
2. 发布前运行 `npm run verify:full`、`npm run test:integration`，并按平台执行 Windows smoke 或 Docker/Node 部署检查。
3. 汇报结果时说明改了什么、为什么、验证了什么、哪些检查因环境未执行，以及仍然存在的历史文件或生成物；不声称未运行的检查已经通过。

### 实现约定与范围边界

- Node.js 使用 `package.json` 声明的 24.x；API/服务端遵循现有 ESM 和 `.js` 导入后缀。复用现有数据库适配层，兼容本地 PostgreSQL 与 Neon。
- 鉴权使用现有 `src/services/auth/` 与服务端 actor/权限入口；组件不能另存 token 或绕过角色、年级和班级范围。SQL 使用参数化查询，不能拼接用户输入。
- `api/` 新增公开入口前检查 Vercel 函数数量、`vercel.json` rewrite 和分发测试；内部实现继续放在 `_` 前缀模块。
- React Hook 保持无条件调用、依赖完整、定时器/请求可清理；倒计时和提醒复用现有校准时间源，不能引入第二套时钟。
- 产品六个入口属于规划维度，作者端是独立平台服务；单教室模式、考试码和 Agent 尚未交付。Windows School ServiceHost 不等于 Agent，ClassIsland 插件也不等于跨平台客户端。
- 只改本任务必需内容，保留现有风格；只清理本次产生的无用代码。依赖升级、全仓格式化、批量迁移和远端发布不捆绑进普通修复。
