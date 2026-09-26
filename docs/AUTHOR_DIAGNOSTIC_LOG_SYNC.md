# 作者端诊断日志同步清单

学校端已新增第二条诊断日志链路。它与静默 `POST /api/error-report` 分离：静默摘要继续自动上报，完整日志只在学校设置页由管理员主动选择发送。

## 必须新增

- `POST /api/diagnostic-log-bundles`：接收手动诊断包。
- `uploadId` 唯一约束：重复请求返回原处理状态，不重复计数。
- `source` 仅允许 `manual-date`、`manual-error`。
- 校验 `schemaVersion=1`、`contentEncoding=json`、`entries` 最多 500 条、正文最多 1 MB。
- 处理状态：`received`、`processed`、`failed`、`expired`，失败可重试。
- 诊断包表与静默 `error_reports` 分开，详情页按 `errorEventId/fingerprint` 关联。

## 请求字段

```json
{
  "schemaVersion": 1,
  "uploadId": "bundle_xxx",
  "source": "manual-error",
  "contentEncoding": "json",
  "instanceId": "instance_xxx",
  "deviceId": "device_xxx",
  "errorEventId": "err_xxx",
  "fingerprint": "fp_xxx",
  "errorCode": "SYNC_RETRY_EXHAUSTED",
  "mode": "error",
  "fromTs": 1710000000000,
  "toTs": 1710000060000,
  "appVersion": "2.9.0",
  "commitSha": "abc123",
  "entries": [{ "at": 1710000000100, "level": "error", "message": "sync failed", "source": "sync" }]
}
```

## 作者端 UI/API

- 诊断包列表按实例、版本、来源、时间和处理状态筛选。
- 错误详情显示“存在诊断包”，但默认不把正文混入错误摘要。
- 仅受控诊断页面允许查看/下载正文；记录作者端访问审计。
- 诊断包统计独立于错误次数，不影响 `error_reports` 的指纹聚合。
- 服务端再次脱敏，拒绝考试正文、题目、答案、学生信息、请求体、响应体、Token、Cookie、SQL 和明文 IP。

## 与学校端联调验收

- 按时间发送成功（管理员自选开始/结束时间），来源为 `manual-date`。
- 「发送错误日志」一键全量诊断包发送成功，来源为 `manual-error`，界面回显诊断包 ID。
- 学校端不存在自动/静默的完整日志上传：不发诊断包时作者端收不到任何日志正文。
- 相同 `uploadId` 重试不产生重复记录。
- 作者端不可用时学校端主业务正常，学校端保留 `failed` 状态。
- 静默 `error-report` 仍按原协议工作。
