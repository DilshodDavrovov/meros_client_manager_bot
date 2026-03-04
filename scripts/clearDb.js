require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { clearAllRecords } = require('../src/db/repositories');

const result = clearAllRecords();
console.log('Очищено записей:', result.changes || 0);
