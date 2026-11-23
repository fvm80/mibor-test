// settings.js — Настройки (#/settings)
// Подключение, валюты, категории, установка PWA, данные

import { getMeta, setMeta, put, getAll, clear, getActiveData, getOutbox, addToOutbox } from '../db.js';
import { ping, init, sync, refreshRates, scheduleSyncAfterChange } from '../sync.js';
import { showToast } from './toast.js';
import { formatDateTime } from '../dates.js';
import { getCurrentHash, isCurrentRender, nextRenderSeq } from '../router.js';

// Перехватываем событие установки PWA (Android)
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

/**
 * Отрисовать настройки
 * @param {HTMLElement} container
 * @param {number} [renderId]
 */
export async function renderSettings(container, renderId) {
  if (!container) return;
  const thisRender = renderId || nextRenderSeq();

  const scriptUrl = await getMeta('scriptUrl') || '';
  const token = await getMeta('token') || '';
  const data = await getActiveData();
  if (!isCurrentRender(thisRender)) return;
  if (getCurrentHash() !== '#/settings') return;

  const { settings } = data;
  const fragment = document.createDocumentFragment();

  // === Подключение ===
  fragment.appendChild(_sectionConnection(scriptUrl, token));

  // === Валюты ===
  const curSection = await _sectionCurrencies(settings, data);
  if (!isCurrentRender(thisRender)) return;
  fragment.appendChild(curSection);

  // === Категории ===
  fragment.appendChild(_sectionCategories(settings, container));

  // === Установка PWA ===
  fragment.appendChild(_sectionInstall());

  // === Оформление (Тема) ===
  fragment.appendChild(_sectionTheme(container));

  // === Данные ===
  fragment.appendChild(_sectionData(container));

  // === О приложении ===
  const aboutSection = await _sectionAbout();
  if (!isCurrentRender(thisRender)) return;
  if (getCurrentHash() !== '#/settings') return;
  fragment.appendChild(aboutSection);

  container.innerHTML = '';
  container.appendChild(fragment);
}

// ============================================================
//  ПОДКЛЮЧЕНИЕ
// ============================================================

