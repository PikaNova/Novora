# 仓库约定

## 前端表单控件必须用统一组件

设置页、后台弹窗、向导等所有表单里的控件复用项目统一实现，保持交互与视觉一致；不要用浏览器原生样式的控件（尤其是原生 `<select>` 和 `<input type="date">`）。

| 场景            | 统一用法                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 布尔开关        | `src/components/settings/Switch.tsx` 的 `<Switch checked onChange disabled>`                                                                                                                                 |
| 下拉/单选选择器 | `src/components/InlineSelect.tsx`，配 `className="set-input"`                                                                                                                                                |
| 日期 / 时间     | `src/components/touch-datetime-picker` 的 `<DateTimeField mode="date\|time\|datetime" className="set-date-time-field" showFieldPreview={false}>`，值为 `YYYY-MM-DD`（日期）或 `YYYY-MM-DDTHH:mm`（日期时间） |
| 文本 / 数字输入 | `<input className="set-input">`；窄数字加 `set-input--sm`，并补 `type="number"` + `inputMode="numeric"`                                                                                                      |
| 行布局          | `set-fieldset`（禁用态加 `is-dim`）+ `set-row` + `set-label`，行内操作按钮包一层 `set-inline-actions`                                                                                                        |

新增界面时按上表选控件。示例可参考 `src/components/settings/TimeSyncSection.tsx`（开关 + 选择器 + 数字输入）和 `src/components/settings/WeeklyCalendarSection.tsx`（日期字段）。

## 大屏设计组件必须标记全屏按钮

`src/designs/` 下每个设计组件的全屏切换按钮都加 `data-fullscreen-toggle`。大屏的「双击退出全屏指引」靠这个标记用 `getBoundingClientRect()` 定位真实按钮，从而在不同设计下都能指对位置；新增设计若漏掉该属性，指引会静默不显示。

## 会话验证：默认快路径，只有 push 前才跑全量

两档验证，不要每个会话都跑全套。本机（4 核）实测：全套链 ≈ 65–130s，快路径 ≈ 10–20s，
而省下的时间跟用例数量几乎无关——瓶颈是「每个测试文件一个 node 进程」，
102 个文件 ×（~0.35s 启动 + 模块加载）≈ 36s，628+ 个用例本身只跑几秒。

| 时机               | 命令                   | 做什么                                                   | 实测   |
| ------------------ | ---------------------- | -------------------------------------------------------- | ------ |
| 改完一个点         | `npm run verify:fast`  | 增量编译 + 只跑受影响的测试文件 + 改动文件的 lint/format | 10–20s |
| 只想跑测试         | `npm run test:changed` | 同上，跳过 lint/format                                   | 5–15s  |
| push 前            | `npm run verify:full`  | 全量 `npm test` + `build` + `typecheck:api`              | 70–90s |
| 怀疑编译产物不同步 | `npm run test:rebuild` | 删掉 `.test-check` 重新编译再全量                        | 60–90s |

- 会话收尾默认只跑 `verify:fast`；**不 push 就不要跑全量**。
- `verify:fast` 会打印选中了哪些测试文件。如果它说「全量」，说明改动里有配置/样式/脚本文件，
  或者某个源文件没有任何测试（含间接）引用——后者全量也覆盖不到，别把它当成"已验证"。
- `npm test` 现在是增量编译（不再每次删 `.test-check`）；产物与源码的一致性由
  `scripts/prepare-test-output.cjs` 负责清理旧产物，脚本还会在产物缺失时自动重建。
- `verify:fast` 的 lint/format **只报告不阻断**：共享工作树里它会连带看到并行会话在改的文件，
  所以只对**自己改的**文件跑 `prettier --write`，不要去改别人的文件。
- 全量闸门由 GitHub Actions 兜底（`.github/workflows/verify.yml`，push 到 `main` / `upload/main` 触发）。
  push 之后要看一眼 CI 结果；`src-typecheck` 目前是非阻断的（仓库有 5 条既有类型错误，修完后应去掉 `continue-on-error`）。
- **不要**用 `node --test --test-isolation=none` 把所有测试塞进一个进程来提速：Node 会把各文件顶层
  `before/after` 注册到同一个根上，文件级全局打桩互相覆盖（2026-09-24 实测 12 个用例因此失败，
  且会拖出 30s 的真实网络等待）。真要走这条路，得先把测试改成"每个用例自备全局"。
