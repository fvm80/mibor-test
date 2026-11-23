// ops.js — Страница операций (#/ops)
// Список по датам, фильтры, итоги, карточка редактирования, поиск

import { getActiveData, put, addToOutbox } from '../db.js';
import { calcIncomeExpenseTotals } from '../calc.js';
import { scheduleSyncAfterChange } from '../sync.js';
import { showToast } from './toast.js';
import { formatDate, compareDatesDesc } from '../dates.js';
import { navigate, getCurrentHash, isCurrentRender, nextRenderSeq } from '../router.js';

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
 * @param {HTMLElement} container
 * @param {number} [renderId]
 */
export async function renderOps(container, renderId) {
  if (!container) return;
  const thisRender = renderId || nextRenderSeq();
  shownCount = pageSize;

  try {
    const data = await getActiveData();
    if (!isCurrentRender(thisRender)) return;
    if (getCurrentHash() !== '#/ops') return;

    const { ops, rates, settings, orders } = data;

    const baseCurrency = _getSetting(settings, 'base_currency', 'MDL');
    const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);
    const catExpense = _getSettingJSON(settings, 'categories_expense', []);
    const catIncome = _getSettingJSON(settings, 'categories_income', []);
    const allCategories = [...new Set([...catIncome, ...catExpense])];

    const fragment = document.createDocumentFragment();

    // === Поиск ===
    const searchRow = document.createElement('div');
    searchRow.className = 'search-row';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Поиск по контрагенту, описанию...';
    searchInput.value = filters.search;
    searchInput.addEventListener('input', () => {
      filters.search = searchInput.value;
      _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories, orders);
    });
    searchRow.appendChild(searchInput);
    fragment.appendChild(searchRow);

    // === Фильтры: 4 компактные кнопки в один ряд с выпадающими списками ===
    const filterDefs = [
      {
        id: 'period',
        title: 'Период',
        options: [
          { key: 'week', label: 'Неделя' },
          { key: 'month', label: 'Месяц' },
          { key: 'all', label: 'Всё' }
        ],
        isActive: () => filters.period !== 'all',
        getCurrentLabel: () => {
          if (filters.period === 'week') return 'Неделя';
          if (filters.period === 'month') return 'Месяц';
          return 'Всё';
        }
      },
      {
        id: 'type',
        title: 'Тип опер.',
        options: [
          { key: 'all', label: 'Все' },
          { key: 'income', label: 'Доходы' },
          { key: 'expense', label: 'Расходы' }
        ],
        isActive: () => filters.type !== 'all',
        getCurrentLabel: () => {
          if (filters.type === 'income') return 'Доходы';
          if (filters.type === 'expense') return 'Расходы';
          return 'Все';
        }
      },
      {
        id: 'currency',
        title: 'Валюта',
        options: [
          { key: 'all', label: 'Все' },
          ...currencies.map(c => ({ key: c, label: c }))
        ],
        isActive: () => filters.currency !== 'all',
        getCurrentLabel: () => filters.currency === 'all' ? 'Все' : filters.currency
      },
      {
        id: 'category',
        title: 'Категория',
        options: [
          { key: 'all', label: 'Все' },
          ...allCategories.map(c => ({ key: c, label: c }))
        ],
        isActive: () => filters.category !== 'all',
        getCurrentLabel: () => filters.category === 'all' ? 'Все' : filters.category
      }
    ];

    const filterBarContainer = document.createElement('div');
    filterBarContainer.className = 'filter-bar-container';

    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar-4';

    const dropdownPanel = document.createElement('div');
    dropdownPanel.className = 'filter-dropdown-panel';
    dropdownPanel.style.display = 'none';

    let openFilterId = null;
    const buttonEls = {};

    function updateFilterButtonsUI() {
      for (const def of filterDefs) {
        const btn = buttonEls[def.id];
        if (!btn) continue;
        const active = def.isActive();
        btn.classList.toggle('is-active', active);
        btn.classList.toggle('is-open', openFilterId === def.id);
        const valEl = btn.querySelector('.filter-btn-value');
        if (valEl) valEl.textContent = def.getCurrentLabel();
      }
    }

    function closeFilterDropdown() {
      openFilterId = null;
      dropdownPanel.style.display = 'none';
      dropdownPanel.innerHTML = '';
      updateFilterButtonsUI();
    }

    function toggleFilterDropdown(def) {
      if (openFilterId === def.id) {
        closeFilterDropdown();
        return;
      }
      openFilterId = def.id;
      dropdownPanel.innerHTML = '';

      for (const opt of def.options) {
        const isSelected = filters[def.id] === opt.key;
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'filter-option' + (isSelected ? ' is-selected' : '');

        const optText = document.createElement('span');
        optText.textContent = opt.label;
        optBtn.appendChild(optText);

        if (isSelected) {
          const check = document.createElement('span');
          check.className = 'filter-option-check';
          check.textContent = '✓';
          optBtn.appendChild(check);
        }

        optBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          filters[def.id] = opt.key;
          closeFilterDropdown();
          _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories, orders);
        });

        dropdownPanel.appendChild(optBtn);
      }

      dropdownPanel.style.display = 'block';
      updateFilterButtonsUI();
    }

    // Создаём 4 кнопки в один ряд
    for (const def of filterDefs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-btn' + (def.isActive() ? ' is-active' : '');

      const titleEl = document.createElement('span');
      titleEl.className = 'filter-btn-title';
      titleEl.textContent = def.title;
      btn.appendChild(titleEl);

      const valEl = document.createElement('span');
      valEl.className = 'filter-btn-value';
      valEl.textContent = def.getCurrentLabel();
      btn.appendChild(valEl);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFilterDropdown(def);
      });

      buttonEls[def.id] = btn;
      filterBar.appendChild(btn);
    }

    filterBarContainer.appendChild(filterBar);
    filterBarContainer.appendChild(dropdownPanel);

    // Закрытие при клике снаружи
    const onDocClick = (e) => {
      if (!filterBarContainer.contains(e.target)) {
        closeFilterDropdown();
      }
    };
    document.addEventListener('click', onDocClick);

    fragment.appendChild(filterBarContainer);

    // === Контейнер для списка (обновляется при фильтрации) ===
    const listContainer = document.createElement('div');
    listContainer.id = 'ops-list-container';
    fragment.appendChild(listContainer);

    _renderList(fragment, ops, rates, settings, baseCurrency, currencies, allCategories, orders);

    if (!isCurrentRender(thisRender)) return;
    if (getCurrentHash() !== '#/ops') return;

    container.innerHTML = '';
    container.appendChild(fragment);

  } catch (err) {
    if (!isCurrentRender(thisRender)) return;
    if (getCurrentHash() !== '#/ops') return;
    console.error('Ошибка отрисовки операций:', err);
    container.innerHTML = '';
    const errorEl = document.createElement('p');
    errorEl.className = 'placeholder-text';
    errorEl.textContent = 'Ошибка загрузки данных';
    container.appendChild(errorEl);
  }
}

