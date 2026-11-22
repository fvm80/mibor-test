// toast.js — Toast-уведомления
// Показывается снизу, над нижней навигацией

let currentToast = null;
let toastTimer = null;

/**
 * Показать toast-уведомление
 * @param {string} message — текст
 * @param {Object} options — { duration: 5000, action: { label, onClick } }
 */
export function showToast(message, options = {}) {
  const { duration = 5000, action = null } = options;

  // Убираем предыдущий
  hideToast();

  const container = document.getElementById('toast');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item toast-enter';

  const textSpan = document.createElement('span');
  textSpan.className = 'toast-text';
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      hideToast();
      if (typeof action.onClick === 'function') {
        action.onClick();
      }
    });
    toast.appendChild(btn);
  }

  container.appendChild(toast);
  currentToast = toast;

  // Анимация появления
  requestAnimationFrame(() => {
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-visible');
  });

  // Автоскрытие
  if (duration > 0) {
    toastTimer = setTimeout(() => {
      hideToast();
    }, duration);
  }
}

/**
 * Скрыть текущий toast
 */
export function hideToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  if (currentToast) {
    currentToast.classList.remove('toast-visible');
    currentToast.classList.add('toast-exit');

    const el = currentToast;
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);

    currentToast = null;
  }
}
