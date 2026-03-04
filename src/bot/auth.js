const logger = require('../utils/logger');
const { getAllowedUserIds } = require('../db/repositories');

let cachedIds = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60000;

async function getAllowedIds() {
  if (cachedIds && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedIds;
  }
  try {
    cachedIds = await getAllowedUserIds();
    cacheTime = Date.now();
    return cachedIds;
  } catch (err) {
    logger.error('getAllowedUserIds failed', err);
    return cachedIds || [];
  }
}

function createAuthMiddleware() {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const allowed = await getAllowedIds();
    if (allowed.length === 0) {
      logger.warn('No allowed users configured');
    }
    if (!allowed.includes(userId)) {
      await ctx.reply('⛔ Доступ запрещён');
      return;
    }
    return next();
  };
}

module.exports = {
  createAuthMiddleware,
  getAllowedIds,
};
