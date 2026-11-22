// sync.js — синхронизация с Google Apps Script
// Все сетевые вызовы в try/catch, данные не теряются

import { getMeta, getOutbox, clearOutbox, putAll, setMeta, getAll } from './db.js';

let syncStatus = 'synced'; // 'synced' | 'pending' | 'error' | 'offline'
let syncTimer = null;

/**
 * Вызов API Apps Script
 * @param {string} action — название действия
 * @param {Object} payload — данные запроса
 * @returns {Promise<Object>} — ответ сервера
 */
export async function callApi(action, payload = {}) {
  const scriptUrl = await getMeta('scriptUrl');
  const token = await getMeta('token');

  if (!scriptUrl || !token) {
    throw new Error('Не настроено подключение к серверу');
  }

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ token, action, payload })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Ошибка сервера');
    }

    return data;
  } catch (err) {
    if (!navigator.onLine) {
      syncStatus = 'offline';
    } else {
      syncStatus = 'error';
    }
    dispatchSyncEvent('sync-error', { error: err.message });
    throw err;
  }
}

/**
 * Основная синхронизация
 * Отправляет локальные изменения и получает обновления с сервера
 */
export async function sync() {
  try {
    if (!navigator.onLine) {
      syncStatus = 'offline';
      dispatchSyncEvent('sync-status', { status: 'offline' });
      return;
    }

    const outbox = await getOutbox();
    const since = await getMeta('since');

    syncStatus = 'pending';
    dispatchSyncEvent('sync-status', { status: 'pending' });

    const result = await callApi('sync', {
      since: since || null,
      changes: outbox.map(entry => ({ sheet: entry.sheet, data: entry.data }))
    });

    // Очищаем очередь отправленных
    await clearOutbox();

    // Сохраняем полученные данные
    if (result.data) {
      const stores = ['ops', 'orders', 'order_lines', 'debts', 'rates', 'settings'];
      for (const store of stores) {
        if (result.data[store] && result.data[store].length > 0) {
          await putAll(store, result.data[store]);
        }
      }
    }

    // Обновляем метку времени
    if (result.serverTime) {
      await setMeta('since', result.serverTime);
    }

    syncStatus = 'synced';
    dispatchSyncEvent('sync-done', { data: result.data });
    dispatchSyncEvent('sync-status', { status: 'synced' });

  } catch (err) {
    console.error('Ошибка синхронизации:', err);
    // Данные в outbox остаются, будут отправлены при следующей попытке
    syncStatus = navigator.onLine ? 'error' : 'offline';
    dispatchSyncEvent('sync-status', { status: syncStatus });
  }
}

/**
 * Проверка связи с сервером
 */
export async function ping() {
  return callApi('ping');
}

/**
 * Инициализация таблицы (создание листов)
 */
export async function init() {
  return callApi('init');
}

/**
 * Обновить курсы валют
 */
export async function refreshRates() {
  const result = await callApi('refreshRates');
  // Сохраняем обновлённые курсы локально
  if (result.data && result.data.rates) {
    await putAll('rates', result.data.rates);
  }
  return result;
}

/**
 * Запланировать синхронизацию через 2 сек после изменения (debounce)
 */
export function scheduleSyncAfterChange() {
  // Обновляем статус
  syncStatus = 'pending';
  dispatchSyncEvent('sync-status', { status: 'pending' });

  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    sync();
    syncTimer = null;
  }, 2000);
}

/**
 * Запуск автоматической синхронизации
 * Подписывается на события: переход на передний план, online, изменения
 */
export function startAutoSync() {
  // При возврате на передний план
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sync();
    }
  });

  // При появлении сети
  window.addEventListener('online', () => {
    sync();
  });

  // При потере сети
  window.addEventListener('offline', () => {
    syncStatus = 'offline';
    dispatchSyncEvent('sync-status', { status: 'offline' });
  });
}

/**
 * Получить текущий статус синхронизации
 * @returns {string} — 'synced'|'pending'|'error'|'offline'
 */
export function getSyncStatus() {
  if (!navigator.onLine) return 'offline';
  return syncStatus;
}

/**
 * Вспомогательная: отправить пользовательское событие
 */
function dispatchSyncEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
