const { query, runInTransactionAsync } = require('./sqlite');

/**
 * Parse ALLOWED_USER_IDS: "123:Иван,456:Петр" or "123,456" (id only → name = id)
 * @returns {{id: number, name: string}[]}
 */
function parseAllowedUsers() {
  const fromEnv = process.env.ALLOWED_USER_IDS;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.split(',').map(s => s.trim()).filter(Boolean).map(part => {
      const sep = part.indexOf(':');
      if (sep >= 0) {
        return { id: parseInt(part.slice(0, sep), 10), name: part.slice(sep + 1).trim() || part };
      }
      const id = parseInt(part, 10);
      return { id, name: String(id) };
    }).filter(u => !isNaN(u.id));
  }
  try {
    const rows = query('SELECT telegram_user_id FROM allowed_users');
    return (rows || []).map(r => ({
      id: r.telegram_user_id,
      name: String(r.telegram_user_id),
    }));
  } catch {
    return [];
  }
}

async function getAllowedUserIds() {
  const users = parseAllowedUsers();
  return users.map(u => u.id);
}

function getAllowedUsers() {
  return parseAllowedUsers();
}

function getUserName(userId) {
  const users = parseAllowedUsers();
  const u = users.find(x => x.id === userId);
  return u ? u.name : String(userId);
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

async function getActiveRecordForPerson(personId) {
  const rows = query(
    `SELECT * FROM client_deferral_history WHERE person_id = ? AND status = 'ACTIVE' LIMIT 1`,
    [personId]
  );
  return rows[0] || null;
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
  getAllowedUsers,
  getUserName,
  insertDeferralHistory,
  getAllRecords,
  getActiveRecords,
  getActiveExpiredRecords,
  getRecordById,
  getActiveRecordForPerson,
  markAsRestored,
  clearAllRecords,
  updateDeferralEndDate,
  insertDeferralHistoryAndUpdateSmartup,
};
