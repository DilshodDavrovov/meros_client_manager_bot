const cron = require('node-cron');
const logger = require('../utils/logger');
const { getActiveExpiredRecords, markAsRestored, getAllowedUserIds } = require('../db/repositories');
const smartupApi = require('../smartup/api');

async function notifyRestored(bot, rec) {
  if (!bot) return;
  const userIds = await getAllowedUserIds();
  const msg = `⏰ <b>Автоматический возврат</b>\n\nСрок отсрочки восстановлен для <b>${escapeHtml(rec.client_name || rec.person_id)}</b> (person_id: ${rec.person_id})\nБыло: ${escapeHtml(rec.new_deferral_value)} → Стало: ${escapeHtml(rec.old_deferral_value)}`;
  for (const uid of userIds) {
    try {
      await bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' });
    } catch (e) {
      logger.warn('Notify restore failed for', uid, e.message);
    }
  }
}

function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function restoreRecord(rec) {
  const client = await smartupApi.loadClient(rec.person_id);
  if (!client) {
    throw new Error('Клиент не найден');
  }
  await smartupApi.updateDeferralAndSave(
    client.raw,
    rec.old_deferral_value,
    rec.person_id
  );
  await markAsRestored(rec.id);
  return true;
}

async function processExpiredRecords(bot) {
  const records = await getActiveExpiredRecords();
  if (records.length === 0) return;

  logger.info('Restore job: found', records.length, 'expired records');

  for (const rec of records) {
    try {
      await restoreRecord(rec);
      await notifyRestored(bot, rec);
      logger.info('Restore: restored deferral for', rec.person_id);
    } catch (err) {
      logger.error('Restore failed for', rec.person_id, err.message);
    }
  }
}

function startRestoreCron(bot) {
  cron.schedule('* * * * *', async () => {
    try {
      await processExpiredRecords(bot);
    } catch (err) {
      logger.error('Restore cron error', err);
    }
  });
  logger.info('Restore cron started (every 1 min)');
}

module.exports = {
  startRestoreCron,
  processExpiredRecords,
  restoreRecord,
};
