// form.js — Форма ввода дохода/расхода (нижняя шторка)
// Быстрый ввод: ＋ для дохода, － для расхода

import { getAll, put, addToOutbox, getMeta, setMeta, getActiveData } from '../db.js';
import { scheduleSyncAfterChange } from '../sync.js';
import { showToast } from './toast.js';
import { getTodayDateString } from '../dates.js';

let currentType = 'income'; // 'income' или 'expense'

/**
 * Открыть форму ввода
 * @param {string} type — 'income' или 'expense'
 */
export async function openForm(type = 'income') {
  currentType = type;

  const sheet = document.getElementById('bottom-sheet');
  const overlay = document.getElementById('sheet-overlay');
  if (!sheet || !overlay) return;

  // Загружаем данные для формы
  const data = await getActiveData();
  const { settings } = data;

  // Список валют
  const curSetting = settings.find(s => s.key === 'currencies');
  const currencies = curSetting ? JSON.parse(curSetting.value) : ['MDL', 'USD', 'EUR'];

  // Последняя использованная валюта
  const lastCurSetting = settings.find(s => s.key === 'last_currency');
  const lastCurrency = lastCurSetting ? lastCurSetting.value : currencies[0];

  // Категории
  const catKey = type === 'income' ? 'categories_income' : 'categories_expense';
  const catSetting = settings.find(s => s.key === catKey);
  const categories = catSetting ? JSON.parse(catSetting.value) : [];

  // Строим форму
  sheet.innerHTML = '';

  // Заголовок с переключателем типа
  const header = document.createElement('div');
  header.className = 'sheet-header';

  const typeSwitch = document.createElement('div');
  typeSwitch.className = 'type-switch';

  const incomeBtn = document.createElement('button');
  incomeBtn.className = 'type-btn' + (currentType === 'income' ? ' active income' : '');
  incomeBtn.textContent = 'Доход';
  incomeBtn.addEventListener('click', () => {
    currentType = 'income';
    openForm('income');
  });
  typeSwitch.appendChild(incomeBtn);

  const expenseBtn = document.createElement('button');
  expenseBtn.className = 'type-btn' + (currentType === 'expense' ? ' active expense' : '');
  expenseBtn.textContent = 'Расход';
  expenseBtn.addEventListener('click', () => {
    currentType = 'expense';
    openForm('expense');
  });
  typeSwitch.appendChild(expenseBtn);

  header.appendChild(typeSwitch);

  // Кнопка закрытия
  const closeBtn = document.createElement('button');
  closeBtn.className = 'sheet-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.addEventListener('click', closeForm);
  header.appendChild(closeBtn);

  sheet.appendChild(header);

  // Форма
  const form = document.createElement('form');
  form.className = 'entry-form';
  form.addEventListener('submit', (e) => e.preventDefault());

  // Сумма
  const amountGroup = createField('Сумма', 'number', 'amount', {
    required: true,
    inputmode: 'decimal',
    min: '0.01',
    step: '0.01',
    placeholder: '0,00'
  });
  form.appendChild(amountGroup);

  // Валюта (чипы)
  const curGroup = document.createElement('div');
  curGroup.className = 'form-group';
  const curLabel = document.createElement('label');
  curLabel.textContent = 'Валюта';
  curGroup.appendChild(curLabel);

  const curChips = document.createElement('div');
  curChips.className = 'currency-chips';
  let selectedCurrency = lastCurrency;

  for (const cur of currencies) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'currency-chip' + (cur === selectedCurrency ? ' active' : '');
    chip.textContent = cur;
    chip.addEventListener('click', () => {
      selectedCurrency = cur;
      curChips.querySelectorAll('.currency-chip').forEach(c =>
        c.classList.toggle('active', c.textContent === cur)
      );
    });
    curChips.appendChild(chip);
  }
  curGroup.appendChild(curChips);
  form.appendChild(curGroup);

  // Дата
  const today = getTodayDateString();
  const dateGroup = createField('Дата', 'date', 'date', { value: today });
  form.appendChild(dateGroup);

  // Автоподсказки из прошлых значений
  const pastCounterparties = [...new Set(data.ops.map(o => o.counterparty).filter(Boolean))];
  const pastPurposes = [...new Set(data.ops.map(o => o.purpose).filter(Boolean))];

  // Контрагент
  const counterpartyLabel = currentType === 'income' ? 'От кого' : 'Кому';
  const cpField = createField(counterpartyLabel, 'text', 'counterparty', {
    placeholder: counterpartyLabel,
    list: 'dl-counterparty'
  });
  cpField.appendChild(_createDatalist('dl-counterparty', pastCounterparties));
  form.appendChild(cpField);

  // За что
  const purposeField = createField('За что', 'text', 'purpose', {
    placeholder: 'Описание',
    list: 'dl-purpose'
  });
  purposeField.appendChild(_createDatalist('dl-purpose', pastPurposes));
  form.appendChild(purposeField);

  // Категория
  const catGroup = document.createElement('div');
  catGroup.className = 'form-group';
  const catLabel = document.createElement('label');
  catLabel.textContent = 'Категория';
  catGroup.appendChild(catLabel);

  const catSelect = document.createElement('select');
  catSelect.name = 'category';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '— не выбрана —';
  catSelect.appendChild(emptyOpt);

  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSelect.appendChild(opt);
  }
  catGroup.appendChild(catSelect);
  form.appendChild(catGroup);

  // Примечание
  const noteGroup = document.createElement('div');
  noteGroup.className = 'form-group';
  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'Примечание';
  noteGroup.appendChild(noteLabel);
  const noteArea = document.createElement('textarea');
  noteArea.name = 'note';
  noteArea.rows = 2;
  noteArea.placeholder = 'Дополнительная информация';
  noteGroup.appendChild(noteArea);
  form.appendChild(noteGroup);

  // Кнопки
  const btnGroup = document.createElement('div');
  btnGroup.className = 'form-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Сохранить';
  saveBtn.addEventListener('click', () => {
    saveEntry(form, selectedCurrency, false);
  });
  btnGroup.appendChild(saveBtn);

  const saveMoreBtn = document.createElement('button');
  saveMoreBtn.type = 'button';
  saveMoreBtn.className = 'btn btn-secondary';
  saveMoreBtn.textContent = 'Сохранить и ещё';
  saveMoreBtn.addEventListener('click', () => {
    saveEntry(form, selectedCurrency, true);
  });
  btnGroup.appendChild(saveMoreBtn);

  form.appendChild(btnGroup);
  sheet.appendChild(form);

  // Показать шторку
  sheet.classList.add('open');
  overlay.classList.add('visible');

  // Фокус на сумму
  setTimeout(() => {
    const amountInput = form.querySelector('[name="amount"]');
    if (amountInput) amountInput.focus();
  }, 300);
}

