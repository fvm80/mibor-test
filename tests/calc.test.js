// calc.test.js — Тесты бизнес-логики (calc.js)
// Данные и ожидаемые результаты из раздела 10 ТЗ
// Запускается в браузере как ES-модуль без сборки

import {
  round2,
  calcAvailable,
  calcDebtRemainder,
  calcDebtsTotal,
  calcOrderSummary,
  calcIncomeExpenseTotals,
  calcForecast
} from '../js/calc.js';
import { runDateTests } from './dates.test.js';

// === Мини-фреймворк тестирования ===

const suites = [];
let currentSuite = null;

function describe(name, fn) {
  currentSuite = { name, tests: [] };
  suites.push(currentSuite);
  fn();
  currentSuite = null;
}

function it(name, fn) {
  const test = { name, passed: true, error: null };
  try {
    fn();
  } catch (err) {
    test.passed = false;
    test.error = err.message;
  }
  if (currentSuite) {
    currentSuite.tests.push(test);
  }
}

const assert = {
  equal(actual, expected, msg = '') {
    if (actual !== expected) {
      throw new Error(
        `${msg ? msg + ': ' : ''}ожидалось ${expected}, получено ${actual}`
      );
    }
  },
  closeTo(actual, expected, delta = 0.01, msg = '') {
    if (Math.abs(actual - expected) > delta) {
      throw new Error(
        `${msg ? msg + ': ' : ''}ожидалось ≈${expected} (±${delta}), получено ${actual}`
      );
    }
  },
  isTrue(value, msg = '') {
    if (value !== true) {
      throw new Error(`${msg ? msg + ': ' : ''}ожидалось true, получено ${value}`);
    }
  }
};

// === Общие тестовые данные ===

// Курсы: USD = 18.2 MDL, EUR = 20 MDL
const testRates = [
  { currency: 'USD', rate_auto: 18.2, rate_auto_at: '2026-11-22T10:00:00Z', rate_manual: null, mode: 'auto', source: 'test' },
  { currency: 'EUR', rate_auto: 20, rate_auto_at: '2026-11-22T10:00:00Z', rate_manual: null, mode: 'auto', source: 'test' }
];

// === ТЕСТ 10.1: Данные из черновика пользователя ===

describe('10.1 Данные из черновика', () => {
  // Операции
  const ops = [
    // Доход 1 900 USD, «Двери для Вовы»
    { id: 'op1', type: 'income', amount: 1900, currency: 'USD', date: '2026-11-20',
      counterparty: '', purpose: 'Двери для Вовы', category: '', order_id: '', order_line_id: '',
      debt_id: '', debt_role: '', note: '', deleted: false },
    // Доход 20 000 MDL, «продажа грузовика»
    { id: 'op2', type: 'income', amount: 20000, currency: 'MDL', date: '2026-11-20',
      counterparty: '', purpose: 'продажа грузовика', category: '', order_id: '', order_line_id: '',
      debt_id: '', debt_role: '', note: '', deleted: false },
    // Автоматический расход от долга с cash_moved=TRUE (7 600 MDL)
    { id: 'op3', type: 'expense', amount: 7600, currency: 'MDL', date: '2026-11-19',
      counterparty: '', purpose: 'за переоформление документов', category: '', order_id: '', order_line_id: '',
      debt_id: 'debt2', debt_role: 'principal', note: '', deleted: false }
  ];

  // Долги
  const debts = [
    // owed_to_me: 600 EUR, Олег, cash_moved=FALSE
    { id: 'debt1', direction: 'owed_to_me', counterparty: 'Олег', amount: 600, currency: 'EUR',
      date: '2026-11-20', due_date: '', purpose: 'за аренду', order_id: '',
      cash_moved: false, status: 'open', note: '', deleted: false },
    // owed_to_me: 7 600 MDL, cash_moved=TRUE
    { id: 'debt2', direction: 'owed_to_me', counterparty: '', amount: 7600, currency: 'MDL',
      date: '2026-11-19', due_date: '', purpose: 'за переоформление документов', order_id: '',
      cash_moved: true, status: 'open', note: '', deleted: false }
  ];

  it('Доступно USD = 1 900', () => {
    const avail = calcAvailable(ops, testRates, 'MDL');
    assert.closeTo(avail.byCurrency['USD'], 1900, 0.01);
  });

  it('Доступно MDL = 12 400 (20000 - 7600)', () => {
    const avail = calcAvailable(ops, testRates, 'MDL');
    assert.closeTo(avail.byCurrency['MDL'], 12400, 0.01);
  });

  it('Доступно в базовой MDL = 46 980 (12400 + 1900×18.2)', () => {
    const avail = calcAvailable(ops, testRates, 'MDL');
    assert.closeTo(avail.totalBase, 46980, 0.01);
  });

  it('Остаток долга Олега = 600 EUR', () => {
    const remainder = calcDebtRemainder(debts[0], ops);
    assert.closeTo(remainder, 600, 0.01);
  });

  it('Остаток долга за документы = 7 600 MDL', () => {
    const remainder = calcDebtRemainder(debts[1], ops);
    assert.closeTo(remainder, 7600, 0.01);
  });

  it('Мне должны EUR = 600', () => {
    const owed = calcDebtsTotal(debts, ops, testRates, 'owed_to_me', 'MDL');
    assert.closeTo(owed.byCurrency['EUR'], 600, 0.01);
  });

  it('Мне должны MDL = 7 600', () => {
    const owed = calcDebtsTotal(debts, ops, testRates, 'owed_to_me', 'MDL');
    assert.closeTo(owed.byCurrency['MDL'], 7600, 0.01);
  });

  it('Мне должны в базовой MDL = 19 600 (600×20 + 7600)', () => {
    const owed = calcDebtsTotal(debts, ops, testRates, 'owed_to_me', 'MDL');
    assert.closeTo(owed.totalBase, 19600, 0.01);
  });

  it('Итоги доходов (без долговых): income MDL = 20 000, USD = 1 900', () => {
    const totals = calcIncomeExpenseTotals(ops, testRates, 'MDL');
    assert.closeTo(totals.income.byCurrency['MDL'], 20000, 0.01);
    assert.closeTo(totals.income.byCurrency['USD'], 1900, 0.01);
  });

  it('Итоги расходов (без долговых): расходы = 0 (расход 7600 имеет debt_id)', () => {
    const totals = calcIncomeExpenseTotals(ops, testRates, 'MDL');
    // Расход op3 имеет debt_id, поэтому не считается
    const expenseMDL = totals.expense.byCurrency['MDL'] || 0;
    assert.closeTo(expenseMDL, 0, 0.01);
  });
});

