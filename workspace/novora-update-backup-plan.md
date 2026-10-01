# Novora 本地部署：升级与备份恢复方案（v2·镜像分发版）

> 状态：待评审。本文档只定方案，不含实现改动。
> 取代此前的源码更新思路（`scripts/update-local.cjs` + `git pull`）。

## 0. 已确认的决策

| 决策 | 结论 |
|---|---|
| 分发方式 | **Docker 镜像 + 版本 tag**，学校设备上不出现源码 |
| 备份包内容 | 数据库 dump + 版本信息 + 配置清单（**不含 `.env` 等密钥**） |
| 定时备份 | 每天 1 次，保留最近 10 份 |
| 升级失败处理 | 自动回滚版本；**数据库恢复需管理员确认**，不自动回滚数据 |
| 入口分工 | 前端（系统设置）为主入口；CLI 为高级/救急入口 |
| 备份时机 | 升级前、恢复前强制快照；备份失败一律中止后续动作 |

## 1. 设备上的形态

```text
/opt/novora/
├── docker-compose.yml     # 只引用镜像，不含 build
├── .env                   # NOVORA_TAG / 数据库口令 / 管理员口令 / 端口
├── data/
│   ├── postgres/          # 数据库卷
│   ├── backups/           # .nbk 备份包 + 同名元数据
│   └── state/             # 升级与恢复任务状态（供前端轮询）
└── backups/               # 可选：导出/离线拷贝目录
```

容器拓扑：`novora`（应用）、`novora-db`（postgres:16-alpine）、`novora-updater`（升级执行体，仅内网，唯一挂载 Docker socket 的容器）。

开发环境保留 `docker-compose.override.yml` 走 `build:`，正式部署只有 `image:`。

## 2. 发布端（闭源边界）

- 代码仓库私有；CI 在打 tag（`v*`）时构建并推送镜像 `ghcr.io/pikanova/novora:vX.Y.Z`。
- 部署包只包含 `docker-compose.yml` + `.env.example` + 部署文档，可放公开的"发布仓库"或 Release 附件。
- 发布清单 `releases/latest.json`：`version / channel / notes / image / digest / minSchema / publishedAt`。前端"检查更新"读它，不再依赖源码仓库的 GitHub Release。
- 镜像私有则部署端用只读 token `docker login`；镜像公开则部署端无需登录。
- **待定**：国内学校网络拉 GHCR 通常很慢甚至不通，需要镜像同步到国内 registry 或对象存储 + CDN（1Panel 就是自家 OSS）。这一条不定，"一键升级"在教室里会退化成"拉取超时"。

## 3. Update Manager

后端只暴露白名单操作，没有任何通用命令通道：

`check-update` · `create-backup` · `pull-image` · `stop-app` · `start-app` · `run-migration` · `health-check` · `rollback`

执行体是 `novora-updater` sidecar：应用容器调它 → 它写 `.env` 的 `NOVORA_TAG` → `docker compose pull novora` → `docker compose up -d novora`。应用容器本身不碰 Docker socket。

升级时序：

1. 前端二次确认（显示目标版本、预计中断 1–3 分钟）
2. 进入维护模式（写请求 503），前端显示"升级中"
3. 强制创建升级前 Recovery Point（失败即中止，不进入第 4 步）
4. 记录当前 tag / 镜像 digest / app 版本 / schema 版本
5. 拉取目标镜像（含 digest 校验）
6. 写新 tag 到 `.env`
7. 重建应用容器
8. 启动迁移（应用冷启动自动跑，`ensureTableOnce` / `ensureAuthTables`）
9. 健康检查（`/api/health`：db、schema 版本、迁移日志）
10. 通过 → 退出维护模式，记审计 `system.update`
11. 失败 → 自动回滚第 6 步的 tag → 重建 → 健康检查 → 记审计 `system.rollback`
12. 回滚仍失败 → 前端明确提示"需人工介入"+ 快照文件名 + CLI 命令

回滚粒度：**版本自动回滚，数据不自动回滚**。schema 已从 N 升到 N+1 时切回旧镜像可能起不来，所以前端在回滚提示里给出"用哪个 Recovery Point 恢复数据库"的入口，由管理员确认。

## 4. Backup Manager 与 `.nbk`

包结构（tar.gz，单文件）：

