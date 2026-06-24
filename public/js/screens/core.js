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
      <label for="li-name">Позывной</label>
      <input type="text" id="li-name" maxlength="16" autocomplete="username" required placeholder="Ваш игровой позывной">
      <label for="li-pass">Пароль</label>
      <input type="password" id="li-pass" autocomplete="current-password" required placeholder="Пароль от аккаунта">
      <button class="btn btn-orange mt" id="li-go">Войти в строй</button>
      <button class="btn mt" id="li-resend">Не пришло письмо с подтверждением? Отправить повторно</button>
    </div>

    <div class="card" id="form-reg" style="display:none">
      <p class="muted small">2034 год. Мир охвачен войной, и каждой армии нужны решительные командиры. Заполни личное дело, боец.</p>
      <label for="rg-name">Позывной (3–16 символов, только буквы/цифры/_ -)</label>
      <input type="text" id="rg-name" maxlength="16" autocomplete="username" required placeholder="Например: ShadowGeneral">
      <label for="rg-email">Email (для подтверждения регистрации)</label>
      <input type="email" id="rg-email" autocomplete="email" required placeholder="your@email.com">
      <label for="rg-pass">Пароль (минимум 8 символов, буквы + цифры)</label>
      <input type="password" id="rg-pass" autocomplete="new-password" required placeholder="Не менее 8 символов" minlength="8">
      <label for="rg-country">Страна (даёт постоянный бонус)</label>
      <select id="rg-country" required>${countryOptions}</select>
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
    // БАГ 2: клиентская валидация перед отправкой
    const name = document.getElementById('rg-name').value.trim();
    const email = document.getElementById('rg-email').value.trim();
    const pass  = document.getElementById('rg-pass').value;
    if (!name)  { UI.toast('⛔ Введите позывной'); return; }
    if (name.length < 3) { UI.toast('⛔ Позывной минимум 3 символа'); return; }
    if (!email) { UI.toast('⛔ Введите email'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { UI.toast('⛔ Введите корректный email'); return; }
    if (!pass)  { UI.toast('⛔ Введите пароль'); return; }
    if (pass.length < 8) { UI.toast('⛔ Пароль минимум 8 символов'); return; }
    if (!/[A-Za-zА-Яа-яЁё]/.test(pass) || !/[0-9]/.test(pass)) { UI.toast('⛔ Пароль должен содержать буквы и цифры'); return; }
    try {
      const r = await API.post('/api/register', {
        login: name,
        email: document.getElementById('rg-email').value,
        password: pass,
        country: document.getElementById('rg-country').value,
      });
      if (r.isAdmin) UI.toast('👑 Вы первый игрок — вам выданы права администратора');
      if (r.token) {
        // Dev-режим: почта подтверждена автоматически
        await finish(r.token);
      } else {
        // Боевой режим: ждём подтверждения почты
        c.innerHTML = `
          <div class="title">📧 Подтвердите почту</div>
          <div class="card center">
            <p style="font-size:40px">✉️</p>
            <p class="mt">Регистрация прошла успешно!</p>
            <p class="mt">Письмо со ссылкой активации отправлено на <b>${UI.esc(r.email)}</b>.</p>
            <p class="muted small mt">📁 Если письмо не пришло в течение 5 минут — проверьте папку <b>Спам</b>.</p>
            <p class="muted small mt">Отправитель: <b>noreply@aliance-general.ru</b></p>
            <button class="btn btn-orange mt" onclick="App.go('auth')">✅ Уже подтвердил — войти</button>
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
    ['fame/alltime/level', '🏆', 'Зал славы', ''],
    ['skills', '📈', 'Навыки', m.skillPoints > 0 ? `<span class="badge">+${m.skillPoints}</span>` : ''],
    ['chat', '💬', 'Общение', ''],
    ['alliance', '🤝', 'Альянс', ''],
    ['bank', '🏦', 'Банк', ''],
    ['hospital', '🏥', 'Госпиталь', ''],
    ['mail', '✉', 'Почта', m.mailUnread > 0 ? `<span class="badge">${m.mailUnread}</span>` : ''],
    ['notifications', '🔔', 'Уведомления', m.notifUnread > 0 ? `<span class="badge">${m.notifUnread}</span>` : ''],
    ['ach', '🎖', 'Достижения', ''],
    ['trophies', '🎁', 'Трофеи', ''],
    ['settings', '⚙', 'Настройки', ''],
  ];

  // Вызов легиона — баннер для лидера клана (висит до истечения 5 минут)
  let legionChallengeBanner = '';
  try {
    if (m.legionId) {
      const lgd = await API.get('/api/legion');
      const LC = lgd.mine && lgd.mine.challenge;
      if (LC && LC.role === 'challenged' && LC.secondsLeft > 0) {
        legionChallengeBanner = `
          <div class="card" style="border:2px solid var(--red);background:rgba(220,50,50,.08)">
            <div class="name" style="color:var(--red)">⚔️ ВЫЗОВ НА БОЙ!</div>
            <p class="small mt">Легион <b>${UI.esc(LC.enemyName)}</b> вызывает ваш клан на бой!</p>
            <div class="kv mt"><span class="k">Осталось</span><span class="v" id="lcg-timer">${UI.fmtTimer(LC.secondsLeft)}</span></div>
            <button class="btn btn-green mt" onclick="App.go('legion')">Принять / отклонить →</button>
          </div>`;
      }
    }
  } catch(e) {}

  c.innerHTML = `
    ${legionChallengeBanner}
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
      <div class="kv"><span class="k">🚚 Техники в бою</span><span class="v">${UI.fmtNum(m.power.unitTaken || 0)} / ${UI.fmtNum(m.capacity)}</span></div>
      ${m.power.secretTaken > 0 ? `<div class="kv"><span class="k">🛸 Секретные разработки в бою</span><span class="v gold">${UI.fmtNum(m.power.secretTaken)} (вне лимита)</span></div>` : ''}
      <div class="kv"><span class="k">💵 Доход в час</span><span class="v money">$ ${UI.fmtMoney(m.incomePerHour)}</span></div>
      <div class="kv"><span class="k">🔧 Содержание в час</span><span class="v" style="color:var(--red)">$ ${UI.fmtMoney(m.upkeepPerHour)}</span></div>
      <div class="kv"><span class="k">⏱ Выплата через</span><span class="v">${UI.fmtTimer(m.nextPayoutSec)}</span></div>
    </div>
    <p class="center muted small">© generals-game · сделано в учебных целях</p>`;

  // Обратный отсчёт таймера вызова на главном экране
  const lcgTimer = document.getElementById('lcg-timer');
  if (lcgTimer) {
    let secs = parseInt(lcgTimer.textContent) || 0;
    const lcgT = setInterval(() => {
      secs--;
      if (secs <= 0) { clearInterval(lcgT); App.rerender(); return; }
      lcgTimer.textContent = UI.fmtTimer(secs);
    }, 1000);
  }
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
    ? (p.secretDevs || []).map((x) => `<div class="kv"><span class="k">${UI.esc(x.name)}</span><span class="v">×${x.count}</span></div>`).join('') +
      (p.superSecret ? `<div class="kv"><span class="k gold">🛸 Межконтинентальный ядерный комплекс «Диктатор»</span><span class="v gold">×${p.superSecret}</span></div>` : '')
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
          ${p.legion ? `<div class="muted small">Легион: <b style="cursor:pointer;color:var(--gold)" onclick="App._showPublicLegion('${p.legion.id}')">🏰 ${UI.esc(p.legion.name)}</b> <span style="font-size:10px">(${p.legion.rankName || 'Боец'})</span></div>` : '<div class="muted small">Без легиона</div>'}
        </div>
      </div>
      <div id="status-box">
        <p class="small mt" style="font-style:italic">${p.status ? UI.esc(p.status) : '<span class="muted">Статус не задан</span>'}</p>
        ${own ? '<a href="javascript:void 0" class="small" id="edit-status">редактировать статус</a>' : ''}
      </div>
      ${!own && p.canAttack ? `<button class="btn btn-orange mt" id="pf-attack">⚔ Атаковать</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-msg">✉ Написать сообщение</button>` : ''}
      ${!own && !isBot ? `<button class="btn btn-red mt" id="pf-sanction">📜 Объявить санкции</button>` : ''}
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
      ${p.isOwn && p.power ? `
      <div class="kv"><span class="k">⚔ Атака</span><span class="v">${UI.fmtNum(p.power.atk)}</span></div>
      <div class="kv"><span class="k">🛡 Защита</span><span class="v">${UI.fmtNum(p.power.def)}</span></div>` : ''}
      <div class="kv"><span class="k">🚚 Вместимость армии</span><span class="v">${UI.fmtNum(p.capacity)}</span></div>
      ${p.isOwn ? `
      <div class="kv"><span class="k">💥 Шанс крита</span><span class="v">${p.critChancePct}%</span></div>
      <div class="kv"><span class="k">🏃 Шанс уворота</span><span class="v">${p.dodgeChancePct}%</span></div>
      ${p.powerStats ? `<button class="btn mt" id="pf-stats-toggle" style="width:100%">📊 Подробная статистика</button>` : ''}` : ''}
      <hr class="hr">
      <div class="kv"><span class="k">Нападения</span><span class="v">${UI.fmtNum(p.battle.attacks)}</span></div>
      <div class="kv"><span class="k">Победы</span><span class="v">${UI.fmtNum(p.battle.wins)}</span></div>
      <div class="kv"><span class="k">Поражения</span><span class="v">${UI.fmtNum(p.battle.losses)}</span></div>
      <div class="kv"><span class="k">Оборона: отбито / сдано</span><span class="v">${UI.fmtNum(p.battle.defWins)} / ${UI.fmtNum(p.battle.defLosses)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">💀 Фаталити</span><span class="v">${UI.fmtNum(p.battle.fatalities)}</span></div>
      <div class="kv"><span class="k">👂 Отрезанные уши (трофеи)</span><span class="v">${UI.fmtNum(p.ears)}</span></div>
      <div class="kv"><span class="k">🏷 Жетоны милосердия</span><span class="v">${UI.fmtNum(p.tokens)}</span></div>
      <div class="kv"><span class="k">Потеряно своих ушей</span><span class="v">${UI.fmtNum(p.earsLost)}</span></div>
      <div class="kv"><span class="k">Свои уши сейчас</span><span class="v">${p.earsCurrent} / ${p.earsMax}${p.earPenaltyActive ? ' <span style="color:var(--red)">⚠ штраф −10%</span>' : ''}</span></div>
      ${own && p.earsCurrent < p.earsMax ? `<button class="btn btn-orange mt" id="pf-restore-ear" style="width:100%">👂 Восстановить ухо за <span class="ic-gold"></span> ${App.me.earRestoreCostGold || 20}</button>` : ''}
    </div>

    ${p.isOwn && p.powerStats ? `
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
        <div class="secret-row">
          <div class="img-frame img-frame-row ${l.id === 'zero_judgement' ? 'img-frame-super' : ''}">
            <img src="/img/secret/${l.id}.webp" alt="${UI.esc(l.name)}" loading="lazy" decoding="async">
          </div>
          <div class="secret-row-info">
            <div class="secret-row-name">${UI.esc(l.name)}</div>
            <div class="muted secret-row-stats">⚔ ${UI.fmtNum(l.atkTotal)} · 🛡 ${UI.fmtNum(l.defTotal)}</div>
          </div>
          <div class="gold secret-row-count">×${UI.fmtNum(l.count)}</div>
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

  const restoreEarBtn = document.getElementById('pf-restore-ear');
  if (restoreEarBtn) {
    restoreEarBtn.onclick = async () => {
      try {
        await API.post('/api/ears/restore');
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
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

  // ── Объявить санкции на игрока ────────────────────────────────
  const sanctionBtn = document.getElementById('pf-sanction');
  if (sanctionBtn) sanctionBtn.onclick = async () => {
    const have = App.me.dollars || 0;
    const raw = prompt(
      `Объявить санкции на «${p.name}».\n` +
      `Деньги будут списаны с вашего баланса немедленно.\n` +
      `Кто снизит HP цели до 5%, получит указанную сумму.\n` +
      `Минимум: $10 000. У вас: $${UI.fmtNum(have)}.\n\n` +
      `Введите сумму награды в долларах:`,
      '50000'
    );
    if (raw === null) return;
    const reward = parseInt(String(raw).replace(/\D/g, ''), 10);
    if (!reward || reward < 10000) { UI.toast('⛔ Минимум $10 000'); return; }
    if (!confirm(`Объявить контракт на $${UI.fmtNum(reward)}? Деньги спишутся сразу.`)) return;
    try {
      await API.post('/api/sanctions/declare', { targetId: p.id, reward });
      await App.refreshMe();
      UI.toast(`🎯 Контракт на ${p.name} объявлен за $${UI.fmtNum(reward)}`);
      App.go('war/sanctions');
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- НАВЫКИ ----------
App.screens.skills = async (c) => {
  await App.refreshMe();
  const m = App.me;
  // [id, лейбл, описание, сколько единиц даёт прокачка] — цена берётся
  // из m.skillCosts (приходит с сервера, всегда актуальна)
  const defs = [
    ['energy',  '⚡ Энергия',     'Расходуется в миссиях. +10 к максимуму за прокачку.', 10],
    ['health',  '❤ Здоровье',    'Ниже 25 — в бой нельзя. +10 к максимуму за прокачку.', 10],
    ['ammo',    '🎯 Боеприпасы', 'Сколько атак в запасе. +1 к максимуму.', 1],
    ['cruelty', '💀 Жестокость', '+0.5% к шансу крита и +0.5% к шансу фаталити (макс. 50% каждое).', 1],
    ['agility', '🏃 Ловкость',    '+0.5% к шансу увернуться от атаки и +0.5% ускользнуть от фаталити (макс. 50% каждое).', 1],
  ];

  c.innerHTML = `
    <div class="title">Навыки</div>
    <div class="card center">Неиспользовано: <b class="gold">${m.skillPoints}</b> очков навыков
      <p class="muted small mt">+5 очков за каждый уровень и за прохождение конфликтов</p></div>
    ${defs.map(([id, name, desc, plus]) => {
      const cost = m.skillCosts[id];
      return `
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div class="grow">
            <div class="name">${name} — <span class="gold">${m.skills[id]}</span></div>
            <div class="muted small">${desc}</div>
          </div>
          <button class="btn btn-orange btn-inline" data-skill="${id}" ${m.skillPoints < cost ? 'disabled' : ''}>+${plus} за ${cost} оч.</button>
        </div>
      </div>`;
    }).join('')}`;

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
      <div class="tab ${tab === 'reserve' ? 'active' : ''}" onclick="location.hash='#bank/reserve'">💱 Резерв</div>
      <div class="tab ${tab === 'gold'    ? 'active' : ''}" onclick="location.hash='#bank/gold'">🪙 Купить золото</div>
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

  if (tab === 'reserve') {
    const legionName = m.legion ? m.legion.name : null;
    c.innerHTML = `
      <div class="title">Банк · Резерв</div>
      ${tabs}
      <div class="card">
        <p class="muted small">Конвертируй доллары в Резервы для казны легиона.</p>
        <div class="kv mt"><span class="k">Курс</span><span class="v">1 000 $ = 1 Резерв</span></div>
        ${legionName
          ? `<div class="kv"><span class="k">Ваш легион</span><span class="v">${UI.esc(legionName)}</span></div>`
          : '<p class="muted small mt" style="color:var(--red)">⛔ Вы не состоите в легионе</p>'}
      </div>
      ${legionName ? `
      <div class="card">
        <label>Сумма ($)</label>
        <div class="field-row mt">
          <input type="number" id="res-amt" min="1000" step="1000" placeholder="мин. 1 000 $">
          <button class="btn btn-orange btn-inline" id="res-go">Зарезервировать</button>
        </div>
        <p class="muted small mt">Деньги списываются из ваших наличных и поступают в казну легиона как Резервы.</p>
      </div>` : ''}`;
    if (legionName) {
      document.getElementById('res-go').onclick = async () => {
        try {
          await API.post('/api/bank/reserve', { dollars: document.getElementById('res-amt').value });
          await App.refreshMe();
          App.rerender();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    }
    return;
  }

  // Вкладка «Хранилище»
  c.innerHTML = `
    <div class="title">Банк · Хранилище</div>
    ${tabs}
    <div class="card">
      <div class="kv"><span class="k">Наличные</span><span class="v money">$ ${UI.fmtNum(m.dollars)}</span></div>
      <div class="kv"><span class="k">В хранилище</span><span class="v money">$ ${UI.fmtNum(m.bank)}</span></div>
      <p class="muted small mt">При вложении снимается комиссия 10%. Деньги в хранилище нельзя ограбить.</p>
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
  document.getElementById('bk-wd-go').onclick  = op('withdraw', 'bk-wd');
};

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
