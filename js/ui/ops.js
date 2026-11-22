// ops.js — Страница операций (#/ops)
// Список по датам, фильтры, итоги, карточка редактирования, поиск

import { getActiveData, put, addToOutbox } from '../db.js';
import { calcIncomeExpenseTotals } from '../calc.js';
import { scheduleSyncAfterChange } from '../sync.js';
import { showToast } from './toast.js';
import { formatDate, compareDatesDesc } from '../dates.js';

const fmtAmount = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

// Текущие фильтры
let filters = {
  period: 'month',
  type: 'all',
  currency: 'all',
  category: 'all',
  search: ''
};
let pageSize = 50;
let shownCount = 50;

/**
 * Отрисовать страницу операций
 */
export async function renderOps(container) {
  if (!container) return;
  container.innerHTML = '';
  shownCount = pageSize;

  try {
    const data = await getActiveData();
    const { ops, rates, settings } = data;

    const baseCurrency = _getSetting(settings, 'base_currency', 'MDL');
    const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);
    const catExpense = _getSettingJSON(settings, 'categories_expense', []);
    const catIncome = _getSettingJSON(settings, 'categories_income', []);
    const allCategories = [...new Set([...catIncome, ...catExpense])];

    // === Поиск ===
    const searchRow = document.createElement('div');
    searchRow.className = 'search-row';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Поиск по контрагенту, описанию...';
    searchInput.value = filters.search;
    searchInput.addEventListener('input', () => {
      filters.search = searchInput.value;
      _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories);
    });
    searchRow.appendChild(searchInput);
    container.appendChild(searchRow);

    // === Фильтры ===
    const filtersRow = document.createElement('div');
    filtersRow.className = 'filters-row';

    // Период
    _addChipGroup(filtersRow, [
      { key: 'week', label: 'Неделя' },
      { key: 'month', label: 'Месяц' },
      { key: 'all', label: 'Всё' }
    ], filters.period, (key) => {
      filters.period = key;
      _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories);
    });

    // Тип
    _addChipGroup(filtersRow, [
      { key: 'all', label: 'Все' },
      { key: 'income', label: 'Доходы' },
      { key: 'expense', label: 'Расходы' }
    ], filters.type, (key) => {
      filters.type = key;
      _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories);
    });

    container.appendChild(filtersRow);

    // Вторая строка фильтров: валюта + категория
    const filtersRow2 = document.createElement('div');
    filtersRow2.className = 'filters-row';

    // Валюта
    _addChipGroup(filtersRow2, [
      { key: 'all', label: 'Все' },
      ...currencies.map(c => ({ key: c, label: c }))
    ], filters.currency, (key) => {
      filters.currency = key;
      _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories);
    });

    // Категория
    if (allCategories.length > 0) {
      _addChipGroup(filtersRow2, [
        { key: 'all', label: 'Все кат.' },
        ...allCategories.map(c => ({ key: c, label: c }))
      ], filters.category, (key) => {
        filters.category = key;
        _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories);
      });
    }

    container.appendChild(filtersRow2);

    // === Контейнер для списка (обновляется при фильтрации) ===
    const listContainer = document.createElement('div');
    listContainer.id = 'ops-list-container';
    container.appendChild(listContainer);

    _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories);

  } catch (err) {
    console.error('Ошибка отрисовки операций:', err);
    const errorEl = document.createElement('p');
    errorEl.className = 'placeholder-text';
    errorEl.textContent = 'Ошибка загрузки данных';
    container.appendChild(errorEl);
  }
}

/**
 * Отрисовать список с учётом фильтров (без перерисовки фильтров)
 */
