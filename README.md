# Novora V2.5.5

Novora 是面向学校教室大屏的考试与周测安排系统，包含客户端大屏、管理后台、设备管理、网页预览和 A4 PDF 下载。技术栈为 React、TypeScript、Vite、Vercel Functions 与 Neon Postgres。

> **官方问题反馈与部署交流群：`1067566386`**<br>
> 零基础部署遇到问题时，请携带错误提示和 Request ID 入群咨询；不要发送数据库连接串、密码、Deploy Hook 或恢复密钥。

![项目预览](https://raw.githubusercontent.com/PikaNova/Novora/refs/heads/main/IMG_20260717_222529.png)

一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3a%2f%2fgithub.com%2fPikaNova%2fNovora&project-name=novora-board&repository-name=novora-board&env=DATABASE_URL,ADMIN_PASSWORD&envDescription=请填写%20Neon%20PostgreSQL%20连接字符串和超级管理员初始密码)

简易部署：

1. 在 Neon 创建 AWS Singapore 数据库并复制 Pooled connection string。
2. 点击上方按钮，填写 `DATABASE_URL` 和至少 8 位的 `ADMIN_PASSWORD`，完成首次 Deploy。
3. 在 Vercel `Settings → Git → Deploy Hooks` 创建 `main` 分支钩子，将 URL 添加为必填的 `VERCEL_DEPLOY_HOOK_URL`，然后 Redeploy。
4. 确认 Functions 位于 Singapore (`sin1`)，并绑定自定义域名。
5. 从首页开始初始化，修改初始密码并保存只显示一次的自动恢复密钥。

