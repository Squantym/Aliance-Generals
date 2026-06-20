// ===================================================================
// public/js/screens/core.js — базовые экраны
// auth (вход/регистрация), home (главная с Майором и меню),
// profile (свой и чужой), skills (навыки), bank (хранилище).
// ===================================================================

// ---------- ВХОД И РЕГИСТРАЦИЯ ----------
App.screens.auth = async (c) => {
  const { countries } = await API.get('/api/countries');

  const countryOptions = countries.map((x) =>
    `<option value="${x.id}">${x.flag} ${UI.esc(x.name)} — ${UI.esc(x.bonus)}${x.gold ? ` (🪙 ${x.gold})` : ''}</option>`
  ).join('');

  c.innerHTML = `
    <div class="title">Военкомат</div>
    <div class="tabs">
      <div class="tab active" id="tab-login">Вход</div>
      <div class="tab" id="tab-reg">Регистрация</div>
    </div>

    <div class="card" id="form-login">
      <label>Позывной</label>
      <input type="text" id="li-name" maxlength="16" autocomplete="username">
      <label>Пароль</label>
      <input type="password" id="li-pass" autocomplete="current-password">
      <button class="btn btn-orange mt" id="li-go">Войти в строй</button>
      <button class="btn mt" id="li-resend">Не пришло письмо с подтверждением? Отправить повторно</button>
    </div>

    <div class="card" id="form-reg" style="display:none">
      <p class="muted small">2034 год. Мир охвачен войной, и каждой армии нужны решительные командиры. Заполни личное дело, боец.</p>
      <label>Позывной (3–16 символов)</label>
      <input type="text" id="rg-name" maxlength="16" autocomplete="username">
      <label>Email (для подтверждения регистрации)</label>
      <input type="email" id="rg-email" autocomplete="email">
      <label>Пароль (минимум 4 символа)</label>
      <input type="password" id="rg-pass" autocomplete="new-password">
      <label>Страна (даёт постоянный бонус)</label>
      <select id="rg-country">${countryOptions}</select>
      <button class="btn btn-orange mt" id="rg-go">Подписать контракт</button>
    </div>`;

  // Переключение вкладок входа/регистрации
  const show = (login) => {
    document.getElementById('form-login').style.display = login ? '' : 'none';
    document.getElementById('form-reg').style.display = login ? 'none' : '';
    document.getElementById('tab-login').classList.toggle('active', login);
    document.getElementById('tab-reg').classList.toggle('active', !login);
  };
  document.getElementById('tab-login').onclick = () => show(true);
  document.getElementById('tab-reg').onclick = () => show(false);

  // Общее завершение: сохранить токен, загрузить игрока, на главную
  const finish = async (token) => {
    API.setToken(token);
    App.me = await API.get('/api/me');
    App.go('home');
  };

  document.getElementById('li-go').onclick = async () => {
    try {
      const r = await API.post('/api/login', {
        login: document.getElementById('li-name').value,
        password: document.getElementById('li-pass').value,
      });
      await finish(r.token);
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };

  // Повторная отправка письма подтверждения
  document.getElementById('li-resend').onclick = async () => {
    const login = document.getElementById('li-name').value.trim();
    if (!login) { UI.toast('Введите позывной'); return; }
    try {
      const r = await API.post('/api/resend-verification', { login });
      if (r.autoVerified) {
        UI.toast('✅ Почта подтверждена автоматически — можете войти');
      } else {
        UI.toast('📧 Письмо отправлено на вашу почту');
      }
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };

  document.getElementById('rg-go').onclick = async () => {
    try {
      const r = await API.post('/api/register', {
        login: document.getElementById('rg-name').value,
        email: document.getElementById('rg-email').value,
        password: document.getElementById('rg-pass').value,
        country: document.getElementById('rg-country').value,
      });
      if (r.isAdmin) UI.toast('👑 Вы первый игрок — вам выданы права администратора (/admin)');
      if (r.token) {
        // Dev-режим: почта подтверждена автоматически (RESEND_API_KEY не задан)
        await finish(r.token);
      } else {
        // Боевой режим: ждём подтверждения почты
        c.innerHTML = `
          <div class="title">📧 Подтвердите почту</div>
          <div class="card center">
            <p style="font-size:40px">✉️</p>
            <p class="mt">Письмо со ссылкой подтверждения отправлено на <b>${UI.esc(r.email)}</b>.</p>
            <p class="muted small mt">Перейдите по ссылке в письме и вернитесь сюда — сможете войти.</p>
            <button class="btn btn-orange mt" onclick="App.go('auth')">Уже подтвердил — войти</button>
          </div>`;
      }
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- ГЛАВНАЯ ----------
App.screens.home = async (c) => {
  await App.refreshMe();
  const m = App.me;
  if (!m) return App.go('auth');

  // Блок Майора: сюжетное задание или дежурная фраза
  let majorHtml;
  const t = m.tutorial;
  if (!t.done && t.quest) {
    majorHtml = `
      <div class="card">
        <div class="major">
          <div class="face">👨‍✈️</div>
          <div>
            ${t.step === 0 ? `<p class="story small">${UI.esc(t.prologue)}</p><hr class="hr">` : ''}
            <p><b>Майор:</b> ${UI.esc(t.quest.story)}</p>
            <p class="mt small">📜 Задание ${t.step + 1}/${t.total}: <b>${UI.esc(t.quest.title)}</b><br>
            <span class="muted">Цель: ${UI.esc(t.quest.goal)}</span><br>
            <span class="gold">Награда: ${UI.esc(t.quest.reward)}</span></p>
            <button class="btn btn-orange mt" onclick="App.go('${t.quest.screen}')">Выполнить →</button>
          </div>
        </div>
      </div>`;
  } else {
    majorHtml = `
      <div class="card">
        <div class="major">
          <div class="face">👨‍✈️</div>
          <div><b>Майор:</b> Курс молодого бойца пройден. Дальше — только война, ${UI.esc(m.rank)}. Армия ждёт приказов!</div>
        </div>
      </div>`;
  }

  // Незавершённое фаталити — срочное напоминание
  const fatalityHtml = m.pendingFatality
    ? `<div class="card fatality-card center">💀 Враг <b>${UI.esc(m.pendingFatality.name)}</b> повержен и ждёт вашего решения!
       <button class="btn btn-red mt" onclick="App.go('war')">Решить судьбу →</button></div>`
    : '';

  // Главное меню — сетка 2 колонки. В верхнем (главном) блоке — Легион,
  // альянс — в нижнем (вторичном) меню.
  const prodLocked = !m.unlocked.production;
  const big = [
    ['war', '🎯', 'Война'],
    ['legion', '🛡', 'Легион'],
    ['missions', '📋', 'Спецоперации'],
    ['daily', '🎯', 'Ежедневка'],
    ['production', '🏭', 'Производство' + (prodLocked ? ` 🔒` : '')],
    ['units', '🚜', 'Техника'],
    ['buildings', '🏗', 'Постройки'],
    ['market', '💣', 'Чёрный рынок'],
    ['club', '🎲', 'Клуб офицеров'],
  ];
  const small = [
    ['profile', '👤', 'Профиль', ''],
    ['fame', '🏆', 'Зал славы', ''],
    ['skills', '📈', 'Навыки', m.skillPoints > 0 ? `<span class="badge">+${m.skillPoints}</span>` : ''],
    ['chat', '💬', 'Общение', ''],
    ['alliance', '🤝', 'Альянс', ''],
    ['bank', '🏦', 'Банк', ''],
    ['hospital', '🏥', 'Госпиталь', ''],
    ['mail', '✉', 'Почта', m.mailUnread > 0 ? `<span class="badge">${m.mailUnread}</span>` : ''],
    ['ach', '🎖', 'Достижения', ''],
    ['trophies', '🎁', 'Трофеи', ''],
    ['settings', '⚙', 'Настройки', ''],
  ];

  c.innerHTML = `
    ${fatalityHtml}
    ${majorHtml}
    <div class="menu-grid">
      ${big.map(([id, ic, label]) =>
        `<div class="menu-btn" onclick="App.go('${id}')"><span class="ic">${ic}</span>${label}</div>`).join('')}
    </div>
    <div class="menu-grid">
      ${small.map(([id, ic, label, badge]) =>
        `<div class="menu-btn small-row" onclick="App.go('${id}')"><span class="ic">${ic}</span>${label}${badge}</div>`).join('')}
    </div>
    <div class="card">
      <div class="kv"><span class="k">⚔ Мощь атаки</span><span class="v">${UI.fmtNum(m.power.atk)}</span></div>
      <div class="kv"><span class="k">🛡 Мощь обороны</span><span class="v">${UI.fmtNum(m.power.def)}</span></div>
      <div class="kv"><span class="k">🚚 Техники в бою</span><span class="v">${UI.fmtNum(m.power.taken)} / ${UI.fmtNum(m.capacity)}</span></div>
      <div class="kv"><span class="k">💵 Доход в час</span><span class="v money">$ ${UI.fmtMoney(m.incomePerHour)}</span></div>
      <div class="kv"><span class="k">🔧 Содержание в час</span><span class="v" style="color:var(--red)">$ ${UI.fmtMoney(m.upkeepPerHour)}</span></div>
      <div class="kv"><span class="k">⏱ Выплата через</span><span class="v">${UI.fmtTimer(m.nextPayoutSec)}</span></div>
    </div>
    <p class="center muted small">© generals-game · сделано в учебных целях</p>`;
};

// ---------- ПРОФИЛЬ (свой или чужой: #profile/ид) ----------
App.screens.profile = async (c, param) => {
  const id = param || App.me.id;
  const { profile: p } = await API.get('/api/profile/' + encodeURIComponent(id));
  const own = p.id === App.me.id;

  const isBot = !!p.isBot;
  const unitsHtml = (!isBot && p.units && p.units.length)
    ? p.units.map((x) => `<div class="kv"><span class="k">${UI.esc(x.name)} <span class="muted small">(${UI.esc(x.type)})</span></span><span class="v">×${UI.fmtNum(x.count)}</span></div>`).join('')
    : '<p class="muted">Ангар не разглашается.</p>';

  const devsHtml = (!isBot && (p.secretDevs && p.secretDevs.length || p.superSecret))
    ? p.secretDevs.map((x) => `<div class="kv"><span class="k">${UI.esc(x.name)}</span><span class="v">×${x.count}</span></div>`).join('') +
      (p.superSecret ? `<div class="kv"><span class="k gold">🛸 Сверхсекретная «Абсолют»</span><span class="v gold">×${p.superSecret}</span></div>` : '')
    : '<p class="muted">Секретных разработок нет.</p>';

  const buildingsHtml = (!isBot && p.buildings && p.buildings.length)
    ? p.buildings.map((x) => `<div class="kv"><span class="k">${x.kind === 'income' ? '💵' : '🛡'} ${UI.esc(x.name)}</span><span class="v">×${UI.fmtNum(x.count)}</span></div>`).join('')
    : '<p class="muted">Постройки не разглашаются.</p>';

  c.innerHTML = `
    <div class="title">Личное дело</div>
    <div class="card">
      <div class="list-row">
        <div class="face" style="font-size:34px">${p.online ? '🟢' : '⚪'}</div>
        <div class="grow">
          <div class="name" style="font-size:17px">${p.flag} ${UI.esc(p.name)}</div>
          <div class="muted small">Звание: <b>${UI.esc(p.rank)}</b> · Ур. ${p.level} · Рейтинг ${UI.fmtNum(p.rating)}</div>
          ${p.countryName ? `<div class="muted small">${p.flag} ${UI.esc(p.countryName)}: ${UI.esc(p.countryBonus || '')}</div>` : ''}
          <div class="muted small">${p.alliance ? 'Альянс: <b>' + UI.esc(p.alliance.name) + '</b> (' + p.alliance.members + ' чел.)' : 'Без альянса'}</div>
        </div>
      </div>
      <div id="status-box">
        <p class="small mt" style="font-style:italic">${p.status ? UI.esc(p.status) : '<span class="muted">Статус не задан</span>'}</p>
        ${own ? '<a href="javascript:void 0" class="small" id="edit-status">редактировать статус</a>' : ''}
      </div>
      ${!own && p.canAttack ? `<button class="btn btn-orange mt" id="pf-attack">⚔ Атаковать</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-msg">✉ Написать сообщение</button>` : ''}
      ${!own && !p.canAttack ? `<p class="muted small mt center">Цель вне диапазона ±10 уровней</p>` : ''}
      ${!own && App.me.alliance && App.me.alliance.leaderId === App.me.id && !p.alliance
        ? `<button class="btn btn-green mt" id="pf-invite-alliance">🤝 Пригласить в альянс «${UI.esc(App.me.alliance.name)}»</button>` : ''}
      ${!own && App.me.legion && App.me.legion.leaderId === App.me.id && !p.legion
        ? `<button class="btn btn-green mt" id="pf-invite-legion">🛡 Пригласить в легион «${UI.esc(App.me.legion.name)}»</button>` : ''}
    </div>

    <div class="card">
      ${own ? `
      <div class="kv"><span class="k">📊 Опыт</span><span class="v">${UI.fmtNum(App.me.xp)} / ${UI.fmtNum(App.me.xpNext)}</span></div>
      <div class="mt">${UI.bar(App.me.xp, App.me.xpNext, 'xp', `До ${App.me.level + 1} уровня: ${UI.fmtNum(Math.max(0, App.me.xpNext - App.me.xp))} XP`)}</div>
      <hr class="hr">` : ''}
      <div class="kv"><span class="k">⚔ Атака</span><span class="v">${UI.fmtNum(p.power.atk)}</span></div>
      <div class="kv"><span class="k">🛡 Защита</span><span class="v">${UI.fmtNum(p.power.def)}</span></div>
      <div class="kv"><span class="k">🚚 Вместимость армии</span><span class="v">${UI.fmtNum(p.capacity)}</span></div>
      ${p.powerStats ? `<button class="btn mt" id="pf-stats-toggle" style="width:100%">📊 Подробная статистика</button>` : ''}
      <hr class="hr">
      <div class="kv"><span class="k">Нападения</span><span class="v">${UI.fmtNum(p.battle.attacks)}</span></div>
      <div class="kv"><span class="k">Победы</span><span class="v">${UI.fmtNum(p.battle.wins)}</span></div>
      <div class="kv"><span class="k">Поражения</span><span class="v">${UI.fmtNum(p.battle.losses)}</span></div>
      <div class="kv"><span class="k">Оборона: отбито / сдано</span><span class="v">${UI.fmtNum(p.battle.defWins)} / ${UI.fmtNum(p.battle.defLosses)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">💀 Фаталити</span><span class="v">${UI.fmtNum(p.battle.fatalities)}</span></div>
      <div class="kv"><span class="k">👂 Отрезанные уши</span><span class="v">${UI.fmtNum(p.ears)}</span></div>
      <div class="kv"><span class="k">🏷 Жетоны милосердия</span><span class="v">${UI.fmtNum(p.tokens)}</span></div>
      <div class="kv"><span class="k">Потеряно своих ушей</span><span class="v">${UI.fmtNum(p.earsLost)}</span></div>
    </div>

    ${p.powerStats ? `
    <div class="card" id="pf-stats-block" style="display:none">
      <div class="title" style="margin-top:0">📊 Подробная статистика мощи</div>

      <div class="kv"><span class="k">🚜 Наземная техника</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.ground.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.ground.def)} (${UI.fmtNum(p.powerStats.byCategory.ground.count)} ед.)</span></div>
      <div class="kv"><span class="k">✈ Воздушная техника</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.air.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.air.def)} (${UI.fmtNum(p.powerStats.byCategory.air.count)} ед.)</span></div>
      <div class="kv"><span class="k">🚢 Морская техника</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.sea.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.sea.def)} (${UI.fmtNum(p.powerStats.byCategory.sea.count)} ед.)</span></div>
      <div class="kv"><span class="k">🛸 Секретные разработки</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.secret.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.secret.def)} (${UI.fmtNum(p.powerStats.byCategory.secret.count)} ед.)</span></div>

      ${p.powerStats.lines.length ? `
      <hr class="hr">
      <p class="small mt"><b>По каждой единице техники:</b></p>
      ${p.powerStats.lines.map((l) => `
        <div class="kv">
          <span class="k">${UI.esc(l.name)} <span class="muted small">×${UI.fmtNum(l.count)}</span></span>
          <span class="v small">⚔ ${UI.fmtNum(l.atkTotal)} · 🛡 ${UI.fmtNum(l.defTotal)}</span>
        </div>`).join('')}` : '<p class="muted small mt center">Техники нет.</p>'}

      ${p.powerStats.secretLines.length ? `
      <hr class="hr">
      <p class="small mt"><b>Секретные разработки:</b></p>
      ${p.powerStats.secretLines.map((l) => `
        <div class="kv">
          <span class="k">${UI.esc(l.name)} <span class="muted small">×${UI.fmtNum(l.count)}</span></span>
          <span class="v small gold">⚔ ${UI.fmtNum(l.atkTotal)} · 🛡 ${UI.fmtNum(l.defTotal)}</span>
        </div>`).join('')}` : ''}
    </div>` : ''}

    <div class="card"><div class="title" style="margin-top:0">Техника</div>${unitsHtml}</div>
    <div class="card"><div class="title" style="margin-top:0">Секретные разработки</div>${devsHtml}</div>
    <div class="card"><div class="title" style="margin-top:0">Постройки</div>${buildingsHtml}</div>`;

  // Редактирование собственного статуса
  if (own) {
    document.getElementById('edit-status').onclick = async () => {
      const text = prompt('Новый статус (до 120 символов):', p.status || '');
      if (text === null) return;
      try {
        await API.post('/api/status', { text });
        App.rerender(); // перерисовать профиль
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  // Разворачивание/сворачивание подробной статистики мощи
  const statsToggle = document.getElementById('pf-stats-toggle');
  if (statsToggle) {
    statsToggle.onclick = () => {
      const block = document.getElementById('pf-stats-block');
      const opening = block.style.display === 'none';
      block.style.display = opening ? '' : 'none';
      statsToggle.textContent = opening ? '📊 Скрыть подробную статистику' : '📊 Подробная статистика';
      if (opening) block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  }

  // Атака из чужого профиля: бьём и уходим на экран войны с результатом
  if (!own && p.canAttack) {
    document.getElementById('pf-attack').onclick = async () => {
      try {
        App._lastBattle = await API.post('/api/war/attack', { targetId: p.id });
        await App.refreshMe();
        App.go('war');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }
  // Личное сообщение игроку
  if (!own) {
    const btnMsg = document.getElementById('pf-msg');
    if (btnMsg) btnMsg.onclick = () => {
      const subject = prompt('Тема письма:', 'Привет, ' + p.name);
      if (subject === null) return;
      const text = prompt('Текст сообщения:');
      if (!text) return;
      API.post('/api/mail', { toName: p.name, subject, text })
        .then(() => UI.toast('✉ Сообщение отправлено игроку ' + p.name))
        .catch((e) => UI.toast('⛔ ' + e.message));
    };
  }

  // Приглашения в альянс/легион (доступно лидерам соответствующих групп)
  const invite = (kind) => async () => {
    try {
      await API.post(`/api/group/${kind}/invite`, { userId: p.id });
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  const inv1 = document.getElementById('pf-invite-alliance');
  const inv2 = document.getElementById('pf-invite-legion');
  if (inv1) inv1.onclick = invite('alliance');
  if (inv2) inv2.onclick = invite('legion');
};

// ---------- НАВЫКИ ----------
App.screens.skills = async (c) => {
  await App.refreshMe();
  const m = App.me;
  // [id, лейбл, описание, цена в очках, сколько единиц даёт прокачка]
  const defs = [
    ['energy',  '⚡ Энергия',     'Расходуется в миссиях. +10 к максимуму за прокачку.', 1, 10],
    ['health',  '❤ Здоровье',    'Ниже 25 — в бой нельзя. +10 к максимуму за прокачку.', 1, 10],
    ['ammo',    '🎯 Боеприпасы', 'Сколько атак в запасе. +1 к максимуму.', 2, 1],
    ['cruelty', '💀 Жестокость', '+1% к шансу крита и фаталити.', 2, 1],
    ['agility', '🏃 Ловкость',    'Шанс увернуться от удара и фаталити.', 2, 1],
  ];

  c.innerHTML = `
    <div class="title">Навыки</div>
    <div class="card center">Неиспользовано: <b class="gold">${m.skillPoints}</b> очков навыков
      <p class="muted small mt">+5 очков за каждый уровень и за прохождение конфликтов</p></div>
    ${defs.map(([id, name, desc, cost, plus]) => `
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div class="grow">
            <div class="name">${name} — <span class="gold">${m.skills[id]}</span></div>
            <div class="muted small">${desc}</div>
          </div>
          <button class="btn btn-orange btn-inline" data-skill="${id}" ${m.skillPoints < cost ? 'disabled' : ''}>+${plus} за ${cost} оч.</button>
        </div>
      </div>`).join('')}`;

  c.querySelectorAll('[data-skill]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/skill', { stat: btn.dataset.skill });
        await App.refreshMe();
        App.rerender(); // перерисовать с новыми значениями
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
};

// ---------- БАНК ----------
App.screens.bank = async (c, param) => {
  await App.refreshMe();
  const m = App.me;
  const tab = param || 'storage';

  const tabs = `
    <div class="tabs">
      <div class="tab ${tab === 'storage' ? 'active' : ''}" onclick="location.hash='#bank/storage'">🏦 Хранилище</div>
      <div class="tab ${tab === 'gold' ? 'active' : ''}" onclick="location.hash='#bank/gold'">🪙 Купить золото</div>
    </div>`;

  if (tab === 'gold') {
    const { packages } = await API.get('/api/bank/gold-packages');
    c.innerHTML = `
      <div class="title">Банк · Покупка золота</div>
      ${tabs}
      <div class="card"><p class="muted small">Золото — премиум-валюта: ускоряет прокачку, открывает контейнеры на чёрном рынке, оплачивает услуги клуба офицеров. Курс: <b>1 золото = 1 рубль</b>. На крупных пакетах — бонусное золото.</p></div>
      ${packages.map((p) => `
        <div class="card">
          <div class="list-row" style="border:none;padding:0">
            <div class="grow">
              <div class="name"><span class="ic-gold"></span> ${UI.fmtNum(p.total)} золота${p.bonus > 0 ? ` <span class="badge green">+${p.bonusPct}%</span>` : ''}</div>
              <div class="muted small">${UI.fmtNum(p.gold)}${p.bonus > 0 ? ` + ${UI.fmtNum(p.bonus)} бонус` : ''}</div>
            </div>
            <button class="btn btn-orange btn-inline" data-pack="${p.id}">${UI.fmtNum(p.priceRub)} ₽</button>
          </div>
        </div>`).join('')}
      <div class="card"><p class="muted small center">💳 Приём оплаты скоро будет подключён.</p></div>`;

    c.querySelectorAll('[data-pack]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const r = await API.post('/api/bank/buy-gold', { packId: btn.dataset.pack });
          UI.toast('💳 ' + (r.message || 'Пакет зарезервирован'));
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
    return;
  }

  // Вкладка «Хранилище»
  c.innerHTML = `
    <div class="title">Банк · Хранилище</div>
    ${tabs}
    <div class="card">
      <div class="kv"><span class="k">Наличные</span><span class="v money">$ ${UI.fmtNum(m.dollars)}</span></div>
      <div class="kv"><span class="k">В хранилище</span><span class="v money">$ ${UI.fmtNum(m.bank)}</span></div>
      <p class="muted small mt">Помни: при вложении денег снимается комиссия 10%. Зато здесь ты можешь хранить честно отобранные у врага деньги без опасения, что их отберут у тебя. Трофей «Налоговая льгота» снижает комиссию вплоть до 5%.</p>
    </div>
    <div class="card">
      <label>Положить в хранилище</label>
      <div class="field-row">
        <input type="number" id="bk-dep" min="1" placeholder="Сумма">
        <button class="btn btn-orange btn-inline" id="bk-dep-go">Положить</button>
      </div>
      <label>Снять из хранилища</label>
      <div class="field-row">
        <input type="number" id="bk-wd" min="1" placeholder="Сумма">
        <button class="btn btn-inline" id="bk-wd-go">Снять</button>
      </div>
    </div>`;

  const op = (action, inputId) => async () => {
    try {
      await API.post('/api/bank', { action, amount: document.getElementById(inputId).value });
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  document.getElementById('bk-dep-go').onclick = op('deposit', 'bk-dep');
  document.getElementById('bk-wd-go').onclick = op('withdraw', 'bk-wd');
};

// ---------- НАСТРОЙКИ (тема оформления, выход) ----------
App.screens.settings = async (c) => {
  await App.refreshMe();
  const current = App.theme();
  const themeBtn = (id, name, desc) => `
    <div class="card">
      <div class="list-row" style="border:none;padding:0">
        <div class="grow">
          <div class="name">${name}${id === current ? ' <span class="badge green">активна</span>' : ''}</div>
          <div class="muted small">${desc}</div>
        </div>
        <button class="btn ${id === current ? '' : 'btn-orange'} btn-inline" data-theme="${id}" ${id === current ? 'disabled' : ''}>
          ${id === current ? 'Выбрана' : 'Включить'}
        </button>
      </div>
    </div>`;

  c.innerHTML = `
    <div class="title">Настройки профиля</div>
    <div class="card"><p class="muted small">Здесь можно сменить тему оформления игры. Изменения применяются сразу.</p></div>
    <div class="title" style="font-size:14px">Тема оформления</div>
    ${themeBtn('classic', '🎨 Классическая хаки', 'Тёмная зелень и хаки — стиль оригинальной игры.')}
    ${themeBtn('steel',   '⚙ Военная сталь',    'Тёмный металл с зернистостью и царапинами.')}
    ${themeBtn('cyber',   '⚡ Кибер-война',      'Футуристический HUD: неоновая бирюза, геометрия, glassmorphism.')}
    ${themeBtn('desert',  '☀ Пустынный фронт',   'Жёлтые пески, выгоревший камуфляж и солнечный жар.')}
    ${themeBtn('noir',    '🌑 Полуночный штаб',  'Мягкий чёрно-серый интерфейс без резких цветов — для глаз ночью.')}
    ${themeBtn('aurora',  '🌅 Аврора',           'Светлый футуристичный интерфейс: белый фон, неоновые акценты, чистая геометрия.')}
    <hr class="hr">
    <button class="btn btn-red" id="set-logout">🚪 Выйти из аккаунта</button>`;

  c.querySelectorAll('[data-theme]').forEach((btn) => {
    btn.onclick = () => {
      App.setTheme(btn.dataset.theme);
      App.rerender(); // перерисовать экран, чтобы метка «активна» переехала
    };
  });
  document.getElementById('set-logout').onclick = async () => {
    try { await API.post('/api/logout', { token: API.token() }); } catch (e) {}
    API.setToken(null);
    App.me = null;
    location.hash = '#auth';
  };
};

// ---------- ЕЖЕДНЕВНЫЕ ЗАДАНИЯ ----------
App.screens.daily = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/daily');

  c.innerHTML = `
    <div class="title">🎯 Ежедневные задания</div>
    <div class="card center">
      <p class="muted small">Выполнено: <b>${d.doneCount} / ${d.total}</b> · Обнуление через ~${d.resetInHours} ч</p>
      <p class="small mt">Награда за задание: +${UI.fmtNum(d.reward.xp)} XP, +$${UI.fmtNum(d.reward.dollars)}</p>
      ${d.allDone && !d.bonusClaimed ? `
        <button class="btn btn-orange mt" id="daily-bonus">🎉 Забрать бонус: <span class="ic-gold"></span> ${d.bonusGold}</button>
      ` : d.bonusClaimed ? `
        <p class="small mt" style="color:var(--money)">✅ Бонус 🪙 ${d.bonusGold} уже получен сегодня</p>
      ` : `
        <p class="small mt muted">Выполните все ${d.total} заданий чтобы получить бонус 🪙 ${d.bonusGold}</p>
      `}
    </div>

    ${d.quests.map((q) => `
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div class="grow">
            <div class="name">${q.icon} ${UI.esc(q.name)}</div>
            <div class="mt">${UI.bar(q.progress, q.target, 'xp', `${UI.fmtNum(q.progress)} / ${UI.fmtNum(q.target)}`)}</div>
          </div>
          ${q.claimed
            ? `<span class="badge green">✅</span>`
            : q.done
              ? `<button class="btn btn-orange btn-inline" data-quest="${q.id}">Получить</button>`
              : `<span class="muted small">в работе</span>`}
        </div>
      </div>`).join('')}`;

  c.querySelectorAll('[data-quest]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/daily/claim', { questId: btn.dataset.quest });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  const bonusBtn = document.getElementById('daily-bonus');
  if (bonusBtn) bonusBtn.onclick = async () => {
    try {
      await API.post('/api/daily/bonus');
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};
