import { useLayoutEffect, useRef } from 'react';

/** Shrinks a single-line label only when its rendered width exceeds its container. */
export function useFitText(value: unknown, minScale = 0.36) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    let frame = 0;
    let lastFontSize = '';
    const fit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        node.style.setProperty('--fit-scale', '1');
        node.style.fontSize = '';
        node.style.maxWidth = '100%';
        node.style.boxSizing = 'border-box';
        node.style.overflow = 'hidden';
        node.style.textOverflow = 'clip';
        node.style.whiteSpace = 'nowrap';

        const naturalFontSize = parseFloat(getComputedStyle(node).fontSize || '0');
        if (!naturalFontSize) return;

        const parent = node.parentElement;
        let available = node.clientWidth;
        if (parent) {
          const cs = getComputedStyle(parent);
          available = parent.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
        }
        if (!available || available <= 0) return;

        const width = node.scrollWidth;
        const scale = width > 0 ? Math.max(minScale, Math.min(1, (available - 1) / width)) : 1;
        const nextFontSize = scale < 1 ? `${naturalFontSize * scale}px` : '';
        if (nextFontSize !== lastFontSize) {
          node.style.fontSize = nextFontSize;
          lastFontSize = nextFontSize;
        }
      });
    };
    fit(); if (typeof document !== 'undefined' && (document as any).fonts && (document as any).fonts.ready) { (document as any).fonts.ready.then(() => fit()).catch(() => {}); } const observer = new ResizeObserver(fit); if (node.parentElement) observer.observe(node.parentElement); window.addEventListener('resize', fit); return () => { window.cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [value, minScale]);
  return ref;
}
