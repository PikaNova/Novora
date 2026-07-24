# 考试提醒

ClassIsland 2.x 插件，用于连接学校部署的考试看板、同步当前设备绑定班级的考试，并通过 ClassIsland 提醒 V2 API 显示开考提醒。

当前插件版本保留 `ClassIsland.PluginSdk 1.7.106.2-dev-v2` 和 `net8.0-windows` 目标，支持考试看板 ClassIsland API v2，并兼容未返回版本字段的 API v1 服务端。

Linux 兼容沿用 ClassIsland 插件的现有加载方式。浏览器启动统一先使用 `UseShellExecute=true`，失败后在 Linux 依次回退到 `xdg-open` 和 `gio open`；网址通过参数列表传递，不拼接 shell 命令。

## 当前功能

- 在 ClassIsland 设置中注册“考试提醒”页面
- 在 ClassIsland 提醒设置中注册“考试提醒”提供方
- 仅填写考试看板基础网址，自动生成接口、配对页和考试大屏路径
- 浏览器一次性配对协议客户端
- 每 30 秒同步考试时间线，并使用服务端时间校正调度
- 开考前至少 20 分钟自动打开考试大屏
- 开考前 15 分钟、5 分钟和开考时提醒
- 提醒和浏览器动作持久化去重
- 联动接口不可用时保留配置并显示明确状态

## 看板联动协议

插件预期考试看板在 `/api/exams` 提供以下 action：

- `plugin-pair-start`
- `plugin-pair-status`
- `plugin-bootstrap`
- `plugin-api`（API v2 能力探测）

浏览器配对页路径为 `/plugin/connect?token=...`，考试大屏路径为 `/exam?source=classisland&instanceId=...`。

## 打包

```powershell
dotnet publish -p:CreateCipx=true
```

仓库中的集成源码未包含发布图标，制作正式插件包时需要补充应用图标。
