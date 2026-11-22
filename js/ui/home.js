// home.js — Главная страница (#/home)
// Курсы с диалогом, доступно, плитки, последние операции, pull-to-refresh

import { getActiveData, put, addToOutbox } from '../db.js';
import { calcAvailable, calcIncomeExpenseTotals, calcDebtsTotal, calcDebtRemainder } from '../calc.js';
import { formatRateDisplay, getEffectiveRate, isRateStale } from '../rates.js';
import { sync, refreshRates, scheduleSyncAfterChange } from '../sync.js';
import { navigate } from '../router.js';
import { showToast } from './toast.js';

// Форматирование суммы: пробел-разделитель тысяч, запятая-десятичный
const fmtAmount = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const fmtDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric'
});

const fmtDateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});

// Хранилище для pull-to-refresh
let touchStartY = 0;
let isPulling = false;

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

    const baseCurrency = _getSetting(settings, 'base_currency', 'MDL');
    const currencies = _getSettingJSON(settings, 'currencies', ['MDL', 'USD', 'EUR']);

    // === Pull-to-refresh индикатор ===
    const pullIndicator = document.createElement('div');
    pullIndicator.className = 'pull-indicator hidden';
    pullIndicator.id = 'pull-indicator';
    pullIndicator.textContent = '↓ Потяните для обновления';
    container.appendChild(pullIndicator);

    // === Секция курсов ===
    const ratesSection = _createRatesSection(currencies, rates, baseCurrency);
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
    forecastLabel.textContent = 'Прогноз — этап 4';
    mainCard.appendChild(forecastLabel);

    container.appendChild(mainCard);

    // === Плитки ===
    const tileGrid = document.createElement('div');
    tileGrid.className = 'tile-grid';

    tileGrid.appendChild(_createTile('Доступно', available, baseCurrency, rates));
    tileGrid.appendChild(_createTile('Мне должны', owedToMe, baseCurrency, rates));
    tileGrid.appendChild(_createTile('Я должен', iOwe, baseCurrency, rates));

    // Плитка «Ожидается по заказам» — заглушка до этапа 3
    const expTile = _createTile('По заказам', { byCurrency: {}, totalBase: 0 }, baseCurrency, rates);
    const sub = document.createElement('div');
    sub.className = 'tile-sub';
    sub.textContent = 'Этап 3–4';
    expTile.appendChild(sub);
    tileGrid.appendChild(expTile);

    container.appendChild(tileGrid);

    // === Предупреждения: просроченные долги ===
    const todayStr = new Date().toISOString().slice(0, 10);
    const overdueDebts = debts.filter(d =>
      d.status === 'open' &&
      d.due_date &&
      d.due_date < todayStr &&
      calcDebtRemainder(d, ops) > 0
    );

    if (overdueDebts.length > 0) {
      const alertBox = document.createElement('div');
      alertBox.className = 'alert-banner text-expense mb-12';
      alertBox.textContent = `⚠️ Просрочено долгов: ${overdueDebts.length} (нажмите, чтобы открыть)`;
      alertBox.style.cursor = 'pointer';
      alertBox.addEventListener('click', () => navigate('#/debts'));
      container.appendChild(alertBox);
    }

    // === Ближайшие долги (до 3) ===
    const openDebts = debts.filter(d =>
      d.status !== 'closed' &&
      d.status !== 'written_off' &&
      calcDebtRemainder(d, ops) > 0
    );

    if (openDebts.length > 0) {
      const debtsSection = document.createElement('div');
      debtsSection.className = 'section';

      const debtsHeader = document.createElement('div');
      debtsHeader.className = 'section-header flex-between mb-8';
      const debtsTitle = document.createElement('h3');
      debtsTitle.className = 'section-title mb-0';
      debtsTitle.textContent = 'Ближайшие долги';
      debtsHeader.appendChild(debtsTitle);

      const allDebtsLink = document.createElement('button');
      allDebtsLink.type = 'button';
      allDebtsLink.className = 'btn-link';
      allDebtsLink.textContent = 'Все →';
      allDebtsLink.addEventListener('click', () => navigate('#/debts'));
      debtsHeader.appendChild(allDebtsLink);

      debtsSection.appendChild(debtsHeader);

      openDebts.sort((a, b) => {
        const aOverdue = a.due_date && a.due_date < todayStr;
        const bOverdue = b.due_date && b.due_date < todayStr;
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
        return (b.date || '').localeCompare(a.date || '');
      });

      for (const d of openDebts.slice(0, 3)) {
        const rem = calcDebtRemainder(d, ops);
        const card = document.createElement('div');
        card.className = 'op-item';
        card.style.cursor = 'pointer';

        const ind = document.createElement('span');
        ind.className = d.direction === 'owed_to_me' ? 'op-indicator text-income' : 'op-indicator text-expense';
        ind.textContent = d.direction === 'owed_to_me' ? '←' : '→';
        card.appendChild(ind);

        const info = document.createElement('div');
        info.className = 'op-info';

        const amtEl = document.createElement('span');
        amtEl.className = 'op-amount amount';
        amtEl.textContent = `${fmtAmount.format(rem)} ${d.currency}`;
        info.appendChild(amtEl);

        const desc = document.createElement('span');
        desc.className = 'op-desc';
        const dirLabel = d.direction === 'owed_to_me' ? 'Мне должен' : 'Я должен';
        desc.textContent = `${dirLabel}: ${d.counterparty || 'Без имени'}${d.purpose ? ' · ' + d.purpose : ''}`;
        info.appendChild(desc);

        card.appendChild(info);

        if (d.due_date && d.due_date < todayStr) {
          const b = document.createElement('span');
          b.className = 'badge badge-expense';
          b.textContent = 'просрочен';
          card.appendChild(b);
        } else if (d.due_date) {
          const b = document.createElement('span');
          b.className = 'badge';
          b.textContent = `до ${fmtDate.format(new Date(d.due_date + 'T00:00:00'))}`;
          card.appendChild(b);
        }

        card.addEventListener('click', () => navigate('#/debts'));
        debtsSection.appendChild(card);
      }

      container.appendChild(debtsSection);
    }

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
        opsSection.appendChild(_createOpItem(op));
      }
    }

    container.appendChild(opsSection);

    // Настроить pull-to-refresh
    _setupPullToRefresh(container);

  } catch (err) {
    console.error('Ошибка отрисовки главной:', err);
    const errorEl = document.createElement('p');
    errorEl.className = 'placeholder-text';
    errorEl.textContent = 'Ошибка загрузки данных';
    container.appendChild(errorEl);
  }
}

