/** Motion preferences shared by application settings consumers. */

/** auto follows the OS reduced-motion preference; the other modes force the selected behavior. */
export type MotionMode = 'auto' | 'best-effects' | 'best-performance';

export const DEFAULT_MOTION_MODE: MotionMode = 'auto';
