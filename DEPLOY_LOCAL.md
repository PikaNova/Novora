# Novora 本地 / 内网部署（不依赖 Vercel 与 Neon）

本仓库支持两套部署，互不冲突：

- **云端**：Vercel Functions + Neon PostgreSQL（原样保留，见 README「从零部署」）
- **本地/内网**：单个 Node 进程托管静态站点与全部 API，内嵌 PostgreSQL 16（本文档）

本地与云端共用同一份代码：server/ 里的适配器把 Node 请求转成现有 api/*.ts handler 认识的形状，handler 零改动；数据库驱动为双模式：Neon 云连接串（host 含 neon.tech 或带 channel_binding）走 @neondatabase/serverless 的 neon()（Neon HTTP 协议）；本地/内网标准 PostgreSQL 连接串自动改用 pg 直连 5432（原生协议），两种模式对外调用形状一致，handler 零改动。

## 快速开始（Docker Compose，推荐）

```bash
# 1. 复制环境变量模板（可选：填写 ADMIN_PASSWORD 等）
cp .env.example .env

# 2. 构建并启动（app + 内嵌 postgres）
docker compose up -d --build

# 3. 访问
#    打开 http://<主机IP>:3000
#    首次登录 admin / ADMIN_PASSWORD（未配置时走原有恢复流程）
```

- compose 会自动注入 DATABASE_URL 指向内嵌的 db 服务（postgres://novora:novora@db:5432/novora），.env 里的 DATABASE_URL 会被覆盖，可留空
- 宿主机端口由 .env 的 `PORT` 控制（如 `PORT=13000` 时访问 `http://<主机IP>:13000`）；容器内固定监听 3000，反向代理指向 `http://127.0.0.1:<PORT>`
- 数据持久化在 Docker 卷 novora_pgdata，删除容器不丢数据
- 首次启动 ensureAuthTables() 会自动建全部表，无需手工执行 SQL

常用命令：

```bash
docker compose up -d --build   # 启动/重建
docker compose down            # 停止（数据保留）
docker compose logs -f app     # 看日志
```

## 无 Docker 本地运行

要求：Node.js 22+、PostgreSQL 14+（本机或内网已有实例）。

```bash
# 1. 创建数据库并配置连接
#    创建库：CREATE DATABASE novora;
#    .env 中设置：
#    DATABASE_URL=postgres://user:pass@localhost:5432/novora

# 2. 安装依赖并启动（build 前端 + 编译 server + 启动）
npm install
npm run serve

# 或分步执行：
npm run build
npm run serve:build
npm start
```

npm start 只启动已编译的服务（server-build/server/serve.js），适合进程守护（pm2 / NSSM / systemd）。

## 环境变量

| 变量                       | 必填                                          | 说明                                                                                            |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| DATABASE_URL               | 本地 compose 不需要（自动注入）；裸机运行必填 | 本地 PostgreSQL 连接串，不要带 sslmode=require&channel_binding=require（那是 Neon 专用参数）    |
| ADMIN_PASSWORD             | 首次启动建议填                                | 首次创建 admin 超级管理员的初始密码（>=8 位）                                                   |
| ADMIN_RECOVERY_KEY         | 可选                                          | 首次初始化时生成恢复密钥                                                                        |
| PORT                       | 可选                                          | 默认 3000                                                                                       |
| CORS_ALLOWED_ORIGINS       | 可选                                          | 同源部署可留空                                                                                  |
| TELEMETRY_*                | 可选                                          | 全部留空则本地不发送遥测                                                                        |
| GITHUB_REPO / GITHUB_TOKEN | 可选                                          | 更新检查；留空使用默认公开仓库或自动禁用                                                        |
| VERCEL_DEPLOY_HOOK_URL     | 可选                                          | 本地留空，部署按钮自动隐藏/返回未配置                                                           |
| ENTRY_RATE_LIMIT_*         | 可选                                          | 入口限流阈值，有安全默认值                                                                      |
| INTEGRATION_DATABASE_URL   | 测试专用                                      | 独立一次性 PostgreSQL 连接串；集成测试会清空该库，禁止使用生产 `DATABASE_URL`                   |
| INTEGRATION_TEST_CONFIRM   | 测试专用                                      | 必须设置为 `novora-disposable` 才会启动集成测试                                                 |
| VITE_SPEED_INSIGHTS        | 可选                                          | 本地构建设为 false 关闭 Vercel Speed Insights（.env.example 默认 false；Docker 构建默认 false） |

## 公告图片说明

/api/announcement-images 是转发代理，指向远端遥测源（TELEMETRY_BASE_URL）。因此：

- 纯离线/无外网环境下，公告正文里的图片会加载失败，其余全部功能不受影响
- 如需公告图完全离线，需要后续自建图片源并把 TELEMETRY_BASE_URL 指向它

## 双部署兼容规则（重要）

1. server/ 放在仓库根目录，不要放进 api/（Vercel 会把 api/ 下每个文件都当函数部署）
2. vercel.json、api/*.ts 保持原样，本地服务不读取 vercel.json
3. 云专属功能全部有环境变量兜底：redeploy 无钩子返回未配置、update-check 可禁用、SpeedInsights 本地关闭
4. .env 不入库，只提交 .env.example；Docker 数据卷、server-build/、data/ 均已加入 .gitignore

## 数据备份 / 迁移

```bash
# 备份（容器内执行）
docker compose exec db pg_dump -U novora -d novora --format=custom --no-owner --no-privileges -f /tmp/novora.dump
docker compose cp db:/tmp/novora.dump ./novora.dump

# 恢复
docker compose cp ./novora.dump db:/tmp/novora.dump
docker compose exec db pg_restore -U novora -d novora --no-owner --no-privileges --clean /tmp/novora.dump
```

数据库表结构由启动迁移自动维护，升级版本后重新构建即可：

```bash
git pull
docker compose up -d --build
```

## 更新与升级（一键命令）

本地部署建议用内置的一键更新（需要 Node.js 22+ 和 git）：

**最简单：双击运行（无需打字、无需进目录）**

- Windows：双击仓库根目录的 `update-local.bat`
- Linux/macOS：在仓库目录执行 `./update-local.sh`

**任意目录一行命令**

```bash
npm --prefix "<项目绝对路径>" run update:local
```

或者先进目录再执行：

```bash
cd <项目目录> && npm run update:local
```

**没有 Node 的 Docker 机器（一行）**

```bash
git -C "<项目绝对路径>" pull --ff-only && docker compose -f "<项目绝对路径>/docker-compose.yml" up -d --build
```

脚本会自动执行：

1. `git pull --ff-only` 拉取最新代码（包含两侧开发合并后的改动）
2. 自动识别部署模式：
   - Docker 模式：`docker compose up -d --build`（重建应用并启动，内嵌 postgres 不受影响）
   - 裸机模式：`npm run build` + `npm run serve:build`，提示手动重启服务（npm start / pm2 restart）
3. 健康检查：轮询 `http://127.0.0.1:3000/api/health`（最多 90 秒），确认数据库与 schema 正常
4. 打印当前代码版本，提示 PWA 缓存刷新

数据库结构由应用冷启动自动迁移，**无需手工执行 SQL**；业务数据在 `novora_pgdata` 卷中，更新不丢失。

### 手动更新（等价流程）

```bash
# Docker 部署
git pull
docker compose up -d --build
curl http://localhost:3000/api/health   # 期望返回 ok:true

# 裸机部署
git pull
npm install        # 仅当 package-lock.json 有变化
npm run serve      # build 前端 + 编译 server + 启动
```

### 更新注意事项

- **大版本前先备份**：执行上一节 `pg_dump` 命令；数据库结构只前进不回滚
- **回滚代码可以，数据库不回滚**：`git checkout <旧提交>` 后重建；需要回退数据时用备份恢复
- **PWA 缓存**：更新后浏览器/教室大屏若仍显示旧页面，刷新一次或等待 Service Worker 更新
- **云上预验证**：建议等 Vercel 云端 `dev` 部署验证通过后，再对本地内网执行 `npm run update:local`

## HTTP / HTTPS

- 默认监听 0.0.0.0:3000，教室局域网内直接 http://<主机IP>:3000 访问（设备绑定、教室大屏均走同源 /api）
- 如需公网域名，建议在前面加一层反代（示例）：

```caddyfile
novora.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```nginx
server {
    listen 443 ssl;
    server_name novora.example.com;
    location / { proxy_pass http://127.0.0.1:3000; }
}
```
