# 学校运行日志接口（第一期）

全部复用 `/api/diagnostic-logs?resource=runtime-*`；不转发作者端。事件结构严格使用 `src/shared/runtimeLog.ts`，服务端不修改该共享文件。时间单位均为毫秒。

## 设备客户端

- `POST runtime-enroll`：`{instanceId, secret}`。secret 必须为客户端 crypto 生成的 64 位小写十六进制随机数，并持久化。仅注册到现有且未撤销的 device_instances；返回 `{ok:true,status:'pending'|'approved'|'rejected'|'revoked', enrollmentId}`。服务端只保存 SHA-256。管理员核对设备及 enrollmentId 后批准，已批准凭证不被其他申请覆盖。同一 secret 幂等。客户端更换 secret 需重新审批。
- 以下接口使用 `Authorization: Bearer <secret>`，并在 GET query / POST body 提供 instanceId。未批准返回 403 `DEVICE_LOG_NOT_APPROVED`，撤销或错误凭证返回 401。此凭证不授予任何管理员权限。
- `POST runtime-ingest`：`{instanceId, entries:RuntimeEvent[], taskId?:string}`。每批 1～250 条，JSON 最大 512 KiB；非法条目整批拒绝。返回 `{ok:true,accepted:number,duplicates:number}`，按 `(instanceId,eventId)` 去重。只有成功响应后才移出待传队列。
- `GET runtime-poll&instanceId=...`：返回 `{ok:true,tasks:[{id,fromTs,toTs,expiresAt,status}]}`。最多 10 项；同一设备多个页面可能重复领取，taskId 和 eventId 必须幂等。任务不因首次领取即视为成功。
- `POST runtime-complete`：`{instanceId,taskId,status:'completed'|'failed',detail?:string,truncatedCount?:number}`。上传所有批次成功后才完成；空日志可以完成，detail 说明原因；截断如实报告。响应 `{ok:true}`。同结果重复提交幂等；任务 24 小时后过期，过期拒绝上传/完成。客户端崩溃后可继续领取 claimed 任务。

事件原始 at 可受设备时钟影响，因此学校保留收到时间 received_at，用它判定服务器保留期。会话时间线按 sessionId/sequence 排序，monoMs 用于会话内耗时。不得用任意校准后的时钟裁掉服务端数据。

## 管理端

管理员 Bearer 沿用 authHeaders。所有接口要求全校范围（含超级管理员），不允许班级范围读取全校日志。

- `GET runtime-dashboard&from=...&to=...&instanceId=...&level=...&category=...&q=...&cursor=...`：diagnostics.read。from/to 是服务端接收时间，默认 24 小时，最多 30 天；按接收时间倒序。返回 `{ok:true,fetchedAt,entries,hasMore,nextCursor,summary,trend,devices,enrollments,tasks,storage}`。每页 100 条；cursor 是不透明字符串，必须原样传回 nextCursor，不能自行构造。entries 含数据库 id/instance_id/received_at 和 event；summary 为筛选条件对应的总数/错误/警告；trend 是接收时间的小时分桶。关联查询额外支持 operationId/sessionId，sessionId 查询按 sequence 升序分页。
- `POST runtime-approve`：diagnostics.settings。`{enrollmentId,approve:boolean}`；审批必须指定确切申请 ID，不能只凭 instanceId。批准时原凭证撤销。操作审计。
- `POST runtime-collect`：diagnostics.upload。`{instanceId,fromTs,toTs}`，设备日志原始时间范围，最长 7 天；返回 `{ok:true,taskId}`。结束时间超过服务端当前时间时截到当前时间。24 小时内最多 5 个未完成任务/设备。操作审计。
- `GET runtime-export`：diagnostics.download。筛选字段同 dashboard。返回 `{ok:true,entries,truncated,limit:5000}`；客户端下载 JSON，截断显式提示。操作审计。

## 留存及边界

普通事件 7 天，warn/error 30 天；服务端最多 100000 条、每设备最多 10000 条，按接收时间删最旧记录；任务与申请 30 天回收。所有进入数据库或文件的事件先经过共享 sanitizer。文件兜底仅本地部署，`NOVORA_RUNTIME_LOG_DIR` 可配置绝对目录，Windows 默认 `%LOCALAPPDATA%/Novora/runtime-logs`，其他系统为 `~/.local/state/Novora/runtime-logs`；3 个各最多 4 MiB 的轮转文件，数据库恢复后幂等补录。Vercel 不提供持久文件兜底。单实例入口每凭证/IP 每分钟最多 120 次请求，429 带 Retry-After，客户端需退避。

本地进程请求监控记录错误/慢请求及按分钟汇总成功请求，不记录 body、query、凭据、SQL。数据库故障不阻塞 HTTP 返回。文件补录和日志写入内部错误不递归采集。系统状态来自现有 `/api/status`（当前仅超管可读），日志查询失败必须显示不可用，不显示为零。第一期趋势来自留存的事件，不宣称跨进程 CPU 历史监控。
