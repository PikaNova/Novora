import React from "react";

type LoadingStateKind = "loading" | "auth" | "sync" | "design";

const COPY: Record<LoadingStateKind, { title: string; message: string }> = {
  loading: {
    title: "正在载入",
    message: "请稍候",
  },
  auth: {
    title: "正在获取权限",
    message: "正在确认管理范围",
  },
  sync: {
    title: "正在同步数据",
    message: "正在读取云端安排",
  },
  design: {
    title: "正在载入展示设计",
    message: "正在进入考试大屏",
  },
};

export default function LoadingState({
  kind = "loading",
  title,
  message,
}: {
  kind?: LoadingStateKind;
  title?: string;
  message?: string;
}) {
  const copy = COPY[kind];
  const copyKey = `${kind}-${title || copy.title}-${message || copy.message}`;
  return (
    <main className={`loading-state loading-state--${kind}`} aria-live="polite" role="status">
      <section className="loading-state__card">
        <div className="loading-state__brand" aria-hidden="true">
          <span className="loading-state__wordmark">NOVORA</span>
          <span className="loading-state__tagline">考试管理与教室大屏</span>
        </div>
        <div className="loading-state__copy" key={copyKey}>
          <h1>{title || copy.title}</h1>
          <p>{message || copy.message}</p>
        </div>
        <div className="loading-state__bar" aria-hidden="true">
          <span />
        </div>
        <div className="loading-state__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    </main>
  );
}