完整零基础教程：[Novora 部署文档](https://github.com/PikaNova/novora-vitepress-docs)

## 推荐部署区域

```text
中国大陆客户端
  -> Vercel Edge
  -> Vercel Functions: sin1 新加坡
  -> Neon: AWS ap-southeast-1 新加坡
```

仓库中的 `vercel.json` 已固定 Functions 区域为 `sin1`。Neon 也应选择 AWS Singapore，避免函数和数据库跨洲通信。Vercel 免费默认域名在中国大陆的可达性仍受运营商影响，正式使用建议绑定自有域名。

## 从零部署

### 1. 创建 Neon 数据库

1. 打开 [Neon Console](https://console.neon.tech/) 并创建项目。
2. Provider 选择 AWS，Region 选择 Singapore / `ap-southeast-1`。
3. 复制 Pooled connection string，保留连接串中的 SSL 参数。

### 2. 部署到 Vercel

1. Fork 或导入本仓库到自己的 GitHub 账号。
2. 在 [Vercel](https://vercel.com/) 中选择 Add New Project 并导入仓库。
3. Framework Preset 选择 Vite，Build Command 使用 `npm run build`，Output Directory 使用 `dist`。
4. 首次 Deploy 后创建 `main` 分支 Deploy Hook，添加 `VERCEL_DEPLOY_HOOK_URL`，再执行一次 Redeploy。

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | Neon 新加坡 pooled connection string |
| `ADMIN_PASSWORD` | 是 | 首次创建 `admin` 超级管理员的初始密码，至少 8 位，建议 12 位以上 |
| `VERCEL_DEPLOY_HOOK_URL` | 是（项目创建后补充） | Vercel `Settings → Git → Deploy Hooks` 创建的 `main` 分支钩子，用于设置页一键部署 |
| `GITHUB_REPO` | 否 | 更新检查仓库，默认 `https://github.com/PikaNova/Novora`；支持完整 GitHub 地址或 `owner/repo` |
| `GITHUB_TOKEN` | 否 | 私有仓库或提高 GitHub API 限额时使用 |
| `ASSET_CDN_BASE` | 否 | 静态 JS/CSS 的 CDN 基址，未配置时不要填写 |

不要把 `DATABASE_URL` 或管理员密码写入仓库。

### 3. 首次初始化

1. 打开部署地址的 `/login`。
2. 使用用户名 `admin` 和 `ADMIN_PASSWORD` 登录。
3. 首次登录会自动建立数据库表、四个内置角色和超级管理员。
4. 按向导选择省份、填写学校名称，创建年级与班级，并设置学期开始日期。
5. 向导最后修改初始密码，并保存系统自动生成且只显示一次的恢复密钥。
6. 重新登录后创建年级或班级管理员；在首页选择年级、班级后进入大屏。

初始化完成后，普通菜单不再显示初始化入口。学校名称、年级、班级或学期需要调整时，请使用后台对应模块；确需重新开始时，先在“系统设置 → 数据维护”中重置学校结构。重复打开旧的 `?initialize=1` 地址不会覆盖已有云端数据。

当页面提示数据库连接或同步失败时，会同时显示原因与请求 ID。先检查 Vercel 项目中的 `DATABASE_URL` 是否为当前 Neon 项目的 pooled connection string，再在 Vercel Functions 日志中搜索该请求 ID。超时和临时断线可以重试；认证失败、未配置连接或数据库结构不兼容需要先修正配置。

超级管理员密码和恢复密钥都以加盐哈希保存在 Neon。重新部署不会使密码失效；更换或清空数据库后才会重新使用 `ADMIN_PASSWORD` 创建初始账号。忘记密码时，班级管理员联系所属年级管理员或超级管理员，年级管理员联系超级管理员；超级管理员使用首次初始化时保存的恢复密钥。系统无法再次显示恢复密钥原文。

## V2 数据策略

V2 可从全新数据库开始。代码保留基础旧字段规范化和按需补列，但不保证所有 V1 自定义业务数据完整迁移。升级生产实例前请备份 Neon。

需要保留数据库时，可使用 PostgreSQL 官方工具：

```bash
pg_dump --dbname="旧连接串" --format=custom --no-owner --no-privileges --file=exam-board.dump
pg_restore --dbname="新加坡连接串" --no-owner --no-privileges exam-board.dump
```

系统设置中的“数据库重置”可整体清理，也可按大型考试、周测、学校结构、设备/插件和调度设置分别清理。登录用户和超级管理员不会随业务数据重置而删除。V2.2 会按需为旧数据库补充 ClassIsland 看板关联字段，无需手工执行迁移脚本。

## 免费版约束

`api/` 当前有 9 个公开路由处理器和 3 个下划线开头的内部共享模块，总源码文件数为 12。设备绑定、ClassIsland 配对、心跳、临时考试远程命令、业务数据和数据库重置均复用 `/api/exams`，没有为这些功能继续增加 Vercel Function。

## 内部兼容标识

更改产品名、GitHub 仓库名或部署域名时，不要批量替换下列标识：

- localStorage 的 `exam-board-*` 键、IndexedDB 的 `exam-board-offline` 和浏览器事件 `exam-board:*`。
- Service Worker 的 `exam-board-shell-*` 缓存前缀；发布新版本时只更新末尾版本号。
- ClassIsland 插件 ID `classisland.exam-reminder`、程序集名、命名空间和现有 API 版本兼容逻辑。
- Neon 中既有数据表及列名。

这些是本地数据、设备绑定、PWA 更新和插件升级的兼容契约，不等同于对外品牌。

## 路由

| 路由 | 用途 |
| --- | --- |
| `/` | 客户端首页与班级选择 |
| `/exam` | 考试大屏与本地临时考试 |
| `/login` | 管理员登录 |
| `/admin` | 管理后台 |
| `/settings` | 有权限的系统设置 |
| `/preferences` | 当前设备的只读考试安排预览和导出 |
| `/plugin/connect?token=...` | ClassIsland 插件配对与班级绑定 |

## ClassIsland 插件连接

ClassIsland API v2 继续复用 `/api/exams`。`GET /api/exams?action=plugin-api` 可读取 `apiVersion`、最低兼容版本和能力列表；未发送版本字段的旧插件按 API v1 兼容处理，不需要重新绑定。

1. ClassIsland 插件使用自己的实例 ID、客户端密钥、API 版本和一次性配对令牌调用 `/api/exams` 的 `plugin-pair-start`。
2. 插件打开 `/plugin/connect?token=一次性令牌`，用户在网页中选择年级和班级并确认连接。
3. 网页会把插件实例与当前 Novora 看板实例关联；插件通过 `plugin-bootstrap` 获取该班级的有效考试安排。
4. 设备管理把关联的 Novora 看板和 ClassIsland 显示为同一台设备。删除设备时，两端都会解除绑定并要求重新配对。

配对令牌有效期为 5 分钟。客户端密钥只以 SHA-256 摘要保存，配对与同步接口不会返回原始密钥。

配套插件可在 `integrations/ClassIsland.ExamReminder` 中构建：

```bash
dotnet build integrations/ClassIsland.ExamReminder/ClassIsland.ExamReminder.csproj -c Release
```

插件使用 `ClassIsland.PluginSdk 1.7.106.2-dev-v2`、`net8.0-windows` 和 `apiVersion: 2`。Linux 版 ClassIsland 沿用兼容加载方式，浏览器启动失败时会回退到 Linux 桌面命令；旧服务端未声明版本的响应仍可读取。

## JSON 导入

大型考试示例：

```json
{
  "title": "高三周考",
  "items": [
    {
      "name": "语文",
      "startTime": "2026-09-07T08:30:00",
      "endTime": "2026-09-07T10:30:00",
      "enabled": true
    }
  ]
}
```

周测示例：

```json
{
  "items": [
    {
      "name": "数学周测",
      "weekday": 3,
      "startTime": "19:00",
      "endTime": "20:00",
      "weekType": "a",
      "enabled": true
    }
  ]
}
```

导入窗口可生成提示词。将提示词复制到任意支持图片的 AI 软件、上传考试安排表照片，再把 AI 返回的纯 JSON 粘贴回来校验导入。本项目不会向 AI 服务发送图片或考试数据。

## 本地开发

```bash
npm install
npm run dev
```

Vite 默认运行在 `http://localhost:5173`。本地调试 Vercel Functions 时需要同时使用 Vercel CLI 或等效的本地 API 环境。

生产构建：

```bash
npm run build
```

## 遥测说明

遥测启用后会上报实例版本、运行环境、匿名实例标识、省份和完整校名，用于作者了解部署运行情况；不上传考试安排正文、管理员密码或用户会话。可在系统设置中关闭并查看当前同意状态。

## 更新日志

### V2.5.5

- 恢复密钥由项目在首次初始化后自动生成，明文只显示一次，数据库仅保存加盐哈希。
- 初始化向导增加密钥保存确认；第一步和最终密钥确认步骤不可关闭。
- 使用文档改为推荐阅读，浏览器拦截弹窗时可继续并稍后从公告获取链接。
- `VERCEL_DEPLOY_HOOK_URL` 列为正式部署必填项，版本检查界面支持一键部署更新。
- 新增新加坡 Functions 教程，以及初始化无法完成时的应急管理入口和持续缺项提醒。

### 历史版本

- V2.5.4：初始化向导、文档确认和超级管理员强制改密。
- V2.5.0-V2.5.3：批量班级选择、分级管理员、密码找回和权限体验更新。
- V2.4.x：Novora 品牌、A4 PDF、多考试切换、云端初始化和可靠性更新。
- V2.2-V2.3：大型考试、周测、设备联动、ClassIsland、Vercel Functions 与 Neon 数据链路。

完整发布记录以 [GitHub Releases](https://github.com/PikaNova/Novora/releases) 为准。

官方问题反馈与部署交流群：`1067566386`。
