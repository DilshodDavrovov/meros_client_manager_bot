const MIN_DATE = new Date('2000-01-01');

const DDMMYYYY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function parseDateDDMMYYYY(str) {
  const m = str.trim().match(DDMMYYYY);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

function toYYYYMMDD(date) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${y}-${m}-${d}`;
}

function toDDMMYYYY(date) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

/**
 * @param {string} str - Date string dd.MM.yyyy
 * @returns {{ valid: boolean, error?: string, date?: Date, yyyyMMdd?: string, ddMMyyyy?: string }}
 */
function validateEndDate(str) {
  if (!str || typeof str !== 'string') {
    return { valid: false, error: 'Введите дату в формате ДД.ММ.ГГГГ' };
  }
  const trimmed = str.trim();
  if (!DDMMYYYY.test(trimmed)) {
    return { valid: false, error: 'Неверный формат. Используйте ДД.ММ.ГГГГ (например: 31.12.2025)' };
  }
  const date = parseDateDDMMYYYY(trimmed);
  if (!date) {
    return { valid: false, error: 'Некорректная дата' };
  }
  if (date < MIN_DATE) {
    return { valid: false, error: 'Дата слишком ранняя' };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) {
    return { valid: false, error: 'Нельзя указать прошедшую дату' };
  }
  return {
    valid: true,
    date,
    yyyyMMdd: toYYYYMMDD(date),
    ddMMyyyy: toDDMMYYYY(date),
  };
}

module.exports = {
  validateEndDate,
  toYYYYMMDD,
  toDDMMYYYY,
};
