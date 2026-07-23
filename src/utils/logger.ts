const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;

export const logger = {
  debug: (...args: unknown[]) => { if (isDev) console.debug(...args); },
  info:  (...args: unknown[]) => { if (isDev) console.info(...args); },
  warn:  (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

export const { debug, info, warn, error } = logger;
