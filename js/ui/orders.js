// orders.js — Раздел «Заказы» (#/orders и #/orders/:id)
// Список заказов, фильтры, создание, карточка заказа, план/факт, позиции, завершение с долгом

import { getActiveData, put, addToOutbox, getAll } from '../db.js';
import { calcOrderSummary } from '../calc.js';
import { navigate, getCurrentHash, isCurrentRender, nextRenderSeq } from '../router.js';
import { showToast } from './toast.js';
import { formatDate, isDateBeforeToday, compareDatesDesc, getTodayDateString } from '../dates.js';
import { openForm } from './form.js';

const fmtAmount = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const TYPE_NAMES = {
  material: 'Материалы',
  service: 'Услуги подрядчиков',
  overhead: 'Накладные расходы',
  labor_own: 'Моя работа (не деньги)',
  other: 'Прочее'
};

const STATUS_NAMES = {
  planned: 'Запланирован',
  in_progress: 'В работе',
  done: 'Завершён',
  cancelled: 'Отменён'
};

const STATUS_BADGES = {
  planned: 'badge',
  in_progress: 'badge badge-warning',
  done: 'badge badge-income',
  cancelled: 'badge text-secondary'
};

// Состояние фильтра списка заказов: 'active' | 'done' | 'all'
let currentOrderFilter = 'active';

// ============================================================
//  1. СПИСОК ЗАКАЗОВ (#/orders)
// ============================================================

/**
 * Отрисовать список заказов
 * @param {HTMLElement} container
 * @param {number} [renderId]
 */
export async function renderOrders(container, renderId) {
  if (!container) return;
  const thisRender = renderId || nextRenderSeq();

  try {
    const data = await getActiveData();
    if (!isCurrentRender(thisRender)) return;
    if (getCurrentHash() !== '#/orders') return;

    const { orders, order_lines, ops, rates, settings } = data;
    const baseCurrency = _getSetting(settings, 'base_currency', 'MDL');

    const fragment = document.createDocumentFragment();

    // === Панель управления: Фильтр и кнопка «+ Новый заказ» ===
    const controlRow = document.createElement('div');
    controlRow.className = 'orders-control-row';

    const filterGroup = document.createElement('div');
    filterGroup.className = 'chips-row';

    const activeChip = document.createElement('button');
    activeChip.type = 'button';
    activeChip.className = 'chip' + (currentOrderFilter === 'active' ? ' active' : '');
    activeChip.textContent = 'Активные';
    activeChip.addEventListener('click', () => {
      currentOrderFilter = 'active';
      renderOrders(container);
    });
    filterGroup.appendChild(activeChip);

    const doneChip = document.createElement('button');
    doneChip.type = 'button';
    doneChip.className = 'chip' + (currentOrderFilter === 'done' ? ' active' : '');
    doneChip.textContent = 'Завершённые';
    doneChip.addEventListener('click', () => {
      currentOrderFilter = 'done';
      renderOrders(container);
    });
    filterGroup.appendChild(doneChip);

    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'chip' + (currentOrderFilter === 'all' ? ' active' : '');
    allChip.textContent = 'Все';
    allChip.addEventListener('click', () => {
      currentOrderFilter = 'all';
      renderOrders(container);
    });
    filterGroup.appendChild(allChip);

    controlRow.appendChild(filterGroup);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.textContent = '+ Новый заказ';
    addBtn.addEventListener('click', () => {
      _openNewOrderDialog(settings, data, container);
    });
    controlRow.appendChild(addBtn);

    fragment.appendChild(controlRow);

    // === Фильтрация заказов ===
    let filteredOrders = [...orders];
    if (currentOrderFilter === 'active') {
      filteredOrders = filteredOrders.filter(o => o.status === 'planned' || o.status === 'in_progress');
    } else if (currentOrderFilter === 'done') {
      filteredOrders = filteredOrders.filter(o => o.status === 'done' || o.status === 'cancelled');
    }

    // Сортировка: сначала просроченные активные, затем по дате создания / начала (свежие сверху)
    filteredOrders.sort((a, b) => {
      const aIsActive = (a.status === 'planned' || a.status === 'in_progress');
      const bIsActive = (b.status === 'planned' || b.status === 'in_progress');
      const aOverdue = aIsActive && isDateBeforeToday(a.due_date);
      const bOverdue = bIsActive && isDateBeforeToday(b.due_date);
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      return compareDatesDesc(a.start_date || a.created_at, b.start_date || b.created_at);
    });

    // === Список карточек заказов ===
    const list = document.createElement('div');
    list.className = 'orders-list';

    if (filteredOrders.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = currentOrderFilter === 'active'
        ? 'Нет активных заказов'
        : (currentOrderFilter === 'done' ? 'Нет завершённых заказов' : 'Заказов пока нет');
      list.appendChild(empty);
    } else {
      for (const order of filteredOrders) {
        list.appendChild(_createOrderListItem(order, order_lines, ops, rates, baseCurrency));
      }
    }

    fragment.appendChild(list);

    if (!isCurrentRender(thisRender)) return;
    if (getCurrentHash() !== '#/orders') return;

    container.innerHTML = '';
    container.appendChild(fragment);

  } catch (err) {
    if (!isCurrentRender(thisRender)) return;
    if (getCurrentHash() !== '#/orders') return;
    console.error('Ошибка отрисовки заказов:', err);
    container.innerHTML = '';
    const errEl = document.createElement('p');
    errEl.className = 'placeholder-text';
    errEl.textContent = 'Ошибка загрузки данных';
    container.appendChild(errEl);
  }
}

/**
 * Карточка заказа в списке
 */
