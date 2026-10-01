# Novora v2.7.3 项目迁移交接文档

> 生成时间：2026-08-30
> 适用源码：本目录 `novora-remote-audit`
> 基线：`main` 分支，提交 `0850b00`，版本 `2.7.3`
> 当前状态：源码可构建、可测试，但工作区有 15 个未提交修改，迁移前必须先处理

## 1. 一页结论

Novora 是面向学校教室大屏的考试与周测安排系统，包含客户端大屏、管理后台、设备管理、网页预览、A4 PDF 导出、ClassIsland 插件集成、遥测与错误上报。

项目是一个模块化单体，不拆微服务：

- **前端**：React 18 + TypeScript + Vite 5，`src/`
- **服务端**：Vercel Functions 或本地 Node HTTP 适配器，`api/` 和 `server/`
- **数据库**：Neon PostgreSQL（云端）或本地 PostgreSQL 16（Docker / 裸机）
- **插件**：ClassIsland.ExamReminder，.NET 8 Windows，`integrations/`
- **测试**：单元测试 444 个，另有 1 个真实数据库集成测试文件

迁移时最重要的是三件事：

1. **只迁移 `novora-remote-audit` 这一份源码**。外层工作区里的 `work/`、`outputs/`、`deliveries/` 是历史副本或交接产物，不是当前主线。
2. **保留当前 15 个未提交修改**，或先把它们提交成一个明确的迁移前基线。
3. **同时迁移代码和数据库**。只拷贝源码不迁移数据库，会得到一个空实例。

## 2. 当前仓库状态

### 2.1 源码位置

```text
工作区根目录
└─ novora-remote-audit/    # 真实 v2.7.3 源码，唯一迁移目标
   ├─ api/                 # Vercel Functions 与共享服务端模块
   ├─ server/              # 本地 / 内网 Node HTTP 适配器
   ├─ src/                 # React 前端
   ├─ public/              # PWA、字体、图标
   ├─ integrations/        # ClassIsland 插件
   ├─ tests/               # 单元测试与集成测试
   ├─ scripts/             # 构建、回填、更新脚本
   ├─ Dockerfile
   ├─ docker-compose.yml
   ├─ DEPLOY_LOCAL.md
   ├─ DEPLOY_NAS.md
   └─ README.md
```

### 2.2 Git 状态

```text
branch: main
commit: 0850b00
remote: https://github.com/PikaNova/Novora.git
```

当前有 15 个未提交修改，涉及：

- `api/_exams/db.ts`
- `api/_exams/diff.ts`
- `api/_exams/payload.ts`
- `api/_exams/permissions.ts`
- `api/_exams/types.ts`
- `api/_exams/routes/deviceAdminRoutes.ts`
- `api/_exams/routes/deviceSelfRoutes.ts`
- `api/_exams/routes/examDataRoutes.ts`
- `scripts/run-integration-tests.cjs`
- `src/hooks/admin/useMajorScheduleActions.ts`
- `src/hooks/admin/useWeeklyScheduleSync.ts`
- `src/hooks/useExamSync.ts`
- `src/services/classBinding.ts`
- `src/services/examService.ts`
- `tests/integration/examData.integration.test.ts`

这些修改的主要内容：

- 新增 `exam_data.exam_metadata` 和 `exam_data.lifecycle` 两个 JSONB 字段
- 新增 `device_commands` 表和索引，为持久化设备命令队列做准备
- 心跳读取 pending 命令，并把回执写入 `device_commands.acknowledged_at`
- 收紧考试快照、设备绑定和前端 API payload 的类型校验
- 修复部分 Hook 依赖和闭包问题
- 集成测试改为串行执行，并补了写槽释放逻辑
- 对 scope 被清空后的受限账号增加服务端 403 防护

建议在迁移前先提交这批改动，至少生成一个 patch 或 zip 备份，避免新环境只拿到 `main` 上的旧基线。

