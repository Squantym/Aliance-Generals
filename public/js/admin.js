// ===================================================================
// public/js/admin.js — Панель администратора «Генералов»
// ===================================================================

const Admin = {
  selected: null,
  tab: 'players',   // players | logs | discounts | buffs

  async init() {
    if (API.token()) {
      try {
        const me = await API.get('/api/me');
        if (me.isAdmin) return Admin.render();
        UI.toast('⛔ Эта учётная запись — не администратор');
      } catch(e) {}
    }
    Admin.renderLogin();
  },

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
        if (!r.isAdmin) return UI.toast('⛔ Нет прав администратора');
        API.setToken(r.token);
        Admin.render();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('ad-go').onclick = go;
    document.getElementById('ad-pass').onkeydown = e => { if(e.key==='Enter') go(); };
  },

  // ── Главный рендер с вкладками ──────────────────────────────────
  render() {
    const tabs = [
      { id:'players',   label:'👥 Игроки' },
      { id:'support',   label:'🛟 Поддержка' },
      { id:'logs',      label:'📋 Журнал' },
      { id:'discounts', label:'🏷 Скидки' },
      { id:'buffs',     label:'🎉 Бонусы' },
    ];
    document.getElementById('content').innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px 0;position:sticky;top:0;background:var(--bg);z-index:10;border-bottom:1px solid var(--border)">
        ${tabs.map(t=>`<button class="btn btn-inline ${Admin.tab===t.id?'btn-orange':''}" id="tab-${t.id}">${t.label}</button>`).join('')}
        <a href="/" class="btn btn-inline" style="margin-left:auto">← В игру</a>
      </div>
      <div id="tab-content" style="padding:8px 0"></div>`;

    tabs.forEach(t => {
      document.getElementById('tab-'+t.id).onclick = () => { Admin.tab = t.id; Admin.renderTab(); };
    });
    Admin.renderTab();
  },

  renderTab() {
    // Обновить активную кнопку
    ['players','logs','discounts','buffs'].forEach(id => {
      const btn = document.getElementById('tab-'+id);
      if (btn) btn.className = `btn btn-inline ${Admin.tab===id?'btn-orange':''}`;
    });
    const c = document.getElementById('tab-content');
    if (Admin.tab === 'players')   return Admin.renderPlayers(c);
    if (Admin.tab === 'support')   return Admin.renderSupport(c);
    if (Admin.tab === 'logs')      return Admin.renderLogs(c);
    if (Admin.tab === 'discounts') return Admin.renderDiscounts(c);
    if (Admin.tab === 'buffs')     return Admin.renderBuffs(c);
  },

  // ── Вкладка: Игроки ─────────────────────────────────────────────
  renderPlayers(c) {
    c.innerHTML = `
      <div class="card">
        <div class="field-row">
          <input type="text" id="ad-q" placeholder="Поиск по позывному…" style="flex:1">
          <button class="btn btn-orange btn-inline" id="ad-search">🔍 Найти</button>
        </div>
      </div>
      <div id="ad-list"><div class="loading">Загрузка…</div></div>
      <div id="ad-grant-wrap"></div>
      <div class="card" style="margin-top:16px">
        <div class="name">🌍 Выдать всем игрокам</div>
        <p class="muted small mt">Ресурсы получат сразу все зарегистрированные игроки.</p>
        ${Admin._grantFields('all')}
        <button class="btn btn-orange mt" id="grant-all-go" style="width:100%">💥 Выдать всем</button>
      </div>
      <div class="card" style="margin-top:16px;border-color:var(--red)">
        <div class="name">🧹 Очистка групп</div>
        <p class="muted small mt">Полностью стирает группы у ВСЕХ игроков — они создают заново. Необратимо!</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <button class="btn btn-inline" id="wipe-alliances">Обнулить все альянсы</button>
          <button class="btn btn-inline" id="wipe-legions">Удалить все легионы + логи боёв</button>
          <button class="btn btn-red" id="wipe-all">Стереть всё (альянсы + легионы)</button>
        </div>
      </div>
      <div class="card" style="margin-top:16px;border-color:var(--orange-1)">
        <div class="name">🐉 Мировое событие (босс)</div>
        <p class="muted small mt">Запустите PvE-босса для всех игроков. Они атакуют его раз в день, при победе получают награду.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label style="font-size:11px;color:var(--dim)">Название</label><input type="text" id="ev-name" placeholder="Вражеская армада"></div>
          <div><label style="font-size:11px;color:var(--dim)">❤️ Здоровье</label><input type="number" id="ev-hp" placeholder="100000"></div>
          <div><label style="font-size:11px;color:var(--dim)">🛡 Защита</label><input type="number" id="ev-def" placeholder="1000"></div>
          <div><label style="font-size:11px;color:var(--dim)">🪙 Награда золото (победа)</label><input type="number" id="ev-gold" placeholder="50"></div>
          <div><label style="font-size:11px;color:var(--dim)">🎖 Награда жетоны (победа)</label><input type="number" id="ev-tokens" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">🪙 За атаку: от</label><input type="number" id="ev-drop-min" placeholder="5"></div>
          <div><label style="font-size:11px;color:var(--dim)">🪙 За атаку: до</label><input type="number" id="ev-drop-max" placeholder="15"></div>
          <div><label style="font-size:11px;color:var(--dim)">🎲 Шанс выпадения (%)</label><input type="number" id="ev-drop-chance" placeholder="50"></div>
          <div><label style="font-size:11px;color:var(--dim)">⏰ Отложить старт (мин, 0=сразу)</label><input type="number" id="ev-delay" placeholder="0"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-orange" id="ev-start" style="flex:1">🐉 Запустить</button>
          <button class="btn btn-red btn-inline" id="ev-stop">🛑 Остановить</button>
        </div>
      </div>
      <div class="card" style="margin-top:16px;border-color:var(--gold)">
        <div class="name">🏆 Завершить сезон</div>
        <p class="muted small mt">Наградит топ-3 по рейтингу и обнулит рейтинги, начав новый сезон.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label style="font-size:11px;color:var(--dim)">🥇 Золото / жетоны</label><div style="display:flex;gap:4px"><input type="number" id="se-g1" placeholder="1000"><input type="number" id="se-t1" placeholder="5"></div></div>
          <div><label style="font-size:11px;color:var(--dim)">🥈 Золото / жетоны</label><div style="display:flex;gap:4px"><input type="number" id="se-g2" placeholder="500"><input type="number" id="se-t2" placeholder="3"></div></div>
          <div><label style="font-size:11px;color:var(--dim)">🥉 Золото / жетоны</label><div style="display:flex;gap:4px"><input type="number" id="se-g3" placeholder="250"><input type="number" id="se-t3" placeholder="1"></div></div>
        </div>
        <button class="btn btn-orange mt" id="se-end" style="width:100%">🏁 Завершить сезон</button>
      </div>`;
    const wipe = async (what, label) => {
      if (!confirm(`${label}\n\nЭто затронет ВСЕХ игроков и необратимо. Продолжить?`)) return;
      try { const r = await API.post('/api/admin/wipe-groups', { what }); UI.toast('🧹 Очищено: ' + (r.cleared || []).join(', ')); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('wipe-alliances').onclick = () => wipe('alliances', 'Обнулить ВСЕ альянсы?');
    document.getElementById('wipe-legions').onclick = () => wipe('legions', 'Удалить ВСЕ легионы и логи боёв?');
    document.getElementById('wipe-all').onclick = () => wipe('all', 'Стереть ВСЕ альянсы и легионы?');
    const evVal = (id) => (document.getElementById(id) || {}).value || '';
    document.getElementById('ev-start').onclick = async () => {
      try {
        await API.post('/api/admin/event/start', {
          name: evVal('ev-name'), hp: evVal('ev-hp'), def: evVal('ev-def'),
          rewardGold: evVal('ev-gold'), rewardTokens: evVal('ev-tokens'),
          dropMin: evVal('ev-drop-min'), dropMax: evVal('ev-drop-max'),
          dropChance: evVal('ev-drop-chance'), delayMin: evVal('ev-delay'),
        });
        UI.toast('🐉 Событие запущено');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('ev-stop').onclick = async () => {
      if (!confirm('Остановить событие без награды?')) return;
      try { await API.post('/api/admin/event/stop'); UI.toast('🛑 Событие остановлено'); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('se-end').onclick = async () => {
      if (!confirm('Завершить сезон, наградить топ-3 и обнулить рейтинги?')) return;
      try {
        const r = await API.post('/api/admin/season/end', {
          gold1: evVal('se-g1'), tokens1: evVal('se-t1'),
          gold2: evVal('se-g2'), tokens2: evVal('se-t2'),
          gold3: evVal('se-g3'), tokens3: evVal('se-t3'),
        });
        UI.toast('🏁 Сезон завершён. Победители: ' + (r.winners || []).length);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('ad-search').onclick = () => Admin.loadPlayers();
    document.getElementById('ad-q').onkeydown = e => { if(e.key==='Enter') Admin.loadPlayers(); };
    document.getElementById('grant-all-go').onclick = () => Admin.submitGrantAll();
    Admin.loadPlayers();
  },

  _grantFields(prefix) {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div><label style="font-size:11px;color:var(--dim)">💵 Доллары</label><input type="number" id="${prefix}-dollars" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">🪙 Золото</label><input type="number" id="${prefix}-gold" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">⭐ Опыт</label><input type="number" id="${prefix}-xp" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">📈 Очки навыков</label><input type="number" id="${prefix}-skill" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">👂 Уши</label><input type="number" id="${prefix}-ears" placeholder="0"></div>
        <div><label style="font-size:11px;color:var(--dim)">🎖 Жетоны</label><input type="number" id="${prefix}-tokens" placeholder="0"></div>
      </div>
      <label style="font-size:11px;color:var(--dim);display:block;margin-top:8px">✉️ Сообщение игрокам (необязательно)</label>
      <textarea id="${prefix}-note" placeholder="Текст сообщения от администратора…" maxlength="300" style="width:100%;box-sizing:border-box;margin-top:4px"></textarea>`;
  },

  _grantVals(prefix) {
    const v = id => (document.getElementById(id) || {}).value || '';
    return {
      dollars: v(prefix+'-dollars'), gold: v(prefix+'-gold'), xp: v(prefix+'-xp'),
      skillPoints: v(prefix+'-skill'), ears: v(prefix+'-ears'), tokens: v(prefix+'-tokens'),
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
      box.innerHTML = `<div class="card" style="padding:0">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="padding:8px;text-align:left">Игрок</th>
            <th style="padding:8px;text-align:right">💵</th>
            <th style="padding:8px;text-align:right">🪙</th>
            <th style="padding:8px;text-align:right">👂</th>
            <th style="padding:8px;text-align:right">🎖</th>
            <th style="padding:8px"></th>
          </tr></thead>
          <tbody>
          ${players.map(p => `
            <tr style="border-bottom:1px solid var(--border-dim);${!p.online?'opacity:.65':''}">
              <td style="padding:8px">
                <span style="font-weight:bold">${p.flag} ${UI.esc(p.name)}</span>
                ${p.isAdmin ? ' <span class="badge">admin</span>' : ''}
                ${p.banned ? ' <span class="badge" style="background:var(--red)">🚫 бан</span>' : ''}
                ${p.online ? ' <span style="color:var(--green);font-size:10px">● онлайн</span>' : ''}
                <br><span class="muted small">Ур.${p.level} · ID: ${p.id}</span>
              </td>
              <td style="padding:8px;text-align:right;font-size:12px">${UI.fmtMoney(p.dollars)}</td>
              <td style="padding:8px;text-align:right;font-size:12px">${UI.fmtNum(p.gold)}</td>
              <td style="padding:8px;text-align:right;font-size:12px">${p.earsCurrent ?? p.ears}</td>
              <td style="padding:8px;text-align:right;font-size:12px">${p.tokens}</td>
              <td style="padding:8px;white-space:nowrap">
                <button class="btn btn-orange btn-inline" data-pick="${p.id}">Выдать</button>
                <button class="btn btn-inline" data-log="${p.id}" data-log-name="${UI.esc(p.name)}">📋</button>
                ${!p.isAdmin ? `<button class="btn btn-inline" data-ban="${p.id}" data-banned="${p.banned ? '1' : '0'}" data-name="${UI.esc(p.name)}">${p.banned ? '✅ разбан' : '🚫 бан'}</button>
                <button class="btn btn-inline" data-reset="${p.id}" data-name="${UI.esc(p.name)}" style="color:var(--red)">♻️ обнулить</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

      box.querySelectorAll('[data-pick]').forEach(btn => {
        const p = players.find(x => x.id === btn.dataset.pick);
        btn.onclick = () => Admin.renderGrantForm(p);
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
            const reason = prompt(`Причина бана игрока «${name}»:`, 'Нарушение правил');
            if (reason === null) return;
            try { await API.post('/api/admin/ban', { userId: btn.dataset.ban, banned: true, reason }); Admin.loadPlayers(); }
            catch (e) { UI.toast('⛔ ' + e.message); }
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

  renderGrantForm(p) {
    const box = document.getElementById('ad-grant-wrap');
    box.innerHTML = `
      <div class="card" style="border:2px solid var(--orange)">
        <div class="name">🎁 Выдача: ${p.flag} ${UI.esc(p.name)} <span class="muted small">Ур.${p.level}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label style="font-size:11px;color:var(--dim)">💵 Доллары</label><input type="number" id="g-dollars" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">🪙 Золото</label><input type="number" id="g-gold" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">⭐ Опыт</label><input type="number" id="g-xp" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">📈 Очки навыков</label><input type="number" id="g-skill" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">👂 Уши</label><input type="number" id="g-ears" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">🎖 Жетоны</label><input type="number" id="g-tokens" placeholder="0"></div>
        </div>
        <hr class="hr">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label style="font-size:11px;color:var(--dim)">🎚 Уровень (1-300)</label><input type="number" id="g-level" placeholder="не трогать"></div>
          <div><label style="font-size:11px;color:var(--dim)">⚡ Энергия</label><input type="number" id="g-energy" placeholder="не трогать"></div>
          <div><label style="font-size:11px;color:var(--dim)">❤️ Здоровье</label><input type="number" id="g-health" placeholder="не трогать"></div>
          <div><label style="font-size:11px;color:var(--dim)">🎯 Боеприпасы</label><input type="number" id="g-ammo" placeholder="не трогать"></div>
        </div>
        <hr class="hr">
        <label style="font-size:11px;color:var(--dim)">✉️ Сообщение игроку (необязательно)</label>
        <textarea id="g-note" placeholder="Текст сообщения от администрации…" maxlength="300" style="width:100%;box-sizing:border-box;margin-top:4px"></textarea>
        <div class="btn-row mt">
          <button class="btn btn-orange" id="g-go">✅ Выдать</button>
          <button class="btn btn-inline" id="g-cancel">Отмена</button>
        </div>
      </div>`;
    document.getElementById('g-cancel').onclick = () => { box.innerHTML = ''; };
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
    c.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-inline ${Admin._supStatus==='open'?'btn-orange':''}" data-sup-f="open">Открытые</button>
        <button class="btn btn-inline ${Admin._supStatus==='answered'?'btn-orange':''}" data-sup-f="answered">Отвеченные</button>
        <button class="btn btn-inline ${Admin._supStatus==='closed'?'btn-orange':''}" data-sup-f="closed">Закрытые</button>
        <button class="btn btn-inline ${Admin._supStatus==='all'?'btn-orange':''}" data-sup-f="all">Все</button>
      </div>
      <div id="sup-list"><div class="loading">Загрузка…</div></div>`;
    c.querySelectorAll('[data-sup-f]').forEach(b => {
      b.onclick = () => { Admin._supStatus = b.dataset.supF; Admin.renderSupport(c); };
    });
    try {
      const data = await API.get('/api/admin/support?status=' + Admin._supStatus);
      const box = document.getElementById('sup-list');
      if (!data.tickets.length) { box.innerHTML = '<p class="muted center">Обращений нет.</p>'; return; }
      box.innerHTML = data.tickets.map(t => `
        <div class="card">
          <div class="name" style="display:flex;justify-content:space-between;gap:8px">
            <span>${UI.esc(t.subject)}</span>
            <span class="muted small">${UI.esc(t.userName)} · ${t.status}</span>
          </div>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
            ${t.messages.map(m => `
              <div style="padding:7px 9px;border-radius:8px;background:${m.from==='admin'?'rgba(60,180,90,.1)':'rgba(255,255,255,.03)'};border:1px solid ${m.from==='admin'?'var(--green)':'var(--border)'}">
                <div class="muted small">${m.from==='admin'?'🛟 '+UI.esc(m.authorName):'👤 '+UI.esc(m.authorName)} · ${new Date(m.at).toLocaleString('ru-RU')}</div>
                <div style="margin-top:2px;white-space:pre-wrap">${UI.esc(m.text)}</div>
              </div>`).join('')}
          </div>
          ${t.status!=='closed' ? `
            <textarea id="ans-${t.id}" rows="2" placeholder="Ответ игроку…" style="width:100%;box-sizing:border-box;margin-top:8px"></textarea>
            <div style="display:flex;gap:8px;margin-top:6px">
              <button class="btn btn-orange btn-inline" data-ans="${t.id}">Ответить</button>
              <button class="btn btn-inline" data-ans-close="${t.id}">Ответить и закрыть</button>
            </div>` : '<p class="muted small mt">Обращение закрыто.</p>'}
        </div>`).join('');
      box.querySelectorAll('[data-ans]').forEach(btn => {
        btn.onclick = async () => {
          const txt = (document.getElementById('ans-'+btn.dataset.ans)||{}).value||'';
          try { await API.post('/api/admin/support/reply', { ticketId: btn.dataset.ans, text: txt, close: false }); Admin.renderSupport(c); }
          catch(e){ UI.toast('⛔ '+e.message); }
        };
      });
      box.querySelectorAll('[data-ans-close]').forEach(btn => {
        btn.onclick = async () => {
          const txt = (document.getElementById('ans-'+btn.dataset.ansClose)||{}).value||'';
          try { await API.post('/api/admin/support/reply', { ticketId: btn.dataset.ansClose, text: txt, close: true }); Admin.renderSupport(c); }
          catch(e){ UI.toast('⛔ '+e.message); }
        };
      });
    } catch(e) {
      document.getElementById('sup-list').innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
    }
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
        <div class="card" style="padding:0;overflow-x:auto">
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
