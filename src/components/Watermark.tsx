import React from 'react';

/** Subtle attribution, positioned to avoid exam controls when used on the display. */
export default function Watermark({ exam = false }: { exam?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={exam ? 'exam-watermark' : undefined}
      style={exam ? undefined : {
        position: 'fixed', left: 14, bottom: 10, zIndex: 9999, fontSize: 12, lineHeight: 1,
        letterSpacing: 0.4, color: 'rgba(130,140,155,0.42)', pointerEvents: 'none', userSelect: 'none',
        fontFamily: '"Microsoft YaHei","PingFang SC","Noto Sans SC",system-ui,sans-serif',
      }}
    >
      Created by PikaNova
    </div>
  );
}