## 3. 技术栈与运行时

| 类别             | 版本 / 说明                                         |
| ---------------- | --------------------------------------------------- |
| Node.js          | `24.x`，当前验证环境为 `24.18.0`                    |
| npm              | `11.16.0`，`package-lock.json` 为 lockfileVersion 3 |
| React            | `18.3.1`                                            |
| React Router DOM | `6.26.2`，尚未升级 Router 7                         |
| TypeScript       | `5.5.3`                                             |
| Vite             | `5.3.4`                                             |
| 数据库           | PostgreSQL / Neon，双模式适配                       |
| 云驱动           | `@neondatabase/serverless`                          |
| 本地驱动         | `pg`                                                |
| 邮件             | `nodemailer`                                        |
| PDF / 截图       | `jspdf`、`html2canvas`                              |
| 图标             | `lucide-react`                                      |
| ClassIsland 插件 | `net8.0-windows`，SDK `1.7.106.2-dev-v2`            |

本地 Docker 使用 `node:24-alpine` 和 `postgres:16-alpine`。裸机部署文档写了 Node 22+，但为了和 `engines` 与 Docker 一致，迁移目标建议直接使用 Node 24。

## 4. 架构与数据流

```text
浏览器 / 教室大屏 / 管理后台
  ├─ localStorage / IndexedDB：本地设置、离线快照、outbox、设备实例 ID
  ├─ /api/exams：考试快照、周测、设备、插件、设置、仪表盘
  ├─ /api/login、/api/users、/api/emailAuth：认证与账号
  ├─ /api/telemetry、/api/error-report：同源中转到作者端
  └─ PWA Service Worker：静态壳缓存，API 永远走网络

服务端
  ├─ Vercel Functions：api/*.ts
  ├─ 本地 Node：server/adapter + server/routes + server/serve
  └─ 数据库适配器：api/_dbAdapter.ts
      ├─ Neon 连接串 -> @neondatabase/serverless
      └─ 普通 PG 连接串 -> pg.Pool
```

### 4.1 核心目录职责

| 目录             | 职责                                                   |
| ---------------- | ------------------------------------------------------ |
| `src/pages`      | 路由页面：首页、考试、登录、后台、设置、偏好、插件配对 |
| `src/components` | 后台、周测、设备、用户、设置、弹窗、触控选择器等组件   |
| `src/hooks`      | 同步、考试动作、周测同步、提醒、后台状态               |
| `src/services`   | API 调用、离线 outbox、设备绑定、遥测、错误上报        |
| `src/utils`      | 时间、排课、合并、冲突、设置规范化、SEO                |
| `src/designs`    | 大屏视觉主题                                           |
| `api/_exams`     | 考试域内部模块，已从大入口拆分                         |
| `api/_auth.ts`   | 认证、角色、用户、审计、邮箱配置、邮件队列             |
| `server/`        | 本地 HTTP 服务，复用全部 API handler                   |

## 5. 前端路由与主要功能

| 路由              | 功能                                     |
| ----------------- | ---------------------------------------- |
| `/`               | 客户端首页、班级选择、快速开始           |
| `/exam`           | 考试大屏、本地临时考试、全屏显示         |
| `/login`          | 管理员登录、邮箱验证码登录、恢复密钥     |
| `/admin`          | 管理后台、考试、周测、用户、设备、仪表盘 |
| `/settings`       | 系统设置、显示、数据维护、部署、遥测     |
| `/preferences`    | 当前设备偏好、只读考试安排、导出         |
| `/local-settings` | 本地设置页                               |
| `/plugin/connect` | ClassIsland 插件一次性配对               |

主要业务能力：

- 大型考试、周测计划、A/B 周、冲突策略、临时考试
- 年级、班级、选科组合、分科模式
- 多角色权限：超级管理员、年级管理员、班级管理员、班级访客、自定义角色
- 设备绑定、心跳、管理端、临时考试命令
- 离线缓存、outbox、同步队列、ETag 乐观并发、三方合并
- AI 导入提示词生成，但项目本身不上传图片或考试数据
- PDF 导出、网页预览、设计下发、字体子集
- PWA 更新、Service Worker 缓存刷新

