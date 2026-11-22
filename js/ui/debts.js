// debts.js — Страница «Долги» (#/debts)
// Вкладки: Мне должны / Я должен. Создание с cash_moved, погашение, списание, карточка долга

import { getActiveData, put, addToOutbox, getAll } from '../db.js';
import { calcDebtRemainder, calcDebtsTotal } from '../calc.js';
import { getEffectiveRate } from '../rates.js';
import { scheduleSyncAfterChange } from '../sync.js';
import { showToast } from './toast.js';
import { formatDate, isDateBeforeToday, compareDatesDesc, getTodayDateString } from '../dates.js';

const fmtAmount = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

// Текущее состояние экрана долгов
let currentDirection = 'owed_to_me'; // 'owed_to_me' | 'i_owe'
let currentFilter = 'open';          // 'open' | 'all'

/**
 * Отрисовать страницу «Долги»
 * @param {HTMLElement} container
 */
export async function renderDebts(container) {
  if (!container) return;
  container.innerHTML = '';

  try {
    const data = await getActiveData();
    const { debts, ops, rates, settings } = data;

    const baseCurrency = _getSetting(settings, 'base_currency', 'MDL');
    const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);

    // === Переключатель направления (Мне должны / Я должен) ===
    const dirSwitch = document.createElement('div');
    dirSwitch.className = 'type-switch mb-12';

    const owedToMeBtn = document.createElement('button');
    owedToMeBtn.type = 'button';
    owedToMeBtn.className = 'type-btn' + (currentDirection === 'owed_to_me' ? ' active income' : '');
    owedToMeBtn.textContent = 'Мне должны';
    owedToMeBtn.addEventListener('click', () => {
      currentDirection = 'owed_to_me';
      renderDebts(container);
    });
    dirSwitch.appendChild(owedToMeBtn);

    const iOweBtn = document.createElement('button');
    iOweBtn.type = 'button';
    iOweBtn.className = 'type-btn' + (currentDirection === 'i_owe' ? ' active expense' : '');
    iOweBtn.textContent = 'Я должен';
    iOweBtn.addEventListener('click', () => {
      currentDirection = 'i_owe';
      renderDebts(container);
    });
    dirSwitch.appendChild(iOweBtn);

    container.appendChild(dirSwitch);

    // === Сводка по выбранному направлению ===
    const debtsTotal = calcDebtsTotal(debts, ops, rates, currentDirection, baseCurrency);

    const summaryCard = document.createElement('div');
    summaryCard.className = 'card main-card mb-12';

    const sumLabel = document.createElement('div');
    sumLabel.className = 'card-label';
    sumLabel.textContent = currentDirection === 'owed_to_me' ? 'Всего мне должны' : 'Всего я должен';
    summaryCard.appendChild(sumLabel);

    const sumAmount = document.createElement('div');
    sumAmount.className = 'card-amount amount';
    sumAmount.textContent = `${fmtAmount.format(debtsTotal.totalBase)} ${baseCurrency}`;
    summaryCard.appendChild(sumAmount);

    // Разбивка по валютам
    const curParts = [];
    for (const [cur, amt] of Object.entries(debtsTotal.byCurrency)) {
      if (amt > 0) {
        curParts.push(`${cur} ${fmtAmount.format(amt)}`);
      }
    }
    if (curParts.length > 0) {
      const curSub = document.createElement('div');
      curSub.className = 'card-sublabel';
      curSub.textContent = curParts.join(' · ');
      summaryCard.appendChild(curSub);
    }

    container.appendChild(summaryCard);

    // === Панель управления: Фильтр и кнопка «+ Новый долг» ===
    const controlRow = document.createElement('div');
    controlRow.className = 'debts-control-row';

    const filterGroup = document.createElement('div');
    filterGroup.className = 'chips-row';

    const openChip = document.createElement('button');
    openChip.type = 'button';
    openChip.className = 'chip' + (currentFilter === 'open' ? ' active' : '');
    openChip.textContent = 'Открытые';
    openChip.addEventListener('click', () => {
      currentFilter = 'open';
      renderDebts(container);
    });
    filterGroup.appendChild(openChip);

    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'chip' + (currentFilter === 'all' ? ' active' : '');
    allChip.textContent = 'Все (с закрытыми)';
    allChip.addEventListener('click', () => {
      currentFilter = 'all';
      renderDebts(container);
    });
    filterGroup.appendChild(allChip);

    controlRow.appendChild(filterGroup);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.textContent = '+ Новый долг';
    addBtn.addEventListener('click', () => {
      _openNewDebtDialog(currentDirection, settings, data, container);
    });
    controlRow.appendChild(addBtn);

    container.appendChild(controlRow);

    // === Список долгов ===
    const list = document.createElement('div');
    list.className = 'debts-list';

    // Фильтруем долги по направлению и статусу
    let filteredDebts = debts.filter(d => d.direction === currentDirection);

    if (currentFilter === 'open') {
      filteredDebts = filteredDebts.filter(d => {
        if (d.status === 'closed' || d.status === 'written_off') return false;
        const remainder = calcDebtRemainder(d, ops);
        return remainder > 0;
      });
    }

    // Сортировка: сначала просроченные, затем по дате
    filteredDebts.sort((a, b) => {
      const aOverdue = a.status === 'open' && isDateBeforeToday(a.due_date);
      const bOverdue = b.status === 'open' && isDateBeforeToday(b.due_date);
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      return compareDatesDesc(a.date, b.date);
    });

    if (filteredDebts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = currentFilter === 'open'
        ? (currentDirection === 'owed_to_me' ? 'Никто вам не должен' : 'У вас нет долгов')
        : 'Нет записей в истории долгов';
      list.appendChild(empty);
    } else {
      for (const debt of filteredDebts) {
        list.appendChild(_createDebtItem(debt, ops, rates, settings, data, container));
      }
    }

    container.appendChild(list);

  } catch (err) {
    console.error('Ошибка отрисовки долгов:', err);
    container.innerHTML = '';
    const errEl = document.createElement('p');
    errEl.className = 'placeholder-text';
    errEl.textContent = 'Ошибка загрузки данных';
    container.appendChild(errEl);
  }
}

