// calc.js — Чистые расчёты (бизнес-логика без DOM)
// Все формулы из раздела 5 ТЗ
// Округление до 2 знаков только в конце расчёта

import { getEffectiveRate } from './rates.js';

/**
 * Округление до 2 знаков после запятой
 * @param {number} n
 * @returns {number}
 */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Вспомогательная: фильтр удалённых записей
 */
function active(items) {
  return items.filter(i =>
    i.deleted !== true &&
    i.deleted !== 'TRUE' &&
    i.deleted !== 'true'
  );
}

/**
 * Вспомогательная: парсинг числа
 */
function num(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ==================== ДЕНЬГИ ====================

/**
 * Расчёт «Доступно» по каждой валюте и в базовой
 * Операции с debt_id УЧИТЫВАЮТСЯ (двигают кассу)
 *
 * @param {Array} ops — операции
 * @param {Array} rates — курсы
 * @param {string} baseCurrency
 * @returns {{ byCurrency: Object, totalBase: number }}
 */
export function calcAvailable(ops, rates, baseCurrency = 'MDL') {
  const activeOps = active(ops);
  const byCurrency = {};

  for (const op of activeOps) {
    const cur = op.currency;
    if (!byCurrency[cur]) byCurrency[cur] = 0;

    const amount = num(op.amount);
    if (op.type === 'income') {
      byCurrency[cur] += amount;
    } else if (op.type === 'expense') {
      byCurrency[cur] -= amount;
    }
  }

  // Округляем по валютам
  for (const cur of Object.keys(byCurrency)) {
    byCurrency[cur] = round2(byCurrency[cur]);
  }

  // Итог в базовой валюте
  let totalBase = 0;
  for (const [cur, amount] of Object.entries(byCurrency)) {
    const rate = getEffectiveRate(cur, rates, baseCurrency);
    if (rate !== null) {
      totalBase += amount * rate;
    }
  }

  return { byCurrency, totalBase: round2(totalBase) };
}

/**
 * Итоги доходов/расходов БЕЗ операций с debt_id
 * @param {Array} ops
 * @param {Array} rates
 * @param {string} baseCurrency
 * @returns {{ income: { byCurrency, totalBase }, expense: { byCurrency, totalBase }, diff: { byCurrency, totalBase } }}
 */
export function calcIncomeExpenseTotals(ops, rates, baseCurrency = 'MDL') {
  const activeOps = active(ops).filter(op => !op.debt_id);

  const income = {};
  const expense = {};

  for (const op of activeOps) {
    const cur = op.currency;
    const amount = num(op.amount);

    if (op.type === 'income') {
      income[cur] = (income[cur] || 0) + amount;
    } else if (op.type === 'expense') {
      expense[cur] = (expense[cur] || 0) + amount;
    }
  }

  // Округляем
  for (const cur of Object.keys(income)) income[cur] = round2(income[cur]);
  for (const cur of Object.keys(expense)) expense[cur] = round2(expense[cur]);

  // Разница по валютам
  const allCurrencies = new Set([...Object.keys(income), ...Object.keys(expense)]);
  const diff = {};
  for (const cur of allCurrencies) {
    diff[cur] = round2((income[cur] || 0) - (expense[cur] || 0));
  }

  // В базовой валюте
  let incomeTotalBase = 0, expenseTotalBase = 0;
  for (const [cur, amount] of Object.entries(income)) {
    const rate = getEffectiveRate(cur, rates, baseCurrency);
    if (rate !== null) incomeTotalBase += amount * rate;
  }
  for (const [cur, amount] of Object.entries(expense)) {
    const rate = getEffectiveRate(cur, rates, baseCurrency);
    if (rate !== null) expenseTotalBase += amount * rate;
  }

  return {
    income: { byCurrency: income, totalBase: round2(incomeTotalBase) },
    expense: { byCurrency: expense, totalBase: round2(expenseTotalBase) },
    diff: { byCurrency: diff, totalBase: round2(incomeTotalBase - expenseTotalBase) }
  };
}

// ==================== ДОЛГИ ====================

/**
 * Остаток долга
 * amount - Σ погашений (операции с debt_id==debt.id и debt_role=="repayment")
 *
 * @param {Object} debt
 * @param {Array} ops — все операции
 * @returns {number}
 */
export function calcDebtRemainder(debt, ops) {
  const activeOps = active(ops);
  const repayments = activeOps.filter(op =>
    op.debt_id === debt.id && op.debt_role === 'repayment'
  );
  const totalRepaid = repayments.reduce((sum, op) => sum + num(op.amount), 0);
  return round2(num(debt.amount) - totalRepaid);
}

/**
 * Сумма остатков открытых долгов по направлению
 * @param {Array} debts
 * @param {Array} ops
 * @param {Array} rates
 * @param {string} direction — 'owed_to_me' или 'i_owe'
 * @param {string} baseCurrency
 * @returns {{ byCurrency: Object, totalBase: number }}
 */
export function calcDebtsTotal(debts, ops, rates, direction, baseCurrency = 'MDL') {
  const activeDebts = active(debts).filter(d =>
    d.direction === direction && d.status !== 'closed' && d.status !== 'written_off'
  );

  const byCurrency = {};

  for (const debt of activeDebts) {
    const remainder = calcDebtRemainder(debt, ops);
    if (remainder > 0) {
      const cur = debt.currency;
      byCurrency[cur] = (byCurrency[cur] || 0) + remainder;
    }
  }

  // Округляем
  for (const cur of Object.keys(byCurrency)) {
    byCurrency[cur] = round2(byCurrency[cur]);
  }

  // В базовой валюте
  let totalBase = 0;
  for (const [cur, amount] of Object.entries(byCurrency)) {
    const rate = getEffectiveRate(cur, rates, baseCurrency);
    if (rate !== null) totalBase += amount * rate;
  }

  return { byCurrency, totalBase: round2(totalBase) };
}

// ==================== ЗАКАЗЫ ====================

/**
 * Полная сводка по заказу
 * Все суммы приводятся к валюте заказа по текущим курсам
 *
 * @param {Object} order
 * @param {Array} orderLines — позиции этого заказа
 * @param {Array} ops — все операции
 * @param {Array} rates
 * @param {string} baseCurrency
 * @returns {Object}
 */
export function calcOrderSummary(order, orderLines, ops, rates, baseCurrency = 'MDL') {
  const activeLines = active(orderLines).filter(l => l.order_id === order.id);
  const activeOps = active(ops).filter(op => op.order_id === order.id && !op.debt_id);
  const orderCur = order.currency;
  const orderRate = getEffectiveRate(orderCur, rates, baseCurrency);
  const price = num(order.price);

  // Вспомогательная: конвертация суммы из валюты позиции в валюту заказа
  function toOrderCurrency(amount, currency) {
    if (currency === orderCur) return amount;
    const srcRate = getEffectiveRate(currency, rates, baseCurrency);
    if (srcRate === null || orderRate === null || orderRate === 0) return amount;
    // amount * srcRate = сумма в базовой; / orderRate = сумма в валюте заказа
    return (amount * srcRate) / orderRate;
  }

  // Плановые затраты (без labor_own)
  let plannedCosts = 0;
  let laborOwnPlan = 0;

  for (const line of activeLines) {
    const planAmount = toOrderCurrency(num(line.plan_amount), line.currency || orderCur);
    if (line.type === 'labor_own') {
      laborOwnPlan += planAmount;
    } else {
      plannedCosts += planAmount;
    }
  }

  // Плановая прибыль
  const plannedProfit = price - plannedCosts;
  const profitAboveLabor = price - plannedCosts - laborOwnPlan;

  // Факт по позициям
  const factByLine = {};
  const orderExpenses = activeOps.filter(op => op.type === 'expense');
  const orderIncomes = activeOps.filter(op => op.type === 'income');

  for (const op of orderExpenses) {
    if (op.order_line_id) {
      factByLine[op.order_line_id] = (factByLine[op.order_line_id] || 0) +
        toOrderCurrency(num(op.amount), op.currency);
    }
  }

  // Внеплановые расходы (без привязки к позиции)
  let unplannedFact = 0;
  for (const op of orderExpenses) {
    if (!op.order_line_id) {
      unplannedFact += toOrderCurrency(num(op.amount), op.currency);
    }
  }

  // Фактические затраты — все расходы заказа (кроме с debt_id, уже отфильтрованы)
  let totalFactCosts = 0;
  for (const op of orderExpenses) {
    totalFactCosts += toOrderCurrency(num(op.amount), op.currency);
  }

  // Получено — все доходы заказа
  let received = 0;
  for (const op of orderIncomes) {
    received += toOrderCurrency(num(op.amount), op.currency);
  }

  // Фактическая прибыль
  const actualProfit = received - totalFactCosts;

  // Отклонение по позициям
  const deviationByLine = {};
  for (const line of activeLines) {
    const planInOrderCur = toOrderCurrency(num(line.plan_amount), line.currency || orderCur);
    const fact = factByLine[line.id] || 0;
    deviationByLine[line.id] = fact - planInOrderCur;
  }

  // Ожидаемые суммы — только для активных заказов
  const isActive = (order.status === 'planned' || order.status === 'in_progress');

  let expectedIncome = 0;
  let expectedExpense = 0;

  if (isActive) {
    expectedIncome = Math.max(0, price - received);

    for (const line of activeLines) {
      if (line.type === 'labor_own') continue; // Моя работа не считается
      const planInOrderCur = toOrderCurrency(num(line.plan_amount), line.currency || orderCur);
      const fact = factByLine[line.id] || 0;
      expectedExpense += Math.max(0, planInOrderCur - fact);
    }
  }

  return {
    plannedCosts: round2(plannedCosts),
    plannedProfit: round2(plannedProfit),
    laborOwnPlan: round2(laborOwnPlan),
    profitAboveLabor: round2(profitAboveLabor),
    factByLine,
    unplannedFact: round2(unplannedFact),
    totalFactCosts: round2(totalFactCosts),
    received: round2(received),
    actualProfit: round2(actualProfit),
    deviationByLine,
    expectedIncome: round2(expectedIncome),
    expectedExpense: round2(expectedExpense)
  };
}

/**
 * Расчёт ожидаемых сумм по всем активным заказам
 * @param {Array} orders
 * @param {Array} orderLines
 * @param {Array} ops
 * @param {Array} rates
 * @param {string} baseCurrency
 * @returns {Object}
 */
export function calcOrdersExpected(orders, orderLines, ops, rates, baseCurrency = 'MDL') {
  const activeOrders = active(orders).filter(o => o.status === 'planned' || o.status === 'in_progress');

  const incomeByCurrency = {};
  const expenseByCurrency = {};
  const netByCurrency = {};

  let totalIncomeBase = 0;
  let totalExpenseBase = 0;

  for (const order of activeOrders) {
    const summary = calcOrderSummary(order, orderLines, ops, rates, baseCurrency);
    const cur = order.currency || baseCurrency;

    if (summary.expectedIncome > 0) {
      incomeByCurrency[cur] = (incomeByCurrency[cur] || 0) + summary.expectedIncome;
      const rate = getEffectiveRate(cur, rates, baseCurrency);
      if (rate !== null) {
        totalIncomeBase += summary.expectedIncome * rate;
      }
    }

    if (summary.expectedExpense > 0) {
      expenseByCurrency[cur] = (expenseByCurrency[cur] || 0) + summary.expectedExpense;
      const rate = getEffectiveRate(cur, rates, baseCurrency);
      if (rate !== null) {
        totalExpenseBase += summary.expectedExpense * rate;
      }
    }
  }

  // Округляем суммы по валютам
  for (const cur of Object.keys(incomeByCurrency)) {
    incomeByCurrency[cur] = round2(incomeByCurrency[cur]);
  }
  for (const cur of Object.keys(expenseByCurrency)) {
    expenseByCurrency[cur] = round2(expenseByCurrency[cur]);
  }

  const allCurrencies = new Set([
    ...Object.keys(incomeByCurrency),
    ...Object.keys(expenseByCurrency)
  ]);

  for (const cur of allCurrencies) {
    netByCurrency[cur] = round2((incomeByCurrency[cur] || 0) - (expenseByCurrency[cur] || 0));
  }

  const totalNetBase = round2(totalIncomeBase - totalExpenseBase);

  return {
    incomeByCurrency,
    expenseByCurrency,
    netByCurrency,
    byCurrency: netByCurrency, // Для совместимости с функцией отображения плитки
    totalIncomeBase: round2(totalIncomeBase),
    totalExpenseBase: round2(totalExpenseBase),
    totalNetBase,
    totalBase: totalNetBase // Для совместимости с функцией отображения плитки
  };
}

// ==================== ПРОГНОЗ ====================

/**
 * Прогноз = Доступно + Мне должны - Я должен + Ожидается поступлений - Ожидается расходов
 * Всё в базовой валюте и отдельно по валютам
 *
 * @param {Object} available — { byCurrency, totalBase }
 * @param {Object} owedToMe — { byCurrency, totalBase }
 * @param {Object} iOwe — { byCurrency, totalBase }
 * @param {Object|number} ordersExpected — результат calcOrdersExpected или число ожидаемых поступлений
 * @param {number} [expectedExpenseNum=0] — ожидаемые расходы в базовой (если ordersExpected число)
 * @returns {{ totalBase: number, byCurrency: Object }}
 */
export function calcForecast(available, owedToMe, iOwe, ordersExpected = {}, expectedExpenseNum = 0) {
  let expIncomeBase = 0;
  let expExpenseBase = 0;
  let expIncomeByCur = {};
  let expExpenseByCur = {};

  if (typeof ordersExpected === 'number') {
    expIncomeBase = ordersExpected;
    expExpenseBase = typeof expectedExpenseNum === 'number' ? expectedExpenseNum : 0;
  } else if (ordersExpected && typeof ordersExpected === 'object') {
    expIncomeBase = num(ordersExpected.totalIncomeBase);
    expExpenseBase = num(ordersExpected.totalExpenseBase);
    expIncomeByCur = ordersExpected.incomeByCurrency || {};
    expExpenseByCur = ordersExpected.expenseByCurrency || {};
  }

  const totalBase = round2(
    num(available.totalBase) +
    num(owedToMe.totalBase) -
    num(iOwe.totalBase) +
    expIncomeBase -
    expExpenseBase
  );

  // По валютам
  const allCurrencies = new Set([
    ...Object.keys(available.byCurrency || {}),
    ...Object.keys(owedToMe.byCurrency || {}),
    ...Object.keys(iOwe.byCurrency || {}),
    ...Object.keys(expIncomeByCur),
    ...Object.keys(expExpenseByCur)
  ]);

  const byCurrency = {};
  for (const cur of allCurrencies) {
    byCurrency[cur] = round2(
      ((available.byCurrency && available.byCurrency[cur]) || 0) +
      ((owedToMe.byCurrency && owedToMe.byCurrency[cur]) || 0) -
      ((iOwe.byCurrency && iOwe.byCurrency[cur]) || 0) +
      (expIncomeByCur[cur] || 0) -
      (expExpenseByCur[cur] || 0)
    );
  }

  return { totalBase, byCurrency };
}
