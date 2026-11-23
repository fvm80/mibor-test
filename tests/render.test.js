// render.test.js — Тесты синхронизации и защиты от гонок отрисовки

import { nextRenderSeq, getCurrentRenderSeq, isCurrentRender } from '../js/router.js';

export function runRenderTests(describe, it, assert) {
  describe('router.js: Защита от параллельных async-рендеров', () => {
    it('nextRenderSeq инкрементирует счетчик поколений отрисовки', () => {
      const prev = getCurrentRenderSeq();
      const next1 = nextRenderSeq();
      const next2 = nextRenderSeq();
      assert.equal(next1, prev + 1);
      assert.equal(next2, prev + 2);
    });

    it('isCurrentRender возвращает true только для последнего поколения', () => {
      const seq1 = nextRenderSeq();
      assert.isTrue(isCurrentRender(seq1));

      const seq2 = nextRenderSeq();
      assert.isTrue(!isCurrentRender(seq1), 'seq1 должен стать устаревшим после seq2');
      assert.isTrue(isCurrentRender(seq2), 'seq2 должен быть активным');
    });

    it('Устаревший асинхронный рендер не модифицирует контейнер при гонке', async () => {
      const container = document.createElement('div');
      container.innerHTML = '<div>Начальное состояние</div>';

      // Симуляция двух параллельных вызовов рендера
      // Вызов 1: медленный рендер (например, Главная)
      const render1Seq = nextRenderSeq();
      let render1Finished = false;

      // Вызов 2: быстрый рендер (пользователь перешёл на Заказы)
      const render2Seq = nextRenderSeq();

      // Вызов 2 завершается
      if (isCurrentRender(render2Seq)) {
        container.innerHTML = '';
        const orderEl = document.createElement('div');
        orderEl.className = 'orders-content';
        orderEl.textContent = 'Страница заказов';
        container.appendChild(orderEl);
      }

      // Вызов 1 завершается позже
      if (isCurrentRender(render1Seq)) {
        // Сюда выполнение НЕ должно дойти
        render1Finished = true;
        const homeEl = document.createElement('div');
        homeEl.className = 'home-content';
        container.appendChild(homeEl);
      }

      assert.isTrue(!render1Finished, 'Рендер 1 должен быть отклонен');
      assert.equal(container.children.length, 1);
      assert.equal(container.children[0].className, 'orders-content');
      assert.isTrue(!container.querySelector('.home-content'), 'Контент Главной не должен появиться в Заказах');
    });

    it('Атомарная замена через DocumentFragment не оставляет дублей', () => {
      const container = document.createElement('div');
      container.innerHTML = '<div class="old">Старый контент</div>';

      const fragment = document.createDocumentFragment();
      const el1 = document.createElement('div');
      el1.textContent = 'Блок 1';
      const el2 = document.createElement('div');
      el2.textContent = 'Блок 2';
      fragment.appendChild(el1);
      fragment.appendChild(el2);

      // Атомарная замена
      container.innerHTML = '';
      container.appendChild(fragment);

      assert.equal(container.children.length, 2);
      assert.equal(container.children[0].textContent, 'Блок 1');
      assert.equal(container.children[1].textContent, 'Блок 2');
      assert.isTrue(!container.querySelector('.old'));
    });
  });
}