function _createOrderListItem(order, orderLines, ops, rates, baseCurrency) {
  const item = document.createElement('div');
  item.className = 'order-item card';

  const summary = calcOrderSummary(order, orderLines, ops, rates, baseCurrency);
  const cur = order.currency;
  const price = parseFloat(order.price) || 0;
  const isOverdue = (order.status === 'planned' || order.status === 'in_progress') && isDateBeforeToday(order.due_date);

  // 1. Верхняя строка: Название + статус
  const topRow = document.createElement('div');
  topRow.className = 'order-top-row';

  const titleEl = document.createElement('span');
  titleEl.className = 'order-title';
  titleEl.textContent = order.name || 'Без названия';
  topRow.appendChild(titleEl);

  const badgeEl = document.createElement('span');
  badgeEl.className = STATUS_BADGES[order.status] || 'badge';
  badgeEl.textContent = STATUS_NAMES[order.status] || order.status;
  topRow.appendChild(badgeEl);

  item.appendChild(topRow);

  // Клиент
  const clientEl = document.createElement('div');
  clientEl.className = 'order-client';
  clientEl.textContent = order.client ? `Клиент: ${order.client}` : 'Клиент не указан';
  item.appendChild(clientEl);

  // 2. Строка «Получено / Цена»
  const recRow = document.createElement('div');
  recRow.className = 'order-metric-row';
  const recLabel = document.createElement('span');
  recLabel.className = 'order-metric-label';
  recLabel.textContent = 'Получено / Цена';
  const recVal = document.createElement('span');
  recVal.className = 'order-metric-value amount';
  recVal.textContent = `${fmtAmount.format(summary.received)} / ${fmtAmount.format(price)} ${cur}`;
  recRow.appendChild(recLabel);
  recRow.appendChild(recVal);
  item.appendChild(recRow);

  // 3. Строка «Затраты факт / план»
  const costRow = document.createElement('div');
  costRow.className = 'order-metric-row';
  const costLabel = document.createElement('span');
  costLabel.className = 'order-metric-label';
  costLabel.textContent = 'Затраты факт / план';
  const costVal = document.createElement('span');
  costVal.className = 'order-metric-value amount';
  costVal.textContent = `${fmtAmount.format(summary.totalFactCosts)} / ${fmtAmount.format(summary.plannedCosts)} ${cur}`;
  costRow.appendChild(costLabel);
  costRow.appendChild(costVal);
  item.appendChild(costRow);

  // Полоска прогресса затрат
  const progressWrap = document.createElement('div');
  progressWrap.className = 'progress-bar-wrap';
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-bar-fill';

  const planCost = summary.plannedCosts > 0 ? summary.plannedCosts : 1;
  const pct = Math.min(100, Math.round((summary.totalFactCosts / planCost) * 100));
  progressFill.style.width = `${pct}%`;

  if (summary.totalFactCosts > summary.plannedCosts && summary.plannedCosts > 0) {
    progressFill.classList.add('overrun');
  }
  progressWrap.appendChild(progressFill);
  item.appendChild(progressWrap);

  // 4. Нижняя строка: Прибыль + Срок
  const botRow = document.createElement('div');
  botRow.className = 'order-bottom-row';

  const profitEl = document.createElement('div');
  const profitColor = summary.actualProfit >= 0 ? 'text-income' : 'text-expense';
  profitEl.innerHTML = `Прибыль: <strong class="${profitColor}">${fmtAmount.format(summary.actualProfit)} ${cur}</strong> <span class="text-secondary">(план ${fmtAmount.format(summary.plannedProfit)})</span>`;
  botRow.appendChild(profitEl);

  if (order.due_date) {
    const dueEl = document.createElement('div');
    dueEl.className = isOverdue ? 'text-expense font-bold' : '';
    dueEl.textContent = isOverdue ? `Просрочен: ${formatDate(order.due_date)}` : `до ${formatDate(order.due_date)}`;
    botRow.appendChild(dueEl);
  }

  item.appendChild(botRow);

  // Клик открывает детальную карточку
  item.addEventListener('click', () => {
    navigate(`#/orders/${order.id}`);
  });

  return item;
}

// ============================================================
//  2. ДЕТАЛЬНАЯ КАРТОЧКА ЗАКАЗА (#/orders/:id)
// ============================================================

