// ===================================================================
// public/js/admin2/player.js — страница игрока #/player/<id>
//
// В v1 работа с игроком была разложена по четырём местам: карточка в
// списке «Игроки», отдельные окна блокировок, форма выдачи, история
// состояния в другой вкладке, журнал — в третьей. Разбор одной жалобы
// означал четыре перехода и потерю контекста на каждом: вернувшись из
// «Журнала», сотрудник снова искал игрока поиском.
//
// Здесь всё про одного человека на одной странице, и у страницы есть
// адрес — её можно переслать напарнику или оставить в закладке.
//
// Действия НЕ переписаны заново, а вызваны из старой панели
// (banChatDialog, banAccountDialog, renderGrantForm). В них накоплены
// подтверждения, права и обходы граблей; переписывание ради единого
// стиля означало бы потерять это молча.
// ===================================================================

(function () {
  const ago = (ms) => {
    if (!ms) return 'никогда';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' ч назад' : Math.round(h / 24) + ' дн назад';
  };
  const until = (ts) => {
    if (!ts) return 'бессрочно';
    const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
    if (m < 60) return 'ещё ' + m + ' мин';
    if (m < 1440) return 'ещё ' + Math.floor(m / 60) + ' ч';
    return 'ещё ' + Math.floor(m / 1440) + ' дн';
  };

  function banHtml(p) {
    const rows = [];
    if (p.accountBan) {
      rows.push(`<div class="a2-item is-hot"><div class="a2-item-ico">🚫</div>
        <div class="a2-item-txt"><b>Аккаунт заблокирован</b> — ${UI.esc(p.accountBan.reason || 'без причины')}
          <div class="a2-item-when">${UI.esc(until(p.accountBan.until))} · выдал ${UI.esc(p.accountBan.byName || '—')}</div></div>
        ${p.can && p.can.accountBan ? '<button class="btn btn-inline" data-act="acc">Снять</button>' : ''}</div>`);
    }
    if (p.chatBan) {
      rows.push(`<div class="a2-item"><div class="a2-item-ico">🔇</div>
        <div class="a2-item-txt"><b>Чат закрыт</b> — ${UI.esc(p.chatBan.reason || 'без причины')}
          <div class="a2-item-when">${UI.esc(until(p.chatBan.until))} · выдал ${UI.esc(p.chatBan.byName || '—')}</div></div>
        ${p.can && p.can.chatBan ? '<button class="btn btn-inline" data-act="chat">Снять</button>' : ''}</div>`);
    }
    if (!rows.length) rows.push('<p class="a2-muted">Мер нет.</p>');
    return rows.join('');
  }

  async function render(el, route) {
    const id = route.arg;
    if (!id) return A2Router.go('players', '', null, true);

    el.innerHTML = '<div class="loading">Открываю досье…</div>';
    let p = null;
    try { p = await API.get('/api/admin/player-card/' + encodeURIComponent(id)); }
    catch (e) {
      el.innerHTML = `<div class="a2-card"><h3 style="color:var(--red)">Игрок не открылся</h3>
        <p class="a2-muted">${UI.esc(e.message)}</p>
        <a class="btn btn-inline" href="${A2Router.build('players')}">← К списку</a></div>`;
      return;
    }
    A2._playerName = p.name;
    A2.crumbs(route);

    const recent = (p.recent || []).map((l) => `
      <div class="a2-item"><div class="a2-item-ico">·</div>
        <div class="a2-item-txt">${UI.esc(l.human || l.path || '')}
          <div class="a2-item-when">${UI.esc(ago(l.at))}</div></div></div>`).join('');

    el.innerHTML = `
      <div class="a2-title">${p.flag || ''} ${UI.esc(p.name)}
        <span class="a2-pill ${p.online ? 'is-ok' : ''}">${p.online ? 'в игре' : ago(p.lastSeen)}</span></div>
      <div class="a2-sub">ур. ${p.level} · ${UI.esc(p.roleLabel || 'игрок')} ·
        в игре с ${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU') : '—'} ·
        <code>${UI.esc(p.id)}</code>${p.email ? ' · ' + UI.esc(p.email) : ''}</div>

      <div class="a2-grid">
        <div class="a2-card">
          <h3>Счёт</h3>
          <div class="a2-item"><div class="a2-item-ico">💵</div>
            <div class="a2-item-txt">Доллары: <b>${UI.fmtMoney ? UI.fmtMoney(p.dollars) : p.dollars}</b></div></div>
          <div class="a2-item"><div class="a2-item-ico">🪙</div>
            <div class="a2-item-txt">Золото: <b>${UI.fmtNum ? UI.fmtNum(p.gold) : p.gold}</b></div></div>
          ${p.legionId ? `<div class="a2-item"><div class="a2-item-ico">🎖</div>
            <div class="a2-item-txt">Состоит в легионе</div></div>` : ''}
        </div>

        <div class="a2-card" id="pl-bans">
          <h3>Меры</h3>
          ${banHtml(p)}
          <div class="a2-row" style="margin-top:8px">
            ${p.can && p.can.chatBan && !p.chatBan ? '<button class="btn btn-inline" data-act="chat">🔇 Закрыть чат</button>' : ''}
            ${p.can && p.can.accountBan && !p.accountBan ? '<button class="btn btn-inline btn-red" data-act="acc">🚫 Заблокировать</button>' : ''}
          </div>
        </div>

        <div class="a2-card">
          <h3>Разбор</h3>
          <p class="a2-muted">Оба разбора открываются уже наведёнными на этого игрока.</p>
          <div class="a2-row">
            <a class="btn btn-inline" href="${A2Router.build('logs', '', { user: p.id })}">📋 Журнал действий</a>
            <a class="btn btn-inline" href="${A2Router.build('players', '', { history: p.name })}">🕘 История состояния</a>
          </div>
        </div>
      </div>

      ${p.can && p.can.resources ? '<div class="a2-card"><h3>Выдать или забрать</h3><div id="pl-grant"></div></div>' : ''}

      ${p.can && p.can.password ? `
      <details class="a2-card">
        <summary style="cursor:pointer;color:var(--red)"><b>Опасные операции</b>
          <span class="a2-muted"> — смена пароля и удаление аккаунта</span></summary>
        <p class="a2-muted" style="margin:8px 0">Свёрнуто нарочно: обе операции нужны редко,
          а промахнуться по ним легко. Раньше они жили в «Технике» со своим отдельным поиском
          игрока — и это был второй способ выбрать не того человека.</p>

        <div style="border:1px solid var(--orange);border-radius:8px;padding:8px;margin-bottom:10px">
          <b>🔑 Установить пароль</b>
          <p class="a2-muted" style="margin:4px 0">Когда игрок забыл пароль, а почта недоступна.
            Старый пароль не нужен, минимум 8 символов. Все активные сессии сбросятся.</p>
          <div class="a2-row">
            <input id="pl-pass" type="password" autocomplete="new-password" placeholder="новый пароль…"
              style="flex:1;min-width:180px;padding:6px 10px;background:var(--bg);color:var(--text);
                     border:1px solid var(--border);border-radius:8px">
            <button class="btn btn-inline" id="pl-pass-eye" title="Показать пароль">👁</button>
            <button class="btn btn-orange btn-inline" id="pl-pass-go">Установить</button>
          </div>
        </div>

        <div style="border:1px solid var(--red);border-radius:8px;padding:8px">
          <b style="color:var(--red)">🗑 Удалить аккаунт навсегда</b>
          <p class="a2-muted" style="margin:4px 0">Аккаунт стирается целиком: почта, уведомления,
            санкции, награды, обращения, участие в боях и сообщения в чате. Позывной и почта
            освобождаются. <b style="color:var(--red)">Необратимо.</b>
            Если нужно только обнулить прогресс — это «Обнулить аккаунт», другая операция.</p>
          <div class="a2-row">
            <input id="pl-del" placeholder="впечатайте позывной: ${UI.esc(p.name)}"
              style="flex:1;min-width:200px;padding:6px 10px;background:var(--bg);color:var(--text);
                     border:1px solid var(--border);border-radius:8px">
            <button class="btn btn-red btn-inline" id="pl-del-go">Удалить</button>
          </div>
        </div>
      </details>` : ''}

      <div class="a2-card">
        <h3>Последние действия</h3>
        ${recent || '<p class="a2-muted">Записей нет.</p>'}
      </div>`;

    // Меры — старыми диалогами: в них живут подтверждения и права
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const act = b.dataset.act;
        if (act === 'chat') await Admin.banChatDialog(p.id, p.name, !!p.chatBan);
        if (act === 'acc') await Admin.banAccountDialog(p.id, p.name, !!p.accountBan);
        // Перерисовываем страницу, а не всю панель: меню и адрес на месте
        A2.refresh();
      };
    });

    // Выдача — прямо на странице, без окна поверх. Форма старая:
    // в ней быстрые суммы, выдача письмом и списание.
    const grantBox = document.getElementById('pl-grant');
    if (grantBox) {
      Admin.renderGrantForm({
        id: p.id, name: p.name, flag: p.flag, level: p.level,
        dollars: p.dollars, gold: p.gold,
      }, grantBox);
      // Крестик формы в списке игроков закрывал панель выдачи. Здесь
      // закрывать нечего — страница и есть карточка, поэтому прячем.
      const x = grantBox.querySelector('#g-cancel');
      if (x) x.style.display = 'none';
    }

    // ── Опасные операции ─────────────────────────────────────────
    const eye = document.getElementById('pl-pass-eye');
    if (eye) {
      const inp = document.getElementById('pl-pass');
      eye.onclick = () => { inp.type = inp.type === 'password' ? 'text' : 'password'; };
    }
    const passGo = document.getElementById('pl-pass-go');
    if (passGo) passGo.onclick = async () => {
      const inp = document.getElementById('pl-pass');
      const password = inp.value;
      if (password.length < 8) return UI.toast('⛔ Пароль: минимум 8 символов');
      if (!await UI.confirm(`Установить новый пароль игроку «${p.name}»?\n\n`
        + 'Все активные сессии игрока будут сброшены — войти можно будет только с новым паролем.', {
        title: 'Смена пароля', icon: '🔑', okText: 'Установить', danger: true,
      })) return;
      try {
        const r = await API.post('/api/admin/set-password', { userId: p.id, password });
        UI.toast((r.notices && r.notices[0]) || '🔑 Пароль установлен');
        inp.value = '';
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    const delGo = document.getElementById('pl-del-go');
    if (delGo) delGo.onclick = async () => {
      const confirmName = (document.getElementById('pl-del').value || '').trim();
      // Два независимых подтверждения: впечатать позывной и впечатать
      // слово. Первое отвечает на «того ли игрока», второе — на «точно ли
      // удалить». Одно вместо двух отвечает только на половину вопроса.
      if (confirmName.toLowerCase() !== String(p.name).toLowerCase()) {
        return UI.toast('⛔ Позывной в поле подтверждения не совпадает');
      }
      if (!await Admin.danger({
        title: `Удалить «${p.name}» навсегда`, word: 'УДАЛИТЬ',
        what: 'Аккаунт стирается из игры целиком. Позывной и почта освободятся, вход станет невозможен.',
        scope: `игрока «${p.name}»`,
      })) return;
      try {
        const r = await API.post('/api/admin/delete-account', { userId: p.id, confirmName });
        UI.toast((r.notices && r.notices[0]) || '🗑 Аккаунт удалён');
        // Возвращаться на страницу удалённого игрока некуда — уходим
        // в список, иначе экран показал бы «игрок не найден».
        A2Router.go('players');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  A2.screens.player = render;
})();
