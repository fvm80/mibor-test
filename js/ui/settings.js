// settings.js — Настройки (#/settings)
// Подключение, валюты, категории, данные

import { getMeta, setMeta, put, getAll, clear, getActiveData, getOutbox } from '../db.js';
import { ping, init, sync, refreshRates } from '../sync.js';
import { showToast } from './toast.js';

/**
 * Отрисовать страницу настроек
 * @param {HTMLElement} container
 */
export async function renderSettings(container) {
  if (!container) return;
  container.innerHTML = '';

  const scriptUrl = await getMeta('scriptUrl') || '';
  const token = await getMeta('token') || '';

  // === Секция: Подключение ===
  const connSection = createSection('Подключение');

  // URL скрипта
  const urlGroup = document.createElement('div');
  urlGroup.className = 'form-group';
  const urlLabel = document.createElement('label');
  urlLabel.textContent = 'URL скрипта (Apps Script)';
  urlGroup.appendChild(urlLabel);
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.name = 'scriptUrl';
  urlInput.value = scriptUrl;
  urlInput.placeholder = 'https://script.google.com/macros/s/.../exec';
  urlGroup.appendChild(urlInput);
  connSection.appendChild(urlGroup);

  // Токен
  const tokenGroup = document.createElement('div');
  tokenGroup.className = 'form-group';
  const tokenLabel = document.createElement('label');
  tokenLabel.textContent = 'Токен (API_TOKEN)';
  tokenGroup.appendChild(tokenLabel);
  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.name = 'token';
  tokenInput.value = token;
  tokenInput.placeholder = 'Секретный токен';
  tokenGroup.appendChild(tokenInput);
  connSection.appendChild(tokenGroup);

  // Кнопка сохранения
  const saveConnBtn = document.createElement('button');
  saveConnBtn.className = 'btn btn-primary';
  saveConnBtn.textContent = 'Сохранить подключение';
  saveConnBtn.addEventListener('click', async () => {
    const newUrl = urlInput.value.trim();
    const newToken = tokenInput.value.trim();
    if (!newUrl || !newToken) {
      showToast('Заполните URL и токен');
      return;
    }
    await setMeta('scriptUrl', newUrl);
    await setMeta('token', newToken);
    showToast('Подключение сохранено');
  });
  connSection.appendChild(saveConnBtn);

  // Кнопки действий
  const connButtons = document.createElement('div');
  connButtons.className = 'settings-buttons';

  const pingBtn = document.createElement('button');
  pingBtn.className = 'btn btn-secondary';
  pingBtn.textContent = 'Проверить связь';
  pingBtn.addEventListener('click', async () => {
    // Сохраняем перед проверкой
    await setMeta('scriptUrl', urlInput.value.trim());
    await setMeta('token', tokenInput.value.trim());

    pingBtn.disabled = true;
    pingBtn.textContent = 'Проверка...';
    try {
      await ping();
      showToast('✓ Связь установлена');
    } catch (err) {
      showToast('✗ Ошибка: ' + err.message);
    } finally {
      pingBtn.disabled = false;
      pingBtn.textContent = 'Проверить связь';
    }
  });
  connButtons.appendChild(pingBtn);

  const initBtn = document.createElement('button');
  initBtn.className = 'btn btn-secondary';
  initBtn.textContent = 'Инициализировать таблицу';
  initBtn.addEventListener('click', async () => {
    // Сохраняем перед инициализацией
    await setMeta('scriptUrl', urlInput.value.trim());
    await setMeta('token', tokenInput.value.trim());

    initBtn.disabled = true;
    initBtn.textContent = 'Инициализация...';
    try {
      await init();
      showToast('✓ Таблица инициализирована');
      // Запускаем первую синхронизацию
      await sync();
      showToast('✓ Данные синхронизированы');
    } catch (err) {
      showToast('✗ Ошибка: ' + err.message);
    } finally {
      initBtn.disabled = false;
      initBtn.textContent = 'Инициализировать таблицу';
    }
  });
  connButtons.appendChild(initBtn);

  connSection.appendChild(connButtons);
  container.appendChild(connSection);

  // === Секция: Валюты ===
  const curSection = createSection('Валюты');

  const data = await getActiveData();
  const { settings } = data;

  const baseSetting = settings.find(s => s.key === 'base_currency');
  const baseCurrency = baseSetting ? baseSetting.value : 'MDL';

  const curSetting = settings.find(s => s.key === 'currencies');
  const currencies = curSetting ? JSON.parse(curSetting.value) : ['MDL', 'USD', 'EUR'];

  const baseInfo = document.createElement('div');
  baseInfo.className = 'setting-info';
  baseInfo.textContent = `Базовая валюта: ${baseCurrency} (нельзя изменить)`;
  curSection.appendChild(baseInfo);

  const curList = document.createElement('div');
  curList.className = 'settings-list';
  for (const cur of currencies) {
    const item = document.createElement('div');
    item.className = 'settings-list-item';
    item.textContent = cur;
    if (cur === baseCurrency) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'базовая';
      item.appendChild(badge);
    }
    curList.appendChild(item);
  }
  curSection.appendChild(curList);
  container.appendChild(curSection);

  // === Секция: Категории ===
  const catSection = createSection('Категории');

  const catIncomeSetting = settings.find(s => s.key === 'categories_income');
  const catIncome = catIncomeSetting ? JSON.parse(catIncomeSetting.value) : [];

  const catExpenseSetting = settings.find(s => s.key === 'categories_expense');
  const catExpense = catExpenseSetting ? JSON.parse(catExpenseSetting.value) : [];

  const incomeTitle = document.createElement('h4');
  incomeTitle.textContent = 'Доходы';
  catSection.appendChild(incomeTitle);
  const incomeList = document.createElement('div');
  incomeList.className = 'chips-list';
  for (const cat of catIncome) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = cat;
    incomeList.appendChild(chip);
  }
  catSection.appendChild(incomeList);

  const expenseTitle = document.createElement('h4');
  expenseTitle.textContent = 'Расходы';
  catSection.appendChild(expenseTitle);
  const expenseList = document.createElement('div');
  expenseList.className = 'chips-list';
  for (const cat of catExpense) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = cat;
    expenseList.appendChild(chip);
  }
  catSection.appendChild(expenseList);
  container.appendChild(catSection);

  // === Секция: Данные ===
  const dataSection = createSection('Данные');

  const dataButtons = document.createElement('div');
  dataButtons.className = 'settings-buttons';

  const syncBtn = document.createElement('button');
  syncBtn.className = 'btn btn-secondary';
  syncBtn.textContent = 'Синхронизировать сейчас';
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Синхронизация...';
    try {
      await sync();
      showToast('✓ Синхронизировано');
    } catch (err) {
      showToast('✗ Ошибка: ' + err.message);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Синхронизировать сейчас';
    }
  });
  dataButtons.appendChild(syncBtn);

  const ratesBtn = document.createElement('button');
  ratesBtn.className = 'btn btn-secondary';
  ratesBtn.textContent = 'Обновить курсы';
  ratesBtn.addEventListener('click', async () => {
    ratesBtn.disabled = true;
    ratesBtn.textContent = 'Обновление...';
    try {
      await refreshRates();
      showToast('✓ Курсы обновлены');
    } catch (err) {
      showToast('✗ Ошибка: ' + err.message);
    } finally {
      ratesBtn.disabled = false;
      ratesBtn.textContent = 'Обновить курсы';
    }
  });
  dataButtons.appendChild(ratesBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-danger';
  clearBtn.textContent = 'Очистить локальный кэш';
  clearBtn.addEventListener('click', async () => {
    // Проверяем очередь
    const outbox = await getOutbox();
    if (outbox.length > 0) {
      const confirmed = confirm(
        `Есть ${outbox.length} неотправленных изменений! Они будут потеряны. Продолжить?`
      );
      if (!confirmed) return;
    } else {
      const confirmed = confirm('Очистить все локальные данные?');
      if (!confirmed) return;
    }

    const stores = ['ops', 'orders', 'order_lines', 'debts', 'rates', 'settings', 'outbox'];
    for (const store of stores) {
      await clear(store);
    }
    await setMeta('since', null);
    showToast('Кэш очищен');
    renderSettings(container);
  });
  dataButtons.appendChild(clearBtn);

  dataSection.appendChild(dataButtons);
  container.appendChild(dataSection);

  // === Секция: О приложении ===
  const aboutSection = createSection('О приложении');
  const version = document.createElement('div');
  version.className = 'setting-info';
  version.textContent = 'Версия: 1.0.0';
  aboutSection.appendChild(version);

  const since = await getMeta('since');
  const syncInfo = document.createElement('div');
  syncInfo.className = 'setting-info';
  syncInfo.textContent = since
    ? `Последняя синхронизация: ${new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(since))}`
    : 'Синхронизация не проводилась';
  aboutSection.appendChild(syncInfo);

  container.appendChild(aboutSection);
}

/**
 * Вспомогательная: создать секцию с заголовком
 */
function createSection(title) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const h3 = document.createElement('h3');
  h3.className = 'section-title';
  h3.textContent = title;
  section.appendChild(h3);

  return section;
}
