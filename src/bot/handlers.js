const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const smartupApi = require('../smartup/api');
const { insertDeferralHistoryAndUpdateSmartup, getActiveRecords, getRecordById, hasActiveTaskForPerson } = require('../db/repositories');
const { restoreRecord } = require('../cron/restoreDeferral.job');

const STEPS = {
  IDLE: 'idle',
  AWAIT_PERSON_ID: 'await_person_id', // Ожидание ввода ИНН
  AWAIT_PERSON_SELECT: 'await_person_select',
  AWAIT_NEW_DEFERRAL: 'await_new_deferral',
  AWAIT_END_DATE: 'await_end_date',
};

function getSession(ctx) {
  if (!ctx.session) ctx.session = {};
  return ctx.session;
}

function formatClientInfo(client) {
  return [
    `📋 <b>Название:</b> ${escapeHtml(client.name)}`,
    `📅 <b>Срок отсрочки:</b> ${escapeHtml(client.deferral)}`,
    `🔢 <b>ИНН:</b> ${escapeHtml(client.inn)}`,
    `📍 <b>Регион:</b> ${escapeHtml(client.region)}`,
  ].join('\n');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const mainKeyboard = Markup.keyboard([['🏠 Домой', '📋 Tasks']]).resize();

async function handleStart(ctx) {
  await ctx.replyWithHTML(
    '👋 <b>Добро пожаловать!</b>\n\n' +
    'Для поиска клиента введите <code>ИНН</code> (например: 303462855).\n\n' +
    'После выбора клиента вы сможете временно изменить срок отсрочки. ' +
    'Старое значение будет восстановлено автоматически после указанной даты.\n\n' +
    'Команды:\n' +
    '/tasks — активные задачи',
    mainKeyboard
  );
}

const DURATION_OPTIONS = [
  { days: 5, label: '5 дней' },
  { days: 7, label: '7 дней' },
  { days: 10, label: '10 дней' },
  { days: 15, label: '15 дней' },
  { days: 30, label: '30 дней' },
  { days: 60, label: '60 дней' },
  { days: null, label: 'Без срока' },
];

const EMPTY_DEFERRAL = { id: 'empty', label: 'Без отсрочки' };

function formatEndDate(yyyyMMdd) {
  if (!yyyyMMdd) return '—';
  const [y, m, d] = yyyyMMdd.split('-');
  return `${d}.${m}.${y}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function handleTasks(ctx) {
  const records = await getActiveRecords();
  if (records.length === 0) {
    await ctx.reply('📭 Нет активных задач', mainKeyboard);
    return;
  }

  await ctx.reply(`📋 Активные задачи (${records.length}):`, mainKeyboard);

  for (const r of records) {
    const endDate = formatEndDate(r.end_date);
    const clientName = r.client_name || `person_id ${r.person_id}`;
    const text = [
      `📋 <b>${escapeHtml(clientName)}</b>`,
      `<b>person_id</b> ${escapeHtml(r.person_id)}`,
      `${escapeHtml(r.new_deferral_value)} → ${escapeHtml(r.old_deferral_value)}`,
      `до ${endDate}`,
    ].join('\n');
    await ctx.replyWithHTML(
      text,
      Markup.inlineKeyboard([Markup.button.callback('↩ Немедленный возврат', `restore:${r.id}`)])
    );
  }
}

async function handleRestoreCallback(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const match = data.match(/^restore:(\d+)$/);
  if (!match) return;
  const recordId = match[1];
  const rec = await getRecordById(parseInt(recordId, 10));
  if (!rec) {
    await ctx.answerCbQuery('Запись не найдена');
    return;
  }
  await ctx.answerCbQuery();
  try {
    await restoreRecord(rec);
    const name = rec.client_name || `person_id ${rec.person_id}`;
    await ctx.reply(`✅ Срок отсрочки восстановлен: ${name}`);
  } catch (err) {
    logger.error('Restore callback error', err);
    await ctx.reply('❌ Ошибка при восстановлении: ' + (err.message || 'неизвестная ошибка'));
  }
}

async function handleText(ctx) {
  const session = getSession(ctx);
  const step = session.step || STEPS.IDLE;
  const text = (ctx.message?.text || '').trim();

  if (text === '🏠 Домой' || text === 'Домой') {
    session.step = STEPS.IDLE;
    session.personId = null;
    session.client = null;
    session.newDeferralValue = null;
    session.newDeferralTypeId = null;
    session.deferralOptions = null;
    session.endDateStr = null;
    session.endDateDisplay = null;
    session.noRestoreTask = null;
    return handleStart(ctx);
  }
  if (text === '📋 Tasks' || text === 'Tasks' || text.toLowerCase() === 'tasks') {
    return handleTasks(ctx);
  }

  if (
    step === STEPS.IDLE ||
    step === STEPS.AWAIT_PERSON_ID ||
    step === STEPS.AWAIT_PERSON_SELECT
  ) {
    const inn = text.replace(/\D/g, '');
    if (!inn) {
      await ctx.reply('Введите ИНН (например: 303462855)');
      return;
    }

    await ctx.reply('⏳ Ищу клиентов по ИНН...');
    try {
      const results = await smartupApi.searchClientsByTin(inn);
      if (!results || results.length === 0) {
        await ctx.reply('❌ Клиенты с таким ИНН не найдены');
        return;
      }

      session.step = STEPS.AWAIT_PERSON_SELECT;
      session.searchResults = results;

      const buttons = results.slice(0, 10).map(c => [
        Markup.button.callback(
          `${c.name} (person_id: ${c.person_id})`,
          `pick:${c.person_id}`
        ),
      ]);

      await ctx.reply(
        '🔍 Найденные клиенты. Выберите одного:',
        Markup.inlineKeyboard(buttons)
      );
    } catch (err) {
      logger.error('searchClientsByTin error', err);
      await ctx.reply('❌ Ошибка при поиске по ИНН. Попробуйте позже.');
    }
    return;
  }

  if (step === STEPS.AWAIT_NEW_DEFERRAL) {
    await ctx.reply('Нажмите кнопку выбора срока отсрочки выше');
    return;
  }

  if (step === STEPS.AWAIT_END_DATE) {
    await ctx.reply('Нажмите кнопку выбора срока действия выше');
    return;
  }
}

async function performDeferralUpdate(ctx, session) {
  const { personId, client, newDeferralValue, newDeferralTypeId, endDateStr, endDateDisplay } = session;
  const startDate = new Date();
  const startDateStr = startDate.toISOString().slice(0, 10);
  const noRestoreTask = session.noRestoreTask;

  await ctx.reply('⏳ Обновляю клиента...');

  try {
    const deferralParam = (newDeferralTypeId === '' || newDeferralTypeId === 'empty')
      ? { personTypeId: '', label: newDeferralValue }
      : (newDeferralTypeId
          ? { personTypeId: newDeferralTypeId, label: newDeferralValue }
          : newDeferralValue);

    if (noRestoreTask) {
      await smartupApi.updateDeferralAndSave(client.raw, deferralParam, personId);
      await ctx.replyWithHTML(
        `✅ Срок отсрочки обновлён до <b>${escapeHtml(newDeferralValue)}</b> (без задачи на возврат)`
      );
    } else {
      await insertDeferralHistoryAndUpdateSmartup(
        {
          person_id: personId,
          client_name: client.name,
          old_deferral_value: client.deferral,
          new_deferral_value: newDeferralValue,
          start_date: startDateStr,
          end_date: endDateStr,
        },
        () => smartupApi.updateDeferralAndSave(client.raw, deferralParam, personId)
      );
      await ctx.replyWithHTML(
        `✅ Срок отсрочки обновлён до <b>${escapeHtml(newDeferralValue)}</b> до <b>${endDateDisplay}</b>\n\n` +
        '⏰ Автоматический возврат'
      );
    }

    session.step = STEPS.IDLE;
    session.personId = null;
    session.client = null;
    session.newDeferralValue = null;
    session.newDeferralTypeId = null;
    session.endDateStr = null;
    session.endDateDisplay = null;
    session.noRestoreTask = null;
  } catch (err) {
    logger.error('updateDeferralAndSave error', err);
    await ctx.reply('❌ Ошибка при обновлении клиента. Попробуйте позже.');
  }
}

async function handleDeferralCallback(ctx) {
  const session = getSession(ctx);
  if (session.step !== STEPS.AWAIT_NEW_DEFERRAL) return;
  const data = ctx.callbackQuery?.data || '';
  const match = data.match(/^def:(.+)$/);
  if (!match) return;
  const typeIdOrEmpty = match[1];
  const options = session.deferralOptions || [];
  const opt = typeIdOrEmpty === 'empty' ? EMPTY_DEFERRAL : options.find(o => String(o.id) === typeIdOrEmpty);
  if (!opt) return;
  session.newDeferralTypeId = opt.id === 'empty' ? '' : opt.id;
  session.newDeferralValue = opt.label;
  session.step = STEPS.AWAIT_END_DATE;
  await ctx.answerCbQuery();
  const durationButtons = DURATION_OPTIONS.map(o =>
    Markup.button.callback(o.label, o.days === null ? 'dur:none' : `dur:${o.days}`)
  );
  await ctx.reply('Выберите срок действия (до автоматического возврата):', Markup.inlineKeyboard(durationButtons, { columns: 2 }));
}

async function handleDurationCallback(ctx) {
  const session = getSession(ctx);
  if (session.step !== STEPS.AWAIT_END_DATE) return;
  const data = ctx.callbackQuery?.data || '';
  const match = data.match(/^dur:(.+)$/);
  if (!match) return;
  const val = match[1];
  const isNoTerm = val === 'none';
  const days = isNoTerm ? null : parseInt(val, 10);
  const opt = isNoTerm ? DURATION_OPTIONS.find(o => o.days === null) : DURATION_OPTIONS.find(o => o.days === days);
  if (!opt) return;
  session.noRestoreTask = isNoTerm;
  if (isNoTerm) {
    session.endDateStr = null;
    session.endDateDisplay = 'Без срока';
  } else {
    session.endDateStr = addDays(days);
    const [y, m, d] = session.endDateStr.split('-');
    session.endDateDisplay = `${d}.${m}.${y}`;
  }
  await ctx.answerCbQuery();
  await performDeferralUpdate(ctx, session);
}

async function handlePickClientCallback(ctx) {
  const session = getSession(ctx);
  if (session.step !== STEPS.AWAIT_PERSON_SELECT) return;
  const data = ctx.callbackQuery?.data || '';
  const match = data.match(/^pick:(\d+)$/);
  if (!match) return;
  const personId = match[1];

  await ctx.answerCbQuery();
  // Запрещаем новое изменение, если для клиента уже есть активная задача
  if (await hasActiveTaskForPerson(personId)) {
    await ctx.reply('⚠️ Для этого клиента уже есть активная задача. Дождитесь автоматического возврата или выполните немедленный возврат через /tasks.');
    return;
  }

  await ctx.reply('⏳ Загружаю клиента...');

  try {
    const client = await smartupApi.loadClient(personId);
    if (!client) {
      await ctx.reply('❌ Клиент не найден');
      return;
    }

    session.step = STEPS.AWAIT_NEW_DEFERRAL;
    session.personId = personId;
    session.client = client;

    let deferralOptions = [];
    try {
      deferralOptions = await smartupApi.getDeferralOptions();
    } catch (err) {
      logger.error('getDeferralOptions error', err);
    }
    const allOptions = [ ...(deferralOptions || []),EMPTY_DEFERRAL];
    const currentTypeId = (client.currentPersonTypeId || '').toString();
    const selectableOptions = allOptions.filter(o => {
      if (o.id === 'empty') return currentTypeId !== ''; // скрыть "пусто", если уже пусто
      return String(o.id) !== currentTypeId; // скрыть текущий срок
    });
    session.deferralOptions = selectableOptions;

    if (selectableOptions.length === 0) {
      await ctx.reply('Текущий срок отсрочки уже установлен. Нет других вариантов для выбора.');
      session.step = STEPS.IDLE;
      session.personId = null;
      session.client = null;
      return;
    }

    const buttons = selectableOptions.map(o =>
      Markup.button.callback(o.label, `def:${o.id || 'empty'}`)
    );
    await ctx.replyWithHTML(
      formatClientInfo(client) + '\n\n📅 Выберите новый срок отсрочки:',
      Markup.inlineKeyboard(buttons, { columns: 2 })
    );
  } catch (err) {
    logger.error('loadClient error', err);
    await ctx.reply('❌ Ошибка при загрузке клиента. Попробуйте позже.');
  }
}

function setupHandlers(bot) {
  bot.command('start', handleStart);
  bot.command('tasks', handleTasks);
  bot.action(/^pick:/, handlePickClientCallback);
  bot.action(/^def:/, handleDeferralCallback);
  bot.action(/^dur:/, handleDurationCallback);
  bot.action(/^restore:/, handleRestoreCallback);
  bot.on('text', handleText);
}

module.exports = {
  setupHandlers,
  STEPS,
};
