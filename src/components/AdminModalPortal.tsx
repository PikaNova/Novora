import React from 'react';
import { createPortal } from 'react-dom';
import SyncQueueIndicator from './SyncQueueIndicator';

type AdminModalPortalProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export default function AdminModalPortal({ children, ...props }: AdminModalPortalProps) {
  const stopPortalEvent = (event: React.SyntheticEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const element = (
    <div
      {...props}
      onPointerDownCapture={event => {
        stopPortalEvent(event);
        props.onPointerDownCapture?.(event);
      }}
      onClick={event => {
        stopPortalEvent(event);
        props.onClick?.(event);
      }}
    >
      {children}
      <SyncQueueIndicator />
    </div>
  );

  if (typeof document === 'undefined') return <div {...props}>{children}</div>;
  return createPortal(element, document.body);
}
