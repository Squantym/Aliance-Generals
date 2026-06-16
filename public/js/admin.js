// ===================================================================
// public/js/admin.js — админ-панель
// Вход под учёткой администратора, поиск игроков и выдача любых
// ресурсов через POST /api/admin/grant. Первый зарегистрированный
// в игре игрок автоматически получает права администратора.
// ===================================================================

const Admin = {
  selected: null, // выбранный игрок (объект из списка)

  async init() {
    // Если токен есть и он админский — сразу к делу, иначе форма входа
    if (API.token()) {
      try {
        const me = await API.get('/api/me');
        if (me.isAdmin) return Admin.renderPanel();
        UI.toast('⛔ Эта учётная запись — не администратор');
      } catch (e) { /* токен мёртв — покажем вход */ }
    }
    Admin.renderLogin();
  },

  renderLogin() {
    const c = document.getElementById('content');
    c.innerHTML = `
      <div class="title">Вход для администратора</div>
      <div class="card">
        <label>Позывной</label>
        <input type="text" id="ad-name">
        <label>Пароль</label>
        <input type="password" id="ad-pass">
        <button class="btn btn-orange mt" id="ad-go">Войти</button>
        <p class="muted small mt center">Права администратора получает первый зарегистрированный игрок.</p>
      </div>`;
    document.getElementById('ad-go').onclick = async () => {
      try {
        const r = await API.post('/api/login', {
          login: document.getElementById('ad-name').value,
          password: document.getElementById('ad-pass').value,
        });
        if (!r.isAdmin) return UI.toast('⛔ У этой учётной записи нет прав администратора');
        API.setToken(r.token);
        Admin.renderPanel();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  },

  async renderPanel() {
    const c = document.getElementById('content');
    c.innerHTML = `
      <div class="title">Управление игроками</div>
      <div class="card">
        <div class="field-row">
          <input type="text" id="ad-q" placeholder="Поиск по позывному…">
          <button class="btn btn-inline" id="ad-search">🔍</button>
        </div>
      </div>
      <div class="card" id="ad-list"><div class="loading">Загрузка списка…</div></div>
      <div id="ad-grant"></div>
      <hr class="hr">
      <div class="title">Скидки и бонусы</div>
      <div id="ad-discounts"><div class="loading">Загрузка скидок…</div></div>
      <p class="center"><a href="/">← Вернуться в игру</a></p>`;

    document.getElementById('ad-search').onclick = () => Admin.loadPlayers();
    document.getElementById('ad-q').onkeydown = (e) => { if (e.key === 'Enter') Admin.loadPlayers(); };
    await Admin.loadPlayers();
    await Admin.loadDiscounts();
  },

  // Загрузить и отрисовать категории скидок + активные значения
  async loadDiscounts() {
    const box = document.getElementById('ad-discounts');
    try {
      const data = await API.get('/api/admin/discounts');
      const fmtExp = (ts) => {
        const sec = Math.max(0, Math.floor((ts - Date.now()) / 1000));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
      };
      box.innerHTML = `
        <div class="card">
          <p class="muted small">Скидки применяются ко всем игрокам сразу. Бонус «к покупаемому золоту» — это надбавка к получаемому количеству при покупке (когда вкладка покупки золота будет добавлена в банк).</p>
        </div>
        ${data.categories.map((cat) => {
          const active = data.active[cat.id];
          return `
          <div class="card">
            <div class="name">${UI.esc(cat.name)}</div>
            ${active
              ? `<p class="gold small mt">Активно: ${active.pct}% · истекает через ${fmtExp(active.expires)}</p>`
              : '<p class="muted small mt">Сейчас скидки нет</p>'}
            <div class="field-row mt">
              <input type="number" min="0" max="99" placeholder="%" id="dc-pct-${cat.id}" style="width:80px">
              <input type="number" min="0" step="0.5" placeholder="часов" id="dc-hr-${cat.id}" style="width:90px">
              <button class="btn btn-orange btn-inline" data-cat="${cat.id}">Применить</button>
              ${active ? `<button class="btn btn-red btn-inline" data-clear="${cat.id}">Снять</button>` : ''}
            </div>
          </div>`;
        }).join('')}`;

      box.querySelectorAll('[data-cat]').forEach((btn) => {
        btn.onclick = async () => {
          const cat = btn.dataset.cat;
          const pct = document.getElementById('dc-pct-' + cat).value;
          const hours = document.getElementById('dc-hr-' + cat).value;
          if (!pct || !hours) { UI.toast('Заполните процент и часы'); return; }
          try { await API.post('/api/admin/discount', { category: cat, pct, hours }); await Admin.loadDiscounts(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });
      box.querySelectorAll('[data-clear]').forEach((btn) => {
        btn.onclick = async () => {
          try { await API.post('/api/admin/discount', { category: btn.dataset.clear, pct: 0, hours: 0 }); await Admin.loadDiscounts(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });
    } catch (e) {
      box.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
    }
  },

  async loadPlayers() {
    const q = document.getElementById('ad-q').value.trim();
    const box = document.getElementById('ad-list');
    try {
      const { players } = await API.get('/api/admin/players?q=' + encodeURIComponent(q));
      box.innerHTML = players.length ? players.map((p) => `
        <div class="list-row">
          <div class="grow">
            <span class="name">${p.flag} ${UI.esc(p.name)}</span>${p.isAdmin ? ' <span class="badge">админ</span>' : ''}
            <br><span class="muted small">Ур. ${p.level} · $ ${UI.fmtMoney(p.dollars)} · 🪙 ${UI.fmtNum(p.gold)} · очки: ${p.skillPoints}</span>
          </div>
          <button class="btn btn-orange btn-inline" data-pick="${p.id}">Выбрать</button>
        </div>`).join('') : '<p class="muted center">Никого не найдено.</p>';

      box.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.onclick = () => {
          Admin.selected = players.find((p) => p.id === btn.dataset.pick);
          Admin.renderGrantForm();
        };
      });
    } catch (e) {
      box.innerHTML = `<p class="center" style="color:var(--red)">${UI.esc(e.message)}</p>`;
    }
  },

  renderGrantForm() {
    const p = Admin.selected;
    const box = document.getElementById('ad-grant');
    // Поля: что добавить (+/−) и что выставить напрямую
    box.innerHTML = `
      <div class="card">
        <div class="title" style="margin-top:0">Выдача: ${p.flag} ${UI.esc(p.name)}</div>
        <p class="muted small">Добавить (можно отрицательное число):</p>
        <label>💵 Доллары</label><input type="number" id="g-dollars" placeholder="0">
        <label>🪙 Золото</label><input type="number" id="g-gold" placeholder="0">
        <label>⭐ Опыт</label><input type="number" id="g-xp" placeholder="0">
        <label>📈 Очки навыков</label><input type="number" id="g-skill" placeholder="0">
        <label>👂 Уши</label><input type="number" id="g-ears" placeholder="0">
        <label>🏷 Жетоны</label><input type="number" id="g-tokens" placeholder="0">
        <hr class="hr">
        <p class="muted small">Выставить напрямую (пусто — не трогать):</p>
        <label>Уровень (1–300)</label><input type="number" id="g-level" placeholder="как есть">
        <label>⚡ Энергия (текущая)</label><input type="number" id="g-energy" placeholder="как есть">
        <label>❤ Здоровье (текущее)</label><input type="number" id="g-health" placeholder="как есть">
        <label>🎯 Боеприпасы (текущие)</label><input type="number" id="g-ammo" placeholder="как есть">
        <button class="btn btn-orange mt" id="g-go">Выдать</button>
      </div>`;

    document.getElementById('g-go').onclick = async () => {
      const v = (id) => document.getElementById(id).value;
      try {
        await API.post('/api/admin/grant', {
          userId: p.id,
          dollars: v('g-dollars'), gold: v('g-gold'), xp: v('g-xp'),
          skillPoints: v('g-skill'), ears: v('g-ears'), tokens: v('g-tokens'),
          setLevel: v('g-level'), energy: v('g-energy'), health: v('g-health'), ammo: v('g-ammo'),
        });
        await Admin.loadPlayers();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  },
};