## 6. API 面

### 6.1 公开 API 文件

`api/` 下实际部署为函数的入口包括：

- `/api/exams`
- `/api/login`
- `/api/users`
- `/api/emailAuth`
- `/api/system`
- `/api/telemetry`
- `/api/error-report`
- `/api/announcements`
- `/api/announcement-images`
- `/api/time`
- `/api/redeploy`
- `/api/update-check`

`vercel.json` 将 `/api/health`、`/api/status`、`/api/email-worker` 重写到 `/api/system`。

### 6.2 `/api/exams` 主要 action

`/api/exams` 仍是业务主入口，通过 `action` 分发：

- `bootstrap`
- `dashboard`
- `plugin-api`
- `plugin-pair-start`
- `plugin-pair-info`
- `plugin-pair-confirm`
- `plugin-pair-status`
- `plugin-bootstrap`
- `plugin-viewer-heartbeat`
- `device-bindings`
- `device-binding-options`
- `device-binding`
- `managed-device-setup`
- `device-role-update`
- `device-heartbeat`
- `device-command`
- `device-revoke`
- `design-policy`
- `major-batch-presets`
- `reset-data`
- 默认 GET/POST：考试数据读取与保存

免费版约束是这个入口复用了设备、插件、业务数据和重置功能，避免新增 Vercel Function。

## 7. 数据库与迁移

### 7.1 自动建表

项目没有独立的 SQL migration 目录。表结构由：

- `api/_auth.ts` 的 `ensureAuthTables()`
- `api/_exams/db.ts` 的 `ensureTableOnce()`

在首次请求或本地服务启动时自动创建和补列。

这对新部署友好，但也意味着：

- 首次请求会执行 DDL，可能慢
- DDL 权限或锁问题会表现为业务 API 失败
- 多个函数实例各自缓存迁移 Promise
- 未来正式演进应引入 schema 版本和部署期迁移

### 7.2 主要表

考试与快照：

- `exam_data`
- `write_throttle`

认证、用户、角色、审计：

- `app_auth`
- `app_roles`
- `app_users`
- `app_user_scopes`
- `app_audit_logs`
- `app_telemetry_config`

邮箱：

- `email_verification_codes`
- `email_config`
- `email_outbox`
- `mail_throttle`

设备与插件：

- `device_instances`
- `classisland_plugin_instances`
- `device_commands`（当前未提交新增）

### 7.3 关键结构事实

- `exam_data` 是单行共享快照，`id = 1`
- 大型考试主体在 `majors JSONB`
- 周测计划在 `weekly_plans JSONB`
- 年级、班级、初始化、设计策略、批量预设也在同一行
- 当前未提交改动新增 `exam_metadata` 和 `lifecycle` 字段
- 设备命令原来只有 `device_instances.temporary_command`，容易被覆盖
- 当前未提交改动新增 `device_commands`，用于持久化命令和回执

### 7.4 数据备份

云端 Neon：

```bash
pg_dump --dbname="旧连接串" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=exam-board.dump

pg_restore --dbname="新连接串" \
  --no-owner \
  --no-privileges \
  exam-board.dump
```

本地 Docker：

```bash
docker compose exec db pg_dump -U novora -d novora \
  --format=custom \
  --no-owner \
  --no-privileges \
  -f /tmp/novora.dump

docker compose cp db:/tmp/novora.dump ./novora.dump
```

恢复：

```bash
docker compose cp ./novora.dump db:/tmp/novora.dump
docker compose exec db pg_restore -U novora -d novora \
  --no-owner \
  --no-privileges \
  --clean \
  /tmp/novora.dump
```

## 8. 部署模式

