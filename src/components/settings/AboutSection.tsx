import { Info } from "lucide-react";
import { APP_VERSION } from "../../services/telemetry";
import { useAboutSettings } from "../../hooks/settings/useAboutSettings";

const AUTHOR_NAME = "PikaNova";
const REPOSITORY_URL = "https://github.com/PikaNova/Novora";

/**
 * 设置页“关于”卡片（含作者水印页脚）。
 * 从 SettingsPage.tsx 提取，行为与原页面完全一致。
 */
export default function AboutSection() {
  const { readmeOpen, readmeHtml, toggleReadme, openReadmeInNewTab } =
    useAboutSettings();

  return (
    <>
      <section className="set-card">
        <div className="set-card__head">
          <h2 className="set-card__title">
            <Info size={20} />
            关于
          </h2>
        </div>
        <div className="set-about">
          <div className="set-about__meta">
            <div>
              <b>Novora</b> · v{APP_VERSION}
            </div>
            <div>
              作者：<b>{AUTHOR_NAME}</b>
            </div>
            <div>
              GitHub：{" "}
              <a
                className="set-about__link"
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                PikaNova/Novora
              </a>
            </div>
            <div className="set-note">
              React + Vite + Vercel Serverless · Neon Postgres
            </div>
          </div>
          <div className="set-about__actions">
            <button className="set-btn" onClick={toggleReadme}>
              {readmeOpen ? "收起 README" : "查看 README"}
            </button>
            <button
              className="set-btn set-btn--desktop-only"
              onClick={openReadmeInNewTab}
            >
              在新标签页打开 README.md
            </button>
          </div>
        </div>
        {readmeOpen && (
          <div
            className="set-readme md-body"
            dangerouslySetInnerHTML={{ __html: readmeHtml }}
          />
        )}
      </section>
      <footer className="set-author-watermark">Made by {AUTHOR_NAME}</footer>
    </>
  );
}
