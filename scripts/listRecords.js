#!/usr/bin/env node
/**
 * Просмотр записей client_deferral_history
 * Использование: node scripts/listRecords.js [--active]
 * --active — только активные записи
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getAllRecords, getActiveRecords } = require('../src/db/repositories');

function formatDate(yyyyMMdd) {
  if (!yyyyMMdd) return '—';
  const [y, m, d] = yyyyMMdd.split('-');
  return `${d}.${m}.${y}`;
}

async function main() {
  const activeOnly = process.argv.includes('--active');
  const records = activeOnly ? await getActiveRecords() : await getAllRecords();

  if (records.length === 0) {
    console.log('Записей нет');
    return;
  }

  console.log(activeOnly ? 'Активные записи:' : 'Все записи:');
  console.log('—'.repeat(80));

  for (const r of records) {
    const endDate = formatDate(r.end_date);
    const name = r.client_name || '—';
    console.log(`id: ${r.id} | person_id: ${r.person_id} | ${name}`);
    console.log(`  ${r.new_deferral_value} → ${r.old_deferral_value} | до ${endDate} | ${r.status}`);
    if (r.restored_at) console.log(`  restored: ${r.restored_at}`);
    console.log('');
  }

  console.log('Всего:', records.length);
}

main();
