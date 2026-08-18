// ===================================================================
// public/js/admin2/players.js — список игроков #/players?q=…
//
// Список нарочно тонкий: он умеет искать и вести на страницу игрока,
// и больше ничего. Всё, что делают С игроком, живёт на его странице.
// В v1 список был и списком, и карточкой, и формой выдачи сразу —
// поэтому строка таблицы обрастала кнопками, а разбор дела начинался
// с попадания мышью в нужную ячейку.
//
// Поисковый запрос лежит в адресе (?q=). Это не украшение: «посмотри
// вот этих» пересылается ссылкой, а F5 не сбрасывает поиск.
// ===================================================================

(function () {
  const ago = (ms) => {
    if (!ms) return '—';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 60) return m + ' мин';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' ч' : Math.round(h / 24) + ' дн';
  };

  async function load(q) {
    const box = document.getElementById('pls-list');
    if (!box) return;
    box.innerHTML = '<div class="loading">Ищу…</div>';
    let players = [];
    try {
      const r = await API.get('/api/admin/players?q=' + encodeURIComponent(q || ''));
      players = r.players || [];
    } catch (e) {
      box.innerHTML = `<p class="a2-muted" style="color:var(--red)">${UI.esc(e.message)}</p>`;
      return;
    }
    if (!players.length) {
      box.innerHTML = '<p class="a2-muted">Никого не найдено. Позывной вводится целиком или частью.</p>';
      return;
    }
    box.innerHTML = players.map((p) => `
      <a class="a2-item" href="${A2Router.build('player', p.id)}" style="text-decoration:none;color:inherit">
        <div class="a2-item-ico">${p.flag || '👤'}</div>
        <div class="a2-item-txt"><b>${UI.esc(p.name)}</b>
          ${p.accountBan ? '<span class="a2-pill is-bad">заблокирован</span>' : ''}
          ${p.chatBan ? '<span class="a2-pill is-warn">чат закрыт</span>' : ''}
          <div class="a2-item-when">ур. ${p.level} ·
            ${UI.fmtMoney ? UI.fmtMoney(p.dollars) : p.dollars} · 🪙 ${UI.fmtNum ? UI.fmtNum(p.gold) : p.gold} ·
            заходил ${ago(p.lastSeen)} назад</div></div>
        <span class="a2-muted">Открыть →</span>
      </a>`).join('');
  }

  function render(el, route) {
    const q = route.query.q || '';
    el.innerHTML = `
      <div class="a2-title">Игроки</div>
      <div class="a2-card">
        <div class="a2-row">
          <input id="pls-q" type="search" value="${UI.esc(q)}" placeholder="Позывной или его часть…"
            style="flex:1;min-width:200px;padding:6px 10px;background:var(--bg);color:var(--text);
                   border:1px solid var(--border);border-radius:8px">
          <button class="btn btn-orange btn-inline" id="pls-go">Найти</button>
        </div>
        <p class="a2-muted" style="margin:6px 0 0">Строка ведёт на страницу игрока: там счёт, меры,
          выдача, журнал и история состояния — в одном месте.</p>
      </div>
      ${Admin._historyHtml ? `<div class="a2-legacy">${Admin._historyHtml()}</div>` : ''}
      <div class="a2-card"><div id="pls-list"></div></div>`;

    // История состояния — старый блок как есть: он самый нужный
    // инструмент разбора, и переписывать его ради оформления нельзя.
    if (Admin._bindHistoryForm) {
      try { Admin._bindHistoryForm(); } catch (e) {}
      // Пришли со страницы игрока по ссылке «История состояния» —
      // подставляем позывной и сразу показываем, чтобы не искать заново.
      if (route.query.history) {
        const inp = document.getElementById('hist-q');
        const btn = document.getElementById('hist-go');
        if (inp && btn) {
          // Блок свёрнут в <details> — раскрываем, иначе результат
          // отрисовался бы в невидимую область и выглядел как «не работает»
          const det = inp.closest('details');
          if (det) det.open = true;
          inp.value = route.query.history;
          btn.click();
        }
      }
    }

    const input = document.getElementById('pls-q');
    const go = () => A2Router.setQuery({ q: input.value.trim() });
    document.getElementById('pls-go').onclick = go;
    input.onkeydown = (e) => { if (e.key === 'Enter') go(); };

    load(q);
  }

  A2.screens.players = render;
})();
