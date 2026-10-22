# Windows 应用更新

设置页优先读取作者端的 Windows 稳定版推荐，作者端不可达时使用可信 GitHub Releases 中的签名应用包兜底。首次安装、修复安装及原生组件/运行时升级使用完整安装包。更新包不覆盖学校配置、数据库、日志或备份。

## 已实现的边界

- 普通 Windows 设置页提供检查、下载、取消下载/检查、离线导入、安装、未完成更新恢复、最近 50 条结果、下载缓存清理及自愿匿名统计开关。初始化向导不嵌入更新入口。
- 下载/检查/导入均不停止业务服务。下载按字节显示真实进度，支持经 Content-Range 验证的续传；安装和未知耗时阶段显示项目与等待时间。
- 独立提权 `updater/NovoraUpdater.exe` 完成预检查、签名及摘要验证、独立解压、数据库保护备份、停服、兼容迁移、版本切换和 90 秒 HTTP/实际版本验证。
- 签名清单采用 RSA（至少 2048 位）/SHA256/PKCS#1，公钥来自安装目录内管理员维护的 `updater/trust.json`。信任配置缺失、仓库/作者端地址或公钥无效时禁用检查、下载和离线导入/安装；离线包同样必须验证签名。
- 签名清单可包含 `setup:{url,size,sha256}`。设置页只下载并校验完整安装包，然后在资源管理器中定位，不执行安装程序。应用包不满足 Node、最低应用/更新器版本或数据库兼容要求时禁止安装，可展示完整包入口。
- 生产签名密钥已生成并保存在发行环境的秘密存储（不提交仓库、不进入安装包）；公钥尚未配置到作者端，首个生产签名 Release 也尚未上传。在线通道在完成这两步前保持关闭。

## 稳定目录

```text
<InstallRoot>/NovoraLauncher.exe          控制中心，完整包升级
<InstallRoot>/NovoraServiceHost.exe       服务宿主，完整包升级
<InstallRoot>/tray/NovoraTray.exe         托盘，完整包升级
<InstallRoot>/runtime/node.exe           Node 24，完整包升级
<InstallRoot>/updater/NovoraUpdater.exe   独立更新程序
<InstallRoot>/updater/trust.json          发行方公钥与仓库（无私钥）
<InstallRoot>/updater/state.json          最新更新状态
<InstallRoot>/updater/history.json        最近 50 条终态
<InstallRoot>/updater/progress.json       当前项目/实际进度
<InstallRoot>/updater/result.json         最近一次失败的脱敏错误
<InstallRoot>/updater/telemetry/<UUID>/   提权更新器的匿名事件重试队列
<InstallRoot>/active-version.json         原子切换的活动版本
<InstallRoot>/versions/2.8.2/             版本应用文件
```

未生成 `active-version.json` 时，服务继续运行根目录中的原应用。切换后从 `versions/<稳定版号>` 启动，托盘与启动器仍使用原固定路径。配置、数据库和备份继续位于 `%ProgramData%/Novora`；下载缓存位于当前用户 `%LocalAppData%/Novora/updates`，匿名统计偏好与普通事件队列位于 `%LocalAppData%/Novora/update-telemetry`。

活动文件示例：`{"version":"2.8.2","directory":"versions/2.8.2"}`。路径必须为 `.` 或对应的 `versions/<version>`，不接受任意路径。

## 发行信任与构建

可信配置格式（公钥示意，不可直接使用）：

```json
{
  "repository": "PikaNova/Novora",
  "authorBaseUrl": "https://update.pikachu2026.space",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
}
```

公钥须在首次带更新能力的完整安装包中随附。私钥保存在发行环境的秘密存储，不提交仓库、不放进安装包，也不在命令行传入私钥内容。密钥轮换需先通过完整包部署新信任配置。已有旧版安装器不具备此机制，必须先安装一次带更新程序与新服务宿主的完整包。

完整安装包构建可传入 `build.ps1 -UpdateTrustFile <可信配置路径>`，将该配置随安装器发布；未传入时通道保持关闭。仓库精确限定 `PikaNova/Novora`；作者端只允许 `update.pikachu2026.space`（兼容 `telemetry.pikachu2026.space`）、默认 443 端口和根路径，无用户信息、查询或片段。构建保留原始配置的全部字段。

从已完成生产构建的 Windows stage 创建更新包：

```powershell
powershell -NoProfile -File packaging/windows/build-update.ps1 `
  -Stage artifacts/windows/stage -Output artifacts/windows-update/2.8.2 `
  -Repository PikaNova/Novora -MinimumVersion 2.8.1 `
  -NotesFile release-notes.txt -SigningKeyFile C:/release-secrets/windows-update-private.pem
