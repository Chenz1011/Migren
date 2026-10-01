import { config } from './config.js';

const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

const threshold = levels[(config.logLevel as Level) in levels ? (config.logLevel as Level) : 'info'];

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (levels[level] < threshold) return;
  const ts = new Date().toISOString();
  const line = extra && Object.keys(extra).length
    ? `${ts} [${level.toUpperCase()}] ${msg} ${JSON.stringify(extra)}`
    : `${ts} [${level.toUpperCase()}] ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
};
