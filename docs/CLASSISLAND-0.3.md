# ClassIsland 考试提醒 0.3.0 配套更新

插件项目：<https://github.com/PikaNova/ClassIsland.ExamReminder>。独立插件仓库是 0.3.0 的发布来源；本次配套改动不替换 integrations 下的历史插件副本。

## 条件同步

继续使用 POST /api/exams、action=plugin-bootstrap，兼容旧客户端。新请求可带：

```json
{
  "action": "plugin-bootstrap",
  "pluginInstanceId": "...",
  "clientSecret": "...",
  "knownVersion": "上次收到的version",
  "includeCompletedToday": true
}
```

- 不带 knownVersion 或版本不一致：完整响应额外包含 changed=true、version。
- 版本一致：返回 ok、API 元信息、changed=false、version、serverTime、viewerOnline；省略 exams 与 binding，客户端保留上次完整数据。
- 版本覆盖考试 updated_at、年级/班级、绑定浏览器及中国日历日期；午夜重新获取完整数据。
- 每次仍校验凭据、设备撤销和班级绑定。不能直接对不同凭据共享私有响应。
- 稳定状态下，一次 JOIN 小查询检查凭据、设备与考试修订，不读取大 JSON，也不更新插件记录。
- 完整响应仅在班级字段变化时写插件记录。
- includeCompletedToday=true 保留中国日历当天已结束的考试，使上午/下午整段考试模式能覆盖场间。
- capability 增加 conditional-sync 和 session-history，API 大版本仍为 2。

不带新字段的旧客户端保持原来的考试过滤窗口与完整响应。

## 作者公告

/api/announcements 的公开作者公告代理增加 60 秒进程内缓存与并发请求合并；不同 limit 共享一次最多 50 条的回源。缓存条目以上游地址为键，作者端把公告域名下发到别处时立即失效，不会等 TTL。现有 CDN 缓存头保持不变，发布/撤下时间仍逐次过滤。图片路由保持原行为；上游按状态码拒绝仍如实回 502 `upstream_failed`，不塌成本地 500。

此缓存仅在同一个 warm 进程内共享；多实例或 Serverless 冷启动仍会各自回源，不能据此宣称全局只有一个请求。

## 验证

- plugin.test.ts：版本变化与中国午夜失效，当天已结束考试及旧客户端兼容。
- announcementCache.test.ts：并发合并、失效重取、失败释放、撤下空列表和代理路由过滤。
- tests/integration/pluginSync.integration.test.ts：仅允许显式隔离数据库，验证真实 PostgreSQL 完整/轻量响应、不写插件记录、修改、换班、撤销、旧请求和错误凭据。
- 默认使用仓库 verify:fast；API 改动另跑 typecheck:api。

无需数据库迁移，无需修改部署者环境变量。插件安装与 Novora 更新应配套进行；单独安装插件仍可降级为旧协议完整同步。
