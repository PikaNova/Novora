/**
 * useAboutSettings
 * “关于”卡片（README 展开/新标签页打开）状态与处理函数。
 * 从 SettingsPage.tsx 中提取，保持与原有逻辑完全一致。
 */
import { useMemo, useState } from "react";
import readmeRaw from "../../../README.md?raw";
import { renderMarkdown } from "../../utils/renderMarkdown";

export function useAboutSettings() {
  const [readmeOpen, setReadmeOpen] = useState(false);
  const readmeHtml = useMemo(() => renderMarkdown(readmeRaw), []);

  const toggleReadme = () => setReadmeOpen((o) => !o);

  const openReadmeInNewTab = () => {
    const blob = new Blob([readmeRaw], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return { readmeOpen, readmeHtml, toggleReadme, openReadmeInNewTab };
}
