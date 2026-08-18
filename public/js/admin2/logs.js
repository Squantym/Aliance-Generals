// ===================================================================
// public/js/admin2/logs.js — журнал действий #/logs?user=…&cat=…
//
// Экран, который выигрывает от адреса больше всех остальных. Разбор
// жалобы почти всегда выглядит так: «посмотри, что делал вот этот
// в районе полудня». В v1 это означало продиктовать напарнику
// последовательность действий: открыть вкладку, вписать id, выбрать
// категорию, нажать «Загрузить». Теперь это одна ссылка.
//
// Что ещё изменилось:
//   • журнал грузится сам, если в адресе есть игрок или категория.
//     Кнопка «Загрузить» на пустом экране была лишним шагом ровно там,
//     где спешат;
//   • позывной ведёт на страницу игрока, а отдельная кнопка рядом
//     сужает журнал до него — раньше клик по имени делал второе, и
//     промахнуться было нечем, потому что первого просто не было;
//   • разметка без inline-onclick: старый код вклеивал id игрока прямо
//     в строку обработчика, и любой апостроф в значении ломал таблицу.
// ===================================================================

(function () {
  const CATS = [
    ['all', 'Все'],
    ['buy', '🛒 Покупки'],
    ['battle', '⚔️ Бои'],
    ['legion', '🏛 Легион'],
    ['auth', '🔑 Входы'],
    ['admin', '🛡 Действия сотрудников'],
  ];

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  // Подсветка строки по типу действия: глаз находит бои среди покупок
  // быстрее, чем читает каждую строку.
  const rowColor = (e) => {
    const p = String(e.path || '');
    if (/\/(attack|fatality|war)/.test(p)) return '#ff4d4d22';
    if (/\/buy|\/build|\/container/.test(p)) return '#4dff9922';
    if (/\/legion/.test(p)) return '#4d9fff22';
    if (/\/(login|register)/.test(p)) return '#ff9f4d22';
    return 'transparent';
  };
  const iconFor = (e) => {
    const p = String(e.path || '');
    if (/\/(attack|fatality|war|battle)/.test(p)) return '⚔️';
    if (/\/buy/.test(p)) return '🛒';
    if (/\/build/.test(p)) return '🏗';
    if (/\/legion/.test(p)) return '🏛';
    if (/\/(login|register)/.test(p)) return '🔑';
    return '•';
  };

  async function load(el, route) {
    const box = document.getElementById('lg-out');
    if (!box) return;
    const user = route.query.user || '';
    const cat = route.query.cat || 'all';
    const limit = Math.max(10, Math.min(1000, parseInt(route.query.limit, 10) || 200));

    box.innerHTML = '<div class="loading">Читаю журнал…</div>';
    let r = null;
    try {
      r = await API.get('/api/admin/logs?limit=' + limit + '&category=' + encodeURIComponent(cat)
        + (user ? '&userId=' + encodeURIComponent(user) : ''));
    } catch (e) {
      box.innerHTML = `<p class="a2-muted" style="color:var(--red)">${UI.esc(e.message)}</p>`;
      return;
    }
    const logs = r.logs || [];
    if (!logs.length) {
      box.innerHTML = `<p class="a2-muted">Записей нет.`
        + (r.scanned ? ` Просмотрено ${UI.fmtNum(r.scanned)} записей журнала.` : '')
        + (cat !== 'all' ? ' Возможно, стоит снять фильтр по разделу.' : '') + '</p>';
      return;
    }

    // Если подходящих записей больше, чем влезло в лимит, сказать об
    // этом обязательно: иначе сотрудник решит, что видит всё.
    const more = r.more
      ? ` · <span style="color:var(--gold)">показаны первые ${logs.length}, подходящих больше — поднимите лимит</span>`
      : '';

    box.innerHTML = `
      <div class="a2-muted" style="margin-bottom:6px">${logs.length} записей${
        r.scanned && r.category !== 'all' ? ` · отобрано из ${UI.fmtNum(r.scanned)} просмотренных` : ''}${more}</div>
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="padding:6px 10px;text-align:left;white-space:nowrap">Время</th>
          <th style="padding:6px 10px;text-align:left">Игрок</th>
          <th style="padding:6px 10px;text-align:left">Действие</th>
          <th style="padding:6px 10px;text-align:left;color:var(--dim)">Маршрут</th>
        </tr></thead>
        <tbody>${logs.map((e) => `
          <tr style="border-bottom:1px solid var(--border-dim);background:${rowColor(e)}">
            <td style="padding:5px 10px;white-space:nowrap;color:var(--dim)">${fmtDate(e.at)}</td>
            <td style="padding:5px 10px;white-space:nowrap">
              ${e.userId
                ? `<a href="${A2Router.build('player', e.userId)}">${UI.esc(e.userName || '—')}</a>
                   <button class="btn btn-inline" style="padding:0 5px;font-size:11px"
                     data-only="${UI.esc(e.userId)}" title="Показать журнал только этого игрока">только он</button>`
                : UI.esc(e.userName || '—')}
            </td>
            <td style="padding:5px 10px">${iconFor(e)} ${UI.esc(e.human || e.desc || e.path)}</td>
            <td style="padding:5px 10px;color:var(--dim);font-size:11px">${UI.esc(e.path)}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;

    box.querySelectorAll('[data-only]').forEach((b) => {
      b.onclick = () => A2Router.setQuery({ user: b.dataset.only });
    });
  }

  function render(el, route) {
    const user = route.query.user || '';
    const cat = route.query.cat || 'all';
    const limit = route.query.limit || '200';

    el.innerHTML = `
      <div class="a2-title">Журнал действий</div>
      <div class="a2-card">
        <div class="a2-row">
          <input id="lg-user" type="search" value="${UI.esc(user)}"
            placeholder="ID или позывной игрока (пусто — все)"
            style="flex:1;min-width:200px;padding:6px 10px;background:var(--bg);color:var(--text);
                   border:1px solid var(--border);border-radius:8px">
          <input id="lg-limit" type="number" min="10" max="1000" value="${UI.esc(limit)}"
            style="width:90px;padding:6px 8px;background:var(--bg);color:var(--text);
                   border:1px solid var(--border);border-radius:8px">
          <button class="btn btn-orange btn-inline" id="lg-go">Показать</button>
        </div>
        <div class="a2-row" style="margin-top:8px">
          ${CATS.map(([id, label]) => `<button class="btn btn-inline ${cat === id ? 'btn-orange' : ''}"
            data-cat="${id}">${label}</button>`).join('')}
        </div>
        <p class="a2-muted" style="margin:8px 0 0">Здесь действия <b>игроков</b>. Действия сотрудников —
          выдачи, баны, сбросы — ведутся отдельным журналом в разделе «Роли»: смешивать их с игровым
          потоком нельзя, иначе в тысяче строк «купил танк» бан теряется.
          ${A2.isOwner() ? `<a href="${A2Router.build('roles')}">Журнал сотрудников →</a>` : ''}</p>
      </div>
      <div class="a2-card"><div id="lg-out"></div></div>`;

    const go = () => A2Router.setQuery({
      user: document.getElementById('lg-user').value.trim(),
      limit: document.getElementById('lg-limit').value || '200',
    });
    document.getElementById('lg-go').onclick = go;
    document.getElementById('lg-user').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    el.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = () => A2Router.setQuery({ cat: b.dataset.cat });
    });

    // Грузим сразу. Пустой экран с кнопкой «Загрузить» — лишний шаг
    // ровно там, где спешат: журнал открывают, когда что-то случилось.
    load(el, route);
  }

  A2.screens.logs = render;
})();
