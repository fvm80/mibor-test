// ============================================================
// Service Worker — PWA «Учёт»
// Стратегия: cache-first для статики, network-only для API
// ============================================================

/** Версионированное имя кэша. Поднимите номер при обновлении. */
const CACHE_NAME = 'CACHE_V7';

/** Список ресурсов оболочки для предзагрузки */
const SHELL_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/dates.js',
  './js/db.js',
  './js/router.js',
  './js/sync.js',
  './js/calc.js',
  './js/rates.js',
  './js/ui/home.js',
  './js/ui/ops.js',
  './js/ui/orders.js',
  './js/ui/debts.js',
  './js/ui/form.js',
  './js/ui/settings.js',
  './js/ui/toast.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/**
 * Проверяет, является ли запрос вызовом к Google Apps Script API.
 * Такие запросы НЕ кэшируются — всегда уходят в сеть.
 */
function isApiRequest(url) {
  return (
    url.includes('script.google.com') ||
    url.includes('script.googleusercontent.com')
  );
}

// ----- install: предзагрузка оболочки -----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Кэшируем все статические ресурсы оболочки
      return cache.addAll(SHELL_ASSETS);
    })
  );
  // Немедленно активируем новый SW, не дожидаясь закрытия вкладок
  self.skipWaiting();
});

// ----- activate: удаляем устаревшие кэши и уведомляем клиента -----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME) // Оставляем только актуальный кэш
          .map((key) => caches.delete(key))    // Удаляем старые
      );
    }).then(() => {
      // Берём контроль над всеми открытыми вкладками
      return self.clients.claim();
    }).then(() => {
      // Оповещаем все вкладки об обновлении
      return self.clients.matchAll({ type: 'window' });
    }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_UPDATED' });
      });
    })
  );
});

// ----- fetch: маршрутизация запросов -----
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // API-запросы к Apps Script — всегда в сеть, без кэширования
  if (isApiRequest(request.url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Статические ресурсы — cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      // Возвращаем из кэша, если есть; иначе — запрос в сеть
      return cached || fetch(request).then((response) => {
        // Кэшируем свежий ответ для будущих запросов
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, response.clone());
          return response;
        });
      });
    })
  );
});