function _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories) {
  const listContainer = document.getElementById('ops-list-container');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  // Фильтрация
  let filtered = [...ops];

  // Период
  const now = new Date();
  if (filters.period === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 7);
    const s = d.toISOString().slice(0, 10);
    filtered = filtered.filter(op => (op.date || '') >= s);
  } else if (filters.period === 'month') {
    const d = new Date(now); d.setMonth(d.getMonth() - 1);
    const s = d.toISOString().slice(0, 10);
    filtered = filtered.filter(op => (op.date || '') >= s);
  }

  // Тип
  if (filters.type !== 'all') {
    filtered = filtered.filter(op => op.type === filters.type);
  }

  // Валюта
  if (filters.currency !== 'all') {
    filtered = filtered.filter(op => op.currency === filters.currency);
  }

  // Категория
  if (filters.category !== 'all') {
    filtered = filtered.filter(op => op.category === filters.category);
  }

  // Поиск
  if (filters.search.trim()) {
    const q = filters.search.toLowerCase().trim();
    filtered = filtered.filter(op =>
      (op.counterparty || '').toLowerCase().includes(q) ||
      (op.purpose || '').toLowerCase().includes(q) ||
      (op.note || '').toLowerCase().includes(q) ||
      (op.category || '').toLowerCase().includes(q)
    );
  }

  // === Итоги ===
  const totals = calcIncomeExpenseTotals(filtered, rates, baseCurrency);

  const totalsCard = document.createElement('div');
  totalsCard.className = 'card totals-card';

  const totalsGrid = document.createElement('div');
  totalsGrid.className = 'totals-grid';

  totalsGrid.appendChild(_createTotalsCol('Доходы', totals.income.totalBase, baseCurrency, 'text-income'));
  totalsGrid.appendChild(_createTotalsCol('Расходы', totals.expense.totalBase, baseCurrency, 'text-expense'));
  totalsGrid.appendChild(_createTotalsCol('Разница', totals.diff.totalBase, baseCurrency, ''));

  totalsCard.appendChild(totalsGrid);

  const note = document.createElement('div');
  note.className = 'totals-note';
  note.textContent = 'без долговых операций';
  totalsCard.appendChild(note);

  listContainer.appendChild(totalsCard);

  // === Список ===
  const sorted = filtered.sort((a, b) =>
    compareDatesDesc(a.date || a.created_at, b.date || b.created_at)
  );

  const list = document.createElement('div');
  list.className = 'ops-list';

  const opsToShow = sorted.slice(0, shownCount);

  if (opsToShow.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder-text';
    empty.textContent = 'Нет операций';
    list.appendChild(empty);
  }

  let currentDate = '';
  for (const op of opsToShow) {
    const opDate = op.date || '';
    if (opDate !== currentDate) {
      currentDate = opDate;
      const dh = document.createElement('div');
      dh.className = 'date-header';
      dh.textContent = formatDate(opDate);
      list.appendChild(dh);
    }
    list.appendChild(_createOpItem(op, container, settings));
  }

  listContainer.appendChild(list);

  // «Показать ещё»
  if (sorted.length > shownCount) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-more';
    btn.textContent = `Показать ещё (${sorted.length - shownCount})`;
    btn.addEventListener('click', () => {
      shownCount += pageSize;
      _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories);
    });
    listContainer.appendChild(btn);
  }
}

// ============================================================
//  КАРТОЧКА ОПЕРАЦИИ (модальное окно)
// ============================================================

function _openOpCard(op, container, settings) {
  const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);
  const catKey = op.type === 'income' ? 'categories_income' : 'categories_expense';
  const categories = _getSettingJSON(settings, catKey, []);

  const isDebtOp = !!op.debt_id;

  // Создаём модальное окно
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-wide';

  // Заголовок
  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = op.type === 'income' ? 'Доход' : 'Расход';
  dialog.appendChild(title);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  // Сумма (не редактируется для долговых)
  const amountGroup = _createFieldGroup('Сумма', 'number', 'edit-amount', {
    value: op.amount,
    inputmode: 'decimal',
    step: '0.01',
    min: '0.01',
    readOnly: isDebtOp
  });
  form.appendChild(amountGroup);

  // Валюта (не для долговых)
  const curGroup = document.createElement('div');
  curGroup.className = 'form-group';
  const curLabel = document.createElement('label');
  curLabel.textContent = 'Валюта';
  curGroup.appendChild(curLabel);
  const curChips = document.createElement('div');
  curChips.className = 'currency-chips';
  let selectedCurrency = op.currency;

  for (const cur of currencies) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'currency-chip' + (cur === selectedCurrency ? ' active' : '');
    if (isDebtOp) chip.disabled = true;
    chip.textContent = cur;
    chip.addEventListener('click', () => {
      if (isDebtOp) return;
      selectedCurrency = cur;
      curChips.querySelectorAll('.currency-chip').forEach(c =>
        c.classList.toggle('active', c.textContent === cur)
      );
    });
    curChips.appendChild(chip);
  }
  curGroup.appendChild(curChips);
  form.appendChild(curGroup);

  // Дата
  form.appendChild(_createFieldGroup('Дата', 'date', 'edit-date', { value: op.date || '' }));

  // Контрагент
  const cpLabel = op.type === 'income' ? 'От кого' : 'Кому';
  form.appendChild(_createFieldGroup(cpLabel, 'text', 'edit-counterparty', { value: op.counterparty || '' }));

  // За что
  form.appendChild(_createFieldGroup('За что', 'text', 'edit-purpose', { value: op.purpose || '' }));

  // Категория
  const catGroup = document.createElement('div');
  catGroup.className = 'form-group';
  const catLabel = document.createElement('label');
  catLabel.textContent = 'Категория';
  catGroup.appendChild(catLabel);
  const catSelect = document.createElement('select');
  catSelect.name = 'edit-category';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '— не выбрана —';
  catSelect.appendChild(emptyOpt);
  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === op.category) opt.selected = true;
    catSelect.appendChild(opt);
  }
  catGroup.appendChild(catSelect);
  form.appendChild(catGroup);

  // Примечание
  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'Примечание';
  noteGroup.appendChild(noteLabel);
  const noteArea = document.createElement('textarea');
  noteArea.name = 'edit-note';
  noteArea.rows = 2;
  noteArea.value = op.note || '';
  noteGroup.appendChild(noteArea);
  form.appendChild(noteGroup);

  // Ссылка на долг
  if (isDebtOp) {
    const debtHint = document.createElement('div');
    debtHint.className = 'field-hint text-warning';
    debtHint.textContent = 'Эта операция привязана к долгу. Сумма, валюта и тип не редактируются здесь.';
    form.appendChild(debtHint);
  }

  dialog.appendChild(form);

  // Кнопки
  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  // Удалить
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = 'Удалить';
  delBtn.addEventListener('click', async () => {
    if (!confirm('Удалить эту операцию?')) return;
    op.deleted = true;
    op.updated_at = new Date().toISOString();
    await put('ops', op);
    await addToOutbox({ sheet: 'ops', data: op });
    scheduleSyncAfterChange();
    showToast('Операция удалена');
    _closeModal(overlay);
    window.dispatchEvent(new CustomEvent('sync-done'));
  });
  btnGroup.appendChild(delBtn);

  // Сохранить
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Сохранить';
  saveBtn.addEventListener('click', async () => {
    const amount = parseFloat(form.querySelector('[name="edit-amount"]').value);
    if (!amount || amount <= 0) {
      showToast('Введите корректную сумму');
      return;
    }
    op.amount = isDebtOp ? op.amount : amount;
    op.currency = isDebtOp ? op.currency : selectedCurrency;
    op.date = form.querySelector('[name="edit-date"]').value;
    op.counterparty = form.querySelector('[name="edit-counterparty"]').value.trim();
    op.purpose = form.querySelector('[name="edit-purpose"]').value.trim();
    op.category = form.querySelector('[name="edit-category"]').value;
    op.note = form.querySelector('[name="edit-note"]').value.trim();
    op.updated_at = new Date().toISOString();

    await put('ops', op);
    await addToOutbox({ sheet: 'ops', data: op });
    scheduleSyncAfterChange();
    showToast('Сохранено');
    _closeModal(overlay);
    window.dispatchEvent(new CustomEvent('sync-done'));
  });
  btnGroup.appendChild(saveBtn);

  dialog.appendChild(btnGroup);

  // Крестик закрытия
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.addEventListener('click', () => _closeModal(overlay));
  dialog.appendChild(closeBtn);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _closeModal(overlay);
  });
  document.body.appendChild(overlay);
  overlay.offsetHeight;
  overlay.classList.add('visible');
}