```text
novora-backup-20260912-210000.nbk
├── database.dump        # pg_dump -Fc
├── metadata.json        # 大小 / sha256 / 耗时 / 触发原因 / 部署形态
├── version.json         # app 版本 / 镜像 digest / schema 版本 / 迁移版本
├── config.required.json # 需要哪些环境变量（只记键名，不含值）
└── files/               # 预留；当前服务端无文件落盘，先为空
```

备份类型：`manual`（手动）、`scheduled`（定时）、`pre-update`（升级前）、`pre-restore`（恢复前）。后两类受保护，不被保留策略清理。

保留策略：默认 10 份，按时间倒序；**新备份成功后才清理**，失败绝不删旧的。

## 5. 恢复流程

本机恢复（前端）：维护模式 → 强制快照 → 校验（sha256 + `PGDMP` 头 + `pg_restore -l`）→ 断开其它连接（排除自身会话）→ `pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction` → 重置迁移缓存 → 健康检查 → 退出维护模式。失败自动用快照回退，快照保留。

跨服务器恢复（初始化向导 + CLI）：新机装好 → 上传 `.nbk` → 校验版本兼容（镜像 digest / schema 版本）→ 提示补齐 `config.required.json` 里的环境变量 → 恢复数据库 → 启动 → 健康检查。

救急（应用起不来）：`novora restore --file <nbk> --force`，不依赖应用进程。

## 6. 前端

**系统设置 → 系统更新**（扩展现有 `DeploymentSection`）：当前版本 / 最新版本 / 更新内容 / 备份状态（最近备份时间、数据库与配置检查）/ `检查更新` `立即升级`；升级中显示分步进度，失败显示原因 + 回滚结果 + 恢复入口。Vercel 部署隐藏本地升级按钮。

**系统设置 → 数据与维护 → 备份与恢复**：状态条（最近备份、占用、份数）；`立即备份并下载`；备份列表（时间/版本/类型/大小/sha256 前 8 位 + 下载/恢复/删除）；上传恢复（选文件 + 确认短语 + 二次确认）；恢复进度与日志。

两处共用维护模式横幅与任务状态轮询。

## 7. CLI（高级与救急）

```text
novora status                 # 版本、容器状态、DB 连通、最近备份、磁盘
novora update [--to vX.Y.Z]   # 终端里跑同一套白名单流程（排障用）
novora rollback [--to vX.Y.Z]
novora backup [--keep N]
novora restore --file <nbk>
novora doctor                 # socket、pg 客户端、权限、磁盘自检
```

## 8. 安全

- 权限沿用超管约定（`permissions.includes('*')`）；审计动作：`system.update`、`system.rollback`、`database.backup`、`database.restore`。
- `novora-updater` 只在内网，不发布端口；它是唯一持有 Docker socket 的组件（等价 root，需在文档里写明）。
- 备份目录 0700、文件 0600；备份包不含密钥。
- 恢复上传流式落盘（不整包进内存），大小上限默认 2GB。
- Vercel 环境三个入口一律 501。

## 9. 分期

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| P1 | 发布端：CI 打版本 tag + push 镜像 + 发布清单；`novora-updater` sidecar；compose 改 `image:` + tag 变量；CLI 白名单链路 | 命令行跑通 backup → pull → migrate → health → rollback |
| P2 | 前端"系统更新"页接通 Update Manager | 网页完成一次真实升级；失败能自动回滚并给出原因 |
| P3 | Backup Manager + 备份恢复中心 + 跨服务器恢复 | 网页备份/下载/上传/恢复全链路；恢复旧包后健康检查通过 |
| P4 | 定时备份、保留策略可配、国内镜像源 | 连续 7 天自动备份无遗留孤儿文件 |

## 10. 风险

| 风险 | 对策 |
|---|---|
| 国内拉取 GHCR 慢/不通 | P1 就定镜像同步点，不放在最后 |
| Docker socket 暴露给容器 | 只有 updater 持有；白名单；不映射端口 |
| schema 升级后无法用旧镜像启动 | 回滚时明确提示需配合恢复数据库，由管理员确认 |
| 备份占满磁盘 | 备份前检查剩余空间 + 保留策略 + 状态页显示占用 |
| 恢复中断留下半恢复 | `--single-transaction` + 恢复前强制快照 + 失败自动回退 |
