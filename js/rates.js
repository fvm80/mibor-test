// rates.js — Работа с курсами валют
// Правила приоритета: manual → auto → manual (fallback) → null

/**
 * Получить эффективный курс валюты
 * По правилам ТЗ (раздел 6):
 * 1. mode=manual и rate_manual задан → rate_manual
 * 2. Иначе rate_auto если есть
 * 3. Иначе rate_manual если есть
 * 4. Иначе null (нет курса)
 *
 * @param {string} currency — код валюты
 * @param {Array} rates — массив записей из листа rates
 * @param {string} baseCurrency — базовая валюта (по умолчанию MDL)
 * @returns {number|null}
 */
export function getEffectiveRate(currency, rates, baseCurrency = 'MDL') {
  // Для базовой валюты курс всегда 1
  if (currency === baseCurrency) return 1;

  const rateRecord = rates.find(r => r.currency === currency);
  if (!rateRecord) return null;

  // 1. Ручной режим и значение задано
  if (rateRecord.mode === 'manual' && rateRecord.rate_manual != null && rateRecord.rate_manual !== '') {
    return parseFloat(rateRecord.rate_manual);
  }

  // 2. Автоматический курс если есть
  if (rateRecord.rate_auto != null && rateRecord.rate_auto !== '') {
    return parseFloat(rateRecord.rate_auto);
  }

  // 3. Ручной курс как запасной
  if (rateRecord.rate_manual != null && rateRecord.rate_manual !== '') {
    return parseFloat(rateRecord.rate_manual);
  }

  // 4. Нет курса
  return null;
}

/**
 * Конвертация суммы в базовую валюту
 * @param {number} amount
 * @param {string} currency
 * @param {Array} rates
 * @param {string} baseCurrency
 * @returns {number|null} — null если нет курса
 */
export function toBase(amount, currency, rates, baseCurrency = 'MDL') {
  const rate = getEffectiveRate(currency, rates, baseCurrency);
  if (rate === null) return null;
  return amount * rate;
}

/**
 * Конвертация из базовой валюты
 * @param {number} amount — сумма в базовой валюте
 * @param {string} currency — целевая валюта
 * @param {Array} rates
 * @param {string} baseCurrency
 * @returns {number|null}
 */
export function fromBase(amount, currency, rates, baseCurrency = 'MDL') {
  const rate = getEffectiveRate(currency, rates, baseCurrency);
  if (rate === null || rate === 0) return null;
  return amount / rate;
}

/**
 * Построить карту курсов { currency: rate } для быстрого доступа
 * @param {Array} rates
 * @param {string} baseCurrency
 * @returns {Object}
 */
export function buildRateMap(rates, baseCurrency = 'MDL') {
  const map = {};
  map[baseCurrency] = 1;
  for (const r of rates) {
    const rate = getEffectiveRate(r.currency, rates, baseCurrency);
    if (rate !== null) {
      map[r.currency] = rate;
    }
  }
  return map;
}

/**
 * Проверить, старше ли автокурс указанного количества часов
 * @param {Object} rateRecord — запись курса
 * @param {number} hours — порог в часах
 * @returns {boolean}
 */
export function isRateStale(rateRecord, hours = 24) {
  if (!rateRecord || !rateRecord.rate_auto_at) return true;
  const updated = new Date(rateRecord.rate_auto_at);
  const now = new Date();
  const diffMs = now - updated;
  return diffMs > hours * 60 * 60 * 1000;
}

/**
 * Форматирование курса для отображения
 * @param {string} currency
 * @param {Array} rates
 * @param {string} baseCurrency
 * @returns {Object} — { display: "18,20", source: "авто"|"вручную", stale: bool, updatedAt: Date|null }
 */
export function formatRateDisplay(currency, rates, baseCurrency = 'MDL') {
  const rateRecord = rates.find(r => r.currency === currency);
  if (!rateRecord) return { display: '—', source: '', stale: true, updatedAt: null };

  const effectiveRate = getEffectiveRate(currency, rates, baseCurrency);
  if (effectiveRate === null) return { display: '—', source: '', stale: true, updatedAt: null };

  const display = effectiveRate.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const source = rateRecord.mode === 'manual' ? 'вручную' : 'авто';
  const stale = isRateStale(rateRecord, 24);
  const updatedAt = rateRecord.rate_auto_at ? new Date(rateRecord.rate_auto_at) : null;

  return { display, source, stale, updatedAt };
}