// === ТЕСТ 10.2: Погашение ===

describe('10.2 Погашение долга Олега', () => {
  // Те же операции + погашение
  const ops = [
    { id: 'op1', type: 'income', amount: 1900, currency: 'USD', date: '2026-11-20',
      counterparty: '', purpose: 'Двери для Вовы', debt_id: '', debt_role: '', deleted: false },
    { id: 'op2', type: 'income', amount: 20000, currency: 'MDL', date: '2026-11-20',
      counterparty: '', purpose: 'продажа грузовика', debt_id: '', debt_role: '', deleted: false },
    { id: 'op3', type: 'expense', amount: 7600, currency: 'MDL', date: '2026-11-19',
      counterparty: '', purpose: 'за переоформление документов',
      debt_id: 'debt2', debt_role: 'principal', deleted: false },
    // Погашение 200 EUR от Олега (owed_to_me → income)
    { id: 'op4', type: 'income', amount: 200, currency: 'EUR', date: '2026-11-22',
      counterparty: 'Олег', purpose: 'погашение',
      debt_id: 'debt1', debt_role: 'repayment', deleted: false }
  ];

  const debts = [
    { id: 'debt1', direction: 'owed_to_me', counterparty: 'Олег', amount: 600, currency: 'EUR',
      date: '2026-11-20', purpose: 'за аренду', cash_moved: false, status: 'open', deleted: false },
    { id: 'debt2', direction: 'owed_to_me', counterparty: '', amount: 7600, currency: 'MDL',
      date: '2026-11-19', purpose: 'за переоформление документов',
      cash_moved: true, status: 'open', deleted: false }
  ];

  it('Остаток долга Олега = 400 EUR', () => {
    const remainder = calcDebtRemainder(debts[0], ops);
    assert.closeTo(remainder, 400, 0.01);
  });

  it('Доступно EUR = 200 (от погашения)', () => {
    const avail = calcAvailable(ops, testRates, 'MDL');
    assert.closeTo(avail.byCurrency['EUR'], 200, 0.01);
  });

  it('Мне должны EUR = 400 (после погашения)', () => {
    const owed = calcDebtsTotal(debts, ops, testRates, 'owed_to_me', 'MDL');
    assert.closeTo(owed.byCurrency['EUR'], 400, 0.01);
  });

  it('Мне должны в MDL уменьшились на 4 000 (200×20)', () => {
    // До погашения: 600×20 + 7600 = 19600
    // После: 400×20 + 7600 = 15600
    // Разница: 4000
    const owed = calcDebtsTotal(debts, ops, testRates, 'owed_to_me', 'MDL');
    assert.closeTo(owed.totalBase, 15600, 0.01);
  });

  it('Итоги доходов/расходов не меняются (операция с debt_id)', () => {
    const totals = calcIncomeExpenseTotals(ops, testRates, 'MDL');
    // Доходы: 1900 USD + 20000 MDL (op4 с debt_id не входит)
    assert.closeTo(totals.income.byCurrency['USD'], 1900, 0.01);
    assert.closeTo(totals.income.byCurrency['MDL'], 20000, 0.01);
    // EUR-дохода в итогах нет
    assert.closeTo(totals.income.byCurrency['EUR'] || 0, 0, 0.01);
  });
});

// === ТЕСТ 10.3: Заказ ===

