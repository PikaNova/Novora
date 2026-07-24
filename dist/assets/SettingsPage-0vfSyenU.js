import{c as T,b as j,a4 as Ds,a5 as Rs,a6 as Os,j as e,B as Vs,f as Oe,O as Ls,Y as Us,Z as Ws,a7 as Hs,a8 as Ve,w as v,a9 as Bs,aa as q,ab as zs,ac as Fs,ad as Le,ae as Gs,e as Ue,J as $s,F as Ks,N as Ys,u as U}from"./index-DqFgAyHb.js";import{b as Js,r as n}from"./react-BWeoL3de.js";import{g as qs,D as Zs,s as Qs}from"./designPref-CbmtxyhP.js";import{f as Xs,r as ea,A as sa}from"./announcements-jeeVbqso.js";import{A as aa,C as na,s as We,H as He,B as ta}from"./AccessDenied-CR1Ijuro.js";import{h as f,g as la,r as ia,a as S,i as ra,j as ca,f as Z,s as W,b as Q}from"./examService-vg6Jot4N.js";import{s as oa,a as da}from"./classSettings-BRb66du2.js";/* empty css                 */import{A as ma}from"./arrow-left-DE1lq4wd.js";import{P as ha,T as ua}from"./type-BmuqwtOl.js";import{A as pa}from"./arrow-right-CL83xB9a.js";import{M as xa}from"./megaphone-DULqMUCO.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ja=T("Clock3",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16.5 12",key:"1aq6pp"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const va=T("DatabaseZap",[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3",key:"msslwz"}],["path",{d:"M3 5V19A9 3 0 0 0 15 21.84",key:"14ibmq"}],["path",{d:"M21 5V8",key:"1marbg"}],["path",{d:"M21 12L18 17H22L19 22",key:"zafso"}],["path",{d:"M3 12A9 3 0 0 0 14.59 14.87",key:"1y4wr8"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ga=T("Info",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Na=T("RadioTower",[["path",{d:"M4.9 16.1C1 12.2 1 5.8 4.9 1.9",key:"s0qx1y"}],["path",{d:"M7.8 4.7a6.14 6.14 0 0 0-.8 7.5",key:"1idnkw"}],["circle",{cx:"12",cy:"9",r:"2",key:"1092wv"}],["path",{d:"M16.2 4.8c2 2 2.26 5.11.8 7.47",key:"ojru2q"}],["path",{d:"M19.1 1.9a9.96 9.96 0 0 1 0 14.1",key:"rhi7fg"}],["path",{d:"M9.5 18h5",key:"mfy3pd"}],["path",{d:"m8 22 4-11 4 11",key:"25yftu"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ya=T("Rocket",[["path",{d:"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",key:"m3kijz"}],["path",{d:"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",key:"1fmvmk"}],["path",{d:"M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",key:"1f8sc4"}],["path",{d:"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",key:"qeys4"}]]),Be=`# Novora V2.4.0

Novora 是面向学校教室大屏的考试与周测安排系统，包含客户端大屏、管理后台、设备管理、网页预览和 A4 PDF 下载。技术栈为 React、TypeScript、Vite、Vercel Functions 与 Neon Postgres。

![项目预览](https://raw.githubusercontent.com/jinzhiyuan0327/exam-board-v1.24/refs/heads/main/IMG_20260717_222529.png)

## V2.4.0 更新

- 全站品牌升级为 Novora，统一网页、13 套大屏设计、管理后台、登录页、插件连接页、PDF、favicon 和 PWA 图标；npm 包名同步改为 \`novora\`。
- 首页改为严格单屏布局，桌面与手机端按可用高度压缩品牌、状态、入口和间距，不出现页面滚动条。
- 周测页面与客户端只读预览恢复 A4 PDF 入口；未选择班级或班级暂无计划时保留禁用入口并说明原因。
- 取消浏览器打印流程，仅下载白底 A4 PDF，避免双面打印产生额外黑页；PDF 继续包含学校、班级、设备实例、导出时间与作者水印。
- 首次初始化改为云端写入优先：云端成功保存后才更新本地配置。云端已有学校结构时拒绝重复初始化，并引导到“年级与班级”或“数据维护”。
- 已初始化系统隐藏普通初始化入口。客户端只有在成功读取云端且确认没有学校结构后，才显示初始化引导，网络故障不会再被误判为未初始化。
- 数据库读写错误返回稳定错误码、可重试状态和请求 ID；登录、后台保存、周测同步及设置操作会显示具体原因，便于在 Vercel 日志中定位同一请求。
- 继续保留 V2 的内部兼容标识与 ClassIsland 协议，升级与更改 GitHub 仓库名不会导致已绑定设备、本地设置或插件配置失效。

## V2.3.2 更新

- A4 考试安排优先按周一至周五排列，有安排的周六、周日作为补充放在工作日之后，日期范围仍按实际最早和最晚日期显示。
- 适度放大文档标题、日期、时间和考试名称，内容较多时自动使用紧凑字号，兼顾大屏预览与 A4 单页打印。
- 打印预览改为独立挂载并在打印媒体中彻底移除后台页面，修复双面打印时出现额外全黑页面的问题。
- PDF 生成代码按需加载，不影响首页首屏体积。V2.4 起取消系统打印对话框，仅保留 PDF 下载。

## V2.3 更新

- 修复 Vercel Node ESM 无法解析前端调度模块、导致 \`/api/exams\` 在连接 Neon 前直接返回 500 的问题；新增 \`npm run typecheck:api\`，会按生产 Node ESM 方式编译并导入函数入口。
- 未绑定班级时，“查看考试大屏”和直接访问 \`/exam\` 都会回到首页年级、班级选择，不再误进后台登录，也不会先渲染错误的大屏内容。
- 首次云端同步完成前不再把空的本地缓存判定为“系统未初始化”；网络失败时提供重新同步，不会引导用户覆盖已有云端配置。
- 初始化使用独立登录文案与 \`initialize\` 流程，验证成功后直接打开初始化向导。
- ClassIsland 联动 API 升级为向后兼容的 v2，增加能力探测、考试来源与学校信息；配套插件源码位于 \`integrations/ClassIsland.ExamReminder\`。
- ClassIsland 插件保留现有 \`net8.0-windows\` 与 PluginSdk，增加 Linux 浏览器启动兼容：优先使用系统默认方式，失败后回退 \`xdg-open\`、\`gio open\`。

## V2.2 功能

- 大型考试按全校、年级和班级范围发布；范围冲突时班级安排优先于年级，年级优先于全校。
- 周测按班级维护，支持 A/B 周、学期锚点、法定节假日、单次取消、临时调课、同年级一键同步和未来两周日历。
- 大屏支持当前设备本地临时考试，可立即或延迟开始，并可选择是否覆盖正式考试。
- 设备管理将同一设备的 Novora 看板和 ClassIsland 插件合并展示，分别显示在线状态、当前考试和绑定班级，支持统一解除绑定及远程管理临时考试。
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
- ClassIsland 使用 \`/api/exams\` 完成配对、课表同步和看板心跳关联，没有增加新的 Vercel Function。

## 推荐部署区域

\`\`\`text
中国大陆客户端
  -> Vercel Edge
  -> Vercel Functions: sin1 新加坡
  -> Neon: AWS ap-southeast-1 新加坡
\`\`\`

仓库中的 \`vercel.json\` 已固定 Functions 区域为 \`sin1\`。Neon 也应选择 AWS Singapore，避免函数和数据库跨洲通信。Vercel 免费默认域名在中国大陆的可达性仍受运营商影响，正式使用建议绑定自有域名。

## 从零部署

### 1. 创建 Neon 数据库

1. 打开 [Neon Console](https://console.neon.tech/) 并创建项目。
2. Provider 选择 AWS，Region 选择 Singapore / \`ap-southeast-1\`。
3. 复制 Pooled connection string，保留连接串中的 SSL 参数。

### 2. 部署到 Vercel

1. Fork 或导入本仓库到自己的 GitHub 账号。
2. 在 [Vercel](https://vercel.com/) 中选择 Add New Project 并导入仓库。
3. Framework Preset 选择 Vite，Build Command 使用 \`npm run build\`，Output Directory 使用 \`dist\`。
4. 配置环境变量后执行 Deploy。

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| \`DATABASE_URL\` | 是 | Neon 新加坡 pooled connection string |
| \`ADMIN_PASSWORD\` | 是 | 首次创建 \`admin\` 超级管理员的初始密码，至少 8 位，建议 12 位以上 |
| \`VERCEL_DEPLOY_HOOK_URL\` | 否 | 设置页触发重新部署时使用 |
| \`GITHUB_REPO\` | 否 | 更新检查仓库，例如 \`jinzhiyuan0327/exam-board-v1.24\` |
| \`GITHUB_TOKEN\` | 否 | 私有仓库或提高 GitHub API 限额时使用 |
| \`ASSET_CDN_BASE\` | 否 | 静态 JS/CSS 的 CDN 基址，未配置时不要填写 |

不要把 \`DATABASE_URL\` 或管理员密码写入仓库。

### 3. 首次初始化

1. 打开部署地址的 \`/login\`。
2. 使用用户名 \`admin\` 和 \`ADMIN_PASSWORD\` 登录。
3. 首次登录会自动建立数据库表、四个内置角色和超级管理员。
4. 按向导选择省份、填写学校名称，创建年级与班级，并设置学期开始日期。
5. 完成后进入“用户与权限”修改初始密码并创建年级或班级管理员。
6. 客户端首页不会被初始化弹窗强制拦截；在首页选择年级、班级后进入大屏。

初始化完成后，普通菜单不再显示初始化入口。学校名称、年级、班级或学期需要调整时，请使用后台对应模块；确需重新开始时，先在“系统设置 → 数据维护”中重置学校结构。重复打开旧的 \`?initialize=1\` 地址不会覆盖已有云端数据。

当页面提示数据库连接或同步失败时，会同时显示原因与请求 ID。先检查 Vercel 项目中的 \`DATABASE_URL\` 是否为当前 Neon 项目的 pooled connection string，再在 Vercel Functions 日志中搜索该请求 ID。超时和临时断线可以重试；认证失败、未配置连接或数据库结构不兼容需要先修正配置。

超级管理员密码保存在 Neon 的加盐哈希中。重新部署不会使密码失效；更换或清空数据库后才会重新使用 \`ADMIN_PASSWORD\` 创建初始账号。

## V2 数据策略

V2 可从全新数据库开始。代码保留基础旧字段规范化和按需补列，但不保证所有 V1 自定义业务数据完整迁移。升级生产实例前请备份 Neon。

需要保留数据库时，可使用 PostgreSQL 官方工具：

\`\`\`bash
pg_dump --dbname="旧连接串" --format=custom --no-owner --no-privileges --file=exam-board.dump
pg_restore --dbname="新加坡连接串" --no-owner --no-privileges exam-board.dump
\`\`\`

系统设置中的“数据库重置”可整体清理，也可按大型考试、周测、学校结构、设备/插件和调度设置分别清理。登录用户和超级管理员不会随业务数据重置而删除。V2.2 会按需为旧数据库补充 ClassIsland 看板关联字段，无需手工执行迁移脚本。

## 免费版约束

\`api/\` 当前有 9 个公开路由处理器和 3 个下划线开头的内部共享模块，总源码文件数为 12。设备绑定、ClassIsland 配对、心跳、临时考试远程命令、业务数据和数据库重置均复用 \`/api/exams\`，没有为这些功能继续增加 Vercel Function。

## 内部兼容标识

更改产品名、GitHub 仓库名或部署域名时，不要批量替换下列标识：

- localStorage 的 \`exam-board-*\` 键、IndexedDB 的 \`exam-board-offline\` 和浏览器事件 \`exam-board:*\`。
- Service Worker 的 \`exam-board-shell-*\` 缓存前缀；发布新版本时只更新末尾版本号。
- ClassIsland 插件 ID \`classisland.exam-reminder\`、程序集名、命名空间和现有 API 版本兼容逻辑。
- Neon 中既有数据表及列名。

这些是本地数据、设备绑定、PWA 更新和插件升级的兼容契约，不等同于对外品牌。

## 路由

| 路由 | 用途 |
| --- | --- |
| \`/\` | 客户端首页与班级选择 |
| \`/exam\` | 考试大屏与本地临时考试 |
| \`/login\` | 管理员登录 |
| \`/admin\` | 管理后台 |
| \`/settings\` | 有权限的系统设置 |
| \`/preferences\` | 当前设备的只读考试安排预览和导出 |
| \`/plugin/connect?token=...\` | ClassIsland 插件配对与班级绑定 |

## ClassIsland 插件连接

ClassIsland API v2 继续复用 \`/api/exams\`。\`GET /api/exams?action=plugin-api\` 可读取 \`apiVersion\`、最低兼容版本和能力列表；未发送版本字段的旧插件按 API v1 兼容处理，不需要重新绑定。

1. ClassIsland 插件使用自己的实例 ID、客户端密钥、API 版本和一次性配对令牌调用 \`/api/exams\` 的 \`plugin-pair-start\`。
2. 插件打开 \`/plugin/connect?token=一次性令牌\`，用户在网页中选择年级和班级并确认连接。
3. 网页会把插件实例与当前 Novora 看板实例关联；插件通过 \`plugin-bootstrap\` 获取该班级的有效考试安排。
4. 设备管理把关联的 Novora 看板和 ClassIsland 显示为同一台设备。删除设备时，两端都会解除绑定并要求重新配对。

配对令牌有效期为 5 分钟。客户端密钥只以 SHA-256 摘要保存，配对与同步接口不会返回原始密钥。

配套插件可在 \`integrations/ClassIsland.ExamReminder\` 中构建：

\`\`\`bash
dotnet build integrations/ClassIsland.ExamReminder/ClassIsland.ExamReminder.csproj -c Release
\`\`\`

插件使用 \`ClassIsland.PluginSdk 1.7.106.2-dev-v2\`、\`net8.0-windows\` 和 \`apiVersion: 2\`。Linux 版 ClassIsland 沿用兼容加载方式，浏览器启动失败时会回退到 Linux 桌面命令；旧服务端未声明版本的响应仍可读取。

## JSON 导入

大型考试示例：

\`\`\`json
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
\`\`\`

周测示例：

\`\`\`json
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
\`\`\`

导入窗口可生成提示词。将提示词复制到任意支持图片的 AI 软件、上传考试安排表照片，再把 AI 返回的纯 JSON 粘贴回来校验导入。本项目不会向 AI 服务发送图片或考试数据。

## 本地开发

\`\`\`bash
npm install
npm run dev
\`\`\`

Vite 默认运行在 \`http://localhost:5173\`。本地调试 Vercel Functions 时需要同时使用 Vercel CLI 或等效的本地 API 环境。

生产构建：

\`\`\`bash
npm run build
\`\`\`

## 遥测说明

遥测启用后会上报实例版本、运行环境、匿名实例标识、省份和完整校名，用于作者了解部署运行情况；不上传考试安排正文、管理员密码或用户会话。可在系统设置中关闭并查看当前同意状态。

问题反馈交流群：\`1067566386\`。
`,ba="/api/update-check",ze="/api/redeploy",fa="admin_auth_token";async function ka(o){try{const u=await fetch(`${ba}?current=${encodeURIComponent(o)}`,{headers:{"Cache-Control":"no-store"}}),p=await u.json().catch(()=>null);return!u.ok||!(p!=null&&p.ok)?{ok:!1,current:o,latest:null,hasUpdate:!1,error:(p==null?void 0:p.error)||`HTTP ${u.status}`}:p}catch(u){return{ok:!1,current:o,latest:null,hasUpdate:!1,error:u instanceof Error?u.message:"网络错误"}}}async function wa(){try{const u=await(await fetch(ze,{headers:{"Cache-Control":"no-store"}})).json().catch(()=>null);return!!(u!=null&&u.configured)}catch{return!1}}async function _a(){try{const o={},u=localStorage.getItem(fa);u&&(o.Authorization=`Bearer ${u}`);const p=await fetch(ze,{method:"POST",headers:o}),i=await p.json().catch(()=>null);return!p.ok||!(i!=null&&i.ok)?{ok:!1,error:(i==null?void 0:i.error)||`HTTP ${p.status}`,code:i==null?void 0:i.code}:{ok:!0,job:i.job}}catch(o){return{ok:!1,error:o instanceof Error?o.message:"网络错误"}}}const M="2.4.0",X=[{value:"alibaba",label:"阿里巴巴普惠体 3"},{value:"sourceHan",label:"思源黑体"},{value:"smiley",label:"得意黑 / Smiley Sans"},{value:"wenkai",label:"霞鹜文楷"},{value:"general",label:"General Sans"}],Ia=[{value:"jbmono",label:"JetBrains Mono（默认 · 等宽）"},{value:"general",label:"General Sans"},{value:"alibaba",label:"阿里巴巴普惠体 3"},{value:"sourceHan",label:"思源黑体"},{value:"smiley",label:"得意黑 / Smiley Sans"},{value:"wenkai",label:"霞鹜文楷"}];function H({checked:o,onChange:u,disabled:p=!1}){return e.jsxs("label",{className:"set-switch",children:[e.jsx("input",{type:"checkbox",checked:o,disabled:p,onChange:i=>u(i.target.checked)}),e.jsx("span",{})]})}function Ua(){var Se,Ce,Pe;const o=Js(),[u,p]=n.useState(()=>f()),[i,ee]=n.useState(()=>la()),[Fe,Ge]=n.useState(!1);n.useEffect(()=>{if(f()){ia().then(s=>{if(!s){o("/login?next=/settings",{replace:!0});return}if(s.mustChangePassword){o("/admin?tab=users&password=1",{replace:!0});return}if(!S("settings.read",s)){ee(s),p(!0),Ge(!0);return}ee(s),p(!0)});return}ra().then(s=>{s?o("/login?next=/settings",{replace:!0}):p(!0)})},[o]);const[m,se]=n.useState(()=>j().general.timeSync),[$e,Ke]=n.useState(()=>j().study.alerts.errorCenterMode),[Ye,Je]=n.useState(()=>j().alerts.silentMode??"all"),[qe,Ze]=n.useState(()=>qs()),[A,ae]=n.useState(()=>j().general.typography),[Qe,Xe]=n.useState(()=>j().general.motionMode),[ne,B]=n.useState(!1),[te,es]=n.useState(!1),[le,ss]=n.useState(()=>Ds()),[ie,re]=n.useState(""),[x,ce]=n.useState({status:"idle"}),[oe,as]=n.useState(!1),[C,z]=n.useState({status:"idle"}),[de,ns]=n.useState(!1),ts=n.useMemo(()=>Rs(),[]),me=Os(),[he,ls]=n.useState([]),[is,ue]=n.useState(!0),g=n.useMemo(()=>j().exam,[]),[F,pe]=n.useState(g.weeklyPlans),[G,rs]=n.useState(g.selectedGradeId||((Se=g.grades[0])==null?void 0:Se.id)||""),[xe,je]=n.useState(g.selectedClassId),[cs,ve]=n.useState(()=>g.activeWeeklyPlanIdByClassId[g.selectedClassId]??g.activeWeeklyPlanId??""),[ge,$]=n.useState(""),[E,os]=n.useState(g.initialization.schoolName),[P,ds]=n.useState(g.initialization.province),[Ne,D]=n.useState(""),[k,ms]=n.useState([]),[K,hs]=n.useState(""),[ye,be]=n.useState(!1),[fe,ke]=n.useState(!1),h=i?S("settings.edit",i):!f(),R=i?S("weekly.edit",i):!f(),us=i?S("alerts.read",i):!f(),ps=i?S("alerts.edit",i):!f(),O=i?S("initialization.run",i):!f(),Y=i?i.permissions.includes("*"):!f(),xs=s=>{Hs(s),ss(s)},js=async()=>{re("上报中…");const s=await Ve("manual");re(s?"已上报 ✓":"上报失败或未启用"),v(s?"success":"error",s?"运行信息已上报作者端。":"上报失败或遥测尚未启用。","遥测上报")};n.useEffect(()=>{wa().then(as).catch(()=>{})},[]),n.useEffect(()=>{let s=!0;return ue(!0),Xs(!0).then(a=>{s&&ls(a)}).finally(()=>{s&&ue(!1)}),()=>{s=!1}},[]);const vs=async()=>{ce({status:"checking"});const s=await ka(M);ce(s.ok?{status:"done",info:s}:{status:"error",error:s.error}),v(s.ok?"success":"error",s.ok?s.hasUpdate?`发现新版本 v${s.latest}。`:"当前已经是最新版本。":s.error||"版本检查失败")},gs=async()=>{if(!window.confirm(`确定触发 Vercel 重新部署？
将从 GitHub 拉取最新代码并重新构建，约需 1–3 分钟，完成后刷新页面即为新版本。`))return;z({status:"running",msg:"已触发，正在部署…"});const s=await _a();if(s.ok)z({status:"done",msg:"已触发部署，请稍后在 Vercel 查看进度。"}),v("success","Vercel 重新部署已触发。");else{const a=s.code==="NO_HOOK"?"未配置部署钩子（VERCEL_DEPLOY_HOOK_URL）":s.error||"触发失败";z({status:"error",msg:a}),v("error",a,"部署触发失败")}},Ns=n.useMemo(()=>ea(Be),[]);n.useEffect(()=>{const s=()=>{se(j().general.timeSync),B(!1)};return window.addEventListener("timeSync:updated",s),()=>window.removeEventListener("timeSync:updated",s)},[]);const w=(s,a=!1)=>{Bs(s),se(j().general.timeSync),a&&window.dispatchEvent(new CustomEvent("timeSync:reschedule"))},ys=()=>{B(!0),window.dispatchEvent(new CustomEvent("timeSync:syncNow")),window.setTimeout(()=>B(!1),8e3)},bs=s=>{q(a=>({study:{...a.study,alerts:{...a.study.alerts,errorCenterMode:s}}})),Ke(s)},fs=s=>{Qs(s),Ze(s)},ks=s=>{zs(s),Xe(s),Fs(s)},V=(s,a)=>{const t={...A,[s]:a};q(l=>({general:{...l.general,typography:t}})),ae(t),Le(t)},ws=()=>{const s={...Gs};q(a=>({general:{...a.general,typography:s}})),ae(s),Le(s),v("success","字体分区已恢复为设计默认值。")},_s=()=>{const s=new Blob([Be],{type:"text/markdown;charset=utf-8"}),a=URL.createObjectURL(s);window.open(a,"_blank","noopener,noreferrer"),window.setTimeout(()=>URL.revokeObjectURL(a),6e4)},Is=()=>{if(window.confirm(`确定清除本机所有本地设置并恢复默认？
（仅影响当前浏览器，不影响云端考试数据）`)){try{localStorage.removeItem(Ue),localStorage.removeItem("exam_design_id")}catch{}window.location.reload()}},Ss=async()=>{if(!Y||K!=="重置数据库"||!k.length){v("warning","请选择重置范围并输入“重置数据库”。");return}be(!0);try{const s=localStorage.getItem("admin_auth_token")||"",a=await fetch("/api/exams",{method:"POST",headers:{"Content-Type":"application/json",...s?{Authorization:`Bearer ${s}`}:{}},body:JSON.stringify({action:"reset-data",categories:k})}),t=await a.json().catch(()=>null);if(!a.ok||!(t!=null&&t.ok)){const l=new Response(JSON.stringify(t),{status:a.status,headers:a.headers});throw await ca(l,"数据库重置失败")}v("success","所选云端数据已重置，即将重新载入初始化状态。"),localStorage.removeItem(Ue),localStorage.removeItem("exam_pending_sync"),window.setTimeout(()=>window.location.assign("/"),900)}catch(s){v("error",Z(s,"重置失败"),"数据库操作失败"),be(!1)}},we=(s,a)=>ms(t=>s==="all"?a?["all"]:[]:a?[...new Set([...t.filter(l=>l!=="all"),s])]:t.filter(l=>l!==s)),_e=async s=>{var Me,Te,Ee,De,Re;const a=j().exam;if(!a.grades[0]||!a.classes[0]){v("warning","请先完成学校、年级和班级初始化。");return}ke(!0);const t=$s(Ks(Date.now()),1),l={id:"demo_v2_major",name:"演示大型考试",order:a.majors.length,targetGradeIds:[a.grades[0].id],items:[{id:"demo_v2_exam_1",name:"语文",startTime:`${t}T08:30:00`,endTime:`${t}T10:30:00`,enabled:!0,order:0},{id:"demo_v2_exam_2",name:"数学",startTime:`${t}T14:00:00`,endTime:`${t}T16:00:00`,enabled:!0,order:1}]},d={...Ys(Date.now(),"演示周测计划"),id:"demo_v2_weekly",gradeId:a.classes[0].gradeId,classId:a.classes[0].id,order:a.weeklyPlans.length,weekMode:"ab",excludeOfficialHolidays:!0,items:[{id:"demo_v2_weekly_1",name:"数学周测",weekday:3,startTime:"19:00",endTime:"20:00",enabled:!0,order:0,weekType:"a"}]},y=s?[...a.majors.filter(r=>!r.id.startsWith("demo_v2_")),l]:a.majors.filter(r=>!r.id.startsWith("demo_v2_")),c=s?[...a.weeklyPlans.filter(r=>!r.id.startsWith("demo_v2_")),d]:a.weeklyPlans.filter(r=>!r.id.startsWith("demo_v2_")),b=y.some(r=>r.id===a.activeMajorId)?a.activeMajorId:((Me=y[0])==null?void 0:Me.id)||"",I={...a.activeWeeklyPlanIdByClassId,[d.classId]:s?d.id:((Te=c.find(r=>r.classId===d.classId))==null?void 0:Te.id)??null},Es={...a.initialization,demoDataImported:s},Ae={items:((Ee=y.find(r=>r.id===b))==null?void 0:Ee.items)||[],title:((De=y.find(r=>r.id===b))==null?void 0:De.name)||"",majors:y,activeMajorId:b,alerts:j().alerts,scheduleMode:a.scheduleMode,weeklyPlans:c,activeWeeklyPlanId:a.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:I,grades:a.grades,classes:a.classes,weeklyConflictPolicy:a.weeklyConflictPolicy,initialization:Es};try{const r=await W({...Ae,baseUpdatedAt:((Re=Q())==null?void 0:Re.updatedAt)??0});if(typeof r!="number")throw r&&r!=="unauthorized"&&r.kind==="error"?r.error:new Error("演示数据同步失败，请刷新后重试");U({...Ae,updatedAt:r}),v("success",s?"演示考试与周测数据已导入。":"演示数据已移除。")}catch(r){v("error",r instanceof Error?r.message:"演示数据操作失败")}finally{ke(!1)}},Cs=n.useMemo(()=>oa(g.grades),[g]),Ps=n.useMemo(()=>da(g.classes,G),[g,G]),L=F.filter(s=>s.classId===xe),N=L.find(s=>s.id===cs)??L[0]??null,As=s=>{var t;je(s);const a=j().exam;ve(a.activeWeeklyPlanIdByClassId[s]??((t=F.find(l=>l.classId===s))==null?void 0:t.id)??"")},J=async s=>{var y;if(!N||!R)return;const a=F.map(c=>c.id===N.id?{...c,...s}:c);pe(a),U({weeklyPlans:a,updatedAt:Date.now()}),$("正在保存到云端…");const t=j().exam,l={items:t.items,title:t.title,majors:t.majors,activeMajorId:t.activeMajorId,alerts:j().alerts,scheduleMode:t.scheduleMode,weeklyPlans:a,activeWeeklyPlanId:t.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:t.activeWeeklyPlanIdByClassId,grades:t.grades,classes:t.classes,weeklyConflictPolicy:t.weeklyConflictPolicy};let _=a,d=await W({...l,baseUpdatedAt:((y=Q())==null?void 0:y.updatedAt)??0});if(d&&typeof d=="object"&&d.kind==="conflict"&&d.remote){const c=d.remote,b=(c.weeklyPlans??a).map(I=>I.id===N.id?{...I,...s}:I);b.some(I=>I.id===N.id)||b.push({...N,...s}),_=b,d=await W({...l,items:c.items,title:c.title,majors:c.majors,activeMajorId:c.activeMajorId,alerts:c.alerts,scheduleMode:c.scheduleMode??l.scheduleMode,weeklyPlans:b,activeWeeklyPlanId:c.activeWeeklyPlanId??l.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:c.activeWeeklyPlanIdByClassId??l.activeWeeklyPlanIdByClassId,grades:c.grades??l.grades,classes:c.classes??l.classes,weeklyConflictPolicy:c.weeklyConflictPolicy??l.weeklyConflictPolicy,baseUpdatedAt:c.updatedAt})}if(d==="unauthorized"){o("/login?next=/settings",{replace:!0});return}if(typeof d=="number")pe(_),U({weeklyPlans:_,updatedAt:d}),$("已保存到云端"),v("success","周测日历设置已保存到云端。");else{const c=d&&d.kind==="error"?Z(d.error,"周测日历保存失败"):"周测日历保存失败，请刷新后重试。";$(c),v("error",c,"保存失败")}},Ms=async()=>{var d;const s=E.trim();if(!s||!O){D(s?"当前账号无权修改学校信息":"请填写学校名称");return}const a=j().exam;if(!P){D("请选择省份或地区");return}const t={...a.initialization,province:P,schoolName:s,schoolFullName:We(P,s),wizardVersion:Math.max(2,a.initialization.wizardVersion)};U({initialization:t}),D("正在保存到云端…");const l=await W({items:a.items,title:a.title,majors:a.majors,activeMajorId:a.activeMajorId,alerts:j().alerts,scheduleMode:a.scheduleMode,weeklyPlans:a.weeklyPlans,activeWeeklyPlanId:a.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:a.activeWeeklyPlanIdByClassId,grades:a.grades,classes:a.classes,weeklyConflictPolicy:a.weeklyConflictPolicy,initialization:t,baseUpdatedAt:((d=Q())==null?void 0:d.updatedAt)??0});if(l==="unauthorized"){o("/login?next=/settings",{replace:!0});return}const _=l&&typeof l=="object"&&l.kind==="error"?Z(l.error,"学校信息保存失败"):"学校信息保存失败，请刷新后重试。";D(typeof l=="number"?"学校信息已保存":_),v(typeof l=="number"?"success":"error",typeof l=="number"?"省份与完整校名已保存。":_,typeof l=="number"?void 0:"保存失败"),typeof l=="number"&&Ve("school_name_updated")};if(!u)return e.jsx("div",{className:"set-loading",children:"正在验证管理权限…"});if(Fe)return e.jsx(aa,{moduleName:"系统设置",onBack:()=>o("/admin")});const Ie=Vs(),Ts=m.lastSyncAt>0?Oe(m.lastSyncAt):"尚未校时";return e.jsxs("div",{className:"set-page",children:[e.jsxs("header",{className:"set-header",children:[e.jsxs("div",{className:"set-header__left",children:[e.jsxs("button",{className:"set-back",onClick:()=>o("/admin"),children:[e.jsx(ma,{"aria-hidden":"true"}),"返回管理"]}),e.jsx("h1",{className:"set-title",children:"系统设置"})]}),e.jsxs("span",{className:"set-version",children:["v",M]})]}),e.jsxs("div",{className:"set-body",children:[!h&&e.jsx("div",{className:"set-note set-note--warn",children:"当前账号对系统设置只有查看权限。如需修改登录密码，请前往“用户与权限”。"}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsx("h2",{className:"set-card__title",children:"学校信息"})}),e.jsx("p",{className:"set-card__lead",children:"学校名称会显示在班级考试安排预览和 A4 PDF 页眉中。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"省份 / 地区"}),e.jsxs("select",{className:"set-input",disabled:!O,value:P,onChange:s=>ds(s.target.value),children:[e.jsx("option",{value:"",children:"请选择省份或地区"}),na.map(s=>e.jsx("option",{value:s,children:s},s))]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"学校名称"}),e.jsx("input",{className:"set-input",maxLength:80,disabled:!O,value:E,onChange:s=>os(s.target.value),placeholder:"请输入学校名称"})]}),e.jsxs("div",{className:"set-note",children:["完整校名：",e.jsx("strong",{children:We(P,E)||"尚未填写"})]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!O||!P||!E.trim(),onClick:()=>void Ms(),children:"保存学校信息"}),Ne&&e.jsx("p",{className:"set-note","aria-live":"polite",children:Ne})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsx("h2",{className:"set-card__title",children:"周测日历"})}),e.jsx("p",{className:"set-card__lead",children:"配置学期周次和法定节假日。学期开始日期所在周按 A 周计算，下一周自动切换为 B 周。"}),e.jsxs("div",{className:"set-fieldset",children:[e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"年级"}),e.jsxs("select",{className:"set-input",value:G,onChange:s=>{rs(s.target.value),je("")},children:[e.jsx("option",{value:"",children:"请选择年级"}),Cs.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"班级"}),e.jsxs("select",{className:"set-input",value:xe,onChange:s=>As(s.target.value),children:[e.jsx("option",{value:"",children:"请选择班级"}),Ps.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))]})]}),L.length>1&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"周测计划"}),e.jsx("select",{className:"set-input",value:(N==null?void 0:N.id)??"",onChange:s=>ve(s.target.value),children:L.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))})]}),N?e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"set-row",children:[e.jsxs("label",{className:"set-label",children:["学期开始日期 ",e.jsx(He,{title:"A/B 周基准",children:"该日期所在周固定为 A 周，后续自然周按 A、B 交替推算。修改日期会立即反映到日历预览。"})]}),e.jsx("input",{className:"set-input",type:"date",disabled:!R,value:N.anchorDate,onChange:s=>void J({anchorDate:s.target.value})})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"周次模式"}),e.jsxs("select",{className:"set-input",disabled:!R,value:N.weekMode??"single",onChange:s=>void J({weekMode:s.target.value}),children:[e.jsx("option",{value:"single",children:"统一周表"}),e.jsx("option",{value:"ab",children:"A/B 周交替"})]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"法定节假日自动排除"}),e.jsx(H,{checked:N.excludeOfficialHolidays===!0,disabled:!R,onChange:s=>void J({excludeOfficialHolidays:s})})]}),N.excludeOfficialHolidays&&e.jsxs("p",{className:"set-note set-holiday-list",children:["已启用：",Ls.map(s=>`${s.name} ${s.start.slice(5)}~${s.end.slice(5)}`).join(" · ")]}),ge&&e.jsx("p",{className:"set-note","aria-live":"polite",children:ge})]}):e.jsx("div",{className:"set-note set-note--warn",children:"当前班级还没有周测计划，请先到管理后台的“周测”页创建计划。"})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ja,{size:20}),"时间同步（校时） ",e.jsx(He,{title:"校时方式",children:"时间接口精度最高且适合大屏；HTTP Date 无需专用接口但精度较低；浏览器不能直接使用 NTP。"})]}),e.jsx(H,{checked:m.enabled,disabled:!h,onChange:s=>w({enabled:s},!0)})]}),e.jsx("p",{className:"set-card__lead",children:"开启后大屏时钟、倒计时与全屏提醒均基于校准后的网络时间触发；关闭后回退使用本机时钟。"}),e.jsxs("div",{className:`set-fieldset${m.enabled?"":" is-dim"}`,children:[e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"校时方式"}),e.jsxs("select",{className:"set-input",disabled:!h,value:m.provider,onChange:s=>w({provider:s.target.value},!0),children:[e.jsx("option",{value:"timeApi",children:"时间接口 (timeApi · 推荐)"}),e.jsx("option",{value:"httpDate",children:"HTTP 响应头 (Date)"}),e.jsx("option",{value:"ntp",children:"NTP（仅服务端）"})]})]}),m.provider==="timeApi"&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"时间接口 URL"}),e.jsx("input",{className:"set-input",disabled:!h,value:m.timeApiUrl,placeholder:"/api/time",onChange:s=>w({timeApiUrl:s.target.value})})]}),m.provider==="httpDate"&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"探测 URL"}),e.jsx("input",{className:"set-input",disabled:!h,value:m.httpDateUrl,placeholder:"/",onChange:s=>w({httpDateUrl:s.target.value})})]}),m.provider==="ntp"&&e.jsxs("div",{className:"set-note set-note--warn",children:[e.jsx(Us,{size:15})," 浏览器环境无法直连 NTP，请改用“时间接口”或“HTTP 响应头”方式；NTP 仅供服务端代理使用。"]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"自动定时校时"}),e.jsx(H,{checked:m.autoSyncEnabled,disabled:!h,onChange:s=>w({autoSyncEnabled:s},!0)})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"校时间隔（秒）"}),e.jsx("input",{className:"set-input set-input--sm",type:"number",min:10,step:10,inputMode:"numeric",disabled:!h,value:m.autoSyncIntervalSec,onChange:s=>w({autoSyncIntervalSec:Math.max(10,Number(s.target.value)||10)},!0)})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"手动微调（毫秒）"}),e.jsx("input",{className:"set-input set-input--sm",type:"number",step:100,disabled:!h,value:m.manualOffsetMs,onChange:s=>w({manualOffsetMs:Number(s.target.value)||0})})]})]}),e.jsxs("div",{className:"set-status",children:[e.jsxs("div",{className:"set-status__row",children:[e.jsx("span",{className:`set-dot ${Ie?"ok":"wait"}`}),e.jsx("span",{children:Ie?"已校时":"尚未就绪"})]}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"上次校时"}),e.jsx("b",{children:Ts})]}),e.jsxs("li",{children:[e.jsx("span",{children:"当前网络偏移"}),e.jsxs("b",{children:[m.offsetMs," ms"]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"往返延迟"}),e.jsx("b",{children:m.lastRttMs!=null?`${m.lastRttMs} ms`:"—"})]}),m.lastError?e.jsxs("li",{className:"is-err",children:[e.jsx("span",{children:"上次错误"}),e.jsx("b",{children:m.lastError})]}):null]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!m.enabled||ne,onClick:ys,children:ne?"正在校时…":"立即校时"})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ha,{size:20}),"显示"]})}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"默认大屏设计风格"}),e.jsx("select",{className:"set-input",disabled:!h,value:qe,onChange:s=>fs(s.target.value),children:Zs.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))})]}),e.jsx("p",{className:"set-note",children:"也可在大屏右上角“切换风格”里实时预览切换；此处设置作为本机默认。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"动效模式"}),e.jsxs("select",{className:"set-input",disabled:!h,value:Qe,onChange:s=>ks(s.target.value),children:[e.jsx("option",{value:"auto",children:"自动（跟随系统“减少动态效果”偏好）"}),e.jsx("option",{value:"best-effects",children:"最佳效果（开满动效）"}),e.jsx("option",{value:"best-performance",children:"最佳性能（关闭动画 / 过渡 / 毛玻璃）"})]})]}),e.jsx("p",{className:"set-note",children:"最佳效果适合日常展示与体验；一体机、低端设备或投影出现卡顿时可切换到最佳性能，全局关闭动画、过渡与毛玻璃。"})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ua,{size:20}),"字体分区"]}),e.jsx("button",{className:"set-btn set-btn--ghost",disabled:!h,onClick:ws,children:"恢复设计默认"})]}),e.jsx("p",{className:"set-card__lead",children:"所有选择均为已随应用打包的本地字体。设置立即作用于当前大屏，并保存到本机；时钟默认使用 JetBrains Mono 等宽数字（子集已随应用打包）。"}),e.jsxs("div",{className:"set-font-grid",children:[e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"① 导航与标签"}),e.jsx("select",{className:"set-input",disabled:!h,value:A.navigation,onChange:s=>V("navigation",s.target.value),children:X.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))}),e.jsx("small",{children:"页眉、状态、标签与说明"}),e.jsx("i",{className:"set-font-preview set-font-preview--nav",children:"导航 · 在线 · 已校时"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"② 展示标题"}),e.jsxs("select",{className:"set-input",disabled:!h,value:A.display,onChange:s=>V("display",s.target.value),children:[e.jsx("option",{value:"design",children:"按当前设计默认"}),X.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))]}),e.jsx("small",{children:"科目主标题与核心强调"}),e.jsx("i",{className:"set-font-preview set-font-preview--display",children:"语文考试"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"③ 动态内容"}),e.jsx("select",{className:"set-input",disabled:!h,value:A.content,onChange:s=>V("content",s.target.value),children:X.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))}),e.jsx("small",{children:"下一科、卡片内容与动态中文"}),e.jsx("i",{className:"set-font-preview set-font-preview--content",children:"下一科：数学 · 14:30"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"④ 时钟与数字"}),e.jsx("select",{className:"set-input",disabled:!h,value:A.numeric,onChange:s=>V("numeric",s.target.value),children:Ia.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))}),e.jsx("small",{children:"时钟、倒计时、百分比和进度数字"}),e.jsx("i",{className:"set-font-preview set-font-preview--numeric",children:"09:30:00"})]})]}),e.jsx("p",{className:"set-note",children:"默认方案不再使用霞鹜文楷；如需自定义，可仅在本页手动选择它。"})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ta,{size:20}),"提醒与高级"]})}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"全屏提醒管理"}),us?e.jsxs("button",{className:"set-btn",onClick:()=>o("/admin?alerts=1"),children:["前往提醒管理",e.jsx(pa,{"aria-hidden":"true"})]}):e.jsx("span",{className:"set-note",children:"无查看权限"})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"静默模式"}),e.jsxs("select",{className:"set-input",disabled:!ps,value:Ye,onChange:s=>{const a=s.target.value;Je(a),Ws({silentMode:a})},children:[e.jsx("option",{value:"all",children:"全部提醒"}),e.jsx("option",{value:"keyOnly",children:"仅关键提醒（5分钟 / 开考 / 结束 / 下一科）"}),e.jsx("option",{value:"pauseUntilExamEnd",children:"本场进行中暂停提醒"})]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"错误中心模式"}),e.jsxs("select",{className:"set-input",disabled:!h,value:$e,onChange:s=>bs(s.target.value),children:[e.jsx("option",{value:"off",children:"关闭"}),e.jsx("option",{value:"memory",children:"仅内存（本会话）"}),e.jsx("option",{value:"persist",children:"持久化（本地保存）"})]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"重置本地设置"}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:!h,onClick:Is,children:"清除本地缓存并恢复默认"})]})]}),Y&&e.jsxs("section",{className:"set-card set-danger-zone",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(va,{size:20})," 数据库重置"]})}),e.jsx("p",{className:"set-card__lead",children:"仅重置选择的业务数据，不删除超级管理员和其他登录账号。重置学校结构时会同时清除周测与设备绑定。"}),e.jsxs("div",{className:"set-reset-grid",children:[e.jsxs("label",{className:"set-reset-grid__all",children:[e.jsx("input",{type:"checkbox",checked:k.includes("all"),onChange:s=>we("all",s.target.checked)}),"整体重置全部业务数据"]}),[["major","大型考试"],["weekly","周测计划"],["school","学校、年级与班级"],["devices","设备绑定、插件与状态"],["settings","提醒与调度设置"]].map(([s,a])=>e.jsxs("label",{children:[e.jsx("input",{type:"checkbox",disabled:k.includes("all"),checked:k.includes("all")||k.includes(s),onChange:t=>we(s,t.target.checked)}),a]},s))]}),e.jsxs("label",{className:"set-label",children:["输入“重置数据库”确认",e.jsx("input",{className:"set-input",value:K,onChange:s=>hs(s.target.value)})]}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:ye||K!=="重置数据库"||!k.length,onClick:()=>void Ss(),children:ye?"正在重置…":"重置所选云端数据"})]}),Y&&e.jsxs("details",{className:"set-card set-dev-tools",children:[e.jsx("summary",{children:"开发与测试"}),e.jsx("p",{className:"set-card__lead",children:"测试数据入口只在设置页向超级管理员显示。导入内容带有独立标识，可以单独移除。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"演示考试安排数据"}),e.jsxs("div",{className:"set-inline-actions",children:[e.jsx("button",{className:"set-btn",disabled:fe,onClick:()=>void _e(!0),children:"导入测试数据"}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:fe,onClick:()=>void _e(!1),children:"移除测试数据"})]})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(Na,{size:20}),"使用遥测"]}),e.jsx(H,{checked:le,disabled:!h,onChange:xs})]}),e.jsx("p",{className:"set-card__lead",children:"作者端上报匿名部署/运行数据（版本、主机、时区、地区、匿名 IP 哈希）；不含考试内容与个人信息。"}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"同意状态"}),e.jsx("b",{children:me==="granted"?"已同意":me==="denied"?"已拒绝":"未决定"})]}),e.jsxs("li",{children:[e.jsx("span",{children:"实例 ID"}),e.jsxs("b",{children:[ts.slice(0,8),"…"]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"当前版本"}),e.jsxs("b",{children:["v",M]})]})]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!le||!h,onClick:js,children:"立即上报一次"}),ie?e.jsx("p",{className:"set-note",children:ie}):null]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ya,{size:20}),"版本与更新"]})}),e.jsx("p",{className:"set-card__lead",children:"检查 GitHub 仓库最新发布版本；如已配置 Vercel 部署钩子，可一键拉取最新代码并重新部署。"}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"当前版本"}),e.jsxs("b",{children:["v",M]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"最新版本"}),e.jsx("b",{children:x.status==="done"?(Ce=x.info)!=null&&Ce.latest?`v${x.info.latest}`:"尚无发布":x.status==="checking"?"检查中…":"—"})]})]}),x.status==="done"&&x.info&&(x.info.hasUpdate?e.jsxs("div",{className:"set-note set-note--warn",children:["发现新版本 v",x.info.latest,x.info.releaseUrl?e.jsxs(e.Fragment,{children:[" · ",e.jsx("a",{href:x.info.releaseUrl,target:"_blank",rel:"noopener noreferrer",children:"查看发布说明"})]}):null]}):e.jsx("p",{className:"set-note",children:"✓ 已是最新版本"})),x.status==="done"&&((Pe=x.info)!=null&&Pe.notes)?e.jsxs(e.Fragment,{children:[e.jsx("button",{className:"set-btn",style:{marginTop:8},onClick:()=>ns(s=>!s),children:de?"收起更新说明":"查看更新说明"}),de&&e.jsx("pre",{className:"set-readme",style:{whiteSpace:"pre-wrap",maxHeight:260,overflow:"auto"},children:x.info.notes})]}):null,x.status==="error"&&e.jsxs("p",{className:"set-note set-note--warn",children:["检查失败：",x.error]}),e.jsxs("div",{className:"set-about__actions",style:{marginTop:12},children:[e.jsx("button",{className:"set-btn set-btn--primary",disabled:x.status==="checking",onClick:vs,children:x.status==="checking"?"检查中…":"检查更新"}),oe&&S("deployment.trigger",i)?e.jsx("button",{className:"set-btn",disabled:C.status==="running",onClick:gs,children:C.status==="running"?"部署中…":"一键拉取并重新部署"}):null]}),!oe&&e.jsxs("p",{className:"set-note",children:["如需「一键重新部署」，请在 Vercel 项目环境变量中配置 ",e.jsx("code",{children:"VERCEL_DEPLOY_HOOK_URL"}),"（Project Settings → Git → Deploy Hooks 生成）。"]}),C.status!=="idle"&&C.msg?e.jsx("p",{className:`set-note${C.status==="error"?" set-note--warn":""}`,children:C.msg}):null]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(xa,{"aria-hidden":"true"}),"公告"]})}),e.jsx("p",{className:"set-card__lead",children:"由作者端统一发布，内容以 Markdown 渲染。"}),is?e.jsx("p",{className:"set-note",children:"公告加载中…"}):he.length===0?e.jsx("p",{className:"set-note",children:"暂无公告。"}):e.jsx(sa,{announcements:he,formatTime:s=>Oe(s)})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ga,{size:20}),"关于"]})}),e.jsxs("div",{className:"set-about",children:[e.jsxs("div",{className:"set-about__meta",children:[e.jsxs("div",{children:[e.jsx("b",{children:"Novora"})," · v",M]}),e.jsx("div",{className:"set-note",children:"React + Vite + Vercel Serverless · Neon Postgres"})]}),e.jsxs("div",{className:"set-about__actions",children:[e.jsx("button",{className:"set-btn",onClick:()=>es(s=>!s),children:te?"收起 README":"查看 README"}),e.jsx("button",{className:"set-btn set-btn--desktop-only",onClick:_s,children:"在新标签页打开 README.md"})]})]}),te&&e.jsx("div",{className:"set-readme md-body",dangerouslySetInnerHTML:{__html:Ns}})]})]})]})}export{Ua as default};