### 8.1 Vercel + Neon

推荐区域：

```text
客户端 -> Vercel Edge
       -> Vercel Functions: sin1
       -> Neon: AWS ap-southeast-1
```

`vercel.json` 已固定 `regions: ["sin1"]`。

必填环境变量：

| 变量                     | 说明                                         |
| ------------------------ | -------------------------------------------- |
| `DATABASE_URL`           | Neon pooled connection string，保留 SSL 参数 |
| `ADMIN_PASSWORD`         | 首次创建 `admin` 的初始密码，至少 8 位       |
| `VERCEL_DEPLOY_HOOK_URL` | `main` 分支 Deploy Hook，用于设置页一键部署  |

可选但常见：

| 变量                   | 说明                           |
| ---------------------- | ------------------------------ |
| `CORS_ALLOWED_ORIGINS` | 跨域白名单                     |
| `GITHUB_REPO`          | 更新检查仓库                   |
| `GITHUB_TOKEN`         | GitHub API token               |
| `TELEMETRY_*`          | 作者端遥测、公告、错误上报地址 |
| `ENTRY_RATE_LIMIT_*`   | 入口限流参数                   |
| `ASSET_CDN_BASE`       | Vite 静态资源 CDN 前缀         |

Vercel 构建配置：

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

### 8.2 本地 / 内网 Docker

推荐命令：

```bash
cp .env.example .env
docker compose up -d --build
```

访问：

```text
http://<主机IP>:3000
```

Compose 会启动：

- `app`：Node 24 应用
- `db`：PostgreSQL 16
- 数据卷：`novora_pgdata`

`DATABASE_URL` 由 compose 自动注入，不需要手工指向本地库。

### 8.3 裸机本地部署

要求：

- Node 24
- PostgreSQL 14+，推荐 16
- `.env` 中配置标准 PG 连接串

命令：

```bash
npm ci
npm run serve
```

或分步：

```bash
npm run build
npm run serve:build
npm start
```

`npm start` 只启动已编译服务，适合接 pm2、systemd 或 NSSM。

### 8.4 部署文档优先级

- 优先使用 `DEPLOY_LOCAL.md`
- `README.md` 是云端和总览入口
- `DEPLOY_NAS.md` 是旧版 NAS/Neon 说明，与当前“内嵌 PostgreSQL”能力有冲突，迁移时不要按它选择数据库方案
- `UPGRADE-NOTES.md` 是历史增量包说明，不代表当前升级流程

## 9. 环境变量速查

来自 `.env.example`：

| 变量                                  | 必填                          | 说明                       |
| ------------------------------------- | ----------------------------- | -------------------------- |
| `DATABASE_URL`                        | 云端必填，本地 compose 可留空 | Neon 或本地 PG 连接串      |
| `ADMIN_PASSWORD`                      | 首次启动建议                  | 初始超级管理员密码         |
| `ADMIN_RECOVERY_KEY`                  | 可选                          | 旧恢复流程兼容             |
| `PORT`                                | 可选                          | 本地 HTTP 端口，默认 3000  |
| `HOST`                                | 可选                          | 本地监听地址，默认 0.0.0.0 |
| `CORS_ALLOWED_ORIGINS`                | 可选                          | 跨域白名单                 |
| `TELEMETRY_BASE_URL`                  | 可选                          | 作者端基础地址             |
| `TELEMETRY_COLLECT_URL`               | 可选                          | 遥测上报地址               |
| `TELEMETRY_ANNOUNCE_URL`              | 可选                          | 公告地址                   |
| `TELEMETRY_ERROR_REPORT_URL`          | 可选                          | 错误上报地址               |
| `TELEMETRY_TOKEN_URL`                 | 可选                          | 短期凭据签发地址           |
| `TELEMETRY_IP_SALT`                   | 可选                          | IP 哈希盐                  |
| `GITHUB_REPO`                         | 可选                          | 更新检查仓库               |
| `GITHUB_TOKEN`                        | 可选                          | GitHub API token           |
| `VERCEL_DEPLOY_HOOK_URL`              | 可选                          | Vercel 一键部署            |
| `ENTRY_RATE_LIMIT_WINDOW_MS`          | 可选                          | 通用限流窗口               |
| `ENTRY_RATE_LIMIT_MAX_REQUESTS`       | 可选                          | 通用限流阈值               |
| `ENTRY_RATE_LIMIT_WRITE_WINDOW_MS`    | 可选                          | 写入限流窗口               |
| `ENTRY_RATE_LIMIT_WRITE_MAX_REQUESTS` | 可选                          | 写入限流阈值               |
| `VITE_SPEED_INSIGHTS`                 | 可选                          | 本地建议 `false`           |
| `NPM_REGISTRY`                        | 可选                          | Docker npm 镜像            |
| `ASSET_CDN_BASE`                      | 可选                          | 前端静态资源 CDN           |