export async function renderOrderCard(container, params, renderId) {
  if (!container) return;
  const thisRender = renderId || nextRenderSeq();

  const orderId = params && params.id;
  if (!orderId) {
    navigate('#/orders');
    return;
  }

  try {
    const data = await getActiveData();
    if (!isCurrentRender(thisRender)) return;
    if (!getCurrentHash().startsWith('#/orders/')) return;

    const { orders, order_lines, ops, rates, settings } = data;
    const baseCurrency = _getSetting(settings, 'base_currency', 'MDL');

    const order = orders.find(o => o.id === orderId);
    if (!order) {
      if (!isCurrentRender(thisRender)) return;
      if (!getCurrentHash().startsWith('#/orders/')) return;
      const errBox = document.createElement('div');
      errBox.className = 'card text-center p-16';
      errBox.innerHTML = '<p class="placeholder-text">Заказ не найден или был удалён</p>';
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'btn btn-primary mt-12';
      backBtn.textContent = '← К списку заказов';
      backBtn.addEventListener('click', () => navigate('#/orders'));
      errBox.appendChild(backBtn);
      container.innerHTML = '';
      container.appendChild(errBox);
      return;
    }

    const fragment = document.createDocumentFragment();

    const lines = order_lines.filter(l => l.order_id === order.id);
    const orderOps = ops.filter(o => o.order_id === order.id && !o.debt_id);
    const summary = calcOrderSummary(order, order_lines, ops, rates, baseCurrency);
    const cur = order.currency;

    // --- Кнопка возврата «Назад» ---
    const navBar = document.createElement('div');
    navBar.className = 'flex-between mb-12';
    const backLink = document.createElement('button');
    backLink.type = 'button';
    backLink.className = 'btn-link';
    backLink.textContent = '← Все заказы';
    backLink.addEventListener('click', () => navigate('#/orders'));
    navBar.appendChild(backLink);

    fragment.appendChild(navBar);

    // --- ШАПКА ЗАКАЗА ---
    const headerCard = document.createElement('div');
    headerCard.className = 'order-detail-header card';

    const hTop = document.createElement('div');
    hTop.className = 'flex-between align-start mb-8';

    const titleGroup = document.createElement('div');
    const titleEl = document.createElement('h2');
    titleEl.className = 'section-title mb-4';
    titleEl.textContent = order.name || 'Заказ без названия';
    titleGroup.appendChild(titleEl);

    const clientEl = document.createElement('div');
    clientEl.className = 'text-secondary font-medium';
    clientEl.textContent = order.client ? `Клиент: ${order.client}` : 'Без клиента';
    titleGroup.appendChild(clientEl);
    hTop.appendChild(titleGroup);

    const statusBadge = document.createElement('span');
    statusBadge.className = STATUS_BADGES[order.status] || 'badge';
    statusBadge.textContent = STATUS_NAMES[order.status] || order.status;
    hTop.appendChild(statusBadge);
    headerCard.appendChild(hTop);

    // Цена и даты
    const metaRow = document.createElement('div');
    metaRow.className = 'flex-between text-secondary font-sm mt-8 border-top pt-8';
    metaRow.innerHTML = `
      <div>Цена: <strong class="text-primary amount">${fmtAmount.format(order.price)} ${cur}</strong></div>
      <div>Срок: <strong>${order.due_date ? formatDate(order.due_date) : 'не указан'}</strong></div>
    `;
    headerCard.appendChild(metaRow);

    if (order.note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'text-secondary font-sm mt-8';
      noteEl.textContent = `Примечание: ${order.note}`;
      headerCard.appendChild(noteEl);
    }

    // Кнопка редактирования шапки
    const editHeaderBtn = document.createElement('button');
    editHeaderBtn.type = 'button';
    editHeaderBtn.className = 'btn btn-secondary btn-sm mt-12 w-full';
    editHeaderBtn.textContent = '✎ Редактировать данные заказа';
    editHeaderBtn.addEventListener('click', () => {
      _openEditOrderHeaderDialog(order, orderOps, settings, data, container);
    });
    headerCard.appendChild(editHeaderBtn);

    fragment.appendChild(headerCard);

    // --- СВОДКА «ПЛАН / ФАКТ / РАЗНИЦА» ---
    const summaryCard = document.createElement('div');
    summaryCard.className = 'summary-table-wrap card';

    const sumTitle = document.createElement('h3');
    sumTitle.className = 'section-title mb-8';
    sumTitle.textContent = 'Сводка по заказу';
    summaryCard.appendChild(sumTitle);

    // 1. Цена и получено
    summaryCard.appendChild(_summaryRow('Цена заказа', `${fmtAmount.format(order.price)} ${cur}`));
    summaryCard.appendChild(_summaryRow('Получено от клиента', `${fmtAmount.format(summary.received)} ${cur}`, 'text-income'));
    if (order.status === 'planned' || order.status === 'in_progress') {
      summaryCard.appendChild(_summaryRow('Осталось получить', `${fmtAmount.format(summary.expectedIncome)} ${cur}`, 'text-warning'));
    }

    // 2. Затраты (план, факт, отклонение)
    const costDiff = summary.totalFactCosts - summary.plannedCosts;
    const costDiffClass = costDiff > 0 ? 'text-expense' : (costDiff < 0 ? 'text-income' : '');
    const costDiffSign = costDiff > 0 ? '+' : '';
    summaryCard.appendChild(_summaryRow('Плановые затраты', `${fmtAmount.format(summary.plannedCosts)} ${cur}`));
    summaryCard.appendChild(_summaryRow('Фактические затраты', `${fmtAmount.format(summary.totalFactCosts)} ${cur}`, summary.totalFactCosts > summary.plannedCosts ? 'text-expense font-bold' : ''));
    if (summary.plannedCosts > 0 || summary.totalFactCosts > 0) {
      summaryCard.appendChild(_summaryRow('Отклонение по затратам', `${costDiffSign}${fmtAmount.format(costDiff)} ${cur} (${costDiff > 0 ? 'перерасход' : 'экономия'})`, costDiffClass));
    }

    // 3. Прибыль (деньги)
    summaryCard.appendChild(_summaryRow('Плановая прибыль (деньги)', `${fmtAmount.format(summary.plannedProfit)} ${cur}`));
    summaryCard.appendChild(_summaryRow('Фактическая прибыль', `${fmtAmount.format(summary.actualProfit)} ${cur}`, summary.actualProfit >= 0 ? 'text-income font-bold' : 'text-expense font-bold', true));

    // 4. Моя работа (labor_own)
    if (summary.laborOwnPlan > 0 || lines.some(l => l.type === 'labor_own')) {
      const laborLines = lines.filter(l => l.type === 'labor_own');
      const laborFactSum = laborLines.reduce((s, l) => s + (parseFloat(l.fact_amount) || 0), 0);
      summaryCard.appendChild(_summaryRow('Моя работа (план)', `${fmtAmount.format(summary.laborOwnPlan)} ${cur}`));
      summaryCard.appendChild(_summaryRow('Моя работа (факт/оценка)', `${fmtAmount.format(laborFactSum)} ${cur}`));
      summaryCard.appendChild(_summaryRow('Прибыль сверх моей работы (план)', `${fmtAmount.format(summary.profitAboveLabor)} ${cur}`));
      const actualAboveLabor = summary.actualProfit - laborFactSum;
      summaryCard.appendChild(_summaryRow('Прибыль сверх моей работы (факт)', `${fmtAmount.format(actualAboveLabor)} ${cur}`, actualAboveLabor >= 0 ? 'text-income font-bold' : 'text-expense font-bold', true));
    }

    // 5. Ожидаемые суммы
    if (order.status === 'planned' || order.status === 'in_progress') {
      summaryCard.appendChild(_summaryRow('Ожидается потратить', `${fmtAmount.format(summary.expectedExpense)} ${cur}`, 'text-secondary'));
    }

    fragment.appendChild(summaryCard);

    // --- ПОЗИЦИИ ПЛАНА ПО ТИПАМ ---
    const planSection = document.createElement('div');
    planSection.className = 'section';

    const planHeader = document.createElement('div');
    planHeader.className = 'section-header flex-between mb-8';

    const planTitle = document.createElement('h3');
    planTitle.className = 'section-title mb-0';
    planTitle.textContent = 'Позиции плана';
    planHeader.appendChild(planTitle);

    const addLineBtn = document.createElement('button');
    addLineBtn.type = 'button';
    addLineBtn.className = 'btn btn-primary btn-sm';
    addLineBtn.textContent = '+ Позиция';
    addLineBtn.addEventListener('click', () => {
      _openAddOrderLineDialog(order, settings, data, container);
    });
    planHeader.appendChild(addLineBtn);
    planSection.appendChild(planHeader);

    if (lines.length === 0) {
      const noLines = document.createElement('p');
      noLines.className = 'placeholder-text';
      noLines.textContent = 'Позиций плана пока нет. Добавьте материалы, услуги или оценку своей работы.';
      planSection.appendChild(noLines);
    } else {
      // Группируем по типам
      const grouped = {};
      for (const line of lines) {
        const t = line.type || 'other';
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(line);
      }

      // Порядок вывода групп
      const orderTypes = ['material', 'service', 'overhead', 'labor_own', 'other'];
      for (const t of orderTypes) {
        if (!grouped[t] || grouped[t].length === 0) continue;

        const gTitle = document.createElement('div');
        gTitle.className = 'plan-group-title';
        gTitle.textContent = TYPE_NAMES[t] || t;
        planSection.appendChild(gTitle);

        for (const line of grouped[t]) {
          planSection.appendChild(_createPlanLineItem(line, order, summary, ops, data, container));
        }
      }
    }

    fragment.appendChild(planSection);

    // --- ВНЕПЛАНОВЫЕ РАСХОДЫ ---
    const unplannedOps = orderOps.filter(o => o.type === 'expense' && !o.order_line_id);
    if (unplannedOps.length > 0) {
      const unSection = document.createElement('div');
      unSection.className = 'section card p-12 mb-16';

      const unHeader = document.createElement('div');
      unHeader.className = 'flex-between mb-8';
      unHeader.innerHTML = `<h4 class="font-bold text-expense">⚠️ Внеплановые расходы (${unplannedOps.length})</h4><span class="amount font-bold text-expense">${fmtAmount.format(summary.unplannedFact)} ${cur}</span>`;
      unSection.appendChild(unHeader);

      const unDesc = document.createElement('p');
      unDesc.className = 'text-secondary font-sm mb-8';
      unDesc.textContent = 'Эти расходы привязаны к заказу, но не привязаны ни к одной позиции плана.';
      unSection.appendChild(unDesc);

      for (const op of unplannedOps) {
        const opRow = document.createElement('div');
        opRow.className = 'flex-between py-6 border-top align-center font-sm';

        const info = document.createElement('div');
        info.innerHTML = `<strong>${fmtAmount.format(op.amount)} ${op.currency}</strong> · ${op.purpose || 'Расход'} <span class="text-secondary">(${formatDate(op.date)})</span>`;
        opRow.appendChild(info);

        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'btn btn-secondary btn-sm';
        linkBtn.textContent = 'Привязать к позиции';
        linkBtn.addEventListener('click', () => {
          _openLinkOpToLineDialog(op, lines, order, container);
        });
        opRow.appendChild(linkBtn);

        unSection.appendChild(opRow);
      }

      fragment.appendChild(unSection);
    }

    // --- ПОСТУПЛЕНИЯ ОТ КЛИЕНТА ---
    const receiptsOps = orderOps.filter(o => o.type === 'income');
    const recSection = document.createElement('div');
    recSection.className = 'section card p-12 mb-16';

    const recHeader = document.createElement('div');
    recHeader.className = 'flex-between mb-8';
    recHeader.innerHTML = `<h4 class="font-bold text-income">Поступления от клиента (${receiptsOps.length})</h4><span class="amount font-bold text-income">${fmtAmount.format(summary.received)} ${cur}</span>`;
    recSection.appendChild(recHeader);

    if (receiptsOps.length === 0) {
      const noRec = document.createElement('p');
      noRec.className = 'text-secondary font-sm mb-8';
      noRec.textContent = 'Оплат от клиента пока не зафиксировано.';
      recSection.appendChild(noRec);
    } else {
      for (const op of receiptsOps) {
        const opRow = document.createElement('div');
        opRow.className = 'flex-between py-6 border-top font-sm';
        opRow.innerHTML = `
          <div><strong>${fmtAmount.format(op.amount)} ${op.currency}</strong> · ${op.purpose || 'Оплата'} <span class="text-secondary">(${formatDate(op.date)})</span></div>
        `;
        recSection.appendChild(opRow);
      }
    }

    const addRecBtn = document.createElement('button');
    addRecBtn.type = 'button';
    addRecBtn.className = 'btn btn-primary btn-sm mt-8';
    addRecBtn.textContent = '+ Поступление от клиента';
    addRecBtn.addEventListener('click', () => {
      openForm('income', {
        orderId: order.id,
        counterparty: order.client || '',
        currency: order.currency
      });
    });
    recSection.appendChild(addRecBtn);

    fragment.appendChild(recSection);

    // --- КНОПКИ ДЕЙСТВИЙ НАД ЗАКАЗОМ ---
    const actionsBox = document.createElement('div');
    actionsBox.className = 'modal-buttons flex-col gap-8 mb-24';

    // 1. Завершить заказ
    if (order.status !== 'done') {
      const completeBtn = document.createElement('button');
      completeBtn.type = 'button';
      completeBtn.className = 'btn btn-primary';
      completeBtn.textContent = '✓ Завершить заказ';
      completeBtn.addEventListener('click', () => {
        _completeOrder(order, summary, container);
      });
      actionsBox.appendChild(completeBtn);
    }

    // 2. Копировать как новый заказ
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = '📋 Копировать как новый заказ';
    copyBtn.addEventListener('click', () => {
      _copyOrder(order, lines);
    });
    actionsBox.appendChild(copyBtn);

    // 3. Отменить заказ
    if (order.status !== 'cancelled' && order.status !== 'done') {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Отменить заказ';
      cancelBtn.addEventListener('click', async () => {
        if (!confirm('Отменить этот заказ? Ожидаемые суммы станут равны 0.')) return;
        order.status = 'cancelled';
        order.updated_at = new Date().toISOString();
        await put('orders', order);
        await addToOutbox({ sheet: 'orders', data: order });
        showToast('Заказ отменён');
        renderOrderCard(container, params);
      });
      actionsBox.appendChild(cancelBtn);
    }

    // 4. Удалить заказ
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Удалить заказ';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Удалить заказ "${order.name}" и все его плановые позиции? (Связанные фактические операции в кассе сохранятся)`)) return;
      const now = new Date().toISOString();

      order.deleted = true;
      order.updated_at = now;
      await put('orders', order);
      await addToOutbox({ sheet: 'orders', data: order });

      // Удаляем позиции плана
      for (const line of lines) {
        line.deleted = true;
        line.updated_at = now;
        await put('order_lines', line);
        await addToOutbox({ sheet: 'order_lines', data: line });
      }

      showToast('Заказ удалён');
      navigate('#/orders');
    });
    actionsBox.appendChild(deleteBtn);

    fragment.appendChild(actionsBox);

    if (!isCurrentRender(thisRender)) return;
    if (!getCurrentHash().startsWith('#/orders/')) return;

    container.innerHTML = '';
    container.appendChild(fragment);

  } catch (err) {
    if (!isCurrentRender(thisRender)) return;
    if (!getCurrentHash().startsWith('#/orders/')) return;
    console.error('Ошибка отрисовки карточки заказа:', err);
    container.innerHTML = '';
    const errEl = document.createElement('p');
    errEl.className = 'placeholder-text';
    errEl.textContent = 'Ошибка загрузки карточки заказа';
    container.appendChild(errEl);
  }
}

