// dates.test.js — Тесты безопасной работы с датами (dates.js)

import {
  parseDateSafe,
  formatDate,
  formatDateTime,
  isDateBeforeToday,
  compareDatesDesc,
  compareDueDatesAsc,
  getTodayDateString
} from '../js/dates.js';

export function runDateTests(describe, it, assert) {
  describe('dates.js: Парсинг и форматирование', () => {
    it('parseDateSafe понимает YYYY-MM-DD', () => {
      const dt = parseDateSafe('2026-11-23');
      assert.isTrue(dt !== null);
      assert.equal(dt.getFullYear(), 2026);
      assert.equal(dt.getMonth(), 10);
      assert.equal(dt.getDate(), 23);
    });

    it('parseDateSafe понимает DD.MM.YYYY', () => {
      const dt = parseDateSafe('23.11.2026');
      assert.isTrue(dt !== null);
      assert.equal(dt.getFullYear(), 2026);
      assert.equal(dt.getMonth(), 10);
      assert.equal(dt.getDate(), 23);
    });

    it('parseDateSafe понимает ISO строку с T и Z', () => {
      const dt = parseDateSafe('2026-11-22T22:00:00.000Z');
      assert.isTrue(dt !== null);
      assert.isTrue(!isNaN(dt.getTime()));
    });

    it('parseDateSafe возвращает null для пустых/невалидных значений', () => {
      assert.equal(parseDateSafe(''), null);
      assert.equal(parseDateSafe(null), null);
      assert.equal(parseDateSafe(undefined), null);
      assert.equal(parseDateSafe('abc'), null);
    });

    it('formatDate никогда не выбрасывает исключений на ISO строках', () => {
      const res1 = formatDate('2026-11-23');
      assert.equal(res1, '23.11.2026');

      const res2 = formatDate('2026-11-23T15:30:00.000Z');
      assert.isTrue(res2.length > 0);

      const res3 = formatDate('');
      assert.equal(res3, '');

      const res4 = formatDate(null);
      assert.equal(res4, '');
    });

    it('formatDateTime корректно форматирует дату и время', () => {
      const res = formatDateTime('2026-11-23T14:30:00');
      assert.isTrue(res.includes('23.11.2026'));
      assert.isTrue(res.includes('14:30'));
    });
  });

  describe('dates.js: Проверка просроченности и сортировка', () => {
    it('isDateBeforeToday определяет прошедшую дату', () => {
      // 1999-01-01 точно в прошлом
      assert.isTrue(isDateBeforeToday('1999-01-01'));
      // 2099-01-01 точно в будущем
      assert.isTrue(!isDateBeforeToday('2099-01-01'));
    });

    it('isDateBeforeToday возвращает false для пустой даты', () => {
      assert.isTrue(!isDateBeforeToday(''));
      assert.isTrue(!isDateBeforeToday(null));
    });

    it('compareDatesDesc сортирует от новых к старым', () => {
      const dates = ['2026-11-19', '2026-11-23', '2026-11-20'];
      dates.sort(compareDatesDesc);
      assert.equal(dates[0], '2026-11-23');
      assert.equal(dates[1], '2026-11-20');
      assert.equal(dates[2], '2026-11-19');
    });

    it('getTodayDateString возвращает строку YYYY-MM-DD', () => {
      const today = getTodayDateString();
      assert.isTrue(/^\d{4}-\d{2}-\d{2}$/.test(today));
    });
  });
}
