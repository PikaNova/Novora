# 群晖 NAS / Docker 自托管部署指南

本指南面向 fork 了 Novora 仓库、希望在群晖 NAS（或任何支持 Docker 的 Linux 主机）上自托管部署的用户。

数据库继续使用 Neon 云端 Postgres（项目使用 `@neondatabase/serverless` 驱动，专门对接 Neon 的 HTTP/WebSocket 代理，暂不支持直接指向自建的普通 Postgres）。NAS 上只需要运行一个 Node/Express 常驻服务，托管前端静态资源并挂载 API 路由。

## 前置条件
- 已在 [Neon](https://neon.tech) 创建项目，并拿到 Pooled connection string（`DATABASE_URL`）。
- NAS 已安装群晖 **Container Manager**（DSM 7.2+）或任意 Docker/Docker Compose 环境。
- 建议准备好一个域名，用于后续反向代理 + HTTPS。

## 第一步：获取代码
将本仓库（包含 `server.js`、`Dockerfile`、`docker-compose.yml` 等自托管部署文件）克隆或下载到 NAS 上，例如通过群晖 **Git Server** 套件，或在本地打包后用 File Station 上传。

## 第二步：配置环境变量
复制 `.env.example` 为 `.env`，填写：

```
DATABASE_URL=你的 Neon Pooled 连接串
ADMIN_PASSWORD=至少8位强密码
PORT=3000
```

`.env` 文件不要提交到 Git 仓库。

## 第三步：用 Container Manager 构建并启动
1. 打开 **Container Manager → 项目 → 新增**。
2. 项目来源选择「docker-compose.yml」，路径指向你克隆下来的项目文件夹（其中已包含 `Dockerfile`、`docker-compose.yml`、`.env`）。
3. 点击「完成」，Container Manager 会自动执行多阶段构建：
   - 阶段一：`npm install` → `npm run build`（生成前端 `dist/`）→ `tsc -p tsconfig.server.json`（把 `api/*.ts` 编译到 `server-build/`）。
   - 阶段二：只安装生产依赖，拷贝构建产物，启动 `node server.js`，监听容器内 `3000` 端口。
4. 构建完成后容器会自动启动，`restart: unless-stopped` 保证 NAS 重启后自动拉起。

也可以用命令行方式（NAS 已开启 SSH）：
```bash
cd /volume1/docker/novora
docker compose up -d --build
```

## 第四步：反向代理 + HTTPS
1. **控制面板 → 登录门户 → 反向代理 → 新增**：把你的域名（如 `novora.example.com`）转发到 NAS 本机的 `3000` 端口（容器映射出来的端口）。
2. 在反向代理规则的「自定义标头」中，确保转发 `X-Forwarded-Host` 与 `X-Forwarded-Proto`，项目的 CORS 校验逻辑依赖这两个头判断同源，配置不当可能出现接口被拒绝的情况。
3. **控制面板 → 安全性 → 证书**：申请 Let's Encrypt 证书并绑定到上面的反向代理规则，启用 HTTPS。
4. 如需公网访问，在路由器上做端口转发（443/80），或使用群晖 QuickConnect / DDNS。

## 第五步：首次初始化
打开 `https://你的域名/login`，使用用户名 `admin`、密码为你在 `.env` 中设置的 `ADMIN_PASSWORD` 登录，按照设置向导完成省份、学校、年级班级、学期等初始化配置。**首次初始化会生成一个恢复密钥，只显示一次，请务必妥善保存。**

## 升级与维护
后续仓库有更新时：
```bash
git pull
docker compose up -d --build
```
即可完成滚动升级，无需重新配置环境变量或重新走初始化流程。

## 常见问题
- **`VERCEL_DEPLOY_HOOK_URL` 要不要配置？** 不需要。这是 Vercel 专属的「一键重新部署」钩子，NAS 环境不需要，未配置时前端相关按钮会自动隐藏。
- **必须要能访问公网吗？** 核心的排考/大屏/管理后台功能不需要公网。但 `telemetry`、`error-report`、`announcement-images`、`update-check` 等辅助功能需要 NAS 能访问外部服务和 GitHub，纯内网环境下这些功能会自动降级跳过，不影响核心功能使用。
- **能否完全脱离 Neon、把数据库也放在 NAS 上？** 当前版本的数据库驱动 `@neondatabase/serverless` 专门对接 Neon 的代理协议，如果要改用 NAS 本地 Postgres，需要更换为标准的 `pg`/`postgres.js` 驱动并调整查询代码，属于代码层面的改造，不在本指南范围内。
