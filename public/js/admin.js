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
      { id:'tools',     label:'🛠 Инструменты' },
      { id:'events',    label:'🐉 События' },
      { id:'tournament',label:'⚔️ Турниры' },
      { id:'legions',   label:'🎖 Легионы' },
      { id:'discounts', label:'🏷 Скидки' },
      { id:'buffs',     label:'🎉 Бонусы' },
      { id:'logs',      label:'📋 Журнал' },
      { id:'support',   label:'🛟 Поддержка' },
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
    Admin._tabIds = tabs.map(t => t.id);
    Admin.renderTab();
  },

  renderTab() {
    // Обновить активную кнопку
    (Admin._tabIds || []).forEach(id => {
      const btn = document.getElementById('tab-'+id);
      if (btn) btn.className = `btn btn-inline ${Admin.tab===id?'btn-orange':''}`;
    });
    const c = document.getElementById('tab-content');
    if (Admin.tab === 'players')   return Admin.renderPlayers(c);
    if (Admin.tab === 'tools')     return Admin.renderTools(c);
    if (Admin.tab === 'events')    return Admin.renderEvents(c);
    if (Admin.tab === 'tournament')return Admin.renderTournament(c);
    if (Admin.tab === 'legions')   return Admin.renderLegions(c);
    if (Admin.tab === 'support')   return Admin.renderSupport(c);
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
        <p class="muted small mt">Найдите игрока, чтобы выдать ресурсы, забанить или обнулить аккаунт. Массовые операции — во вкладке «🛠 Инструменты».</p>
      </div>
      <div id="ad-list"><div class="loading">Загрузка…</div></div>
      <div id="ad-grant-wrap"></div>`;
    document.getElementById('ad-search').onclick = () => Admin.loadPlayers();
    document.getElementById('ad-q').onkeydown = e => { if(e.key==='Enter') Admin.loadPlayers(); };
    Admin.loadPlayers();
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
          <label style="font-size:11px;color:var(--dim)">🖼 Фото босса — ссылка (/img/... или https://...). Показывается квадратом 300×300</label>
          <input type="text" id="ev-image" placeholder="/img/bosses/armada.webp">
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
    // Пустой список = файл не задеплоен (а не «ссылка неправильная»).
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
      </div>
      <label style="font-size:11px;color:var(--dim);display:block;margin-top:8px"><span class="ic-mail"></span> Сообщение игрокам (необязательно)</label>
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
                <button class="btn btn-orange btn-inline" data-pick="${p.id}">Выдать</button>
                <button class="btn btn-inline" data-log="${p.id}" data-log-name="${UI.esc(p.name)}">📋</button>
                ${!p.isAdmin ? `<button class="btn btn-inline" data-ban="${p.id}" data-banned="${p.banned ? '1' : '0'}" data-name="${UI.esc(p.name)}">${p.banned ? '✅ разбан' : '🚫 бан'}</button>
                <button class="btn btn-inline" data-reset="${p.id}" data-name="${UI.esc(p.name)}" style="color:var(--red)">♻️ обнулить</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

      box.querySelectorAll('[data-view]').forEach(btn => {
        btn.onclick = () => Admin.showPlayerDetail(btn.dataset.view);
      });
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

  renderGrantForm(p) {
    const box = document.getElementById('ad-grant-wrap');
    box.innerHTML = `
      <div class="card" style="border:2px solid var(--orange)">
        <div class="name">🎁 Выдача: ${p.flag} ${UI.esc(p.name)} <span class="muted small">Ур.${p.level}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-dollar"></span> Доллары</label><input type="number" id="g-dollars" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-gold"></span> Золото</label><input type="number" id="g-gold" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">⭐ Опыт</label><input type="number" id="g-xp" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">📈 Очки навыков</label><input type="number" id="g-skill" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">👂 Уши</label><input type="number" id="g-ears" placeholder="0"></div>
          <div><label style="font-size:11px;color:var(--dim)">🎖 Жетоны</label><input type="number" id="g-tokens" placeholder="0"></div>
        </div>
        <hr class="hr">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label style="font-size:11px;color:var(--dim)">🎚 Уровень (1-300)</label><input type="number" id="g-level" placeholder="не трогать"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-energy"></span> Энергия</label><input type="number" id="g-energy" placeholder="не трогать"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-health"></span> Здоровье</label><input type="number" id="g-health" placeholder="не трогать"></div>
          <div><label style="font-size:11px;color:var(--dim)"><span class="ic-ammo"></span> Боеприпасы</label><input type="number" id="g-ammo" placeholder="не трогать"></div>
        </div>
        <hr class="hr">
        <label style="font-size:11px;color:var(--dim)"><span class="ic-mail"></span> Сообщение игроку (необязательно)</label>
        <textarea id="g-note" placeholder="Текст сообщения от администрации…" maxlength="300" style="width:100%;box-sizing:border-box;margin-top:4px"></textarea>
        <div class="btn-row mt">
          <button class="btn btn-orange" id="g-go">✅ Выдать сразу</button>
          <button class="btn btn-inline" id="g-cancel">Отмена</button>
        </div>
        <hr class="hr">
        <div class="muted small">🎁 Или отправить наградой-письмом (игрок заберёт сам на главном экране или в почте — начислятся 💵 доллары, 🪙 золото, 🎖 жетоны, 👂 уши, 📈 очки, ✨ опыт из полей выше):</div>
        <input type="text" id="g-rw-title" placeholder="Заголовок письма (напр. «Награда за турнир»)" maxlength="120" style="width:100%;box-sizing:border-box;margin-top:6px">
        <input type="text" id="g-rw-reason" placeholder="За что награда (напр. «Победа в турнире легионов»)" maxlength="300" style="width:100%;box-sizing:border-box;margin-top:6px">
        <button class="btn mt" id="g-rw-go" style="width:100%;border-color:var(--gold);color:var(--gold)">🎁 Отправить наградой (письмом)</button>
      </div>`;
    document.getElementById('g-cancel').onclick = () => { box.innerHTML = ''; };
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

    c.innerHTML = statusRow + catRow + `<div id="sup-list">${listHtml}</div>`;

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
