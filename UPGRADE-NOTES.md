# v1.27.0 升级说明

## 本版重点

- 多班级：周测计划增加班级归属，大型考试增加适用班级，每台设备可选择并云端保存当前班级。
- 周测日历：未来两周按 7 列两行展示，支持单次取消、临时调课、冲突处理、删除和撤销。
- 数据入口：大型考试与周测的 JSON 导入导出完全分开，避免导错数据类型。
- 偏好设置：首页可免密进入显示、字体分区和班级设置。
- 弹窗交互：15 处管理弹窗统一为“按下和松开均在遮罩上才关闭”，拖选文字不会误关。
- 部署约束：Vercel API 函数共 11 个，未超过 12 个限制；新增班级绑定复用 `/api/exams`。

## 数据与权限注意

- 旧数据没有班级字段时按“通用 / 未分组”读取，无需手工迁移。
- `class_instance_bindings` 表由 `/api/exams` 首次访问时自动创建。
- 多账号与分角色权限已在 v1.30.0 实现；升级时自动建立用户、角色、范围和审计表，并保留原考试数据与管理员密码。

---

# 历史：从 v1.23.0 升级 —— 需替换/新增的文件

本包为**增量替换包**：解压后按原路径覆盖到项目对应位置即可（新增文件直接放入对应目录）。

## 文件清单

| 文件 | 类型 | 本次改动 |
|---|---|---|
| `src/pages/ExamPage.tsx` | 替换 | 全屏「退出全屏」按钮删除，退出按钮只在考试结束后 15 分钟内弹出 |
| `src/styles/exam.css` | 替换 | 移除 `.exam-fs-exit` 相关样式，保留结束退出浮层 |
| `vercel.json` | 替换 | 函数就近区域 `regions:["sin1"]`（新加坡，与 Neon 对齐）；`/fonts/*`、`/assets/*` 强缓存头 |
| `vite.config.ts` | 替换 | 新增 `base: process.env.ASSET_CDN_BASE || '/'`，可切 CDN 分发（默认同源、零行为变化） |
| `api/announcements.ts` | 替换 | 公告图片链接改走**同源**相对路径（原来改写为绝对遥测台地址） |
| `api/announcement-images.ts` | **新增** | 同源图片代理：转发到遥测台图片接口，换域名不再裂图，且可缓存 |
| `scripts/build-fonts.py` | 替换 | 新增 `--core` 激进子集模式 |
| `scripts/font-charset-core.txt` | **新增** | 核心字符集：GB2312 一级常用字 3755 + ASCII + 标点（共 3876 字） |
| `public/fonts/source-han-sc-standard-subset.woff2` | 替换 | 激进子集：1.79MB → **1.01MB**（-45%） |
| `public/fonts/source-han-sc-heavy-subset.woff2` | 替换 | 激进子集：1.79MB → **1.01MB**（-45%） |

## ⚠️ 部署注意

1. **函数区域**：`vercel.json` 已设 `sin1`。请确认 Neon 数据库也在新加坡，否则改回与数据库一致的区域。
2. **字体缓存穿透**：字体文件名未变但内容变了，且现在带 `immutable` 长缓存。已装过旧版的设备可能仍读旧字体缓存——靠 Service Worker 版本号刷新（建议随本次发布 bump 一次 SW/版本号），或强制刷新。
3. **字体取舍**：激进子集丢弃了 GB2312 次常用字（约 3000 个冷僻字），这些字会回退到系统字体（微软雅黑/苹方，已在 `--font-fallback` 配好）。常用科目名/公告不受影响。若担心个别冷僻字，可改用完整字符集重跑 `python3 scripts/build-fonts.py`（需 fonts-src/ 原始字体）。
4. **CDN 前缀**：`vite.config.ts` 的 `base` 默认同源；有国内 CDN 后设环境变量 `ASSET_CDN_BASE=https://你的cdn/` 即可。注意 `fonts.css` 里 `/fonts/...` 绝对路径不会被该前缀改写，字体要走 CDN 需另行处理。
5. **作者端遥测台**：公告文字/图片/上报仍走遥测台。图片代理已让客户端不再裂图，但图片字节仍来自遥测台，遥测台迁到就近区域后国内会更快。

## 重新生成字体（可选）

```bash
pip install fonttools brotli
# 完整集（6884 字）：
python3 scripts/build-fonts.py
# 激进核心集（3876 字）：
python3 scripts/build-fonts.py --core
```
