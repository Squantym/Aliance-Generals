// ===================================================================
// public/js/admin2/sessions.js — открытые входы #/sessions
//
// Показывает, у кого прямо сейчас открыт кабинет, с какого устройства и
// адреса, и позволяет закрыть вход: одну сессию, все сессии игрока или
// вообще все на сервере.
//
// Зачем закрывать вход силой: после смены правил, утечки пароля или
// подозрения на угон нужно, чтобы человек ввёл пароль заново. Бан для
// этого не годится — он наказывает; здесь наказания нет, только
// требование войти ещё раз.
//
// Чего кнопка НЕ делает: не разлогинивает навсегда, не блокирует и не
// трогает данные. Игрок вводит пароль и продолжает играть.
// ===================================================================

(function () {
  const dt = (ms) => ms
    ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';

  async function render(el) {
    el.innerHTML = '<div class="a2-title">Открытые входы</div><div class="loading">Считаю…</div>';
    let d = null;
    try { d = await API.get('/api/admin/sessions'); }
    catch (e) {
      el.innerHTML = `<div class="a2-title">Открытые входы</div>
        <div class="a2-card"><p class="a2-muted">${UI.esc(e.message)}</p></div>`;
      return;
    }

    const rows = d.rows || [];
    el.innerHTML = `
      <div class="a2-title">Открытые входы</div>

      <div class="a2-card">
        <div class="a2-row" style="justify-content:space-between;align-items:baseline">
          <div>
            <h3 style="margin:0">Сейчас открыто: ${d.total}</h3>
            <p class="a2-muted" style="margin:2px 0 0">У ${d.players} игрок(ов). Один человек может
              держать несколько входов — телефон, компьютер, другой браузер.</p>
          </div>
          <button class="btn btn-red" id="kick-all">🚪 Выкинуть всех</button>
        </div>
        <p class="a2-muted" style="margin-top:8px">«Выкинуть всех» закрывает все сессии сразу,
          включая вашу собственную — панель попросит войти заново. Это не бан: игроки просто
          вводят пароль. Уместно после смены правил доступа или подозрения на утечку.</p>
      </div>

      ${rows.length ? rows.map((r) => `
        <div class="a2-card">
          <div class="a2-row" style="justify-content:space-between;align-items:baseline">
            <div>
              <b>${UI.esc(r.name)}</b>
              <span class="a2-muted">ур. ${r.level} · входов открыто: ${r.n}</span>
            </div>
            <button class="btn btn-inline" data-kick-user="${UI.esc(r.id)}">Выкинуть</button>
          </div>
          <table class="access-table" style="margin-top:6px">
            <tbody>
              ${(r.sessions || []).map((s) => `
                <tr>
                  <td class="small">${UI.esc(s.device || 'неизвестное устройство')}</td>
                  <td class="mono small">${UI.esc(s.ip || '—')}</td>
                  <td class="small a2-muted nowrap">вход ${dt(s.startedAt)}</td>
                  <td class="small a2-muted nowrap">активность ${dt(s.at)}</td>
                  <td><button class="btn btn-inline" data-kick-token="${UI.esc(s.token)}">Закрыть</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`).join('')
      : '<div class="a2-card"><p class="a2-muted">Сейчас в игре никого — открытых входов нет.</p></div>'}`;

    el.querySelectorAll('[data-kick-token]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await API.post('/api/admin/sessions/kick', { token: btn.getAttribute('data-kick-token') });
          btn.closest('tr').remove();
        } catch (e) { UI.toast('⛔ ' + e.message); btn.disabled = false; }
      };
    });

    el.querySelectorAll('[data-kick-user]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await API.post('/api/admin/sessions/kick', { userId: btn.getAttribute('data-kick-user') });
          render(el);
        } catch (e) { UI.toast('⛔ ' + e.message); btn.disabled = false; }
      };
    });

    const all = document.getElementById('kick-all');
    if (all) all.onclick = async () => {
      // Подтверждение обязательно: действие затрагивает всех разом и
      // выкидывает в том числе того, кто нажал.
      const ok = await UI.confirm(
        `Закрыть все ${d.total} открытых входов? Каждый игрок при следующем действии увидит
         экран входа и введёт пароль. Ваша сессия тоже закроется.`,
        { title: 'Выкинуть всех из кабинетов', icon: '🚪', danger: true, okText: 'Да, выкинуть всех' });
      if (!ok) return;
      try {
        const r = await API.post('/api/admin/sessions/kick', { all: true });
        UI.toast(`🚪 Закрыто сессий: ${r.killed}`);
        render(el);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  A2.screens.sessions = render;
})();
