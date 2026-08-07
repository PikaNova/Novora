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

const MATRIX_ROWS = 6;
const MATRIX_COLS = 10;
const SEAT_STEP_MS = 90;
const TOTAL_STEPS = 3;

// 每个 kind 的点亮比例（按蛇形序号截止）
const FILL_RATIO: Record<LoadingStateKind, number> = {
  loading: 0.34,
  auth: 0.67,
  sync: 1,
  design: 1,
};

// 当前操作座位：第 4 行中间（桌面为倒数第二排，手机 5x8 布局下为最后排中间，两种布局都可见）
const HOT_SEAT = { row: MATRIX_ROWS - 3, col: Math.floor(MATRIX_COLS / 2) - 1 };

const STEP_OF: Record<LoadingStateKind, number> = {
  loading: 1,
  auth: 2,
  sync: 3,
  design: 3,
};

function snakeIndex(row: number, col: number): number {
  return row * MATRIX_COLS + (row % 2 === 0 ? col : MATRIX_COLS - 1 - col);
}

interface Seat {
  key: string;
  active: boolean;
  hot: boolean;
  delay: number;
}

function buildSeats(kind: LoadingStateKind): Seat[] {
  const fillLimit = Math.round(MATRIX_ROWS * MATRIX_COLS * FILL_RATIO[kind]);
  const seats: Seat[] = [];
  for (let row = 0; row < MATRIX_ROWS; row++) {
    for (let col = 0; col < MATRIX_COLS; col++) {
      const snake = snakeIndex(row, col);
      const hot = row === HOT_SEAT.row && col === HOT_SEAT.col;
      const active = kind === "design" || snake < fillLimit;
      const delay =
        kind === "design"
          ? 0
          : hot
            ? Math.max(fillLimit, snake) * SEAT_STEP_MS
            : snake * SEAT_STEP_MS;
      seats.push({
        key: `${row}-${col}`,
        active,
        hot,
        delay,
      });
    }
  }
  return seats;
}

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
  const seats = buildSeats(kind);
  return (
    <main className={`loading-state loading-state--${kind}`} aria-live="polite" role="status">
      <section className="loading-state__stage">
        <div className="loading-state__brand" aria-hidden="true">
          <span className="loading-state__wordmark">NOVORA</span>
          <span className="loading-state__tagline">考试管理与教室大屏</span>
        </div>
        <div className="loading-state__matrix" aria-hidden="true">
          <span className="loading-state__podium" />
          <div className="loading-state__seats">
            {seats.map((seat) => (
              <span
                key={seat.key}
                className={[
                  "loading-state__seat",
                  seat.hot ? "loading-state__seat--hot" : seat.active ? "loading-state__seat--on" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={seat.active && kind !== "design" ? { animationDelay: `${seat.delay}ms` } : undefined}
              />
            ))}
          </div>
        </div>
        <div className="loading-state__copy" key={copyKey}>
          <h1>{title || copy.title}</h1>
          <p>{message || copy.message}</p>
        </div>
        <p className="loading-state__step" aria-hidden="true">
          第 {STEP_OF[kind]} / {TOTAL_STEPS} 步
        </p>
      </section>
    </main>
  );
}