集成测试专用：

| 变量                       | 说明                                       |
| -------------------------- | ------------------------------------------ |
| `INTEGRATION_DATABASE_URL` | 独立一次性 PostgreSQL 数据库，禁止指向生产 |
| `INTEGRATION_TEST_CONFIRM` | 固定为 `novora-disposable`                 |

回填脚本专用：

| 变量                    | 说明                           |
| ----------------------- | ------------------------------ |
| `BACKFILL_DATABASE_URL` | 回填目标数据库                 |
| `BACKFILL_CONFIRM`      | 固定为 `novora-track-backfill` |

## 10. 验证结果与质量门禁

当前工作区验证结果：

| 检查                       | 结果                                        |
| -------------------------- | ------------------------------------------- |
| `npm test`                 | 通过，444/444                               |
| `npm run typecheck:api`    | 通过                                        |
| `npm run build`            | 通过，2243 modules                          |
| `npm run serve:build`      | 通过                                        |
| `npm run lint`             | 通过，0 errors，100 warnings                |
| `npm run format:check`     | 失败，8 个文件未格式化                      |
| `npm run test:integration` | 未运行，缺少独立 `INTEGRATION_DATABASE_URL` |

格式检查失败文件：

- `src/components/InlineSelect.tsx`
- `src/components/SchedulePrintPreview.tsx`
- `src/hooks/admin/useMajorScheduleActions.ts`
- `src/hooks/admin/useWeeklyScheduleSync.ts`
- `src/hooks/useExamSync.ts`
- `src/pages/LocalSettingsPage.tsx`
- `src/services/examService.ts`
- `src/utils/typographySettings.ts`

其中 4 个是基线问题，4 个来自当前未提交改动。

推荐迁移后至少执行：

```bash
npm ci
npm test
npm run typecheck:api
npm run build
npm run serve:build
npm run lint
npm run format:check
```

有独立数据库时再执行：

```bash
INTEGRATION_DATABASE_URL="..." \
INTEGRATION_TEST_CONFIRM=novora-disposable \
npm run test:integration
```

## 11. 已知风险与后续优先级

| 优先级 | 风险                           | 影响                                                       |
| ------ | ------------------------------ | ---------------------------------------------------------- |
| 高     | `exam_data` 单行 JSONB 快照    | 多域并发、历史查询、考试生命周期扩展前必须关系化元数据     |
| 高     | 设备命令可靠性仍不完整         | 当前未提交改动只引入 `device_commands`，还未形成完整状态机 |
| 高     | 浏览器实例 ID 不是可信设备身份 | 清 localStorage、复制配置或伪造 ID 即可冒充设备            |
| 中高   | 请求期 DDL                     | 首请求慢，DDL 权限或锁问题会表现为业务故障                 |
| 中     | `/api/exams` 契约过载          | action 多、权限规则复杂，后续应按领域 handler 化           |
| 中     | 遥测包含校名和省份             | 需要明确同意、脱敏、保留与关闭策略                         |
| 中     | 真实数据库集成测试未跑         | 迁移兼容和并发行为仍缺证据                                 |
| 低     | Prettier 和 lint warnings      | 不阻塞构建，但会持续增加维护噪音                           |