```

stage 的 `package.json` 必须已经是目标版本；目标必须高于最低源版本。输入必须包含 `dist/`、`server-build/`、Windows x64 的生产 `node_modules/`、`package.json` 和 lockfile。不在用户电脑运行 npm 或源码构建。大体积 Node/.NET/PostgreSQL 运行时不进入应用包。

需要完整包入口时，额外成对传入 `-SetupFile <已构建安装包>` 和 `-SetupUrl https://github.com/PikaNova/Novora/releases/download/v<version>/Novora-Setup-<version>.exe`。打包器从实际文件计算大小及 SHA256，并将其与 URL 一起写入签名清单；不提供时保留旧清单兼容性。完整包必须与目标版本一致，发布方负责构建与验收这一对应关系。

输出文件：

- `Novora-App-<version>-win-x64.zip`：应用 payload。
- `release-manifest.json` 与二进制 `release-manifest.sig`：签名元数据。
- `Novora-App-<version>-win-x64.nvu`：离线容器，恰好包含上述清单、签名与名为 `payload.zip` 的应用包。

将前三项作为同一个 GitHub 稳定 Release 的资产，标签固定为 `v<version>`；有 `setup` 时一并发布对应完整包。构建命令不会上传或发布。客户端不接受跨仓库、HTTP、非默认端口或带用户信息/查询/片段的资产地址。GitHub 网络不可用时使用 `.nvu` 导入。

`.github/workflows/windows-app-update.yml` 提供手动构建流水线，指定已有版本标签和最低源版本，经过独立 PostgreSQL 集成、全量验证和更新核心测试后生成签名资产，上传到 workflow artifact。它不创建或修改 GitHub Release。需在 `windows-release` 环境配置 `NOVORA_UPDATE_SIGNING_KEY_PEM`；发行方按自己的审批要求设置环境保护规则。生产公钥需与该私钥匹配，并通过完整安装包部署。该远端流水线本轮尚未运行。

## 作者端推荐与 GitHub 兜底

首选请求为 `GET https://update.pikachu2026.space/api/release-manifest?platform=win-x64&channel=stable`，每个来源的检查有 30 秒总时限。成功响应要求 `ok:true`、`source:"author"`、布尔 `available`；有推荐时还要求 `version`、`repository`、`manifestBase64`、`signatureBase64`。清单按 Base64 解码后的原始字节验签，不能重新序列化后验证；外层版本、仓库与签名清单及本机信任配置必须一致。

| 作者端结果                                | 客户端行为                                |
| ----------------------------------------- | ----------------------------------------- |
| `available:false` 或已是当前/更旧版本     | 正常无更新，不访问 GitHub                 |
| DNS/连接失败、请求超时、HTTP 408/429/5xx  | 查询固定仓库的 GitHub latest 正式稳定发布 |
| HTTP 400/401/403/404/409 等其它错误       | 显示失败，不兜底                          |
| 清单/签名/仓库/平台/版本/响应大小校验失败 | 显示失败，不兜底                          |
| 用户取消                                  | 立即结束，不再发起兜底                    |

作者端复验失败使用 `409 RELEASE_VERIFICATION_FAILED`；数据库或服务不可用使用 503。GitHub 兜底仍要求唯一的 `release-manifest.json` 和 `release-manifest.sig`，验证本机公钥签名、`v<version>` 标签及包摘要；失败不会再切换到其它源。设置页展示实际来源。

当作者端不可达时，客户端无法获知作者端刚刚撤回的推荐，GitHub 上仍保留的稳定资产可能被选中。因此紧急撤回需同时处理 GitHub 稳定发布，或恢复作者端让其明确返回无推荐。

## 自愿匿名事件

默认不开启、不开标识、不发送；只有用户在设置页开启后才生成当前 Windows 用户的随机 UUID。跨 UAC 账号时把该 UUID、尝试 UUID 与来源传给提权更新器，更新器不继承管理员账号自身的偏好。此标识不代表学校/设备业务身份；不同 Windows 用户各自独立。

事件仅发送到 `POST https://update.pikachu2026.space/api/release-manifest?platform=win-x64&resource=events`，字段为 `eventId/installationId/attemptId/stage/currentVersion/targetVersion/errorCode/source`。前三项为 UUID，阶段限于 `check/available/verified/installing/succeeded/failed/rolled-back`；版本为稳定三段版号；错误只用枚举式大写码，不包含异常正文、路径、账号或连接串。`source` 为 `author/github/offline`，旧事件未提供或 null 由作者端按 `unknown` 处理；至少 available/verified 记录实际来源。

先持久化本地事件，每个队列最多 100 条、单文件最多 4 KB；整批上报限时 5 秒，失败保留原 eventId 重试，不影响检查/下载/安装的结果。作者端按 eventId 去重，每安装标识每小时限制 100 条。提权队列按发起用户 UUID 隔离，并在操作结束（包括失败）时尝试发送；下次同一用户明确启用统计并发起维护时重试。关闭统计清除普通用户的标识与待发队列，此后不发送；重新启用会生成新标识，不再继续旧提权队列。卸载是否清除安装目录仍由卸载流程决定。