/**
 * Закрыть форму
 */
export function closeForm() {
  const sheet = document.getElementById('bottom-sheet');
  const overlay = document.getElementById('sheet-overlay');
  if (sheet) sheet.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
}

/**
 * Сохранить запись
 */
async function saveEntry(form, currency, addMore) {
  const amountInput = form.querySelector('[name="amount"]');
  const amount = parseFloat(amountInput.value);

  if (!amount || amount <= 0) {
    amountInput.classList.add('error');
    amountInput.focus();
    return;
  }
  amountInput.classList.remove('error');

  const now = new Date().toISOString();

  const record = {
    id: crypto.randomUUID(),
    type: currentType,
    amount: amount,
    currency: currency,
    date: form.querySelector('[name="date"]').value,
    counterparty: form.querySelector('[name="counterparty"]').value.trim(),
    purpose: form.querySelector('[name="purpose"]').value.trim(),
    category: form.querySelector('[name="category"]').value,
    order_id: '',
    order_line_id: '',
    debt_id: '',
    debt_role: '',
    rate_at_entry: '',
    note: form.querySelector('[name="note"]').value.trim(),
    created_at: now,
    updated_at: now,
    deleted: false
  };

  try {
    // Сохраняем в IndexedDB
    await put('ops', record);

    // Добавляем в очередь синхронизации
    await addToOutbox({ sheet: 'ops', data: record });

    // Запускаем синхронизацию
    scheduleSyncAfterChange();

    // Сохраняем последнюю валюту
    await put('settings', { key: 'last_currency', value: currency });

    // Создаём данные для отмены
    const savedId = record.id;

    // Toast с кнопкой отмены
    showToast('Сохранено', {
      duration: 5000,
      action: {
        label: 'Отменить',
        onClick: async () => {
          // Мягкое удаление
          record.deleted = true;
          record.updated_at = new Date().toISOString();
          await put('ops', record);
          await addToOutbox({ sheet: 'ops', data: record });
          scheduleSyncAfterChange();
          showToast('Отменено');
          // Обновляем текущую страницу
          window.dispatchEvent(new CustomEvent('sync-done'));
        }
      }
    });

    if (addMore) {
      // Очищаем форму, оставляя валюту и категорию
      amountInput.value = '';
      form.querySelector('[name="counterparty"]').value = '';
      form.querySelector('[name="purpose"]').value = '';
      form.querySelector('[name="note"]').value = '';
      amountInput.focus();
    } else {
      closeForm();
    }

    // Оповещаем об обновлении
    window.dispatchEvent(new CustomEvent('sync-done'));

  } catch (err) {
    console.error('Ошибка сохранения:', err);
    showToast('Ошибка сохранения');
  }
}

/**
 * Вспомогательная: создать поле формы
 */
function createField(label, type, name, attrs = {}) {
  const group = document.createElement('div');
  group.className = 'form-group';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  group.appendChild(labelEl);

  const input = document.createElement('input');
  input.type = type;
  input.name = name;

  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'required') {
      input.required = val;
    } else {
      input.setAttribute(key, val);
    }
  }

  group.appendChild(input);
  return group;
}


/**
 * Вспомогательная: создать datalist для автоподсказок
 */
function _createDatalist(id, items) {
  const dl = document.createElement('datalist');
  dl.id = id;
  for (const item of items.slice(0, 50)) {
    const opt = document.createElement('option');
    opt.value = item;
    dl.appendChild(opt);
  }
  return dl;
}
