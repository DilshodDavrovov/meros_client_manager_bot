const { query, runInTransactionAsync } = require('./sqlite');

async function getAllowedUserIds() {
  const fromEnv = process.env.ALLOWED_USER_IDS;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.split(',').map(s => s.trim()).filter(Boolean).map(Number);
  }
  const rows = query('SELECT telegram_user_id FROM allowed_users');
  return rows.map(r => r.telegram_user_id);
}

async function insertDeferralHistory(data) {
  const sql = `
    INSERT INTO client_deferral_history 
    (person_id, client_name, old_deferral_value, new_deferral_value, start_date, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
  `;
  const result = query(sql, [
    data.person_id,
    data.client_name || '',
    data.old_deferral_value,
    data.new_deferral_value,
    data.start_date,
    data.end_date,
  ]);
  return result?.lastInsertRowid;
}

async function getAllRecords() {
  return query(
    `SELECT * FROM client_deferral_history ORDER BY id DESC`
  );
}

async function getActiveRecords() {
  return query(
    `SELECT * FROM client_deferral_history 
     WHERE status = 'ACTIVE' 
     ORDER BY end_date ASC`
  );
}

async function getActiveExpiredRecords() {
  return query(
    `SELECT * FROM client_deferral_history 
     WHERE status = 'ACTIVE' AND end_date < date('now') 
     ORDER BY end_date ASC`
  );
}

async function getRecordById(id) {
  const rows = query('SELECT * FROM client_deferral_history WHERE id = ?', [id]);
  return rows[0] || null;
}

async function hasActiveTaskForPerson(personId) {
  const rows = query(
    `SELECT COUNT(*) AS cnt FROM client_deferral_history 
     WHERE person_id = ? AND status = 'ACTIVE'`,
    [personId]
  );
  const cnt = rows[0]?.cnt ?? rows[0]?.CNT ?? 0;
  return cnt > 0;
}

async function markAsRestored(id) {
  query(
    "UPDATE client_deferral_history SET status = 'RESTORED', restored_at = datetime('now') WHERE id = ?",
    [id]
  );
}

function clearAllRecords() {
  return query('DELETE FROM client_deferral_history');
}

function updateDeferralEndDate(recordId, endDateYyyyMmDd) {
  return query(
    'UPDATE client_deferral_history SET end_date = ? WHERE id = ? AND status = ?',
    [endDateYyyyMmDd, recordId, 'ACTIVE']
  );
}

async function insertDeferralHistoryAndUpdateSmartup(data, updateFn) {
  return runInTransactionAsync(async () => {
    insertDeferralHistory(data);
    await updateFn();
  });
}

module.exports = {
  getAllowedUserIds,
  insertDeferralHistory,
  getAllRecords,
  getActiveRecords,
  getActiveExpiredRecords,
  getRecordById,
  markAsRestored,
  clearAllRecords,
  updateDeferralEndDate,
  insertDeferralHistoryAndUpdateSmartup,
   hasActiveTaskForPerson,
};