describe('10.3 Заказ «Тестовый»', () => {
  const order = {
    id: 'order1', name: 'Тестовый', client: 'Клиент', status: 'in_progress',
    currency: 'USD', price: 1900, start_date: '2026-11-01', due_date: '',
    closed_at: '', note: '', deleted: false
  };

  const orderLines = [
    { id: 'line1', order_id: 'order1', type: 'material', name: 'материалы',
      qty: null, unit: '', unit_price: null, plan_amount: 600, currency: 'USD',
      fact_amount: null, note: '', sort: 1, deleted: false },
    { id: 'line2', order_id: 'order1', type: 'material', name: 'фурнитура',
      qty: null, unit: '', unit_price: null, plan_amount: 150, currency: 'USD',
      fact_amount: null, note: '', sort: 2, deleted: false },
    { id: 'line3', order_id: 'order1', type: 'overhead', name: 'электричество',
      qty: null, unit: '', unit_price: null, plan_amount: 40, currency: 'USD',
      fact_amount: null, note: '', sort: 3, deleted: false },
    { id: 'line4', order_id: 'order1', type: 'labor_own', name: 'моя работа',
      qty: null, unit: '', unit_price: null, plan_amount: 400, currency: 'USD',
      fact_amount: null, note: '', sort: 4, deleted: false }
  ];

  it('Плановые затраты = 790 (без labor_own)', () => {
    const summary = calcOrderSummary(order, orderLines, [], testRates, 'MDL');
    assert.closeTo(summary.plannedCosts, 790, 0.01);
  });

  it('Плановая прибыль (деньги) = 1 110', () => {
    const summary = calcOrderSummary(order, orderLines, [], testRates, 'MDL');
    assert.closeTo(summary.plannedProfit, 1110, 0.01);
  });

  it('Прибыль сверх моей работы = 710', () => {
    const summary = calcOrderSummary(order, orderLines, [], testRates, 'MDL');
    assert.closeTo(summary.profitAboveLabor, 710, 0.01);
  });

  // С фактическими данными
  const opsWithFact = [
    // Расход 640 USD на материалы
    { id: 'fop1', type: 'expense', amount: 640, currency: 'USD', date: '2026-11-15',
      order_id: 'order1', order_line_id: 'line1', debt_id: '', debt_role: '', deleted: false },
    // Поступление 950 USD от клиента
    { id: 'fop2', type: 'income', amount: 950, currency: 'USD', date: '2026-11-16',
      order_id: 'order1', order_line_id: '', debt_id: '', debt_role: '', deleted: false }
  ];

  it('Отклонение по материалам = +40 (перерасход)', () => {
    const summary = calcOrderSummary(order, orderLines, opsWithFact, testRates, 'MDL');
    assert.closeTo(summary.deviationByLine['line1'], 40, 0.01);
  });

  it('Получено = 950', () => {
    const summary = calcOrderSummary(order, orderLines, opsWithFact, testRates, 'MDL');
    assert.closeTo(summary.received, 950, 0.01);
  });

  it('Ожидается поступить = 950 (1900 - 950)', () => {
    const summary = calcOrderSummary(order, orderLines, opsWithFact, testRates, 'MDL');
    assert.closeTo(summary.expectedIncome, 950, 0.01);
  });

  it('Ожидается потратить = 190 (фурнитура 150 + электричество 40)', () => {
    // Материалы: max(0, 600-640) = 0
    // Фурнитура: max(0, 150-0) = 150
    // Электричество: max(0, 40-0) = 40
    // labor_own не считается
    const summary = calcOrderSummary(order, orderLines, opsWithFact, testRates, 'MDL');
    assert.closeTo(summary.expectedExpense, 190, 0.01);
  });

  it('Фактические затраты = 640', () => {
    const summary = calcOrderSummary(order, orderLines, opsWithFact, testRates, 'MDL');
    assert.closeTo(summary.totalFactCosts, 640, 0.01);
  });

  it('Фактическая прибыль = 310 (950 - 640)', () => {
    const summary = calcOrderSummary(order, orderLines, opsWithFact, testRates, 'MDL');
    assert.closeTo(summary.actualProfit, 310, 0.01);
  });

  // Завершение заказа
  it('При завершении: ожидаемые суммы = 0', () => {
    const doneOrder = { ...order, status: 'done' };
    const summary = calcOrderSummary(doneOrder, orderLines, opsWithFact, testRates, 'MDL');
    assert.closeTo(summary.expectedIncome, 0, 0.01);
    assert.closeTo(summary.expectedExpense, 0, 0.01);
  });
});

// === Тест round2 ===

describe('Утилита round2', () => {
  it('round2(1.005) = 1.01 или 1 (IEEE 754)', () => {
    // Из-за IEEE 754, 1.005 может округлиться как 1.00 или 1.01
    const result = round2(1.005);
    assert.isTrue(result === 1.0 || result === 1.01, `round2(1.005) = ${result}`);
  });

  it('round2(1.555) ≈ 1.56', () => {
    assert.closeTo(round2(1.555), 1.56, 0.01);
  });

  it('round2(0) = 0', () => {
    assert.equal(round2(0), 0);
  });
});

// Тесты модуля работы с датами
runDateTests(describe, it, assert);

// === Экспорт для запуска ===

export async function runTests() {
  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    for (const test of suite.tests) {
      if (test.passed) passed++;
      else failed++;
    }
  }

  return { suites, passed, failed };
}
