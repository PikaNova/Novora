# M1：遥测域名拆分 - 静态覆盖位与独立配置端点（2026-10-22）

**目标：** 为学校端提供 3 个 per-service URL 覆盖位，让学校侧不再硬编码作者端域名；同时剥离 `config` 为独立端点，解决公告可缓存控制面不匹配的问题。

## 一、变更清单

### 1. 作者端 (`exam-board-telemetry-author`)

#### 新增文件

- `api/config.ts` — 新的远程配置路由，`no-store` 响应头，继承自旧 `?resource=config` 分支。

#### 修改文件

| 文件                          | 改动                                                                                     | 原因                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/_remoteConfig.ts`        | +4 字段 (`updateBaseUrl`/`ingestBaseUrl`/`contentBaseUrl`/`authBaseUrl`)                 | remote_config 的灰度通道，下发即生效、清空即回滚。添加白名单校验：仅允许 `*.pikachu2026.space` 主机列表，拦截子域接管攻击。读取/写入路径都执行过滤（防御人工改坏 DB）。 |
| `api/public-announcements.ts` | 将 `?resource=config` 分支改为调用 `configHandler`                                       | **修复线上缺陷**：旧代码对公告设置 CDN 缓存头后直接返回 config JSON → kill switch 被缓存最多 60s+SWR。新实现把 config 提前分流，保证 no-store 生效。                    |
| `api/release-manifest.ts`     | `Cache-Control: no-store` → `public, max-age=0, s-maxage=30, stale-while-revalidate=120` | 最高 QPS 读路径（学校轮询+Windows 更新器），给共享缓存 30s 吸重复请求，source-only cache + SWR 兜住源站故障。                                                           |
| `server.ts`                   | 注册 `/api/config` route                                                                 | 暴露新的 config 端点。                                                                                                                                                  |
| `DEPLOY-SELFHOST.md`          | Docker 段增加说明：容器只绑定回环地址，不能公网直连                                      | 呼应 docker-compose.yml 收口 127.0.0.1:3005 的配置（已改未提交）。                                                                                                      |
| `docker-compose.yml`          | `- "${PORT:-3000}:3000"` → `- "127.0.0.1:${PORT:-3000}:3000"`                            | 收口公网旁路，确保 nginx 边缘策略真正生效。（尚未 push）                                                                                                                |

#### 测试

- 新增 `tests/serviceUrlGuard.test.mjs` (7 条用例)：合法基址通过、空值表示清除、http/non-trusted host 拒绝、同后缀未知子域拒绝（子域接管防线）、读路径过滤脏数据、干净配置原样返回（identity）。
- 全部测试 166 跑通：pass 158, fail 0, skipped 8 (集成需 `INTEGRATION_DATABASE_URL`)。

### 2. 学校端 (`novora-main-latest`)

#### 修改文件

| 文件                                 | 改动                                                                                      | 原因                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `api/_telemetryConfig.ts`            | +REPO_UPDATE_URL / REPO_IMAGES_URL / REPO_DIAGNOSTIC_URL；`telemetryConfig` 增加对应字段  | 三处原本拼 baseUrl 的地方现在可独立指定。默认值不变（保持向后兼容）。 |
| `api/_system/updateCheck.ts`         | `AUTHOR_MANIFEST_PATH` 常量删除；line 166 改用 `telemetryConfig.updateUrl`                | 用新覆盖位替代硬编码路径。注释更新描述新的行为。                      |
| `api/_content/announcementImages.ts` | `IMAGES_BASE` 从 `${baseUrl}/api/announcement-images` 改为 `telemetryConfig.imagesUrl`    | 同样使用新覆盖位。                                                    |
| `api/_diagnosticQueue.ts`            | `fetch(\`${baseUrl}/api/diagnostic-log-bundles\`)`→`fetch(telemetryConfig.diagnosticUrl)` | 同上。                                                                |

## 二、关键设计决策

1. **为什么不一次性把所有服务都支持动态下发？**  
   `update` 是 recovery path——当其它服务（公告等）不可达时，更新检查应该依然能工作。如果 update 的 URL 来自公告端点解析（通过 remote_config 获取 base url），就形成循环依赖。所以 **update 只有静态覆盖位（env/REPO\_*）**，没有 dynamic remote-config 层。将来若要支持 dynamic update URL，需要单独做启动顺序保障（先起 update 后端）。

2. **为什么白名单是 exact host list 而不是 `*.pikachu2026.space`？**  
   后缀匹配会向全校开放任意一个被遗忘的子域的潜在风险：子域接管即可静默收到上报。精确白名单在迁移域名时只需改一行常数字典，成本可控且安全收益明确。

3. **为什么 `release-manifest` 去 `no-store`？**  
   这是整台机最高 QPS 的路径（每个学校每 5min 一轮检查 + Windows 每台定期轮询）。去掉 `no-store` 让 nginx/CDN 可以缓存命中、吸收重复请求，同时 `max-age=0` 不给客户端缓存、保持源站的最新性，`s-maxage`+SWR 兜住数据库瞬时不可用的情况。

4. **为什么 `config` 端点和 `author.` 的 SPA 分离？**  
   控制面的 kill switch 和公告的 CDN 缓存必须互斥。统一响应头必然牺牲一方。把它们分成两个物理入口，各自定义缓存策略，是最简单的解法。后续如果继续扩展（例如 `schoolservice` 指令面），继续沿这种思路走。

## 三、验证命令

### 作者端

```bash
cd exam-board-telemetry-author
npm run build:server && npm run typecheck && npm test
# 或简化：npm run verify:fast（增量编译 + 受影响的单元测试）
```

预期：typecheck 通过，166 用例全部通过。

### 学校端

```bash
cd novora-main-latest
npm run verify:fast
```

预期：930 用例全部通过（包括 `updateCheckManifest.test.ts` 中对默认 URL 的断言不变）。

## 四、下一步依赖

- **M2 灰度重指向**：在 1Panel/Author 后台填值 `REMOTE_CONFIG` → `updateBaseUrl`/`ingestBaseUrl`/`contentBaseUrl`，观察数日后再改 `REPO_*` 常量 + Vercel 发布。
- **M3 拆包**：`core` + 6 个 `serve-*` 入口 + 迁移文件化 + init 容器独占建表。这步需要先把当前的单容器部署改成多 compose service。
- **M8 更新器 host 运行时化**：`UpdatePackage.cs:90` 替换 `uri.Host == AuthorHost` 为白名单匹配（当前是 `trusty.json` 已有但 runtime 被该行钉死）。这一步完成后，未来换域名才不需要发安装包。

## 五、已知限制与缺口

- **覆盖位本身没有测试覆盖**：因为 `_telemetryConfig.ts` 在 import 时读 `process.env`，要测需要 spawn 子进程注入 env，而现有测试风格不鼓励无业务价值的包装测试。建议在 CI 中加一条 shell script `TELEMETRY_UPDATE_URL="https://custom.example/api/releases/latest.json" node api/_system/updateCheck.ts` 来验证优先级。
- **远程配置下发的 4 个字段还没有消费端测试**：只在 schema 层做了 guard 测试，实际消费链路依赖下游学校的升级。
- **作者端 `config` 端的旧入口 `?resource=config` 仍保留为别名**：存量学校在迁移完成前继续使用，迁移完后这个 alias 可以在公告 handler 里删掉。

## 六、参考

- 完整排期方案：[`novora-author-domain-split-plan-2026-10-22.md`](../../novora-author-domain-split-plan-2026-10-22.md)
- Windows 更新器相关代码：`packaging/windows/Novora.Update/UpdatePackage.cs`
