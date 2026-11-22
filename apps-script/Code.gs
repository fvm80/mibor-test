/* ============================================================
 *  Бэкенд учёта малого бизнеса — Google Apps Script
 *  Листы: ops, orders, order_lines, debts, rates, settings
 * ============================================================ */

// ─── Точка входа GET ────────────────────────────────────────
function doGet() {
  return _json({ ok: true });
}

// ─── Точка входа POST ───────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { token, action, payload } = body;

    // Проверка токена (updateRates вызывается по триггеру без токена)
    const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (token !== expected) {
      return _json({ ok: false, error: 'unauthorized' });
    }

    switch (action) {
      case 'ping':
        return _json({ ok: true, serverTime: new Date().toISOString() });

      case 'init':
        return _json({ ok: true, data: _actionInit(), serverTime: new Date().toISOString() });

      case 'sync':
        return _json({ ok: true, data: _actionSync(payload), serverTime: new Date().toISOString() });

      case 'refreshRates':
        return _json({ ok: true, data: _actionRefreshRates(), serverTime: new Date().toISOString() });

      default:
        return _json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return _json({ ok: false, error: err.message || 'internal_error' });
  }
}

// ─── Триггерная функция (каждые 3 часа) ─────────────────────
function updateRates() {
  _actionRefreshRates();
}

// ============================================================
//  ДЕЙСТВИЯ
// ============================================================

// ─── init: создаёт листы и начальные настройки ──────────────
function _actionInit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Описание листов: имя → массив заголовков
  const schema = {
    ops: [
      'id','type','amount','currency','date','counterparty','purpose',
      'category','order_id','order_line_id','debt_id','debt_role',
      'rate_at_entry','note','created_at','updated_at','deleted'
    ],
    orders: [
      'id','name','client','status','currency','price','start_date',
      'due_date','closed_at','note','created_at','updated_at','deleted'
    ],
    order_lines: [
      'id','order_id','type','name','qty','unit','unit_price',
      'plan_amount','currency','fact_amount','note','sort',
      'created_at','updated_at','deleted'
    ],
    debts: [
      'id','direction','counterparty','amount','currency','date',
      'due_date','purpose','order_id','cash_moved','status','note',
      'created_at','updated_at','deleted'
    ],
    rates: [
      'currency','rate_auto','rate_auto_at','rate_manual','mode','source'
    ],
    settings: [
      'key','value'
    ]
  };

  for (const [name, headers] of Object.entries(schema)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      // Замораживаем строку заголовков
      sheet.setFrozenRows(1);
    }
  }

  // Начальные настройки (записываем только если лист settings пуст)
  const settingsSheet = ss.getSheetByName('settings');
  const settingsData = _sheetToObjects(settingsSheet);
  if (settingsData.length === 0) {
    const defaults = [
      ['base_currency', 'MDL'],
      ['currencies', '["MDL","USD","EUR"]'],
      ['categories_income', '["оплата заказа","продажа","прочее"]'],
      ['categories_expense', '["материалы","услуги","электричество","инструмент","транспорт","налоги","прочее"]']
    ];
    const start = settingsSheet.getLastRow() + 1;
    settingsSheet.getRange(start, 1, defaults.length, 2).setValues(defaults);
  }

  // Начальные строки rates для каждой валюты (если пусто)
  const ratesSheet = ss.getSheetByName('rates');
  const ratesData = _sheetToObjects(ratesSheet);
  if (ratesData.length === 0) {
    const currencies = ['MDL', 'USD', 'EUR'];
    const rows = currencies.map(c => {
      const isBase = c === 'MDL';
      return [c, isBase ? 1 : '', '', '', isBase ? 'fixed' : 'auto', ''];
    });
    const start = ratesSheet.getLastRow() + 1;
    ratesSheet.getRange(start, 1, rows.length, 6).setValues(rows);
  }

  return { initialized: true };
}

