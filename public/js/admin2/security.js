// ===================================================================
// public/js/admin2/security.js — вход и защита учётной записи #/security
//
// Здесь сотрудник подключает второй фактор себе сам. Не владелец за
// него: секрет должен попасть только на его телефон, а коды
// восстановления не должны пройти через чужие руки.
//
// Экран нарочно объясняет, зачем это, а не просто предлагает кнопку.
// Второй фактор включают, когда понимают, от чего он защищает; иначе
// он воспринимается как лишний шаг при входе и не включается никогда.
// ===================================================================

(function () {
  // Показ кодов восстановления — единственный за всё время. Повторить
  // его нельзя: в базе только хеши. Поэтому окно нарочно неудобно
  // закрыть случайно.
  function showRecovery(codes) {
    const box = document.getElementById('sec-recovery');
    if (!box) return;
    box.innerHTML = `
      <div class="a2-card" style="border-color:var(--gold)">
        <h3 style="color:var(--gold)">Коды восстановления — сохраните сейчас</h3>
        <p class="a2-muted">Показываются <b>один раз</b>: в базе хранятся только их отпечатки,
          повторить показ не сможет никто, включая владельца. Каждый код срабатывает один раз.
          Нужны, если телефон потерян или сломан — без них доступ к панели вернуть будет нечем.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;
                    font-family:monospace;font-size:14px;margin:8px 0">
          ${codes.map((c) => `<div style="padding:5px 8px;border:1px solid var(--border);border-radius:6px">${UI.esc(c)}</div>`).join('')}
        </div>
        <div class="a2-row">
          <button class="btn btn-inline" id="sec-copy">Скопировать все</button>
          <span class="a2-muted">Положите их туда, где не лежит пароль от игры.</span>
        </div>
      </div>`;
    const copy = document.getElementById('sec-copy');
    if (copy) copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(codes.join('\n'));
        UI.toast('📋 Коды скопированы');
      } catch (e) { UI.toast('⛔ Скопируйте вручную — браузер не разрешил доступ к буферу'); }
    };
  }

  async function render(el) {
    el.innerHTML = '<div class="a2-title">Защита входа</div><div class="loading">Проверяю…</div>';
    let st = null;
    try { st = await API.get('/api/2fa/status'); }
    catch (e) {
      el.innerHTML = `<div class="a2-title">Защита входа</div>
        <div class="a2-card"><p class="a2-muted">${UI.esc(e.message)}</p></div>`;
      return;
    }

    const why = `<p class="a2-muted">Пароль — единственное, что отделяет постороннего от выдачи
      ресурсов, банов и базы игроков. Пароли утекают буднично: повторяются на других сайтах,
      остаются в переписке, теряются вместе с телефоном. Второй фактор превращает «узнал пароль»
      в «узнал пароль <b>и</b> держит в руках ваш телефон».</p>`;

    if (st.enabled) {
      el.innerHTML = `
        <div class="a2-title">Защита входа</div>
        <div class="a2-card">
          <h3>Второй фактор <span class="a2-pill is-ok">включён</span></h3>
          ${why}
          <p class="a2-muted">Включён ${st.enabledAt ? new Date(st.enabledAt).toLocaleDateString('ru-RU') : ''} ·
            кодов восстановления осталось: <b>${st.recoveryLeft}</b>
            ${st.recoveryLeft <= 2 ? '<span class="a2-pill is-warn">пора обновить</span>' : ''}</p>
          <div class="a2-row" style="margin-top:8px">
            <input id="sec-code" placeholder="код из приложения" autocomplete="one-time-code"
              style="width:160px;padding:6px 10px;background:var(--bg);color:var(--text);
                     border:1px solid var(--border);border-radius:8px">
            <button class="btn btn-inline" id="sec-newcodes">Новые коды восстановления</button>
            <button class="btn btn-inline btn-red" id="sec-off">Выключить</button>
          </div>
        </div>
        <div id="sec-recovery"></div>`;

      const codeOf = () => (document.getElementById('sec-code').value || '').trim();
      document.getElementById('sec-newcodes').onclick = async () => {
        if (!codeOf()) return UI.toast('⛔ Введите код из приложения');
        try {
          const r = await API.post('/api/2fa/recovery', { code: codeOf() });
          showRecovery(r.recoveryCodes);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
      document.getElementById('sec-off').onclick = async () => {
        if (!codeOf()) return UI.toast('⛔ Введите код — без него выключить нельзя');
        if (!await UI.confirm('Выключить второй фактор?\n\n'
            + 'После этого для входа в панель хватит одного пароля.', {
            title: 'Отключение защиты', icon: '🔓', okText: 'Выключить', danger: true })) return;
        try {
          await API.post('/api/2fa/disable', { code: codeOf() });
          A2.refresh();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
      return;
    }

    // Не включён (возможно, ключ уже выдан, но подтверждения не было)
    el.innerHTML = `
      <div class="a2-title">Защита входа</div>
      <div class="a2-card">
        <h3>Второй фактор <span class="a2-pill ${st.pending ? 'is-warn' : 'is-bad'}">${st.pending ? 'не завершён' : 'выключен'}</span></h3>
        ${why}
        <p class="a2-muted">Подойдёт любое приложение-аутентификатор, которое у вас уже есть:
          Google Authenticator, Яндекс.Ключ, Authy, 1Password. Специальное ставить не нужно.</p>
        <button class="btn btn-orange btn-inline" id="sec-start">${st.pending ? 'Показать ключ заново' : 'Подключить'}</button>
      </div>
      <div id="sec-setup"></div>
      <div id="sec-recovery"></div>`;

    document.getElementById('sec-start').onclick = async () => {
      let d = null;
      try { d = await API.post('/api/2fa/setup', {}); }
      catch (e) { return UI.toast('⛔ ' + e.message); }
      // Ключ обязателен: без него показывать нечего, а обращение к
      // d.secret уронило бы экран целиком и человек остался бы
      // с пустой страницей вместо объяснения.
      if (!d || !d.secret) return UI.toast('⛔ Сервер не выдал ключ — попробуйте ещё раз');
      document.getElementById('sec-setup').innerHTML = `
        <div class="a2-card">
          <h3>Шаг 1 — добавьте запись в приложение</h3>
          <p class="a2-muted">Введите этот ключ вручную (кнопка «ввести ключ» в приложении):</p>
          <div style="font-family:monospace;font-size:17px;letter-spacing:2px;padding:8px;
                      border:1px solid var(--border);border-radius:8px;display:inline-block">
            ${UI.esc(d.secret.replace(/(.{4})/g, '$1 ').trim())}</div>
          <div class="a2-row" style="margin-top:6px">
            <button class="btn btn-inline" id="sec-copykey">Скопировать ключ</button>
            <span class="a2-muted">${d.digits} цифр, обновляется раз в ${d.step} секунд</span>
          </div>
          <h3 style="margin-top:12px">Шаг 2 — подтвердите кодом</h3>
          <p class="a2-muted">Введите код, который приложение показывает прямо сейчас.
            Пока код не проверен, фактор <b>не включается</b> — так нельзя запереть себя опечаткой.</p>
          <div class="a2-row">
            <input id="sec-confirm" placeholder="123 456" autocomplete="one-time-code"
              style="width:160px;padding:6px 10px;background:var(--bg);color:var(--text);
                     border:1px solid var(--border);border-radius:8px">
            <button class="btn btn-orange btn-inline" id="sec-enable">Включить</button>
          </div>
          <p class="a2-muted" style="margin-top:8px">Код не подходит? Проверьте время на телефоне —
            коды считаются от часов, и расхождение больше минуты ломает их.</p>
        </div>`;
      const ck = document.getElementById('sec-copykey');
      if (ck) ck.onclick = async () => {
        try { await navigator.clipboard.writeText(d.secret); UI.toast('📋 Ключ скопирован'); }
        catch (e) { UI.toast('⛔ Скопируйте вручную'); }
      };
      document.getElementById('sec-enable').onclick = async () => {
        const code = (document.getElementById('sec-confirm').value || '').trim();
        if (!code) return UI.toast('⛔ Введите код из приложения');
        try {
          const r = await API.post('/api/2fa/enable', { code });
          document.getElementById('sec-setup').innerHTML = '';
          showRecovery(r.recoveryCodes);
          UI.toast('🔐 Второй фактор включён');
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    };
  }

  A2.screens.security = render;
})();
