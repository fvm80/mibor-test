// ops.js — Страница операций (#/ops)
// Список по датам, фильтры, итоги периода

import { getActiveData } from '../db.js';
import { calcIncomeExpenseTotals } from '../calc.js';
import { getEffectiveRate } from '../rates.js';

const fmtAmount = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const fmtDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric'
});

// Текущие фильтры
let currentFilters = {
  period: 'month', // 'week', 'month', 'all'
  type: 'all',     // 'all', 'income', 'expense'
  currency: 'all'
};

let pageSize = 50;
let shownCount = 50;

/**
 * Отрисовать страницу операций
 * @param {HTMLElement} container
 */
export async function renderOps(container) {
  if (!container) return;
  container.innerHTML = '';
  shownCount = pageSize;

  try {
    const data = await getActiveData();
    const { ops, rates, settings } = data;

    const baseSetting = settings.find(s => s.key === 'base_currency');
    const baseCurrency = baseSetting ? baseSetting.value : 'MDL';

    const curSetting = settings.find(s => s.key === 'currencies');
    const currencies = curSetting ? JSON.parse(curSetting.value) : ['MDL', 'USD', 'EUR'];

    // === Фильтры ===
    const filtersRow = document.createElement('div');
    filtersRow.className = 'filters-row';

    // Фильтр периода
    const periods = [
      { key: 'week', label: 'Неделя' },
      { key: 'month', label: 'Месяц' },
      { key: 'all', label: 'Всё' }
    ];

    for (const p of periods) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (currentFilters.period === p.key ? ' active' : '');
      chip.textContent = p.label;
      chip.addEventListener('click', () => {
        currentFilters.period = p.key;
        renderOps(container);
      });
      filtersRow.appendChild(chip);
    }

    // Фильтр типа
    const types = [
      { key: 'all', label: 'Все' },
      { key: 'income', label: 'Доходы' },
      { key: 'expense', label: 'Расходы' }
    ];

    for (const t of types) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (currentFilters.type === t.key ? ' active' : '');
      chip.textContent = t.label;
      chip.addEventListener('click', () => {
        currentFilters.type = t.key;
        renderOps(container);
      });
      filtersRow.appendChild(chip);
    }

    // Фильтр валюты
    const curChips = [{ key: 'all', label: 'Все' }, ...currencies.map(c => ({ key: c, label: c }))];
    for (const c of curChips) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (currentFilters.currency === c.key ? ' active' : '');
      chip.textContent = c.label;
      chip.addEventListener('click', () => {
        currentFilters.currency = c.key;
        renderOps(container);
      });
      filtersRow.appendChild(chip);
    }

    container.appendChild(filtersRow);

    // === Фильтрация операций ===
    let filteredOps = [...ops];

    // По периоду
    const now = new Date();
    if (currentFilters.period === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekStr = weekAgo.toISOString().slice(0, 10);
      filteredOps = filteredOps.filter(op => (op.date || '') >= weekStr);
    } else if (currentFilters.period === 'month') {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      const monthStr = monthAgo.toISOString().slice(0, 10);
      filteredOps = filteredOps.filter(op => (op.date || '') >= monthStr);
    }

    // По типу
    if (currentFilters.type !== 'all') {
      filteredOps = filteredOps.filter(op => op.type === currentFilters.type);
    }

    // По валюте
    if (currentFilters.currency !== 'all') {
      filteredOps = filteredOps.filter(op => op.currency === currentFilters.currency);
    }

    // === Итоги периода ===
    const totals = calcIncomeExpenseTotals(filteredOps, rates, baseCurrency);

    const totalsCard = document.createElement('div');
    totalsCard.className = 'card totals-card';

    const totalsGrid = document.createElement('div');
    totalsGrid.className = 'totals-grid';

    // Доходы
    const incomeCol = document.createElement('div');
    incomeCol.className = 'totals-col';
    const incLabel = document.createElement('div');
    incLabel.className = 'totals-label';
    incLabel.textContent = 'Доходы';
    incomeCol.appendChild(incLabel);
    const incAmount = document.createElement('div');
    incAmount.className = 'totals-amount text-income amount';
    incAmount.textContent = `${fmtAmount.format(totals.income.totalBase)} ${baseCurrency}`;
    incomeCol.appendChild(incAmount);
    totalsGrid.appendChild(incomeCol);

    // Расходы
    const expenseCol = document.createElement('div');
    expenseCol.className = 'totals-col';
    const expLabel = document.createElement('div');
    expLabel.className = 'totals-label';
    expLabel.textContent = 'Расходы';
    expenseCol.appendChild(expLabel);
    const expAmount = document.createElement('div');
    expAmount.className = 'totals-amount text-expense amount';
    expAmount.textContent = `${fmtAmount.format(totals.expense.totalBase)} ${baseCurrency}`;
    expenseCol.appendChild(expAmount);
    totalsGrid.appendChild(expenseCol);

    // Разница
    const diffCol = document.createElement('div');
    diffCol.className = 'totals-col';
    const diffLabel = document.createElement('div');
    diffLabel.className = 'totals-label';
    diffLabel.textContent = 'Разница';
    diffCol.appendChild(diffLabel);
    const diffAmount = document.createElement('div');
    diffAmount.className = 'totals-amount amount';
    diffAmount.textContent = `${fmtAmount.format(totals.diff.totalBase)} ${baseCurrency}`;
    diffCol.appendChild(diffAmount);
    totalsGrid.appendChild(diffCol);

    totalsCard.appendChild(totalsGrid);

    const totalsNote = document.createElement('div');
    totalsNote.className = 'totals-note';
    totalsNote.textContent = 'без долговых операций';
    totalsCard.appendChild(totalsNote);

    container.appendChild(totalsCard);

    // === Список операций ===
    const sortedOps = filteredOps.sort((a, b) =>
      (b.date || b.created_at || '').localeCompare(a.date || a.created_at || '')
    );

    const list = document.createElement('div');
    list.className = 'ops-list';

    let currentDate = '';
    const opsToShow = sortedOps.slice(0, shownCount);

    if (opsToShow.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = 'Нет операций за выбранный период';
      list.appendChild(empty);
    }

    for (const op of opsToShow) {
      const opDate = op.date || '';

      // Заголовок даты
      if (opDate !== currentDate) {
        currentDate = opDate;
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        try {
          dateHeader.textContent = fmtDate.format(new Date(opDate + 'T00:00:00'));
        } catch {
          dateHeader.textContent = opDate;
        }
        list.appendChild(dateHeader);
      }

      // Элемент операции
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

      // Метки
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

      // Тап — пока простое отображение
      item.addEventListener('click', () => {
        const details = [
          `Тип: ${op.type === 'income' ? 'Доход' : 'Расход'}`,
          `Сумма: ${op.amount} ${op.currency}`,
          `Дата: ${op.date}`,
          op.counterparty ? `Контрагент: ${op.counterparty}` : '',
          op.purpose ? `За что: ${op.purpose}` : '',
          op.category ? `Категория: ${op.category}` : '',
          op.note ? `Примечание: ${op.note}` : ''
        ].filter(Boolean).join('\n');
        alert(details);
      });

      list.appendChild(item);
    }

    container.appendChild(list);

    // Кнопка «Показать ещё»
    if (sortedOps.length > shownCount) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'btn btn-secondary btn-more';
      moreBtn.textContent = `Показать ещё (${sortedOps.length - shownCount})`;
      moreBtn.addEventListener('click', () => {
        shownCount += pageSize;
        renderOps(container);
      });
      container.appendChild(moreBtn);
    }

  } catch (err) {
    console.error('Ошибка отрисовки операций:', err);
    const errorEl = document.createElement('p');
    errorEl.className = 'placeholder-text';
    errorEl.textContent = 'Ошибка загрузки данных';
    container.appendChild(errorEl);
  }
}
