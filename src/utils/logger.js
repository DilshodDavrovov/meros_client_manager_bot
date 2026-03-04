const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const level = process.env.LOG_LEVEL || 'info';
const currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;

function formatMsg(levelName, ...args) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${levelName.toUpperCase()}] ${args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ')}`;
}

module.exports = {
  error(...args) {
    if (currentLevel >= LOG_LEVELS.error) console.error(formatMsg('error', ...args));
  },
  warn(...args) {
    if (currentLevel >= LOG_LEVELS.warn) console.warn(formatMsg('warn', ...args));
  },
  info(...args) {
    if (currentLevel >= LOG_LEVELS.info) console.info(formatMsg('info', ...args));
  },
  debug(...args) {
    if (currentLevel >= LOG_LEVELS.debug) console.debug(formatMsg('debug', ...args));
  },
};
