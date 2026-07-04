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
      <p class="center mt"><a href="javascript:void 0" id="li-forgot" class="small">Забыли пароль?</a></p>
    </div>

    <div class="card" id="form-forgot" style="display:none">
      <p class="muted small">Введите позывной или email — мы отправим ссылку для восстановления пароля на вашу почту.</p>
      <label for="fg-id">Позывной или email</label>
      <input type="text" id="fg-id" placeholder="Позывной или your@email.com">
      <button class="btn btn-orange mt" id="fg-go">Отправить ссылку</button>
      <p class="center mt"><a href="javascript:void 0" id="fg-back" class="small">← Назад ко входу</a></p>
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
      <div id="rg-country-bonus" class="card" style="margin-top:8px;background:rgba(233,199,92,.06);border-color:var(--gold)">
        <div style="display:flex;align-items:center;gap:10px">
          <span id="rg-flag" style="font-size:32px"></span>
          <div>
            <div id="rg-cname" style="font-weight:bold;color:var(--gold)"></div>
            <div id="rg-cbonus" class="small" style="color:var(--text)"></div>
          </div>
        </div>
      </div>
      <button class="btn btn-orange mt" id="rg-go">Подписать контракт</button>
    </div>`;

  // Показ бонуса выбранной страны
  const updateCountryBonus = () => {
    const sel = document.getElementById('rg-country');
    if (!sel) return;
    const ct = countries.find((x) => x.id === sel.value);
    if (!ct) return;
    document.getElementById('rg-flag').textContent = ct.flag;
    document.getElementById('rg-cname').textContent = ct.name;
    document.getElementById('rg-cbonus').innerHTML = '🎖 ' + UI.esc(ct.desc || ct.bonus || '') + (ct.gold ? ` <span class="gold">(+🪙 ${ct.gold} на старте)</span>` : '');
  };

  // Переключение вкладок входа/регистрации
  const show = (login) => {
    document.getElementById('form-login').style.display = login ? '' : 'none';
    document.getElementById('form-reg').style.display = login ? 'none' : '';
    document.getElementById('tab-login').classList.toggle('active', login);
    document.getElementById('tab-reg').classList.toggle('active', !login);
  };
  document.getElementById('tab-login').onclick = () => show(true);
  document.getElementById('tab-reg').onclick = () => show(false);
  // Обновление блока бонуса страны
  const countrySel = document.getElementById('rg-country');
  if (countrySel) { countrySel.onchange = updateCountryBonus; updateCountryBonus(); }

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

  // Восстановление пароля
  const showForgot = (on) => {
    document.getElementById('form-login').style.display = on ? 'none' : '';
    document.getElementById('form-forgot').style.display = on ? '' : 'none';
  };
  document.getElementById('li-forgot').onclick = () => showForgot(true);
  document.getElementById('fg-back').onclick = () => showForgot(false);
  document.getElementById('fg-go').onclick = async () => {
    const id = document.getElementById('fg-id').value.trim();
    if (!id) { UI.toast('⛔ Введите позывной или email'); return; }
    try {
      await API.post('/api/request-password-reset', { loginOrEmail: id });
      UI.toast('📧 Если аккаунт существует, письмо со ссылкой отправлено на почту');
      showForgot(false);
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
  // Прямой доступ ко всем разделам. Достижения и внешний вид — внутри
  // профиля. Событие — во вкладке «Война» (бои). Ежедневный вход — авто.
  const small = [
    ['profile', '👤', 'Профиль', ''],
    ['skills', '📈', 'Навыки', m.skillPoints > 0 ? `<span class="badge">+${m.skillPoints}</span>` : ''],
    ['alliance', '🤝', 'Альянс', ''],
    ['fame/alltime/level', '🏆', 'Зал славы', ''],
    ['chat', '💬', 'Общение', ''],
    ['mail', '✉', 'Почта', m.mailUnread > 0 ? `<span class="badge">${m.mailUnread}</span>` : ''],
    ['notifications', '🔔', 'Уведомления', m.notifUnread > 0 ? `<span class="badge">${m.notifUnread}</span>` : ''],
    ['trophies', '🎁', 'Трофеи', ''],
    ['dailytasks', '📋', 'Ежедневные задания', ''],
    ['season', '🏆', 'Сезон', ''],
    ['referral', '🎁', 'Пригласить друга', ''],
    ['bank', '🏦', 'Банк', ''],
    ['hospital', '🏥', 'Госпиталь', ''],
    ['shop', '💎', 'Магазин золота', ''],
    ['support', '🛟', 'Поддержка', m.supportUnread > 0 ? `<span class="badge">${m.supportUnread}</span>` : ''],
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
    <button class="btn" style="width:100%;margin-top:8px" onclick="App.go('support')">🛟 Служба поддержки</button>
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
// ---------- Ежедневные задания (контракты) ----------
App.screens.dailytasks = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/contracts');
  c.innerHTML = `
    <div class="title">📋 Ежедневные задания</div>
    <p class="muted small" style="margin:-4px 4px 10px">Задания от штаба. Обновляются каждый день в 00:00 МСК. Выполняйте и забирайте награду.</p>
    ${d.contracts.length ? d.contracts.map((ct) => `
      <div class="card">
        <div class="name">${UI.esc(ct.name)} ${ct.claimed ? '<span class="badge">✅ выполнено</span>' : ''}</div>
        <p class="muted small">${UI.esc(ct.desc)}</p>
        ${UI.bar(ct.current, ct.target, 'xp', `${ct.current} / ${ct.target}`)}
        <div class="kv mt"><span class="k">Награда</span><span class="v gold">🪙 ${ct.reward}</span></div>
        ${!ct.claimed ? `<button class="btn btn-orange mt" data-claim="${ct.id}" ${ct.done ? '' : 'disabled'} style="width:100%">${ct.done ? 'Забрать награду' : 'Не выполнено'}</button>` : ''}
      </div>`).join('') : '<div class="card center muted">Заданий нет. Загляните позже.</div>'}`;
  c.querySelectorAll('[data-claim]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/contracts/claim', { contractId: b.dataset.claim }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
};

App.screens.profile = async (c, param) => {
  const id = param || App.me.id;
  const { profile: p } = await API.get('/api/profile/' + encodeURIComponent(id));
  const own = p.id === App.me.id;

  const isBot = !!p.isBot;
  // Армия врага скрыта — рассекречивается разведкой (трофей «Спутник-шпион»).
  // Свои/открытые данные берём из p, разведданные по чужим — из p.spyIntel.
  const intel = p.spyIntel || null;
  const armyOpen = own || !p.hideArmy;
  const lockMsg = (what, hint) => `<p class="muted">🔒 ${what} скрыты.${hint ? ' ' + hint : ' Используйте «🛰 Разведку», чтобы рассекретить.'}</p>`;

  // --- Техника ---
  let unitsHtml;
  if (armyOpen) {
    unitsHtml = (!isBot && p.units && p.units.length)
      ? UI.imgGrid(p.units, 'units') : '<p class="muted">Ангар не разглашается.</p>';
  } else if (intel && intel.units) {
    unitsHtml = intel.units.length
      ? UI.imgGrid(intel.units, 'units') : '<p class="muted">Техники не обнаружено.</p>';
  } else {
    unitsHtml = lockMsg('Техника');
  }

  // --- Секретные разработки (сеткой картинок, kind='secret') ---
  let devsHtml;
  const secretItems = [];
  if (armyOpen) {
    if (!isBot) {
      for (const x of (p.secretDevs || [])) secretItems.push(x);
      if (p.superDevInfo) secretItems.push(p.superDevInfo);
    }
    devsHtml = secretItems.length ? UI.imgGrid(secretItems, 'secret') : '<p class="muted">Секретных разработок нет.</p>';
  } else if (intel && intel.secretDevs) {
    for (const x of (intel.secretDevs || [])) secretItems.push(x);
    if (intel.superDevInfo) secretItems.push(intel.superDevInfo);
    devsHtml = secretItems.length ? UI.imgGrid(secretItems, 'secret') : '<p class="muted">Секретных разработок не обнаружено.</p>';
  } else {
    devsHtml = lockMsg('Секретные разработки', intel ? 'Нужен «Спутник-шпион» 8+ ур.' : '');
  }

  // --- Постройки (доходные + оборонительные) ---
  let buildingsHtml;
  const bSource = armyOpen ? (!isBot && p.buildings ? p.buildings : null)
                           : (intel && intel.buildings ? intel.buildings : null);
  if (armyOpen && !bSource) {
    buildingsHtml = '<p class="muted">Постройки не разглашаются.</p>';
  } else if (!armyOpen && !bSource) {
    buildingsHtml = lockMsg('Постройки', intel ? 'Нужен «Спутник-шпион» 5+ ур.' : '');
  } else {
    const incomeB = bSource.filter((x) => x.kind === 'income');
    const defenseB = bSource.filter((x) => x.kind !== 'income');
    buildingsHtml = (!incomeB.length && !defenseB.length)
      ? '<p class="muted">Построек не обнаружено.</p>'
      : `${incomeB.length ? `<p class="small" style="margin:4px 0">💵 Доходные</p>${UI.imgGrid(incomeB, 'buildings')}` : ''}
         ${defenseB.length ? `<p class="small" style="margin:10px 0 4px">🛡 Оборонительные (защита базы)</p>${UI.imgGrid(defenseB, 'buildings')}` : ''}`;
  }

  // --- Баннер разведданных (точность + свежесть) ---
  let intelBanner = '';
  if (!own && intel) {
    const acc = [`техника ${intel.accUnits}%`];
    if (intel.accBuild != null)  acc.push(`постройки ${intel.accBuild}%`);
    if (intel.accSecret != null) acc.push(`секретки ${intel.accSecret}%`);
    let fresh;
    if (intel.live && intel.liveUntil) {
      const leftH = Math.max(0, Math.floor((intel.liveUntil - Date.now()) / 3600000));
      fresh = `🟢 Live — данные в реальном времени, ещё ~${leftH} ч`;
    } else {
      const d = new Date(intel.at);
      fresh = `📅 Снимок от ${d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — мог устареть`;
    }
    intelBanner = `<div class="card" style="border-color:var(--gold)">
      <div class="name">🛰 Разведданные</div>
      <p class="muted small">Точность: ${acc.join(', ')}. Числа приблизительны — реальные значения в пределах ± по точности.</p>
      <p class="small">${fresh}</p>
    </div>`;
  }

  c.innerHTML = `
    <div class="title">Личное дело</div>
    <div class="card pf-card ${p.profileBg ? UI.esc(p.profileBg) : ''}">
      <div class="list-row">
        <div class="pf-avatar ${p.profileFrame ? UI.esc(p.profileFrame) : ''}">${p.online ? '🟢' : '⚪'}</div>
        <div class="grow">
          <div class="name" style="font-size:17px">${p.flag} ${UI.esc(p.name)}</div>
          ${p.activeTitle ? `<div class="pf-title">🏅 ${UI.esc(p.activeTitle)}</div>` : ''}
          <div class="muted small">Звание: <b>${UI.esc(p.rank)}</b> · Ур. ${p.level} · Рейтинг ${UI.fmtNum(p.rating)}</div>
          ${p.countryName ? `<div class="muted small">${p.flag} ${UI.esc(p.countryName)}: ${UI.esc(p.countryBonus || '')}</div>` : ''}
          <div class="muted small">${(p.alliance && p.alliance.members) ? 'Альянс: <b>' + p.alliance.members + ' бойцов</b>' : 'Без альянса'}</div>
          ${p.legion ? `<div class="muted small">Легион: <b style="cursor:pointer;color:var(--gold)" onclick="App._showPublicLegion('${p.legion.id}')">🏰 ${UI.esc(p.legion.name)}</b> <span style="font-size:10px">(${p.legion.rankName || 'Боец'})</span></div>` : '<div class="muted small">Без легиона</div>'}
        </div>
      </div>
      <div id="status-box">
        <p class="small mt" style="font-style:italic">${p.status ? UI.esc(p.status) : '<span class="muted">Статус не задан</span>'}</p>
        ${own ? '<a href="javascript:void 0" class="small" id="edit-status">редактировать статус</a>' : ''}
      </div>
      ${!own && p.canAttack ? `<button class="btn btn-orange mt" id="pf-attack">⚔ Атаковать</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-spy">🔭 Разведка (шпионаж)</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-msg">✉ Написать сообщение</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-sanction" style="border-color:var(--red);color:var(--red)">🎯 Объявить санкции</button>` : ''}
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
      ${p.earCutInfo && p.earCutInfo.left ? `<div class="kv"><span class="k" style="color:var(--red)">✂️ Левое ухо у</span><span class="v"><a href="#" onclick="App.go('profile/${p.earCutInfo.left.id}');return false" style="color:var(--gold)">${UI.esc(p.earCutInfo.left.name)}</a></span></div>` : ''}
      ${p.earCutInfo && p.earCutInfo.right ? `<div class="kv"><span class="k" style="color:var(--red)">✂️ Правое ухо у</span><span class="v"><a href="#" onclick="App.go('profile/${p.earCutInfo.right.id}');return false" style="color:var(--gold)">${UI.esc(p.earCutInfo.right.name)}</a></span></div>` : ''}
      ${p.earMessage ? `<div style="margin-top:8px;padding:10px;border:1px solid var(--red);border-radius:8px;background:rgba(255,60,60,.08)"><div class="muted small">✍️ Послание от <a href="#" onclick="App.go('profile/${p.earMessage.byId}');return false" style="color:var(--gold)">${UI.esc(p.earMessage.byName)}</a>:</div><div style="margin-top:4px;font-style:italic">«${UI.esc(p.earMessage.text)}»</div></div>` : ''}
      ${own && p.earsCurrent < p.earsMax ? `<button class="btn btn-orange mt" id="pf-restore-ear" style="width:100%">👂 Восстановить ухо за <span class="ic-gold"></span> ${App.me.earRestoreCostGold || 20}</button>` : ''}
    </div>

    ${own ? `
    <div class="card">
      <div class="title" style="margin-top:0">Разделы профиля</div>
      <div class="menu-grid">
        <div class="menu-btn small-row" onclick="App.go('ach')"><span class="ic">🎖</span>Достижения</div>
        <div class="menu-btn small-row" onclick="App.go('titles')"><span class="ic">🏅</span>Титулы</div>
        <div class="menu-btn small-row" onclick="App.go('cosmetics')"><span class="ic">🎨</span>Внешний вид</div>
      </div>
    </div>` : ''}

    ${(p.activeEffects && p.activeEffects.length) ? `
    <div class="card">
      <div class="title" style="margin-top:0">✨ Активные эффекты</div>
      ${p.activeEffects.map(e => `
        <div class="kv">
          <span class="k" style="${e.hostile?'color:var(--red)':''}">${e.hostile?'😈':'💉'} ${UI.esc(e.name)} <span class="muted small">(${UI.esc(e.desc)})</span>${e.byName?` <span class="muted small">— от <b style="color:var(--gold)">${UI.esc(e.byName)}</b></span>`:''}</span>
          <span class="v">${UI.esc(e.timeLeft)}</span>
        </div>`).join('')}
    </div>` : ''}

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

    ${intelBanner}
    <div class="card"><div class="title" style="margin-top:0">Техника</div>${unitsHtml}</div>
    <div class="card"><div class="title" style="margin-top:0">Секретные разработки</div>${devsHtml}</div>
    <div class="card"><div class="title" style="margin-top:0">Постройки</div>${buildingsHtml}</div>`;

  // Редактирование собственного статуса
  if (own) {
    document.getElementById('edit-status').onclick = async () => {
      const text = await UI.prompt('', {title:'Новый статус', icon:'✍️', value:p.status||'', placeholder:'Ваш девиз...', multiline:true, maxLength:120, hint:'До 120 символов', okText:'Сохранить'});
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
    const btnSpy = document.getElementById('pf-spy');
    if (btnSpy) btnSpy.onclick = async () => {
      try {
        const r = await API.post('/api/spy', { targetId: p.id });
        await App.refreshMe();
        UI.toast(r.live
          ? '🛰 Спутник-шпион ведёт цель в реальном времени (3 дня)'
          : `🔭 Разведка проведена. Осталось бесплатной: ${r.spyLeft} (далее 🪙 20)`);
        App.rerender(); // перерисовать профиль — данные раскроются ниже
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    const btnMsg = document.getElementById('pf-msg');
    if (btnMsg) btnMsg.onclick = async () => {
      const subject = await UI.prompt('', {title:'Письмо игроку ' + p.name, icon:'✉️', value:'Привет, ' + p.name, placeholder:'Тема письма', okText:'Далее'});
      if (subject === null) return;
      const text = await UI.prompt('', {title:'Текст письма', icon:'✉️', placeholder:'Ваше сообщение...', multiline:true, maxLength:500, okText:'Отправить'});
      if (!text) return;
      API.post('/api/mail', { toName: p.name, subject, text })
        .then(() => UI.toast('✉ Сообщение отправлено игроку ' + p.name))
        .catch((e) => UI.toast('⛔ ' + e.message));
    };

    const btnSanction = document.getElementById('pf-sanction');
    if (btnSanction) btnSanction.onclick = async () => {
      const amountStr = await UI.prompt(`Награда из вашего кармана (минимум 1000 $). Деньги спишутся сразу. Кто снизит HP цели до ≤5% — заберёт награду.`, {title:`Санкция на ${p.name}`, icon:'🎯', type:'number', placeholder:'Сумма $', okText:'Далее'});
      if (amountStr === null) return;
      const amount = parseInt(String(amountStr).replace(/\D/g, ''), 10);
      if (!amount || amount < 1000) { UI.toast('⛔ Минимум 1000 $'); return; }
      if (!await UI.confirm(`Списать $${UI.fmtNum(amount)} и объявить санкцию на «${p.name}»?`, {title:'Подтверждение', icon:'🎯', okText:'Объявить', danger:true})) return;
      try {
        const r = await API.post('/api/sanctions/declare', { targetId: p.id, amount });
        await App.refreshMe();
        UI.toast(`🎯 Санкция объявлена! Награда за цель: $${UI.fmtNum(r.bounty)}`);
      } catch (e) { UI.toast('⛔ ' + e.message); }
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

// ---------- СЛУЖБА ПОДДЕРЖКИ (обращения игрока) ----------
App.screens.support = async (c, param) => {
  await App.refreshMe();
  const tab = param || 'open'; // open | closed | new
  const data = await API.get('/api/support');

  const statusBadge = (s) => {
    if (s === 'open') return '<span class="badge" style="background:var(--orange-1)">ожидает ответа</span>';
    if (s === 'answered') return '<span class="badge" style="background:var(--green)">есть ответ</span>';
    return '<span class="badge">закрыто</span>';
  };

  const ticketCard = (t) => `
    <div class="card">
      <div class="name" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${UI.esc(t.subject)}</span> ${statusBadge(t.status)}
      </div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
        ${t.messages.map((m) => `
          <div style="padding:8px 10px;border-radius:8px;background:${m.from === 'admin' ? 'rgba(60,180,90,.1)' : 'rgba(255,255,255,.03)'};border:1px solid ${m.from === 'admin' ? 'var(--green)' : 'var(--border)'}">
            <div class="muted small">${m.from === 'admin' ? '🛟 Поддержка' : '👤 ' + UI.esc(m.authorName)} · ${new Date(m.at).toLocaleString('ru-RU')}</div>
            <div style="margin-top:3px;white-space:pre-wrap">${UI.esc(m.text)}</div>
          </div>`).join('')}
      </div>
      ${t.status !== 'closed' ? `
        <div class="field-row mt">
          <input type="text" id="reply-${t.id}" placeholder="Добавить сообщение...">
          <button class="btn btn-orange btn-inline" data-reply="${t.id}">Отправить</button>
        </div>` : ''}
    </div>`;

  let body;
  if (tab === 'new') {
    body = `
      <div class="card">
        <div class="name">📝 Новое обращение</div>
        <p class="muted small">Опишите проблему — администрация ответит здесь же.</p>
        <input type="text" id="sup-subject" maxlength="80" placeholder="Тема обращения" class="mt" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)">
        <textarea id="sup-text" maxlength="2000" rows="5" placeholder="Опишите ситуацию и проблему подробно..." class="mt" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);resize:vertical"></textarea>
        <button class="btn btn-orange mt" id="sup-send" style="width:100%">Отправить обращение</button>
      </div>`;
  } else {
    const list = tab === 'open' ? data.open : data.closed;
    body = list.length
      ? list.map(ticketCard).join('')
      : `<div class="card center muted">${tab === 'open' ? 'Нет открытых обращений' : 'Нет закрытых обращений'}</div>`;
  }

  c.innerHTML = `
    <div class="title">🛟 Служба поддержки</div>
    <div class="tabs">
      <div class="tab ${tab === 'open' ? 'active' : ''}" onclick="App.go('support/open')">Открытые (${data.open.length})</div>
      <div class="tab ${tab === 'closed' ? 'active' : ''}" onclick="App.go('support/closed')">Закрытые (${data.closed.length})</div>
      <div class="tab ${tab === 'new' ? 'active' : ''}" onclick="App.go('support/new')">➕ Новое</div>
    </div>
    ${body}`;

  const R = (id) => document.getElementById(id);
  if (R('sup-send')) R('sup-send').onclick = async () => {
    try {
      await API.post('/api/support/create', { subject: R('sup-subject').value, text: R('sup-text').value });
      UI.toast('✅ Обращение отправлено');
      App.go('support/open');
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-reply]').forEach((btn) => {
    btn.onclick = async () => {
      const inp = R('reply-' + btn.dataset.reply);
      if (!inp || !inp.value.trim()) return;
      try {
        await API.post('/api/support/reply', { ticketId: btn.dataset.reply, text: inp.value });
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
};

// ---------- МАГАЗИН ЗОЛОТА (заготовка платёжной системы) ----------
App.screens.shop = async (c) => {
  await App.refreshMe();
  const data = await API.get('/api/payments/packages');
  const { orders } = await API.get('/api/payments/orders');

  c.innerHTML = `
    <div class="title">💎 Магазин золота</div>
    ${!data.enabled ? `<div class="card center"><p class="muted">${UI.esc(data.note || 'Скоро')}</p></div>` : ''}
    ${data.packages.map((p) => `
      <div class="card">
        <div class="name">${UI.esc(p.label)} ${p.bonus ? `<span class="badge" style="background:var(--green)">${p.bonus}</span>` : ''}</div>
        <div class="kv mt"><span class="k"><span class="ic-gold"></span> ${UI.fmtNum(p.gold)} золота</span><span class="v gold">${p.priceRub} ₽</span></div>
        <button class="btn btn-orange mt" data-buy-pkg="${p.id}" style="width:100%">Купить</button>
      </div>`).join('')}
    ${orders.length ? `
      <div class="card">
        <div class="name">🧾 История заказов</div>
        ${orders.map((o) => `
          <div class="kv"><span class="k">🪙 ${UI.fmtNum(o.gold)} · ${o.priceRub} ₽</span>
            <span class="v">${o.status === 'paid' ? '✅ оплачено' : o.status === 'pending' ? '⏳ ожидает' : '❌ ' + o.status}</span></div>`).join('')}
      </div>` : ''}`;

  c.querySelectorAll('[data-buy-pkg]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const r = await API.post('/api/payments/create', { packageId: btn.dataset.buyPkg });
        if (r.payUrl) { window.location.href = r.payUrl; }
        else { UI.toast('🛒 Заказ создан. Онлайн-оплата скоро будет доступна.'); App.rerender(); }
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
};

// ========== НОВЫЕ СИСТЕМЫ ==========

// ---------- Ежедневный вход ----------
// ---------- Титулы ----------
App.screens.titles = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/titles');
  // Группируем титулы по достижению (achName)
  const groups = {};
  for (const t of d.list) {
    if (!groups[t.achName]) groups[t.achName] = [];
    groups[t.achName].push(t);
  }
  const unlockedCount = d.list.filter((t) => t.unlocked).length;
  c.innerHTML = `
    <div class="title">🏅 Титулы</div>
    <p class="muted small" style="margin:-4px 4px 10px">Титулы открываются за ступени достижений. Разблокировано: <b class="gold">${unlockedCount}</b> из ${d.list.length}. Выбранный отображается в профиле.</p>
    <div class="card">
      <button class="btn ${!d.active ? 'btn-orange' : ''}" data-title="" style="width:100%">Без титула</button>
    </div>
    ${Object.entries(groups).map(([achName, titles]) => `
      <div class="card">
        <div class="name">🎖 ${UI.esc(achName)}</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${titles.map((t) => `
            <div style="display:flex;align-items:center;gap:8px;${!t.unlocked ? 'opacity:.5' : ''}">
              <span style="flex:0 0 22px;text-align:center">${t.unlocked ? '🏅' : '🔒'}</span>
              <div style="flex:1">
                <div style="font-weight:bold;font-size:14px">${UI.esc(t.name)} ${d.active === t.id ? '<span class="badge">надет</span>' : ''}</div>
                <div class="muted small">Ступень ${t.step}/5 · нужно ${UI.fmtNum(t.target)}</div>
              </div>
              ${t.unlocked
                ? `<button class="btn btn-inline ${d.active === t.id ? 'btn-orange' : ''}" data-title="${t.id}">${d.active === t.id ? '✓' : 'Надеть'}</button>`
                : ''}
            </div>`).join('')}
        </div>
      </div>`).join('')}`;
  c.querySelectorAll('[data-title]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/titles/set', { titleId: b.dataset.title }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
};

// ---------- Рейтинговый сезон ----------
App.screens.season = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/season');
  c.innerHTML = `
    <div class="title">🏆 Рейтинговый сезон</div>
    <div class="card">
      <div class="kv"><span class="k">Ваш рейтинг</span><span class="v gold">${UI.fmtNum(d.myRating)}</span></div>
      <div class="kv"><span class="k">Ваше место</span><span class="v">${d.myRank ? '#' + d.myRank : '—'}</span></div>
      <p class="muted small mt">Рейтинг растёт за победы в боях (+10 за победу). По итогам сезона топ-3 получают награды, рейтинг обнуляется.</p>
    </div>
    <div class="card">
      <div class="title" style="margin-top:0">Топ-20 сезона</div>
      ${d.top.length ? d.top.map((p, i) => `
        <div class="list-row">
          <div class="grow">${i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} <span class="name" onclick="App.go('profile/${p.id}')" style="cursor:pointer">${p.flag} ${UI.esc(p.name)}</span></div>
          <span class="gold">${UI.fmtNum(p.rating)}</span>
        </div>`).join('') : '<p class="muted center">Сезон только начался — рейтинг пока пуст.</p>'}
    </div>`;
};

// ---------- Мировое событие (босс) ----------
App.screens.event = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/event');
  if (d.scheduled) {
    c.innerHTML = `
      <div class="title">🐉 Скоро событие</div>
      <div class="card center">
        <p style="font-size:40px">⏳</p>
        <p class="mt"><b class="gold" style="font-size:18px">${UI.esc(d.name)}</b></p>
        <p class="muted">Событие начнётся через:</p>
        <p style="font-size:28px;font-weight:bold;color:var(--orange)" id="event-countdown">${UI.fmtTimer(d.startsInSec)}</p>
        <p class="muted small">Готовьте армию к бою!</p>
      </div>`;
    // Тикаем таймер
    let left = d.startsInSec;
    const el = document.getElementById('event-countdown');
    const iv = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(iv); App.rerender(); return; }
      if (el) el.textContent = UI.fmtTimer(left);
    }, 1000);
    return;
  }
  if (!d.active) {
    // Нет активного события — показываем итоги прошлого, если они есть
    if (d.lastResult) {
      const lr = d.lastResult;
      const medal = (i) => ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
      c.innerHTML = `
        <div class="title">🏁 Итоги события</div>
        <div class="card center">
          <p style="font-size:34px">${lr.stopped ? '🛑' : '🏆'}</p>
          <p><b class="gold" style="font-size:17px">${UI.esc(lr.name)}</b></p>
          <p class="muted small">${lr.stopped ? 'Событие остановлено администратором' : 'Босс повержен!'}</p>
          ${lr.killerName ? `<p class="small">⚔️ Последний удар: <b>${UI.esc(lr.killerName)}</b></p>` : ''}
        </div>
        <div class="card">
          <div class="name">📊 Рейтинг участников</div>
          <p class="muted small">Урон по боссу и число атак каждого бойца.</p>
          <div style="margin-top:8px">
            ${lr.ranking.length ? lr.ranking.map((r, i) => `
              <div class="list-row">
                <div class="grow">${medal(i)} <span class="name">${UI.esc(r.name)}</span>
                  ${i < 3 && lr.rewards[i] > 0 ? `<span class="gold small"> +🪙${lr.rewards[i]}</span>` : ''}
                </div>
                <div style="text-align:right">
                  <div class="gold small">${UI.fmtNum(r.damage)} урона</div>
                  <div class="muted small">${r.attacks} ${r.attacks === 1 ? 'атака' : 'атак'}</div>
                </div>
              </div>`).join('') : '<p class="muted center">Никто не успел атаковать.</p>'}
          </div>
        </div>
        <p class="muted small center">Следующее событие запустит администратор.</p>`;
      return;
    }
    c.innerHTML = `
      <div class="title">🐉 Мировое событие</div>
      <div class="card center"><p style="font-size:40px">😴</p><p class="muted">Сейчас нет активного события. Следите за объявлениями!</p></div>`;
    return;
  }
  // Активное событие
  const dropInfo = (d.dropMax > 0 && d.goldPoolLeft > 0)
    ? `🪙 ${d.dropMin}–${d.dropMax} с шансом ${d.dropChance}%`
    : 'пул исчерпан';
  const canAttack = App.me.res.am.cur > 0 && App.me.res.hp.cur >= 25;

  // Персональный лог атак (клиентский, у каждого игрока свой). Сбрасываем
  // при смене события, чтобы не смешивать лог разных боссов.
  if (App._eventLogKey !== d.name) { App._eventLogKey = d.name; App._eventLog = []; }
  const logHtml = (App._eventLog && App._eventLog.length)
    ? App._eventLog.map((l) => `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span class="muted small">${l.time}</span> <span class="small">${l.text}</span></div>`).join('')
    : '<p class="muted small center" style="padding:8px 0">Пока нет атак — ударьте по боссу!</p>';

  c.innerHTML = `
    <div class="title">🐉 ${UI.esc(d.name)}</div>
    <div class="card">
      <p class="muted small">Общий враг! Атакуйте босса — тратится боеприпас, как в обычном бою. Бейте сколько хватит патронов и здоровья. За атаки капает золото, а лучшие по урону и добивший получат награду.</p>
      <div style="margin:10px 0">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
          <span class="muted">❤️ Здоровье босса</span><span style="font-weight:bold;color:var(--${d.hpPct > 50 ? 'green' : d.hpPct > 20 ? 'orange' : 'red'})">${UI.fmtNum(d.hp)} / ${UI.fmtNum(d.maxHp)} (${d.hpPct}%)</span>
        </div>
        <div style="height:14px;background:rgba(255,255,255,.08);border-radius:7px;overflow:hidden">
          <div style="height:100%;width:${d.hpPct}%;background:linear-gradient(90deg,var(--red),var(--orange));transition:width .4s"></div>
        </div>
      </div>
      <div class="kv"><span class="k">🪙 Золото за атаку</span><span class="v gold">${dropInfo}</span></div>
      <div class="kv"><span class="k">💰 Осталось в пуле</span><span class="v gold">🪙 ${UI.fmtNum(d.goldPoolLeft)}</span></div>
      <div class="kv"><span class="k">🏆 Награда за добивание</span><span class="v gold">🪙 ${UI.fmtNum(d.killReward)}</span></div>
      <div class="kv"><span class="k">🥇🥈🥉 Топ-3 по урону</span><span class="v gold">🪙 ${d.top3.map((x) => UI.fmtNum(x)).join(' / ')}</span></div>
      <div class="kv"><span class="k">💥 Ваш урон / атак</span><span class="v">${UI.fmtNum(d.myDamage)} / ${d.myAttacks}</span></div>
      <div class="kv"><span class="k">👥 Участников</span><span class="v">${d.contributorsCount}</span></div>
      <button class="btn btn-orange mt" id="event-attack" ${!canAttack ? 'disabled' : ''} style="width:100%">
        ${canAttack ? '⚔️ Атаковать босса (−1 🎯)' : (App.me.res.am.cur <= 0 ? 'Нет боеприпасов' : 'Здоровье ниже 25')}
      </button>
    </div>
    <div class="card">
      <div class="name">🏆 Рейтинг по урону</div>
      <p class="muted small">Обновляется по мере атак. Топ-3 получат награду, добивший — бонус за килл.</p>
      <div style="margin-top:8px">
        ${(d.ranking && d.ranking.length) ? d.ranking.map((r, i) => {
          const me = r.id === App.me.id;
          const place = i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.';
          return `<div class="list-row" style="${me ? 'background:rgba(255,180,0,.10);border-radius:8px;padding:4px 6px' : ''}">
            <div class="grow">${place} <span class="name" onclick="App.go('profile/${r.id}')" style="cursor:pointer">${UI.esc(r.name)}</span>${me ? ' <span class="gold small">(вы)</span>' : ''}</div>
            <div style="text-align:right">
              <div class="gold small">${UI.fmtNum(r.damage)} урона</div>
              <div class="muted small">${r.attacks} ${r.attacks === 1 ? 'атака' : 'атак'}</div>
            </div>
          </div>`;
        }).join('') : '<p class="muted center small" style="padding:8px 0">Пока никто не атаковал — станьте первым!</p>'}
      </div>
      ${d.myRank > 20 ? `<hr class="hr"><p class="muted small center">Вы вне топ-20 · место ${d.myRank}: <b class="gold">${UI.fmtNum(d.myDamage)}</b> урона</p>` : ''}
    </div>
    <div class="card">
      <div class="name">📜 Лог ваших атак</div>
      <div id="event-log" style="margin-top:6px;max-height:240px;overflow-y:auto">${logHtml}</div>
    </div>`;
  const btn = document.getElementById('event-attack');
  if (btn && canAttack) btn.onclick = async () => {
    try {
      const r = await API.post('/api/event/attack');
      // Запись в персональный лог атак (у каждого игрока свой)
      const text = r.finished
        ? `🏆 <b>Добивание!</b> Урон ${UI.fmtNum(r.dealtDamage)}${r.crit ? ' <span class="gold">🔥КРИТ</span>' : ''} — босс повержен${r.killReward > 0 ? `, награда 🪙${r.killReward}` : ''}`
        : `💥 Урон <b>${UI.fmtNum(r.dealtDamage)}</b>${r.crit ? ' <span class="gold">🔥КРИТ</span>' : ''}${r.goldDrop > 0 ? ` · выпало 🪙${r.goldDrop}` : ''}`;
      const entry = { time: new Date().toLocaleTimeString('ru-RU'), text };
      if (!App._eventLog) App._eventLog = [];
      App._eventLog.unshift(entry);
      if (App._eventLog.length > 50) App._eventLog.length = 50;
      // Мгновенно показываем строку в логе (ещё до перерисовки экрана)
      const logEl = document.getElementById('event-log');
      if (logEl) {
        const row = `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span class="muted small">${entry.time}</span> <span class="small">${entry.text}</span></div>`;
        if (App._eventLog.length === 1) logEl.innerHTML = row;       // убрать плейсхолдер
        else logEl.insertAdjacentHTML('afterbegin', row);
      }
      // Сверху — ТОЛЬКО уведомление о выпавшем золоте
      if (r.goldDrop > 0) UI.toast(`🪙 Выпало золото: ${UI.fmtNum(r.goldDrop)}!`);
      await App.refreshMe(); App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- Реферальная система ----------
App.screens.referral = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/referral');
  c.innerHTML = `
    <div class="title">🎁 Пригласить друга</div>
    <div class="card center">
      <p class="muted small">Поделитесь кодом. Когда друг введёт его — он сразу получит 🪙 ${d.inviteeGold}, а вы получите награду, когда он достигнет 50 уровня, и 10% золотом от всех его покупок золота!</p>
      <p style="font-size:26px;letter-spacing:3px;font-weight:bold;margin:10px 0" class="gold">${d.code}</p>
      <button class="btn btn-orange" id="ref-copy" style="width:100%">📋 Скопировать код</button>
    </div>
    <div class="card">
      <div class="kv"><span class="k">Приглашено друзей</span><span class="v gold">${d.refCount}</span></div>
      <div class="kv"><span class="k">Заработано с покупок друзей</span><span class="v gold">🪙 ${UI.fmtNum(d.refEarnings)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">🎁 Другу за ввод кода</span><span class="v">🪙 ${d.inviteeGold}</span></div>
      <div class="kv"><span class="k">🏅 Вам за 50 уровень друга</span><span class="v">🪙 ${d.level50Reward} + 🎖 ${d.level50Tokens}</span></div>
      <div class="kv"><span class="k">💰 Вам с покупок друга</span><span class="v">${d.purchaseSharePct}% золотом</span></div>
    </div>
    ${d.canApply ? `
      <div class="card">
        <div class="name">Ввести чужой код</div>
        <p class="muted small">Если вас пригласили — введите код приглашающего (один раз, до 50 уровня).</p>
        <div class="field-row mt">
          <input type="text" id="ref-input" placeholder="Код друга" style="text-transform:uppercase">
          <button class="btn btn-orange btn-inline" id="ref-apply">Применить</button>
        </div>
      </div>` : (d.referredBy ? '<div class="card center muted">Вы уже использовали реферальный код.</div>' : '<div class="card center muted">Ввод кода доступен только до 50 уровня.</div>')}`;
  document.getElementById('ref-copy').onclick = () => {
    navigator.clipboard?.writeText(d.code).then(() => UI.toast('📋 Код скопирован')).catch(() => UI.toast('Код: ' + d.code));
  };
  const apply = document.getElementById('ref-apply');
  if (apply) apply.onclick = async () => {
    const code = document.getElementById('ref-input').value.trim();
    if (!code) { UI.toast('Введите код'); return; }
    try { await API.post('/api/referral/apply', { code }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- Косметика профиля ----------
App.screens.cosmetics = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/cosmetics');
  const frames = d.items.filter((x) => x.type === 'frame');
  const bgs = d.items.filter((x) => x.type === 'bg');
  const renderItem = (x) => `
    <div class="card">
      <div class="name">${UI.esc(x.name)} ${(x.type === 'frame' ? d.activeFrame : d.activeBg) === x.id ? '<span class="badge">надето</span>' : ''}</div>
      ${x.owned
        ? `<button class="btn ${(x.type === 'frame' ? d.activeFrame : d.activeBg) === x.id ? 'btn-orange' : ''} mt" data-equip="${x.id}" style="width:100%">${(x.type === 'frame' ? d.activeFrame : d.activeBg) === x.id ? 'Снять' : 'Надеть'}</button>`
        : `<button class="btn btn-orange mt" data-buy-cos="${x.id}" style="width:100%">Купить за <span class="ic-gold"></span> ${x.priceGold}</button>`}
    </div>`;
  c.innerHTML = `
    <div class="title">🎨 Внешний вид</div>
    <p class="muted small" style="margin:-4px 4px 10px">Рамки и фоны для вашего профиля. Чистая косметика — на силу не влияет.</p>
    <div class="card"><div class="name">🖼 Рамки профиля</div></div>
    ${frames.map(renderItem).join('')}
    <div class="card"><div class="name">🌆 Фоны профиля</div></div>
    ${bgs.map(renderItem).join('')}`;
  c.querySelectorAll('[data-buy-cos]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/cosmetics/buy', { id: b.dataset.buyCos }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  c.querySelectorAll('[data-equip]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.equip;
    const item = d.items.find((x) => x.id === id);
    const isActive = (item.type === 'frame' ? d.activeFrame : d.activeBg) === id;
    try {
      if (isActive) await API.post('/api/cosmetics/unequip', { type: item.type });
      else await API.post('/api/cosmetics/equip', { id });
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  });
};