// ============================================================
//  ЭЛЕМЕНТ СПИСКА ДОЛГОВ
// ============================================================

function _createDebtItem(debt, ops, rates, settings, fullData, pageContainer) {
  const item = document.createElement('div');
  item.className = 'debt-item card';

  const remainder = calcDebtRemainder(debt, ops);
  const totalAmount = parseFloat(debt.amount) || 0;

  const isOverdue = debt.status === 'open' && isDateBeforeToday(debt.due_date);
  const isClosed = debt.status === 'closed' || (debt.status !== 'written_off' && remainder <= 0);
  const isWrittenOff = debt.status === 'written_off';
  const isPartial = !isClosed && !isWrittenOff && remainder < totalAmount;

  // Верхняя строка: контрагент + статус
  const topRow = document.createElement('div');
  topRow.className = 'debt-top-row';

  const cpSpan = document.createElement('span');
  cpSpan.className = 'debt-counterparty';
  cpSpan.textContent = debt.counterparty || 'Без имени';
  topRow.appendChild(cpSpan);

  // Бейдж статуса
  const badge = document.createElement('span');
  if (isWrittenOff) {
    badge.className = 'badge';
    badge.textContent = 'списан';
  } else if (isClosed) {
    badge.className = 'badge badge-primary';
    badge.textContent = 'закрыт';
  } else if (isOverdue) {
    badge.className = 'badge badge-expense';
    badge.textContent = 'просрочен';
  } else if (isPartial) {
    badge.className = 'badge badge-warning';
    badge.textContent = 'частично';
  } else {
    badge.className = 'badge badge-income';
    badge.textContent = 'открыт';
  }
  topRow.appendChild(badge);
  item.appendChild(topRow);

  // Описание / назначение
  if (debt.purpose) {
    const purposeEl = document.createElement('div');
    purposeEl.className = 'debt-purpose';
    purposeEl.textContent = debt.purpose;
    item.appendChild(purposeEl);
  }

  // Финансовая строка: Остаток / Исходная сумма
  const amountRow = document.createElement('div');
  amountRow.className = 'debt-amount-row';

  const remSpan = document.createElement('span');
  remSpan.className = 'debt-remainder amount';
  remSpan.textContent = isClosed ? `0,00 ${debt.currency}` : `${fmtAmount.format(remainder)} ${debt.currency}`;
  amountRow.appendChild(remSpan);

  if (remainder < totalAmount || isClosed || isWrittenOff) {
    const origSpan = document.createElement('span');
    origSpan.className = 'debt-original amount';
    origSpan.textContent = `из ${fmtAmount.format(totalAmount)} ${debt.currency}`;
    amountRow.appendChild(origSpan);
  }

  item.appendChild(amountRow);

  // Нижняя строка: даты
  const dateRow = document.createElement('div');
  dateRow.className = 'debt-date-row';

  const createdDateStr = formatDate(debt.date);
  const dateText = document.createElement('span');
  dateText.textContent = `Выдан: ${createdDateStr}`;
  dateRow.appendChild(dateText);

  if (debt.due_date) {
    const dueDateEl = document.createElement('span');
    dueDateEl.className = isOverdue ? 'text-expense' : '';
    dueDateEl.textContent = `Срок: ${formatDate(debt.due_date)}`;
    dateRow.appendChild(dueDateEl);
  }

  item.appendChild(dateRow);

  // Тап открывает карточку долга
  item.addEventListener('click', () => {
    _openDebtCard(debt, ops, rates, settings, fullData, pageContainer);
  });

  return item;
}