建议后续顺序：

1. 先提交或备份当前 15 个未提交修改
2. 补真实数据库集成测试和迁移门禁
3. 完成设备命令状态机：pending、claimed、acknowledged、failed、expired
4. 设计考试元数据与生命周期表，保留 `exam_data` 作为同步投影
5. 收紧 API 契约，减少 `any` 和 `as never`
6. 处理格式和 lint 警告

## 12. 兼容契约，迁移时不要改

以下标识是兼容契约，不等于品牌名：

- localStorage 的 `exam-board-*` 键
- IndexedDB 的 `exam-board-offline`
- 浏览器事件 `exam-board:*`
- Service Worker 缓存前缀 `exam-board-shell-*`
- ClassIsland 插件 ID `classisland.exam-reminder`
- 插件程序集名、命名空间和 API 版本兼容逻辑
- Neon 既有数据表和列名
- `/api/exams` 现有 action 命名

改产品名、仓库名或域名时，不要批量替换这些字符串。

## 13. 迁移执行清单

### 13.1 迁移前

1. 确认使用 `novora-remote-audit`，不要误用 `work/Novora` 等历史副本
2. 运行 `git status --short`
3. 备份或提交 15 个未提交修改
4. 备份生产数据库
5. 记录当前部署类型：Vercel/Neon、Docker 本地、裸机本地
6. 导出 `.env`，但不要把密钥写入文档或 Git
7. 记录当前域名、Vercel 区域、Neon 区域、Deploy Hook
8. 如果使用 ClassIsland，记录插件版本和配对班级

### 13.2 迁移代码

推荐：

```bash
git clone https://github.com/PikaNova/Novora.git
```

然后应用当前未提交 patch，或直接打包 `novora-remote-audit` 目录。

需要保留：

- `api/`
- `server/`
- `src/`
- `public/`
- `integrations/`
- `tests/`
- `scripts/`
- `package.json`
- `package-lock.json`
- `tsconfig*.json`
- `vite.config.ts`
- `vercel.json`
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `README.md`
- `DEPLOY_LOCAL.md`

不需要迁移：

- `node_modules/`
- `dist/`
- `server-build/`
- `.api-check/`
- `.test-check/`
- 外层工作区的 `work/`、`outputs/`、`deliveries/`

### 13.3 迁移数据库

按第 7.4 节执行 `pg_dump` / `pg_restore`。

注意事项：

1. 先备份，再恢复
2. `pg_restore` 使用 `--no-owner --no-privileges`
3. 恢复后启动应用，让自动迁移补齐新列
4. 检查 `/api/health`
5. 登录后台，检查年级、班级、考试、设备、插件

### 13.4 迁移后验收

最小验收路径：

1. 打开 `/login`
2. 使用 `admin` 登录
3. 检查首页、后台、设置页
4. 查看年级、班级、考试、周测
5. 查看设备列表和心跳状态
6. 打开 `/exam`，确认大屏正常
7. 导出一次 PDF
8. 触发一次 PWA 刷新
9. 检查 `/api/health`
10. 如有权限，查看 `/api/status`

## 14. 相关文档

- `README.md`：产品、部署、功能、更新日志
- `DEPLOY_LOCAL.md`：本地 / 内网部署
- `DEPLOY_NAS.md`：旧版 NAS 说明，注意与当前能力有差异
- `UPGRADE-NOTES.md`：历史增量升级说明
- 外层 `novora-architecture-review.md`：架构审查
- 外层 `novora-code-quality-report.md`：代码质量审查
- 外层 `novora-remediation-plan.md`：修复路线
- 外层 `novora-future-plan.md`：未来版本路线
