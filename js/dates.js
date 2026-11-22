// dates.js — Безопасная работа с датами
// Защита от RangeError, поддержка yyyy-mm-dd, ISO, dd.mm.yyyy, Date объектов

const fmtDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

const fmtDateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

/**
 * Безопасный парсинг любого формата даты в объект Date
 * Возвращает null при невалидных входных данных
 * @param {string|Date|number} val
 * @returns {Date|null}
 */
export function parseDateSafe(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }

  const str = String(val).trim();
  if (!str) return null;

  // 1. Строгий YYYY-MM-DD (без времени) -> создаём локальную полночь
  const ymdStrict = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdStrict) {
    const y = parseInt(ymdStrict[1], 10);
    const m = parseInt(ymdStrict[2], 10) - 1;
    const d = parseInt(ymdStrict[3], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // 2. Строгий DD.MM.YYYY (без времени) -> создаём локальную полночь
  const dmyStrict = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmyStrict) {
    const d = parseInt(dmyStrict[1], 10);
    const m = parseInt(dmyStrict[2], 10) - 1;
    const y = parseInt(dmyStrict[3], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // 3. ISO с временем или другие форматы, понятные стандартному парсеру
  try {
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) return dt;
  } catch (_) {}

  // 4. Попытка отрезать время, если это ISO вида "YYYY-MM-DDThh:mm..."
  const ymdPrefix = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdPrefix) {
    const y = parseInt(ymdPrefix[1], 10);
    const m = parseInt(ymdPrefix[2], 10) - 1;
    const d = parseInt(ymdPrefix[3], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

/**
 * Безопасное форматирование даты в формат dd.MM.yyyy
 * Никогда не выбрасывает RangeError!
 * @param {string|Date|number} val
 * @returns {string}
 */
export function formatDate(val) {
  if (!val) return '';
  const dt = parseDateSafe(val);
  if (!dt) return String(val || '');
  try {
    return fmtDate.format(dt);
  } catch (_) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${d}.${m}.${y}`;
  }
}

/**
 * Безопасное форматирование даты и времени в dd.MM.yyyy HH:mm
 * @param {string|Date|number} val
 * @returns {string}
 */
export function formatDateTime(val) {
  if (!val) return '';
  const dt = parseDateSafe(val);
  if (!dt) return String(val || '');
  try {
    return fmtDateTime.format(dt);
  } catch (_) {
    return formatDate(val);
  }
}

/**
 * Проверка: дата строго раньше сегодняшнего дня (просрочена)?
 * Сравниваются только дни (без учёта часов/минут)
 * @param {string|Date|number} val
 * @returns {boolean}
 */
export function isDateBeforeToday(val) {
  if (!val) return false;
  const dt = parseDateSafe(val);
  if (!dt) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(dt);
  target.setHours(0, 0, 0, 0);

  return target.getTime() < today.getTime();
}

/**
 * Сравнение дат по убыванию (сначала свежие)
 */
export function compareDatesDesc(a, b) {
  const dtA = parseDateSafe(a);
  const dtB = parseDateSafe(b);
  if (!dtA && !dtB) return 0;
  if (!dtA) return 1;
  if (!dtB) return -1;
  return dtB.getTime() - dtA.getTime();
}

/**
 * Сравнение сроков по возрастанию (сначала ближайшие/просроченные)
 */
export function compareDueDatesAsc(a, b) {
  const dtA = parseDateSafe(a);
  const dtB = parseDateSafe(b);
  if (!dtA && !dtB) return 0;
  if (!dtA) return 1;
  if (!dtB) return -1;
  return dtA.getTime() - dtB.getTime();
}

/**
 * Получить сегодняшнюю дату в формате yyyy-mm-dd (для полей ввода <input type="date">)
 * @returns {string}
 */
export function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
