// home.js — Главная страница (#/home)
// Курсы, доступно, плитки, последние операции

import { getActiveData } from '../db.js';
import { calcAvailable, calcIncomeExpenseTotals, calcDebtsTotal } from '../calc.js';
import { formatRateDisplay, getEffectiveRate } from '../rates.js';

// Форматирование суммы: пробел-разделитель тысяч, запятая-десятичный
const fmtAmount = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

// Форматирование даты: дд.мм.гггг
const fmtDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric'
});

// Краткая дата+время для курсов
const fmtDateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});

/**
 * Отрисовать главную страницу
 * @param {HTMLElement} container
 */
export async function renderHome(container) {
  if (!container) return;
  container.innerHTML = '';

  try {
    const data = await getActiveData();
    const { ops, rates, settings, debts } = data;

    // Получаем базовую валюту
    const baseSetting = settings.find(s => s.key === 'base_currency');
    const baseCurrency = baseSetting ? baseSetting.value : 'MDL';

    // Получаем список валют
    const curSetting = settings.find(s => s.key === 'currencies');
    const currencies = curSetting ? JSON.parse(curSetting.value) : ['MDL', 'USD', 'EUR'];

    // === Секция курсов ===
    const ratesSection = createRatesSection(currencies, rates, baseCurrency);
    container.appendChild(ratesSection);

    // === Расчёты ===
    const available = calcAvailable(ops, rates, baseCurrency);
    const owedToMe = calcDebtsTotal(debts, ops, rates, 'owed_to_me', baseCurrency);
    const iOwe = calcDebtsTotal(debts, ops, rates, 'i_owe', baseCurrency);

    // === Главная карточка ===
    const mainCard = document.createElement('div');
    mainCard.className = 'card main-card';

    const availLabel = document.createElement('div');
    availLabel.className = 'card-label';
    availLabel.textContent = 'Доступно сейчас';
    mainCard.appendChild(availLabel);

    const availAmount = document.createElement('div');
    availAmount.className = 'card-amount amount';
    availAmount.textContent = `${fmtAmount.format(available.totalBase)} ${baseCurrency}`;
    mainCard.appendChild(availAmount);

    const forecastLabel = document.createElement('div');
    forecastLabel.className = 'card-sublabel';
    forecastLabel.textContent = 'Прогноз (этап 4)';
    mainCard.appendChild(forecastLabel);

    container.appendChild(mainCard);

    // === Плитки ===
    const tileGrid = document.createElement('div');
    tileGrid.className = 'tile-grid';

    // Плитка "Доступно"
    tileGrid.appendChild(createTile('Доступно', available, baseCurrency, currencies, rates));

    // Плитка "Мне должны"
    tileGrid.appendChild(createTile('Мне должны', owedToMe, baseCurrency, currencies, rates));

    // Плитка "Я должен"
    tileGrid.appendChild(createTile('Я должен', iOwe, baseCurrency, currencies, rates));

    // Плитка "Ожидается по заказам"
    const expectedTile = createTile('По заказам', { byCurrency: {}, totalBase: 0 }, baseCurrency, currencies, rates);
    const sub = document.createElement('div');
    sub.className = 'tile-sub';
    sub.textContent = 'Этап 3-4';
    expectedTile.appendChild(sub);
    tileGrid.appendChild(expectedTile);

    container.appendChild(tileGrid);

    // === Последние 5 операций ===
    const opsSection = document.createElement('div');
    opsSection.className = 'section';

    const opsTitle = document.createElement('h3');
    opsTitle.className = 'section-title';
    opsTitle.textContent = 'Последние операции';
    opsSection.appendChild(opsTitle);

    const sortedOps = [...ops]
      .sort((a, b) => (b.date || b.created_at || '').localeCompare(a.date || a.created_at || ''))
      .slice(0, 5);

    if (sortedOps.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = 'Нет операций';
      opsSection.appendChild(empty);
    } else {
      for (const op of sortedOps) {
        opsSection.appendChild(createOpItem(op));
      }
    }

    container.appendChild(opsSection);

  } catch (err) {
    console.error('Ошибка отрисовки главной:', err);
    const errorEl = document.createElement('p');
    errorEl.className = 'placeholder-text';
    errorEl.textContent = 'Ошибка загрузки данных';
    container.appendChild(errorEl);
  }
}

/**
 * Создать секцию курсов
 */
function createRatesSection(currencies, rates, baseCurrency) {
  const section = document.createElement('div');
  section.className = 'rates-bar';

  const nonBase = currencies.filter(c => c !== baseCurrency);

  if (nonBase.length === 0) {
    section.textContent = 'Только базовая валюта';
    return section;
  }

  const rateTexts = [];
  for (const cur of nonBase) {
    const info = formatRateDisplay(cur, rates, baseCurrency);
    rateTexts.push(`${cur} ${info.display}`);
  }

  const rateStr = document.createElement('span');
  rateStr.className = 'rates-values';
  rateStr.textContent = rateTexts.join(' · ');
  section.appendChild(rateStr);

  // Подпись с временем обновления
  const firstNonBase = rates.find(r => nonBase.includes(r.currency));
  if (firstNonBase) {
    const info = formatRateDisplay(firstNonBase.currency, rates, baseCurrency);
    const sub = document.createElement('div');
    sub.className = 'rates-sub';

    if (info.updatedAt) {
      sub.textContent = `обновлено ${fmtDateTime.format(info.updatedAt)}, ${info.source}`;
    } else {
      sub.textContent = info.source || 'нет данных';
    }

    if (info.stale) {
      sub.classList.add('text-warning');
      if (info.updatedAt) {
        sub.textContent = `курс от ${fmtDate.format(info.updatedAt)}`;
      }
    }

    section.appendChild(sub);
  }

  return section;
}

/**
 * Создать плитку
 */
function createTile(title, data, baseCurrency, currencies, rates) {
  const tile = document.createElement('div');
  tile.className = 'tile';

  const tileTitle = document.createElement('div');
  tileTitle.className = 'tile-title';
  tileTitle.textContent = title;
  tile.appendChild(tileTitle);

  const tileAmount = document.createElement('div');
  tileAmount.className = 'tile-amount amount';
  tileAmount.textContent = `${fmtAmount.format(data.totalBase)} ${baseCurrency}`;
  tile.appendChild(tileAmount);

  // Разбивка по валютам (скрыта по умолчанию)
  const details = document.createElement('div');
  details.className = 'tile-details hidden';

  for (const [cur, amount] of Object.entries(data.byCurrency)) {
    const line = document.createElement('div');
    line.className = 'tile-detail-line';

    let text = `${cur} ${fmtAmount.format(amount)}`;
    if (cur !== baseCurrency) {
      const rate = getEffectiveRate(cur, rates, baseCurrency);
      if (rate !== null) {
        text += ` (= ${fmtAmount.format(amount * rate)} ${baseCurrency})`;
      }
    }
    line.textContent = text;
    details.appendChild(line);
  }

  tile.appendChild(details);

  // Раскрытие по нажатию
  tile.addEventListener('click', () => {
    details.classList.toggle('hidden');
  });

  return tile;
}

/**
 * Создать элемент операции
 */
function createOpItem(op) {
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
  amountEl.textContent = `${fmtAmount.format(op.amount)} ${op.currency}`;
  info.appendChild(amountEl);

  const descParts = [op.counterparty, op.purpose].filter(Boolean);
  if (descParts.length > 0) {
    const desc = document.createElement('span');
    desc.className = 'op-desc';
    desc.textContent = descParts.join(' · ');
    info.appendChild(desc);
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

  return item;
}
