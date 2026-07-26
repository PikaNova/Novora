import{c as ae,b,a5 as Ws,a6 as Bs,a7 as zs,j as e,C as Fs,f as We,O as Gs,Z as $s,_ as Ks,a8 as Ys,a9 as qs,aa as Be,x as v,t as ze,ab as Js,ac as Q,ad as Zs,ae as Qs,af as Fe,ag as Xs,e as Ge,K as ea,G as sa,P as aa,u as H}from"./index-DAbCDm7h.js";import{b as na,r as n}from"./react-BWeoL3de.js";import{g as ta,D as la,s as ra}from"./designPref-ZugGV3_5.js";import{f as ia,r as oa,C as ca,A as da}from"./announcements-BzdWlztW.js";import{A as ma,C as ha,s as $e,H as Ke,B as ua}from"./AccessDenied-SSRGgrS4.js";import{I as g}from"./InlineSelect-B8G1kQpD.js";import{h as k,g as pa,r as xa,a as C,k as ja,q as ba,i as X,f as U,e as ee}from"./examService-CrCk0w7f.js";import{s as va,a as ga}from"./classSettings-BRb66du2.js";/* empty css                 */import{A as Na}from"./arrow-left-C3UnGQFO.js";import{P as ya,T as fa}from"./type-UuOIDkRw.js";import{A as ka}from"./arrow-right-BGfUH99L.js";import{M as _a}from"./megaphone-yhC_1VY4.js";import"./check-By_nBzGs.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wa=ae("DatabaseZap",[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3",key:"msslwz"}],["path",{d:"M3 5V19A9 3 0 0 0 15 21.84",key:"14ibmq"}],["path",{d:"M21 5V8",key:"1marbg"}],["path",{d:"M21 12L18 17H22L19 22",key:"zafso"}],["path",{d:"M3 12A9 3 0 0 0 14.59 14.87",key:"1y4wr8"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sa=ae("RadioTower",[["path",{d:"M4.9 16.1C1 12.2 1 5.8 4.9 1.9",key:"s0qx1y"}],["path",{d:"M7.8 4.7a6.14 6.14 0 0 0-.8 7.5",key:"1idnkw"}],["circle",{cx:"12",cy:"9",r:"2",key:"1092wv"}],["path",{d:"M16.2 4.8c2 2 2.26 5.11.8 7.47",key:"ojru2q"}],["path",{d:"M19.1 1.9a9.96 9.96 0 0 1 0 14.1",key:"rhi7fg"}],["path",{d:"M9.5 18h5",key:"mfy3pd"}],["path",{d:"m8 22 4-11 4 11",key:"25yftu"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ca=ae("Rocket",[["path",{d:"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",key:"m3kijz"}],["path",{d:"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",key:"1fmvmk"}],["path",{d:"M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",key:"1f8sc4"}],["path",{d:"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",key:"qeys4"}]]),Ye=`# Novora V2.5.6\r
\r
Novora 是面向学校教室大屏的考试与周测安排系统，包含客户端大屏、管理后台、设备管理、网页预览和 A4 PDF 下载。技术栈为 React、TypeScript、Vite、Vercel Functions 与 Neon Postgres。\r
\r
> **官方问题反馈与部署交流群：\`1067566386\`**<br>\r
> 零基础部署遇到问题时，请携带错误提示和 Request ID 入群咨询；不要发送数据库连接串、密码、Deploy Hook 或恢复密钥。\r
\r
![项目预览](https://raw.githubusercontent.com/PikaNova/Novora/refs/heads/main/background.png)\r
\r
一键部署\r
\r
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3a%2f%2fgithub.com%2fPikaNova%2fNovora&project-name=novora-board&repository-name=novora-board&env=DATABASE_URL,ADMIN_PASSWORD&envDescription=请填写%20Neon%20PostgreSQL%20连接字符串和超级管理员初始密码)\r
\r
简易部署：\r
\r
1. 在 Neon 创建 AWS Singapore 数据库并复制 Pooled connection string。\r
2. 点击上方按钮，填写 \`DATABASE_URL\` 和至少 8 位的 \`ADMIN_PASSWORD\`，完成首次 Deploy。\r
3. 在 Vercel \`Settings → Git → Deploy Hooks\` 创建 \`main\` 分支钩子，将 URL 添加为必填的 \`VERCEL_DEPLOY_HOOK_URL\`，然后 Redeploy。\r
4. 确认 Functions 位于 Singapore (\`sin1\`)，并绑定自定义域名。\r
5. 从首页开始初始化，修改初始密码并保存只显示一次的自动恢复密钥。\r
\r
完整零基础教程：[Novora 部署文档](https://github.com/PikaNova/novora-vitepress-docs)\r
\r
## 推荐部署区域\r
\r
\`\`\`text\r
中国大陆客户端\r
  -> Vercel Edge\r
  -> Vercel Functions: sin1 新加坡\r
  -> Neon: AWS ap-southeast-1 新加坡\r
\`\`\`\r
\r
仓库中的 \`vercel.json\` 已固定 Functions 区域为 \`sin1\`。Neon 也应选择 AWS Singapore，避免函数和数据库跨洲通信。Vercel 免费默认域名在中国大陆的可达性仍受运营商影响，正式使用建议绑定自有域名。\r
\r
## 从零部署\r
\r
### 1. 创建 Neon 数据库\r
\r
1. 打开 [Neon Console](https://console.neon.tech/) 并创建项目。\r
2. Provider 选择 AWS，Region 选择 Singapore / \`ap-southeast-1\`。\r
3. 复制 Pooled connection string，保留连接串中的 SSL 参数。\r
\r
### 2. 部署到 Vercel\r
\r
1. Fork 或导入本仓库到自己的 GitHub 账号。\r
2. 在 [Vercel](https://vercel.com/) 中选择 Add New Project 并导入仓库。\r
3. Framework Preset 选择 Vite，Build Command 使用 \`npm run build\`，Output Directory 使用 \`dist\`。\r
4. 首次 Deploy 后创建 \`main\` 分支 Deploy Hook，添加 \`VERCEL_DEPLOY_HOOK_URL\`，再执行一次 Redeploy。\r
\r
| 环境变量 | 必填 | 说明 |\r
| --- | --- | --- |\r
| \`DATABASE_URL\` | 是 | Neon 新加坡 pooled connection string |\r
| \`ADMIN_PASSWORD\` | 是 | 首次创建 \`admin\` 超级管理员的初始密码，至少 8 位，建议 12 位以上 |\r
| \`VERCEL_DEPLOY_HOOK_URL\` | 是（项目创建后补充） | Vercel \`Settings → Git → Deploy Hooks\` 创建的 \`main\` 分支钩子，用于设置页一键部署 |\r
| \`GITHUB_REPO\` | 否 | 更新检查仓库，默认 \`https://github.com/PikaNova/Novora\`；支持完整 GitHub 地址或 \`owner/repo\` |\r
| \`GITHUB_TOKEN\` | 否 | 私有仓库或提高 GitHub API 限额时使用 |\r
| \`ASSET_CDN_BASE\` | 否 | 静态 JS/CSS 的 CDN 基址，未配置时不要填写 |\r
\r
不要把 \`DATABASE_URL\` 或管理员密码写入仓库。\r
\r
### 3. 首次初始化\r
\r
1. 打开部署地址的 \`/login\`。\r
2. 使用用户名 \`admin\` 和 \`ADMIN_PASSWORD\` 登录。\r
3. 首次登录会自动建立数据库表、四个内置角色和超级管理员。\r
4. 按向导选择省份、填写学校名称，创建年级与班级，并设置学期开始日期。\r
5. 向导最后修改初始密码，并保存系统自动生成且只显示一次的恢复密钥。\r
6. 重新登录后创建年级或班级管理员；在首页选择年级、班级后进入大屏。\r
\r
初始化完成后，普通菜单不再显示初始化入口。学校名称、年级、班级或学期需要调整时，请使用后台对应模块；确需重新开始时，先在“系统设置 → 数据维护”中重置学校结构。重复打开旧的 \`?initialize=1\` 地址不会覆盖已有云端数据。\r
\r
当页面提示数据库连接或同步失败时，会同时显示原因与请求 ID。先检查 Vercel 项目中的 \`DATABASE_URL\` 是否为当前 Neon 项目的 pooled connection string，再在 Vercel Functions 日志中搜索该请求 ID。超时和临时断线可以重试；认证失败、未配置连接或数据库结构不兼容需要先修正配置。\r
\r
超级管理员密码和恢复密钥都以加盐哈希保存在 Neon。重新部署不会使密码失效；更换或清空数据库后才会重新使用 \`ADMIN_PASSWORD\` 创建初始账号。忘记密码时，班级管理员联系所属年级管理员或超级管理员，年级管理员联系超级管理员；超级管理员使用首次初始化时保存的恢复密钥。系统无法再次显示恢复密钥原文。\r
\r
## V2 数据策略\r
\r
V2 可从全新数据库开始。代码保留基础旧字段规范化和按需补列，但不保证所有 V1 自定义业务数据完整迁移。升级生产实例前请备份 Neon。\r
\r
需要保留数据库时，可使用 PostgreSQL 官方工具：\r
\r
\`\`\`bash\r
pg_dump --dbname="旧连接串" --format=custom --no-owner --no-privileges --file=exam-board.dump\r
pg_restore --dbname="新加坡连接串" --no-owner --no-privileges exam-board.dump\r
\`\`\`\r
\r
系统设置中的“数据库重置”可整体清理，也可按大型考试、周测、学校结构、设备/插件和调度设置分别清理。登录用户和超级管理员不会随业务数据重置而删除。V2.2 会按需为旧数据库补充 ClassIsland 看板关联字段，无需手工执行迁移脚本。\r
\r
## 免费版约束\r
\r
\`api/\` 当前有 9 个公开路由处理器和 3 个下划线开头的内部共享模块，总源码文件数为 12。设备绑定、ClassIsland 配对、心跳、临时考试远程命令、业务数据和数据库重置均复用 \`/api/exams\`，没有为这些功能继续增加 Vercel Function。\r
\r
## 内部兼容标识\r
\r
更改产品名、GitHub 仓库名或部署域名时，不要批量替换下列标识：\r
\r
- localStorage 的 \`exam-board-*\` 键、IndexedDB 的 \`exam-board-offline\` 和浏览器事件 \`exam-board:*\`。\r
- Service Worker 的 \`exam-board-shell-*\` 缓存前缀；发布新版本时只更新末尾版本号。\r
- ClassIsland 插件 ID \`classisland.exam-reminder\`、程序集名、命名空间和现有 API 版本兼容逻辑。\r
- Neon 中既有数据表及列名。\r
\r
这些是本地数据、设备绑定、PWA 更新和插件升级的兼容契约，不等同于对外品牌。\r
\r
## 路由\r
\r
| 路由 | 用途 |\r
| --- | --- |\r
| \`/\` | 客户端首页与班级选择 |\r
| \`/exam\` | 考试大屏与本地临时考试 |\r
| \`/login\` | 管理员登录 |\r
| \`/admin\` | 管理后台 |\r
| \`/settings\` | 有权限的系统设置 |\r
| \`/preferences\` | 当前设备的只读考试安排预览和导出 |\r
| \`/plugin/connect?token=...\` | ClassIsland 插件配对与班级绑定 |\r
\r
## ClassIsland 插件连接\r
\r
ClassIsland API v2 继续复用 \`/api/exams\`。\`GET /api/exams?action=plugin-api\` 可读取 \`apiVersion\`、最低兼容版本和能力列表；未发送版本字段的旧插件按 API v1 兼容处理，不需要重新绑定。\r
\r
1. ClassIsland 插件使用自己的实例 ID、客户端密钥、API 版本和一次性配对令牌调用 \`/api/exams\` 的 \`plugin-pair-start\`。\r
2. 插件打开 \`/plugin/connect?token=一次性令牌\`，用户在网页中选择年级和班级并确认连接。\r
3. 网页会把插件实例与当前 Novora 看板实例关联；插件通过 \`plugin-bootstrap\` 获取该班级的有效考试安排。\r
4. 设备管理把关联的 Novora 看板和 ClassIsland 显示为同一台设备。删除设备时，两端都会解除绑定并要求重新配对。\r
\r
配对令牌有效期为 5 分钟。客户端密钥只以 SHA-256 摘要保存，配对与同步接口不会返回原始密钥。\r
\r
配套插件可在ClassIsland官方插件仓库中寻找或 \`integrations/ClassIsland.ExamReminder\` 构建：\r
\r
\`\`\`bash\r
dotnet build integrations/ClassIsland.ExamReminder/ClassIsland.ExamReminder.csproj -c Release\r
\`\`\`\r
\r
插件使用 \`ClassIsland.PluginSdk 1.7.106.2-dev-v2\`、\`net8.0-windows\` 和 \`apiVersion: 2\`。Linux 版 ClassIsland 沿用兼容加载方式，浏览器启动失败时会回退到 Linux 桌面命令；旧服务端未声明版本的响应仍可读取。\r
\r
## JSON 导入\r
\r
大型考试示例：\r
\r
\`\`\`json\r
{\r
  "title": "高三周考",\r
  "items": [\r
    {\r
      "name": "语文",\r
      "startTime": "2026-09-07T08:30:00",\r
      "endTime": "2026-09-07T10:30:00",\r
      "enabled": true\r
    }\r
  ]\r
}\r
\`\`\`\r
\r
周测示例：\r
\r
\`\`\`json\r
{\r
  "items": [\r
    {\r
      "name": "数学周测",\r
      "weekday": 3,\r
      "startTime": "19:00",\r
      "endTime": "20:00",\r
      "weekType": "a",\r
      "enabled": true\r
    }\r
  ]\r
}\r
\`\`\`\r
\r
导入窗口可生成提示词。将提示词复制到任意支持图片的 AI 软件、上传考试安排表照片，再把 AI 返回的纯 JSON 粘贴回来校验导入。本项目不会向 AI 服务发送图片或考试数据。\r
\r
## 本地开发\r
\r
\`\`\`bash\r
npm install\r
npm run dev\r
\`\`\`\r
\r
Vite 默认运行在 \`http://localhost:5173\`。本地调试 Vercel Functions 时需要同时使用 Vercel CLI 或等效的本地 API 环境。\r
\r
生产构建：\r
\r
\`\`\`bash\r
npm run build\r
\`\`\`\r
\r
## 遥测说明\r
\r
遥测启用后会上报实例版本、运行环境、匿名实例标识、省份和完整校名，用于作者了解部署运行情况；不上传考试安排正文、管理员密码或用户会话。可在系统设置中关闭并查看当前同意状态。\r
\r
## 更新日志\r
\r
### V2.5.6\r
\r
- “系统设置 → 版本与更新”新增可展开的后续更新完整流程，覆盖同步 Fork、备份、检查版本、Deploy Hook 部署、验收和回滚。\r
- 部署文档细化 \`VERCEL_DEPLOY_HOOK_URL\` 的生成、验证、轮换与故障排查步骤。\r
\r
### V2.5.5\r
\r
- 恢复密钥由项目在首次初始化后自动生成，明文只显示一次，数据库仅保存加盐哈希。\r
- 初始化向导增加密钥保存确认；第一步和最终密钥确认步骤不可关闭。\r
- 使用文档改为推荐阅读，浏览器拦截弹窗时可继续并稍后从公告获取链接。\r
- \`VERCEL_DEPLOY_HOOK_URL\` 列为正式部署必填项，版本检查界面支持一键部署更新。\r
- 新增新加坡 Functions 教程，以及初始化无法完成时的应急管理入口和持续缺项提醒。\r
\r
### 历史版本\r
\r
- V2.5.4：初始化向导、文档确认和超级管理员强制改密。\r
- V2.5.0-V2.5.3：批量班级选择、分级管理员、密码找回和权限体验更新。\r
- V2.4.x：Novora 品牌、A4 PDF、多考试切换、云端初始化和可靠性更新。\r
- V2.2-V2.3：大型考试、周测、设备联动、ClassIsland、Vercel Functions 与 Neon 数据链路。\r
\r
完整发布记录以 [GitHub Releases](https://github.com/PikaNova/Novora/releases) 为准。\r
\r
官方问题反馈与部署交流群：\`1067566386\`。\r
`,Ia="/api/update-check",qe="/api/redeploy",Pa="admin_auth_token";async function Aa(o){try{const u=await fetch(`${Ia}?current=${encodeURIComponent(o)}`,{headers:{"Cache-Control":"no-store"}}),p=await u.json().catch(()=>null);return!u.ok||!(p!=null&&p.ok)?{ok:!1,current:o,latest:null,hasUpdate:!1,error:(p==null?void 0:p.error)||`HTTP ${u.status}`}:p}catch(u){return{ok:!1,current:o,latest:null,hasUpdate:!1,error:u instanceof Error?u.message:"网络错误"}}}async function Da(){try{const u=await(await fetch(qe,{headers:{"Cache-Control":"no-store"}})).json().catch(()=>null);return!!(u!=null&&u.configured)}catch{return!1}}async function Ea(){try{const o={},u=localStorage.getItem(Pa);u&&(o.Authorization=`Bearer ${u}`);const p=await fetch(qe,{method:"POST",headers:o}),r=await p.json().catch(()=>null);return!p.ok||!(r!=null&&r.ok)?{ok:!1,error:(r==null?void 0:r.error)||`HTTP ${p.status}`,code:r==null?void 0:r.code}:{ok:!0,job:r.job}}catch(o){return{ok:!1,error:o instanceof Error?o.message:"网络错误"}}}const E="2.5.6",se=[{value:"alibaba",label:"阿里巴巴普惠体 3"},{value:"sourceHan",label:"思源黑体"},{value:"smiley",label:"得意黑 / Smiley Sans"},{value:"wenkai",label:"霞鹜文楷"},{value:"general",label:"General Sans"}],Ta=[{value:"jbmono",label:"JetBrains Mono（默认 · 等宽）"},{value:"general",label:"General Sans"},{value:"alibaba",label:"阿里巴巴普惠体 3"},{value:"sourceHan",label:"思源黑体"},{value:"smiley",label:"得意黑 / Smiley Sans"},{value:"wenkai",label:"霞鹜文楷"}];function W({checked:o,onChange:u,disabled:p=!1}){return e.jsxs("label",{className:"set-switch",children:[e.jsx("input",{type:"checkbox",checked:o,disabled:p,onChange:r=>u(r.target.checked)}),e.jsx("span",{})]})}function Ya(){var Ee,Te,Re;const o=na(),[u,p]=n.useState(()=>k()),[r,ne]=n.useState(()=>pa()),[Je,Ze]=n.useState(!1);n.useEffect(()=>{if(k()){xa().then(s=>{if(!s){o("/login?next=/settings",{replace:!0});return}if(s.mustChangePassword){o("/admin?tab=users&password=1",{replace:!0});return}if(!C("settings.read",s)){ne(s),p(!0),Ze(!0);return}ne(s),p(!0)});return}ja().then(s=>{s?o("/login?next=/settings",{replace:!0}):p(!0)})},[o]);const[c,te]=n.useState(()=>b().general.timeSync),[Qe,Xe]=n.useState(()=>b().study.alerts.errorCenterMode),[es,ss]=n.useState(()=>b().alerts.silentMode??"all"),[as,ns]=n.useState(()=>ta()),[D,le]=n.useState(()=>b().general.typography),[ts,ls]=n.useState(()=>b().general.motionMode),[re,B]=n.useState(!1),[ie,rs]=n.useState(!1),[oe,is]=n.useState(()=>Ws()),[ce,de]=n.useState(""),[x,me]=n.useState({status:"idle"}),[he,os]=n.useState(!1),[I,z]=n.useState({status:"idle"}),[ue,cs]=n.useState(!1),[pe,ds]=n.useState(!1),ms=n.useMemo(()=>Bs(),[]),xe=zs(),[je,hs]=n.useState([]),[us,be]=n.useState(!0),N=n.useMemo(()=>b().exam,[]),[F,ve]=n.useState(N.weeklyPlans),[G,ps]=n.useState(N.selectedGradeId||((Ee=N.grades[0])==null?void 0:Ee.id)||""),[ge,Ne]=n.useState(N.selectedClassId),[xs,ye]=n.useState(()=>N.activeWeeklyPlanIdByClassId[N.selectedClassId]??N.activeWeeklyPlanId??""),[fe,$]=n.useState(""),[K,ke]=n.useState(!1),Y=n.useRef(!1),[T,js]=n.useState(N.initialization.schoolName),[P,bs]=n.useState(N.initialization.province),[_e,R]=n.useState(""),[_,vs]=n.useState([]),[q,gs]=n.useState(""),[we,Se]=n.useState(!1),[Ce,Ie]=n.useState(!1),d=r?C("settings.edit",r):!k(),M=r?C("weekly.edit",r):!k(),Ns=r?C("alerts.read",r):!k(),ys=r?C("alerts.edit",r):!k(),O=r?C("initialization.run",r):!k(),J=r?r.permissions.includes("*"):!k(),fs=s=>{qs(s),is(s)},ks=async()=>{de("上报中…");const s=await Be("manual");de(s?"已上报 ✓":"上报失败或未启用"),v(s?"success":"error",s?"运行信息已上报作者端。":"上报失败或遥测尚未启用。","遥测上报")};n.useEffect(()=>{Da().then(os).catch(()=>{})},[]),n.useEffect(()=>{let s=!0;return be(!0),ia(!0).then(a=>{s&&hs(a)}).finally(()=>{s&&be(!1)}),()=>{s=!1}},[]);const _s=async()=>{me({status:"checking"});const s=await Aa(E);me(s.ok?{status:"done",info:s}:{status:"error",error:s.error}),v(s.ok?"success":"error",s.ok?s.hasUpdate?`发现新版本 v${s.latest}。`:"当前已经是最新版本。":s.error||"版本检查失败")},ws=async()=>{if(!await ze({title:"重新部署 Novora",message:"将从 GitHub 拉取最新代码并重新构建，约需 1-3 分钟。完成后刷新页面即可使用新版本。",tone:"warning",confirmLabel:"开始部署"}))return;z({status:"running",msg:"已触发，正在部署…"});const s=await Ea();if(s.ok)z({status:"done",msg:"已触发部署，请稍后在 Vercel 查看进度。"}),v("success","Vercel 更新部署已触发。");else{const a=s.code==="NO_HOOK"?"未配置部署钩子（VERCEL_DEPLOY_HOOK_URL）":s.error||"触发失败";z({status:"error",msg:a}),v("error",a,"部署触发失败")}},Ss=n.useMemo(()=>oa(Ye),[]);n.useEffect(()=>{const s=()=>{te(b().general.timeSync),B(!1)};return window.addEventListener("timeSync:updated",s),()=>window.removeEventListener("timeSync:updated",s)},[]);const w=(s,a=!1)=>{Js(s),te(b().general.timeSync),a&&window.dispatchEvent(new CustomEvent("timeSync:reschedule"))},Cs=()=>{B(!0),window.dispatchEvent(new CustomEvent("timeSync:syncNow")),window.setTimeout(()=>B(!1),8e3)},Is=s=>{Q(a=>({study:{...a.study,alerts:{...a.study.alerts,errorCenterMode:s}}})),Xe(s)},Ps=s=>{ra(s),ns(s)},As=s=>{Zs(s),ls(s),Qs(s)},L=(s,a)=>{const t={...D,[s]:a};Q(l=>({general:{...l.general,typography:t}})),le(t),Fe(t)},Ds=()=>{const s={...Xs};Q(a=>({general:{...a.general,typography:s}})),le(s),Fe(s),v("success","字体分区已恢复为设计默认值。")},Es=()=>{const s=new Blob([Ye],{type:"text/markdown;charset=utf-8"}),a=URL.createObjectURL(s);window.open(a,"_blank","noopener,noreferrer"),window.setTimeout(()=>URL.revokeObjectURL(a),6e4)},Ts=async()=>{if(await ze({title:"清除本地设置",message:`确定清除本机所有本地设置并恢复默认？
仅影响当前浏览器，不影响云端考试数据。`,tone:"danger",confirmLabel:"清除并重载"})){try{localStorage.removeItem(Ge),localStorage.removeItem("exam_design_id")}catch{}window.location.reload()}},Rs=async()=>{if(!J||q!=="重置数据库"||!_.length){v("warning","请选择重置范围并输入“重置数据库”。");return}Se(!0);try{const s=localStorage.getItem("admin_auth_token")||"",a=await fetch("/api/exams",{method:"POST",headers:{"Content-Type":"application/json",...s?{Authorization:`Bearer ${s}`}:{}},body:JSON.stringify({action:"reset-data",categories:_})}),t=await a.json().catch(()=>null);if(!a.ok||!(t!=null&&t.ok)){const l=new Response(JSON.stringify(t),{status:a.status,headers:a.headers});throw await ba(l,"数据库重置失败")}v("success","所选云端数据已重置，即将重新载入初始化状态。"),localStorage.removeItem(Ge),localStorage.removeItem("exam_pending_sync"),window.setTimeout(()=>window.location.assign("/"),900)}catch(s){v("error",X(s,"重置失败"),"数据库操作失败"),Se(!1)}},Pe=(s,a)=>vs(t=>s==="all"?a?["all"]:[]:a?[...new Set([...t.filter(l=>l!=="all"),s])]:t.filter(l=>l!==s)),Ae=async s=>{var Oe,Le,Ve,He,Ue;const a=b().exam;if(!a.grades[0]||!a.classes[0]){v("warning","请先完成学校、年级和班级初始化。");return}Ie(!0);const t=ea(sa(Date.now()),1),l={id:"demo_v2_major",name:"演示大型考试",order:a.majors.length,targetGradeIds:[a.grades[0].id],items:[{id:"demo_v2_exam_1",name:"语文",startTime:`${t}T08:30:00`,endTime:`${t}T10:30:00`,enabled:!0,order:0},{id:"demo_v2_exam_2",name:"数学",startTime:`${t}T14:00:00`,endTime:`${t}T16:00:00`,enabled:!0,order:1}]},j={...aa(Date.now(),"演示周测计划"),id:"demo_v2_weekly",gradeId:a.classes[0].gradeId,classId:a.classes[0].id,order:a.weeklyPlans.length,weekMode:"ab",excludeOfficialHolidays:!0,items:[{id:"demo_v2_weekly_1",name:"数学周测",weekday:3,startTime:"19:00",endTime:"20:00",enabled:!0,order:0,weekType:"a"}]},h=s?[...a.majors.filter(i=>!i.id.startsWith("demo_v2_")),l]:a.majors.filter(i=>!i.id.startsWith("demo_v2_")),m=s?[...a.weeklyPlans.filter(i=>!i.id.startsWith("demo_v2_")),j]:a.weeklyPlans.filter(i=>!i.id.startsWith("demo_v2_")),f=h.some(i=>i.id===a.activeMajorId)?a.activeMajorId:((Oe=h[0])==null?void 0:Oe.id)||"",S={...a.activeWeeklyPlanIdByClassId,[j.classId]:s?j.id:((Le=m.find(i=>i.classId===j.classId))==null?void 0:Le.id)??null},Us={...a.initialization,demoDataImported:s},Me={items:((Ve=h.find(i=>i.id===f))==null?void 0:Ve.items)||[],title:((He=h.find(i=>i.id===f))==null?void 0:He.name)||"",majors:h,activeMajorId:f,alerts:b().alerts,scheduleMode:a.scheduleMode,weeklyPlans:m,activeWeeklyPlanId:a.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:S,grades:a.grades,classes:a.classes,weeklyConflictPolicy:a.weeklyConflictPolicy,initialization:Us};try{const i=await U({...Me,baseUpdatedAt:((Ue=ee())==null?void 0:Ue.updatedAt)??0});if(typeof i!="number")throw i&&i!=="unauthorized"&&i.kind==="error"?i.error:new Error("演示数据同步失败，请刷新后重试");H({...Me,updatedAt:i}),v("success",s?"演示考试与周测数据已导入。":"演示数据已移除。")}catch(i){v("error",i instanceof Error?i.message:"演示数据操作失败")}finally{Ie(!1)}},Ms=n.useMemo(()=>va(N.grades),[N]),Os=n.useMemo(()=>ga(N.classes,G),[N,G]),V=F.filter(s=>s.classId===ge),y=V.find(s=>s.id===xs)??V[0]??null,Ls=s=>{var t;Ne(s);const a=b().exam;ye(a.activeWeeklyPlanIdByClassId[s]??((t=F.find(l=>l.classId===s))==null?void 0:t.id)??"")},Z=async s=>{var A;if(!y||!M||Y.current)return;Y.current=!0,ke(!0);const a=F.map(j=>j.id===y.id?{...j,...s}:j);ve(a),H({weeklyPlans:a,updatedAt:Date.now()}),$("正在保存到云端…");const t=b().exam,l={items:t.items,title:t.title,majors:t.majors,activeMajorId:t.activeMajorId,alerts:b().alerts,scheduleMode:t.scheduleMode,weeklyPlans:a,activeWeeklyPlanId:t.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:t.activeWeeklyPlanIdByClassId,grades:t.grades,classes:t.classes,weeklyConflictPolicy:t.weeklyConflictPolicy};try{let j=a,h=await U({...l,baseUpdatedAt:((A=ee())==null?void 0:A.updatedAt)??0});if(h&&typeof h=="object"&&h.kind==="conflict"&&h.remote){const m=h.remote,f=(m.weeklyPlans??a).map(S=>S.id===y.id?{...S,...s}:S);f.some(S=>S.id===y.id)||f.push({...y,...s}),j=f,h=await U({...l,items:m.items,title:m.title,majors:m.majors,activeMajorId:m.activeMajorId,alerts:m.alerts,scheduleMode:m.scheduleMode??l.scheduleMode,weeklyPlans:f,activeWeeklyPlanId:m.activeWeeklyPlanId??l.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:m.activeWeeklyPlanIdByClassId??l.activeWeeklyPlanIdByClassId,grades:m.grades??l.grades,classes:m.classes??l.classes,weeklyConflictPolicy:m.weeklyConflictPolicy??l.weeklyConflictPolicy,baseUpdatedAt:m.updatedAt})}if(h==="unauthorized"){o("/login?next=/settings",{replace:!0});return}if(typeof h=="number")ve(j),H({weeklyPlans:j,updatedAt:h}),$("已保存到云端"),v("success","周测日历设置已保存到云端。");else{const m=h&&h.kind==="error"?X(h.error,"周测日历保存失败"):"周测日历保存失败，请刷新后重试。";$(m),v("error",m,"保存失败")}}finally{Y.current=!1,ke(!1)}},Vs=async()=>{var j;const s=T.trim();if(!s||!O){R(s?"当前账号无权修改学校信息":"请填写学校名称");return}const a=b().exam;if(!P){R("请选择省份或地区");return}const t={...a.initialization,province:P,schoolName:s,schoolFullName:$e(P,s),wizardVersion:Math.max(2,a.initialization.wizardVersion)};H({initialization:t}),R("正在保存到云端…");const l=await U({items:a.items,title:a.title,majors:a.majors,activeMajorId:a.activeMajorId,alerts:b().alerts,scheduleMode:a.scheduleMode,weeklyPlans:a.weeklyPlans,activeWeeklyPlanId:a.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:a.activeWeeklyPlanIdByClassId,grades:a.grades,classes:a.classes,weeklyConflictPolicy:a.weeklyConflictPolicy,initialization:t,baseUpdatedAt:((j=ee())==null?void 0:j.updatedAt)??0});if(l==="unauthorized"){o("/login?next=/settings",{replace:!0});return}const A=l&&typeof l=="object"&&l.kind==="error"?X(l.error,"学校信息保存失败"):"学校信息保存失败，请刷新后重试。";R(typeof l=="number"?"学校信息已保存":A),v(typeof l=="number"?"success":"error",typeof l=="number"?"省份与完整校名已保存。":A,typeof l=="number"?void 0:"保存失败"),typeof l=="number"&&Be("school_name_updated")};if(!u)return e.jsx("div",{className:"set-loading",children:"正在验证管理权限…"});if(Je)return e.jsx(ma,{moduleName:"系统设置",onBack:()=>o("/admin")});const De=Fs(),Hs=c.lastSyncAt>0?We(c.lastSyncAt):"尚未校时";return e.jsxs("div",{className:"set-page",children:[e.jsxs("header",{className:"set-header",children:[e.jsxs("div",{className:"set-header__left",children:[e.jsxs("button",{className:"set-back",onClick:()=>o("/admin"),children:[e.jsx(Na,{"aria-hidden":"true"}),"返回管理"]}),e.jsx("h1",{className:"set-title",children:"系统设置"})]}),e.jsxs("span",{className:"set-version",children:["v",E]})]}),e.jsxs("div",{className:"set-body",children:[!d&&e.jsx("div",{className:"set-note set-note--warn",children:"当前账号对系统设置只有查看权限。如需修改登录密码，请前往“用户与权限”。"}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsx("h2",{className:"set-card__title",children:"学校信息"})}),e.jsx("p",{className:"set-card__lead",children:"学校名称会显示在班级考试安排预览和 A4 PDF 页眉中。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"省份 / 地区"}),e.jsx(g,{className:"set-input",disabled:!O,value:P,onChange:bs,options:[{value:"",label:"请选择省份或地区"},...ha.map(s=>({value:s,label:s}))]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"学校名称"}),e.jsx("input",{className:"set-input",maxLength:80,disabled:!O,value:T,onChange:s=>js(s.target.value),placeholder:"请输入学校名称"})]}),e.jsxs("div",{className:"set-note",children:["完整校名：",e.jsx("strong",{children:$e(P,T)||"尚未填写"})]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!O||!P||!T.trim(),onClick:()=>void Vs(),children:"保存学校信息"}),_e&&e.jsx("p",{className:"set-note","aria-live":"polite",children:_e})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsx("h2",{className:"set-card__title",children:"周测日历"})}),e.jsx("p",{className:"set-card__lead",children:"配置学期周次和法定节假日。学期开始日期所在周按 A 周计算，下一周自动切换为 B 周。"}),e.jsxs("div",{className:"set-fieldset",children:[e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"年级"}),e.jsx(g,{className:"set-input",value:G,onChange:s=>{ps(s),Ne("")},options:[{value:"",label:"请选择年级"},...Ms.map(s=>({value:s.id,label:s.name}))]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"班级"}),e.jsx(g,{className:"set-input",value:ge,onChange:Ls,options:[{value:"",label:"请选择班级"},...Os.map(s=>({value:s.id,label:s.name}))]})]}),V.length>1&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"周测计划"}),e.jsx(g,{className:"set-input",value:(y==null?void 0:y.id)??"",onChange:ye,options:V.map(s=>({value:s.id,label:s.name}))})]}),y?e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"set-row",children:[e.jsxs("label",{className:"set-label",children:["学期开始日期"," ",e.jsx(Ke,{title:"A/B 周基准",children:"该日期所在周固定为 A 周，后续自然周按 A、B 交替推算。修改日期会立即反映到日历预览。"})]}),e.jsx("input",{className:"set-input",type:"date",disabled:!M||K,value:y.anchorDate,onChange:s=>void Z({anchorDate:s.target.value})})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"周次模式"}),e.jsx(g,{className:"set-input",disabled:!M||K,value:y.weekMode??"single",onChange:s=>void Z({weekMode:s}),options:[{value:"single",label:"统一周表"},{value:"ab",label:"A/B 周交替"}]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"法定节假日自动排除"}),e.jsx(W,{checked:y.excludeOfficialHolidays===!0,disabled:!M||K,onChange:s=>void Z({excludeOfficialHolidays:s})})]}),y.excludeOfficialHolidays&&e.jsxs("p",{className:"set-note set-holiday-list",children:["已启用：",Gs.map(s=>`${s.name} ${s.start.slice(5)}~${s.end.slice(5)}`).join(" · ")]}),fe&&e.jsx("p",{className:"set-note","aria-live":"polite",children:fe})]}):e.jsx("div",{className:"set-note set-note--warn",children:"当前班级还没有周测计划，请先到管理后台的“周测”页创建计划。"})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ca,{size:20}),"时间同步（校时）"," ",e.jsx(Ke,{title:"校时方式",children:"时间接口精度最高且适合大屏；HTTP Date 无需专用接口但精度较低；浏览器不能直接使用 NTP。"})]}),e.jsx(W,{checked:c.enabled,disabled:!d,onChange:s=>w({enabled:s},!0)})]}),e.jsx("p",{className:"set-card__lead",children:"开启后大屏时钟、倒计时与全屏提醒均基于校准后的网络时间触发；关闭后回退使用本机时钟。"}),e.jsxs("div",{className:`set-fieldset${c.enabled?"":" is-dim"}`,children:[e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"校时方式"}),e.jsx(g,{className:"set-input",disabled:!d,value:c.provider,onChange:s=>w({provider:s},!0),options:[{value:"timeApi",label:"时间接口 (timeApi · 推荐)"},{value:"httpDate",label:"HTTP 响应头 (Date)"},{value:"ntp",label:"NTP（仅服务端）"}]})]}),c.provider==="timeApi"&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"时间接口 URL"}),e.jsx("input",{className:"set-input",disabled:!d,value:c.timeApiUrl,placeholder:"/api/time",onChange:s=>w({timeApiUrl:s.target.value})})]}),c.provider==="httpDate"&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"探测 URL"}),e.jsx("input",{className:"set-input",disabled:!d,value:c.httpDateUrl,placeholder:"/",onChange:s=>w({httpDateUrl:s.target.value})})]}),c.provider==="ntp"&&e.jsxs("div",{className:"set-note set-note--warn",children:[e.jsx($s,{size:15})," 浏览器环境无法直连 NTP，请改用“时间接口”或“HTTP 响应头”方式；NTP 仅供服务端代理使用。"]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"自动定时校时"}),e.jsx(W,{checked:c.autoSyncEnabled,disabled:!d,onChange:s=>w({autoSyncEnabled:s},!0)})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"校时间隔（秒）"}),e.jsx("input",{className:"set-input set-input--sm",type:"number",min:10,step:10,inputMode:"numeric",disabled:!d,value:c.autoSyncIntervalSec,onChange:s=>w({autoSyncIntervalSec:Math.max(10,Number(s.target.value)||10)},!0)})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"手动微调（毫秒）"}),e.jsx("input",{className:"set-input set-input--sm",type:"number",step:100,disabled:!d,value:c.manualOffsetMs,onChange:s=>w({manualOffsetMs:Number(s.target.value)||0})})]})]}),e.jsxs("div",{className:"set-status",children:[e.jsxs("div",{className:"set-status__row",children:[e.jsx("span",{className:`set-dot ${De?"ok":"wait"}`}),e.jsx("span",{children:De?"已校时":"尚未就绪"})]}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"上次校时"}),e.jsx("b",{children:Hs})]}),e.jsxs("li",{children:[e.jsx("span",{children:"当前网络偏移"}),e.jsxs("b",{children:[c.offsetMs," ms"]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"往返延迟"}),e.jsx("b",{children:c.lastRttMs!=null?`${c.lastRttMs} ms`:"—"})]}),c.lastError?e.jsxs("li",{className:"is-err",children:[e.jsx("span",{children:"上次错误"}),e.jsx("b",{children:c.lastError})]}):null]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!c.enabled||re,onClick:Cs,children:re?"正在校时…":"立即校时"})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ya,{size:20}),"显示"]})}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"默认大屏设计风格"}),e.jsx(g,{className:"set-input",disabled:!d,value:as,onChange:Ps,options:la.map(s=>({value:s.id,label:s.name}))})]}),e.jsx("p",{className:"set-note",children:"也可在大屏右上角“切换风格”里实时预览切换；此处设置作为本机默认。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"动效模式"}),e.jsx(g,{className:"set-input",disabled:!d,value:ts,onChange:s=>As(s),options:[{value:"auto",label:"自动（跟随系统“减少动态效果”偏好）"},{value:"best-effects",label:"最佳效果（开满动效）"},{value:"best-performance",label:"最佳性能（关闭动画 / 过渡 / 毛玻璃）"}]})]}),e.jsx("p",{className:"set-note",children:"最佳效果适合日常展示与体验；一体机、低端设备或投影出现卡顿时可切换到最佳性能，全局关闭动画、过渡与毛玻璃。"})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(fa,{size:20}),"字体分区"]}),e.jsx("button",{className:"set-btn set-btn--ghost",disabled:!d,onClick:Ds,children:"恢复设计默认"})]}),e.jsx("p",{className:"set-card__lead",children:"所有选择均为已随应用打包的本地字体。设置立即作用于当前大屏，并保存到本机；时钟默认使用 JetBrains Mono 等宽数字（子集已随应用打包）。"}),e.jsxs("div",{className:"set-font-grid",children:[e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"① 导航与标签"}),e.jsx(g,{className:"set-input",disabled:!d,value:D.navigation,onChange:s=>L("navigation",s),options:se}),e.jsx("small",{children:"页眉、状态、标签与说明"}),e.jsx("i",{className:"set-font-preview set-font-preview--nav",children:"导航 · 在线 · 已校时"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"② 展示标题"}),e.jsx(g,{className:"set-input",disabled:!d,value:D.display,onChange:s=>L("display",s),options:[{value:"design",label:"按当前设计默认"},...se]}),e.jsx("small",{children:"科目主标题与核心强调"}),e.jsx("i",{className:"set-font-preview set-font-preview--display",children:"语文考试"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"③ 动态内容"}),e.jsx(g,{className:"set-input",disabled:!d,value:D.content,onChange:s=>L("content",s),options:se}),e.jsx("small",{children:"下一科、卡片内容与动态中文"}),e.jsx("i",{className:"set-font-preview set-font-preview--content",children:"下一科：数学 · 14:30"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"④ 时钟与数字"}),e.jsx(g,{className:"set-input",disabled:!d,value:D.numeric,onChange:s=>L("numeric",s),options:Ta}),e.jsx("small",{children:"时钟、倒计时、百分比和进度数字"}),e.jsx("i",{className:"set-font-preview set-font-preview--numeric",children:"09:30:00"})]})]}),e.jsx("p",{className:"set-note",children:"默认方案不再使用霞鹜文楷；如需自定义，可仅在本页手动选择它。"})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ua,{size:20}),"提醒与高级"]})}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"全屏提醒管理"}),Ns?e.jsxs("button",{className:"set-btn",onClick:()=>o("/admin?alerts=1"),children:["前往提醒管理",e.jsx(ka,{"aria-hidden":"true"})]}):e.jsx("span",{className:"set-note",children:"无查看权限"})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"静默模式"}),e.jsx(g,{className:"set-input",disabled:!ys,value:es,onChange:s=>{const a=s;ss(a),Ks({silentMode:a})},options:[{value:"all",label:"全部提醒"},{value:"keyOnly",label:"仅关键提醒（5分钟 / 开考 / 结束 / 下一科）"},{value:"pauseUntilExamEnd",label:"本场进行中暂停提醒"}]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"错误中心模式"}),e.jsx(g,{className:"set-input",disabled:!d,value:Qe,onChange:s=>Is(s),options:[{value:"off",label:"关闭"},{value:"memory",label:"仅内存（本会话）"},{value:"persist",label:"持久化（本地保存）"}]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"重置本地设置"}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:!d,onClick:()=>void Ts(),children:"清除本地缓存并恢复默认"})]})]}),J&&e.jsxs("section",{className:"set-card set-danger-zone",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(wa,{size:20})," 数据库重置"]})}),e.jsx("p",{className:"set-card__lead",children:"仅重置选择的业务数据，不删除超级管理员和其他登录账号。重置学校结构时会同时清除周测与设备绑定。"}),e.jsxs("div",{className:"set-reset-grid",children:[e.jsxs("label",{className:"set-reset-grid__all",children:[e.jsx("input",{type:"checkbox",checked:_.includes("all"),onChange:s=>Pe("all",s.target.checked)}),"整体重置全部业务数据"]}),[["major","大型考试"],["weekly","周测计划"],["school","学校、年级与班级"],["devices","设备绑定、插件与状态"],["settings","提醒与调度设置"]].map(([s,a])=>e.jsxs("label",{children:[e.jsx("input",{type:"checkbox",disabled:_.includes("all"),checked:_.includes("all")||_.includes(s),onChange:t=>Pe(s,t.target.checked)}),a]},s))]}),e.jsxs("label",{className:"set-label",children:["输入“重置数据库”确认",e.jsx("input",{className:"set-input",value:q,onChange:s=>gs(s.target.value)})]}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:we||q!=="重置数据库"||!_.length,onClick:()=>void Rs(),children:we?"正在重置…":"重置所选云端数据"})]}),J&&e.jsxs("details",{className:"set-card set-dev-tools",children:[e.jsx("summary",{children:"开发与测试"}),e.jsx("p",{className:"set-card__lead",children:"测试数据入口只在设置页向超级管理员显示。导入内容带有独立标识，可以单独移除。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"演示考试安排数据"}),e.jsxs("div",{className:"set-inline-actions",children:[e.jsx("button",{className:"set-btn",disabled:Ce,onClick:()=>void Ae(!0),children:"导入测试数据"}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:Ce,onClick:()=>void Ae(!1),children:"移除测试数据"})]})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(Sa,{size:20}),"使用遥测"]}),e.jsx(W,{checked:oe,disabled:!d,onChange:fs})]}),e.jsx("p",{className:"set-card__lead",children:"作者端上报匿名部署/运行数据（版本、主机、时区、地区、匿名 IP 哈希）；不含考试内容与个人信息。"}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"同意状态"}),e.jsx("b",{children:xe==="granted"?"已同意":xe==="denied"?"已拒绝":"未决定"})]}),e.jsxs("li",{children:[e.jsx("span",{children:"实例 ID"}),e.jsxs("b",{children:[ms.slice(0,8),"…"]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"当前版本"}),e.jsxs("b",{children:["v",E]})]})]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!oe||!d,onClick:ks,children:"立即上报一次"}),ce?e.jsx("p",{className:"set-note",children:ce}):null]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(Ca,{size:20}),"版本与更新"]})}),e.jsx("p",{className:"set-card__lead",children:"检查 Novora 官方仓库的最新发布版本；Deploy Hook 会重新拉取当前项目已连接的 main 分支并部署。"}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"当前版本"}),e.jsxs("b",{children:["v",E]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"最新版本"}),e.jsx("b",{children:x.status==="done"?(Te=x.info)!=null&&Te.latest?`v${x.info.latest}`:"尚无发布":x.status==="checking"?"检查中…":"—"})]})]}),x.status==="done"&&x.info&&(x.info.hasUpdate?e.jsxs("div",{className:"set-note set-note--warn",children:["发现新版本 v",x.info.latest,x.info.releaseUrl?e.jsxs(e.Fragment,{children:[" ","·"," ",e.jsx("a",{href:x.info.releaseUrl,target:"_blank",rel:"noopener noreferrer",children:"查看发布说明"})]}):null]}):e.jsx("p",{className:"set-note",children:"✓ 已是最新版本"})),x.status==="done"&&((Re=x.info)!=null&&Re.notes)?e.jsxs(e.Fragment,{children:[e.jsx("button",{className:"set-btn",style:{marginTop:8},onClick:()=>cs(s=>!s),children:ue?"收起更新说明":"查看更新说明"}),ue&&e.jsx("pre",{className:"set-readme",style:{whiteSpace:"pre-wrap",maxHeight:260,overflow:"auto"},children:x.info.notes})]}):null,x.status==="error"&&e.jsxs("p",{className:"set-note set-note--warn",children:["检查失败：",x.error]}),e.jsxs("div",{className:"set-about__actions",style:{marginTop:12},children:[e.jsx("button",{className:"set-btn set-btn--primary",disabled:x.status==="checking",onClick:_s,children:x.status==="checking"?"检查中…":"检查更新"}),he&&C("deployment.trigger",r)?e.jsx("button",{className:"set-btn",disabled:I.status==="running",onClick:ws,children:I.status==="running"?"部署中…":"一键部署更新"}):null,e.jsx("button",{className:"set-btn set-btn--ghost",onClick:()=>ds(s=>!s),children:pe?"收起更新流程":"查看后续更新完整流程"})]}),!he&&e.jsxs("p",{className:"set-note set-note--warn",children:["当前部署缺少必填的 ",e.jsx("code",{children:"VERCEL_DEPLOY_HOOK_URL"}),"。请在 Project Settings → Git → Deploy Hooks 为 main 分支生成钩子，加入环境变量后重新部署。"]}),I.status!=="idle"&&I.msg?e.jsx("p",{className:`set-note${I.status==="error"?" set-note--warn":""}`,children:I.msg}):null,pe&&e.jsxs("div",{className:"set-update-guide",children:[e.jsx("strong",{children:"后续版本更新完整流程"}),e.jsxs("ol",{children:[e.jsxs("li",{children:[e.jsx("b",{children:"确认仓库"}),e.jsx("span",{children:"Deploy Hook 只部署当前 Vercel 项目连接的 main 分支。使用一键部署生成的 Fork 时，先在 GitHub 点击 Sync fork；有自定义代码时先合并上游并解决冲突。"})]}),e.jsxs("li",{children:[e.jsx("b",{children:"备份与安排窗口"}),e.jsx("span",{children:"阅读目标版本发布说明，备份 Neon，并记录当前可用的 Vercel Deployment，避开考试和上课时段。"})]}),e.jsxs("li",{children:[e.jsx("b",{children:"检查版本"}),e.jsx("span",{children:"点击“检查更新”。确认目标版本和发布说明，且 GitHub 生产分支已经包含该版本代码。"})]}),e.jsxs("li",{children:[e.jsx("b",{children:"触发部署"}),e.jsx("span",{children:"点击“一键部署更新”，再到 Vercel Deployments 查看构建。按钮只触发 Deploy Hook，不会替未同步的 Fork 合并官方代码。"})]}),e.jsxs("li",{children:[e.jsx("b",{children:"验收与回滚"}),e.jsx("span",{children:"部署完成后检查首页、登录、数据保存、大屏、PDF 和 ClassIsland；失败时在 Vercel 将上一个成功 Deployment 重新设为生产版本。"})]})]}),e.jsx("a",{href:"https://github.com/PikaNova/novora-vitepress-docs/blob/main/guide/12-maintenance.md",target:"_blank",rel:"noopener noreferrer",children:"打开详细维护文档"})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(_a,{"aria-hidden":"true"}),"公告"]})}),e.jsx("p",{className:"set-card__lead",children:"由作者端统一发布，内容以 Markdown 渲染。"}),us?e.jsx("p",{className:"set-note",children:"公告加载中…"}):je.length===0?e.jsx("p",{className:"set-note",children:"暂无公告。"}):e.jsx(da,{announcements:je,formatTime:s=>We(s)})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(Ys,{size:20}),"关于"]})}),e.jsxs("div",{className:"set-about",children:[e.jsxs("div",{className:"set-about__meta",children:[e.jsxs("div",{children:[e.jsx("b",{children:"Novora"})," · v",E]}),e.jsx("div",{className:"set-note",children:"React + Vite + Vercel Serverless · Neon Postgres"})]}),e.jsxs("div",{className:"set-about__actions",children:[e.jsx("button",{className:"set-btn",onClick:()=>rs(s=>!s),children:ie?"收起 README":"查看 README"}),e.jsx("button",{className:"set-btn set-btn--desktop-only",onClick:Es,children:"在新标签页打开 README.md"})]})]}),ie&&e.jsx("div",{className:"set-readme md-body",dangerouslySetInnerHTML:{__html:Ss}})]})]})]})}export{Ya as default};
