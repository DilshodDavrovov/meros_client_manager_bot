#!/usr/bin/env node
/**
 * Ручная корректировка даты окончания по id записи
 * Использование: node scripts/updateDeferralDate.js <record_id> <дата>
 * Дата: ДД.ММ.ГГГГ или ГГГГ-ММ-ДД
 * Пример: node scripts/updateDeferralDate.js 5 31.12.2025
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getRecordById, updateDeferralEndDate } = require('../src/db/repositories');

function parseDate(str) {
  const trimmed = String(str || '').trim();
  let yyyyMMdd;
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split('.').map(Number);
    yyyyMMdd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    yyyyMMdd = trimmed;
  } else {
    return null;
  }
  const [y, m, d] = yyyyMMdd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return yyyyMMdd;
}

const recordId = process.argv[2];
const dateStr = process.argv[3];

if (!recordId || !dateStr) {
  console.error('Использование: node scripts/updateDeferralDate.js <record_id> <дата>');
  console.error('Дата: ДД.ММ.ГГГГ или ГГГГ-ММ-ДД');
  console.error('Пример: node scripts/updateDeferralDate.js 5 31.12.2025');
  process.exit(1);
}

const yyyyMMdd = parseDate(dateStr);
if (!yyyyMMdd) {
  console.error('Ошибка: неверный формат даты. Используйте ДД.ММ.ГГГГ или ГГГГ-ММ-ДД');
  process.exit(1);
}

async function run() {
  const rec = await getRecordById(parseInt(recordId, 10));
  if (!rec) {
    console.error('Запись с id', recordId, 'не найдена');
    process.exit(1);
  }

  if (rec.status !== 'ACTIVE') {
    console.error('Запись уже восстановлена (status:', rec.status, ')');
    process.exit(1);
  }

  const result = updateDeferralEndDate(parseInt(recordId, 10), yyyyMMdd);
  console.log('Обновлено:', result.changes || 0, 'записей');
  console.log('person_id:', rec.person_id, '| end_date:', rec.end_date, '->', yyyyMMdd);
}

run();
