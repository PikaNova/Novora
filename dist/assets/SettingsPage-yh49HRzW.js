import{c as M,b as x,a4 as Es,a5 as Ds,a6 as Rs,j as e,B as Os,f as De,O as Ls,Y as Us,Z as Bs,a7 as Ws,a8 as Re,w as v,a9 as Hs,aa as q,ab as Vs,ac as zs,ad as Oe,ae as Fs,e as Le,J as $s,F as Gs,N as Ks,u as B}from"./index-Dm4Zshva.js";import{b as Ys,r as t}from"./react-DxLXCTaY.js";import{g as Js,D as qs,s as Zs}from"./designPref-tBmOFbJ7.js";import{f as Qs,r as Xs,A as ea}from"./announcements-HhKYV8jT.js";import{A as sa,C as aa,s as Ue,H as Be,B as ta}from"./AccessDenied-C-ElHBLE.js";import{h as f,g as na,r as la,a as S,i as ia,s as W,b as Z}from"./examService-DaF0edYW.js";import{s as ra,a as ca}from"./classSettings-BRb66du2.js";/* empty css                 */import{A as da}from"./arrow-left-Dkv_3HTo.js";import{P as oa,T as ma}from"./type-xeFi4S3P.js";import{A as ha}from"./arrow-right-C6mUq7ux.js";import{M as ua}from"./megaphone-DI36h9Zn.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pa=M("Clock3",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16.5 12",key:"1aq6pp"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xa=M("DatabaseZap",[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3",key:"msslwz"}],["path",{d:"M3 5V19A9 3 0 0 0 15 21.84",key:"14ibmq"}],["path",{d:"M21 5V8",key:"1marbg"}],["path",{d:"M21 12L18 17H22L19 22",key:"zafso"}],["path",{d:"M3 12A9 3 0 0 0 14.59 14.87",key:"1y4wr8"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ja=M("Info",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const va=M("RadioTower",[["path",{d:"M4.9 16.1C1 12.2 1 5.8 4.9 1.9",key:"s0qx1y"}],["path",{d:"M7.8 4.7a6.14 6.14 0 0 0-.8 7.5",key:"1idnkw"}],["circle",{cx:"12",cy:"9",r:"2",key:"1092wv"}],["path",{d:"M16.2 4.8c2 2 2.26 5.11.8 7.47",key:"ojru2q"}],["path",{d:"M19.1 1.9a9.96 9.96 0 0 1 0 14.1",key:"rhi7fg"}],["path",{d:"M9.5 18h5",key:"mfy3pd"}],["path",{d:"m8 22 4-11 4 11",key:"25yftu"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ya=M("Rocket",[["path",{d:"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",key:"m3kijz"}],["path",{d:"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",key:"1fmvmk"}],["path",{d:"M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",key:"1f8sc4"}],["path",{d:"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",key:"qeys4"}]]),We=`# 考试看板 V2

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

超级管理员密码保存在 Neon 的加盐哈希中。重新部署不会使密码失效；更换或清空数据库后才会重新使用 \`ADMIN_PASSWORD\` 创建初始账号。

## V2 数据策略

V2 可从全新数据库开始。代码保留基础旧字段规范化和按需补列，但不保证所有 V1 自定义业务数据完整迁移。升级生产实例前请备份 Neon。

需要保留数据库时，可使用 PostgreSQL 官方工具：

\`\`\`bash
pg_dump --dbname="旧连接串" --format=custom --no-owner --no-privileges --file=exam-board.dump
pg_restore --dbname="新加坡连接串" --no-owner --no-privileges exam-board.dump
\`\`\`

系统设置中的“数据库重置”可按大型考试、周测、学校结构、设备和调度设置分别清理。登录用户和超级管理员不会随业务数据重置而删除。

## 免费版约束

\`api/\` 当前共有 11 个 TypeScript 文件，低于 12 个函数的约束。设备绑定、心跳、临时考试远程命令、业务数据和数据库重置均复用 \`/api/exams\`，没有为这些功能继续增加函数文件。

## 路由

| 路由 | 用途 |
| --- | --- |
| \`/\` | 客户端首页与班级选择 |
| \`/exam\` | 考试大屏与本地临时考试 |
| \`/login\` | 管理员登录 |
| \`/admin\` | 管理后台 |
| \`/settings\` | 有权限的系统设置 |
| \`/preferences\` | 当前设备的只读排班预览和导出 |

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

导入窗口可生成提示词。将提示词复制到任意支持图片的 AI 软件、上传排表照片，再把 AI 返回的纯 JSON 粘贴回来校验导入。本项目不会向 AI 服务发送图片或考试数据。

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

遥测启用后会上报实例版本、运行环境、匿名实例标识、省份和完整校名，用于作者了解部署运行情况；不上传考试排班正文、管理员密码或用户会话。可在系统设置中关闭并查看当前同意状态。

问题反馈交流群：\`1067566386\`。
`,ga="/api/update-check",He="/api/redeploy",Na="admin_auth_token";async function ba(r){try{const h=await fetch(`${ga}?current=${encodeURIComponent(r)}`,{headers:{"Cache-Control":"no-store"}}),u=await h.json().catch(()=>null);return!h.ok||!(u!=null&&u.ok)?{ok:!1,current:r,latest:null,hasUpdate:!1,error:(u==null?void 0:u.error)||`HTTP ${h.status}`}:u}catch(h){return{ok:!1,current:r,latest:null,hasUpdate:!1,error:h instanceof Error?h.message:"网络错误"}}}async function fa(){try{const h=await(await fetch(He,{headers:{"Cache-Control":"no-store"}})).json().catch(()=>null);return!!(h!=null&&h.configured)}catch{return!1}}async function ka(){try{const r={},h=localStorage.getItem(Na);h&&(r.Authorization=`Bearer ${h}`);const u=await fetch(He,{method:"POST",headers:r}),l=await u.json().catch(()=>null);return!u.ok||!(l!=null&&l.ok)?{ok:!1,error:(l==null?void 0:l.error)||`HTTP ${u.status}`,code:l==null?void 0:l.code}:{ok:!0,job:l.job}}catch(r){return{ok:!1,error:r instanceof Error?r.message:"网络错误"}}}const A="2.1.0",Q=[{value:"alibaba",label:"阿里巴巴普惠体 3"},{value:"sourceHan",label:"思源黑体"},{value:"smiley",label:"得意黑 / Smiley Sans"},{value:"wenkai",label:"霞鹜文楷"},{value:"general",label:"General Sans"}],wa=[{value:"jbmono",label:"JetBrains Mono（默认 · 等宽）"},{value:"general",label:"General Sans"},{value:"alibaba",label:"阿里巴巴普惠体 3"},{value:"sourceHan",label:"思源黑体"},{value:"smiley",label:"得意黑 / Smiley Sans"},{value:"wenkai",label:"霞鹜文楷"}];function H({checked:r,onChange:h,disabled:u=!1}){return e.jsxs("label",{className:"set-switch",children:[e.jsx("input",{type:"checkbox",checked:r,disabled:u,onChange:l=>h(l.target.checked)}),e.jsx("span",{})]})}function La(){var _e,Se,Ce;const r=Ys(),[h,u]=t.useState(()=>f()),[l,X]=t.useState(()=>na()),[Ve,ze]=t.useState(!1);t.useEffect(()=>{if(f()){la().then(s=>{if(!s){r("/login?next=/settings",{replace:!0});return}if(s.mustChangePassword){r("/admin?tab=users&password=1",{replace:!0});return}if(!S("settings.read",s)){X(s),u(!0),ze(!0);return}X(s),u(!0)});return}ia().then(s=>{s?r("/login?next=/settings",{replace:!0}):u(!0)})},[r]);const[o,ee]=t.useState(()=>x().general.timeSync),[Fe,$e]=t.useState(()=>x().study.alerts.errorCenterMode),[Ge,Ke]=t.useState(()=>x().alerts.silentMode??"all"),[Ye,Je]=t.useState(()=>Js()),[P,se]=t.useState(()=>x().general.typography),[qe,Ze]=t.useState(()=>x().general.motionMode),[ae,V]=t.useState(!1),[te,Qe]=t.useState(!1),[ne,Xe]=t.useState(()=>Es()),[le,ie]=t.useState(""),[p,re]=t.useState({status:"idle"}),[ce,es]=t.useState(!1),[C,z]=t.useState({status:"idle"}),[de,ss]=t.useState(!1),as=t.useMemo(()=>Ds(),[]),oe=Rs(),[me,ts]=t.useState([]),[ns,he]=t.useState(!0),y=t.useMemo(()=>x().exam,[]),[F,ue]=t.useState(y.weeklyPlans),[$,ls]=t.useState(y.selectedGradeId||((_e=y.grades[0])==null?void 0:_e.id)||""),[pe,xe]=t.useState(y.selectedClassId),[is,je]=t.useState(()=>y.activeWeeklyPlanIdByClassId[y.selectedClassId]??y.activeWeeklyPlanId??""),[ve,G]=t.useState(""),[T,rs]=t.useState(y.initialization.schoolName),[I,cs]=t.useState(y.initialization.province),[ye,E]=t.useState(""),[D,ds]=t.useState([]),[K,os]=t.useState(""),[ge,Ne]=t.useState(!1),[be,fe]=t.useState(!1),m=l?S("settings.edit",l):!f(),R=l?S("weekly.edit",l):!f(),ms=l?S("alerts.read",l):!f(),hs=l?S("alerts.edit",l):!f(),O=l?S("initialization.run",l):!f(),Y=l?l.permissions.includes("*"):!f(),us=s=>{Ws(s),Xe(s)},ps=async()=>{ie("上报中…");const s=await Re("manual");ie(s?"已上报 ✓":"上报失败或未启用"),v(s?"success":"error",s?"运行信息已上报作者端。":"上报失败或遥测尚未启用。","遥测上报")};t.useEffect(()=>{fa().then(es).catch(()=>{})},[]),t.useEffect(()=>{let s=!0;return he(!0),Qs(!0).then(a=>{s&&ts(a)}).finally(()=>{s&&he(!1)}),()=>{s=!1}},[]);const xs=async()=>{re({status:"checking"});const s=await ba(A);re(s.ok?{status:"done",info:s}:{status:"error",error:s.error}),v(s.ok?"success":"error",s.ok?s.hasUpdate?`发现新版本 v${s.latest}。`:"当前已经是最新版本。":s.error||"版本检查失败")},js=async()=>{if(!window.confirm(`确定触发 Vercel 重新部署？
将从 GitHub 拉取最新代码并重新构建，约需 1–3 分钟，完成后刷新页面即为新版本。`))return;z({status:"running",msg:"已触发，正在部署…"});const s=await ka();if(s.ok)z({status:"done",msg:"已触发部署，请稍后在 Vercel 查看进度。"}),v("success","Vercel 重新部署已触发。");else{const a=s.code==="NO_HOOK"?"未配置部署钩子（VERCEL_DEPLOY_HOOK_URL）":s.error||"触发失败";z({status:"error",msg:a}),v("error",a,"部署触发失败")}},vs=t.useMemo(()=>Xs(We),[]);t.useEffect(()=>{const s=()=>{ee(x().general.timeSync),V(!1)};return window.addEventListener("timeSync:updated",s),()=>window.removeEventListener("timeSync:updated",s)},[]);const k=(s,a=!1)=>{Hs(s),ee(x().general.timeSync),a&&window.dispatchEvent(new CustomEvent("timeSync:reschedule"))},ys=()=>{V(!0),window.dispatchEvent(new CustomEvent("timeSync:syncNow")),window.setTimeout(()=>V(!1),8e3)},gs=s=>{q(a=>({study:{...a.study,alerts:{...a.study.alerts,errorCenterMode:s}}})),$e(s)},Ns=s=>{Zs(s),Je(s)},bs=s=>{Vs(s),Ze(s),zs(s)},L=(s,a)=>{const n={...P,[s]:a};q(i=>({general:{...i.general,typography:n}})),se(n),Oe(n)},fs=()=>{const s={...Fs};q(a=>({general:{...a.general,typography:s}})),se(s),Oe(s),v("success","字体分区已恢复为设计默认值。")},ks=()=>{const s=new Blob([We],{type:"text/markdown;charset=utf-8"}),a=URL.createObjectURL(s);window.open(a,"_blank","noopener,noreferrer"),window.setTimeout(()=>URL.revokeObjectURL(a),6e4)},ws=()=>{if(window.confirm(`确定清除本机所有本地设置并恢复默认？
（仅影响当前浏览器，不影响云端考试数据）`)){try{localStorage.removeItem(Le),localStorage.removeItem("exam_design_id")}catch{}window.location.reload()}},_s=async()=>{if(!Y||K!=="重置数据库"||!D.length){v("warning","请选择重置范围并输入“重置数据库”。");return}Ne(!0);try{const s=localStorage.getItem("admin_auth_token")||"",a=await fetch("/api/exams",{method:"POST",headers:{"Content-Type":"application/json",...s?{Authorization:`Bearer ${s}`}:{}},body:JSON.stringify({action:"reset-data",categories:D})}),n=await a.json().catch(()=>null);if(!a.ok||!(n!=null&&n.ok))throw new Error((n==null?void 0:n.error)||"数据库重置失败");v("success","所选云端数据已重置，即将重新载入初始化状态。"),localStorage.removeItem(Le),localStorage.removeItem("exam_board_pending_exam_sync"),window.setTimeout(()=>window.location.assign("/"),900)}catch(s){v("error",s instanceof Error?s.message:"数据库重置失败"),Ne(!1)}},Ss=(s,a)=>ds(n=>a?[...new Set([...n.filter(i=>i!=="all"),s])]:n.filter(i=>i!==s)),ke=async s=>{var Pe,Ae,Me,Te,Ee;const a=x().exam;if(!a.grades[0]||!a.classes[0]){v("warning","请先完成学校、年级和班级初始化。");return}fe(!0);const n=$s(Gs(Date.now()),1),i={id:"demo_v2_major",name:"演示大型考试",order:a.majors.length,targetGradeIds:[a.grades[0].id],items:[{id:"demo_v2_exam_1",name:"语文",startTime:`${n}T08:30:00`,endTime:`${n}T10:30:00`,enabled:!0,order:0},{id:"demo_v2_exam_2",name:"数学",startTime:`${n}T14:00:00`,endTime:`${n}T16:00:00`,enabled:!0,order:1}]},j={...Ks(Date.now(),"演示周测计划"),id:"demo_v2_weekly",gradeId:a.classes[0].gradeId,classId:a.classes[0].id,order:a.weeklyPlans.length,weekMode:"ab",excludeOfficialHolidays:!0,items:[{id:"demo_v2_weekly_1",name:"数学周测",weekday:3,startTime:"19:00",endTime:"20:00",enabled:!0,order:0,weekType:"a"}]},N=s?[...a.majors.filter(c=>!c.id.startsWith("demo_v2_")),i]:a.majors.filter(c=>!c.id.startsWith("demo_v2_")),d=s?[...a.weeklyPlans.filter(c=>!c.id.startsWith("demo_v2_")),j]:a.weeklyPlans.filter(c=>!c.id.startsWith("demo_v2_")),b=N.some(c=>c.id===a.activeMajorId)?a.activeMajorId:((Pe=N[0])==null?void 0:Pe.id)||"",_={...a.activeWeeklyPlanIdByClassId,[j.classId]:s?j.id:((Ae=d.find(c=>c.classId===j.classId))==null?void 0:Ae.id)??null},Ts={...a.initialization,demoDataImported:s},Ie={items:((Me=N.find(c=>c.id===b))==null?void 0:Me.items)||[],title:((Te=N.find(c=>c.id===b))==null?void 0:Te.name)||"",majors:N,activeMajorId:b,alerts:x().alerts,scheduleMode:a.scheduleMode,weeklyPlans:d,activeWeeklyPlanId:a.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:_,grades:a.grades,classes:a.classes,weeklyConflictPolicy:a.weeklyConflictPolicy,initialization:Ts};try{const c=await W({...Ie,baseUpdatedAt:((Ee=Z())==null?void 0:Ee.updatedAt)??0});if(typeof c!="number")throw new Error("演示数据同步失败，请刷新后重试");B({...Ie,updatedAt:c}),v("success",s?"演示考试与周测数据已导入。":"演示数据已移除。")}catch(c){v("error",c instanceof Error?c.message:"演示数据操作失败")}finally{fe(!1)}},Cs=t.useMemo(()=>ra(y.grades),[y]),Is=t.useMemo(()=>ca(y.classes,$),[y,$]),U=F.filter(s=>s.classId===pe),g=U.find(s=>s.id===is)??U[0]??null,Ps=s=>{var n;xe(s);const a=x().exam;je(a.activeWeeklyPlanIdByClassId[s]??((n=F.find(i=>i.classId===s))==null?void 0:n.id)??"")},J=async s=>{var N;if(!g||!R)return;const a=F.map(d=>d.id===g.id?{...d,...s}:d);ue(a),B({weeklyPlans:a,updatedAt:Date.now()}),G("正在保存到云端…");const n=x().exam,i={items:n.items,title:n.title,majors:n.majors,activeMajorId:n.activeMajorId,alerts:x().alerts,scheduleMode:n.scheduleMode,weeklyPlans:a,activeWeeklyPlanId:n.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:n.activeWeeklyPlanIdByClassId,grades:n.grades,classes:n.classes,weeklyConflictPolicy:n.weeklyConflictPolicy};let w=a,j=await W({...i,baseUpdatedAt:((N=Z())==null?void 0:N.updatedAt)??0});if(j&&typeof j=="object"&&j.kind==="conflict"&&j.remote){const d=j.remote,b=(d.weeklyPlans??a).map(_=>_.id===g.id?{..._,...s}:_);b.some(_=>_.id===g.id)||b.push({...g,...s}),w=b,j=await W({...i,items:d.items,title:d.title,majors:d.majors,activeMajorId:d.activeMajorId,alerts:d.alerts,scheduleMode:d.scheduleMode??i.scheduleMode,weeklyPlans:b,activeWeeklyPlanId:d.activeWeeklyPlanId??i.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:d.activeWeeklyPlanIdByClassId??i.activeWeeklyPlanIdByClassId,grades:d.grades??i.grades,classes:d.classes??i.classes,weeklyConflictPolicy:d.weeklyConflictPolicy??i.weeklyConflictPolicy,baseUpdatedAt:d.updatedAt})}if(j==="unauthorized"){r("/login?next=/settings",{replace:!0});return}typeof j=="number"?(ue(w),B({weeklyPlans:w,updatedAt:j}),G("已保存到云端"),v("success","周测日历设置已保存到云端。")):(G("保存失败，请检查网络后重试"),v("error","周测日历保存失败，请检查网络后重试。"))},As=async()=>{var w;const s=T.trim();if(!s||!O){E(s?"当前账号无权修改学校信息":"请填写学校名称");return}const a=x().exam;if(!I){E("请选择省份或地区");return}const n={...a.initialization,province:I,schoolName:s,schoolFullName:Ue(I,s),wizardVersion:Math.max(2,a.initialization.wizardVersion)};B({initialization:n}),E("正在保存到云端…");const i=await W({items:a.items,title:a.title,majors:a.majors,activeMajorId:a.activeMajorId,alerts:x().alerts,scheduleMode:a.scheduleMode,weeklyPlans:a.weeklyPlans,activeWeeklyPlanId:a.activeWeeklyPlanId,activeWeeklyPlanIdByClassId:a.activeWeeklyPlanIdByClassId,grades:a.grades,classes:a.classes,weeklyConflictPolicy:a.weeklyConflictPolicy,initialization:n,baseUpdatedAt:((w=Z())==null?void 0:w.updatedAt)??0});if(i==="unauthorized"){r("/login?next=/settings",{replace:!0});return}E(typeof i=="number"?"学校信息已保存":"保存失败，请检查网络后重试"),v(typeof i=="number"?"success":"error",typeof i=="number"?"省份与完整校名已保存。":"学校信息保存失败，请检查网络后重试。"),typeof i=="number"&&Re("school_name_updated")};if(!h)return e.jsx("div",{className:"set-loading",children:"正在验证管理权限…"});if(Ve)return e.jsx(sa,{moduleName:"系统设置",onBack:()=>r("/admin")});const we=Os(),Ms=o.lastSyncAt>0?De(o.lastSyncAt):"尚未校时";return e.jsxs("div",{className:"set-page",children:[e.jsxs("header",{className:"set-header",children:[e.jsxs("div",{className:"set-header__left",children:[e.jsxs("button",{className:"set-back",onClick:()=>r("/admin"),children:[e.jsx(da,{"aria-hidden":"true"}),"返回管理"]}),e.jsx("h1",{className:"set-title",children:"系统设置"})]}),e.jsxs("span",{className:"set-version",children:["v",A]})]}),e.jsxs("div",{className:"set-body",children:[!m&&e.jsx("div",{className:"set-note set-note--warn",children:"当前账号对系统设置只有查看权限。如需修改登录密码，请前往“用户与权限”。"}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsx("h2",{className:"set-card__title",children:"学校信息"})}),e.jsx("p",{className:"set-card__lead",children:"学校名称会显示在班级考试安排预览和 A4 PDF 页眉中。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"省份 / 地区"}),e.jsxs("select",{className:"set-input",disabled:!O,value:I,onChange:s=>cs(s.target.value),children:[e.jsx("option",{value:"",children:"请选择省份或地区"}),aa.map(s=>e.jsx("option",{value:s,children:s},s))]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"学校名称"}),e.jsx("input",{className:"set-input",maxLength:80,disabled:!O,value:T,onChange:s=>rs(s.target.value),placeholder:"请输入学校名称"})]}),e.jsxs("div",{className:"set-note",children:["完整校名：",e.jsx("strong",{children:Ue(I,T)||"尚未填写"})]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!O||!I||!T.trim(),onClick:()=>void As(),children:"保存学校信息"}),ye&&e.jsx("p",{className:"set-note","aria-live":"polite",children:ye})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsx("h2",{className:"set-card__title",children:"周测日历"})}),e.jsx("p",{className:"set-card__lead",children:"配置学期周次和法定节假日。学期开始日期所在周按 A 周计算，下一周自动切换为 B 周。"}),e.jsxs("div",{className:"set-fieldset",children:[e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"年级"}),e.jsxs("select",{className:"set-input",value:$,onChange:s=>{ls(s.target.value),xe("")},children:[e.jsx("option",{value:"",children:"请选择年级"}),Cs.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"班级"}),e.jsxs("select",{className:"set-input",value:pe,onChange:s=>Ps(s.target.value),children:[e.jsx("option",{value:"",children:"请选择班级"}),Is.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))]})]}),U.length>1&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"周测计划"}),e.jsx("select",{className:"set-input",value:(g==null?void 0:g.id)??"",onChange:s=>je(s.target.value),children:U.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))})]}),g?e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"set-row",children:[e.jsxs("label",{className:"set-label",children:["学期开始日期 ",e.jsx(Be,{title:"A/B 周基准",children:"该日期所在周固定为 A 周，后续自然周按 A、B 交替推算。修改日期会立即反映到日历预览。"})]}),e.jsx("input",{className:"set-input",type:"date",disabled:!R,value:g.anchorDate,onChange:s=>void J({anchorDate:s.target.value})})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"周次模式"}),e.jsxs("select",{className:"set-input",disabled:!R,value:g.weekMode??"single",onChange:s=>void J({weekMode:s.target.value}),children:[e.jsx("option",{value:"single",children:"统一周表"}),e.jsx("option",{value:"ab",children:"A/B 周交替"})]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"法定节假日自动排除"}),e.jsx(H,{checked:g.excludeOfficialHolidays===!0,disabled:!R,onChange:s=>void J({excludeOfficialHolidays:s})})]}),g.excludeOfficialHolidays&&e.jsxs("p",{className:"set-note set-holiday-list",children:["已启用：",Ls.map(s=>`${s.name} ${s.start.slice(5)}~${s.end.slice(5)}`).join(" · ")]}),ve&&e.jsx("p",{className:"set-note","aria-live":"polite",children:ve})]}):e.jsx("div",{className:"set-note set-note--warn",children:"当前班级还没有周测计划，请先到管理后台的“周测”页创建计划。"})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(pa,{size:20}),"时间同步（校时） ",e.jsx(Be,{title:"校时方式",children:"时间接口精度最高且适合大屏；HTTP Date 无需专用接口但精度较低；浏览器不能直接使用 NTP。"})]}),e.jsx(H,{checked:o.enabled,disabled:!m,onChange:s=>k({enabled:s},!0)})]}),e.jsx("p",{className:"set-card__lead",children:"开启后大屏时钟、倒计时与全屏提醒均基于校准后的网络时间触发；关闭后回退使用本机时钟。"}),e.jsxs("div",{className:`set-fieldset${o.enabled?"":" is-dim"}`,children:[e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"校时方式"}),e.jsxs("select",{className:"set-input",disabled:!m,value:o.provider,onChange:s=>k({provider:s.target.value},!0),children:[e.jsx("option",{value:"timeApi",children:"时间接口 (timeApi · 推荐)"}),e.jsx("option",{value:"httpDate",children:"HTTP 响应头 (Date)"}),e.jsx("option",{value:"ntp",children:"NTP（仅服务端）"})]})]}),o.provider==="timeApi"&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"时间接口 URL"}),e.jsx("input",{className:"set-input",disabled:!m,value:o.timeApiUrl,placeholder:"/api/time",onChange:s=>k({timeApiUrl:s.target.value})})]}),o.provider==="httpDate"&&e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"探测 URL"}),e.jsx("input",{className:"set-input",disabled:!m,value:o.httpDateUrl,placeholder:"/",onChange:s=>k({httpDateUrl:s.target.value})})]}),o.provider==="ntp"&&e.jsxs("div",{className:"set-note set-note--warn",children:[e.jsx(Us,{size:15})," 浏览器环境无法直连 NTP，请改用“时间接口”或“HTTP 响应头”方式；NTP 仅供服务端代理使用。"]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"自动定时校时"}),e.jsx(H,{checked:o.autoSyncEnabled,disabled:!m,onChange:s=>k({autoSyncEnabled:s},!0)})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"校时间隔（秒）"}),e.jsx("input",{className:"set-input set-input--sm",type:"number",min:10,step:10,inputMode:"numeric",disabled:!m,value:o.autoSyncIntervalSec,onChange:s=>k({autoSyncIntervalSec:Math.max(10,Number(s.target.value)||10)},!0)})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"手动微调（毫秒）"}),e.jsx("input",{className:"set-input set-input--sm",type:"number",step:100,disabled:!m,value:o.manualOffsetMs,onChange:s=>k({manualOffsetMs:Number(s.target.value)||0})})]})]}),e.jsxs("div",{className:"set-status",children:[e.jsxs("div",{className:"set-status__row",children:[e.jsx("span",{className:`set-dot ${we?"ok":"wait"}`}),e.jsx("span",{children:we?"已校时":"尚未就绪"})]}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"上次校时"}),e.jsx("b",{children:Ms})]}),e.jsxs("li",{children:[e.jsx("span",{children:"当前网络偏移"}),e.jsxs("b",{children:[o.offsetMs," ms"]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"往返延迟"}),e.jsx("b",{children:o.lastRttMs!=null?`${o.lastRttMs} ms`:"—"})]}),o.lastError?e.jsxs("li",{className:"is-err",children:[e.jsx("span",{children:"上次错误"}),e.jsx("b",{children:o.lastError})]}):null]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!o.enabled||ae,onClick:ys,children:ae?"正在校时…":"立即校时"})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(oa,{size:20}),"显示"]})}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"默认大屏设计风格"}),e.jsx("select",{className:"set-input",disabled:!m,value:Ye,onChange:s=>Ns(s.target.value),children:qs.map(s=>e.jsx("option",{value:s.id,children:s.name},s.id))})]}),e.jsx("p",{className:"set-note",children:"也可在大屏右上角“切换风格”里实时预览切换；此处设置作为本机默认。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"动效模式"}),e.jsxs("select",{className:"set-input",disabled:!m,value:qe,onChange:s=>bs(s.target.value),children:[e.jsx("option",{value:"auto",children:"自动（跟随系统“减少动态效果”偏好）"}),e.jsx("option",{value:"best-effects",children:"最佳效果（开满动效）"}),e.jsx("option",{value:"best-performance",children:"最佳性能（关闭动画 / 过渡 / 毛玻璃）"})]})]}),e.jsx("p",{className:"set-note",children:"最佳效果适合日常展示与体验；一体机、低端设备或投影出现卡顿时可切换到最佳性能，全局关闭动画、过渡与毛玻璃。"})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ma,{size:20}),"字体分区"]}),e.jsx("button",{className:"set-btn set-btn--ghost",disabled:!m,onClick:fs,children:"恢复设计默认"})]}),e.jsx("p",{className:"set-card__lead",children:"所有选择均为已随应用打包的本地字体。设置立即作用于当前大屏，并保存到本机；时钟默认使用 JetBrains Mono 等宽数字（子集已随应用打包）。"}),e.jsxs("div",{className:"set-font-grid",children:[e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"① 导航与标签"}),e.jsx("select",{className:"set-input",disabled:!m,value:P.navigation,onChange:s=>L("navigation",s.target.value),children:Q.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))}),e.jsx("small",{children:"页眉、状态、标签与说明"}),e.jsx("i",{className:"set-font-preview set-font-preview--nav",children:"导航 · 在线 · 已校时"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"② 展示标题"}),e.jsxs("select",{className:"set-input",disabled:!m,value:P.display,onChange:s=>L("display",s.target.value),children:[e.jsx("option",{value:"design",children:"按当前设计默认"}),Q.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))]}),e.jsx("small",{children:"科目主标题与核心强调"}),e.jsx("i",{className:"set-font-preview set-font-preview--display",children:"语文考试"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"③ 动态内容"}),e.jsx("select",{className:"set-input",disabled:!m,value:P.content,onChange:s=>L("content",s.target.value),children:Q.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))}),e.jsx("small",{children:"下一科、卡片内容与动态中文"}),e.jsx("i",{className:"set-font-preview set-font-preview--content",children:"下一科：数学 · 14:30"})]}),e.jsxs("label",{className:"set-font-field",children:[e.jsx("span",{children:"④ 时钟与数字"}),e.jsx("select",{className:"set-input",disabled:!m,value:P.numeric,onChange:s=>L("numeric",s.target.value),children:wa.map(s=>e.jsx("option",{value:s.value,children:s.label},s.value))}),e.jsx("small",{children:"时钟、倒计时、百分比和进度数字"}),e.jsx("i",{className:"set-font-preview set-font-preview--numeric",children:"09:30:00"})]})]}),e.jsx("p",{className:"set-note",children:"默认方案不再使用霞鹜文楷；如需自定义，可仅在本页手动选择它。"})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ta,{size:20}),"提醒与高级"]})}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"全屏提醒管理"}),ms?e.jsxs("button",{className:"set-btn",onClick:()=>r("/admin?alerts=1"),children:["前往提醒管理",e.jsx(ha,{"aria-hidden":"true"})]}):e.jsx("span",{className:"set-note",children:"无查看权限"})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"静默模式"}),e.jsxs("select",{className:"set-input",disabled:!hs,value:Ge,onChange:s=>{const a=s.target.value;Ke(a),Bs({silentMode:a})},children:[e.jsx("option",{value:"all",children:"全部提醒"}),e.jsx("option",{value:"keyOnly",children:"仅关键提醒（5分钟 / 开考 / 结束 / 下一科）"}),e.jsx("option",{value:"pauseUntilExamEnd",children:"本场进行中暂停提醒"})]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"错误中心模式"}),e.jsxs("select",{className:"set-input",disabled:!m,value:Fe,onChange:s=>gs(s.target.value),children:[e.jsx("option",{value:"off",children:"关闭"}),e.jsx("option",{value:"memory",children:"仅内存（本会话）"}),e.jsx("option",{value:"persist",children:"持久化（本地保存）"})]})]}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"重置本地设置"}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:!m,onClick:ws,children:"清除本地缓存并恢复默认"})]})]}),Y&&e.jsxs("section",{className:"set-card set-danger-zone",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(xa,{size:20})," 数据库重置"]})}),e.jsx("p",{className:"set-card__lead",children:"仅重置选择的业务数据，不删除超级管理员和其他登录账号。重置学校结构时会同时清除周测与设备绑定。"}),e.jsx("div",{className:"set-reset-grid",children:[["major","大型考试"],["weekly","周测计划"],["school","学校、年级与班级"],["devices","设备绑定与状态"],["settings","提醒与调度设置"]].map(([s,a])=>e.jsxs("label",{children:[e.jsx("input",{type:"checkbox",checked:D.includes(s),onChange:n=>Ss(s,n.target.checked)}),a]},s))}),e.jsxs("label",{className:"set-label",children:["输入“重置数据库”确认",e.jsx("input",{className:"set-input",value:K,onChange:s=>os(s.target.value)})]}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:ge||K!=="重置数据库"||!D.length,onClick:()=>void _s(),children:ge?"正在重置…":"重置所选云端数据"})]}),Y&&e.jsxs("details",{className:"set-card set-dev-tools",children:[e.jsx("summary",{children:"开发与测试"}),e.jsx("p",{className:"set-card__lead",children:"测试数据入口只在设置页向超级管理员显示。导入内容带有独立标识，可以单独移除。"}),e.jsxs("div",{className:"set-row",children:[e.jsx("label",{className:"set-label",children:"演示排班数据"}),e.jsxs("div",{className:"set-inline-actions",children:[e.jsx("button",{className:"set-btn",disabled:be,onClick:()=>void ke(!0),children:"导入测试数据"}),e.jsx("button",{className:"set-btn set-btn--danger",disabled:be,onClick:()=>void ke(!1),children:"移除测试数据"})]})]})]}),e.jsxs("section",{className:"set-card",children:[e.jsxs("div",{className:"set-card__head",children:[e.jsxs("h2",{className:"set-card__title",children:[e.jsx(va,{size:20}),"使用遥测"]}),e.jsx(H,{checked:ne,disabled:!m,onChange:us})]}),e.jsx("p",{className:"set-card__lead",children:"作者端上报匿名部署/运行数据（版本、主机、时区、地区、匿名 IP 哈希）；不含考试内容与个人信息。"}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"同意状态"}),e.jsx("b",{children:oe==="granted"?"已同意":oe==="denied"?"已拒绝":"未决定"})]}),e.jsxs("li",{children:[e.jsx("span",{children:"实例 ID"}),e.jsxs("b",{children:[as.slice(0,8),"…"]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"当前版本"}),e.jsxs("b",{children:["v",A]})]})]}),e.jsx("button",{className:"set-btn set-btn--primary",disabled:!ne||!m,onClick:ps,children:"立即上报一次"}),le?e.jsx("p",{className:"set-note",children:le}):null]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ya,{size:20}),"版本与更新"]})}),e.jsx("p",{className:"set-card__lead",children:"检查 GitHub 仓库最新发布版本；如已配置 Vercel 部署钩子，可一键拉取最新代码并重新部署。"}),e.jsxs("ul",{className:"set-status__list",children:[e.jsxs("li",{children:[e.jsx("span",{children:"当前版本"}),e.jsxs("b",{children:["v",A]})]}),e.jsxs("li",{children:[e.jsx("span",{children:"最新版本"}),e.jsx("b",{children:p.status==="done"?(Se=p.info)!=null&&Se.latest?`v${p.info.latest}`:"尚无发布":p.status==="checking"?"检查中…":"—"})]})]}),p.status==="done"&&p.info&&(p.info.hasUpdate?e.jsxs("div",{className:"set-note set-note--warn",children:["发现新版本 v",p.info.latest,p.info.releaseUrl?e.jsxs(e.Fragment,{children:[" · ",e.jsx("a",{href:p.info.releaseUrl,target:"_blank",rel:"noopener noreferrer",children:"查看发布说明"})]}):null]}):e.jsx("p",{className:"set-note",children:"✓ 已是最新版本"})),p.status==="done"&&((Ce=p.info)!=null&&Ce.notes)?e.jsxs(e.Fragment,{children:[e.jsx("button",{className:"set-btn",style:{marginTop:8},onClick:()=>ss(s=>!s),children:de?"收起更新说明":"查看更新说明"}),de&&e.jsx("pre",{className:"set-readme",style:{whiteSpace:"pre-wrap",maxHeight:260,overflow:"auto"},children:p.info.notes})]}):null,p.status==="error"&&e.jsxs("p",{className:"set-note set-note--warn",children:["检查失败：",p.error]}),e.jsxs("div",{className:"set-about__actions",style:{marginTop:12},children:[e.jsx("button",{className:"set-btn set-btn--primary",disabled:p.status==="checking",onClick:xs,children:p.status==="checking"?"检查中…":"检查更新"}),ce&&S("deployment.trigger",l)?e.jsx("button",{className:"set-btn",disabled:C.status==="running",onClick:js,children:C.status==="running"?"部署中…":"一键拉取并重新部署"}):null]}),!ce&&e.jsxs("p",{className:"set-note",children:["如需「一键重新部署」，请在 Vercel 项目环境变量中配置 ",e.jsx("code",{children:"VERCEL_DEPLOY_HOOK_URL"}),"（Project Settings → Git → Deploy Hooks 生成）。"]}),C.status!=="idle"&&C.msg?e.jsx("p",{className:`set-note${C.status==="error"?" set-note--warn":""}`,children:C.msg}):null]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ua,{"aria-hidden":"true"}),"公告"]})}),e.jsx("p",{className:"set-card__lead",children:"由作者端统一发布，内容以 Markdown 渲染。"}),ns?e.jsx("p",{className:"set-note",children:"公告加载中…"}):me.length===0?e.jsx("p",{className:"set-note",children:"暂无公告。"}):e.jsx(ea,{announcements:me,formatTime:s=>De(s)})]}),e.jsxs("section",{className:"set-card",children:[e.jsx("div",{className:"set-card__head",children:e.jsxs("h2",{className:"set-card__title",children:[e.jsx(ja,{size:20}),"关于"]})}),e.jsxs("div",{className:"set-about",children:[e.jsxs("div",{className:"set-about__meta",children:[e.jsxs("div",{children:[e.jsx("b",{children:"考试看板 Exam Board"})," · v",A]}),e.jsx("div",{className:"set-note",children:"React + Vite + Vercel Serverless · Neon Postgres"})]}),e.jsxs("div",{className:"set-about__actions",children:[e.jsx("button",{className:"set-btn",onClick:()=>Qe(s=>!s),children:te?"收起 README":"查看 README"}),e.jsx("button",{className:"set-btn set-btn--desktop-only",onClick:ks,children:"在新标签页打开 README.md"})]})]}),te&&e.jsx("div",{className:"set-readme md-body",dangerouslySetInnerHTML:{__html:vs}})]})]})]})}export{La as default};
