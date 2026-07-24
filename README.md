# 考试看板 V2

面向学校教室大屏的考试与周测排班系统，包含客户端大屏、管理后台、设备管理、排班预览和 A4 PDF 导出。技术栈为 React、TypeScript、Vite、Vercel Functions 与 Neon Postgres。

![项目预览](https://raw.githubusercontent.com/jinzhiyuan0327/exam-board-v1.24/refs/heads/main/IMG_20260717_222529.png)

## V2 功能

- 大型考试按全校、年级和班级范围发布；范围冲突时班级安排优先于年级，年级优先于全校。
- 周测按班级维护，支持 A/B 周、学期锚点、法定节假日、单次取消、临时调课、同年级批量应用和未来日历。
- 大屏支持当前设备本地临时考试，可立即或延迟开始，并可选择是否覆盖正式考试。
- 设备管理显示在线状态、当前考试和绑定班级，支持撤销绑定及远程管理临时考试。
- 排班可在网页中预览，并导出带学校名称、实例号、班级、时间和作者水印的 A4 PDF。
- 初始化向导收集省份、学校名称、年级、班级、学期日期和运行模式。
- 内置超级管理员、年级管理员、班级管理员和只读用户，支持自定义模块级角色、数据范围和审计日志。
- 客户端无需共享管理员账号即可只读预览和导出本机班级排班。
- 页面级结果统一使用红色错误、黄色提示和绿色成功通知；字段错误保留在对应输入框附近。
- AI 辅助仅生成可复制的识图提示词，不连接任何 AI 服务；用户可在任意 AI 软件识别照片后粘贴 JSON 导入。

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
4. 配置环境变量后执行 Deploy。

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | Neon 新加坡 pooled connection string |
| `ADMIN_PASSWORD` | 是 | 首次创建 `admin` 超级管理员的初始密码，至少 8 位，建议 12 位以上 |
| `VERCEL_DEPLOY_HOOK_URL` | 否 | 设置页触发重新部署时使用 |
| `GITHUB_REPO` | 否 | 更新检查仓库，例如 `jinzhiyuan0327/exam-board-v1.24` |
| `GITHUB_TOKEN` | 否 | 私有仓库或提高 GitHub API 限额时使用 |
| `ASSET_CDN_BASE` | 否 | 静态 JS/CSS 的 CDN 基址，未配置时不要填写 |

不要把 `DATABASE_URL` 或管理员密码写入仓库。

### 3. 首次初始化

1. 打开部署地址的 `/login`。
2. 使用用户名 `admin` 和 `ADMIN_PASSWORD` 登录。
3. 首次登录会自动建立数据库表、四个内置角色和超级管理员。
4. 按向导选择省份、填写学校名称，创建年级与班级，并设置学期开始日期。
5. 完成后进入“用户与权限”修改初始密码并创建年级或班级管理员。
6. 客户端首页不会被初始化弹窗强制拦截；在首页选择年级、班级后进入大屏。

超级管理员密码保存在 Neon 的加盐哈希中。重新部署不会使密码失效；更换或清空数据库后才会重新使用 `ADMIN_PASSWORD` 创建初始账号。

## V2 数据策略

V2 可从全新数据库开始。代码保留基础旧字段规范化和按需补列，但不保证所有 V1 自定义业务数据完整迁移。升级生产实例前请备份 Neon。

需要保留数据库时，可使用 PostgreSQL 官方工具：

```bash
pg_dump --dbname="旧连接串" --format=custom --no-owner --no-privileges --file=exam-board.dump
pg_restore --dbname="新加坡连接串" --no-owner --no-privileges exam-board.dump
```

系统设置中的“数据库重置”可按大型考试、周测、学校结构、设备和调度设置分别清理。登录用户和超级管理员不会随业务数据重置而删除。

## 免费版约束

`api/` 当前共有 11 个 TypeScript 文件，低于 12 个函数的约束。设备绑定、心跳、临时考试远程命令、业务数据和数据库重置均复用 `/api/exams`，没有为这些功能继续增加函数文件。

## 路由

| 路由 | 用途 |
| --- | --- |
| `/` | 客户端首页与班级选择 |
| `/exam` | 考试大屏与本地临时考试 |
| `/login` | 管理员登录 |
| `/admin` | 管理后台 |
| `/settings` | 有权限的系统设置 |
| `/preferences` | 当前设备的只读排班预览和导出 |

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

导入窗口可生成提示词。将提示词复制到任意支持图片的 AI 软件、上传排表照片，再把 AI 返回的纯 JSON 粘贴回来校验导入。本项目不会向 AI 服务发送图片或考试数据。

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

遥测启用后会上报实例版本、运行环境、匿名实例标识、省份和完整校名，用于作者了解部署运行情况；不上传考试排班正文、管理员密码或用户会话。可在系统设置中关闭并查看当前同意状态。

问题反馈交流群：`1067566386`。