// ============================================================
//  КАРТОЧКА ДОЛГА (Модальное окно с историей и действиями)
// ============================================================

function _openDebtCard(debt, ops, rates, settings, fullData, pageContainer) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-wide';

  const remainder = calcDebtRemainder(debt, ops);
  const totalAmount = parseFloat(debt.amount) || 0;
  const isClosed = debt.status === 'closed' || (debt.status !== 'written_off' && remainder <= 0);
  const isWrittenOff = debt.status === 'written_off';

  // Заголовок
  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = debt.direction === 'owed_to_me' ? 'Мне должны' : 'Я должен';
  dialog.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'modal-subtitle';
  sub.textContent = `${debt.counterparty || 'Без имени'} · ${debt.purpose || 'Без описания'}`;
  dialog.appendChild(sub);

  // Плашка остатка
  const cardSummary = document.createElement('div');
  cardSummary.className = 'debt-card-stat';

  const remLabel = document.createElement('div');
  remLabel.className = 'stat-label';
  remLabel.textContent = 'Остаток к возврату';
  cardSummary.appendChild(remLabel);

  const remVal = document.createElement('div');
  remVal.className = 'stat-val amount';
  remVal.textContent = isClosed ? `0,00 ${debt.currency}` : `${fmtAmount.format(remainder)} ${debt.currency}`;
  cardSummary.appendChild(remVal);

  const origInfo = document.createElement('div');
  origInfo.className = 'stat-sub';
  origInfo.textContent = `Начальная сумма: ${fmtAmount.format(totalAmount)} ${debt.currency}`;
  cardSummary.appendChild(origInfo);

  dialog.appendChild(cardSummary);

  // История операций по этому долгу
  const histTitle = document.createElement('h4');
  histTitle.className = 'section-title mt-16 mb-8';
  histTitle.textContent = 'История движения';
  dialog.appendChild(histTitle);

  const histList = document.createElement('div');
  histList.className = 'debt-history-list';

  // Исходная выдача (principal)
  const principalOp = ops.find(o => o.debt_id === debt.id && o.debt_role === 'principal');
  const initItem = document.createElement('div');
  initItem.className = 'debt-history-item';
  const initText = document.createElement('div');
  initText.textContent = debt.cash_moved ? 'Выдача денег (кассовый расход/доход)' : 'Фиксация обязательства (без движения кассы)';
  const initDate = document.createElement('div');
  initDate.className = 'text-secondary';
  initDate.textContent = formatDate(debt.date);
  initItem.appendChild(initText);
  initItem.appendChild(initDate);
  histList.appendChild(initItem);

  // Все погашения
  const repayments = ops
    .filter(o => o.debt_id === debt.id && o.debt_role === 'repayment')
    .sort((a, b) => compareDatesDesc(a.date, b.date));

  for (const rep of repayments) {
    const repItem = document.createElement('div');
    repItem.className = 'debt-history-item';
    const repInfo = document.createElement('div');
    repInfo.innerHTML = `<strong>Погашение:</strong> ${fmtAmount.format(rep.amount)} ${rep.currency}`;
    if (rep.note) {
      const repNote = document.createElement('div');
      repNote.className = 'text-secondary';
      repNote.textContent = rep.note;
      repInfo.appendChild(repNote);
    }
    const repDate = document.createElement('div');
    repDate.className = 'text-secondary';
    repDate.textContent = formatDate(rep.date);
    repItem.appendChild(repInfo);
    repItem.appendChild(repDate);
    histList.appendChild(repItem);
  }

  dialog.appendChild(histList);

  // Кнопки действий
  const actions = document.createElement('div');
  actions.className = 'modal-buttons flex-col gap-8 mt-16';

  // Погасить (только если есть остаток)
  if (!isClosed && !isWrittenOff && remainder > 0) {
    const repayBtn = document.createElement('button');
    repayBtn.type = 'button';
    repayBtn.className = 'btn btn-primary';
    repayBtn.textContent = 'Погасить';
    repayBtn.addEventListener('click', () => {
      _closeModal(overlay);
      _openRepayDialog(debt, remainder, fullData, pageContainer);
    });
    actions.appendChild(repayBtn);

    const writeOffBtn = document.createElement('button');
    writeOffBtn.type = 'button';
    writeOffBtn.className = 'btn btn-secondary';
    writeOffBtn.textContent = 'Закрыть без оплаты (списать)';
    writeOffBtn.addEventListener('click', async () => {
      if (!confirm(`Списать оставшийся долг ${fmtAmount.format(remainder)} ${debt.currency}? Долг перестанет учитываться в балансах.`)) return;
      debt.status = 'written_off';
      debt.updated_at = new Date().toISOString();
      await put('debts', debt);
      await addToOutbox({ sheet: 'debts', data: debt });
      scheduleSyncAfterChange();
      showToast('Долг списан');
      _closeModal(overlay);
      renderDebts(pageContainer);
    });
    actions.appendChild(writeOffBtn);
  }

  // Удалить
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = 'Удалить долг';
  delBtn.addEventListener('click', async () => {
    if (repayments.length > 0) {
      if (!confirm(`У долга есть ${repayments.length} погашений! При удалении долга все связанные операции погашения также будут удалены. Продолжить?`)) return;
    } else {
      if (!confirm('Удалить этот долг?')) return;
    }

    const now = new Date().toISOString();

    // Мягкое удаление долга
    debt.deleted = true;
    debt.updated_at = now;
    await put('debts', debt);
    await addToOutbox({ sheet: 'debts', data: debt });

    // Мягкое удаление всех связанных операций (principal + repayments)
    const linkedOps = ops.filter(o => o.debt_id === debt.id);
    for (const op of linkedOps) {
      op.deleted = true;
      op.updated_at = now;
      await put('ops', op);
      await addToOutbox({ sheet: 'ops', data: op });
    }

    scheduleSyncAfterChange();
    showToast('Долг удалён');
    _closeModal(overlay);
    renderDebts(pageContainer);
  });
  actions.appendChild(delBtn);

  dialog.appendChild(actions);

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