function _sectionConnection(scriptUrl, token) {
  const section = _createSection('Подключение');

  // URL
  const urlGroup = _field('URL скрипта (Apps Script)', 'url', 'settingsUrl', {
    value: scriptUrl,
    placeholder: 'https://script.google.com/macros/s/.../exec'
  });
  section.appendChild(urlGroup);

  // Токен
  const tokenGroup = _field('Токен (API_TOKEN)', 'password', 'settingsToken', {
    value: token,
    placeholder: 'Секретный токен'
  });
  section.appendChild(tokenGroup);

  // Сохранить
  const saveBtn = _btn('Сохранить подключение', 'btn-primary', async () => {
    const u = section.querySelector('[name="settingsUrl"]').value.trim();
    const t = section.querySelector('[name="settingsToken"]').value.trim();
    if (!u || !t) { showToast('Заполните URL и токен'); return; }
    await setMeta('scriptUrl', u);
    await setMeta('token', t);
    showToast('Подключение сохранено');
  });
  section.appendChild(saveBtn);

  // Кнопки действий
  const btns = document.createElement('div');
  btns.className = 'settings-buttons';

  btns.appendChild(_btn('Проверить связь', 'btn-secondary', async (btn) => {
    await setMeta('scriptUrl', section.querySelector('[name="settingsUrl"]').value.trim());
    await setMeta('token', section.querySelector('[name="settingsToken"]').value.trim());
    btn.disabled = true; btn.textContent = 'Проверка...';
    try { await ping(); showToast('✓ Связь установлена'); }
    catch (e) { showToast('✗ ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Проверить связь'; }
  }));

  btns.appendChild(_btn('Инициализировать таблицу', 'btn-secondary', async (btn) => {
    await setMeta('scriptUrl', section.querySelector('[name="settingsUrl"]').value.trim());
    await setMeta('token', section.querySelector('[name="settingsToken"]').value.trim());
    btn.disabled = true; btn.textContent = 'Инициализация...';
    try {
      await init();
      await sync();
      showToast('✓ Таблица готова, данные синхронизированы');
    } catch (e) { showToast('✗ ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Инициализировать таблицу'; }
  }));

  section.appendChild(btns);
  return section;
}

// ============================================================
//  ВАЛЮТЫ
// ============================================================

async function _sectionCurrencies(settings, data) {
  const section = _createSection('Валюты');

  const baseCurrency = _sv(settings, 'base_currency', 'MDL');
  const currencies = _svJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);

  const baseInfo = document.createElement('div');
  baseInfo.className = 'setting-info';
  baseInfo.textContent = `Базовая валюта: ${baseCurrency} (нельзя изменить после создания данных)`;
  section.appendChild(baseInfo);

  // Список валют
  const curList = document.createElement('div');
  curList.className = 'settings-list';

  for (const cur of currencies) {
    const item = document.createElement('div');
    item.className = 'settings-list-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = cur;
    item.appendChild(nameSpan);

    if (cur === baseCurrency) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'базовая';
      item.appendChild(badge);
    } else {
      // Кнопка удаления (только если нет записей в этой валюте)
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.textContent = '✕';
      delBtn.setAttribute('aria-label', `Удалить ${cur}`);
      delBtn.addEventListener('click', async () => {
        // Проверяем наличие записей
        const hasOps = data.ops.some(o => o.currency === cur);
        const hasDebts = data.debts.some(d => d.currency === cur);
        const hasOrders = data.orders.some(o => o.currency === cur);
        if (hasOps || hasDebts || hasOrders) {
          showToast(`Нельзя удалить ${cur}: есть записи в этой валюте`);
          return;
        }
        if (!confirm(`Удалить валюту ${cur}?`)) return;
        const updated = currencies.filter(c => c !== cur);
        await _saveSetting(settings, 'currencies', JSON.stringify(updated));
        showToast(`${cur} удалена`);
        // Перерисовать, если всё ещё на странице настроек
        const container = document.getElementById('app-content');
        if (container && getCurrentHash() === '#/settings') renderSettings(container);
      });
      item.appendChild(delBtn);
    }

    // Режим курса
    const rateRecord = data.rates.find(r => r.currency === cur);
    if (rateRecord && cur !== baseCurrency) {
      const modeSpan = document.createElement('span');
      modeSpan.className = 'setting-info-inline';
      modeSpan.textContent = rateRecord.mode === 'manual' ? 'вручную' : 'авто';
      item.appendChild(modeSpan);
    }

    curList.appendChild(item);
  }
  section.appendChild(curList);

  // Добавить валюту
  const addRow = document.createElement('div');
  addRow.className = 'add-row';

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = 'Код ISO (напр. GBP)';
  addInput.maxLength = 3;
  addInput.style.textTransform = 'uppercase';
  addRow.appendChild(addInput);

  addRow.appendChild(_btn('Добавить', 'btn-secondary', async () => {
    const code = addInput.value.trim().toUpperCase();
    if (!code || code.length < 2 || code.length > 3) {
      showToast('Введите код валюты (2-3 буквы)');
      return;
    }
    if (currencies.includes(code)) {
      showToast(`${code} уже добавлена`);
      return;
    }
    const updated = [...currencies, code];
    await _saveSetting(settings, 'currencies', JSON.stringify(updated));
    // Создаём запись в rates для новой валюты
    const newRate = { currency: code, rate_auto: '', rate_auto_at: '', rate_manual: '', mode: 'auto', source: '' };
    await put('rates', newRate);
    await addToOutbox({ sheet: 'rates', data: newRate });
    scheduleSyncAfterChange();
    showToast(`${code} добавлена`);
    const container = document.getElementById('app-content');
    if (container && getCurrentHash() === '#/settings') renderSettings(container);
  }));

  section.appendChild(addRow);
  return section;
}

// ============================================================
//  КАТЕГОРИИ
// ============================================================

function _sectionCategories(settings, pageContainer) {
  const section = _createSection('Категории');

  // Доходы
  const incomeTitle = document.createElement('h4');
  incomeTitle.textContent = 'Доходы';
  section.appendChild(incomeTitle);
  section.appendChild(_categoryList(settings, 'categories_income', pageContainer));

  // Расходы
  const expenseTitle = document.createElement('h4');
  expenseTitle.textContent = 'Расходы';
  section.appendChild(expenseTitle);
  section.appendChild(_categoryList(settings, 'categories_expense', pageContainer));

  return section;
}