// ============================================================
//  ДИАЛОГ КУРСОВ
// ============================================================

/**
 * Открыть диалог редактирования курса валюты
 */
function _openRateDialog(currency, rates, baseCurrency) {
  let rateRecord = rates.find(r => r.currency === currency);
  if (!rateRecord) {
    rateRecord = {
      currency,
      rate_auto: '',
      rate_auto_at: '',
      rate_manual: '',
      mode: 'auto',
      source: ''
    };
  }

  // Создаём модальное окно
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  // Заголовок
  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = `Курс ${currency}`;
  dialog.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'modal-subtitle';
  subtitle.textContent = `${baseCurrency} за 1 ${currency}`;
  dialog.appendChild(subtitle);

  // Автоматический курс (только чтение)
  const autoGroup = document.createElement('div');
  autoGroup.className = 'form-group';
  const autoLabel = document.createElement('label');
  autoLabel.textContent = 'Автоматический курс (BNM)';
  autoGroup.appendChild(autoLabel);

  const autoInput = document.createElement('input');
  autoInput.type = 'text';
  autoInput.readOnly = true;
  autoInput.value = rateRecord.rate_auto
    ? parseFloat(rateRecord.rate_auto).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : 'нет данных';
  autoInput.className = 'input-readonly';
  autoGroup.appendChild(autoInput);

  if (rateRecord.rate_auto_at) {
    const autoDate = document.createElement('div');
    autoDate.className = 'field-hint';
    const dt = new Date(rateRecord.rate_auto_at);
    autoDate.textContent = `обновлено ${fmtDateTime.format(dt)}, ${rateRecord.source || 'авто'}`;
    if (isRateStale(rateRecord, 24)) {
      autoDate.classList.add('text-warning');
    }
    autoGroup.appendChild(autoDate);
  }

  dialog.appendChild(autoGroup);

  // Ручной курс
  const manualGroup = document.createElement('div');
  manualGroup.className = 'form-group';
  const manualLabel = document.createElement('label');
  manualLabel.textContent = 'Ручной курс';
  manualGroup.appendChild(manualLabel);

  const manualInput = document.createElement('input');
  manualInput.type = 'number';
  manualInput.inputMode = 'decimal';
  manualInput.step = '0.0001';
  manualInput.min = '0';
  manualInput.placeholder = 'Введите курс';
  manualInput.value = rateRecord.rate_manual || '';
  manualGroup.appendChild(manualInput);
  dialog.appendChild(manualGroup);

  // Переключатель Авто / Вручную
  const modeGroup = document.createElement('div');
  modeGroup.className = 'form-group';
  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Режим';
  modeGroup.appendChild(modeLabel);

  const modeSwitch = document.createElement('div');
  modeSwitch.className = 'type-switch';

  const autoBtn = document.createElement('button');
  autoBtn.type = 'button';
  autoBtn.className = 'type-btn' + (rateRecord.mode !== 'manual' ? ' active income' : '');
  autoBtn.textContent = 'Авто';
  let currentMode = rateRecord.mode || 'auto';

  const manualBtn = document.createElement('button');
  manualBtn.type = 'button';
  manualBtn.className = 'type-btn' + (rateRecord.mode === 'manual' ? ' active expense' : '');
  manualBtn.textContent = 'Вручную';

  autoBtn.addEventListener('click', () => {
    currentMode = 'auto';
    autoBtn.className = 'type-btn active income';
    manualBtn.className = 'type-btn';
  });

  manualBtn.addEventListener('click', () => {
    currentMode = 'manual';
    manualBtn.className = 'type-btn active expense';
    autoBtn.className = 'type-btn';
  });

  modeSwitch.appendChild(autoBtn);
  modeSwitch.appendChild(manualBtn);
  modeGroup.appendChild(modeSwitch);
  dialog.appendChild(modeGroup);

  // Кнопки
  const btnGroup = document.createElement('div');
  btnGroup.className = 'modal-buttons';

  // Обновить сейчас
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.textContent = 'Обновить сейчас';
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Обновление...';
    try {
      await refreshRates();
      showToast('Курсы обновлены');
      _closeModal(overlay);
      // Перерисовать страницу
      const container = document.getElementById('app-content');
      if (container) renderHome(container);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Обновить сейчас';
    }
  });
  btnGroup.appendChild(refreshBtn);

  // Сохранить
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Сохранить';
  saveBtn.addEventListener('click', async () => {
    const updatedRate = {
      ...rateRecord,
      currency,
      rate_manual: manualInput.value ? parseFloat(manualInput.value) : '',
      mode: currentMode
    };
    try {
      await put('rates', updatedRate);
      await addToOutbox({ sheet: 'rates', data: updatedRate });
      scheduleSyncAfterChange();
      showToast('Курс сохранён');
      _closeModal(overlay);
      const container = document.getElementById('app-content');
      if (container) renderHome(container);
    } catch (err) {
      showToast('Ошибка сохранения');
    }
  });
  btnGroup.appendChild(saveBtn);

  dialog.appendChild(btnGroup);

  // Кнопка закрытия
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
  // Принудительный reflow для надёжного запуска анимации
  overlay.offsetHeight;
  overlay.classList.add('visible');
}