// ─── sync: двусторонняя синхронизация ───────────────────────
function _actionSync(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const since = payload && payload.since ? new Date(payload.since) : null;
  const changes = (payload && payload.changes) || [];

  // 1. Применяем входящие изменения с блокировкой
  if (changes.length > 0) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000); // ожидание 10 секунд
    try {
      for (const change of changes) {
        const sheetName = change.sheet;
        const records = change.data || [];
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) continue;

        const headers = _getHeaders(sheet);
        if (headers.length === 0) continue;

        // Определяем ключевое поле (id или key для settings, currency для rates)
        const keyField = _keyFieldFor(sheetName);
        const keyCol = headers.indexOf(keyField);
        if (keyCol === -1) continue;

        const updatedAtCol = headers.indexOf('updated_at');

        // Загружаем все данные листа
        const lastRow = sheet.getLastRow();
        let allData = [];
        if (lastRow > 1) {
          allData = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
        }

        // Строим индекс id → номер строки (0-based в массиве allData)
        const index = {};
        for (let i = 0; i < allData.length; i++) {
          const k = String(allData[i][keyCol]);
          if (k) index[k] = i;
        }

        const now = new Date().toISOString();

        for (const rec of records) {
          const recKey = String(rec[keyField] || '');
          if (!recKey) continue;

          // Собираем строку-массив по порядку заголовков
          const newRow = headers.map(h => {
            if (h === 'updated_at') return now;
            return rec[h] !== undefined ? rec[h] : '';
          });

          if (recKey in index) {
            // Обновление существующей строки (last-write-wins)
            const rowIdx = index[recKey];
            if (updatedAtCol !== -1) {
              const existingUpdated = allData[rowIdx][updatedAtCol];
              const incomingUpdated = rec['updated_at'] || '';
              // Если у существующей записи updated_at > входящей, пропускаем
              if (existingUpdated && incomingUpdated && new Date(existingUpdated) > new Date(incomingUpdated)) {
                continue;
              }
            }
            // Записываем обновлённую строку (строка в таблице = rowIdx + 2)
            sheet.getRange(rowIdx + 2, 1, 1, headers.length).setValues([newRow]);
          } else {
            // Новая запись — добавляем
            sheet.appendRow(newRow);
          }
        }
      }
    } finally {
      lock.releaseLock();
    }
  }

  // 2. Возвращаем все записи, изменённые после since
  const result = {};
  const sheetNames = ['ops', 'orders', 'order_lines', 'debts', 'rates', 'settings'];

  for (const name of sheetNames) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      result[name] = [];
      continue;
    }
    const all = _sheetToObjects(sheet);
    if (!since) {
      result[name] = all;
    } else {
      result[name] = all.filter(row => {
        const u = row['updated_at'] || row['rate_auto_at'];
        return u && new Date(u) >= since;
      });
    }
  }

  return result;
}