// ============================================================
//  ДИАЛОГ ПОГАШЕНИЯ ДОЛГА
// ============================================================

function _openRepayDialog(debt, maxRemainder, fullData, pageContainer) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Погашение долга';
  dialog.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'modal-subtitle';
  sub.textContent = `${debt.counterparty || 'Без имени'} (остаток: ${fmtAmount.format(maxRemainder)} ${debt.currency})`;
  dialog.appendChild(sub);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  // Сумма погашения (по умолчанию весь остаток)
  const amountGroup = document.createElement('div');
  amountGroup.className = 'form-group';
  const amtLabel = document.createElement('label');
  amtLabel.textContent = `Сумма погашения (${debt.currency})`;
  amountGroup.appendChild(amtLabel);

  const amtInput = document.createElement('input');
  amtInput.type = 'number';
  amtInput.inputMode = 'decimal';
  amtInput.step = '0.01';
  amtInput.min = '0.01';
  amtInput.max = String(maxRemainder);
  amtInput.value = maxRemainder;
  amountGroup.appendChild(amtInput);
  form.appendChild(amountGroup);

  // Дата погашения
  const todayStr = getTodayDateString();
  const dateGroup = document.createElement('div');
  dateGroup.className = 'form-group';
  const dateLabel = document.createElement('label');
  dateLabel.textContent = 'Дата';
  dateGroup.appendChild(dateLabel);

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = todayStr;
  dateGroup.appendChild(dateInput);
  form.appendChild(dateGroup);

  // Заметка
  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'Примечание (необязательно)';
  noteGroup.appendChild(noteLabel);

  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.placeholder = 'Частичное погашение, перевод на карту и т.д.';
  noteGroup.appendChild(noteInput);
  form.appendChild(noteGroup);

  // Подсказка о влиянии на деньги
  const hint = document.createElement('div');
  hint.className = 'field-hint mb-12';
  hint.textContent = debt.direction === 'owed_to_me'
    ? 'Будет создана операция прихода (касса увеличится). В доходы бизнеса не входит.'
    : 'Будет создана операция расхода (касса уменьшится). В расходы бизнеса не входит.';
  form.appendChild(hint);

  // Кнопки
  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Подтвердить погашение';
  saveBtn.addEventListener('click', async () => {
    const repayAmount = parseFloat(amtInput.value);
    if (!repayAmount || repayAmount <= 0) {
      showToast('Введите корректную сумму');
      return;
    }
    if (repayAmount > maxRemainder + 0.001) {
      showToast(`Сумма не может превышать остаток (${maxRemainder} ${debt.currency})`);
      return;
    }

    const now = new Date().toISOString();

    // 1. Создаём операцию repayment
    const op = {
      id: crypto.randomUUID(),
      type: debt.direction === 'owed_to_me' ? 'income' : 'expense',
      amount: repayAmount,
      currency: debt.currency, // строго в валюте долга
      date: dateInput.value || todayStr,
      counterparty: debt.counterparty || '',
      purpose: `Погашение долга: ${debt.purpose || debt.counterparty || ''}`,
      category: '',
      order_id: debt.order_id || '',
      order_line_id: '',
      debt_id: debt.id,
      debt_role: 'repayment',
      rate_at_entry: '',
      note: noteInput.value.trim(),
      created_at: now,
      updated_at: now,
      deleted: false
    };

    await put('ops', op);
    await addToOutbox({ sheet: 'ops', data: op });

    // 2. Проверяем новый остаток долга
    const newRemainder = Math.round((maxRemainder - repayAmount) * 100) / 100;
    if (newRemainder <= 0) {
      debt.status = 'closed';
    }
    debt.updated_at = now;
    await put('debts', debt);
    await addToOutbox({ sheet: 'debts', data: debt });

    scheduleSyncAfterChange();
    showToast('Погашение сохранено');
    _closeModal(overlay);
    renderDebts(pageContainer);
  });

  btnGroup.appendChild(saveBtn);
  dialog.appendChild(form);
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

