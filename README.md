# 考试看板 V2.3

面向学校教室大屏的考试与周测安排系统，包含客户端大屏、管理后台、设备管理、网页预览和 A4 PDF 导出。技术栈为 React、TypeScript、Vite、Vercel Functions 与 Neon Postgres。

![项目预览](https://raw.githubusercontent.com/jinzhiyuan0327/exam-board-v1.24/refs/heads/main/IMG_20260717_222529.png)

## V2.3 更新

- 修复 Vercel Node ESM 无法解析前端调度模块、导致 `/api/exams` 在连接 Neon 前直接返回 500 的问题；新增 `npm run typecheck:api`，会按生产 Node ESM 方式编译并导入函数入口。
- 未绑定班级时，“查看考试大屏”和直接访问 `/exam` 都会回到首页年级、班级选择，不再误进后台登录，也不会先渲染错误的大屏内容。
- 首次云端同步完成前不再把空的本地缓存判定为“系统未初始化”；网络失败时提供重新同步，不会引导用户覆盖已有云端配置。
- 初始化使用独立登录文案与 `initialize` 流程，验证成功后直接打开初始化向导。
- ClassIsland 联动 API 升级为向后兼容的 v2，增加能力探测、考试来源与学校信息；配套插件源码位于 `integrations/ClassIsland.ExamReminder`，使用官方稳定 PluginSdk 2.0。

## V2.2 功能

- 大型考试按全校、年级和班级范围发布；范围冲突时班级安排优先于年级，年级优先于全校。
- 周测按班级维护，支持 A/B 周、学期锚点、法定节假日、单次取消、临时调课、同年级一键同步和未来两周日历。
- 大屏支持当前设备本地临时考试，可立即或延迟开始，并可选择是否覆盖正式考试。
- 设备管理将同一设备的考试看板和 ClassIsland 插件合并展示，分别显示在线状态、当前考试和绑定班级，支持统一解除绑定及远程管理临时考试。
- 考试安排按日期分组在网页中预览，并导出带学校名称、实例号、班级、时间和作者水印的 A4 PDF；标题、正文和时间数字可分别选择字体。
- 初始化向导收集省份、学校名称、年级、班级、学期日期和运行模式。
- 内置超级管理员、年级管理员、班级管理员和只读用户，支持自定义模块级角色、数据范围和审计日志。
- 客户端无需共享管理员账号即可只读预览和导出本机班级考试安排。
- 页面级结果统一使用红色错误、黄色提示和绿色成功通知；字段错误保留在对应输入框附近。
- AI 辅助仅生成可复制的识图提示词，不连接任何 AI 服务；用户可在任意 AI 软件识别照片后粘贴 JSON 导入。
- 客户端未选择有效年级和班级时不会显示任何正式考试或周测，避免误用全局计划。

## V2.2 更新重点

- 13 套大屏设计的“更多”菜单改为页面根节点浮层，不再被设计顶栏裁切，支持触摸、键盘退出和屏幕边缘自动避让。
- 首页班级绑定改为内嵌的“先年级、后班级”按钮选择，不使用浏览器原生年级下拉框。
- 周测未选择班级时提供明确空状态，可直接在新建窗口选择范围；新建计划后自动切换到对应班级。
- 新建年级后自动聚焦“生成 1 班至 X 班”，周测计划可直接同步至同年级其他班级。
- 网页与 PDF 不再使用表格或显示无考试日期，改为日期、时间、科目和备注的纵向安排；正文默认霞鹜文楷，字体在预览打开时提前加载。
- 数据库支持整体重置和按大型考试、周测、学校结构、设备、调度设置分模块重置；登录账号不会被业务数据重置删除。
- ClassIsland 使用 `/api/exams` 完成配对、课表同步和看板心跳关联，没有增加新的 Vercel Function。

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

系统设置中的“数据库重置”可整体清理，也可按大型考试、周测、学校结构、设备/插件和调度设置分别清理。登录用户和超级管理员不会随业务数据重置而删除。V2.2 会按需为旧数据库补充 ClassIsland 看板关联字段，无需手工执行迁移脚本。

## 免费版约束

`api/` 当前共有 11 个 TypeScript 文件，低于 12 个函数的约束。设备绑定、ClassIsland 配对、心跳、临时考试远程命令、业务数据和数据库重置均复用 `/api/exams`，没有为这些功能继续增加函数文件。

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
3. 网页会把插件实例与当前考试看板实例关联；插件通过 `plugin-bootstrap` 获取该班级的有效考试安排。
4. 设备管理把关联的考试看板和 ClassIsland 显示为同一台设备。删除设备时，两端都会解除绑定并要求重新配对。

配对令牌有效期为 5 分钟。客户端密钥只以 SHA-256 摘要保存，配对与同步接口不会返回原始密钥。

配套插件可在 `integrations/ClassIsland.ExamReminder` 中构建：

```bash
dotnet build integrations/ClassIsland.ExamReminder/ClassIsland.ExamReminder.csproj -c Release
```

插件使用 `ClassIsland.PluginSdk 2.0.0.*` 和 `apiVersion: 2`，同时可读取旧服务端未声明版本的响应。

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

问题反馈交流群：`1067566386`。
