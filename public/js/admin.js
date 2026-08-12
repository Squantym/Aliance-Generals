// ===================================================================
// public/js/admin.js — Панель администратора «Генералов»
// ===================================================================

const Admin = {
  selected: null,
  tab: 'home',   // players | logs | discounts | buffs

  // Роль и доступные зоны текущего сотрудника — по ним прячем разделы
  me: null,
  zones: [],

  async init() {
    if (API.token()) {
      try {
        const me = await API.get('/api/me');
        // Пускаем по ЗОНАМ, а не по старому флагу isAdmin: у владельца их
        // все, у администратора — свои, у модератора нет ни одной, и он
        // работает прямо из чата
        if (me.staffZones && me.staffZones.length) {
          Admin.me = me;
          Admin.zones = me.staffZones;
          return Admin.render();
        }
        UI.toast(me.staffRole === 'moderator'
          ? '⛔ Модератор работает из чата игры, панель ему не нужна'
          : '⛔ У этой учётной записи нет доступа к панели');
      } catch(e) {}
    }
    Admin.renderLogin();
  },

  // Есть ли доступ к разделу
  can(zone) { return Admin.zones.indexOf(zone) !== -1; },

  renderLogin() {
    document.getElementById('content').innerHTML = `
      <div class="card" style="max-width:380px;margin:40px auto">
        <div class="title" style="margin-top:0;text-align:center">⚙️ Вход для администратора</div>
        <label>Позывной</label><input type="text" id="ad-name" autocomplete="username">
        <label>Пароль</label><input type="password" id="ad-pass" autocomplete="current-password">
        <button class="btn btn-orange mt" id="ad-go" style="width:100%">Войти</button>
        <p class="muted small mt center">Доступ ограничен.</p>
      </div>`;
    const go = async () => {
      try {
        const r = await API.post('/api/login', {
          login: document.getElementById('ad-name').value,
          password: document.getElementById('ad-pass').value,
        });
        API.setToken(r.token);
        const me = await API.get('/api/me');
        if (!me.staffZones || !me.staffZones.length) {
          return UI.toast(me.staffRole === 'moderator'
            ? '⛔ Модератор работает из чата игры, панель ему не нужна'
            : '⛔ Нет доступа к панели');
        }
        Admin.me = me;
        Admin.zones = me.staffZones;
        Admin.render();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('ad-go').onclick = go;
    document.getElementById('ad-pass').onkeydown = e => { if(e.key==='Enter') go(); };
  },

  // ── Главный рендер с вкладками ──────────────────────────────────
  render() {
    // У каждой вкладки своя зона: разделы, недоступные сотруднику, просто
    // не показываются — он не видит того, чем не может пользоваться
    const tabs = [
      { id:'home',      label:'📊 Сводка' },
      { id:'players',   label:'👥 Игроки',      zone:'players' },
      { id:'econ',      label:'🛠 Экономика',   zone:'economy' },
      { id:'events',    label:'🐉 Событие',     zone:'event' },
      { id:'tournament',label:'⚔️ Турниры',     zone:'legions' },
      { id:'legions',   label:'🎖 Легионы',     zone:'legions' },
      { id:'logs',      label:'📋 Журнал',      zone:'players' },
      { id:'support',   label:'🛟 Заявки',   zone:'support' },
      { id:'tech',      label:'🔧 Техника', zone:'security' },
      { id:'roles',     label:'🛡 Роли',        zone:'roles' },
      { id:'gold',      label:'🪙 Золото',      zone:'roles', ownerOnly:true },
    ];
    document.getElementById('content').innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px 0;position:sticky;top:0;background:var(--bg);z-index:10;border-bottom:1px solid var(--border)">
        ${tabs.filter(t=>(!t.zone||Admin.can(t.zone)) && (!t.ownerOnly||(Admin.me&&Admin.me.staffRole==='owner'))).map(t=>`<button class="btn btn-inline ${Admin.tab===t.id?'btn-orange':''}" id="tab-${t.id}">${t.label}</button>`).join('')}
        <a href="/" class="btn btn-inline" style="margin-left:auto">← В игру</a>
      </div>
      <div id="tab-content" style="padding:8px 0"></div>`;

    // Обработчики вешаем ТОЛЬКО на отрисованные вкладки. Скрытые по правам
    // кнопки в разметке отсутствуют, и обращение к ним роняло весь рендер
    // с ошибкой «Cannot set properties of null» — панель открывалась пустой.
    tabs.forEach(t => {
      const btn = document.getElementById('tab-' + t.id);
      if (btn) btn.onclick = () => { Admin.tab = t.id; Admin.renderTab(); };
    });
    Admin._tabIds = tabs.filter(t => (!t.zone || Admin.can(t.zone)) && (!t.ownerOnly || (Admin.me && Admin.me.staffRole === 'owner'))).map(t => t.id);
    // Если открыт раздел, к которому доступа нет — уводим на первый доступный
    if (Admin._tabIds.length && Admin._tabIds.indexOf(Admin.tab) === -1) {
      Admin.tab = Admin._tabIds[0];
    }
    Admin.renderTab();
  },

  renderTab() {
    // Обновить активную кнопку
    (Admin._tabIds || []).forEach(id => {
      const btn = document.getElementById('tab-'+id);
      if (btn) btn.className = `btn btn-inline ${Admin.tab===id?'btn-orange':''}`;
    });
    const c = document.getElementById('tab-content');
    if (Admin.tab === 'home')      return Admin.renderHome(c);
    if (Admin.tab === 'players')   return Admin.renderPlayers(c);
    if (Admin.tab === 'econ')      return Admin.renderEcon(c);
    if (Admin.tab === 'events')    return Admin.renderEvents(c);
    if (Admin.tab === 'tournament')return Admin.renderTournament(c);
    if (Admin.tab === 'legions')   return Admin.renderLegions(c);
    if (Admin.tab === 'mercs')     return Admin.renderMercs(c);
    if (Admin.tab === 'support')   return Admin.renderSupport(c);
    if (Admin.tab === 'tech')      return Admin.renderTech(c);
    if (Admin.tab === 'roles')     return Admin.renderRoles(c);
    if (Admin.tab === 'gold')      return Admin.renderGold(c);
    if (Admin.tab === 'logs')      return Admin.renderLogs(c);
    if (Admin.tab === 'discounts') return Admin.renderDiscounts(c);
    if (Admin.tab === 'buffs')     return Admin.renderBuffs(c);
  },

  // ── Вкладка: Игроки (поиск + карточки + выдача конкретному) ─────
  renderPlayers(c) {
    c.innerHTML = `
      <div class="card">
        <div class="field-row">
          <input type="text" id="ad-q" placeholder="Поиск по позывному…" style="flex:1">
          <button class="btn btn-orange btn-inline" id="ad-search">🔍 Найти</button>
        </div>
        <p class="muted small mt">${[
          Admin.can('economy') ? 'выдать ресурсы' : null,
          Admin.can('moderation') ? 'заблокировать' : null,
          Admin.can('security') ? 'обнулить аккаунт' : null,
        ].filter(Boolean).join(', ') ? `Найдите игрока, чтобы ${[
          Admin.can('economy') ? 'выдать ресурсы' : null,
          Admin.can('moderation') ? 'заблокировать' : null,
          Admin.can('security') ? 'обнулить аккаунт' : null,
        ].filter(Boolean).join(', ')}.` : 'Найдите игрока, чтобы посмотреть досье.'}${Admin.can('economy') ? ' Массовые операции — во вкладке «🛠 Инструменты».' : ''}</p>
      </div>
      <div id="ad-list"><div class="loading">Загрузка…</div></div>
      <div id="ad-grant-wrap"></div>`;
    document.getElementById('ad-search').onclick = () => Admin.loadPlayers();
    document.getElementById('ad-q').onkeydown = e => { if(e.key==='Enter') Admin.loadPlayers(); };
    Admin.loadPlayers();
  },

  // ── Вкладка: Техническое (удаление аккаунта, смена пароля) ──────
  // Общий поиск игрока сверху: выбранный игрок используется обеими
  // операциями. Обе — необратимые, поэтому подтверждение вводится
  // руками, а не одним кликом.
  techTarget: null,

  // ═══ СВОДКА — рабочий стол сотрудника ════════════════════════════
  // Панель владельца — про настройку игры. Панель администратора — про
  // ежедневную работу с людьми, поэтому открывается она сводкой: что
  // требует внимания сейчас, кто под мерами, что я сам делал сегодня.
  async renderHome(c) {
    c.innerHTML = '<div class="loading">Собираю сводку…</div>';
    let d = null;
    try { d = await API.get('/api/admin/dashboard'); }
    catch (e) { c.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

    const has = (z) => (d.zones || []).indexOf(z) >= 0;
    const ago = (ms) => {
      if (!ms) return '—';
      const m = Math.round((Date.now() - ms) / 60000);
      if (m < 60) return `${m} мин назад`;
      const h = Math.round(m / 60);
      return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
    };
    const left = (until) => {
      if (!until) return 'бессрочно';
      const m = Math.max(0, Math.round((until - Date.now()) / 60000));
      return m < 60 ? `${m} мин` : (m < 1440 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${Math.floor(m / 1440)} дн`);
    };

    // Что требует внимания — только по доступным разделам
    const alerts = [];
    if (has('support') && d.tickets.open) {
      alerts.push({ kind: d.tickets.oldest >= 24 ? 'hot' : 'warn', icon: '🛟',
        text: `Открытых обращений: <b>${d.tickets.open}</b>` +
              (d.tickets.oldest ? ` · самое старое ждёт <b>${d.tickets.oldest} ч</b>` : ''),
        tab: 'support', btn: 'Разобрать' });
    }
    if (has('moderation') && d.accountBansTotal) {
      alerts.push({ kind: 'info', icon: '🚫',
        text: `Заблокированных аккаунтов: <b>${d.accountBansTotal}</b>`, tab: 'players', btn: 'К игрокам' });
    }
    if (has('moderation') && d.chatBansTotal) {
      alerts.push({ kind: 'info', icon: '🔇',
        text: `Действующих блокировок чата: <b>${d.chatBansTotal}</b>`, tab: null });
    }

    c.innerHTML = `
      <div class="adm-hello">
        <div>
          <div class="adm-hello-name">${UI.esc(d.me.name)}</div>
          <div class="muted small">${UI.esc(d.me.label || '')} · доступно разделов: ${(d.zones || []).length}</div>
        </div>
        <div class="adm-hello-stats">
          <div><b>${UI.fmtNum(d.players.online)}</b><span>в игре</span></div>
          <div><b>${UI.fmtNum(d.players.newToday)}</b><span>новых за сутки</span></div>
          <div><b>${UI.fmtNum(d.players.total)}</b><span>всего</span></div>
        </div>
      </div>

      ${alerts.length ? `
        <div class="card">
          <div class="name">Требует внимания</div>
          ${alerts.map((a, i) => `
            <div class="adm-alert adm-alert-${a.kind}">
              <span class="adm-alert-icon">${a.icon}</span>
              <span class="grow">${a.text}</span>
              ${a.tab ? `<button class="btn btn-inline" data-goto-tab="${a.tab}">${a.btn}</button>` : ''}
            </div>`).join('')}
        </div>
      ` : `<div class="card center"><p class="muted">✅ Ничего срочного. Спокойная смена.</p></div>`}

      <div class="card">
        <div class="name">🔎 Найти игрока</div>
        <p class="muted small mt">Позывной, часть имени или ID — откроется карточка со всеми мерами и действиями.</p>
        <div class="field-row mt">
          <input type="text" id="adm-q" class="field" placeholder="Позывной игрока…" style="flex:1">
          <button class="btn btn-orange btn-inline" id="adm-find">Найти</button>
        </div>
        <div id="adm-found" class="mt"></div>
      </div>

      ${has('moderation') && (d.accountBans.length || d.chatBans.length) ? `
        <div class="card">
          <div class="name">Действующие меры</div>
          ${d.accountBans.map((b) => `
            <div class="adm-measure">
              <span class="adm-measure-tag adm-tag-ban">бан</span>
              <a href="#" class="grow adm-link" data-card="${b.id}">${UI.esc(b.name)}</a>
              <span class="muted small">${UI.esc(b.reason)}</span>
              <span class="adm-measure-left">${left(b.until)}</span>
            </div>`).join('')}
          ${d.chatBans.map((b) => `
            <div class="adm-measure">
              <span class="adm-measure-tag adm-tag-mute">чат</span>
              <a href="#" class="grow adm-link" data-card="${b.id}">${UI.esc(b.name)}</a>
              <span class="muted small">${UI.esc(b.scopeNames || '')}</span>
              <span class="adm-measure-left">${left(b.until)}</span>
            </div>`).join('')}
        </div>` : ''}

      <div class="card">
        <div class="name">📋 Мои действия за сутки</div>
        <p class="muted small mt">Все действия сотрудников записываются. Это ваш собственный журнал.</p>
        <div class="mt">
          ${(d.myActions || []).length
            ? d.myActions.map((a) => `
                <div class="adm-act">
                  <span class="muted small">${ago(a.at)}</span>
                  <span class="grow">${UI.esc(a.human || a.path || '—')}</span>
                </div>`).join('')
            : '<p class="muted small">Пока ничего не делали.</p>'}
        </div>
      </div>`;

    c.querySelectorAll('[data-goto-tab]').forEach((b) => {
      b.onclick = () => { Admin.tab = b.dataset.gotoTab; Admin.renderTab(); };
    });
    c.querySelectorAll('[data-card]').forEach((a) => {
      a.onclick = (ev) => { ev.preventDefault(); Admin.showPlayerCard(a.dataset.card); };
    });
    const find = async () => {
      const q = (document.getElementById('adm-q') || {}).value || '';
      const box = document.getElementById('adm-found');
      if (q.trim().length < 2) { box.innerHTML = '<p class="muted small">Введите хотя бы 2 символа</p>'; return; }
      box.innerHTML = '<div class="loading">Ищу…</div>';
      try {
        const r = await API.get('/api/mod/find?q=' + encodeURIComponent(q.trim()));
        box.innerHTML = (r.players || []).length
          ? r.players.map((p) => `
              <div class="adm-measure">
                <a href="#" class="grow adm-link" data-card="${p.id}">${UI.esc(p.name)}</a>
                <span class="muted small">ур. ${p.level}</span>
                ${p.banned ? '<span class="adm-measure-tag adm-tag-mute">чат</span>' : ''}
                ${p.role ? `<span class="adm-measure-tag">${UI.esc(p.label)}</span>` : ''}
              </div>`).join('')
          : '<p class="muted small">Никого не найдено</p>';
        box.querySelectorAll('[data-card]').forEach((a) => {
          a.onclick = (ev) => { ev.preventDefault(); Admin.showPlayerCard(a.dataset.card); };
        });
      } catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; }
    };
    const fb = document.getElementById('adm-find');
    if (fb) fb.onclick = find;
    const qi = document.getElementById('adm-q');
    if (qi) qi.onkeydown = (ev) => { if (ev.key === 'Enter') find(); };
  },

  // Окна блокировки внутри панели. В админке не подключён app.js, поэтому
  // окна из игры здесь недоступны — реализуем их отдельно и компактнее.
  async banChatDialog(userId, userName, active) {
    if (active) {
      if (!await UI.confirm(`Снять блокировку чата с игрока <b>${UI.esc(userName)}</b>?`,
          { title: 'Снятие блокировки', icon: '🔊', html: true, okText: 'Снять' })) return false;
      try { await API.post('/api/mod/chat-unban', { userId }); UI.toast('🔊 Снято'); return true; }
      catch (e) { UI.toast('⛔ ' + e.message); return false; }
    }
    Admin._banMin = 60; Admin._banScopes = ['global']; Admin._banReason = 'Нарушение правил';
    const durs = [[15,'15 мин'],[60,'1 час'],[180,'3 часа'],[720,'12 часов'],[1440,'1 сутки'],[4320,'3 суток'],[10080,'7 суток'],[43200,'30 суток']];
    const scopes = [['global','Общий чат'],['legion','Чат легиона'],['mail','Личные']];
    const dlg = UI.confirm(`
      <div class="ban-dialog">
        <div class="ban-target">Игрок: <b>${UI.esc(userName)}</b></div>
        <div class="ban-label">Срок</div>
        <div class="ban-grid">${durs.map(([m,t]) => `<button class="ban-opt${m===60?' active':''}" data-min="${m}">${t}</button>`).join('')}</div>
        <div class="ban-label">Что закрыть</div>
        <div class="ban-grid">${scopes.map(([id,t]) => `<button class="ban-opt ban-scope${id==='global'?' active':''}" data-scope="${id}">${t}</button>`).join('')}
          <button class="ban-opt ban-scope-all" data-scope-all="1">Всё сразу</button></div>
        <label class="ban-purge"><input type="checkbox" id="adm-purge">
          <span>Удалить сообщения в общем чате</span></label>
        <div class="ban-label">Причина</div>
        <input type="text" id="adm-breason" class="field" maxlength="200" value="Нарушение правил">
      </div>`,
      { title: 'Блокировка чата', icon: '🔇', html: true, okText: 'Заблокировать', cancelText: 'Отмена', danger: true });
    requestAnimationFrame(() => Admin._wireBanDialog());
    if (!await dlg) return false;
    try {
      await API.post('/api/mod/chat-ban', {
        userId, minutes: Admin._banMin, reason: Admin._banReason,
        scopes: Admin._banScopes.length ? Admin._banScopes : ['global'],
        purge: !!Admin._banPurge,
      });
      UI.toast('🔇 Блокировка выдана');
      return true;
    } catch (e) { UI.toast('⛔ ' + e.message); return false; }
  },

  async banAccountDialog(userId, userName, active) {
    if (active) {
      if (!await UI.confirm(`Разблокировать аккаунт <b>${UI.esc(userName)}</b>?`,
          { title: 'Разблокировка', icon: '✅', html: true, okText: 'Разблокировать' })) return false;
      try { await API.post('/api/admin/account-unban', { userId }); UI.toast('✅ Разблокирован'); return true; }
      catch (e) { UI.toast('⛔ ' + e.message); return false; }
    }
    Admin._accMin = 1440; Admin._accReason = 'Нарушение правил';
    const durs = [[15,'15 мин'],[60,'1 час'],[1440,'1 сутки'],[4320,'3 суток'],[10080,'7 суток'],[43200,'30 суток'],[0,'Бессрочно']];
    const dlg2 = UI.confirm(`
      <div class="ban-dialog">
        <div class="ban-target">Игрок: <b>${UI.esc(userName)}</b></div>
        <p class="muted small">Игрок не сможет войти. Он увидит окно с причиной и сроком.</p>
        <div class="ban-label">Срок</div>
        <div class="ban-grid">${durs.map(([m,t]) => `<button class="ban-opt${m===1440?' active':''}" data-accmin="${m}">${t}</button>`).join('')}</div>
        <div class="ban-label">Причина (увидит игрок)</div>
        <input type="text" id="adm-areason" class="field" maxlength="200" value="Нарушение правил">
      </div>`,
      { title: 'Блокировка аккаунта', icon: '🚫', html: true, okText: 'Заблокировать', cancelText: 'Отмена', danger: true });
    requestAnimationFrame(() => Admin._wireBanDialog());
    if (!await dlg2) return false;
    try {
      await API.post('/api/admin/account-ban', { userId, minutes: Admin._accMin, reason: Admin._accReason });
      UI.toast('🚫 Аккаунт заблокирован');
      return true;
    } catch (e) { UI.toast('⛔ ' + e.message); return false; }
  },

  // Обработчики кнопок внутри окон блокировки. Вызываются после появления
  // окна: разметка исчезает вместе с ним, поэтому выбор храним в Admin.
  _wireBanDialog() {
    const root = document.querySelector('.ban-dialog');
    if (!root) return;
    root.querySelectorAll('[data-min]').forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll('[data-min]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); Admin._banMin = Number(b.dataset.min);
      };
    });
    root.querySelectorAll('[data-accmin]').forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll('[data-accmin]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); Admin._accMin = Number(b.dataset.accmin);
      };
    });
    const sync = () => { Admin._banScopes = [...root.querySelectorAll('.ban-scope.active')].map((x) => x.dataset.scope); };
    root.querySelectorAll('.ban-scope').forEach((b) => { b.onclick = () => { b.classList.toggle('active'); sync(); }; });
    const all = root.querySelector('[data-scope-all]');
    if (all) all.onclick = () => { root.querySelectorAll('.ban-scope').forEach((x) => x.classList.add('active')); sync(); };
    const purge = root.querySelector('#adm-purge');
    Admin._banPurge = false;
    if (purge) purge.onchange = () => { Admin._banPurge = purge.checked; };
    const br = root.querySelector('#adm-breason');
    if (br) br.oninput = () => { Admin._banReason = br.value; };
    const ar = root.querySelector('#adm-areason');
    if (ar) ar.oninput = () => { Admin._accReason = ar.value; };
  },

  // Карточка игрока: всё о человеке и все доступные меры в одном окне —
  // чтобы не прыгать между вкладками ради одного бана
  async showPlayerCard(id) {
    let p = null;
    try { p = await API.get('/api/admin/player-card/' + encodeURIComponent(id)); }
    catch (e) { return UI.toast('⛔ ' + e.message); }

    const dt = (ms) => ms ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const left = (until) => {
      if (!until) return 'бессрочно';
      const m = Math.max(0, Math.round((until - Date.now()) / 60000));
      return m < 60 ? `${m} мин` : (m < 1440 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${Math.floor(m / 1440)} дн`);
    };

    const body = `
      <div class="adm-card">
        <div class="adm-card-head">
          <b>${UI.esc(p.name)}</b>
          ${p.roleLabel ? `<span class="badge">${UI.esc(p.roleLabel)}</span>` : ''}
          <span class="muted small">${p.online ? '● в игре' : 'не в сети · ' + dt(p.lastSeen)}</span>
        </div>
        <div class="adm-card-rows">
          <div><span>Уровень</span><b>${p.level}</b></div>
          <div><span>В игре с</span><b>${dt(p.createdAt)}</b></div>
          ${p.can.resources ? `<div><span>Баланс</span><b>$${UI.fmtNum(p.dollars)} · 🪙 ${UI.fmtNum(p.gold)}</b></div>` : ''}
          <div><span>ID</span><b class="muted small">${UI.esc(p.id)}</b></div>
        </div>

        ${p.accountBan ? `
          <div class="adm-card-warn">🚫 Аккаунт заблокирован · ${left(p.accountBan.until)}<br>
            <span class="muted small">${UI.esc(p.accountBan.reason)}${p.accountBan.byName ? ' · ' + UI.esc(p.accountBan.byName) : ''}</span></div>` : ''}
        ${p.chatBan ? `
          <div class="adm-card-warn">🔇 Чат закрыт · ${left(p.chatBan.until)}<br>
            <span class="muted small">${UI.esc(p.chatBan.reason)}${p.chatBan.byName ? ' · ' + UI.esc(p.chatBan.byName) : ''}</span></div>` : ''}

        <div class="adm-card-acts">
          ${p.can.chatBan ? `<button class="btn btn-inline" data-act="chat">${p.chatBan ? '🔊 Снять блокировку чата' : '🔇 Заблокировать чат'}</button>` : ''}
          ${p.can.accountBan ? `<button class="btn btn-inline" data-act="acc">${p.accountBan ? '✅ Разблокировать аккаунт' : '🚫 Заблокировать аккаунт'}</button>` : ''}
          <button class="btn btn-inline" data-act="access">🔎 Входы и устройства</button>
          <button class="btn btn-inline" data-act="profile">👤 Открыть профиль в игре</button>
        </div>

        ${(p.recent || []).length ? `
          <div class="adm-card-log">
            <div class="muted small">Последние действия игрока</div>
            ${p.recent.slice(0, 8).map((l) => `<div class="adm-act"><span class="muted small">${dt(l.at)}</span><span class="grow">${UI.esc(l.human || l.path || '')}</span></div>`).join('')}
          </div>` : ''}
      </div>`;

    // ВАЖНО: не ждём закрытия окна перед навешиванием обработчиков.
    // С `await` они вешались уже на удалённую разметку — кнопки внутри
    // карточки просто не нажимались.
    const dlg = UI.confirm(body, { title: 'Карточка игрока', icon: '👤', html: true, okText: 'Закрыть', cancelText: '' });
    requestAnimationFrame(() => {
      const root = document.querySelector('.adm-card');
      if (!root) return;
      root.querySelectorAll('[data-act]').forEach((b) => {
        b.onclick = async () => {
          const act = b.dataset.act;
          if (act === 'profile') { window.open('/#profile/' + p.id, '_blank'); return; }
          if (act === 'access') { Admin.showAccess(p.id); return; }
          if (act === 'chat') await Admin.banChatDialog(p.id, p.name, !!p.chatBan);
          if (act === 'acc') await Admin.banAccountDialog(p.id, p.name, !!p.accountBan);
          setTimeout(() => Admin.renderTab(), 300);
        };
      });
    });
    await dlg;
  },

  // ═══ ВХОДЫ И УСТРОЙСТВА ══════════════════════════════════════════
  // Адрес, устройство и почта нужны, чтобы разбирать жалобы «меня
  // взломали» и видеть, кто ещё заходит с того же адреса.
  async showAccess(userId) {
    let d = null;
    try { d = await API.get('/api/admin/access/' + encodeURIComponent(userId)); }
    catch (e) { return UI.toast('⛔ ' + e.message); }

    const dt = (ms) => ms ? new Date(ms).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';

    await UI.confirm(`
      <div class="access-box">
        <div class="access-sec">
          <div class="access-title">📧 Почта</div>
          <div class="access-mail">
            ${UI.esc(d.email || '— не указана')}
            ${d.emailVerified
              ? '<span class="badge" style="background:rgba(90,150,70,.2);color:#a8d18f">подтверждена</span>'
              : '<span class="badge" style="background:rgba(200,120,40,.2);color:var(--orange-1)">не подтверждена</span>'}
          </div>
        </div>

        <div class="access-sec">
          <div class="access-title">📝 При регистрации</div>
          <table class="access-table">
            <tr><td>Когда</td><td class="num">${dt(d.registered.at)}</td></tr>
            <tr><td>Адрес</td><td class="num mono">${UI.esc(d.registered.ip)}</td></tr>
            <tr><td>Устройство</td><td class="num">${UI.esc(d.registered.device)}</td></tr>
          </table>
        </div>

        <div class="access-sec">
          <div class="access-title">🕘 Последний вход</div>
          <table class="access-table">
            <tr><td>Когда</td><td class="num">${dt(d.last.at)}</td></tr>
            <tr><td>Адрес</td><td class="num mono">${UI.esc(d.last.ip)}</td></tr>
            <tr><td>Устройство</td><td class="num">${UI.esc(d.last.device)}</td></tr>
          </table>
        </div>

        <div class="access-sec">
          <div class="access-title">🌐 Адреса (${(d.ips || []).length})</div>
          ${(d.ips || []).length ? `
            <table class="access-table">
              <thead><tr><th>Адрес</th><th class="num">Входов</th><th class="num">Последний</th></tr></thead>
              <tbody>
                ${d.ips.map((x) => `
                  <tr><td class="mono">${UI.esc(x.ip)}</td>
                      <td class="num">${x.count}</td>
                      <td class="num small muted">${dt(x.lastAt)}</td></tr>`).join('')}
              </tbody>
            </table>` : '<p class="muted small">Данных пока нет — они появятся при следующем входе.</p>'}
        </div>

        <div class="access-sec">
          <div class="access-title">📜 История входов</div>
          ${(d.logins || []).length ? `
            <table class="access-table">
              <tbody>
                ${d.logins.map((l) => `
                  <tr><td class="small muted nowrap">${dt(l.at)}</td>
                      <td class="mono small">${UI.esc(l.ip)}</td>
                      <td class="small">${UI.esc(l.device)}</td></tr>`).join('')}
              </tbody>
            </table>` : '<p class="muted small">Пока нет записей.</p>'}
        </div>

        ${(d.related || []).length ? `
          <div class="access-sec">
            <div class="access-title">👥 Заходят с тех же адресов (${d.related.length})</div>
            <p class="muted small">Совпадение адреса — не доказательство: за одним роутером сидит
            семья, а мобильные операторы выдают общий адрес сотням абонентов.</p>
            <table class="access-table">
              <tbody>
                ${d.related.map((r) => `
                  <tr>
                    <td><b>${UI.esc(r.name)}</b> <span class="muted small">ур. ${r.level}</span></td>
                    <td class="small muted">${UI.esc(r.email || '—')}</td>
                    <td class="num small">${r.sharedIps.length} общ.</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
      </div>`,
      { title: `Входы: ${d.name}`, icon: '🔎', html: true, okText: 'Закрыть', cancelText: '' });
  },

  // ═══ РОЛИ: выдача прав без остановки сервера ═════════════════════
  // Через панель роль меняется в памяти работающего сервера и сразу
  // сохраняется — в отличие от скрипта на сервере, правку которого
  // затирает сохранение памяти при перезапуске.
  async renderRoles(c) {
    c.innerHTML = '<div class="loading">Загружаю сотрудников…</div>';
    let data = null;
    try { data = await API.get('/api/staff'); } catch (e) {
      c.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`;
      return;
    }
    const iAmOwner = data.me && data.me.role === 'owner';
    const label = { owner: 'Владелец', arbiter: 'Арбитр', admin: 'Администратор',
                    commissar: 'Комиссар', moderator: 'Дозор' };
    // Кого может назначать текущий сотрудник — совпадает с проверкой на сервере
    const myRole = (data.me && data.me.role) || '';
    const CAN = { owner: ['arbiter','admin','commissar','moderator'], arbiter: ['admin','commissar','moderator'],
                  admin: ['moderator'], commissar: ['moderator'] };
    const canAssign = CAN[myRole] || [];

    c.innerHTML = `
      <div class="card">
        <div class="name">🛡 Сотрудники проекта</div>
        <p class="muted small mt">Ваша роль: <b>${UI.esc((data.me && data.me.label) || '—')}</b>.
        ${iAmOwner
          ? 'Вы можете назначать любые роли.'
          : `Вы можете назначать: ${canAssign.map((r) => label[r]).join(', ') || '—'}.`}</p>
        <div class="mt">
          ${(data.staff || []).map((s) => `
            <div class="list-row">
              <div class="grow">
                <b>${UI.esc(s.name)}</b>
                <span class="badge">${UI.esc(label[s.role] || s.role)}</span>
                <span class="muted small">ур. ${s.level}</span>
              </div>
              ${(s.role !== 'owner' && iAmOwner)
                ? `<button class="btn btn-inline" data-staff-log="${s.id}" data-name="${UI.esc(s.name)}" title="Журнал действий">📋</button>
                   <button class="btn btn-inline" data-staff-ban="${s.id}" data-name="${UI.esc(s.name)}" title="Заблокировать аккаунт">🚫</button>`
                : ''}
              ${(s.role !== 'owner' && (iAmOwner || s.role === 'moderator'))
                ? `<button class="btn btn-red btn-inline" data-role-off="${s.id}" data-name="${UI.esc(s.name)}">снять роль</button>`
                : ''}
            </div>`).join('') || '<p class="muted small">Пока только вы.</p>'}
        </div>
      </div>

      ${iAmOwner ? `
      <div class="card">
        <div class="name">📜 Журнал действий сотрудников</div>
        <p class="muted small mt">Все действия администраторов и модераторов. Это единственная проверка того,
        как используются выданные права — сотрудники чужой журнал не видят.</p>
        <div class="field-row mt">
          <select id="staff-log-who" class="field" style="flex:1">
            <option value="">Все сотрудники</option>
            ${(data.staff || []).map((s) => `<option value="${s.id}">${UI.esc(s.name)} — ${UI.esc(s.label)}</option>`).join('')}
          </select>
          <button class="btn btn-inline" id="staff-log-go">Показать</button>
        </div>
        <div id="staff-log-box" class="mt"></div>
      </div>` : ''}

      ${iAmOwner ? `
      <div class="card">
        <div class="name">⚙️ Возможности ролей</div>
        <p class="muted small mt">Отметьте, что доступно каждой роли. <b>Новые роли не имеют прав вообще</b> —
        всё выдаёте вы. Изменения действуют сразу. У владельца всегда полный доступ: это не настраивается,
        иначе можно было бы случайно закрыть себе выход.</p>
        <div id="perm-box" class="mt"><div class="loading">Загружаю…</div></div>
      </div>` : ''}

      <div class="card">
        <div class="name">➕ Назначить роль</div>
        <p class="muted small mt">Найдите игрока по позывному и выберите роль.
        Изменение вступает в силу сразу — игроку нужно лишь обновить страницу.</p>
        <div class="field-row mt">
          <input type="text" id="role-q" class="field" placeholder="Позывной игрока…" style="flex:1">
          <button class="btn btn-orange btn-inline" id="role-find">🔍 Найти</button>
        </div>
        <div id="role-results" class="mt"></div>
      </div>`;

    // Снятие роли
    c.querySelectorAll('[data-role-off]').forEach((b) => {
      b.onclick = async () => {
        if (!await UI.confirm(`Снять все роли с игрока <b>${UI.esc(b.dataset.name)}</b>?`,
            { title: 'Снятие роли', icon: '🛡', okText: 'Снять', danger: true, html: true })) return;
        try {
          await API.post('/api/staff/role', { userId: b.dataset.roleOff, role: 'none' });
          UI.toast('✅ Роль снята');
          Admin.renderRoles(c);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });

    // ── Журнал действий сотрудников (только владелец) ──
    const showStaffLog = async (userId, name) => {
      const box = document.getElementById('staff-log-box');
      if (!box) return;
      box.innerHTML = '<div class="loading">Загружаю…</div>';
      try {
        const r = await API.get('/api/admin/staff-log' + (userId ? '?userId=' + encodeURIComponent(userId) : ''));
        box.innerHTML = (r.logs || []).length
          ? `<div class="muted small">${name ? 'Действия: ' + UI.esc(name) : 'Все сотрудники'} · записей: ${r.logs.length}</div>` +
            r.logs.map((l) => `
              <div class="adm-act">
                <span class="muted small">${new Date(l.at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                <b class="adm-log-who">${UI.esc(l.userName || '')}</b>
                <span class="grow">${UI.esc(l.human || l.path || '')}</span>
              </div>`).join('')
          : '<p class="muted small">Записей нет.</p>';
      } catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; }
    };
    const logGo = document.getElementById('staff-log-go');
    if (logGo) logGo.onclick = () => {
      const sel = document.getElementById('staff-log-who');
      const opt = sel.options[sel.selectedIndex];
      showStaffLog(sel.value, sel.value ? opt.textContent : '');
    };
    if (iAmOwner) showStaffLog('', '');

    c.querySelectorAll('[data-staff-log]').forEach((b) => {
      b.onclick = () => {
        const sel = document.getElementById('staff-log-who');
        if (sel) sel.value = b.dataset.staffLog;
        showStaffLog(b.dataset.staffLog, b.dataset.name);
        const box = document.getElementById('staff-log-box');
        if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    c.querySelectorAll('[data-staff-ban]').forEach((b) => {
      b.onclick = async () => {
        // Сотрудника банит только владелец — проверка и на сервере
        if (await Admin.banAccountDialog(b.dataset.staffBan, b.dataset.name, false)) {
          Admin.renderRoles(c);
        }
      };
    });

    // ── Настройка возможностей ролей ──
    const renderPerms = async () => {
      const box = document.getElementById('perm-box');
      if (!box) return;
      let p = null;
      try { p = await API.get('/api/staff/permissions'); }
      catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; return; }

      box.innerHTML = (p.roles || []).map((r) => `
        <div class="perm-role">
          <div class="perm-role-head">
            <b>${UI.esc(r.name)}</b>
            ${r.custom ? '<span class="badge">изменено</span>' : '<span class="muted small">по умолчанию</span>'}
            <span class="muted small">— доступно разделов: ${r.zones.length}</span>
            ${r.custom ? `<button class="btn btn-inline" data-perm-reset="${r.id}">↩ сбросить</button>` : ''}
          </div>
          <div class="perm-grid">
            ${(p.zones || []).map((z) => {
              const on = r.zones.indexOf(z.id) >= 0;
              return `<label class="perm-item${on ? ' on' : ''}" title="${UI.esc(z.note)}">
                        <input type="checkbox" data-perm-role="${r.id}" data-perm-zone="${z.id}" ${on ? 'checked' : ''}>
                        <span>${UI.esc(z.name)}</span>
                      </label>`;
            }).join('')}
          </div>
        </div>`).join('');

      // Зоны, дающие власть над людьми и деньгами: включаем с
      // подтверждением, чтобы случайная галочка не выдала лишнего
      const DANGEROUS = {
        moderation: 'блокировать вход в игру и удалять аккаунты',
        security: 'менять чужие пароли и обнулять прогресс',
        economy: 'выдавать и списывать деньги, золото и награды',
        discounts: 'менять акции и глобальные бонусы',
        roles: 'назначать и снимать роли другим сотрудникам',
        season: 'менять награды сезона и завершать неделю',
      };
      box.querySelectorAll('[data-perm-zone]').forEach((cb) => {
        cb.onchange = async () => {
          const role = cb.dataset.permRole, zone = cb.dataset.permZone, enabled = cb.checked;
          if (enabled && DANGEROUS[zone]) {
            const roleName = (p.roles.find((x) => x.id === role) || {}).name || role;
            const okd = await UI.confirm(
              `Открыть роли <b>${UI.esc(roleName)}</b> раздел, позволяющий <b>${UI.esc(DANGEROUS[zone])}</b>?` +
              `<br><span class="muted small">Это серьёзные полномочия. Выдавайте их только тем, кому доверяете.</span>`,
              { title: 'Расширение полномочий', icon: '⚠️', html: true, okText: 'Открыть', danger: true });
            if (!okd) { cb.checked = false; return; }
          }
          cb.disabled = true;
          try {
            await API.post('/api/staff/permissions', { role, zone, enabled });
            UI.toast(enabled ? '✅ Раздел открыт' : '⛔ Раздел закрыт');
            await renderPerms();
          } catch (e) {
            cb.checked = !enabled;          // возвращаем как было
            UI.toast('⛔ ' + e.message);
          } finally { cb.disabled = false; }
        };
      });
      box.querySelectorAll('[data-perm-reset]').forEach((b) => {
        b.onclick = async () => {
          if (!await UI.confirm('Вернуть исходные возможности этой роли?',
              { title: 'Сброс настроек', icon: '↩', okText: 'Сбросить' })) return;
          try {
            await API.post('/api/staff/permissions/reset', { role: b.dataset.permReset });
            UI.toast('↩️ Сброшено');
            await renderPerms();
          } catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });
    };
    if (iAmOwner) renderPerms();

    // Поиск и назначение
    const doFind = async () => {
      const q = (document.getElementById('role-q') || {}).value || '';
      const box = document.getElementById('role-results');
      if (q.trim().length < 2) { box.innerHTML = '<p class="muted small">Введите хотя бы 2 символа</p>'; return; }
      box.innerHTML = '<div class="loading">Ищу…</div>';
      try {
        const r = await API.get('/api/mod/find?q=' + encodeURIComponent(q.trim()));
        box.innerHTML = (r.players || []).length
          ? (r.players || []).map((p) => `
              <div class="list-row">
                <div class="grow"><b>${UI.esc(p.name)}</b> <span class="muted small">ур. ${p.level}</span>
                  ${p.role ? `<span class="badge">${UI.esc(label[p.role] || p.role)}</span>` : ''}</div>
                ${canAssign.map((r) => `<button class="btn btn-inline" data-set="${p.id}" data-r="${r}" data-name="${UI.esc(p.name)}">${UI.esc(label[r])}</button>`).join('')}
                ${myRole === 'owner' ? `<button class="btn btn-inline" data-set="${p.id}" data-r="owner" data-name="${UI.esc(p.name)}">Владелец</button>` : ''}
              </div>`).join('')
          : '<p class="muted small">Никого не найдено</p>';
        box.querySelectorAll('[data-set]').forEach((b) => {
          b.onclick = async () => {
            const rn = label[b.dataset.r] || b.dataset.r;
            if (!await UI.confirm(
              `Назначить игроку <b>${UI.esc(b.dataset.name)}</b> роль <b>${UI.esc(rn)}</b>?` +
              (b.dataset.r === 'owner' ? '<br><span class="muted small">Владелец получает полный доступ, включая выдачу ресурсов и управление базой.</span>' : ''),
              { title: 'Назначение роли', icon: '🛡', okText: 'Назначить', html: true, danger: b.dataset.r === 'owner' })) return;
            try {
              await API.post('/api/staff/role', { userId: b.dataset.set, role: b.dataset.r });
              UI.toast('✅ Роль назначена');
              Admin.renderRoles(c);
            } catch (e) { UI.toast('⛔ ' + e.message); }
          };
        });
      } catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; }
    };
    const fb = document.getElementById('role-find');
    if (fb) fb.onclick = doFind;
    const qi = document.getElementById('role-q');
    if (qi) qi.onkeydown = (ev) => { if (ev.key === 'Enter') doFind(); };
  },

  // ═══ ЖУРНАЛ НАЧИСЛЕНИЙ ЗОЛОТА (только владелец) ══════════════════
  // Золото — премиум-валюта, и владелец должен видеть каждый источник:
  // поручения, контракты, сезон, выдачу администрацией. Это единственный
  // способ заметить, что кто-то раздаёт золото сверх меры.
  _goldSrc: 'all',

  // ═══ ЖУРНАЛ ЗОЛОТА: выбор игрока и его история ═══════════════════
  // Раньше показывался общий поток с сырыми адресами запросов
  // («/api/lots/buy») — по нему нельзя было понять ни кто, ни за что.
  // Теперь: список игроков с движением золота, а по нажатию — история
  // конкретного человека понятными строками.
  _goldPlayer: null,

  async renderGold(c) {
    c.innerHTML = '<div class="loading">Собираю журнал…</div>';
    let d = null;
    const q = Admin._goldPlayer ? '?userId=' + encodeURIComponent(Admin._goldPlayer) : '';
    try { d = await API.get('/api/admin/gold-log' + q); }
    catch (e) { c.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

    const dt = (ms) => new Date(ms).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const g = (n) => `<span class="ic-gold"></span> ${UI.fmtNum(n)}`;
    const sel = d.selected;

    // ── Список игроков таблицей ──
    if (!sel) {
      c.innerHTML = `
        <div class="card">
          <div class="name">🪙 Начисления золота</div>
          <p class="muted small mt">Раздел виден только вам. Нажмите на игрока, чтобы увидеть,
          откуда у него золото и на что он его тратил.</p>
          ${d.totals ? `
            <div class="gold-totals mt">
              <div><span class="muted small">получено всего</span><b class="gold">${g(d.totals.got)}</b></div>
              <div><span class="muted small">потрачено всего</span><b>${g(d.totals.spent)}</b></div>
              <div><span class="muted small">на счетах сейчас</span><b class="gold">${g(d.totals.now)}</b></div>
            </div>` : ''}
        </div>

        <div class="card">
          <div class="name">Игроки (${UI.fmtNum((d.players || []).length)})</div>
          <div class="table-wrap mt">
            <table class="gold-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th class="num">Получено</th>
                  <th class="num">Потрачено</th>
                  <th class="num">На счету</th>
                </tr>
              </thead>
              <tbody>
                ${(d.players || []).map((p) => `
                  <tr data-gp="${p.id}">
                    <td>
                      <b>${UI.esc(p.name)}</b>${p.vip ? ' <span class="vip-mark">VIP</span>' : ''}
                      <span class="muted small">ур. ${p.level}</span>
                    </td>
                    <td class="num gold">+${UI.fmtNum(p.got)}</td>
                    <td class="num muted">−${UI.fmtNum(p.spent)}</td>
                    <td class="num"><b>${UI.fmtNum(p.now)}</b></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      c.querySelectorAll('[data-gp]').forEach((row) => {
        row.onclick = () => { Admin._goldPlayer = row.dataset.gp; Admin.renderGold(c); };
      });
      return;
    }

    // ── Карточка игрока: получено / потрачено / на счету ──
    c.innerHTML = `
      <div class="card">
        <div class="gold-sel-head">
          <button class="btn btn-inline" id="gold-back">← Ко всем игрокам</button>
          <b>${UI.esc(sel.name)}</b> <span class="muted small">ур. ${sel.level}</span>
        </div>
        <div class="gold-totals mt">
          <div><span class="muted small">получено</span><b class="gold">${g(sel.got)}</b></div>
          <div><span class="muted small">потрачено</span><b>${g(sel.spent)}</b></div>
          <div><span class="muted small">на счету</span><b class="gold">${g(sel.now)}</b></div>
        </div>
      </div>

      <div class="card">
        <div class="name">📥 Получено</div>
        <div class="table-wrap mt">
          <table class="gold-table">
            <thead><tr><th>Источник</th><th class="num">Золото</th></tr></thead>
            <tbody>
              ${(sel.groups || []).filter((gr) => gr.total > 0).map((gr) => `
                <tr class="gold-group">
                  <td><b>${UI.esc(gr.label)}</b></td>
                  <td class="num gold"><b>${UI.fmtNum(gr.total)}</b></td>
                </tr>
                ${gr.items.map((it) => `
                  <tr class="gold-sub">
                    <td>${UI.esc(it.label)}</td>
                    <td class="num">${UI.fmtNum(it.value)}</td>
                  </tr>
                  ${(it.details || []).map((dd) => `
                    <tr class="gold-detail">
                      <td>· ${UI.esc(dd.label)}</td>
                      <td class="num muted">${UI.fmtNum(dd.value)}</td>
                    </tr>`).join('')}
                `).join('')}
              `).join('') || '<tr><td colspan="2" class="muted">Поступлений нет</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="name">📤 Потрачено</div>
        <div class="table-wrap mt">
          <table class="gold-table">
            <thead><tr><th>На что</th><th class="num">Золото</th></tr></thead>
            <tbody>
              ${(sel.spending || []).length
                ? sel.spending.map((sp) => `
                    <tr class="gold-group">
                      <td><b>${UI.esc(sp.label)}</b></td>
                      <td class="num"><b>${UI.fmtNum(sp.value)}</b></td>
                    </tr>
                    ${(sp.details || []).map((dd) => `
                      <tr class="gold-detail">
                        <td>· ${UI.esc(dd.label)}</td>
                        <td class="num muted">${UI.fmtNum(dd.value)}</td>
                      </tr>`).join('')}
                  `).join('')
                : '<tr><td colspan="2" class="muted">Трат нет</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="name">🕒 История операций (${UI.fmtNum((d.rows || []).length)})</div>
        <div class="table-wrap mt">
          <table class="gold-table">
            <thead><tr><th>Когда</th><th>Что произошло</th><th class="num">Золото</th></tr></thead>
            <tbody>
              ${(d.rows || []).length
                ? d.rows.map((r) => `
                    <tr>
                      <td class="muted small nowrap">${dt(r.at)}</td>
                      <td>${UI.esc(r.text)}</td>
                      <td class="num gold nowrap">${UI.fmtNum(r.gold)}</td>
                    </tr>`).join('')
                : '<tr><td colspan="3" class="muted">Операций не найдено</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('gold-back').onclick = () => { Admin._goldPlayer = null; Admin.renderGold(c); };
  },

  // ═══ БАЗА ДАННЫХ: состояние, копии, снимки, восстановление ═══════
  // Восстановление раньше требовало разработчика — теперь всё кнопками.
  // ═══ ЭКОНОМИКА — четыре бывшие вкладки в одной ═══════════════════
  // Массовая выдача, наёмники, акции и бонусы — про одно и то же:
  // раздачу благ. Держать под них четыре вкладки в шапке было
  // расточительно, теперь это подвкладки внутри одной.
  _econTab: 'tools',

  renderEcon(c) {
    const subs = [
      { id: 'tools',     label: '🎁 Массовая выдача', zone: 'economy' },
      { id: 'mercs',     label: '🥷 Наёмники',        zone: 'economy' },
      { id: 'discounts', label: '🏷 Акции',           zone: 'discounts' },
      { id: 'buffs',     label: '🎉 Бонусы',          zone: 'economy' },
    ].filter((x) => Admin.can(x.zone));
    if (!subs.length) { c.innerHTML = '<div class="card"><p class="muted">Раздел недоступен.</p></div>'; return; }
    if (!subs.some((x) => x.id === Admin._econTab)) Admin._econTab = subs[0].id;

    c.innerHTML = `
      <div class="tabs comm-subtabs">
        ${subs.map((x) => `<div class="tab ${Admin._econTab === x.id ? 'active' : ''}" data-econ="${x.id}">${x.label}</div>`).join('')}
      </div>
      <div id="econ-body"></div>`;
    c.querySelectorAll('[data-econ]').forEach((t) => {
      t.onclick = () => { Admin._econTab = t.dataset.econ; Admin.renderEcon(c); };
    });
    const body = document.getElementById('econ-body');
    if (Admin._econTab === 'tools')     return Admin.renderTools(body);
    if (Admin._econTab === 'mercs')     return Admin.renderMercs(body);
    if (Admin._econTab === 'discounts') return Admin.renderDiscounts(body);
    if (Admin._econTab === 'buffs')     return Admin.renderBuffs(body);
  },

  // ═══ БАЗА ДАННЫХ — компактный блок внутри «Техники» ══════════════
  // Прежде это была отдельная вкладка на полтора десятка карточек ради
  // трёх действий. Копии и так делаются автоматически каждые 6 часов,
  // поэтому здесь осталось только нужное руками: состояние, кнопка
  // копии и откат коллекции из снимка.
  async renderDbBlock() {
    const box = document.getElementById('db-block');
    if (!box) return;
    if (!Admin.can('database')) { box.style.display = 'none'; return; }

    let d = null;
    try { d = await API.get('/api/admin/db/stats'); }
    catch (e) { box.innerHTML = `<div class="muted small">База: ${UI.esc(e.message)}</div>`; return; }
    const st = d.stats || {};
    const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' МБ';

    if (st.driver !== 'sqlite') {
      box.innerHTML = `<div class="name">🗄 База данных</div>
        <p class="muted small mt">Сейчас <b>${UI.esc(String(st.driver || '—'))}</b>.
        Копии и снимки доступны после перехода на свою базу.</p>`;
      return;
    }

    let snaps = { snapshots: [] };
    try { snaps = await API.get('/api/admin/db/snapshots?limit=8'); } catch (e) {}

    box.innerHTML = `
      <div class="db-line">
        <div class="name" style="margin:0">🗄 База данных</div>
        <span class="db-ok">${st.integrity === 'ok' ? '● в порядке' : '● ' + UI.esc(String(st.integrity))}</span>
        <span class="muted small">${mb(st.sizeBytes || 0)} · игроков ${UI.fmtNum(st.players || 0)} · копий ${(d.backups || []).length}</span>
        <button class="btn btn-inline" id="db-backup" style="margin-left:auto">💾 Копия</button>
      </div>
      <p class="muted small mt">Копии создаются сами каждые 6 часов. Кнопка нужна перед рискованными действиями.</p>
      ${(snaps.snapshots || []).length ? `
        <details class="db-more mt">
          <summary>Снимки коллекций (${snaps.snapshots.length})</summary>
          <div class="mt">
            ${snaps.snapshots.map((sn) => `
              <div class="adm-measure">
                <span class="grow small">#${sn.seq} <b>${UI.esc(sn.collection)}</b> <span class="muted">${UI.esc(sn.label)}</span></span>
                <span class="muted small">${new Date(sn.at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                <button class="btn btn-red btn-inline" data-restore="${sn.seq}" data-coll="${UI.esc(sn.collection)}">Откатить</button>
              </div>`).join('')}
          </div>
        </details>` : ''}`;

    const bb = document.getElementById('db-backup');
    if (bb) bb.onclick = async () => {
      bb.disabled = true;
      try { await API.post('/api/admin/db/backup', {}); UI.toast('💾 Копия создана'); Admin.renderDbBlock(); }
      catch (e) { UI.toast('⛔ ' + e.message); bb.disabled = false; }
    };
    box.querySelectorAll('[data-restore]').forEach((b) => {
      b.onclick = async () => {
        if (!await UI.confirm(
          `Откатить коллекцию <b>${UI.esc(b.dataset.coll)}</b> к снимку #${b.dataset.restore}?<br>` +
          `<span class="muted small">Перед откатом создаётся копия всей базы — действие можно отменить.</span>`,
          { title: 'Откат из снимка', icon: '♻️', html: true, okText: 'Откатить', danger: true })) return;
        try {
          await API.post('/api/admin/db/restore', { seq: Number(b.dataset.restore), collection: b.dataset.coll });
          UI.toast('♻️ Откачено');
          Admin.renderDbBlock();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
  },

  renderTech(c) {
    const t = Admin.techTarget;
    // Блок базы данных доезжает следом отдельным запросом — он нужен
    // редко, и грузить его при каждом открытии вкладки незачем
    setTimeout(() => Admin.renderDbBlock(), 0);
    c.innerHTML = `
      <div class="card">
        <div class="name">🔎 Выбор аккаунта</div>
        <p class="muted small mt">Найдите игрока по позывному — он станет целью операций ниже.</p>
        <div class="field-row mt">
          <input type="text" id="tech-q" class="field" placeholder="Позывной игрока…" style="flex:1"
                 value="${t ? UI.esc(t.name) : ''}">
          <button class="btn btn-orange btn-inline" id="tech-search">🔍 Найти</button>
        </div>
        <div id="tech-results" class="mt"></div>
        ${t ? `
        <div class="card mt" style="border-color:var(--gold);background:rgba(255,180,0,.06)">
          <div class="name">Выбран: ${UI.esc(t.name)} ${t.isAdmin ? '<span class="badge">👑 админ</span>' : ''} ${t.banned ? '<span class="badge" style="background:var(--red)">заблокирован</span>' : ''}</div>
          <div class="muted small mt">ID: <code>${UI.esc(t.id)}</code> · Ур. ${t.level} · ${t.online ? 'онлайн' : 'не в сети'}</div>
        </div>` : '<p class="muted small mt">Аккаунт не выбран.</p>'}
      </div>

      <div class="card" style="margin-top:16px;border-color:var(--orange-1)">
        <div class="name">🔑 Установить пароль</div>
        <p class="muted small mt">Для случаев, когда игрок забыл пароль, а почта недоступна. Старый пароль не нужен. Минимум 8 символов. Все активные сессии игрока будут сброшены — войти можно будет только с новым паролем.</p>
        <label class="field-label">Новый пароль для игрока</label>
        <div class="field-row">
          <input type="password" id="tech-pass" class="field" placeholder="новый пароль…" style="flex:1" autocomplete="new-password" ${t ? '' : 'disabled'}>
          <button class="btn btn-inline" id="tech-pass-eye" title="Показать пароль">👁</button>
        </div>
        <button class="btn btn-orange mt" id="tech-pass-go" style="width:100%" ${t ? '' : 'disabled'}>
          🔑 Установить пароль${t ? ` игроку «${UI.esc(t.name)}»` : ''}
        </button>
      </div>

      <div class="card" style="margin-top:16px;border-color:var(--red)">
        <div class="name" style="color:var(--red)">🗑 Полное удаление аккаунта</div>
        <p class="muted small mt">Аккаунт стирается из игры целиком: почта, уведомления, санкции, награды, обращения, участие в боях и сообщения в чате. Позывной и email освобождаются, вход становится невозможен — сервер отвечает так, будто такого игрока никогда не было. <b style="color:var(--red)">Необратимо.</b> Если нужно лишь обнулить прогресс — используйте «Обнулить аккаунт» во вкладке «Игроки».</p>
        <label class="field-label">Подтверждение: введите позывной игрока точь-в-точь</label>
        <input type="text" id="tech-del-confirm" class="field" placeholder="${t ? UI.esc(t.name) : 'сначала выберите аккаунт'}" ${t ? '' : 'disabled'}>
        <button class="btn btn-red mt" id="tech-del-go" style="width:100%" ${t ? '' : 'disabled'}>
          🗑 Удалить аккаунт навсегда
        </button>
      </div>

      <!-- База данных: копии и снимки. Отдельная вкладка ради трёх
           кнопок не нужна — блок живёт здесь и грузится отдельно -->
      ${Admin.can('security') ? `
      <div class="card">
        <div class="name">📧 Подтверждение почты</div>
        <p class="muted small mt">Состояние отправки писем и игроки, застрявшие на подтверждении.</p>
        <button class="btn btn-inline mt" id="mail-check">Проверить</button>
        <div id="mail-box" class="mt"></div>
      </div>` : ''}

      ${(Admin.me && Admin.me.staffRole === 'owner') ? `
      <div class="card">
        <div class="name">📧 Подтверждение почты</div>
        <p class="muted small mt">Состояние отправки писем и список тех, кто ещё не подтвердил адрес.</p>
        <button class="btn btn-inline mt" id="mail-check">Проверить</button>
        <div id="mail-box" class="mt"></div>
      </div>` : ''}

      ${(Admin.me && Admin.me.staffRole === 'owner') ? `
      <div class="card">
        <div class="name">⚔ Проверка очередей боёв</div>
        <p class="muted small mt">Состояние арены и групповых боёв. Если участники висят,
        а таймер стоит — смотрите сюда.</p>
        <div class="mt">
          <button class="btn btn-inline" id="lobby-check">Проверить</button>
          <button class="btn btn-inline btn-red" id="lobby-reset">Сбросить очереди</button>
        </div>
        <div id="lobby-box" class="mt"></div>
      </div>
      <div class="card">
        <div class="name">🌐 Проверка сети</div>
        <p class="muted small mt">Показывает, что сервер получает от прокси. Если у всех игроков
        один и тот же адрес — смотрите сюда.</p>
        <button class="btn btn-inline mt" id="net-check">Проверить</button>
        <div id="net-box" class="mt"></div>
      </div>` : ''}

      ${Admin.can('security') ? `
      <div class="card">
        <div class="name">👥 Несколько аккаунтов с одного адреса</div>
        <p class="muted small mt">Помогает заметить мультоводов. Но помните: за одним домашним
        роутером сидит семья, а мобильные операторы выдают общий адрес сотням абонентов —
        совпадение само по себе ничего не доказывает.</p>
        <div class="field-row mt">
          <select id="mc-min" class="field">
            <option value="2">от 2 аккаунтов</option>
            <option value="3" selected>от 3 аккаунтов</option>
            <option value="5">от 5 аккаунтов</option>
          </select>
          <button class="btn btn-inline" id="mc-go">Показать</button>
        </div>
        <div id="mc-box" class="mt"></div>
      </div>` : ''}

      <div class="card" id="db-block"><div class="muted small">База данных…</div></div>`;

    // Поиск игрока
    const doSearch = async () => {
      const q = document.getElementById('tech-q').value.trim();
      const box = document.getElementById('tech-results');
      box.innerHTML = '<div class="loading">Поиск…</div>';
      try {
        const { players } = await API.get('/api/admin/players?q=' + encodeURIComponent(q));
        if (!players.length) { box.innerHTML = '<p class="muted small">Никого не найдено.</p>'; return; }
        box.innerHTML = players.slice(0, 20).map((p) => `
          <div class="list-row" style="padding:6px 0;border-bottom:1px solid var(--border-dim)">
            <div class="grow">${UI.esc(p.name)} ${p.isAdmin ? '<span class="badge">👑</span>' : ''}
              <span class="muted small">Ур. ${p.level} · ${p.id}</span></div>
            <button class="btn btn-inline" data-pick="${p.id}">Выбрать</button>
          </div>`).join('');
        box.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => {
          Admin.techTarget = players.find((x) => x.id === b.dataset.pick);
          Admin.renderTab();
        });
      } catch (e) { box.innerHTML = `<p class="small" style="color:var(--red)">⛔ ${UI.esc(e.message)}</p>`; }
    };
    // Состояние подтверждения почты
    const mailGo = document.getElementById('mail-check');
    if (mailGo) {
      const paintMail = async () => {
        const box = document.getElementById('mail-box');
        box.innerHTML = '<div class="loading">Проверяю…</div>';
        try {
          const r = await API.get('/api/admin/email-status');
          const dt = (ms) => ms ? new Date(ms).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
          box.innerHTML = `
            <table class="access-table">
              <tr><td>Сервис</td><td class="num"><b>${UI.esc(r.providerName || '—')}</b></td></tr>
            <tr><td>Отправка писем</td><td class="num">${r.configured
                ? '<b style="color:var(--green)">настроена</b>'
                : '<b style="color:var(--orange-1)">не настроена</b>'}</td></tr>
              <tr><td>Отправитель</td><td class="num small mono">${UI.esc(r.from || '—')}</td></tr>
              <tr><td>Адрес игры</td><td class="num small mono">${UI.esc(r.appUrl || '—')}</td></tr>
              <tr><td>Ждут подтверждения</td><td class="num"><b>${UI.fmtNum(r.unverified)}</b> из ${UI.fmtNum(r.total)}</td></tr>
            </table>
            <p class="small mt" style="color:var(--orange-1)">${UI.esc(r.hint)}</p>
            ${(r.list || []).length ? `
              <div class="mt"><div class="muted small">Не подтвердили почту:</div>
                <table class="access-table mt">
                  ${r.list.map((p) => `
                    <tr>
                      <td><b>${UI.esc(p.name)}</b> <span class="muted small">ур. ${p.level}</span></td>
                      <td class="small mono">${UI.esc(p.email)}</td>
                      <td class="small muted nowrap">${dt(p.createdAt)}</td>
                      <td class="num"><button class="btn btn-inline" data-verify="${p.id}">Подтвердить</button></td>
                    </tr>`).join('')}
                </table>
                <p class="muted small mt">Подтверждайте вручную, только если убедились, что игрок —
                владелец этой почты. Обычно письмо просто попало в спам.</p>
              </div>` : ''}`;
          box.querySelectorAll('[data-verify]').forEach((b) => {
            b.onclick = async () => {
              b.disabled = true;
              try { await API.post('/api/admin/verify-email', { userId: b.dataset.verify }); UI.toast('✅ Подтверждено'); paintMail(); }
              catch (e) { UI.toast('⛔ ' + e.message); b.disabled = false; }
            };
          });
        } catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; }
      };
      mailGo.onclick = paintMail;
    }

    // Проверка очередей боёв
    const lobbyGo = document.getElementById('lobby-check');
    if (lobbyGo) lobbyGo.onclick = async () => {
      const box = document.getElementById('lobby-box');
      box.innerHTML = '<div class="loading">Проверяю…</div>';
      try {
        const r = await API.get('/api/admin/lobby-check');
        const row = (k, v) => `<tr><td>${UI.esc(k)}</td><td class="num">${UI.esc(String(v))}</td></tr>`;
        box.innerHTML = `
          <table class="access-table">
            <tr><td colspan="2"><b>Групповые бои</b></td></tr>
            ${row('участников', r.group.registered)}
            ${row('кто', r.group.names.join(', ') || '—')}
            ${row('старт через', r.group.slotIn)}
            ${row('бой', r.group.battle)}
            <tr><td colspan="2"><b>Арена</b></td></tr>
            ${['basic', 'elite'].map((d) => {
              const x = r.arena[d];
              return typeof x === 'string' ? row(d, x)
                : row(d, `${x.registered} чел., старт ${x.slotIn}, бой: ${x.battle}`);
            }).join('')}
          </table>
          <p class="small mt" style="color:${r.problems.length ? 'var(--red)' : 'var(--green)'}">
            ${UI.esc(r.verdict)}</p>`;
      } catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; }
    };
    const lobbyReset = document.getElementById('lobby-reset');
    if (lobbyReset) lobbyReset.onclick = async () => {
      const go = await UI.confirm(
        'Сбросить очереди арены и групповых боёв?<br>' +
        '<span class="muted small">Записи снимутся, взносы на арене вернутся игрокам.</span>',
        { title: 'Сброс очередей', icon: '⚠️', html: true, okText: 'Сбросить', cancelText: 'Отмена' });
      if (!go) return;
      try {
        const r = await API.post('/api/admin/lobby-reset', {});
        UI.toast(`✅ Сброшено, взносов возвращено: ${r.refunded}`);
        if (lobbyGo) lobbyGo.onclick();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    // Проверка сети: что приходит от прокси
    const netGo = document.getElementById('net-check');
    if (netGo) netGo.onclick = async () => {
      const box = document.getElementById('net-box');
      box.innerHTML = '<div class="loading">Проверяю…</div>';
      try {
        const r = await API.get('/api/admin/net-check');
        const rows = Object.entries(r.headers || {})
          .map(([k, v]) => `<tr><td class="mono small">${UI.esc(k)}</td><td class="mono small">${UI.esc(String(v))}</td></tr>`).join('');
        box.innerHTML = `
          <table class="access-table">
            <tr><td><b>Определён адрес</b></td><td class="mono"><b>${UI.esc(r.detected)}</b></td></tr>
            ${rows}
            <tr><td>Соединение с</td><td class="mono small">${UI.esc(r.socket || '—')}</td></tr>
          </table>
          <p class="small mt" style="color:var(--orange-1)">${UI.esc(r.hint)}</p>`;
      } catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; }
    };

    // Поиск нескольких аккаунтов с одного адреса
    const mcGo = document.getElementById('mc-go');
    if (mcGo) mcGo.onclick = async () => {
      const box = document.getElementById('mc-box');
      const min = (document.getElementById('mc-min') || {}).value || '3';
      box.innerHTML = '<div class="loading">Ищу…</div>';
      try {
        const r = await API.get('/api/admin/multi-check?min=' + encodeURIComponent(min));
        box.innerHTML = (r.groups || []).length
          ? r.groups.map((gr) => `
              <div class="mc-group">
                <div class="mc-ip"><span class="mono">${UI.esc(gr.ip)}</span>
                  <span class="muted small">· аккаунтов: ${gr.count}</span></div>
                <div class="mc-players">
                  ${gr.players.map((p) => `<span class="mc-player">${UI.esc(p.name)}
                    <span class="muted small">ур. ${p.level}</span></span>`).join('')}
                </div>
              </div>`).join('')
          : '<p class="muted small">Совпадений не найдено.</p>';
      } catch (e) { box.innerHTML = `<p style="color:var(--red)">${UI.esc(e.message)}</p>`; }
    };

    document.getElementById('tech-search').onclick = doSearch;
    document.getElementById('tech-q').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };

    if (!t) return;

    // Показать/скрыть пароль
    const passInput = document.getElementById('tech-pass');
    document.getElementById('tech-pass-eye').onclick = () => {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    };

    // Установка пароля
    document.getElementById('tech-pass-go').onclick = async () => {
      const password = passInput.value;
      if (password.length < 8) return UI.toast('⛔ Пароль: минимум 8 символов');
      if (!confirm(`Установить новый пароль игроку «${t.name}»?\n\nВсе его активные сессии будут сброшены.`)) return;
      try {
        const r = await API.post('/api/admin/set-password', { userId: t.id, password });
        UI.toast((r.notices && r.notices[0]) || '🔑 Пароль установлен');
        passInput.value = '';
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    // Удаление аккаунта — двойное подтверждение: поле + confirm
    document.getElementById('tech-del-go').onclick = async () => {
      const confirmName = document.getElementById('tech-del-confirm').value.trim();
      if (confirmName.toLowerCase() !== String(t.name).toLowerCase()) {
        return UI.toast('⛔ Позывной в поле подтверждения не совпадает');
      }
      if (!confirm(`УДАЛИТЬ аккаунт «${t.name}» навсегда?\n\nВосстановить будет невозможно. Игрок не сможет войти в игру, позывной освободится.`)) return;
      try {
        const r = await API.post('/api/admin/delete-account', { userId: t.id, confirmName });
        UI.toast((r.notices && r.notices[0]) || '🗑 Аккаунт удалён');
        Admin.techTarget = null;
        Admin.renderTab();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  },

  // ── Вкладка: Инструменты (массовые/опасные операции) ────────────
  renderTools(c) {
    c.innerHTML = `
      <div class="card">
        <div class="name">🌍 Выдать всем игрокам</div>
        <p class="muted small mt">Ресурсы получат сразу все зарегистрированные игроки.</p>
        ${Admin._grantFields('all')}
        <button class="btn btn-orange mt" id="grant-all-go" style="width:100%">💥 Выдать всем</button>
      </div>
      <div class="card" style="margin-top:16px;border-color:var(--red)">
        <div class="name">♻️ Сброс параметров</div>
        <p class="muted small mt">Сбросить отдельный параметр — у всех игроков или у одного. Пусто = у всех. Необратимо!</p>
        <div style="margin-top:8px">
          <label style="font-size:11px;color:var(--dim)">Параметр</label>
          <select id="rp-param" style="width:100%">
            <option value="missions">📋 Миссии</option>
            <option value="achievements">🎖 Достижения (+счётчики)</option>
            <option value="trophies">🎁 Трофеи</option>
            <option value="skills">📈 Навыки (+очки)</option>
            <option value="money">💰 Деньги (доллары/золото/банк)</option>
            <option value="tokens">🎖 Жетоны</option>
            <option value="units">🪖 Техника</option>
            <option value="buildings">🏗 Постройки</option>
            <option value="ears">👂 Уши</option>
            <option value="battle">⚔️ Боевая статистика</option>
            <option value="effects">💊 Активные эффекты</option>
            <option value="alliances">🤝 Альянсы/легионы</option>
            <option value="cosmetics">🎨 Косметика/титулы</option>
            <option value="streak">📅 Серия входов</option>
          </select>
          <label style="font-size:11px;color:var(--dim);margin-top:6px;display:block">ID игрока (пусто = у всех)</label>
          <input type="text" id="rp-userid" placeholder="оставьте пустым для сброса у всех">
          <button class="btn btn-red mt" id="rp-go" style="width:100%">♻️ Сбросить параметр</button>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,.08);margin-top:12px;padding-top:10px">
          <button class="btn btn-inline" id="rm-all" style="width:100%">📋 Сбросить ВСЕ миссии у всех игроков</button>
        </div>
      </div>
      <div class="card" style="margin-top:16px;border-color:var(--red)">
        <div class="name">🧹 Очистка групп</div>
        <p class="muted small mt">Полностью стирает группы у ВСЕХ игроков — их создают заново. Необратимо!</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <button class="btn btn-inline" id="wipe-alliances">Обнулить все альянсы</button>
          <button class="btn btn-inline" id="wipe-legions">Удалить все легионы + логи боёв</button>
          <button class="btn btn-red" id="wipe-all">Стереть всё (альянсы + легионы)</button>
        </div>
      </div>
      <div class="card" style="margin-top:16px;border-color:var(--orange-1)">
        <div class="name">📧 Диагностика почты</div>
        <div id="email-status" class="muted small mt">Загрузка статуса…</div>
        <div class="field-row mt">
          <input type="email" id="email-test-to" placeholder="куда отправить тест…" style="flex:1">
          <button class="btn btn-orange btn-inline" id="email-test-go"><span class="ic-mail"></span> Тест</button>
        </div>
        <div id="email-test-result" class="small mt"></div>
      </div>`;
    document.getElementById('grant-all-go').onclick = () => Admin.submitGrantAll();
    const wipe = async (what, label) => {
      if (!confirm(`${label}\n\nЭто затронет ВСЕХ игроков и необратимо. Продолжить?`)) return;
      try { const r = await API.post('/api/admin/wipe-groups', { what }); UI.toast('🧹 Очищено: ' + (r.cleared || []).join(', ')); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('wipe-alliances').onclick = () => wipe('alliances', 'Обнулить ВСЕ альянсы?');
    document.getElementById('wipe-legions').onclick = () => wipe('legions', 'Удалить ВСЕ легионы и логи боёв?');
    document.getElementById('wipe-all').onclick = () => wipe('all', 'Стереть ВСЕ альянсы и легионы?');
    document.getElementById('rp-go').onclick = async () => {
      const param = document.getElementById('rp-param').value;
      const userId = document.getElementById('rp-userid').value.trim();
      const scope = userId ? `у игрока ${userId}` : 'у ВСЕХ игроков';
      if (!confirm(`Сбросить «${param}» ${scope}?\n\nЭто необратимо. Продолжить?`)) return;
      try {
        const r = await API.post('/api/admin/reset-param', userId ? { param, userId } : { param });
        UI.toast(`♻️ «${param}» сброшен (${r.count})`);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('rm-all').onclick = async () => {
      if (!confirm('Сбросить ВСЕ миссии у ВСЕХ игроков?\n\nНеобратимо. Продолжить?')) return;
      try { const r = await API.post('/api/admin/reset-missions', {}); UI.toast(`📋 Миссии сброшены у ${r.count} игроков`); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    // Диагностика почты: подгружаем статус
    (async () => {
      const box = document.getElementById('email-status');
      try {
        const s = await API.get('/api/admin/email/status');
        const badge = s.configured
          ? (s.usingTestSender ? '<span style="color:var(--orange)">⚠️ тестовый отправитель</span>' : '<span style="color:var(--green)">✅ настроена</span>')
          : '<span style="color:var(--red)">❌ не настроена</span>';
        box.innerHTML = `
          Статус: ${badge}<br>
          Отправитель: <b>${UI.esc(s.from)}</b><br>
          APP_URL: <b>${UI.esc(s.appUrl)}</b>${s.keyMasked ? `<br>Ключ: <b>${UI.esc(s.keyMasked)}</b>` : ''}<br>
          <span style="color:var(--dim)">${UI.esc(s.hint)}</span>`;
      } catch (e) { box.innerHTML = '<span style="color:var(--red)">Ошибка: ' + UI.esc(e.message) + '</span>'; }
    })();
    document.getElementById('email-test-go').onclick = async () => {
      const to = (document.getElementById('email-test-to') || {}).value || '';
      const res = document.getElementById('email-test-result');
      res.innerHTML = '<span class="muted">Отправка…</span>';
      try {
        const r = await API.post('/api/admin/email/test', { to });
        res.innerHTML = r.sent
          ? '<span style="color:var(--green)">✅ Отправлено успешно. Проверьте ящик (и «Спам»).</span>'
          : `<span style="color:var(--red)">❌ Не отправлено (HTTP ${r.status}). Причина: ${UI.esc(r.error || '—')}</span>`;
      } catch (e) { res.innerHTML = '<span style="color:var(--red)">Ошибка: ' + UI.esc(e.message) + '</span>'; }
    };
  },

  // ── Вкладка: События (мировой босс + рейтинговый сезон) ────────
  async renderEvents(c) {
    let season = null; try { season = await API.get('/api/season'); } catch (e) {}
    let ev = null; try { ev = await API.get('/api/event'); } catch (e) {}
    const rw = (season && season.rewards) || [{ gold: 500, tokens: 3 }, { gold: 300, tokens: 2 }, { gold: 150, tokens: 1 }];
    const fmtLeft = (ms) => {
      if (!ms || ms <= 0) return '—';
      const dd = Math.floor(ms / 86400000), hh = Math.floor((ms % 86400000) / 3600000);
      return `${dd}д ${hh}ч`;
    };
    c.innerHTML = `
      <div class="card" style="border-color:var(--orange-1)">
        <div class="name">🐉 Мировое событие (босс)</div>
        <p class="muted small mt">Запустите PvE-босса для всех игроков. Они атакуют его раз в день, при победе получают награду.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label style="font-size:11px;color:var(--dim)">Название</label><input type="text" id="ev-name" placeholder="Вражеская армада"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-health"></span> Здоровье босса</label><input type="number" id="ev-hp" placeholder="100000"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> Пул золота (всего)</label><input type="number" id="ev-goldpool" placeholder="100000"></div>
          <div><label style="font-size:11px;color:var(--dim)">🎲 Шанс выпадения (%)</label><input type="number" id="ev-drop-chance" placeholder="2"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> За атаку: от</label><input type="number" id="ev-drop-min" placeholder="5"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> За атаку: до</label><input type="number" id="ev-drop-max" placeholder="10"></div>
          <div><label style="font-size:11px;color:var(--dim)">🏆 Награда за килл (последний удар)</label><input type="number" id="ev-kill" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">🥇 Топ-1 по урону</label><input type="number" id="ev-r1" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">🥈 Топ-2 по урону</label><input type="number" id="ev-r2" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">🥉 Топ-3 по урону</label><input type="number" id="ev-r3" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">⏰ Отложить старт (мин, 0=сразу)</label><input type="number" id="ev-delay" placeholder="0"></div>
        </div>
        <div style="margin-top:8px">
          <label style="font-size:11px;color:var(--dim)">🖼 Фото босса</label>
          <input type="text" id="ev-image" placeholder="https://site.com/boss.png — или /img/bosses/armada.webp">
          <div class="boss-img-tools mt">
            <button class="btn btn-inline" id="ev-img-shrink">📐 Сжать до 400×400</button>
            <button class="btn btn-inline" id="ev-img-file">📁 Взять файл с компьютера</button>
            <input type="file" id="ev-img-input" accept="image/*" style="display:none">
            <span class="muted small" id="ev-img-shrink-status"></span>
          </div>
          <div class="boss-img-row">
            <div class="boss-img-preview" id="ev-img-preview">
              <span class="muted small">предпросмотр</span>
            </div>
            <div class="grow">
              <p class="muted small">Вставьте <b>ссылку на любую картинку из интернета</b> — класть файл
              на сервер не нужно. Подойдёт адрес вида <code>https://…/boss.png</code>.
              Можно и без «https://»: <code>site.com/boss.png</code>.</p>
              <p class="muted small">Файлы с сервера (папка <code>/img/bosses/</code>) тоже работают —
              список ниже.</p>
              <div class="small" id="ev-img-status"></div>
            </div>
          </div>
        </div>
        <div style="margin-top:8px">
          <label style="font-size:11px;color:var(--dim)">💬 Своя фраза босса (пусто = случайные из 40 заготовок)</label>
          <input type="text" id="ev-taunt" maxlength="200" placeholder="Это всё, на что ты способен, салага?">
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-orange" id="ev-start" style="flex:1">🐉 Запустить</button>
          <button class="btn btn-red btn-inline" id="ev-stop">🛑 Остановить</button>
        </div>
        <hr class="hr">
        <div class="name" style="font-size:14px">🔧 Настроить дроп ТЕКУЩЕГО события</div>
        <p class="muted small">Меняет золото у уже запущенного босса без перезапуска (рейтинг и HP сохраняются). Пустые поля не трогаются.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label style="font-size:11px;color:var(--dim)">🎲 Новый шанс (%)</label><input type="number" id="evd-chance" placeholder="напр. 25"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> Докинуть в пул</label><input type="number" id="evd-pool" placeholder="напр. 50000"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> За атаку: от</label><input type="number" id="evd-min" placeholder="5"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> За атаку: до</label><input type="number" id="evd-max" placeholder="10"></div>
        </div>
        <button class="btn btn-orange mt" id="evd-apply" style="width:100%">🔧 Применить к текущему событию</button>
        <hr class="hr">
        <div class="name" style="font-size:14px">🖼 Фото и фраза ТЕКУЩЕГО босса</div>
        <p class="muted small">Меняются на лету, без перезапуска. Пустое фото — убрать картинку; пустая фраза — вернуть случайные реплики.</p>
        ${ev && ev.image ? `<img class="boss-photo-preview" src="${UI.esc(ev.image)}" alt="" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<p class=&quot;small&quot; style=&quot;color:var(--red)&quot;>⚠ Картинка не загрузилась: сайт может блокировать вставку по ссылке. Положите файл в /public/img/bosses/ и укажите /img/bosses/имя.webp</p>')">` : ''}
        ${ev && ev.taunt ? `<p class="small" style="font-style:italic">Сейчас: «${UI.esc(ev.taunt)}»</p>` : ''}
        <div style="margin-top:8px">
          <label style="font-size:11px;color:var(--dim)">🖼 Ссылка на фото (квадрат 300×300; лучше свой файл в /img/bosses/)</label>
          <input type="text" id="evl-image" placeholder="/img/bosses/latipko.webp" value="${ev && ev.image ? UI.esc(ev.image) : ''}">
        </div>
        <div id="boss-img-list" style="margin-top:6px"><span class="muted small">Проверяю файлы на сервере…</span></div>
        <div style="margin-top:8px">
          <label style="font-size:11px;color:var(--dim)">💬 Фраза босса</label>
          <input type="text" id="evl-taunt" maxlength="200" placeholder="пусто = случайные фразы" value="${ev && ev.taunt ? UI.esc(ev.taunt) : ''}">
        </div>
        <button class="btn btn-orange mt" id="evl-apply" style="width:100%">🖼 Обновить фото и фразу</button>
        <hr class="hr">
        <div class="name" style="font-size:14px"><span class="ic-health"></span> Здоровье ТЕКУЩЕГО босса</div>
        ${ev && ev.active ? `
          <p class="muted small">Сейчас: <b>${UI.fmtNum(ev.hp)}</b> / ${UI.fmtNum(ev.maxHp)} HP (${ev.hpPct}%). Установите новое значение — рейтинг и награды сохранятся. Ставка 0 «добьёт» босса.</p>
          <div class="field-row mt">
            <input type="number" id="ev-sethp" min="0" max="${ev.maxHp}" placeholder="${ev.hp}" value="${ev.hp}" style="flex:1">
            <button class="btn btn-orange btn-inline" id="ev-sethp-apply">❤️ Установить HP</button>
          </div>
        ` : `<p class="muted small">Нет активного события. HP можно регулировать только у запущенного босса.</p>`}
      </div>
      <div class="card" style="margin-top:16px;border-color:var(--gold)">
        <div class="name">🏆 Рейтинговый сезон (недельный)</div>
        <p class="muted small mt">Автосброс каждую неделю: пн 00:00 — вс 23:59 МСК. Топ-3 КАЖДОЙ из 7 категорий получают награду, затем метрики обнуляются.${season ? ` Текущая неделя: <b>${season.weekId}</b>, до конца: <b>${fmtLeft(season.endsAt - Date.now())}</b>.` : ''}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label style="font-size:11px;color:var(--dim)">🥇 Золото / жетоны</label><div style="display:flex;gap:4px"><input type="number" id="se-g1" value="${rw[0].gold}"><input type="number" id="se-t1" value="${rw[0].tokens}"></div></div>
          <div><label style="font-size:11px;color:var(--dim)">🥈 Золото / жетоны</label><div style="display:flex;gap:4px"><input type="number" id="se-g2" value="${rw[1].gold}"><input type="number" id="se-t2" value="${rw[1].tokens}"></div></div>
          <div><label style="font-size:11px;color:var(--dim)">🥉 Золото / жетоны</label><div style="display:flex;gap:4px"><input type="number" id="se-g3" value="${rw[2].gold}"><input type="number" id="se-t3" value="${rw[2].tokens}"></div></div>
        </div>
        <button class="btn btn-orange mt" id="se-save" style="width:100%">💾 Сохранить награды</button>
        <hr class="hr">
        <button class="btn btn-red" id="se-end" style="width:100%">🏁 Завершить неделю СЕЙЧАС (наградить топ-3 + обнулить)</button>
      </div>`;
    const evVal = (id) => (document.getElementById(id) || {}).value || '';
    document.getElementById('ev-start').onclick = async () => {
      try {
        await API.post('/api/admin/event/start', {
          name: evVal('ev-name'), hp: evVal('ev-hp'),
          goldPool: evVal('ev-goldpool'),
          dropChance: evVal('ev-drop-chance'),
          dropMin: evVal('ev-drop-min'), dropMax: evVal('ev-drop-max'),
          killReward: evVal('ev-kill'),
          reward1: evVal('ev-r1'), reward2: evVal('ev-r2'), reward3: evVal('ev-r3'),
          delayMin: evVal('ev-delay'),
          image: (document.getElementById('ev-image') || {}).value || '',
          taunt: (document.getElementById('ev-taunt') || {}).value || '',
        });
        UI.toast('🐉 Событие запущено');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const lookBtn = document.getElementById('evl-apply');
    // Показываем, какие файлы РЕАЛЬНО лежат на сервере в /img/bosses/.
    // ── Сжатие картинки босса до 400×400 ──
    // Картинку уменьшаем ПРЯМО ЗДЕСЬ, в браузере, и кладём файлом на свой
    // сервер: игроки грузят лёгкое изображение, а не мегабайтную картинку
    // с чужого сайта. Ссылку можно вставить любую — размер приведётся сам.
    (() => {
      const inp = document.getElementById('ev-image');
      const st = document.getElementById('ev-img-shrink-status');
      const fileBtn = document.getElementById('ev-img-file');
      const fileInp = document.getElementById('ev-img-input');
      const shrinkBtn = document.getElementById('ev-img-shrink');
      if (!inp || !shrinkBtn) return;

      // Приводим к квадрату 400×400: обрезаем по центру, чтобы босс не
      // растягивался, и жмём качество, пока файл не станет лёгким
      const toSquare = (img) => {
        const S = 400;
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        const side = Math.min(img.width, img.height);
        cv.getContext('2d').drawImage(
          img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
        let q = 0.85, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 220 * 1024 && q > 0.4) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        return out;
      };

      const upload = async (dataUrl, sourceLabel) => {
        st.textContent = 'загружаю на сервер…';
        try {
          const r = await API.post('/api/admin/event/image', { image: dataUrl });
          inp.value = r.url;
          inp.dispatchEvent(new Event('input'));
          st.innerHTML = `<span style="color:var(--green)">✅ сжато до 400×400 и сохранено${sourceLabel ? ' (' + sourceLabel + ')' : ''}</span>`;
        } catch (e) { st.innerHTML = `<span style="color:var(--red)">⛔ ${UI.esc(e.message)}</span>`; }
      };

      // Из ссылки. Чужой сайт может запретить чтение картинки скриптом —
      // тогда сжать её не выйдет, и мы честно об этом сообщаем.
      shrinkBtn.onclick = () => {
        const url = (inp.value || '').trim();
        if (!url) { st.textContent = 'сначала вставьте ссылку'; return; }
        if (url.startsWith('/')) { st.textContent = 'это уже файл на сервере'; return; }
        st.textContent = 'загружаю картинку…';
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try { upload(toSquare(img), 'из ссылки'); }
          catch (e) {
            st.innerHTML = '<span style="color:var(--orange-1)">⚠ сайт запрещает копирование картинки. ' +
              'Скачайте её и загрузите кнопкой «Взять файл»</span>';
          }
        };
        img.onerror = () => { st.innerHTML = '<span style="color:var(--red)">⛔ картинка не открылась по этой ссылке</span>'; };
        img.src = url;
      };

      // Из файла — работает всегда, ограничений чужого сайта нет
      if (fileBtn && fileInp) {
        fileBtn.onclick = () => fileInp.click();
        fileInp.onchange = () => {
          const f = fileInp.files && fileInp.files[0];
          if (!f) return;
          st.textContent = 'обрабатываю…';
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => upload(toSquare(img), f.name);
            img.onerror = () => { st.innerHTML = '<span style="color:var(--red)">⛔ это не изображение</span>'; };
            img.src = reader.result;
          };
          reader.readAsDataURL(f);
        };
      }
    })();

    // Пустой список = файл не задеплоен (а не «ссылка неправильная»).
    // Живой предпросмотр картинки босса: сразу видно, открывается ли
    // ссылка. Раньше ошибку в адресе замечали только при запуске события.
    (() => {
      const inp = document.getElementById('ev-image');
      const prev = document.getElementById('ev-img-preview');
      const status = document.getElementById('ev-img-status');
      if (!inp || !prev) return;
      let timer = null;
      const show = () => {
        const raw = (inp.value || '').trim();
        if (!raw) {
          prev.innerHTML = '<span class="muted small">предпросмотр</span>';
          status.innerHTML = '';
          return;
        }
        if (/^\s*(javascript|data|vbscript|file|blob)\s*:/i.test(raw)) {
          prev.innerHTML = '<span class="small" style="color:var(--red)">⛔</span>';
          status.innerHTML = '<span style="color:var(--red)">Такая ссылка не принимается</span>';
          return;
        }
        // Тот же разбор, что и на сервере: без схемы подставляем https://
        let url = raw;
        if (/^\/\//.test(url)) url = 'https:' + url;
        else if (!/^https?:\/\//i.test(url) && !/^\//.test(url) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) url = 'https://' + url;
        status.innerHTML = '<span class="muted">Загружаю…</span>';
        prev.innerHTML = `<img src="${UI.esc(url)}" alt="">`;
        const img = prev.querySelector('img');
        img.onload = () => {
          status.innerHTML = `<span style="color:#8fd47a">✅ Картинка открывается · ${img.naturalWidth}×${img.naturalHeight}</span>`;
        };
        img.onerror = () => {
          prev.innerHTML = '<span class="small" style="color:var(--red)">✕</span>';
          status.innerHTML = '<span style="color:var(--red)">Не удалось загрузить. Проверьте ссылку — она должна вести прямо на файл картинки, а не на страницу.</span>';
        };
      };
      inp.oninput = () => { clearTimeout(timer); timer = setTimeout(show, 500); };
      if (inp.value) show();
    })();

    (async () => {
      const box = document.getElementById('boss-img-list');
      if (!box) return;
      try {
        const d = await API.get('/api/admin/event/images');
        if (!d.exists) {
          box.innerHTML = `<span class="small" style="color:var(--red)">⚠ На сервере нет папки <b>${d.dir}</b>. Создайте её и положите туда картинку.</span>`;
          return;
        }
        if (!d.files.length) {
          box.innerHTML = `<span class="small" style="color:var(--red)">⚠ Папка <b>${d.dir}</b> на сервере ПУСТА. Файл не доехал: закоммитьте его (git add/commit/push) и сделайте git pull на сервере.</span>`;
          return;
        }
        box.innerHTML = `<div class="small muted">Файлы на сервере (нажмите, чтобы подставить):</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            ${d.files.map(f => `<button class="btn btn-inline boss-img-pick" data-url="${UI.esc(f.url)}" style="font-size:11px">${UI.esc(f.name)}</button>`).join('')}
          </div>`;
        box.querySelectorAll('.boss-img-pick').forEach(b => {
          b.onclick = () => {
            const inp = document.getElementById('evl-image');
            if (inp) inp.value = b.dataset.url;
            UI.toast('Путь подставлен — нажмите «Обновить фото и фразу»');
          };
        });
      } catch (e) {
        box.innerHTML = '<span class="muted small">Не удалось получить список файлов.</span>';
      }
    })();
    if (lookBtn) lookBtn.onclick = async () => {
      try {
        await API.post('/api/admin/event/look', {
          image: (document.getElementById('evl-image') || {}).value || '',
          taunt: (document.getElementById('evl-taunt') || {}).value || '',
        });
        UI.toast('🖼 Фото и фраза босса обновлены');
        Admin.renderTab();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('ev-stop').onclick = async () => {
      if (!confirm('Остановить событие без награды?')) return;
      try { await API.post('/api/admin/event/stop'); UI.toast('🛑 Событие остановлено'); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('evd-apply').onclick = async () => {
      try {
        const r = await API.post('/api/admin/event/drops', {
          dropChance: evVal('evd-chance'),
          addGoldPool: evVal('evd-pool'),
          dropMin: evVal('evd-min'), dropMax: evVal('evd-max'),
        });
        UI.toast(`🔧 Дроп обновлён: шанс ${r.dropChance}%, ${r.dropMin}–${r.dropMax}, пул 🪙 ${UI.fmtNum(r.goldPoolLeft)}`);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const setHpBtn = document.getElementById('ev-sethp-apply');
    if (setHpBtn) setHpBtn.onclick = async () => {
      try {
        const hp = evVal('ev-sethp');
        const r = await API.post('/api/admin/event/hp', { hp });
        UI.toast(`❤️ HP босса: ${UI.fmtNum(r.hp)} / ${UI.fmtNum(r.maxHp)} (${r.hpPct}%)`);
        Admin.renderTab();  // перерисовать, чтобы обновить текущее значение
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('se-save').onclick = async () => {
      try {
        const r = await API.post('/api/admin/season/config', {
          gold1: evVal('se-g1'), tokens1: evVal('se-t1'),
          gold2: evVal('se-g2'), tokens2: evVal('se-t2'),
          gold3: evVal('se-g3'), tokens3: evVal('se-t3'),
        });
        UI.toast('💾 Награды сохранены: 🥇🪙' + r.rewards[0].gold + ' / 🥈🪙' + r.rewards[1].gold + ' / 🥉🪙' + r.rewards[2].gold);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('se-end').onclick = async () => {
      if (!confirm('Завершить ТЕКУЩУЮ неделю сейчас?\n\nТоп-3 каждой категории получат награды, все метрики обнулятся. Продолжить?')) return;
      try {
        const r = await API.post('/api/admin/season/end', {});
        const n = Object.values(r.winners || {}).reduce((s, a) => s + a.length, 0);
        UI.toast('🏁 Неделя завершена. Награждено призёров: ' + n);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  },

  _grantFields(prefix) {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div><label style="font-size:11px;color:var(--dim)"><span class="ic-dollar"></span> Доллары</label><input type="number" id="${prefix}-dollars" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> Золото</label><input type="number" id="${prefix}-gold" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">⭐ Опыт</label><input type="number" id="${prefix}-xp" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">📈 Очки навыков</label><input type="number" id="${prefix}-skill" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">👂 Уши</label><input type="number" id="${prefix}-ears" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">🎖 Жетоны</label><input type="number" id="${prefix}-tokens" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">🏦 В банке (только для списания)</label><input type="number" id="${prefix}-bank" placeholder="0"></div>
      </div>
      <label style="font-size:11px;color:var(--dim);display:block;margin-top:8px"><span class="ic-mail"></span> Сообщение игрокам (необязательно)</label>
      <textarea id="${prefix}-note" placeholder="Текст сообщения от администратора…" maxlength="300" style="width:100%;box-sizing:border-box;margin-top:4px"></textarea>`;
  },

  _grantVals(prefix) {
    const v = id => (document.getElementById(id) || {}).value || '';
    return {
      dollars: v(prefix+'-dollars'), gold: v(prefix+'-gold'), xp: v(prefix+'-xp'),
      skillPoints: v(prefix+'-skill'), ears: v(prefix+'-ears'), tokens: v(prefix+'-tokens'),
      bank: v(prefix+'-bank'),
      giftNote: v(prefix+'-note'),
    };
  },

  async loadPlayers() {
    const q = (document.getElementById('ad-q') || {}).value || '';
    const box = document.getElementById('ad-list');
    if (!box) return;
    box.innerHTML = '<div class="loading">Загрузка…</div>';
    try {
      const { players } = await API.get('/api/admin/players?q=' + encodeURIComponent(q));
      if (!players.length) { box.innerHTML = '<p class="muted center">Никого не найдено.</p>'; return; }
      box.innerHTML = `<div class="card adm-players-wrap" style="padding:0">
        <table class="adm-players" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="padding:8px;text-align:left">Игрок</th>
            <th style="padding:8px;text-align:right"><span class="ic-dollar"></span></th>
            <th style="padding:8px;text-align:right"><span class="ic-gold"></span></th>
            <th style="padding:8px;text-align:right">👂</th>
            <th style="padding:8px;text-align:right">🎖</th>
            <th style="padding:8px"></th>
          </tr></thead>
          <tbody>
          ${players.map(p => `
            <tr style="border-bottom:1px solid var(--border-dim);${!p.online?'opacity:.65':''}">
              <td class="adm-p-name" style="padding:8px">
                <span style="font-weight:bold">${p.flag} ${UI.esc(p.name)}</span>
                ${p.isAdmin ? ' <span class="badge">admin</span>' : ''}
                ${p.banned ? ' <span class="badge" style="background:var(--red)">🚫 бан</span>' : ''}
                ${p.online ? ' <span style="color:var(--green);font-size:10px">● онлайн</span>' : ''}
                <br><span class="muted small">Ур.${p.level} · ID: ${p.id}</span>
              </td>
              <td class="adm-stat" data-l="💵" style="padding:8px;text-align:right;font-size:12px">${UI.fmtMoney(p.dollars)}</td>
              <td class="adm-stat" data-l="🪙" style="padding:8px;text-align:right;font-size:12px">${UI.fmtNum(p.gold)}</td>
              <td class="adm-stat" data-l="👂" style="padding:8px;text-align:right;font-size:12px">${p.earsCurrent ?? p.ears}</td>
              <td class="adm-stat" data-l="🎖" style="padding:8px;text-align:right;font-size:12px">${p.tokens}</td>
              <td class="adm-acts" style="padding:8px;white-space:nowrap">
                <button class="btn btn-inline" data-view="${p.id}" title="Досье игрока">👁</button>
                ${Admin.can('economy') ? `<button class="btn btn-orange btn-inline" data-pick="${p.id}">Выдать</button>` : ''}
                <button class="btn btn-inline" data-log="${p.id}" data-log-name="${UI.esc(p.name)}">📋</button>
                ${(!p.isAdmin && Admin.can('moderation')) ? `<button class="btn btn-inline" data-ban="${p.id}" data-banned="${p.banned ? '1' : '0'}" data-name="${UI.esc(p.name)}">${p.banned ? '✅ разбан' : '🚫 бан'}</button>` : ''}
                ${(!p.isAdmin && Admin.can('security')) ? `<button class="btn btn-inline" data-reset="${p.id}" data-name="${UI.esc(p.name)}" style="color:var(--red)">♻️ обнулить</button>` : ''}
              </td>
            </tr>
            <tr class="grant-row" id="grant-row-${p.id}" style="display:none">
              <td colspan="6" class="grant-cell"></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

      box.querySelectorAll('[data-view]').forEach(btn => {
        btn.onclick = () => Admin.showPlayerDetail(btn.dataset.view);
      });
      box.querySelectorAll('[data-pick]').forEach(btn => {
        const p = players.find(x => x.id === btn.dataset.pick);
        // Форма раскрывается прямо под строкой игрока: раньше она
        // рисовалась в конце страницы, и приходилось листать вниз,
        // теряя из виду, кому именно выдаёшь
        btn.onclick = () => Admin.toggleGrantRow(p, btn);
      });
      box.querySelectorAll('[data-log]').forEach(btn => {
        btn.onclick = () => {
          Admin.tab = 'logs';
          Admin.renderTab();
          // После рендера вставить userId
          setTimeout(() => {
            const el = document.getElementById('log-uid');
            if (el) { el.value = btn.dataset.log; Admin.loadLogs(); }
          }, 50);
        };
      });
      box.querySelectorAll('[data-ban]').forEach(btn => {
        btn.onclick = async () => {
          const isBanned = btn.dataset.banned === '1';
          const name = btn.dataset.name;
          if (isBanned) {
            if (!confirm(`Разбанить игрока «${name}»?`)) return;
            try { await API.post('/api/admin/ban', { userId: btn.dataset.ban, banned: false }); Admin.loadPlayers(); }
            catch (e) { UI.toast('⛔ ' + e.message); }
          } else {
            // Срок бана: от 1 минуты до бессрочного. Короткие баны нужны
            // для остывания, а не только для тяжёлых нарушений.
            const opts = [
              { m: 1, t: '1 минута' }, { m: 15, t: '15 минут' }, { m: 60, t: '1 час' },
              { m: 360, t: '6 часов' }, { m: 1440, t: '1 сутки' }, { m: 4320, t: '3 суток' },
              { m: 10080, t: '7 суток' }, { m: 43200, t: '30 суток' }, { m: 0, t: 'Бессрочно' },
            ];
            Admin._banMinutes = 1440;
            const body = `
              <div class="ban-dialog">
                <div class="ban-target">Игрок: <b>${UI.esc(name)}</b></div>
                <div class="ban-label">Срок блокировки аккаунта</div>
                <div class="ban-grid" id="adm-ban-durations">
                  ${opts.map((o) => `<button class="ban-opt${o.m === 1440 ? ' active' : ''}" data-min="${o.m}">${o.t}</button>`).join('')}
                </div>
                <div class="ban-label">Причина (видна игроку)</div>
                <input type="text" id="adm-ban-reason" class="field" maxlength="200" value="Нарушение правил">
              </div>`;
            const dlg = UI.confirm(body, {
              title: 'Блокировка аккаунта', icon: '🚫', html: true,
              okText: 'Заблокировать', cancelText: 'Отмена', danger: true,
            });
            requestAnimationFrame(() => {
              const root = document.querySelector('.ban-dialog');
              if (!root) return;
              root.querySelectorAll('[data-min]').forEach((b) => {
                b.onclick = () => {
                  root.querySelectorAll('[data-min]').forEach((x) => x.classList.remove('active'));
                  b.classList.add('active');
                  Admin._banMinutes = Number(b.dataset.min);
                };
              });
              // Причину запоминаем на лету: разметка окна исчезает вместе с ним
              const ri = root.querySelector('#adm-ban-reason');
              Admin._lastBanReason = ri ? ri.value : 'Нарушение правил';
              if (ri) ri.oninput = () => { Admin._lastBanReason = ri.value; };
            });
            const okBan = await dlg;
            if (!okBan) return;
            const reasonInput = document.getElementById('adm-ban-reason');
            const reason = (Admin._lastBanReason || 'Нарушение правил');
            try {
              await API.post('/api/admin/ban', {
                userId: btn.dataset.ban, banned: true,
                reason, minutes: Admin._banMinutes,
              });
              UI.toast(Admin._banMinutes ? '🚫 Аккаунт заблокирован' : '🚫 Заблокирован бессрочно');
              Admin.loadPlayers();
            } catch (e) { UI.toast('⛔ ' + e.message); }
          }
        };
      });
      box.querySelectorAll('[data-reset]').forEach(btn => {
        btn.onclick = async () => {
          const name = btn.dataset.name;
          if (!confirm(`⚠️ ОБНУЛИТЬ аккаунт «${name}»?\n\nВсе характеристики, техника, постройки, прогресс будут сброшены к началу игры. Учётные данные (логин/пароль) сохранятся. Действие необратимо!`)) return;
          if (!confirm(`Точно обнулить «${name}»? Это нельзя отменить.`)) return;
          try {
            await API.post('/api/admin/reset', { userId: btn.dataset.reset });
            UI.toast(`♻️ Аккаунт «${name}» обнулён`);
            Admin.loadPlayers();
          } catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });
    } catch(e) {
      box.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
    }
  },

  // ── Досье игрока: полный снимок характеристик и имущества (только чтение) ──
  async showPlayerDetail(id) {
    const old = document.getElementById('pd-modal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'pd-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10004;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.innerHTML = `<div style="background:var(--card);border:2px solid var(--orange);border-radius:14px;max-width:520px;width:100%;padding:18px;margin:auto"><div class="loading">Загрузка досье…</div></div>`;
    document.body.appendChild(m);
    const inner = m.firstElementChild;

    let s;
    try {
      s = await API.get('/api/admin/player-snapshot/' + encodeURIComponent(id));
    } catch (e) {
      inner.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>
        <button class="btn btn-orange mt" style="width:100%" onclick="document.getElementById('pd-modal').remove()">Закрыть</button>`;
      return;
    }

    const fmtDate = (ts) => { try { return new Date(ts).toLocaleString('ru-RU'); } catch (e) { return '—'; } };
    const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    const section = (title, body) => `<hr class="hr"><div class="name" style="font-size:14px;margin-bottom:6px">${title}</div>${body}`;
    const listOrEmpty = (arr, fn) => arr && arr.length ? arr.map(fn).join('') : '<p class="muted small">— пусто —</p>';

    // Основное
    const mainHtml =
      kv('ID', `<span class="muted small">${UI.esc(s.main.id)}</span>`) +
      kv('Страна', UI.esc(s.main.country)) +
      kv('Уровень / XP', `${s.main.level} · ${UI.fmtNum(s.main.xp)}/${UI.fmtNum(s.main.xpNext)}`) +
      kv('Звание', UI.esc(s.main.rank)) +
      kv('Рейтинг', UI.fmtNum(s.main.rating)) +
      (s.main.status ? kv('Статус', UI.esc(s.main.status)) : '') +
      kv('Регистрация', `<span class="small">${fmtDate(s.main.createdAt)}</span>`) +
      kv('Был в сети', `<span class="small">${s.main.online ? '<span style="color:var(--green)">● сейчас</span>' : fmtDate(s.main.lastSeen)}</span>`) +
      (s.main.banned ? kv('🚫 Бан', UI.esc(s.main.banReason || 'без причины')) : '');

    // Ресурсы
    const r = s.resources;
    const resHtml =
      kv('<span class="ic-dollar"></span> Доллары', UI.fmtMoney(r.dollars)) +
      kv('<span class="ic-gold"></span> Золото', UI.fmtNum(r.gold)) +
      kv('🏦 Банк', UI.fmtMoney(r.bank)) +
      kv('🎫 Жетоны помилования', UI.fmtNum(r.tokens)) +
      kv('📈 Очки навыков', UI.fmtNum(r.skillPoints)) +
      kv('👂 Уши (трофейные)', UI.fmtNum(r.earsTrophy)) +
      kv('👂 Свои уши', `${r.earsCurrent}/${r.earsMax}`) +
      kv('💣 Мины (растяжки)', UI.fmtNum(r.landmines)) +
      kv('❤️ Здоровье', `${UI.fmtNum(r.hp.cur)}/${UI.fmtNum(r.hp.max)}`) +
      kv('⚡ Энергия', `${UI.fmtNum(r.en.cur)}/${UI.fmtNum(r.en.max)}`) +
      kv('🔫 Боеприпасы', `${UI.fmtNum(r.am.cur)}/${UI.fmtNum(r.am.max)}`);

    // Навыки
    const skillsHtml = s.skills.map(sk => kv(sk.name, `ур. ${sk.level}`)).join('');

    // Мощь + бой
    const b = s.battle;
    const powerHtml =
      kv('⚔ Атака', UI.fmtNum(s.power.atk)) +
      kv('🛡 Защита', UI.fmtNum(s.power.def)) +
      kv('🎒 Вместимость армии', UI.fmtNum(s.power.capacity)) +
      kv('🚜 Всего техники', UI.fmtNum(s.power.armyTotal)) +
      kv('Бои (атак/побед/пораж.)', `${b.attacks} / ${b.wins} / ${b.losses}`) +
      kv('Защита (побед/пораж.)', `${b.defWins} / ${b.defLosses}`) +
      kv('☠️ Фаталити', UI.fmtNum(b.fatalities));

    // Армия
    const armyHtml = listOrEmpty(s.army, x =>
      kv(`${UI.esc(x.name)} <span class="muted small">(${UI.esc(x.type)})</span>`, `×${UI.fmtNum(x.count)}`));

    // Постройки
    const buildHtml = listOrEmpty(s.buildings, x =>
      kv(UI.esc(x.name), `×${UI.fmtNum(x.count)}`));

    // Секретки
    const secretHtml = listOrEmpty(s.secretDevs, x =>
      kv(UI.esc(x.name), `×${UI.fmtNum(x.count)}`));

    // Трофеи
    const trophyHtml = listOrEmpty(s.trophies, x =>
      kv(UI.esc(x.name), `ур. ${x.level}/${x.maxLevel}`));

    // Диверсанты
    const sabHtml = s.saboteurs.types.map(x =>
      kv(x.name, `${UI.fmtNum(x.count)} <span class="muted small">(работает ${UI.fmtNum(x.active)}/${UI.fmtNum(x.limit)})</span>`)).join('') +
      kv('💀 Смертники', `${s.saboteurs.suicide}/${s.saboteurs.suicideLimit}`);

    // Группы + прочее
    const groupHtml =
      kv('🤝 Личный альянс', `${s.allianceMembers} чел.`) +
      kv('🎖 Легион', s.legion ? `${UI.esc(s.legion.name)} <span class="muted small">(${s.legion.rankName}, ${s.legion.members} чел.)</span>` : '—') +
      kv('🚀 Ракетные шахты', UI.fmtNum(s.silos)) +
      kv('🔥 Серия входов', UI.fmtNum(s.extra.loginStreak)) +
      kv('👥 Рефералов', UI.fmtNum(s.extra.refCount)) +
      kv('🏆 Рейтинг сезона', UI.fmtNum(s.extra.seasonRating));

    inner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:18px;font-weight:bold">${s.main.flag} ${UI.esc(s.main.name)}${s.main.isAdmin ? ' <span class="badge">admin</span>' : ''}</div>
        <button class="btn btn-inline" onclick="document.getElementById('pd-modal').remove()">✖</button>
      </div>
      ${mainHtml}
      ${section('💰 Ресурсы', resHtml)}
      ${section('📈 Навыки', skillsHtml)}
      ${section('⚔ Мощь и бои', powerHtml)}
      ${section('🚜 Техника', armyHtml)}
      ${section('🏛 Постройки', buildHtml)}
      ${section('🛸 Секретные разработки', secretHtml)}
      ${section('🏆 Трофеи', trophyHtml)}
      ${section('🥷 Диверсанты', sabHtml)}
      ${section('👥 Группы и прочее', groupHtml)}
      <button class="btn btn-orange mt" style="width:100%" onclick="document.getElementById('pd-modal').remove()">Закрыть</button>`;
  },

  // ── Вкладка «Легионы»: ресурсы, уровень, слава, постройки ──
  async renderLegions(c) {
    c.innerHTML = '<p class="muted center">Загрузка…</p>';
    let data;
    try { data = await API.get('/api/admin/groups/legion'); }
    catch (e) { c.innerHTML = '<p class="muted center">Ошибка загрузки легионов.</p>'; return; }
    const legions = (data.groups || []);

    // Если выбран конкретный легион — показываем редактор
    if (Admin._legEdit) {
      return Admin._renderLegionEditor(c, Admin._legEdit);
    }

    if (!legions.length) {
      c.innerHTML = '<div class="card"><p class="muted center">Легионов пока нет.</p></div>';
      return;
    }
    c.innerHTML = `
      <div class="card">
        <div class="name">🎖 Управление легионами</div>
        <p class="muted small">Выберите легион, чтобы изменить уровень, славу (⭐), ресурсы, рейтинг и постройки.</p>
      </div>
      ${legions.map(l => `
        <div class="card leg-pick" data-leg="${l.id}" style="cursor:pointer">
          <div class="kv"><span class="k"><b>${UI.esc(l.name)}</b></span><span class="v small muted">${l.members} чел.${l.hasActiveBattle ? ' · ⚔️ бой' : ''}</span></div>
          <div class="muted small">Лидер: ${UI.esc(l.leaderName || '—')}</div>
        </div>`).join('')}`;

    c.querySelectorAll('[data-leg]').forEach(el => {
      el.onclick = () => { Admin._legEdit = el.dataset.leg; Admin.renderLegions(c); };
    });
  },

  async _renderLegionEditor(c, legionId) {
    c.innerHTML = '<p class="muted center">Загрузка…</p>';
    let s;
    try { s = await API.get('/api/admin/legion/' + legionId + '/state'); }
    catch (e) { c.innerHTML = `<p class="muted center">Не удалось загрузить легион. <a href="#" id="leg-back">Назад</a></p>`;
      const b = document.getElementById('leg-back'); if (b) b.onclick = (ev) => { ev.preventDefault(); Admin._legEdit = null; Admin.renderLegions(c); };
      return; }

    const numField = (id, label, val, hint) => `
      <div style="margin-bottom:8px">
        <label style="font-size:11px;color:var(--dim)">${label}${hint ? ` <span class="muted">${hint}</span>` : ''}</label>
        <input type="number" id="leg-${id}" value="${val}" min="0" style="width:100%">
      </div>`;

    c.innerHTML = `
      <div class="card">
        <div class="kv"><span class="k"><b>${UI.esc(s.name)}</b></span>
          <span class="v"><button class="btn btn-inline" id="leg-back">← К списку</button></span></div>
      </div>

      <div class="card">
        <div class="name">⭐ Уровень и слава</div>
        ${numField('level', 'Уровень легиона', s.legionLevel, `(1…${s.maxLevel})`)}
        ${numField('gloryPoints', 'Слава — баланс ⭐', s.gloryPoints)}
        ${numField('gloryEarned', 'Слава — заработано ⭐', s.gloryEarned, '(определяет уровень)')}
        ${numField('ratingPoints', 'Рейтинг клана (очки)', s.ratingPoints)}
      </div>

      <div class="card">
        <div class="name">💰 Ресурсы казны</div>
        ${numField('reserves', 'Резервы (РЕЗ)', s.reserves)}
        ${numField('ears', 'Уши', s.treasuryEars)}
        ${numField('tokens', 'Жетоны', s.treasuryTokens)}
      </div>

      <div class="card">
        <div class="name">🏗 Боевые постройки</div>
        <p class="muted small">Уровень 0 — постройка отсутствует.</p>
        ${s.battleBuildings.map(b => `
          <div style="margin-bottom:8px">
            <label style="font-size:11px;color:var(--dim)">${UI.esc(b.name)} <span class="muted">(0…${b.maxLevel})</span></label>
            <input type="number" class="leg-bld" data-bld="${b.id}" value="${b.level}" min="0" max="${b.maxLevel}" style="width:100%">
          </div>`).join('')}
      </div>

      <div class="card">
        <button class="btn btn-orange" style="width:100%" id="leg-save">💾 Сохранить изменения</button>
        <p class="muted small mt center">Пустые поля не меняются. Значения задаются абсолютно.</p>
      </div>`;

    document.getElementById('leg-back').onclick = () => { Admin._legEdit = null; Admin.renderLegions(c); };

    document.getElementById('leg-save').onclick = async () => {
      const g = (id) => { const el = document.getElementById('leg-' + id); return el ? el.value : ''; };
      const battleBuildings = {};
      c.querySelectorAll('.leg-bld').forEach(el => { battleBuildings[el.dataset.bld] = el.value; });
      const patch = {
        level: g('level'), gloryPoints: g('gloryPoints'), gloryEarned: g('gloryEarned'),
        ratingPoints: g('ratingPoints'), reserves: g('reserves'), ears: g('ears'), tokens: g('tokens'),
        battleBuildings,
      };
      try {
        await API.post('/api/admin/legion/set', { legionId, patch });
        UI.toast('✅ Легион обновлён');
        Admin._renderLegionEditor(c, legionId);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  },

  // ── Вкладка «Наёмники»: выдача в обход аукциона ──
  async renderMercs(c) {
    c.innerHTML = '<p class="muted center">Загрузка…</p>';
    let d, h;
    try {
      d = await API.get('/api/admin/merc/list');
      h = await API.get('/api/admin/merc/holders');
    } catch (e) { c.innerHTML = '<p class="muted center">Ошибка загрузки наёмников.</p>'; return; }

    c.innerHTML = `
      <div class="card">
        <div class="name">🥷 Выдача наёмников</div>
        <p class="muted small">Выдаёт наёмника напрямую, <b>минуя аукцион</b>. Аукцион для игроков продолжает работать как обычно — ставки, лоты и победители не затрагиваются.</p>
        <p class="muted small">Количество = число суток аренды (1 шт. = ${d.rentHours} ч). Если наёмник уже активен — срок продлевается.</p>
      </div>

      <div class="card">
        <div style="margin-bottom:8px">
          <label style="font-size:11px;color:var(--dim)">Игрок (позывной)</label>
          <input type="text" id="mg-name" placeholder="позывной игрока">
        </div>
        <div style="margin-bottom:8px">
          <label style="font-size:11px;color:var(--dim)">Наёмник</label>
          <select id="mg-merc" style="width:100%">
            ${(d.commanders || []).map(m => `<option value="${m.id}">${UI.esc(m.name)} — ${UI.esc(m.effectType)}${m.effectValue ? ' ' + m.effectValue : ''}</option>`).join('')}
          </select>
        </div>
        <div style="margin-bottom:8px">
          <label style="font-size:11px;color:var(--dim)">Количество (шт. × ${d.rentHours} ч)</label>
          <input type="number" id="mg-count" value="1" min="1">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-orange" id="mg-give" style="flex:1">🎖 Выдать</button>
          <button class="btn btn-red" id="mg-revoke" style="flex:1">🚫 Отозвать</button>
        </div>
      </div>

      <div class="card">
        <div class="name" style="font-size:14px">Действующие наёмники у игроков</div>
        ${(h.holders || []).length ? h.holders.map(x => `
          <div class="list-row">
            <div class="grow"><b>${UI.esc(x.name)}</b> — ${UI.esc(x.commanderName || x.commanderId)}</div>
            <span class="muted small">${x.hoursLeft} ч</span>
          </div>`).join('') : '<p class="muted small">Сейчас ни у кого нет активных наёмников.</p>'}
      </div>`;

    const send = async (url, okMsg) => {
      const name = (document.getElementById('mg-name') || {}).value || '';
      const commanderId = (document.getElementById('mg-merc') || {}).value;
      const count = (document.getElementById('mg-count') || {}).value || 1;
      if (!name.trim()) { UI.toast('⛔ Укажите позывной игрока'); return; }
      try {
        const r = await API.post(url, { name: name.trim(), commanderId, count });
        UI.toast(okMsg(r));
        Admin.renderMercs(c);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('mg-give').onclick = () =>
      send('/api/admin/merc/grant', (r) => `🎖 ${r.commanderName} → ${r.targetName} (${r.count} шт., ~${r.hours} ч)`);
    document.getElementById('mg-revoke').onclick = () =>
      send('/api/admin/merc/revoke', (r) => `🚫 Наёмник отозван у ${r.targetName}`);
  },

  // ── Вкладка «Турниры»: назначить бой между двумя легионами ──
  async renderTournament(c) {
    Admin._trnMode = Admin._trnMode || 'quick';
    c.innerHTML = '<p class="muted center">Загрузка…</p>';
    let legData, listData;
    try {
      legData = await API.get('/api/admin/tournaments/legions');
      listData = await API.get('/api/admin/tournaments');
    } catch (e) { c.innerHTML = '<p class="muted center">Ошибка загрузки: ' + UI.esc(e.message) + '</p>'; return; }
    const legions = (legData.legions || []);
    const withFighters = legions.filter(l => l.members > 0);
    const opt = (l) => `<option value="${l.id}">${UI.esc(l.name)} (${l.members} 👤)</option>`;
    const prizeFields = (pre) => `
      <div class="muted small mt">🏆 Приз чемпиону (каждому бойцу победившего легиона, письмом «Забрать»):</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px">
        <div><label style="font-size:11px;color:var(--dim)">🪙 Золото</label><input type="number" id="${pre}-pgold" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">💵 Доллары</label><input type="number" id="${pre}-pdollars" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">🎖 Жетоны</label><input type="number" id="${pre}-ptokens" placeholder="0"></div>
      </div>`;

    // Подвкладки режимов
    const modeBtn = (id, label) => `<button class="btn btn-inline ${Admin._trnMode===id?'btn-orange':''}" data-trn-mode="${id}">${label}</button>`;
    let form = '';
    if (Admin._trnMode === 'quick') {
      form = withFighters.length < 2
        ? '<div class="card center muted">Нужно минимум два легиона с бойцами.</div>'
        : `<div class="card">
            <div class="name">⚡ Быстрый бой (сейчас)</div>
            <p class="muted small">Назначить бой двух легионов немедленно. 10 минут на подготовку, как в обычном бою.</p>
            <label class="news-lbl mt">🅰️ Легион A</label>
            <select id="q-a" class="news-input">${withFighters.map(opt).join('')}</select>
            <label class="news-lbl mt">🅱️ Легион B</label>
            <select id="q-b" class="news-input">${withFighters.map(opt).join('')}</select>
            <button class="btn btn-orange mt" id="q-go" style="width:100%">⚔️ Начать бой</button>
          </div>`;
    } else if (Admin._trnMode === 'sched') {
      form = withFighters.length < 2
        ? '<div class="card center muted">Нужно минимум два легиона с бойцами.</div>'
        : `<div class="card">
            <div class="name">📅 Турнир по расписанию</div>
            <p class="muted small">Задайте матчи «легион vs легион» с временем. Система сама запустит каждый бой в назначенный срок.</p>
            <input type="text" id="s-name" placeholder="Название турнира" maxlength="80" style="width:100%;box-sizing:border-box;margin-top:6px">
            <div id="s-matches" style="margin-top:8px"></div>
            <button class="btn btn-inline mt" id="s-add">➕ Добавить матч</button>
            ${prizeFields('s')}
            <button class="btn btn-orange mt" id="s-go" style="width:100%">✅ Создать турнир</button>
          </div>`;
    } else {
      form = withFighters.length < 2
        ? '<div class="card center muted">Нужно минимум два легиона с бойцами.</div>'
        : `<div class="card">
            <div class="name">🏆 Автосетка (олимпийка)</div>
            <p class="muted small">Отметьте легионы. Система сама с равным интервалом запустит раунды и будет продвигать победителей, пока не останется чемпион.</p>
            <input type="text" id="b-name" placeholder="Название турнира" maxlength="80" style="width:100%;box-sizing:border-box;margin-top:6px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
              <div><label style="font-size:11px;color:var(--dim)">⏱ Интервал раундов (мин)</label><input type="number" id="b-interval" value="30" min="1"></div>
              <div><label style="font-size:11px;color:var(--dim)">🕐 Старт (пусто = сейчас)</label><input type="datetime-local" id="b-start"></div>
            </div>
            <div class="muted small mt">Участники:</div>
            <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px;margin-top:4px">
              ${withFighters.map(l => `<label style="display:flex;align-items:center;gap:8px;padding:4px 2px"><input type="checkbox" class="b-leg" value="${l.id}"> ${UI.esc(l.name)} <span class="muted small">(${l.members} 👤)</span></label>`).join('')}
            </div>
            ${prizeFields('b')}
            <button class="btn btn-orange mt" id="b-go" style="width:100%">🏆 Создать автотурнир</button>
          </div>`;
    }

    // Список турниров
    const statusBadge = (s) => s === 'running' ? '<span class="badge orange">идёт</span>'
      : s === 'finished' ? '<span class="badge green">завершён</span>' : '<span class="badge">отменён</span>';
    const typeLabel = (t) => t === 'bracket' ? '🏆 сетка' : '📅 расписание';
    const listHtml = (listData.tournaments || []).length
      ? listData.tournaments.map(t => `
        <div class="card">
          <div class="name" style="display:flex;justify-content:space-between;gap:8px">
            <span>${UI.esc(t.name)}</span> ${statusBadge(t.status)}
          </div>
          <div class="muted small mt">${typeLabel(t.type)}${t.type==='bracket'?` · ${t.participantCount} легионов · раундов: ${t.roundCount}`:` · матчей: ${t.matchCount}`}${t.championName?` · 🏆 ${UI.esc(t.championName)}`:''}</div>
          <div class="btn-row mt">
            <button class="btn btn-inline" data-trn-view="${t.id}">🔍 Подробнее</button>
            ${t.status==='running'?`<button class="btn btn-inline" data-trn-cancel="${t.id}" style="color:var(--red)">🚫 Отменить</button>`:''}
          </div>
          <div id="trn-detail-${t.id}"></div>
        </div>`).join('')
      : '<p class="muted center">Турниров пока нет.</p>';

    c.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${modeBtn('quick','⚡ Быстрый бой')}${modeBtn('sched','📅 Расписание')}${modeBtn('bracket','🏆 Автосетка')}
      </div>
      ${form}
      <div class="title" style="margin-top:14px">Турниры</div>
      ${listHtml}`;

    // Переключение режимов
    c.querySelectorAll('[data-trn-mode]').forEach(b => b.onclick = () => { Admin._trnMode = b.dataset.trnMode; Admin.renderTournament(c); });

    // Быстрый бой
    if (Admin._trnMode === 'quick' && withFighters.length >= 2) {
      const selB = document.getElementById('q-b'); if (selB) selB.selectedIndex = 1;
      document.getElementById('q-go').onclick = async () => {
        const a = document.getElementById('q-a').value, b = document.getElementById('q-b').value;
        if (a === b) { UI.toast('⛔ Выберите два разных легиона'); return; }
        try { await API.post('/api/admin/legion/battle', { legionAId: a, legionBId: b }); UI.toast('⚔️ Бой назначен'); Admin.renderTournament(c); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
    }

    // Расписание: динамические матчи
    if (Admin._trnMode === 'sched' && withFighters.length >= 2) {
      const box = document.getElementById('s-matches');
      const addRow = () => {
        const row = document.createElement('div');
        row.className = 'trn-match-row';
        row.style = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px';
        row.innerHTML = `
          <div><label style="font-size:10px;color:var(--dim)">A</label><select class="tm-a news-input">${withFighters.map(opt).join('')}</select></div>
          <div><label style="font-size:10px;color:var(--dim)">B</label><select class="tm-b news-input">${withFighters.map(opt).join('')}</select></div>
          <div><label style="font-size:10px;color:var(--dim)">Старт</label><input type="datetime-local" class="tm-t"></div>
          <button class="btn btn-inline tm-del" style="color:var(--red)">✕</button>`;
        box.appendChild(row);
        const sb = row.querySelector('.tm-b'); if (sb.options.length > 1) sb.selectedIndex = 1;
        row.querySelector('.tm-del').onclick = () => row.remove();
      };
      addRow();
      document.getElementById('s-add').onclick = addRow;
      document.getElementById('s-go').onclick = async () => {
        const iv = id => (document.getElementById(id) || {}).value || '';
        const matches = [];
        box.querySelectorAll('.trn-match-row').forEach(r => {
          const a = r.querySelector('.tm-a').value, b = r.querySelector('.tm-b').value, tv = r.querySelector('.tm-t').value;
          if (a && b && a !== b) matches.push({ legionAId: a, legionBId: b, startAt: tv ? new Date(tv).getTime() : Date.now() });
        });
        if (!matches.length) { UI.toast('⛔ Добавьте хотя бы один корректный матч'); return; }
        try {
          await API.post('/api/admin/tournaments/create', {
            type: 'scheduled', name: iv('s-name') || 'Турнир', matches,
            prizeGold: iv('s-pgold'), prizeDollars: iv('s-pdollars'), prizeTokens: iv('s-ptokens'),
          });
          UI.toast('✅ Турнир создан'); Admin.renderTournament(c);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    }

    // Автосетка
    if (Admin._trnMode === 'bracket' && withFighters.length >= 2) {
      document.getElementById('b-go').onclick = async () => {
        const iv = id => (document.getElementById(id) || {}).value || '';
        const legionIds = Array.from(c.querySelectorAll('.b-leg:checked')).map(x => x.value);
        if (legionIds.length < 2) { UI.toast('⛔ Отметьте минимум 2 легиона'); return; }
        const st = iv('b-start');
        try {
          await API.post('/api/admin/tournaments/create', {
            type: 'bracket', name: iv('b-name') || 'Автотурнир', legionIds,
            intervalMinutes: iv('b-interval') || 30, firstStartAt: st ? new Date(st).getTime() : Date.now(),
            prizeGold: iv('b-pgold'), prizeDollars: iv('b-pdollars'), prizeTokens: iv('b-ptokens'),
          });
          UI.toast('🏆 Автотурнир создан'); Admin.renderTournament(c);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    }

    // Список: отмена + подробности
    c.querySelectorAll('[data-trn-cancel]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('Отменить турнир? Идущие бои завершатся сами.', { title: 'Отмена турнира', okText: 'Отменить', danger: true })) return;
      try { await API.post('/api/admin/tournaments/' + b.dataset.trnCancel + '/cancel'); UI.toast('🚫 Отменён'); Admin.renderTournament(c); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    });
    c.querySelectorAll('[data-trn-view]').forEach(b => b.onclick = async () => {
      const box = document.getElementById('trn-detail-' + b.dataset.trnView);
      if (box.innerHTML) { box.innerHTML = ''; return; }
      try {
        const { tournament: t } = await API.get('/api/admin/tournaments/' + b.dataset.trnView);
        box.innerHTML = Admin._trnDetailHtml(t);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    });
  },

  // Разметка подробностей турнира (матчи/раунды)
  _trnDetailHtml(t) {
    const mStatus = (m) => m.status === 'done'
      ? (m.winnerName ? `✅ победитель: <b>${UI.esc(m.winnerName)}</b>${m.note==='walkover'?' (тех.)':m.note==='bye'?' (бай)':''}` : '⚪ без результата')
      : m.status === 'live' ? '⚔️ идёт бой' : '⏳ ожидает';
    const matchRow = (m) => `<div class="kv"><span class="k">${UI.esc(m.legionAName)} — ${m.legionBName ? UI.esc(m.legionBName) : '<i>бай</i>'}</span><span class="v small">${mStatus(m)}</span></div>`;
    if (t.type === 'scheduled') {
      return `<div class="card" style="margin-top:8px;background:rgba(255,255,255,.02)">${(t.matches || []).map(matchRow).join('')}</div>`;
    }
    return `<div class="card" style="margin-top:8px;background:rgba(255,255,255,.02)">
      ${(t.rounds || []).map(r => `<div class="muted small" style="margin-top:6px"><b>Раунд ${r.n}</b>${r.startedAt ? '' : ' (ожидает старта)'}</div>${r.matches.map(matchRow).join('')}`).join('')}
      ${t.championName ? `<div class="gold mt">🏆 Чемпион: <b>${UI.esc(t.championName)}</b></div>` : ''}
    </div>`;
  },

  // Раскрыть/свернуть форму выдачи под строкой игрока
  toggleGrantRow(p, btn) {
    const row = document.getElementById('grant-row-' + p.id);
    if (!row) return;
    const cell = row.querySelector('.grant-cell');
    const open = row.style.display !== 'none';
    // Закрываем все остальные — открытой всегда одна
    document.querySelectorAll('.grant-row').forEach((r) => {
      r.style.display = 'none';
      const c = r.querySelector('.grant-cell'); if (c) c.innerHTML = '';
    });
    document.querySelectorAll('[data-pick]').forEach((b) => b.classList.remove('btn-green'));
    if (open) return;
    row.style.display = '';
    if (btn) btn.classList.add('btn-green');
    Admin.renderGrantForm(p, cell);
  },

  renderGrantForm(p, target) {
    const box = target || document.getElementById('ad-grant-wrap');
    box.innerHTML = `
      <div class="grant-panel">
        <div class="grant-head">
          <b>🎁 ${p.flag} ${UI.esc(p.name)}</b>
          <span class="muted small">ур. ${p.level} · <span class="ic-dollar"></span>${UI.fmtMoney(p.dollars)} · 🪙 ${UI.fmtNum(p.gold)}</span>
          <button class="btn btn-inline" id="g-cancel" style="margin-left:auto">✕</button>
        </div>

        <div class="grant-grid">
          <label><span><span class="ic-dollar"></span> Доллары</span><input type="number" id="g-dollars" placeholder="0"></label>
          <label><span>🪙 Золото</span><input type="number" id="g-gold" placeholder="0"></label>
          <label><span>⭐ Опыт</span><input type="number" id="g-xp" placeholder="0"></label>
          <label><span>📈 Очки</span><input type="number" id="g-skill" placeholder="0"></label>
          <label><span>👂 Уши</span><input type="number" id="g-ears" placeholder="0"></label>
          <label><span>🎖 Жетоны</span><input type="number" id="g-tokens" placeholder="0"></label>
        </div>

        <div class="grant-quick">
          <span class="muted small">Быстро:</span>
          <button class="btn btn-inline" data-q="gold:100">🪙 100</button>
          <button class="btn btn-inline" data-q="gold:500">🪙 500</button>
          <button class="btn btn-inline" data-q="dollars:1000000">💵 1 млн</button>
          <button class="btn btn-inline" data-q="dollars:1000000000">💵 1 млрд</button>
          <button class="btn btn-inline" data-q="clear">Сброс</button>
        </div>

        <details class="grant-more">
          <summary>Ещё: уровень, ресурсы, банк</summary>
          <div class="grant-grid mt">
            <label><span>🎚 Уровень</span><input type="number" id="g-level" placeholder="—"></label>
            <label><span><span class="ic-energy"></span> Энергия</span><input type="number" id="g-energy" placeholder="—"></label>
            <label><span><span class="ic-health"></span> Здоровье</span><input type="number" id="g-health" placeholder="—"></label>
            <label><span><span class="ic-ammo"></span> Боеприпасы</span><input type="number" id="g-ammo" placeholder="—"></label>
            <label><span>🏦 Банк <span class="muted">(списание)</span></span><input type="number" id="g-bank" placeholder="0"></label>
          </div>
        </details>

        <input type="text" id="g-note" maxlength="300" class="mt" placeholder="Сообщение игроку (необязательно)" style="width:100%;box-sizing:border-box">

        <div class="grant-btns">
          <button class="btn btn-orange btn-inline" id="g-go">✅ Выдать</button>
          <button class="btn btn-red btn-inline" id="g-take">➖ Забрать</button>
          <button class="btn btn-inline" id="g-rw-toggle" style="border-color:var(--gold);color:var(--gold)">🎁 Письмом</button>
        </div>

        <div id="g-rw-box" class="grant-reward" style="display:none">
          <p class="muted small">Игрок заберёт награду сам — на главном экране или в почте.</p>
          <input type="text" id="g-rw-title" placeholder="Заголовок письма" maxlength="120">
          <input type="text" id="g-rw-reason" placeholder="За что награда" maxlength="300" class="mt">
          <button class="btn mt" id="g-rw-go" style="width:100%;border-color:var(--gold);color:var(--gold)">Отправить наградой</button>
        </div>
      </div>`;

    // Быстрые суммы: чаще всего выдают круглые значения
    box.querySelectorAll('[data-q]').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.q;
        if (v === 'clear') {
          ['g-dollars','g-gold','g-xp','g-skill','g-ears','g-tokens'].forEach((id) => {
            const el = document.getElementById(id); if (el) el.value = '';
          });
          return;
        }
        const [field, amount] = v.split(':');
        const el = document.getElementById('g-' + field);
        if (el) el.value = String((Number(el.value) || 0) + Number(amount));
      };
    });
    const rwToggle = document.getElementById('g-rw-toggle');
    if (rwToggle) rwToggle.onclick = () => {
      const rb = document.getElementById('g-rw-box');
      rb.style.display = rb.style.display === 'none' ? '' : 'none';
    };
    document.getElementById('g-cancel').onclick = () => {
      box.innerHTML = '';
      const row = box.closest('.grant-row');
      if (row) row.style.display = 'none';
      document.querySelectorAll('[data-pick]').forEach((b) => b.classList.remove('btn-green'));
    };
    const gv = id => (document.getElementById(id) || {}).value || '';
    document.getElementById('g-rw-go').onclick = async () => {
      try {
        await API.post('/api/admin/rewards/grant', {
          userId: p.id,
          title: gv('g-rw-title'), reason: gv('g-rw-reason'),
          dollars: gv('g-dollars'), gold: gv('g-gold'), xp: gv('g-xp'),
          skillPoints: gv('g-skill'), ears: gv('g-ears'), tokens: gv('g-tokens'),
        });
        UI.toast(`🎁 Награда-письмо отправлена игроку ${p.name}`);
        box.innerHTML = '';
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('g-go').onclick = async () => {
      const v = id => (document.getElementById(id) || {}).value || '';
      try {
        await API.post('/api/admin/grant', {
          userId: p.id,
          dollars: v('g-dollars'), gold: v('g-gold'), xp: v('g-xp'),
          skillPoints: v('g-skill'), ears: v('g-ears'), tokens: v('g-tokens'),
          setLevel: v('g-level'), energy: v('g-energy'), health: v('g-health'), ammo: v('g-ammo'),
          giftNote: v('g-note'),
        });
        UI.toast(`✅ Выдано игроку ${p.name}`);
        box.innerHTML = '';
        Admin.loadPlayers();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
    // Списание ресурсов (значения в полях = сколько ЗАБРАТЬ, включая банк)
    document.getElementById('g-take').onclick = async () => {
      const v = id => (document.getElementById(id) || {}).value || '';
      const fields = ['g-dollars','g-gold','g-xp','g-skill','g-ears','g-tokens','g-bank'];
      if (!fields.some(f => parseInt(v(f)) > 0)) { UI.toast('⛔ Укажите, сколько забрать'); return; }
      if (!await UI.confirm(`Списать указанные ресурсы у игрока ${UI.esc(p.name)}?<br><span class="muted small">Значения в полях = сколько забрать. Ниже нуля не уйдёт.</span>`, // html:true ниже
        { title: 'Списание ресурсов', icon: '➖', okText: 'Забрать', danger: true, html: true })) return;
      try {
        await API.post('/api/admin/take', {
          userId: p.id,
          dollars: v('g-dollars'), gold: v('g-gold'), xp: v('g-xp'),
          skillPoints: v('g-skill'), ears: v('g-ears'), tokens: v('g-tokens'),
          bank: v('g-bank'), giftNote: v('g-note'),
        });
        UI.toast(`➖ Списано у игрока ${p.name}`);
        box.innerHTML = '';
        Admin.loadPlayers();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
  },

  async submitGrantAll() {
    const vals = Admin._grantVals('all');
    const hasAny = ['dollars','gold','xp','skillPoints','ears','tokens'].some(k => parseInt(vals[k]) !== 0 && vals[k] !== '');
    if (!hasAny) { UI.toast('⛔ Укажите хотя бы один ресурс'); return; }
    if (!await UI.confirm('Выдать ресурсы ВСЕМ игрокам?', {title:'Массовая выдача', icon:'🎁', okText:'Выдать', danger:true})) return;
    try {
      const r = await API.post('/api/admin/grant-all', vals);
      UI.toast(`✅ Выдано ${r.count} игрокам!`);
    } catch(e) { UI.toast('⛔ ' + e.message); }
  },

  // ── Вкладка: Журнал ─────────────────────────────────────────────
  // ── Окно ответов на обращения игроков ──
  async renderSupport(c) {
    Admin._supStatus = Admin._supStatus || 'open';
    Admin._supCat = Admin._supCat || 'all';
    c.innerHTML = '<div class="loading">Загрузка…</div>';
    let data;
    try {
      data = await API.get('/api/admin/support?status=' + Admin._supStatus + '&category=' + Admin._supCat);
    } catch (e) {
      c.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
      return;
    }
    const cats = data.categories || [];
    const byCat = data.byCategory || {};
    const totalOpen = Object.values(byCat).reduce((a, b) => a + b, 0);

    // Строка фильтра по статусу
    const statusRow = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn btn-inline ${Admin._supStatus==='open'?'btn-orange':''}" data-sup-f="open">Открытые</button>
        <button class="btn btn-inline ${Admin._supStatus==='answered'?'btn-orange':''}" data-sup-f="answered">Отвеченные</button>
        <button class="btn btn-inline ${Admin._supStatus==='closed'?'btn-orange':''}" data-sup-f="closed">Закрытые</button>
        <button class="btn btn-inline ${Admin._supStatus==='all'?'btn-orange':''}" data-sup-f="all">Все</button>
      </div>`;
    // Подразделы по темам (со счётчиками открытых)
    const catRow = `
      <div class="muted small" style="margin:2px 0 4px">Подразделы по темам:</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-inline ${Admin._supCat==='all'?'btn-orange':''}" data-sup-cat="all">📋 Все${totalOpen?` (${totalOpen})`:''}</button>
        ${cats.map(cat => `<button class="btn btn-inline ${Admin._supCat===cat.id?'btn-orange':''}" data-sup-cat="${cat.id}">${cat.icon} ${UI.esc(cat.label)}${byCat[cat.id]?` (${byCat[cat.id]})`:''}</button>`).join('')}
      </div>`;

    const listHtml = !data.tickets.length
      ? '<p class="muted center">Обращений нет.</p>'
      : data.tickets.map(t => `
        <div class="card">
          <div class="name" style="display:flex;justify-content:space-between;gap:8px">
            <span>${UI.esc(t.subject)}</span>
            <span class="muted small">${UI.esc(t.userName)} · ${t.status}</span>
          </div>
          <div class="muted small" style="margin-top:2px">Тема: ${UI.esc(t.categoryLabel || 'Другое')}</div>
          <div class="sup-owner mt">
            ${t.free
              ? '<span class="sup-tag sup-free">свободно</span>'
              : (t.mine
                  ? '<span class="sup-tag sup-mine">у вас в работе</span>'
                  : `<span class="sup-tag sup-taken">в работе: ${UI.esc(t.assignedName)}</span>`)}
            ${t.free ? `<button class="btn btn-inline" data-claim="${t.id}">📌 Взять в работу</button>` : ''}
            ${(t.mine || Admin.me && Admin.me.staffRole === 'owner') && !t.free
              ? `<button class="btn btn-inline" data-release="${t.id}">↩ Вернуть в очередь</button>` : ''}
          </div>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
            ${t.messages.map(m => `
              <div style="padding:7px 9px;border-radius:8px;background:${m.from==='admin'?'rgba(60,180,90,.1)':'rgba(255,255,255,.03)'};border:1px solid ${m.from==='admin'?'var(--green)':'var(--border)'}">
                <div class="muted small">${m.from==='admin'?'🛟 '+UI.esc(m.authorName):'👤 '+UI.esc(m.authorName)} · ${new Date(m.at).toLocaleString('ru-RU')}</div>
                <div style="margin-top:2px;white-space:pre-wrap">${UI.esc(m.text)}</div>
              </div>`).join('')}
          </div>
          ${t.status !== 'closed'
            ? ((t.mine || t.free || (Admin.me && Admin.me.staffRole === 'owner'))
              ? `<textarea id="ans-${t.id}" rows="2" placeholder="${t.free ? 'Ответ игроку (обращение закрепится за вами)…' : 'Ответ игроку…'}" style="width:100%;box-sizing:border-box;margin-top:8px"></textarea>
                 <div style="display:flex;gap:8px;margin-top:6px">
                   <button class="btn btn-orange btn-inline" data-ans="${t.id}">Ответить</button>
                   <button class="btn btn-inline" data-ans-close="${t.id}">Ответить и закрыть</button>
                 </div>`
              : '<p class="muted small mt">Обращением занимается другой сотрудник.</p>')
            : '<p class="muted small mt">Обращение закрыто.</p>'}
        </div>`).join('');

    c.innerHTML = statusRow + catRow + `<div id="sup-list">${listHtml}</div>`;

    c.querySelectorAll('[data-claim]').forEach(b => {
      b.onclick = async () => {
        try { await API.post('/api/admin/support/claim', { ticketId: b.dataset.claim }); UI.toast('📌 Взято в работу'); Admin.renderSupport(c); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
    c.querySelectorAll('[data-release]').forEach(b => {
      b.onclick = async () => {
        try { await API.post('/api/admin/support/release', { ticketId: b.dataset.release }); UI.toast('↩️ Возвращено в очередь'); Admin.renderSupport(c); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
    c.querySelectorAll('[data-sup-f]').forEach(b => {
      b.onclick = () => { Admin._supStatus = b.dataset.supF; Admin.renderSupport(c); };
    });
    c.querySelectorAll('[data-sup-cat]').forEach(b => {
      b.onclick = () => { Admin._supCat = b.dataset.supCat; Admin.renderSupport(c); };
    });
    c.querySelectorAll('[data-ans]').forEach(btn => {
      btn.onclick = async () => {
        const txt = (document.getElementById('ans-'+btn.dataset.ans)||{}).value||'';
        try { await API.post('/api/admin/support/reply', { ticketId: btn.dataset.ans, text: txt, close: false }); Admin.renderSupport(c); }
        catch(e){ UI.toast('⛔ '+e.message); }
      };
    });
    c.querySelectorAll('[data-ans-close]').forEach(btn => {
      btn.onclick = async () => {
        const txt = (document.getElementById('ans-'+btn.dataset.ansClose)||{}).value||'';
        try { await API.post('/api/admin/support/reply', { ticketId: btn.dataset.ansClose, text: txt, close: true }); Admin.renderSupport(c); }
        catch(e){ UI.toast('⛔ '+e.message); }
      };
    });
  },
  renderLogs(c) {
    c.innerHTML = `
      <div class="card">
        <div class="field-row">
          <input type="text" id="log-uid" placeholder="ID или имя игрока (пусто — все)" style="flex:1">
          <input type="number" id="log-limit" value="200" style="width:80px" min="10" max="1000">
          <button class="btn btn-orange btn-inline" id="log-load">Загрузить</button>
        </div>
        <div id="log-filters" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-inline active" data-filter="all">Все</button>
          <button class="btn btn-inline" data-filter="buy">🛒 Покупки</button>
          <button class="btn btn-inline" data-filter="battle">⚔️ Бои</button>
          <button class="btn btn-inline" data-filter="legion">🏛 Легион</button>
          <button class="btn btn-inline" data-filter="auth">🔑 Входы</button>
        </div>
      </div>
      <div id="ad-logs"><p class="muted center">Нажмите «Загрузить».</p></div>`;

    Admin._logFilter = 'all';
    document.getElementById('log-load').onclick = () => Admin.loadLogs();
    document.getElementById('log-filters').querySelectorAll('[data-filter]').forEach(btn => {
      btn.onclick = () => {
        Admin._logFilter = btn.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Admin.loadLogs();
      };
    });
  },

  async loadLogs() {
    const box = document.getElementById('ad-logs');
    if (!box) return;
    const uid   = (document.getElementById('log-uid') || {}).value?.trim() || '';
    const limit = (document.getElementById('log-limit') || {}).value || 200;
    box.innerHTML = '<div class="loading">Загрузка журнала…</div>';
    try {
      const { logs } = await API.get(`/api/admin/logs?limit=${limit}${uid ? '&userId=' + encodeURIComponent(uid) : ''}`);

      // Фильтрация по категории
      const filterFn = {
        all:    () => true,
        buy:    e => /\/(buy|build|container|bid|workshop|deposit|heal)/.test(e.path),
        battle: e => /\/(attack|fatality|war|battle)/.test(e.path),
        legion: e => /\/legion/.test(e.path),
        auth:   e => /\/(login|register)/.test(e.path),
      }[Admin._logFilter || 'all'];

      const filtered = logs.filter(filterFn || (() => true));

      if (!filtered.length) { box.innerHTML = '<p class="muted center">Записей нет.</p>'; return; }

      const fmtDate = ts => {
        const d = new Date(ts);
        return d.toLocaleDateString('ru', { day:'2-digit', month:'2-digit' }) + ' ' +
               d.toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      };

      const rowColor = e => {
        if (/\/(attack|fatality|war)/.test(e.path))  return '#ff4d4d22';
        if (/\/buy|\/build|\/container/.test(e.path)) return '#4dff9922';
        if (/\/legion/.test(e.path))                  return '#4d9fff22';
        if (/\/(login|register)/.test(e.path))        return '#ff9f4d22';
        return 'transparent';
      };
      const iconFor = e => {
        if (/\/(attack|fatality|war|battle)/.test(e.path)) return '⚔️';
        if (/\/buy/.test(e.path))  return '🛒';
        if (/\/build/.test(e.path)) return '🏗';
        if (/\/legion/.test(e.path)) return '🏛';
        if (/\/(login|register)/.test(e.path)) return '🔑';
        return '•';
      };

      box.innerHTML = `
        <div class="card adm-log-wrap" style="padding:0;overflow-x:auto">
          <div style="padding:8px 12px;color:var(--dim);font-size:12px">${filtered.length} записей</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="border-bottom:1px solid var(--border);background:var(--card)">
                <th style="padding:6px 10px;text-align:left;white-space:nowrap">Время</th>
                <th style="padding:6px 10px;text-align:left">Игрок</th>
                <th style="padding:6px 10px;text-align:left">Действие</th>
                <th style="padding:6px 10px;text-align:left;color:var(--dim)">Маршрут</th>
              </tr>
            </thead>
            <tbody>
            ${filtered.map(e => `
              <tr style="border-bottom:1px solid var(--border-dim);background:${rowColor(e)}">
                <td style="padding:5px 10px;white-space:nowrap;color:var(--dim)">${fmtDate(e.at)}</td>
                <td style="padding:5px 10px;white-space:nowrap">
                  <span style="cursor:pointer;font-weight:bold" onclick="(()=>{const el=document.getElementById('log-uid');if(el){el.value='${e.userId||''}';Admin.loadLogs();}})()">${UI.esc(e.userName||'—')}</span>
                </td>
                <td style="padding:5px 10px">${iconFor(e)} ${UI.esc(e.desc || e.path)}</td>
                <td style="padding:5px 10px;color:var(--dim);font-size:11px">${UI.esc(e.path)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch(e) {
      box.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
    }
  },

  // ── Вкладка: Скидки ─────────────────────────────────────────────
  renderDiscounts(c) {
    c.innerHTML = '<div class="loading">Загрузка скидок…</div>';
    Admin.loadDiscounts(c);
  },

  async loadDiscounts(c) {
    const box = c || document.getElementById('tab-content');
    try {
      const data = await API.get('/api/admin/discounts');
      const fmtExp = ts => {
        const sec = Math.max(0, Math.floor((ts - Date.now()) / 1000));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
      };
      const pending = data.scheduled.filter(s => s.pending);
      box.innerHTML = `
        <div class="card">
          <p class="muted small">Скидки применяются ко всем игрокам. Можно задать отложенный старт.</p>
          ${pending.length ? `<div class="mt"><b>⏳ Запланированные:</b> ${pending.map(s=>`${UI.esc(s.label)}: ${s.pct}% через ${fmtExp(s.startAt)}`).join(', ')}</div>` : ''}
        </div>
        ${data.categories.map(cat => {
          const active = data.active[cat.id];
          return `
          <div class="card">
            <div class="name">${UI.esc(cat.name)}</div>
            ${active
              ? `<p class="gold small mt">✅ Активно: ${active.pct}% · истекает через ${fmtExp(active.expires)}</p>`
              : '<p class="muted small mt">Нет активной скидки</p>'}
            <div class="field-row mt">
              <input type="number" min="0" max="99" placeholder="%" id="dc-pct-${cat.id}" style="width:70px">
              <input type="number" min="0" step="0.5" placeholder="часов" id="dc-hr-${cat.id}" style="width:80px">
              <input type="number" min="0" step="0.5" placeholder="старт через ч." id="dc-delay-${cat.id}" style="width:110px">
              <button class="btn btn-orange btn-inline" data-cat="${cat.id}">Применить</button>
              ${active ? `<button class="btn btn-red btn-inline" data-clear="${cat.id}">Снять</button>` : ''}
            </div>
          </div>`;
        }).join('')}`;

      box.querySelectorAll('[data-cat]').forEach(btn => {
        btn.onclick = async () => {
          const cat = btn.dataset.cat;
          try {
            await API.post('/api/admin/discount', {
              category: cat,
              pct:   document.getElementById('dc-pct-'+cat).value,
              hours: document.getElementById('dc-hr-'+cat).value,
              delayHours: document.getElementById('dc-delay-'+cat).value || 0,
            });
            Admin.loadDiscounts();
          } catch(e) { UI.toast('⛔ ' + e.message); }
        };
      });
      box.querySelectorAll('[data-clear]').forEach(btn => {
        btn.onclick = async () => {
          try { await API.post('/api/admin/discount', { category: btn.dataset.clear, pct: 0, hours: 0 }); Admin.loadDiscounts(); }
          catch(e) { UI.toast('⛔ ' + e.message); }
        };
      });
    } catch(e) {
      box.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
    }
  },

  // ── Вкладка: Глобальные бонусы ───────────────────────────────────
  renderBuffs(c) {
    c.innerHTML = '<div class="loading">Загрузка…</div>';
    Admin.loadBuffs(c);
  },

  async loadBuffs(c) {
    const box = c || document.getElementById('tab-content');
    try {
      const { active, keys } = await API.get('/api/admin/global-buffs');
      box.innerHTML = `
        <div class="card">
          <p class="muted small">Бонус действует на ВСЕХ игроков сразу.</p>
          ${active.length
            ? `<div class="mt"><b>Активные:</b></div>${active.map(a => `
               <div class="kv">
                 <span class="k">${UI.esc(a.label)}: +${a.pct}%</span>
                 <span class="v">${a.hoursLeft} ч. осталось <button class="btn btn-inline" data-clear-buff="${a.key}">Снять</button></span>
               </div>`).join('')}`
            : '<p class="muted small mt">Активных бонусов нет.</p>'}
        </div>
        ${keys.map(k => `
          <div class="card">
            <div class="name">${UI.esc(k.label)}</div>
            <div class="field-row mt">
              <input type="number" placeholder="%" id="gb-pct-${k.key}" style="width:80px">
              <input type="number" placeholder="часов" id="gb-hours-${k.key}" style="width:80px">
              <button class="btn btn-orange btn-inline" data-set-buff="${k.key}">Активировать</button>
            </div>
          </div>`).join('')}`;

      box.querySelectorAll('[data-set-buff]').forEach(btn => {
        btn.onclick = async () => {
          const key = btn.dataset.setBuff;
          try {
            await API.post('/api/admin/global-buff', {
              key, pct: document.getElementById('gb-pct-'+key).value,
              hours: document.getElementById('gb-hours-'+key).value,
            });
            Admin.loadBuffs();
          } catch(e) { UI.toast('⛔ ' + e.message); }
        };
      });
      box.querySelectorAll('[data-clear-buff]').forEach(btn => {
        btn.onclick = async () => {
          try { await API.post('/api/admin/global-buff', { key: btn.dataset.clearBuff, pct: 0, hours: 0 }); Admin.loadBuffs(); }
          catch(e) { UI.toast('⛔ ' + e.message); }
        };
      });
    } catch(e) {
      box.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
    }
  },
};