/**
 * Отрисовать список с учётом фильтров (без перерисовки фильтров)
 */
function _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories, orders = []) {
  const listContainer = (container && container.querySelector ? container.querySelector('#ops-list-container') : null) || document.getElementById('ops-list-container');
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

  totalsGrid.appendChild(_createTotalsCol('Доходы', totals.income.totalBase, baseCurrency, 'income'));
  totalsGrid.appendChild(_createTotalsCol('Расходы', totals.expense.totalBase, baseCurrency, 'expense'));
  totalsGrid.appendChild(_createTotalsCol('Разница', totals.diff.totalBase, baseCurrency, 'diff', totals.diff.totalBase >= 0 ? 'text-income' : 'text-expense'));

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
    list.appendChild(_createOpItem(op, container, settings, orders));
  }

  listContainer.appendChild(list);

  // «Показать ещё»
  if (sorted.length > shownCount) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-more';
    btn.textContent = `Показать ещё (${sorted.length - shownCount})`;
    btn.addEventListener('click', () => {
      shownCount += pageSize;
      _renderList(container, ops, rates, settings, baseCurrency, currencies, allCategories, orders);
    });
    listContainer.appendChild(btn);
  }
}

// ============================================================
//  КАРТОЧКА ОПЕРАЦИИ (модальное окно)
// ============================================================

function _openOpCard(op, container, settings, orders = []) {
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
    debtHint.className = 'field-hint text-warning mb-8';
    debtHint.style.cursor = 'pointer';
    debtHint.textContent = '🤝 Привязано к долгу. Нажмите, чтобы открыть раздел долгов.';
    debtHint.addEventListener('click', () => {
      _closeModal(overlay);
      navigate('#/debts');
    });
    form.appendChild(debtHint);
  }

  // Ссылка на заказ
  if (op.order_id) {
    const orderObj = (orders || []).find(o => o.id === op.order_id);
    const orderHint = document.createElement('div');
    orderHint.className = 'field-hint text-primary mb-8';
    orderHint.style.cursor = 'pointer';
    orderHint.textContent = `📦 Привязано к заказу: "${orderObj ? orderObj.name : op.order_id}". Нажмите для перехода.`;
    orderHint.addEventListener('click', () => {
      _closeModal(overlay);
      navigate(`#/orders/${op.order_id}`);
    });
    form.appendChild(orderHint);
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

function _createOpItem(op, container, settings, orders = []) {
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
    const orderObj = (orders || []).find(o => o.id === op.order_id);
    const badge = document.createElement('span');
    badge.className = 'badge badge-order';
    badge.textContent = orderObj ? `заказ: ${orderObj.name}` : 'заказ';
    item.appendChild(badge);
  }

  // Тап → карточка операции
  item.addEventListener('click', () => _openOpCard(op, container, settings, orders));

  return item;
}

function _createTotalsCol(label, value, currency, type, diffClass = '') {
  const col = document.createElement('div');
  col.className = `totals-col totals-col-${type}`;
  const lbl = document.createElement('div');
  lbl.className = 'totals-label';
  lbl.textContent = label;
  col.appendChild(lbl);
  const amt = document.createElement('div');
  amt.className = `totals-amount amount ${diffClass}`.trim();
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
