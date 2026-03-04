const { Telegraf, session } = require('telegraf');
const { createAuthMiddleware } = require('./auth');
const { setupHandlers } = require('./handlers');
const logger = require('../utils/logger');

function createBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error('BOT_TOKEN is required');
  }

  const bot = new Telegraf(token);

  bot.use(session());
  bot.use(createAuthMiddleware());
  setupHandlers(bot);

  bot.catch((err, ctx) => {
    logger.error('Bot error', err);
    ctx.reply('❌ Произошла ошибка. Попробуйте позже.').catch(() => {});
  });

  return bot;
}

module.exports = {
  createBot,
};