function _closeModal(overlay) {
  overlay.classList.remove('visible');
  setTimeout(() => overlay.remove(), 300);
}

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ
// ============================================================

function _createOpItem(op, container, settings) {
  const item = document.createElement('div');
  item.className = 'op-item';

  const indicator = document.createElement('span');
  indicator.className = op.type === 'income' ? 'op-indicator text-income' : 'op-indicator text-expense';
  indicator.textContent = op.type === 'income' ? '+' : '−';
  item.appendChild(indicator);

  const info = document.createElement('div');
  info.className = 'op-info';

  const amountEl = document.createElement('span');
  amountEl.className = 'op-amount amount';
  amountEl.textContent = `${fmtAmount.format(parseFloat(op.amount) || 0)} ${op.currency}`;
  info.appendChild(amountEl);

  const descParts = [op.counterparty, op.purpose].filter(Boolean);
  if (descParts.length > 0) {
    const desc = document.createElement('span');
    desc.className = 'op-desc';
    desc.textContent = descParts.join(' · ');
    info.appendChild(desc);
  }

  if (op.category) {
    const cat = document.createElement('span');
    cat.className = 'op-category';
    cat.textContent = op.category;
    info.appendChild(cat);
  }

  item.appendChild(info);

  if (op.debt_id) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'долг';
    item.appendChild(badge);
  }
  if (op.order_id) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-order';
    badge.textContent = 'заказ';
    item.appendChild(badge);
  }

  // Тап → карточка операции
  item.addEventListener('click', () => _openOpCard(op, container, settings));

  return item;
}

function _createTotalsCol(label, value, currency, colorClass) {
  const col = document.createElement('div');
  col.className = 'totals-col';
  const lbl = document.createElement('div');
  lbl.className = 'totals-label';
  lbl.textContent = label;
  col.appendChild(lbl);
  const amt = document.createElement('div');
  amt.className = `totals-amount amount ${colorClass}`;
  amt.textContent = `${fmtAmount.format(value)} ${currency}`;
  col.appendChild(amt);
  return col;
}

function _addChipGroup(container, items, activeKey, onClick) {
  for (const item of items) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (activeKey === item.key ? ' active' : '');
    chip.textContent = item.label;
    chip.addEventListener('click', () => onClick(item.key));
    container.appendChild(chip);
  }
}

function _createFieldGroup(label, type, name, attrs = {}) {
  const group = document.createElement('div');
  group.className = 'form-group';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  group.appendChild(lbl);
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'readOnly') { input.readOnly = v; if (v) input.className = 'input-readonly'; }
    else if (k === 'required') input.required = v;
    else input.setAttribute(k, v);
  }
  group.appendChild(input);
  return group;
}

function _getSetting(settings, key, def) {
  const s = settings.find(s => s.key === key);
  return s ? s.value : def;
}

function _getSettingJSON(settings, key, def) {
  const s = settings.find(s => s.key === key);
  if (!s) return def;
  try { return JSON.parse(s.value); }
  catch { return def; }
}
