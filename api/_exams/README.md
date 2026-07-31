# api/exams.ts 模块解耦（第二阶段）

本次改动来自 Notion《Novora 仓库代码质量与模块解耦计划》第二批，仅针对 `api/exams.ts`。
目标：把原本挤在一个 ~1900 行文件里的多个职责拆成单一职责模块，**对外 HTTP 行为与接口完全不变**。

## 拆分前后

原 `api/exams.ts` 同时承担：数据库连接与建表迁移、payload 映射、diff 比较、鉴权校验、
ClassIsland 插件逻辑，以及最终的 HTTP 请求编排。现在拆为：

| 文件 | 职责 |
| --- | --- |
| `api/exams.ts` | 只保留 HTTP 入口（thin handler）：解析 action、CORS、缓存头、请求编排、错误兜底 |
| `api/_exams/types.ts` | 共享数据行类型：`ExamRow`、`UpdatedRow`、`PluginInstanceRow` |
| `api/_exams/db.ts` | neon 客户端缓存、一次性建表/迁移（`ensureTableOnce` / `ensureUpdatedAtBigIntOnce`）、错误识别（`missingRelation` / `updatedAtIntegerOverflow`） |
| `api/_exams/payload.ts` | `exam_data` 行 → API payload 映射（`examPayload`、`arrayValue`、`objectValue`、`ExamPayload` 类型） |
| `api/_exams/diff.ts` | JSON 规范化比较与记录级 diff（`sameJson`、`recordDiff`、`changedRecords`、`cleanActiveWeeklyPlanByClass`） |
| `api/_exams/permissions.ts` | 鉴权校验（`validateMutation`、`allScope`） |
| `api/_exams/plugin.ts` | ClassIsland 插件：凭据/哈希、API 元信息、班级与范围标签、有效考试解析等 |

## 为什么放在 `_exams/`

Vercel 会把 `api/` 下的每个非下划线文件当作一个可访问的 Serverless 端点。
沿用仓库既有的 `_` 前缀约定（如 `_auth.ts`、`_cors.ts`），`_exams/` 目录不会被暴露为端点，
只作为 `api/exams.ts` 的内部实现。

## 落地方式

把本压缩包中的 `api/` 目录合并进仓库对应位置即可：

- 覆盖 `api/exams.ts`
- 新增 `api/_exams/` 目录

导入均使用 `.js` 扩展名（与仓库 NodeNext/ESM 设置一致）。逻辑代码逐字迁移，未改变任何行为。
本地 `tsc` 类型检查请在完整仓库环境下运行（依赖 `@vercel/node`、`@neondatabase/serverless` 等）。
