require('dotenv').config();

const logger = require('./utils/logger');
const { initSchema } = require('./db/sqlite');
const { createBot } = require('./bot');
const { startRestoreCron } = require('./cron/restoreDeferral.job');

async function main() {
  try {
    await initSchema();
  } catch (err) {
    logger.error('DB init failed', err);
    process.exit(1);
  }

  const bot = createBot();
  startRestoreCron(bot);

  await bot.launch();
  logger.info('Bot started');

  process.once('SIGINT', () => {
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
  });
}

main().catch((err) => {
  logger.error('Startup error', err);
  process.exit(1);
});
