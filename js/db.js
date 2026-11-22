// db.js — обёртка IndexedDB для приложения учёта
// Все данные хранятся локально для офлайн-работы

const DB_NAME = 'uchet';
const DB_VERSION = 1;

// Хранилища БД
const STORES = {
  ops: 'id',
  orders: 'id',
  order_lines: 'id',
  debts: 'id',
  settings: 'key',
  rates: 'currency',
  meta: 'key',
  outbox: 'id' // autoIncrement
};

let dbInstance = null;

/**
 * Открывает или создаёт базу данных
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Создаём хранилища
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const opts = { keyPath };
          if (name === 'outbox') {
            opts.autoIncrement = true;
          }
          db.createObjectStore(name, opts);
        }
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * Получить все записи из хранилища
 * @param {string} storeName
 * @returns {Promise<Array>}
 */
export async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Получить одну запись по ключу
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<*>}
 */
export async function get(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Записать одну запись
 * @param {string} storeName
 * @param {*} data
 * @returns {Promise<*>}
 */
export async function put(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Записать массив записей в одной транзакции
 * @param {string} storeName
 * @param {Array} items
 * @returns {Promise<void>}
 */
export async function putAll(storeName, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Удалить запись по ключу
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<void>}
 */
export async function del(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Очистить хранилище
 * @param {string} storeName
 * @returns {Promise<void>}
 */
export async function clear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Получить значение из meta
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function getMeta(key) {
  const record = await get('meta', key);
  return record ? record.value : null;
}

/**
 * Записать значение в meta
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setMeta(key, value) {
  return put('meta', { key, value });
}

/**
 * Добавить запись в очередь отправки
 * @param {Object} entry — { sheet, data }
 * @returns {Promise<*>}
 */
export async function addToOutbox(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    // Добавляем id для autoIncrement
    const record = { ...entry, id: Date.now() + Math.random() };
    const request = store.put(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Получить все записи из очереди
 * @returns {Promise<Array>}
 */
export async function getOutbox() {
  return getAll('outbox');
}

/**
 * Очистить очередь отправки
 * @returns {Promise<void>}
 */
export async function clearOutbox() {
  return clear('outbox');
}

/**
 * Вспомогательная: фильтрация удалённых записей
 */
function filterActive(items) {
  return items.filter(item =>
    item.deleted !== true &&
    item.deleted !== 'TRUE' &&
    item.deleted !== 'true'
  );
}

/**
 * Получить все активные данные (без deleted)
 * @returns {Promise<Object>}
 */
export async function getActiveData() {
  const [ops, orders, order_lines, debts, rates, settings] = await Promise.all([
    getAll('ops'),
    getAll('orders'),
    getAll('order_lines'),
    getAll('debts'),
    getAll('rates'),
    getAll('settings')
  ]);

  return {
    ops: filterActive(ops),
    orders: filterActive(orders),
    order_lines: filterActive(order_lines),
    debts: filterActive(debts),
    rates,
    settings
  };
}
