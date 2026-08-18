// ===================================================================
// public/js/admin2/support.js — заявки #/support?status=open&cat=all
//
// Что изменилось против v1, кроме адреса в ссылке.
//
// 1. НАБРАННЫЙ ОТВЕТ БОЛЬШЕ НЕ ПРОПАДАЕТ. В v1 любое действие —
//    «взять в работу», смена фильтра, ответ на соседнее обращение —
//    перерисовывало весь список заново, и текст, набранный в других
//    полях, исчезал молча. Это ровно тот случай, когда интерфейс
//    наказывает за нормальную работу: человек пишет длинный ответ,
//    отвлекается на срочное, возвращается — пусто.
//    Черновики держим по id обращения и восстанавливаем после
//    перерисовки. Отправленный ответ черновик убирает.
//
// 2. Позывной игрока ведёт на его страницу: половина обращений
//    требует посмотреть счёт или журнал, и раньше это означало уйти
//    в другую вкладку и потерять обращение из виду.
// ===================================================================

(function () {
  // Черновики живут в памяти экрана: между перерисовками — да,
  // между перезагрузками страницы — нет. Хранить недоотправленные
  // ответы в localStorage было бы хуже: чужой ответ, всплывший через
  // неделю у другого сотрудника на общей машине, — это инцидент.
  const drafts = {};

  const STATUSES = [['open', 'Открытые'], ['answered', 'Отвеченные'],
                    ['closed', 'Закрытые'], ['all', 'Все']];
  // Состояние обращения приходит английским словом. Показывать его как
  // есть — мелочь, но сотрудник читает панель на русском, и «open»
  // посреди русской строки каждый раз спотыкает.
  const STATUS_RU = { open: 'открыто', answered: 'отвечено', closed: 'закрыто' };

  const msgHtml = (m) => `
    <div style="padding:7px 9px;border-radius:8px;
      background:${m.from === 'admin' ? 'rgba(60,180,90,.1)' : 'rgba(255,255,255,.03)'};
      border:1px solid ${m.from === 'admin' ? 'var(--green)' : 'var(--border)'}">
      <div class="a2-item-when">${m.from === 'admin' ? '🛟 ' : '👤 '}${UI.esc(m.authorName)} ·
        ${new Date(m.at).toLocaleString('ru-RU')}</div>
      <div style="margin-top:2px;white-space:pre-wrap">${UI.esc(m.text)}</div>
    </div>`;

  const ticketHtml = (t, isOwner) => {
    const canAnswer = t.mine || t.free || isOwner;
    return `<div class="a2-card">
      <h3 style="text-transform:none;font-size:14px;display:flex;gap:8px;justify-content:space-between">
        <span>${UI.esc(t.subject)}</span>
        <span class="a2-muted" style="font-weight:400">
          ${t.userId ? `<a href="${A2Router.build('player', t.userId)}">${UI.esc(t.userName)}</a>`
                     : UI.esc(t.userName)} · ${UI.esc(STATUS_RU[t.status] || t.status)}</span>
      </h3>
      <div class="a2-muted">Тема: ${UI.esc(t.categoryLabel || 'Другое')}</div>
      <div class="a2-row" style="margin:6px 0">
        ${t.free ? '<span class="a2-pill is-ok">свободно</span>'
                 : (t.mine ? '<span class="a2-pill is-warn">у вас в работе</span>'
                           : `<span class="a2-pill">в работе: ${UI.esc(t.assignedName)}</span>`)}
        ${t.free ? `<button class="btn btn-inline" data-claim="${UI.esc(t.id)}">📌 Взять в работу</button>` : ''}
        ${(t.mine || isOwner) && !t.free
          ? `<button class="btn btn-inline" data-release="${UI.esc(t.id)}">↩ Вернуть в очередь</button>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
        ${(t.messages || []).map(msgHtml).join('')}
      </div>
      ${t.status === 'closed' ? '<p class="a2-muted" style="margin:8px 0 0">Обращение закрыто.</p>'
        : (canAnswer ? `
          <textarea data-draft="${UI.esc(t.id)}" rows="2"
            placeholder="${t.free ? 'Ответ игроку (обращение закрепится за вами)…' : 'Ответ игроку…'}"
            style="width:100%;box-sizing:border-box;margin-top:8px;background:var(--bg);color:var(--text);
                   border:1px solid var(--border);border-radius:8px;padding:6px 8px;
                   font:inherit;font-size:13px"></textarea>
          <div class="a2-row" style="margin-top:6px">
            <button class="btn btn-orange btn-inline" data-ans="${UI.esc(t.id)}">Ответить</button>
            <button class="btn btn-inline" data-ans-close="${UI.esc(t.id)}">Ответить и закрыть</button>
          </div>`
        : '<p class="a2-muted" style="margin:8px 0 0">Обращением занимается другой сотрудник.</p>')}
    </div>`;
  };

  async function render(el, route) {
    const status = route.query.status || 'open';
    const cat = route.query.cat || 'all';
    // Черновики перед перерисовкой снимаем с полей: перерисовка может
    // прийти не только отсюда (например, после «взять в работу»).
    saveDrafts(el);

    el.innerHTML = '<div class="a2-title">Заявки</div><div class="loading">Загрузка…</div>';
    let d = null;
    try {
      d = await API.get('/api/admin/support?status=' + encodeURIComponent(status)
        + '&category=' + encodeURIComponent(cat));
    } catch (e) {
      el.innerHTML = `<div class="a2-card"><h3 style="color:var(--red)">Заявки не загрузились</h3>
        <p class="a2-muted">${UI.esc(e.message)}</p></div>`;
      return;
    }

    const cats = d.categories || [];
    const byCat = d.byCategory || {};
    const totalOpen = Object.values(byCat).reduce((a, b) => a + b, 0);
    const isOwner = A2.isOwner();
    const tickets = d.tickets || [];
    A2.setBadge('support', status === 'open' ? tickets.length : totalOpen,
      totalOpen >= 5 ? 'hot' : 'warn');

    el.innerHTML = `
      <div class="a2-title">Заявки игроков</div>
      <div class="a2-card">
        <div class="a2-row">
          ${STATUSES.map(([id, label]) => `<button class="btn btn-inline ${status === id ? 'btn-orange' : ''}"
            data-f="${id}">${label}</button>`).join('')}
        </div>
        <div class="a2-muted" style="margin:8px 0 4px">Подразделы по темам:</div>
        <div class="a2-row">
          <button class="btn btn-inline ${cat === 'all' ? 'btn-orange' : ''}" data-cat="all">📋 Все${totalOpen ? ` (${totalOpen})` : ''}</button>
          ${cats.map((c) => `<button class="btn btn-inline ${cat === c.id ? 'btn-orange' : ''}"
            data-cat="${UI.esc(c.id)}">${c.icon} ${UI.esc(c.label)}${byCat[c.id] ? ` (${byCat[c.id]})` : ''}</button>`).join('')}
        </div>
      </div>
      <div id="sup-list">${tickets.length ? tickets.map((t) => ticketHtml(t, isOwner)).join('')
        : '<div class="a2-card"><p class="a2-muted">Обращений нет.</p></div>'}</div>`;

    restoreDrafts(el);
    // Сохраняем на каждом нажатии, а не только перед перерисовкой:
    // уйти с экрана можно и не вызвав render (переход по меню), и тогда
    // «сохраню перед перерисовкой» не сработает — а текст пропадёт.
    el.querySelectorAll('[data-draft]').forEach((t) => {
      t.oninput = () => {
        if (t.value.trim()) drafts[t.dataset.draft] = t.value;
        else delete drafts[t.dataset.draft];
      };
    });

    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => A2Router.setQuery({ status: b.dataset.f }));
    el.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => A2Router.setQuery({ cat: b.dataset.cat }));

    const again = () => render(el, A2Router.parse());
    const post = async (url, body, okMsg) => {
      try {
        await API.post(url, body);
        if (okMsg) UI.toast(okMsg);
        await again();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    el.querySelectorAll('[data-claim]').forEach((b) => b.onclick = () =>
      post('/api/admin/support/claim', { ticketId: b.dataset.claim }, '📌 Взято в работу'));
    el.querySelectorAll('[data-release]').forEach((b) => b.onclick = () =>
      post('/api/admin/support/release', { ticketId: b.dataset.release }, '↩️ Возвращено в очередь'));

    const reply = async (id, close) => {
      const box = el.querySelector('[data-draft="' + id + '"]');
      const text = (box && box.value || '').trim();
      if (!text) { UI.toast('⛔ Ответ пустой'); return; }
      try {
        await API.post('/api/admin/support/reply', { ticketId: id, text, close: !!close });
        delete drafts[id];             // отправлено — черновик больше не нужен
        if (box) box.value = '';
        await again();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    el.querySelectorAll('[data-ans]').forEach((b) => b.onclick = () => reply(b.dataset.ans, false));
    el.querySelectorAll('[data-ans-close]').forEach((b) => b.onclick = () => reply(b.dataset.ansClose, true));
  }

  function saveDrafts(el) {
    if (!el) return;
    el.querySelectorAll('[data-draft]').forEach((t) => {
      const v = t.value || '';
      if (v.trim()) drafts[t.dataset.draft] = v; else delete drafts[t.dataset.draft];
    });
  }
  function restoreDrafts(el) {
    el.querySelectorAll('[data-draft]').forEach((t) => {
      if (drafts[t.dataset.draft]) t.value = drafts[t.dataset.draft];
    });
  }

  // Наружу — для теста и для случая, когда экран уходит целиком
  A2.screens.support = render;
  A2._supportDrafts = drafts;
})();