## 数据库与回退

首期应用更新只接受 `databaseMode=backward-compatible`，运行时要求 Node 24、Windows x64、更新程序版本满足 minimumUpdater。破坏性迁移或运行时不兼容必须使用专门升级流程/完整安装包。

当前完整安装器遇到已有 `active-version.json` 或根应用版本高于待装版本时，在停止服务和替换文件前拒绝覆盖。只更新根包并保留旧活动指针不能完成升级；这些机器需要后续支持活动版本迁移、保护备份、显式切换与失败恢复的完整升级流程。不要手工删除指针或用旧完整包降级。设置页下载完整包不代表该安装器已支持此升级场景。

发布方仅将**本次需要执行、与所有允许源版本兼容的新增迁移**放入 stage 的 `update-migrations/*.sql`，不要复制历史迁移全集。文件名为数字前缀加下划线字母数字，例如 `0011_add_index.sql`。它们被打入 payload 的 `migrations/`，顺序登记在签名清单。

更新程序通过 `psql -X --single-transaction -v ON_ERROR_STOP=1` 执行清单指定 SQL，使用 `public.novora_windows_updates` 记录成功版本，避免中断重试重复执行。迁移文件须是事务内 SQL，不能包含 `BEGIN/COMMIT/ROLLBACK`、psql 元命令或需要事务外执行的 DDL。跨版本兼容性仍须由发布测试验证，签名不能证明 SQL 与旧业务代码兼容。

备份名为 `novora-before-update-*.dump`，先写 `.partial`，pg_dump 成功且 pg_restore --list 通过才提交。保护备份与恢复前保护备份一样不参与普通保留数量清理。需要足够备份空间；首期固定最低检查为应用盘 5 GB、备份盘 1 GB，不能保证所有大型数据库空间足够，实际写入失败将中止更新。

更新/备份/恢复/安装共用 `Global\Novora.DatabaseMaintenance` 排他锁。数据库连接必须指向安装器管理的本机 `novora` 库，明确拒绝本机 5432 实例。更新一般不停止 PostgreSQL。

新版启动或健康失败时恢复上一应用指向，再启动验证；数据库保持兼容迁移后的状态，不自动用备份覆盖可能已产生的新数据。旧版也无法恢复时显示 `repair-required`，保留应用、状态与保护备份。

## 中断状态

`state.json` 字段为 `phase/targetVersion/previous:{version,directory}/detail/time`，新记录可附 `attemptId/source`，旧记录仍可恢复。

| phase                                    | 处理                                                            |
| ---------------------------------------- | --------------------------------------------------------------- |
| preparing、backing-up                    | 尚未切换；中断后旧版继续运行，可重试                            |
| stopping、migrating、switching           | 服务宿主拒绝自行启动；在设置中恢复                              |
| verifying、rolling-back、repair-required | 更新结果未确认，需要恢复；运行中的 updater 持有锁时不能重复执行 |
| succeeded、failed、rolled-back           | 终态，记录结果后允许下一次操作                                  |

恢复入口切回上次更新前的应用版本并验证健康，不恢复数据库。控制中心关闭不会杀掉更新程序；再次进入设置可观察仍在运行的更新程序。

## 验证与剩余验收

```powershell
dotnet run --project packaging/windows/Novora.Update.Tests -c Release
pwsh -NoProfile -File packaging/windows/smoke-updates.ps1 -InstallRoot artifacts/windows-2.8.1/stage
```

核心测试覆盖作者端原始清单字节验签、无推荐不兜底、网络/超时/408/429/5xx 兜底、409及坏清单不兜底、取消、GitHub 错签名/标签不匹配、完整包下载与篡改、匿名开关/JSON/队列上限/失败重试/时限、UAC身份传递，以及签名篡改、错误密钥、降级、跨仓库、不兼容安装、ZIP 越界、配置覆盖、损坏包、备份失败、健康失败回退/重试、迁移失败、回退失败、掉电恢复和活动目录边界。真实签名打包（含 setup 元数据）→离线导入→隔离安装链同样覆盖。密钥仅为测试临时生成，打包检查后删除测试私钥。

数据库 smoke 使用临时数据目录与随机空闲端口，运行真实 initdb/pg_dump/pg_restore/psql，验证保护备份、迁移幂等、失败事务回滚与 ledger；不接触已安装数据库或 Windows 服务。

仍需在可回滚的目标 Windows 虚拟机验收：真实 SCM 版本切换、提权取消、更新中断/断电、跨账号观察、低磁盘空间、下载续传/GitHub 限流、完整安装包升级与保留版本，以及首个生产公钥签名 Release 的在线下载。未完成这些验收前不能标记生产更新通道已上线。