/**
 * Строка таблицы сводки
 */
function _summaryRow(label, value, valueClass = '', isHighlight = false) {
  const row = document.createElement('div');
  row.className = 'summary-row' + (isHighlight ? ' summary-highlight' : '');
  const l = document.createElement('span');
  l.className = 'text-secondary';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'amount' + (valueClass ? ` ${valueClass}` : '');
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

/**
 * Элемент позиции плана
 */
function _createPlanLineItem(line, order, summary, allOps, fullData, pageContainer) {
  const item = document.createElement('div');
  item.className = 'plan-item';

  const isLabor = line.type === 'labor_own';
  const cur = line.currency || order.currency;
  const planAmt = parseFloat(line.plan_amount) || 0;

  let factAmt = 0;
  if (isLabor) {
    factAmt = parseFloat(line.fact_amount) || 0;
  } else {
    factAmt = summary.factByLine[line.id] || 0;
  }

  const deviation = factAmt - planAmt;

  // Верхняя строка: Название + План/Факт
  const top = document.createElement('div');
  top.className = 'plan-item-top';

  const nameEl = document.createElement('span');
  nameEl.className = 'plan-item-name';
  nameEl.textContent = line.name || 'Позиция без названия';
  top.appendChild(nameEl);

  const amountEl = document.createElement('span');
  amountEl.className = 'font-bold amount';
  amountEl.textContent = `${fmtAmount.format(factAmt)} / ${fmtAmount.format(planAmt)} ${cur}`;
  top.appendChild(amountEl);
  item.appendChild(top);

  // Нижняя строка: Qty/Unit + Отклонение
  const bot = document.createElement('div');
  bot.className = 'plan-item-bot';

  const qtyEl = document.createElement('span');
  if (line.qty && line.unit_price) {
    qtyEl.textContent = `${line.qty} ${line.unit || 'шт'} × ${fmtAmount.format(line.unit_price)} ${cur}`;
  } else if (line.qty) {
    qtyEl.textContent = `${line.qty} ${line.unit || 'шт'}`;
  } else {
    qtyEl.textContent = isLabor ? 'Оценка труда' : 'План';
  }
  bot.appendChild(qtyEl);

  const devEl = document.createElement('span');
  if (deviation > 0 && !isLabor) {
    devEl.className = 'text-expense font-bold';
    devEl.textContent = `+${fmtAmount.format(deviation)} (перерасход)`;
  } else if (deviation < 0 && factAmt > 0 && !isLabor) {
    devEl.className = 'text-income';
    devEl.textContent = `${fmtAmount.format(deviation)} (экономия)`;
  }
  bot.appendChild(devEl);
  item.appendChild(bot);

  // Тап открывает карточку позиции
  item.addEventListener('click', () => {
    _openLineDetailsDialog(line, order, factAmt, planAmt, deviation, allOps, fullData, pageContainer);
  });

  return item;
}

// ============================================================
//  3. МОДАЛЬНЫЕ ОКНА И ДЕЙСТВИЯ
// ============================================================

/**
 * Диалог создания нового заказа
 */
function _openNewOrderDialog(settings, fullData, container) {
  const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);
  const baseCurrency = _getSetting(settings, 'base_currency', 'MDL');
  const pastClients = [...new Set(fullData.orders.map(o => o.client).filter(Boolean))];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Новый заказ';
  dialog.appendChild(title);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  // Название
  form.appendChild(_fieldGroup('Название заказа', 'text', 'order-name', {
    placeholder: 'Например: Кухня для Ивана',
    required: true
  }));

  // Клиент
  const clientGroup = _fieldGroup('Клиент', 'text', 'order-client', {
    placeholder: 'Имя / компания',
    list: 'dl-order-clients'
  });
  clientGroup.appendChild(_createDatalist('dl-order-clients', pastClients));
  form.appendChild(clientGroup);

  // Валюта заказа (чипы)
  const curGroup = document.createElement('div');
  curGroup.className = 'form-group';
  const curLabel = document.createElement('label');
  curLabel.textContent = 'Валюта заказа';
  curGroup.appendChild(curLabel);

  const curChips = document.createElement('div');
  curChips.className = 'currency-chips';
  let selectedCurrency = currencies[0] || baseCurrency;

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

  // Цена для клиента
  form.appendChild(_fieldGroup('Цена для клиента', 'number', 'order-price', {
    inputmode: 'decimal',
    step: '0.01',
    min: '0',
    placeholder: '0,00',
    required: true
  }));

  // Дата начала и срок
  const todayStr = getTodayDateString();
  form.appendChild(_fieldGroup('Дата начала', 'date', 'order-start-date', { value: todayStr }));
  form.appendChild(_fieldGroup('Срок сдачи (необязательно)', 'date', 'order-due-date', {}));

  // Примечание
  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const nLabel = document.createElement('label');
  nLabel.textContent = 'Примечание';
  noteGroup.appendChild(nLabel);
  const nInput = document.createElement('textarea');
  nInput.name = 'order-note';
  nInput.rows = 2;
  noteGroup.appendChild(nInput);
  form.appendChild(noteGroup);

  // Кнопка сохранения
  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Создать заказ';
  saveBtn.addEventListener('click', async () => {
    const name = form.querySelector('[name="order-name"]').value.trim();
    const client = form.querySelector('[name="order-client"]').value.trim();
    const price = parseFloat(form.querySelector('[name="order-price"]').value) || 0;
    const startDate = form.querySelector('[name="order-start-date"]').value || todayStr;
    const dueDate = form.querySelector('[name="order-due-date"]').value || '';
    const note = form.querySelector('[name="order-note"]').value.trim();

    if (!name) {
      showToast('Укажите название заказа');
      return;
    }

    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();

    const newOrder = {
      id: orderId,
      name,
      client,
      status: 'planned',
      currency: selectedCurrency,
      price,
      start_date: startDate,
      due_date: dueDate,
      closed_at: '',
      note,
      created_at: now,
      updated_at: now,
      deleted: false
    };

    await put('orders', newOrder);
    await addToOutbox({ sheet: 'orders', data: newOrder });

    showToast('Заказ создан');
    _closeModal(overlay);
    navigate(`#/orders/${orderId}`);
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

/**
 * Редактирование шапки заказа
 */
function _openEditOrderHeaderDialog(order, orderOps, settings, fullData, pageContainer) {
  const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);
  const pastClients = [...new Set(fullData.orders.map(o => o.client).filter(Boolean))];
  const hasOps = orderOps.length > 0;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Редактировать заказ';
  dialog.appendChild(title);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  form.appendChild(_fieldGroup('Название', 'text', 'order-name', { value: order.name, required: true }));

  const clientGroup = _fieldGroup('Клиент', 'text', 'order-client', { value: order.client || '', list: 'dl-order-clients-edit' });
  clientGroup.appendChild(_createDatalist('dl-order-clients-edit', pastClients));
  form.appendChild(clientGroup);

  // Статус
  const statusGroup = document.createElement('div');
  statusGroup.className = 'form-group';
  const stLabel = document.createElement('label');
  stLabel.textContent = 'Статус';
  statusGroup.appendChild(stLabel);
  const stSelect = document.createElement('select');
  stSelect.name = 'order-status';
  for (const [sKey, sName] of Object.entries(STATUS_NAMES)) {
    const opt = document.createElement('option');
    opt.value = sKey;
    opt.textContent = sName;
    if (order.status === sKey) opt.selected = true;
    stSelect.appendChild(opt);
  }
  statusGroup.appendChild(stSelect);
  form.appendChild(statusGroup);

  // Валюта (заблокирована, если уже есть операции по заказу)
  const curGroup = document.createElement('div');
  curGroup.className = 'form-group';
  const cLabel = document.createElement('label');
  cLabel.textContent = hasOps ? 'Валюта (заблокирована: есть операции)' : 'Валюта';
  curGroup.appendChild(cLabel);
  const curSelect = document.createElement('select');
  curSelect.name = 'order-currency';
  if (hasOps) curSelect.disabled = true;
  for (const cur of currencies) {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = cur;
    if (order.currency === cur) opt.selected = true;
    curSelect.appendChild(opt);
  }
  curGroup.appendChild(curSelect);
  form.appendChild(curGroup);

  form.appendChild(_fieldGroup('Цена для клиента', 'number', 'order-price', {
    inputmode: 'decimal',
    step: '0.01',
    value: order.price
  }));

  form.appendChild(_fieldGroup('Дата начала', 'date', 'order-start-date', { value: order.start_date || '' }));
  form.appendChild(_fieldGroup('Срок сдачи', 'date', 'order-due-date', { value: order.due_date || '' }));

  // Примечание
  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const nLabel = document.createElement('label');
  nLabel.textContent = 'Примечание';
  noteGroup.appendChild(nLabel);
  const nInput = document.createElement('textarea');
  nInput.name = 'order-note';
  nInput.rows = 2;
  nInput.value = order.note || '';
  noteGroup.appendChild(nInput);
  form.appendChild(noteGroup);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Сохранить';
  saveBtn.addEventListener('click', async () => {
    const name = form.querySelector('[name="order-name"]').value.trim();
    const client = form.querySelector('[name="order-client"]').value.trim();
    const status = form.querySelector('[name="order-status"]').value;
    const price = parseFloat(form.querySelector('[name="order-price"]').value) || 0;
    const startDate = form.querySelector('[name="order-start-date"]').value || '';
    const dueDate = form.querySelector('[name="order-due-date"]').value || '';
    const note = form.querySelector('[name="order-note"]').value.trim();

    if (!name) {
      showToast('Укажите название заказа');
      return;
    }

    order.name = name;
    order.client = client;
    order.status = status;
    if (!hasOps) {
      order.currency = form.querySelector('[name="order-currency"]').value;
    }
    order.price = price;
    order.start_date = startDate;
    order.due_date = dueDate;
    order.note = note;
    order.updated_at = new Date().toISOString();

    await put('orders', order);
    await addToOutbox({ sheet: 'orders', data: order });

    showToast('Заказ обновлён');
    _closeModal(overlay);
    renderOrderCard(pageContainer, { id: order.id });
  });

  btnGroup.appendChild(saveBtn);
  dialog.appendChild(form);
  dialog.appendChild(btnGroup);

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

/**
 * Добавить позицию плана
 */
function _openAddOrderLineDialog(order, settings, fullData, pageContainer) {
  const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Новая позиция плана';
  dialog.appendChild(title);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  // Тип
  const typeGroup = document.createElement('div');
  typeGroup.className = 'form-group';
  const tLabel = document.createElement('label');
  tLabel.textContent = 'Тип позиции';
  typeGroup.appendChild(tLabel);

  const tSelect = document.createElement('select');
  tSelect.name = 'line-type';
  for (const [tKey, tName] of Object.entries(TYPE_NAMES)) {
    const opt = document.createElement('option');
    opt.value = tKey;
    opt.textContent = tName;
    tSelect.appendChild(opt);
  }
  typeGroup.appendChild(tSelect);
  form.appendChild(typeGroup);

  // Название
  form.appendChild(_fieldGroup('Название позиции', 'text', 'line-name', {
    placeholder: 'Например: ДСП, ручки, монтаж',
    required: true
  }));

  // Количество и единица
  const qtyRow = document.createElement('div');
  qtyRow.className = 'flex-row gap-8';
  qtyRow.appendChild(_fieldGroup('Количество', 'number', 'line-qty', { inputmode: 'decimal', step: '0.01', placeholder: '1' }));
  qtyRow.appendChild(_fieldGroup('Ед. изм.', 'text', 'line-unit', { placeholder: 'шт, м, ч' }));
  form.appendChild(qtyRow);

  // Цена за единицу
  form.appendChild(_fieldGroup('Цена за ед.', 'number', 'line-unit-price', { inputmode: 'decimal', step: '0.01', placeholder: '0,00' }));

  // Валюта позиции
  const curGroup = document.createElement('div');
  curGroup.className = 'form-group';
  const cLabel = document.createElement('label');
  cLabel.textContent = 'Валюта';
  curGroup.appendChild(cLabel);
  const curSelect = document.createElement('select');
  curSelect.name = 'line-currency';
  for (const cur of currencies) {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = cur;
    if (cur === order.currency) opt.selected = true;
    curSelect.appendChild(opt);
  }
  curGroup.appendChild(curSelect);
  form.appendChild(curGroup);

  // Сумма плана
  form.appendChild(_fieldGroup('Плановая сумма', 'number', 'line-plan-amount', {
    inputmode: 'decimal',
    step: '0.01',
    placeholder: '0,00',
    required: true
  }));

  // Автоматический пересчёт: если заполнены qty и unit_price -> вычисляем plan_amount
  const qtyInput = form.querySelector('[name="line-qty"]');
  const unitPriceInput = form.querySelector('[name="line-unit-price"]');
  const planInput = form.querySelector('[name="line-plan-amount"]');

  function _recalcPlan() {
    const q = parseFloat(qtyInput.value);
    const p = parseFloat(unitPriceInput.value);
    if (!isNaN(q) && !isNaN(p) && q > 0 && p > 0) {
      planInput.value = (q * p).toFixed(2);
    }
  }
  qtyInput.addEventListener('input', _recalcPlan);
  unitPriceInput.addEventListener('input', _recalcPlan);

  // Примечание
  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const nLabel = document.createElement('label');
  nLabel.textContent = 'Примечание';
  noteGroup.appendChild(nLabel);
  const nInput = document.createElement('textarea');
  nInput.name = 'line-note';
  nInput.rows = 2;
  noteGroup.appendChild(nInput);
  form.appendChild(noteGroup);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Добавить позицию';
  saveBtn.addEventListener('click', async () => {
    const type = tSelect.value;
    const name = form.querySelector('[name="line-name"]').value.trim();
    const qty = parseFloat(qtyInput.value) || '';
    const unit = form.querySelector('[name="line-unit"]').value.trim();
    const unitPrice = parseFloat(unitPriceInput.value) || '';
    const currency = curSelect.value;
    const planAmount = parseFloat(planInput.value) || 0;
    const note = form.querySelector('[name="line-note"]').value.trim();

    if (!name) {
      showToast('Укажите название позиции');
      return;
    }
    if (planAmount <= 0) {
      showToast('Укажите плановую сумму');
      return;
    }

    const now = new Date().toISOString();
    const newLine = {
      id: crypto.randomUUID(),
      order_id: order.id,
      type,
      name,
      qty,
      unit,
      unit_price: unitPrice,
      plan_amount: planAmount,
      currency,
      fact_amount: 0,
      note,
      sort: Date.now(),
      created_at: now,
      updated_at: now,
      deleted: false
    };

    await put('order_lines', newLine);
    await addToOutbox({ sheet: 'order_lines', data: newLine });

    showToast('Позиция добавлена');
    _closeModal(overlay);
    renderOrderCard(pageContainer, { id: order.id });
  });

  btnGroup.appendChild(saveBtn);
  dialog.appendChild(form);
  dialog.appendChild(btnGroup);

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

/**
 * Карточка позиции плана (детализация, список расходов, кнопка «+ Факт»)
 */
function _openLineDetailsDialog(line, order, factAmt, planAmt, deviation, allOps, fullData, pageContainer) {
  const isLabor = line.type === 'labor_own';
  const cur = line.currency || order.currency;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-wide';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = line.name || 'Позиция плана';
  dialog.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'modal-subtitle';
  sub.textContent = `${TYPE_NAMES[line.type] || line.type} · План: ${fmtAmount.format(planAmt)} ${cur}`;
  dialog.appendChild(sub);

  // Сводка по позиции
  const statCard = document.createElement('div');
  statCard.className = 'card bg-subtle p-12 mb-12';
  const devColor = deviation > 0 ? 'text-expense font-bold' : (deviation < 0 ? 'text-income font-bold' : '');
  const devSign = deviation > 0 ? '+' : '';
  statCard.innerHTML = `
    <div class="flex-between py-2 font-sm"><span>План:</span> <strong>${fmtAmount.format(planAmt)} ${cur}</strong></div>
    <div class="flex-between py-2 font-sm"><span>Факт:</span> <strong class="${deviation > 0 ? 'text-expense' : ''}">${fmtAmount.format(factAmt)} ${cur}</strong></div>
    ${!isLabor ? `<div class="flex-between py-2 font-sm"><span>Отклонение:</span> <strong class="${devColor}">${devSign}${fmtAmount.format(deviation)} ${cur}</strong></div>` : ''}
  `;
  dialog.appendChild(statCard);

  // Если labor_own — поле редактирования фактической оценки труда
  if (isLabor) {
    const laborBox = document.createElement('div');
    laborBox.className = 'form-group border p-12 radius-sm mb-12';
    const lLabel = document.createElement('label');
    lLabel.textContent = `Фактическая оценка труда (${cur})`;
    laborBox.appendChild(lLabel);

    const lInput = document.createElement('input');
    lInput.type = 'number';
    lInput.inputMode = 'decimal';
    lInput.step = '0.01';
    lInput.value = line.fact_amount || '';
    lInput.placeholder = '0,00';
    laborBox.appendChild(lInput);

    const saveLaborBtn = document.createElement('button');
    saveLaborBtn.type = 'button';
    saveLaborBtn.className = 'btn btn-primary btn-sm mt-8';
    saveLaborBtn.textContent = 'Сохранить оценку';
    saveLaborBtn.addEventListener('click', async () => {
      line.fact_amount = parseFloat(lInput.value) || 0;
      line.updated_at = new Date().toISOString();
      await put('order_lines', line);
      await addToOutbox({ sheet: 'order_lines', data: line });
      showToast('Оценка труда сохранена');
      _closeModal(overlay);
      renderOrderCard(pageContainer, { id: order.id });
    });
    laborBox.appendChild(saveLaborBtn);
    dialog.appendChild(laborBox);

  } else {
    // Список связанных операций расхода
    const linkedOps = allOps.filter(o => o.order_line_id === line.id && o.type === 'expense');

    const opsTitle = document.createElement('h4');
    opsTitle.className = 'section-title font-sm mb-8';
    opsTitle.textContent = `Связанные расходы (${linkedOps.length})`;
    dialog.appendChild(opsTitle);

    const opsList = document.createElement('div');
    opsList.className = 'mb-12 max-h-40 overflow-y';

    if (linkedOps.length === 0) {
      const noOps = document.createElement('p');
      noOps.className = 'text-secondary font-sm';
      noOps.textContent = 'Расходов по этой позиции пока не зафиксировано.';
      opsList.appendChild(noOps);
    } else {
      for (const op of linkedOps) {
        const row = document.createElement('div');
        row.className = 'flex-between py-6 border-top font-sm';
        row.innerHTML = `
          <div><strong>${fmtAmount.format(op.amount)} ${op.currency}</strong> · ${op.purpose || 'Расход'} <span class="text-secondary">(${formatDate(op.date)})</span></div>
        `;
        opsList.appendChild(row);
      }
    }
    dialog.appendChild(opsList);

    // Кнопка «+ Факт» (ТЗ: добавление факта в 2 нажатия!)
    const addFactBtn = document.createElement('button');
    addFactBtn.type = 'button';
    addFactBtn.className = 'btn btn-primary w-full mb-8';
    addFactBtn.textContent = '+ Добавить факт (расход)';
    addFactBtn.addEventListener('click', () => {
      _closeModal(overlay);
      openForm('expense', {
        orderId: order.id,
        orderLineId: line.id,
        currency: line.currency || order.currency,
        purpose: line.name
      });
    });
    dialog.appendChild(addFactBtn);
  }

  // Кнопки редактирования и удаления позиции
  const actionRow = document.createElement('div');
  actionRow.className = 'flex-row gap-8 mt-12';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-secondary flex-1';
  editBtn.textContent = '✎ Изменить';
  editBtn.addEventListener('click', () => {
    _closeModal(overlay);
    _openEditOrderLineDialog(line, order, pageContainer);
  });
  actionRow.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger flex-1';
  delBtn.textContent = 'Удалить';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Удалить позицию "${line.name}"?`)) return;
    line.deleted = true;
    line.updated_at = new Date().toISOString();
    await put('order_lines', line);
    await addToOutbox({ sheet: 'order_lines', data: line });
    showToast('Позиция удалена');
    _closeModal(overlay);
    renderOrderCard(pageContainer, { id: order.id });
  });
  actionRow.appendChild(delBtn);

  dialog.appendChild(actionRow);

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

/**
 * Редактирование существующей позиции плана
 */
function _openEditOrderLineDialog(line, order, pageContainer) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Редактировать позицию';
  dialog.appendChild(title);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  form.appendChild(_fieldGroup('Название позиции', 'text', 'line-name', { value: line.name, required: true }));

  const qtyRow = document.createElement('div');
  qtyRow.className = 'flex-row gap-8';
  qtyRow.appendChild(_fieldGroup('Количество', 'number', 'line-qty', { value: line.qty || '', inputmode: 'decimal', step: '0.01' }));
  qtyRow.appendChild(_fieldGroup('Ед. изм.', 'text', 'line-unit', { value: line.unit || '' }));
  form.appendChild(qtyRow);

  form.appendChild(_fieldGroup('Цена за ед.', 'number', 'line-unit-price', { value: line.unit_price || '', inputmode: 'decimal', step: '0.01' }));

  form.appendChild(_fieldGroup('Плановая сумма', 'number', 'line-plan-amount', {
    value: line.plan_amount,
    inputmode: 'decimal',
    step: '0.01',
    required: true
  }));

  const qtyInput = form.querySelector('[name="line-qty"]');
  const unitPriceInput = form.querySelector('[name="line-unit-price"]');
  const planInput = form.querySelector('[name="line-plan-amount"]');

  function _recalcPlan() {
    const q = parseFloat(qtyInput.value);
    const p = parseFloat(unitPriceInput.value);
    if (!isNaN(q) && !isNaN(p) && q > 0 && p > 0) {
      planInput.value = (q * p).toFixed(2);
    }
  }
  qtyInput.addEventListener('input', _recalcPlan);
  unitPriceInput.addEventListener('input', _recalcPlan);

  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const nLabel = document.createElement('label');
  nLabel.textContent = 'Примечание';
  noteGroup.appendChild(nLabel);
  const nInput = document.createElement('textarea');
  nInput.name = 'line-note';
  nInput.rows = 2;
  nInput.value = line.note || '';
  noteGroup.appendChild(nInput);
  form.appendChild(noteGroup);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Сохранить';
  saveBtn.addEventListener('click', async () => {
    const name = form.querySelector('[name="line-name"]').value.trim();
    const qty = parseFloat(qtyInput.value) || '';
    const unit = form.querySelector('[name="line-unit"]').value.trim();
    const unitPrice = parseFloat(unitPriceInput.value) || '';
    const planAmount = parseFloat(planInput.value) || 0;
    const note = form.querySelector('[name="line-note"]').value.trim();

    if (!name) {
      showToast('Укажите название позиции');
      return;
    }
    if (planAmount <= 0) {
      showToast('Плановая сумма должна быть больше 0');
      return;
    }

    line.name = name;
    line.qty = qty;
    line.unit = unit;
    line.unit_price = unitPrice;
    line.plan_amount = planAmount;
    line.note = note;
    line.updated_at = new Date().toISOString();

    await put('order_lines', line);
    await addToOutbox({ sheet: 'order_lines', data: line });

    showToast('Позиция обновлена');
    _closeModal(overlay);
    renderOrderCard(pageContainer, { id: order.id });
  });

  btnGroup.appendChild(saveBtn);
  dialog.appendChild(form);
  dialog.appendChild(btnGroup);

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

/**
 * Привязка внепланового расхода к позиции плана
 */
function _openLinkOpToLineDialog(op, lines, order, pageContainer) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Привязать расход к позиции';
  dialog.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'modal-subtitle';
  sub.textContent = `${fmtAmount.format(op.amount)} ${op.currency} · ${op.purpose || 'Расход'}`;
  dialog.appendChild(sub);

  const form = document.createElement('form');
  form.addEventListener('submit', e => e.preventDefault());

  const group = document.createElement('div');
  group.className = 'form-group';
  const label = document.createElement('label');
  label.textContent = 'Выберите позицию плана';
  group.appendChild(label);

  const select = document.createElement('select');
  for (const line of lines.filter(l => l.type !== 'labor_own')) {
    const opt = document.createElement('option');
    opt.value = line.id;
    opt.textContent = `${line.name} (${TYPE_NAMES[line.type] || line.type})`;
    select.appendChild(opt);
  }
  group.appendChild(select);
  form.appendChild(group);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Привязать';
  saveBtn.addEventListener('click', async () => {
    const selectedLineId = select.value;
    if (!selectedLineId) {
      showToast('Выберите позицию плана');
      return;
    }

    op.order_line_id = selectedLineId;
    op.updated_at = new Date().toISOString();
    await put('ops', op);
    await addToOutbox({ sheet: 'ops', data: op });

    showToast('Расход привязан к позиции');
    _closeModal(overlay);
    renderOrderCard(pageContainer, { id: order.id });
  });

  btnGroup.appendChild(saveBtn);
  dialog.appendChild(form);
  dialog.appendChild(btnGroup);

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

/**
 * Завершение заказа (диалог с предложением создать долг при недоплате)
 */
async function _completeOrder(order, summary, pageContainer) {
  const price = parseFloat(order.price) || 0;
  const received = summary.received;
  const underpaid = price - received;
  const cur = order.currency;

  if (underpaid > 0) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.textContent = 'Завершение заказа';
    dialog.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'p-12 bg-subtle radius-sm mb-16 font-sm';
    desc.innerHTML = `
      <p class="mb-8">Клиент оплатил заказ не полностью: получено <strong>${fmtAmount.format(received)} ${cur}</strong> из <strong>${fmtAmount.format(price)} ${cur}</strong>.</p>
      <p class="mb-0 text-warning font-bold">Остаток к оплате: ${fmtAmount.format(underpaid)} ${cur}.</p>
    `;
    dialog.appendChild(desc);

    const prompt = document.createElement('p');
    prompt.className = 'font-sm mb-16';
    prompt.textContent = 'Создать долг (Мне должны) на этот остаток без движения кассы?';
    dialog.appendChild(prompt);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons flex-col gap-8';

    // Вариант 1: Завершить и создать долг
    const createDebtBtn = document.createElement('button');
    createDebtBtn.type = 'button';
    createDebtBtn.className = 'btn btn-primary';
    createDebtBtn.textContent = `Создать долг ${fmtAmount.format(underpaid)} ${cur} и завершить`;
    createDebtBtn.addEventListener('click', async () => {
      const now = new Date().toISOString();
      const debtId = crypto.randomUUID();

      // Создаём долг (cash_moved = FALSE)
      const newDebt = {
        id: debtId,
        direction: 'owed_to_me',
        counterparty: order.client || 'Клиент заказа',
        amount: underpaid,
        currency: cur,
        date: getTodayDateString(),
        due_date: '',
        purpose: `Остаток по заказу "${order.name}"`,
        order_id: order.id,
        cash_moved: false,
        status: 'open',
        note: `Автоматически создан при завершении заказа "${order.name}"`,
        created_at: now,
        updated_at: now,
        deleted: false
      };

      await put('debts', newDebt);
      await addToOutbox({ sheet: 'debts', data: newDebt });

      // Завершаем заказ
      order.status = 'done';
      order.closed_at = now;
      order.updated_at = now;
      await put('orders', order);
      await addToOutbox({ sheet: 'orders', data: order });

      showToast('Заказ завершён, создан долг');
      _closeModal(overlay);
      renderOrderCard(pageContainer, { id: order.id });
    });
    btnGroup.appendChild(createDebtBtn);

    // Вариант 2: Завершить без долга
    const noDebtBtn = document.createElement('button');
    noDebtBtn.type = 'button';
    noDebtBtn.className = 'btn btn-secondary';
    noDebtBtn.textContent = 'Завершить без создания долга';
    noDebtBtn.addEventListener('click', async () => {
      const now = new Date().toISOString();
      order.status = 'done';
      order.closed_at = now;
      order.updated_at = now;
      await put('orders', order);
      await addToOutbox({ sheet: 'orders', data: order });

      showToast('Заказ завершён');
      _closeModal(overlay);
      renderOrderCard(pageContainer, { id: order.id });
    });
    btnGroup.appendChild(noDebtBtn);

    dialog.appendChild(btnGroup);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.addEventListener('click', () => _closeModal(overlay));
    dialog.appendChild(closeBtn);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.offsetHeight;
    overlay.classList.add('visible');

  } else {
    // Получено >= price -> просто завершаем
    if (!confirm('Завершить заказ? Плановые остатки расходов будут отброшены.')) return;
    const now = new Date().toISOString();
    order.status = 'done';
    order.closed_at = now;
    order.updated_at = now;
    await put('orders', order);
    await addToOutbox({ sheet: 'orders', data: order });

    showToast('Заказ успешно завершён!');
    renderOrderCard(pageContainer, { id: order.id });
  }
}

/**
 * Копирование заказа как нового
 */
async function _copyOrder(order, lines) {
  if (!confirm(`Создать копию заказа "${order.name}" с плановыми позициями?`)) return;

  const now = new Date().toISOString();
  const newOrderId = crypto.randomUUID();

  const newOrder = {
    id: newOrderId,
    name: `${order.name} (копия)`,
    client: order.client || '',
    status: 'planned',
    currency: order.currency,
    price: order.price,
    start_date: getTodayDateString(),
    due_date: '',
    closed_at: '',
    note: order.note || '',
    created_at: now,
    updated_at: now,
    deleted: false
  };

  await put('orders', newOrder);
  await addToOutbox({ sheet: 'orders', data: newOrder });

  // Копируем плановые позиции (без фактов)
  for (const l of lines) {
    const newLine = {
      id: crypto.randomUUID(),
      order_id: newOrderId,
      type: l.type,
      name: l.name,
      qty: l.qty,
      unit: l.unit,
      unit_price: l.unit_price,
      plan_amount: l.plan_amount,
      currency: l.currency || order.currency,
      fact_amount: 0,
      note: l.note || '',
      sort: l.sort || Date.now(),
      created_at: now,
      updated_at: now,
      deleted: false
    };
    await put('order_lines', newLine);
    await addToOutbox({ sheet: 'order_lines', data: newLine });
  }

  showToast('Заказ скопирован');
  navigate(`#/orders/${newOrderId}`);
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
    else if (k === 'value') i.value = v;
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
