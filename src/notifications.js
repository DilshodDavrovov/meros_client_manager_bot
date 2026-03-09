const logger = require('./utils/logger');
const { getUserName } = require('./db/repositories');

function getNotificationChatId() {
  const raw = process.env.NOTIFICATION_CHAT_ID || '';
  const id = raw.trim();
  if (!id) return null;
  const num = parseInt(id, 10);
  return isNaN(num) ? null : num;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Отправляет сообщение в группу уведомлений (если настроена)
 * @param {object} telegram - ctx.telegram или bot.telegram
 * @param {string} htmlMessage - HTML-сообщение
 */
async function notifyGroup(telegram, htmlMessage) {
  const chatId = getNotificationChatId();
  if (!chatId || !telegram) return;
  try {
    await telegram.sendMessage(chatId, htmlMessage, { parse_mode: 'HTML' });
  } catch (err) {
    logger.warn('notifyGroup failed', err.message);
  }
}

/**
 * Уведомление об изменении данных (ручное изменение или «Без срока»)
 */
async function notifyDataChanged(telegram, { userId, clientName, personId, oldValue, newValue, endDateDisplay, noRestoreTask }) {
  const userName = getUserName(userId);
  const endInfo = noRestoreTask
    ? ' (без задачи на возврат)'
    : ` до ${escapeHtml(endDateDisplay)}`;
  const msg = [
    '📝 <b>Изменение срока отсрочки</b>',
    '',
    `👤 Кто изменил: <b>${escapeHtml(userName)}</b>`,
    `📋 Клиент: ${escapeHtml(clientName)}`,
    `🆔 person_id: ${escapeHtml(personId)}`,
    `📅 Было: ${escapeHtml(oldValue)} → Стало: ${escapeHtml(newValue)}${endInfo}`,
  ].join('\n');
  await notifyGroup(telegram, msg);
}

/**
 * Уведомление о восстановлении (автоматическое или ручное)
 */
async function notifyRestored(telegram, { rec, manualRestore, userId }) {
  const clientName = escapeHtml(rec.client_name || rec.person_id);
  const restoredBy = manualRestore && userId
    ? `Восстановил: <b>${escapeHtml(getUserName(userId))}</b>\n`
    : '⏰ <b>Автоматический возврат</b>\n';
  const msg = [
    '↩️ <b>Возврат срока отсрочки</b>',
    '',
    restoredBy,
    `📋 Клиент: ${clientName}`,
    `🆔 person_id: ${escapeHtml(rec.person_id)}`,
    `📅 Было: ${escapeHtml(rec.new_deferral_value)} → Стало: ${escapeHtml(rec.old_deferral_value)}`,
  ].join('\n');
  await notifyGroup(telegram, msg);
}

module.exports = {
  getNotificationChatId,
  notifyGroup,
  notifyDataChanged,
  notifyRestored,
};
