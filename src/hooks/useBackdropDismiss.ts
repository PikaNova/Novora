import { useCallback, useRef } from 'react';
import type { HTMLAttributes, PointerEvent } from 'react';

type BackdropProps = Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClick'>;

/** Only dismiss when both pointer-down and click begin on the backdrop itself. */
export function useBackdropDismiss() {
  const startedOnBackdrop = useRef(false);
  return useCallback((onDismiss: () => void): BackdropProps => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      startedOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: event => {
      const shouldDismiss = startedOnBackdrop.current && event.target === event.currentTarget;
      startedOnBackdrop.current = false;
      if (shouldDismiss) onDismiss();
    },
  }), []);
}
