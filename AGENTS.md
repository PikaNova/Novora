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