function _categoryList(settings, settingKey, pageContainer) {
  const categories = _svJSON(settings, settingKey, []);
  const wrapper = document.createElement('div');

  const list = document.createElement('div');
  list.className = 'chips-list';

  for (const cat of categories) {
    const chip = document.createElement('span');
    chip.className = 'chip chip-editable';
    chip.textContent = cat;

    // Долгое нажатие / клик → переименовать или скрыть
    chip.addEventListener('click', async () => {
      const action = prompt(
        `Категория: «${cat}»\n\nВведите новое имя для переименования,\nили оставьте пустым и нажмите OK чтобы удалить:`,
        cat
      );
      if (action === null) return; // Отмена

      let updated;
      if (action.trim() === '') {
        // Удаление
        if (!confirm(`Удалить категорию «${cat}»?`)) return;
        updated = categories.filter(c => c !== cat);
      } else if (action.trim() !== cat) {
        // Переименование
        updated = categories.map(c => c === cat ? action.trim() : c);
      } else {
        return; // Без изменений
      }

      await _saveSetting(settings, settingKey, JSON.stringify(updated));
      showToast('Категории обновлены');
      if (getCurrentHash() === '#/settings') renderSettings(pageContainer);
    });

    list.appendChild(chip);
  }
  wrapper.appendChild(list);

  // Добавить категорию
  const addRow = document.createElement('div');
  addRow.className = 'add-row';

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = 'Новая категория';
  addRow.appendChild(addInput);

  addRow.appendChild(_btn('Добавить', 'btn-secondary', async () => {
    const name = addInput.value.trim();
    if (!name) { showToast('Введите название'); return; }
    if (categories.includes(name)) { showToast('Уже существует'); return; }
    const updated = [...categories, name];
    await _saveSetting(settings, settingKey, JSON.stringify(updated));
    showToast(`«${name}» добавлена`);
    if (getCurrentHash() === '#/settings') renderSettings(pageContainer);
  }));

  wrapper.appendChild(addRow);
  return wrapper;
}

// ============================================================
//  УСТАНОВКА PWA
// ============================================================

function _sectionInstall() {
  const section = _createSection('Установка');

  // iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;

  if (isStandalone) {
    const info = document.createElement('div');
    info.className = 'setting-info';
    info.textContent = '✓ Приложение установлено';
    section.appendChild(info);
  } else if (isIOS) {
    const hint = document.createElement('div');
    hint.className = 'install-hint';

    const icon = document.createElement('span');
    icon.textContent = '📤';
    icon.style.fontSize = '24px';
    hint.appendChild(icon);

    const text = document.createElement('span');
    text.textContent = ' Нажмите «Поделиться» → «На экран Домой» для установки';
    hint.appendChild(text);

    section.appendChild(hint);
  } else {
    // Android и прочие
    const installBtn = _btn('Установить на главный экран', 'btn-primary', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const result = await deferredInstallPrompt.userChoice;
        if (result.outcome === 'accepted') {
          showToast('Приложение установлено!');
        }
        deferredInstallPrompt = null;
      } else {
        showToast('Установка недоступна. Откройте через Chrome → «Добавить на главный экран»');
      }
    });
    section.appendChild(installBtn);
  }

  return section;
}

// ============================================================
//  ОФОРМЛЕНИЕ (ТЕМА)
// ============================================================

function _sectionTheme(pageContainer) {
  const section = _createSection('Тема оформления');
  const row = document.createElement('div');
  row.className = 'chips-row';

  const currentTheme = localStorage.getItem('uchet-theme') || 'auto';

  const themes = [
    { key: 'auto', label: 'Авто (как в системе)' },
    { key: 'light', label: 'Светлая' },
    { key: 'dark', label: 'Тёмная' }
  ];

  for (const t of themes) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (currentTheme === t.key ? ' active' : '');
    chip.textContent = t.label;
    chip.addEventListener('click', () => {
      localStorage.setItem('uchet-theme', t.key);
      if (t.key === 'auto') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', t.key);
      }
      showToast(`Выбрана тема: ${t.label}`);
      if (getCurrentHash() === '#/settings') renderSettings(pageContainer);
    });
    row.appendChild(chip);
  }

  section.appendChild(row);
  return section;
}

// ============================================================
//  ДАННЫЕ
// ============================================================

