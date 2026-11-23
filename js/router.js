// router.js — SPA hash-маршрутизатор
// Поддерживает параметры вида :id

const routes = [];
let currentCleanup = null;
let currentRenderSeq = 0;

/**
 * Получить следующий идентификатор отрисовки для отмены устаревших async-рендеров
 * @returns {number}
 */
export function nextRenderSeq() {
  return ++currentRenderSeq;
}

/**
 * Получить текущий идентификатор отрисовки
 * @returns {number}
 */
export function getCurrentRenderSeq() {
  return currentRenderSeq;
}

/**
 * Проверить, является ли данный id отрисовки актуальным
 * @param {number} seq
 * @returns {boolean}
 */
export function isCurrentRender(seq) {
  return seq === currentRenderSeq;
}

/**
 * Регистрация обработчика маршрута
 * @param {string} pattern — шаблон: #/home, #/orders/:id
 * @param {Function} handler — функция(params), вызывается при совпадении
 */
export function onRoute(pattern, handler) {
  // Превращаем шаблон в регулярное выражение
  const paramNames = [];
  const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp('^' + regexStr + '$');
  routes.push({ pattern, regex, paramNames, handler });
}

/**
 * Программная навигация
 * @param {string} hash — например #/home
 */
export function navigate(hash) {
  window.location.hash = hash;
}

/**
 * Обработка текущего хэша
 */
function handleRoute() {
  const hash = window.location.hash || '#/home';
  const renderId = nextRenderSeq();

  // Вызываем cleanup предыдущей страницы
  if (typeof currentCleanup === 'function') {
    currentCleanup();
    currentCleanup = null;
  }

  for (const route of routes) {
    const match = hash.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      const result = route.handler(params, renderId);
      // Если обработчик вернул функцию — это cleanup
      if (typeof result === 'function') {
        currentCleanup = result;
      }
      return;
    }
  }

  // Маршрут не найден — на главную
  navigate('#/home');
}

/**
 * Инициализация маршрутизатора
 */
export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  if (!window.location.hash) {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#/home');
    } else {
      window.location.hash = '#/home';
    }
  }
  // Обработать текущий маршрут
  handleRoute();
}

/**
 * Получить текущий хэш
 * @returns {string}
 */
export function getCurrentHash() {
  return window.location.hash || '#/home';
}
