// main.js — Точка входа приложения «Учёт»
// Инициализация, маршрутизация, обработка событий

import { openDB, getMeta, setMeta } from './db.js';
import { initRouter, onRoute, navigate } from './router.js';
import { sync, startAutoSync, getSyncStatus, ping } from './sync.js';
import { renderHome } from './ui/home.js';
import { renderOps } from './ui/ops.js';
import { openForm, closeForm } from './ui/form.js';
import { renderSettings } from './ui/settings.js';
import { showToast } from './ui/toast.js';

// Контейнер для контента
let appContent = null;

/**
 * Обновить индикатор синхронизации
 */
function updateSyncIndicator() {
  const indicator = document.getElementById('sync-indicator');
  if (!indicator) return;

  const status = getSyncStatus();
  indicator.className = 'sync-dot';

  switch (status) {
    case 'synced':
      indicator.classList.add('sync-green');
      indicator.title = 'Всё сохранено';
      break;
    case 'pending':
      indicator.classList.add('sync-yellow');
      indicator.title = 'Есть неотправленные изменения';
      break;
    case 'error':
      indicator.classList.add('sync-red');
      indicator.title = 'Ошибка синхронизации';
      break;
    case 'offline':
      indicator.classList.add('sync-grey');
      indicator.title = 'Нет сети';
      break;
  }
}

/**
 * Обновить заголовок страницы
 */
function setTitle(title) {
  const el = document.getElementById('header-title');
  if (el) el.textContent = title;
}

/**
 * Обновить активную вкладку
 */
function setActiveTab(hash) {
  document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === hash);
  });
}

/**
 * Очистить контейнер и вернуть его
 */
function clearContent() {
  if (appContent) {
    appContent.innerHTML = '';
  }
  return appContent;
}

/**
 * Инициализация приложения
 */
async function initApp() {
  try {
    // Открываем базу данных
    await openDB();

    appContent = document.getElementById('app-content');

    // Генерируем deviceId если нет
    const deviceId = await getMeta('deviceId');
    if (!deviceId) {
      await setMeta('deviceId', crypto.randomUUID());
    }

    // Проверяем настройки подключения
    const scriptUrl = await getMeta('scriptUrl');
    const token = await getMeta('token');

    // Регистрируем маршруты
    registerRoutes();

    // Инициализируем маршрутизатор
    initRouter();

    // Если нет подключения — показать настройки
    if (!scriptUrl || !token) {
      navigate('#/settings');
      showToast('Настройте подключение к серверу');
    } else {
      // Запускаем синхронизацию в фоне
      sync().catch(err => {
        console.warn('Начальная синхронизация не удалась:', err.message);
      });
    }

    // Запускаем автосинхронизацию
    startAutoSync();

    // Подписываемся на события синхронизации
    window.addEventListener('sync-done', () => {
      updateSyncIndicator();
      // Обновляем текущую страницу
      const hash = window.location.hash || '#/home';
      if (hash === '#/home') renderHome(clearContent());
      if (hash === '#/ops') renderOps(clearContent());
    });

    window.addEventListener('sync-status', () => {
      updateSyncIndicator();
    });

    window.addEventListener('sync-error', (e) => {
      updateSyncIndicator();
    });

    // Инициализируем нижнюю панель
    initBottomNav();

    // Обновляем индикатор
    updateSyncIndicator();

    // Регистрация Service Worker
    registerSW();

  } catch (err) {
    console.error('Ошибка инициализации:', err);
    showToast('Ошибка запуска приложения');
  }
}

/**
 * Регистрация маршрутов
 */
function registerRoutes() {
  onRoute('#/home', () => {
    setTitle('Главная');
    setActiveTab('#/home');
    renderHome(clearContent());
  });

  onRoute('#/ops', () => {
    setTitle('Операции');
    setActiveTab('#/ops');
    renderOps(clearContent());
  });

  onRoute('#/orders', () => {
    setTitle('Заказы');
    setActiveTab('#/orders');
    const c = clearContent();
    const p = document.createElement('p');
    p.textContent = 'Страница заказов будет доступна в Этапе 3';
    p.className = 'placeholder-text';
    c.appendChild(p);
  });

  onRoute('#/orders/:id', (params) => {
    setTitle('Заказ');
    setActiveTab('#/orders');
    const c = clearContent();
    const p = document.createElement('p');
    p.textContent = `Карточка заказа ${params.id} будет доступна в Этапе 3`;
    p.className = 'placeholder-text';
    c.appendChild(p);
  });

  onRoute('#/debts', () => {
    setTitle('Долги');
    setActiveTab('#/debts');
    const c = clearContent();
    const p = document.createElement('p');
    p.textContent = 'Страница долгов будет доступна в Этапе 2';
    p.className = 'placeholder-text';
    c.appendChild(p);
  });

  onRoute('#/settings', () => {
    setTitle('Настройки');
    setActiveTab('');
    renderSettings(clearContent());
  });
}

/**
 * Инициализация кнопок нижней панели
 */
function initBottomNav() {
  // Кнопки вкладок
  document.querySelectorAll('#bottom-nav .nav-btn[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.route);
    });
  });

  // Кнопка «＋» — доход
  const addBtn = document.getElementById('btn-add-income');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openForm('income');
    });
  }

  // Кнопка «－» — расход
  const subBtn = document.getElementById('btn-add-expense');
  if (subBtn) {
    subBtn.addEventListener('click', () => {
      openForm('expense');
    });
  }

  // Кнопка настроек
  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      navigate('#/settings');
    });
  }

  // Оверлей шторки — закрытие
  const overlay = document.getElementById('sheet-overlay');
  if (overlay) {
    overlay.addEventListener('click', closeForm);
  }
}

/**
 * Регистрация Service Worker
 */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('SW зарегистрирован');

        // Слушаем обновление
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              showToast('Доступна новая версия', {
                action: {
                  label: 'Обновить',
                  onClick: () => window.location.reload()
                }
              });
            }
          });
        });
      })
      .catch(err => {
        console.warn('SW не зарегистрирован:', err);
      });

    // Слушаем сообщения от SW
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_UPDATED') {
        showToast('Доступна новая версия', {
          action: {
            label: 'Обновить',
            onClick: () => window.location.reload()
          }
        });
      }
    });
  }
}

// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', initApp);