function _sectionData(pageContainer) {
  const section = _createSection('Данные и резервные копии');
  const btns = document.createElement('div');
  btns.className = 'settings-buttons';

  btns.appendChild(_btn('Синхронизировать сейчас', 'btn-secondary', async (btn) => {
    btn.disabled = true; btn.textContent = 'Синхронизация...';
    try { await sync(); showToast('✓ Синхронизировано'); }
    catch (e) { showToast('✗ ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Синхронизировать сейчас'; }
  }));

  btns.appendChild(_btn('Обновить курсы валют', 'btn-secondary', async (btn) => {
    btn.disabled = true; btn.textContent = 'Обновление...';
    try { await refreshRates(); showToast('✓ Курсы обновлены'); }
    catch (e) { showToast('✗ ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Обновить курсы валют'; }
  }));

  btns.appendChild(_btn('Экспорт JSON (все данные)', 'btn-secondary', async () => {
    const data = await getActiveData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    _downloadBlob(blob, `uchet-backup-${new Date().toISOString().slice(0,10)}.json`);
    showToast('Резервная копия JSON сохранена');
  }));

  btns.appendChild(_btn('Экспорт CSV (операции)', 'btn-secondary', async () => {
    const data = await getActiveData();
    const csv = _opsToCSV(data.ops);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    _downloadBlob(blob, `uchet-ops-${new Date().toISOString().slice(0,10)}.csv`);
    showToast('CSV с операциями сохранён');
  }));

  btns.appendChild(_btn('Экспорт CSV (заказы)', 'btn-secondary', async () => {
    const data = await getActiveData();
    const csv = _ordersToCSV(data.orders);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    _downloadBlob(blob, `uchet-orders-${new Date().toISOString().slice(0,10)}.csv`);
    showToast('CSV с заказами сохранён');
  }));

  btns.appendChild(_btn('Экспорт CSV (долги)', 'btn-secondary', async () => {
    const data = await getActiveData();
    const csv = _debtsToCSV(data.debts);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    _downloadBlob(blob, `uchet-debts-${new Date().toISOString().slice(0,10)}.csv`);
    showToast('CSV с долгами сохранён');
  }));

  btns.appendChild(_btn('Очистить локальный кэш', 'btn-danger', async () => {
    const outbox = await getOutbox();
    if (outbox.length > 0) {
      if (!confirm(`Есть ${outbox.length} неотправленных изменений! При очистке они будут потеряны. Продолжить?`)) return;
    } else {
      if (!confirm('Очистить все локальные данные? Они загрузятся заново при следующей синхронизации.')) return;
    }
    for (const store of ['ops', 'orders', 'order_lines', 'debts', 'rates', 'settings', 'outbox']) {
      await clear(store);
    }
    await setMeta('since', null);
    showToast('Локальный кэш очищен');
    if (getCurrentHash() === '#/settings') renderSettings(pageContainer);
  }));

  section.appendChild(btns);
  return section;
}

async function _sectionAbout() {
  const section = _createSection('О приложении');

  const ver = document.createElement('div');
  ver.className = 'setting-info';
  ver.textContent = 'Версия: 1.0.0';
  section.appendChild(ver);

  const since = await getMeta('since');
  const syncInfo = document.createElement('div');
  syncInfo.className = 'setting-info';
  syncInfo.textContent = since
    ? `Последняя синхронизация: ${formatDateTime(since)}`
    : 'Синхронизация не проводилась';
  section.appendChild(syncInfo);

  return section;
}

// ============================================================
//  УТИЛИТЫ
// ============================================================

function _createSection(title) {
  const s = document.createElement('div');
  s.className = 'settings-section';
  const h = document.createElement('h3');
  h.className = 'section-title';
  h.textContent = title;
  s.appendChild(h);
  return s;
}

function _field(label, type, name, attrs = {}) {
  const g = document.createElement('div');
  g.className = 'form-group';
  const l = document.createElement('label');
  l.textContent = label;
  g.appendChild(l);
  const i = document.createElement('input');
  i.type = type;
  i.name = name;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  g.appendChild(i);
  return g;
}

function _btn(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', () => onClick(b));
  return b;
}

function _sv(settings, key, def) {
  const s = settings.find(s => s.key === key);
  return s ? s.value : def;
}

function _svJSON(settings, key, def) {
  const s = settings.find(s => s.key === key);
  if (!s) return def;
  try { return JSON.parse(s.value); }
  catch { return def; }
}

async function _saveSetting(settings, key, value) {
  const record = { key, value };
  await put('settings', record);
  await addToOutbox({ sheet: 'settings', data: record });
  scheduleSyncAfterChange();
  // Обновляем в массиве settings тоже
  const existing = settings.find(s => s.key === key);
  if (existing) existing.value = value;
  else settings.push(record);
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function _opsToCSV(ops) {
  const headers = ['id','type','amount','currency','date','counterparty','purpose','category','note','order_id','debt_id','created_at'];
  const lines = [headers.join(';')];
  for (const op of ops) {
    const row = headers.map(h => {
      const val = String(op[h] ?? '').replace(/"/g, '""');
      return `"${val}"`;
    });
    lines.push(row.join(';'));
  }
  return lines.join('\r\n');
}

function _ordersToCSV(orders) {
  const headers = ['id','name','client','status','price','currency','start_date','due_date','note','created_at'];
  const lines = [headers.join(';')];
  for (const order of orders) {
    const row = headers.map(h => {
      const val = String(order[h] ?? '').replace(/"/g, '""');
      return `"${val}"`;
    });
    lines.push(row.join(';'));
  }
  return lines.join('\r\n');
}

function _debtsToCSV(debts) {
  const headers = ['id','direction','amount','currency','date','due_date','counterparty','purpose','status','cash_moved','order_id','note','created_at'];
  const lines = [headers.join(';')];
  for (const debt of debts) {
    const row = headers.map(h => {
      const val = String(debt[h] ?? '').replace(/"/g, '""');
      return `"${val}"`;
    });
    lines.push(row.join(';'));
  }
  return lines.join('\r\n');
}
