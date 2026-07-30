import React from "react";

type LoadingStateKind = "loading" | "auth" | "sync" | "design";

const COPY: Record<LoadingStateKind, { title: string; message: string }> = {
  loading: {
    title: "正在载入",
    message: "正在准备 Novora…",
  },
  auth: {
    title: "正在获取权限",
    message: "正在确认你的管理范围…",
  },
  sync: {
    title: "正在同步数据",
    message: "正在读取云端考试安排…",
  },
  design: {
    title: "正在载入展示设计",
    message: "正在准备考试大屏界面…",
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
  return (
    <main className={`loading-state loading-state--${kind}`} aria-live="polite" role="status">
      <section className="loading-state__card">
        <div className="loading-state__brand" aria-hidden="true">
          <span className="loading-state__wordmark">Novora</span>
          <span className="loading-state__tagline">EXAM OPERATIONS</span>
        </div>
        <div className="loading-state__copy">
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