function _closeModal(overlay) {
  overlay.classList.remove('visible');
  setTimeout(() => overlay.remove(), 300);
}

// ============================================================
//  PULL-TO-REFRESH
// ============================================================

function _setupPullToRefresh(container) {
  const indicator = document.getElementById('pull-indicator');
  if (!indicator) return;

  container.addEventListener('touchstart', (e) => {
    if (container.scrollTop <= 0) {
      touchStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const diff = e.touches[0].clientY - touchStartY;
    if (diff > 60 && container.scrollTop <= 0) {
      indicator.classList.remove('hidden');
      indicator.textContent = '↑ Отпустите для обновления';
    } else if (diff > 20 && container.scrollTop <= 0) {
      indicator.classList.remove('hidden');
      indicator.textContent = '↓ Потяните для обновления';
    } else {
      indicator.classList.add('hidden');
    }
  }, { passive: true });

  container.addEventListener('touchend', async () => {
    if (!isPulling) return;
    isPulling = false;
    if (!indicator.classList.contains('hidden')) {
      indicator.textContent = 'Обновление...';
      try {
        await sync();
        showToast('Обновлено');
      } catch (err) {
        showToast('Ошибка синхронизации');
      }
      indicator.classList.add('hidden');
      renderHome(container);
    }
  }, { passive: true });
}

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ
// ============================================================

function _createRatesSection(currencies, rates, baseCurrency) {
  const section = document.createElement('div');
  section.className = 'rates-bar';

  const nonBase = currencies.filter(c => c !== baseCurrency);
  if (nonBase.length === 0) {
    section.textContent = 'Только базовая валюта';
    return section;
  }

  // Обёртка для чипов
  const chipsWrapper = document.createElement('div');
  chipsWrapper.className = 'rates-chips-wrapper';

  for (const cur of nonBase) {
    const info = formatRateDisplay(cur, rates, baseCurrency);

    const rateBtn = document.createElement('button');
    rateBtn.type = 'button';
    rateBtn.className = 'rate-chip';
    rateBtn.setAttribute('aria-label', `Настроить курс ${cur}`);

    const textSpan = document.createElement('span');
    textSpan.textContent = `${cur} ${info.display}`;
    rateBtn.appendChild(textSpan);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'rate-chip-icon';
    iconSpan.textContent = '⚙';
    rateBtn.appendChild(iconSpan);

    if (info.stale) rateBtn.classList.add('stale');

    // Нажатие открывает диалог
    rateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _openRateDialog(cur, rates, baseCurrency);
    });
    chipsWrapper.appendChild(rateBtn);
  }
  section.appendChild(chipsWrapper);

  // Подпись
  const firstNonBase = rates.find(r => nonBase.includes(r.currency));
  const sub = document.createElement('div');
  sub.className = 'rates-sub';

  if (firstNonBase) {
    const info = formatRateDisplay(firstNonBase.currency, rates, baseCurrency);
    if (info.updatedAt) {
      sub.textContent = `обновлено ${fmtDateTime.format(info.updatedAt)}, ${info.source}`;
    } else {
      sub.textContent = info.source || 'нажмите на курс для настройки';
    }
    if (info.stale) {
      sub.classList.add('text-warning');
      if (info.updatedAt) sub.textContent = `курс от ${fmtDate.format(info.updatedAt)}`;
    }
  } else {
    sub.textContent = 'нажмите на курс для настройки';
  }
  section.appendChild(sub);

  return section;
}

function _createTile(title, data, baseCurrency, rates) {
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

  // Разбивка по валютам (скрыта)
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

  if (title === 'Мне должны' || title === 'Я должен') {
    const link = document.createElement('div');
    link.className = 'tile-detail-link text-primary mt-8';
    link.textContent = 'Открыть раздел долгов →';
    link.style.cursor = 'pointer';
    link.style.fontSize = '12px';
    link.style.fontWeight = '600';
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate('#/debts');
    });
    details.appendChild(link);
  }

  tile.appendChild(details);

  tile.addEventListener('click', () => details.classList.toggle('hidden'));
  return tile;
}

function _createOpItem(op) {
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

function _getSetting(settings, key, defaultVal) {
  const s = settings.find(s => s.key === key);
  return s ? s.value : defaultVal;
}

function _getSettingJSON(settings, key, defaultVal) {
  const s = settings.find(s => s.key === key);
  if (!s) return defaultVal;
  try { return JSON.parse(s.value); }
  catch { return defaultVal; }
}