// ─── refreshRates: обновление курсов валют ──────────────────
function _actionRefreshRates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Считываем настройки
  const settingsSheet = ss.getSheetByName('settings');
  if (!settingsSheet) return { refreshed: false, error: 'no_settings_sheet' };

  const settingsData = _sheetToObjects(settingsSheet);
  const baseCurrency = _settingValue(settingsData, 'base_currency') || 'MDL';
  const currenciesRaw = _settingValue(settingsData, 'currencies') || '["MDL","USD","EUR"]';
  let currencies;
  try {
    currencies = JSON.parse(currenciesRaw);
  } catch (_) {
    currencies = ['MDL', 'USD', 'EUR'];
  }

  // Лист rates
  const ratesSheet = ss.getSheetByName('rates');
  if (!ratesSheet) return { refreshed: false, error: 'no_rates_sheet' };

  const headers = _getHeaders(ratesSheet);
  const lastRow = ratesSheet.getLastRow();
  let ratesData = [];
  if (lastRow > 1) {
    ratesData = ratesSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  }

  // Индекс currency → строка (0-based)
  const currCol = headers.indexOf('currency');
  const modeCol = headers.indexOf('mode');
  const rateAutoCol = headers.indexOf('rate_auto');
  const rateAutoAtCol = headers.indexOf('rate_auto_at');
  const sourceCol = headers.indexOf('source');

  const index = {};
  for (let i = 0; i < ratesData.length; i++) {
    index[String(ratesData[i][currCol])] = i;
  }

  // Дата для BNM (сегодня)
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const dateStr = `${dd}.${mm}.${yyyy}`;

  // Пробуем получить курсы с BNM (XML)
  let bnmRates = null;
  try {
    const url = `https://www.bnm.md/en/official_exchange_rates?get_xml=1&date=${dateStr}`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      const xml = XmlService.parse(response.getContentText());
      const root = xml.getRootElement();
      const ns = root.getNamespace();
      // Элементы Valute
      const valuteList = ns
        ? root.getChildren('Valute', ns)
        : root.getChildren('Valute');
      bnmRates = {};
      for (const v of valuteList) {
        const charCode = _xmlChildText(v, 'CharCode', ns);
        const nominal = parseFloat(_xmlChildText(v, 'Nominal', ns)) || 1;
        const value = parseFloat(_xmlChildText(v, 'Value', ns)) || 0;
        if (charCode && value) {
          bnmRates[charCode] = value / nominal;
        }
      }
    }
  } catch (e) {
    // BNM недоступен — попробуем запасной API
    Logger.log('BNM fetch error: ' + e.message);
  }

  // Запасной источник (open.er-api.com)
  let fallbackRates = null;
  if (!bnmRates) {
    try {
      const url = `https://open.er-api.com/v6/latest/${baseCurrency}`;
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() === 200) {
        const json = JSON.parse(response.getContentText());
        if (json.rates) {
          fallbackRates = {};
          // Нужен курс «сколько MDL за 1 единицу валюты» → 1 / json.rates[currency]
          for (const [code, rate] of Object.entries(json.rates)) {
            if (rate > 0) {
              fallbackRates[code] = 1 / rate;
            }
          }
        }
      }
    } catch (e) {
      Logger.log('Fallback rates fetch error: ' + e.message);
    }
  }

  const ratesSource = bnmRates || fallbackRates;
  const sourceName = bnmRates ? 'bnm.md' : (fallbackRates ? 'open.er-api.com' : 'none');
  const updatedCurrencies = [];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    for (const cur of currencies) {
      if (cur === baseCurrency) continue;

      const rowIdx = index[cur];
      // Проверяем mode: обновляем только auto (или пустое)
      let mode = 'auto';
      if (rowIdx !== undefined && modeCol !== -1) {
        mode = String(ratesData[rowIdx][modeCol] || 'auto');
      }
      if (mode !== 'auto') continue;

      // Получаем курс
      const rate = ratesSource ? ratesSource[cur] : null;
      if (!rate) continue;

      const nowIso = new Date().toISOString();

      if (rowIdx !== undefined) {
        // Обновляем существующую строку
        const sheetRow = rowIdx + 2;
        if (rateAutoCol !== -1) ratesSheet.getRange(sheetRow, rateAutoCol + 1).setValue(rate);
        if (rateAutoAtCol !== -1) ratesSheet.getRange(sheetRow, rateAutoAtCol + 1).setValue(nowIso);
        if (sourceCol !== -1) ratesSheet.getRange(sheetRow, sourceCol + 1).setValue(sourceName);
      } else {
        // Добавляем новую строку
        const newRow = headers.map(h => {
          if (h === 'currency') return cur;
          if (h === 'rate_auto') return rate;
          if (h === 'rate_auto_at') return nowIso;
          if (h === 'mode') return 'auto';
          if (h === 'source') return sourceName;
          return '';
        });
        ratesSheet.appendRow(newRow);
      }
      updatedCurrencies.push(cur);
    }
  } finally {
    lock.releaseLock();
  }

  return { refreshed: true, source: sourceName, updated: updatedCurrencies };
}

// ============================================================
//  УТИЛИТЫ
// ============================================================

/** Формирует JSON-ответ через ContentService */
function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Возвращает массив заголовков из первой строки листа */
function _getHeaders(sheet) {
  if (sheet.getLastRow() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

/** Преобразует лист в массив объектов (ключ = заголовок) */
function _sheetToObjects(sheet) {
  const headers = _getHeaders(sheet);
  if (headers.length === 0 || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return data.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

/** Определяет ключевое поле для upsert по имени листа */
function _keyFieldFor(sheetName) {
  if (sheetName === 'settings') return 'key';
  if (sheetName === 'rates') return 'currency';
  return 'id';
}

/** Извлекает значение настройки по ключу из массива объектов settings */
function _settingValue(settingsData, key) {
  const row = settingsData.find(r => r.key === key);
  return row ? row.value : null;
}

/** Извлекает текст дочернего XML-элемента с учётом namespace */
function _xmlChildText(parent, childName, ns) {
  const child = ns
    ? parent.getChild(childName, ns)
    : parent.getChild(childName);
  return child ? child.getText() : '';
}