// ============================================================
//  ДИАЛОГ СОЗДАНИЯ НОВОГО ДОЛГА
// ============================================================

function _openNewDebtDialog(defaultDirection, settings, fullData, pageContainer) {
  const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);
  const pastCounterparties = [...new Set(fullData.debts.map(d => d.counterparty).filter(Boolean))];
  const pastPurposes = [...new Set(fullData.debts.map(d => d.purpose).filter(Boolean))];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-wide';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Новый долг';
  dialog.appendChild(title);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  // Направление: Мне должны / Я должен
  let selectedDir = defaultDirection;
  const dirSwitch = document.createElement('div');
  dirSwitch.className = 'type-switch mb-12';

  const owedBtn = document.createElement('button');
  owedBtn.type = 'button';
  owedBtn.className = 'type-btn' + (selectedDir === 'owed_to_me' ? ' active income' : '');
  owedBtn.textContent = 'Мне должны';

  const iOweBtn = document.createElement('button');
  iOweBtn.type = 'button';
  iOweBtn.className = 'type-btn' + (selectedDir === 'i_owe' ? ' active expense' : '');
  iOweBtn.textContent = 'Я должен';

  owedBtn.addEventListener('click', () => {
    selectedDir = 'owed_to_me';
    owedBtn.className = 'type-btn active income';
    iOweBtn.className = 'type-btn';
    _updateCashMovedLabels();
  });

  iOweBtn.addEventListener('click', () => {
    selectedDir = 'i_owe';
    iOweBtn.className = 'type-btn active expense';
    owedBtn.className = 'type-btn';
    _updateCashMovedLabels();
  });

  dirSwitch.appendChild(owedBtn);
  dirSwitch.appendChild(iOweBtn);
  form.appendChild(dirSwitch);

  // Контрагент (с подсказками)
  const cpGroup = _fieldGroup('Контрагент (кто)', 'text', 'debt-counterparty', {
    placeholder: 'Имя / компания',
    list: 'dl-debt-cp',
    required: true
  });
  cpGroup.appendChild(_createDatalist('dl-debt-cp', pastCounterparties));
  form.appendChild(cpGroup);

  // Сумма
  const amountGroup = _fieldGroup('Сумма', 'number', 'debt-amount', {
    inputmode: 'decimal',
    step: '0.01',
    min: '0.01',
    placeholder: '0,00',
    required: true
  });
  form.appendChild(amountGroup);

  // Валюта (чипы)
  const curGroup = document.createElement('div');
  curGroup.className = 'form-group';
  const curLabel = document.createElement('label');
  curLabel.textContent = 'Валюта';
  curGroup.appendChild(curLabel);

  const curChips = document.createElement('div');
  curChips.className = 'currency-chips';
  let selectedCurrency = currencies[0];

  for (const cur of currencies) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'currency-chip' + (cur === selectedCurrency ? ' active' : '');
    chip.textContent = cur;
    chip.addEventListener('click', () => {
      selectedCurrency = cur;
      curChips.querySelectorAll('.currency-chip').forEach(c =>
        c.classList.toggle('active', c.textContent === cur)
      );
    });
    curChips.appendChild(chip);
  }
  curGroup.appendChild(curChips);
  form.appendChild(curGroup);

  // Дата выдачи
  const todayStr = getTodayDateString();
  form.appendChild(_fieldGroup('Дата', 'date', 'debt-date', { value: todayStr }));

  // Срок возврата (необязательно)
  form.appendChild(_fieldGroup('Срок возврата (необязательно)', 'date', 'debt-due-date', {}));

  // За что (с подсказками)
  const purposeGroup = _fieldGroup('За что', 'text', 'debt-purpose', {
    placeholder: 'Например: за аренду, переоформление, заём',
    list: 'dl-debt-purpose'
  });
  purposeGroup.appendChild(_createDatalist('dl-debt-purpose', pastPurposes));
  form.appendChild(purposeGroup);

  // ПЕРЕКЛЮЧАТЕЛЬ CASH_MOVED (ТЗ: значения по умолчанию нет, выбор обязателен!)
  const cashMovedBox = document.createElement('div');
  cashMovedBox.className = 'form-group debt-cash-moved-box';

  const cmLabel = document.createElement('label');
  cmLabel.className = 'form-label font-bold';
  cmLabel.textContent = 'Деньги уже двигались? (Обязательный выбор)';
  cashMovedBox.appendChild(cmLabel);

  const cmOptions = document.createElement('div');
  cmOptions.className = 'cash-moved-options';

  let selectedCashMoved = null; // строго null изначально

  const yesBtn = document.createElement('button');
  yesBtn.type = 'button';
  yesBtn.className = 'btn-choice';
  yesBtn.id = 'cm-yes-btn';

  const noBtn = document.createElement('button');
  noBtn.type = 'button';
  noBtn.className = 'btn-choice';
  noBtn.id = 'cm-no-btn';

  function _updateCashMovedLabels() {
    if (selectedDir === 'owed_to_me') {
      yesBtn.textContent = 'Да, я отдал деньги (будет создан расход)';
      noBtn.textContent = 'Нет, деньги не передавались (аренда, услуги и т.д.)';
    } else {
      yesBtn.textContent = 'Да, я получил деньги (будет создан доход)';
      noBtn.textContent = 'Нет, деньги не передавались (долг за услугу/товар)';
    }
  }
  _updateCashMovedLabels();

  yesBtn.addEventListener('click', () => {
    selectedCashMoved = true;
    yesBtn.classList.add('selected');
    noBtn.classList.remove('selected');
    cmHint.textContent = selectedDir === 'owed_to_me'
      ? '✓ Автоматически создастся расход в кассе на эту сумму.'
      : '✓ Автоматически создастся приход в кассе на эту сумму.';
    cmHint.className = 'field-hint text-income';
  });

  noBtn.addEventListener('click', () => {
    selectedCashMoved = false;
    noBtn.classList.add('selected');
    yesBtn.classList.remove('selected');
    cmHint.textContent = '✓ Долг зафиксируется в учёте, но касса не изменится.';
    cmHint.className = 'field-hint';
  });

  cmOptions.appendChild(yesBtn);
  cmOptions.appendChild(noBtn);
  cashMovedBox.appendChild(cmOptions);

  const cmHint = document.createElement('div');
  cmHint.className = 'field-hint text-warning';
  cmHint.textContent = 'Выберите один из вариантов выше.';
  cashMovedBox.appendChild(cmHint);

  form.appendChild(cashMovedBox);

  // Примечание
  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const nLabel = document.createElement('label');
  nLabel.textContent = 'Примечание';
  noteGroup.appendChild(nLabel);
  const nInput = document.createElement('textarea');
  nInput.name = 'debt-note';
  nInput.rows = 2;
  noteGroup.appendChild(nInput);
  form.appendChild(noteGroup);

  // Кнопка сохранения
  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Создать долг';
  saveBtn.addEventListener('click', async () => {
    const cp = form.querySelector('[name="debt-counterparty"]').value.trim();
    const amount = parseFloat(form.querySelector('[name="debt-amount"]').value);
    const dateVal = form.querySelector('[name="debt-date"]').value || todayStr;
    const dueDateVal = form.querySelector('[name="debt-due-date"]').value || '';
    const purpose = form.querySelector('[name="debt-purpose"]').value.trim();
    const note = form.querySelector('[name="debt-note"]').value.trim();

    if (!cp) {
      showToast('Укажите контрагента');
      return;
    }
    if (!amount || amount <= 0) {
      showToast('Введите корректную сумму');
      return;
    }
    if (selectedCashMoved === null) {
      showToast('Обязательно выберите, двигались ли деньги!');
      return;
    }

    const now = new Date().toISOString();
    const debtId = crypto.randomUUID();

    const newDebt = {
      id: debtId,
      direction: selectedDir,
      counterparty: cp,
      amount: amount,
      currency: selectedCurrency,
      date: dateVal,
      due_date: dueDateVal,
      purpose: purpose,
      order_id: '',
      cash_moved: selectedCashMoved,
      status: 'open',
      note: note,
      created_at: now,
      updated_at: now,
      deleted: false
    };

    // Сохраняем долг
    await put('debts', newDebt);
    await addToOutbox({ sheet: 'debts', data: newDebt });

    // Если cash_moved = TRUE, создаём связанную операцию principal (ТЗ раздел 5)
    if (selectedCashMoved) {
      const principalOp = {
        id: crypto.randomUUID(),
        type: selectedDir === 'owed_to_me' ? 'expense' : 'income',
        amount: amount,
        currency: selectedCurrency,
        date: dateVal,
        counterparty: cp,
        purpose: purpose || (selectedDir === 'owed_to_me' ? 'Выдача в долг' : 'Получение в долг'),
        category: '',
        order_id: '',
        order_line_id: '',
        debt_id: debtId,
        debt_role: 'principal',
        rate_at_entry: '',
        note: note,
        created_at: now,
        updated_at: now,
        deleted: false
      };
      await put('ops', principalOp);
      await addToOutbox({ sheet: 'ops', data: principalOp });
    }

    scheduleSyncAfterChange();
    showToast('Долг создан');
    _closeModal(overlay);
    renderDebts(pageContainer);
  });

  btnGroup.appendChild(saveBtn);
  dialog.appendChild(form);
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

// ============================================================
//  УТИЛИТЫ
// ============================================================

function _closeModal(overlay) {
  overlay.classList.remove('visible');
  setTimeout(() => overlay.remove(), 300);
}

function _fieldGroup(label, type, name, attrs = {}) {
  const g = document.createElement('div');
  g.className = 'form-group';
  const l = document.createElement('label');
  l.textContent = label;
  g.appendChild(l);
  const i = document.createElement('input');
  i.type = type;
  i.name = name;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'required') i.required = v;
    else i.setAttribute(k, v);
  }
  g.appendChild(i);
  return g;
}

function _createDatalist(id, items) {
  const dl = document.createElement('datalist');
  dl.id = id;
  for (const it of items.slice(0, 50)) {
    const opt = document.createElement('option');
    opt.value = it;
    dl.appendChild(opt);
  }
  return dl;
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
