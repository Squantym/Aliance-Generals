// ===================================================================
// public/js/app.js — ядро интерфейса
// Хранит состояние игрока (App.me), переключает экраны по hash-адресу
// (#war, #units, ...), рисует шапку с ресурсами и каждую секунду
// локально тикает таймеры регенерации, не дёргая сервер.
// Сервер опрашивается раз в 20 секунд для синхронизации.
// ===================================================================

const App = {
  me: null,        // сводка игрока с сервера (/api/me)
  screens: {},     // имя экрана → функция отрисовки (заполняют файлы screens/*)
  _tear: null,     // функция «уборки» текущего экрана (остановить поллинг чата и т.п.)

  // Темы оформления: 'classic' (по умолчанию), 'steel', 'cyber'
  THEMES: ['classic', 'steel', 'cyber', 'desert', 'noir', 'aurora'],
  theme() { return localStorage.getItem('gtheme') || 'classic'; },
  setTheme(t) {
    if (!App.THEMES.includes(t)) t = 'classic';
    localStorage.setItem('gtheme', t);
    document.body.className = 'theme-' + t;
  },

  async init() {
    App.setTheme(App.theme()); // применить сохранённую тему сразу
    window.addEventListener('hashchange', () => App.route());

    // Если токен есть — пробуем сразу получить состояние игрока
    if (API.token()) {
      try { App.me = await API.get('/api/me'); }
      catch (e) { /* токен умер — попадём на экран входа */ }
    }
    if (!App.me) location.hash = '#auth';
    App.route();

    // Показываем подарки от администратора при входе
    if (App.me && App.me.pendingGifts && App.me.pendingGifts.length) {
      setTimeout(() => App._showGiftPopup(App.me.pendingGifts[0]), 800);
    }

    // Периодическая синхронизация с сервером и посекундный тик шапки
    setInterval(() => App.pollMe(), 20000);
    setInterval(() => App.tickHeader(), 1000);
  },

  // Обновить состояние игрока с сервера и перерисовать шапку
  async pollMe() {
    if (!API.token()) return;
    try {
      const prevNotifUnread = App.me ? App.me.notifUnread : 0;
      App.me = await API.get('/api/me');
      App.renderHeader();
      // Если появились новые уведомления — показываем окно/баннер атаки
      if (App.me.notifUnread > prevNotifUnread) {
        App._checkNewAttackNotification();
      }
      // Проверяем подарки от администратора
      if (App.me.pendingGifts && App.me.pendingGifts.length) {
        App._showGiftPopup(App.me.pendingGifts[0]);
      }
    } catch (e) { /* сеть моргнула — попробуем в следующий раз */ }
  },

  // Проверяет последнее уведомление и, если это атака/ракетный удар,
  // показывает либо подробное окно (на главном экране), либо
  // минималистичный баннер сверху (на всех остальных экранах).
  // ── Попап подарка от администратора ─────────────────────────────
  _shownGiftIds: new Set(),

  _showGiftPopup(gift) {
    if (!gift || App._shownGiftIds.has(gift.id)) return;
    App._shownGiftIds.add(gift.id);

    // Удаляем предыдущий попап если есть
    const existing = document.getElementById('admin-gift-popup');
    if (existing) existing.remove();

    const items = (gift.items || []).join(' · ');
    const note  = gift.note ? `<p style="margin:12px 0 0;font-size:14px;color:var(--text)">${UI.esc(gift.note)}</p>` : '';

    const popup = document.createElement('div');
    popup.id = 'admin-gift-popup';
    popup.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,.75);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:20px;`;
    popup.innerHTML = `
      <div style="background:var(--card);border:2px solid var(--gold);border-radius:12px;
                  max-width:400px;width:100%;padding:24px;text-align:center;position:relative">
        <div style="font-size:40px;margin-bottom:8px">🎁</div>
        <div style="font-size:18px;font-weight:bold;color:var(--gold)">Подарок от администрации</div>
        <div style="margin:12px 0;padding:12px;background:rgba(255,200,0,.08);border-radius:8px;
                    font-size:16px;font-weight:bold;color:var(--text)">${UI.esc(items)}</div>
        ${note}
        <button id="gift-claim-btn" style="
          margin-top:20px;width:100%;padding:14px;
          background:var(--orange);color:#fff;border:none;border-radius:8px;
          font-size:16px;font-weight:bold;cursor:pointer">
          ✅ Забрать
        </button>
      </div>`;

    document.body.appendChild(popup);

    document.getElementById('gift-claim-btn').onclick = async () => {
      try {
        await API.post('/api/admin/claim-gift', { giftId: gift.id });
        popup.remove();
        App._shownGiftIds.delete(gift.id);
        await App.pollMe();
        // Если ещё есть подарки — покажем следующий
        if (App.me && App.me.pendingGifts && App.me.pendingGifts.length) {
          setTimeout(() => App._showGiftPopup(App.me.pendingGifts[0]), 300);
        }
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
  },

  // Загрузка и отображение чата легиона
  // Публичная карточка легиона (модальное окно)
  async _showPublicLegion(legionId) {
    try {
      const data = await API.get('/api/legion/public/' + encodeURIComponent(legionId));
      const RANKS = ['Новобранец', 'Боец', 'Лидер отряда', 'Зам. Генерала', 'Генерал'];
      const popup = document.createElement('div');
      popup.id = 'legion-public-popup';
      popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px';
      popup.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;max-width:420px;width:100%;max-height:80vh;overflow-y:auto;padding:20px">
          <div style="text-align:right"><button onclick="document.getElementById('legion-public-popup').remove()" class="btn btn-inline">✕</button></div>
          <div style="font-size:18px;font-weight:bold;text-align:center;margin-bottom:12px">🏰 ${UI.esc(data.name)}</div>
          <div class="kv"><span class="k">Уровень</span><span class="v gold">${data.legionLevel} ⭐</span></div>
          <div class="kv"><span class="k">Слава</span><span class="v">${UI.fmtNum(data.gloryPoints)} ⭐</span></div>
          <div class="kv"><span class="k">Победы</span><span class="v" style="color:var(--green)">${(data.battleStats || {}).wins || 0}</span></div>
          <div class="kv"><span class="k">Поражения</span><span class="v" style="color:var(--red)">${(data.battleStats || {}).losses || 0}</span></div>
          <div class="kv"><span class="k">Бойцов</span><span class="v">${data.memberCount}</span></div>
          <hr style="border:none;border-top:1px solid var(--border);margin:12px 0">
          <div style="font-weight:bold;margin-bottom:8px">👥 Состав</div>
          ${data.members.map(m => `<div class="kv"><span class="k">${m.flag || ''} ${UI.esc(m.name)} <span class="muted small">Ур.${m.level}</span></span><span class="v"><span class="badge ${m.rank >= 4 ? 'green' : m.rank >= 3 ? 'orange' : ''}">${RANKS[m.rank] || 'Новобранец'}</span></span></div>`).join('')}
        </div>`;
      document.getElementById('legion-public-popup')?.remove();
      document.body.appendChild(popup);
      popup.onclick = e => { if (e.target === popup) popup.remove(); };
    } catch(e) { UI.toast('⛔ ' + e.message); }
  },

  async _loadLegionChat() {
    const box = document.getElementById('legion-chat-box');
    if (!box) return;
    try {
      const { messages } = await API.get('/api/legion/chat');
      if (!messages.length) { box.innerHTML = '<p class="muted center small">Пока нет сообщений. Напишите первым!</p>'; return; }
      const RANKS = ['Новобранец', 'Боец', 'Лидер отряда', 'Зам. Генерала', 'Генерал'];
      box.innerHTML = messages.slice().reverse().map(m => {
        const time = new Date(m.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(m.at).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
        const rankBadge = m.rank >= 3 ? `<span class="badge ${m.rank >= 4 ? 'green' : 'orange'}" style="font-size:10px">${RANKS[m.rank]}</span> ` : '';
        const isMe = App.me && m.userId === App.me.id;
        return `<div style="padding:6px 0;border-bottom:1px solid var(--border-dim)${isMe ? ';opacity:.85' : ''}">
          <span style="color:var(--dim);font-size:11px">${date} ${time}</span>
          ${rankBadge}<span style="font-weight:bold;color:${isMe ? 'var(--gold)' : 'var(--text)'}">${UI.esc(m.name)}</span>:
          <span style="margin-left:4px">${UI.esc(m.text)}</span>
        </div>`;
      }).join('');
    } catch(e) { if (box) box.innerHTML = '<p class="muted center small">Ошибка загрузки чата</p>'; }
  },

  async _checkNewAttackNotification() {
    try {
      const { notifications } = await API.get('/api/notifications');
      const latest = notifications.find((n) => !n.read &&
        ['attack_lost', 'attack_defended', 'rocket_hit'].includes(n.kind));
      if (!latest) return;
      if (App._shownNotifIds && App._shownNotifIds.has(latest.id)) return;
      if (!App._shownNotifIds) App._shownNotifIds = new Set();
      App._shownNotifIds.add(latest.id);

      const onHome = (location.hash || '').slice(1).split('/')[0] === 'home' || !location.hash;
      if (onHome) {
        App._showAttackModal(latest);
      } else {
        App._showAttackBanner(latest);
      }
    } catch (e) { /* не критично, пропускаем */ }
  },

  // Подробное окно атаки — показывается, если игрок на главном экране.
  // Содержит общую статистику потерь/атак на текущий момент.
  _showAttackModal(n) {
    const p = n.payload || {};
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    const box = document.createElement('div');
    box.className = 'card';
    box.style.cssText = 'max-width:380px;width:100%;max-height:80vh;overflow-y:auto;';
    const m = App.me;
    let body = '';
    if (n.kind === 'attack_lost') {
      body = `
        <div class="kv"><span class="k">Урон по вам</span><span class="v dmg-take">${p.dealt} ед.</span></div>
        <div class="kv"><span class="k">Награблено</span><span class="v money">$ ${UI.fmtNum(p.loot)}</span></div>
        <div class="kv"><span class="k">Потеряно техники</span><span class="v">${p.lossesText ? UI.esc(p.lossesText) : 'без потерь'}</span></div>`;
    } else if (n.kind === 'attack_defended') {
      body = `
        <div class="kv"><span class="k">Урон по вам</span><span class="v dmg-take">${p.received} ед.</span></div>
        <div class="kv"><span class="k">Потери</span><span class="v">${p.lossesText ? UI.esc(p.lossesText) : 'без потерь'}</span></div>
        <p class="small mt" style="color:var(--money)">✅ Атака отбита!</p>`;
    } else if (n.kind === 'rocket_hit') {
      body = `
        <div class="kv"><span class="k">Урон ракеты</span><span class="v dmg-take">${UI.fmtNum(p.damage)} (мощность ${p.powerPct}%)</span></div>
        <div class="kv"><span class="k">Разрушено построек</span><span class="v">${p.destroyedBuildingsText ? UI.esc(p.destroyedBuildingsText) : 'постройки уцелели'}</span></div>
        <div class="kv"><span class="k">Уничтожено техники</span><span class="v">${p.techLostText ? UI.esc(p.techLostText) : 'техника уцелела'}</span></div>`;
    }
    box.innerHTML = `
      <div class="title" style="margin-top:0;color:var(--red)">⚠️ На вас напали!</div>
      <div class="kv"><span class="k">Противник</span><span class="v name">${UI.esc(p.attackerName)} (ур. ${p.attackerLevel || '?'})</span></div>
      ${body}
      <hr class="hr">
      <p class="small mt"><b>Ваша общая статистика на сейчас:</b></p>
      <div class="kv"><span class="k">Всего атак на вас</span><span class="v">${UI.fmtNum(m.battle.defWins + m.battle.defLosses)}</span></div>
      <div class="kv"><span class="k">Отбито</span><span class="v">${UI.fmtNum(m.battle.defWins)}</span></div>
      <div class="kv"><span class="k">Проиграно</span><span class="v">${UI.fmtNum(m.battle.defLosses)}</span></div>
      <button class="btn btn-orange mt" id="attack-modal-close" style="width:100%">Закрыть</button>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('attack-modal-close').onclick = () => {
      document.body.removeChild(overlay);
      API.post(`/api/notifications/${n.id}/read`).catch(() => {});
    };
  },

  // Минималистичный баннер сверху — показывается на любом экране кроме
  // главного. Не блокирует интерфейс, исчезает через несколько секунд
  // или по клику (переходит к подробностям в уведомлениях).
  _showAttackBanner(n) {
    const p = n.payload || {};
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:linear-gradient(90deg,#8e3326,#6b251b);color:#fff;padding:10px 16px;text-align:center;cursor:pointer;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.3);';
    banner.innerHTML = `⚠️ На вас напал «${UI.esc(p.attackerName || '???')}» — нажмите для подробностей`;
    banner.onclick = () => {
      document.body.removeChild(banner);
      API.post(`/api/notifications/${n.id}/read`).catch(() => {});
      App.go('notifications');
    };
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) document.body.removeChild(banner); }, 8000);
  },

  // То же самое, но по требованию (после действий)
  async refreshMe() { await App.pollMe(); },

  go(name) { location.hash = '#' + name; },

  // Разбор адреса и запуск нужного экрана.
  // App._preserveScroll = true перед вызовом route() сохраняет позицию
  // (используется для перерисовки текущего экрана после действия игрока).
  route() {
    if (App._tear) { try { App._tear(); } catch (e) {} App._tear = null; }

    const hash = (location.hash || '').slice(1) || 'home';
    const slashIdx = hash.indexOf('/');
    const name  = slashIdx === -1 ? hash : hash.slice(0, slashIdx);
    const param = slashIdx === -1 ? undefined : hash.slice(slashIdx + 1);

    // Специальный маршрут: #verify/<token> — ссылка из письма подтверждения
    if (name === 'verify' && param) {
      App._handleVerify(param); return;
    }

    if (!API.token() && name !== 'auth') { location.hash = '#auth'; return; }
    if (API.token() && name === 'auth') { location.hash = '#home'; return; }

    const screen = App.screens[name] || App.screens.home;
    App.renderHeader();

    const c = document.getElementById('content');
    const preserve = App._preserveScroll;
    App._preserveScroll = false;
    // Сохраняем скролл ДО подмены контента (иначе сжатие страницы сбросит scrollY)
    const savedScroll = window.scrollY;
    if (!preserve) window.scrollTo(0, 0);
    c.innerHTML = '<div class="loading">Загрузка…</div>';
    Promise.resolve(screen(c, param)).then(() => {
      if (preserve) {
        // Возвращаем скролл синхронно и страховочно через requestAnimationFrame
        window.scrollTo(0, savedScroll);
        requestAnimationFrame(() => window.scrollTo(0, savedScroll));
      }
    }).catch((e) => {
      c.innerHTML = `<div class="card err">${UI.esc(e.message)}</div>`;
    });
  },

  // Перерисовка текущего экрана с сохранением скролла (вызывать вместо App.route()
  // после внутренних действий игрока: купил, продал, открыл контейнер, нажал кнопку).
  rerender() {
    App._preserveScroll = true;
    App.route();
  },

  // ---------- ШАПКА ----------
  renderHeader() {
    const h = document.getElementById('header');
    if (!App.me || !API.token()) {
      h.innerHTML = `<div class="logo"><span class="star">★</span> ГЕНЕРАЛЫ <span class="star">★</span></div>`;
      return;
    }
    const m = App.me;
    const mail = m.mailUnread > 0 ? `✉ <span class="badge">${m.mailUnread}</span>` : '✉';
    const bell = m.notifUnread > 0 ? `🔔 <span class="badge">${m.notifUnread}</span>` : '🔔';
    // Полоска опыта: текущий xp / необходимый для следующего уровня
    const xpPct = m.xpNext > 0 ? Math.min(100, Math.round((m.xp / m.xpNext) * 100)) : 100;
    // Уровень кликабелен: ведёт в навыки если есть очки, иначе в профиль
    const lvlTarget = m.skillPoints > 0 ? 'skills' : 'profile';
    h.innerHTML = `
      <div class="logo" onclick="App.go('home')"><span class="star">★</span> ГЕНЕРАЛЫ <span class="star">★</span></div>
      <div class="xp-strip" onclick="App.go('profile')" title="Опыт: ${UI.fmtNum(m.xp)} / ${UI.fmtNum(m.xpNext)}">
        <div class="xp-strip-fill" style="width:${xpPct}%"></div>
        <span class="xp-strip-label">Ур. ${m.level} · ${UI.fmtNum(m.xp)} / ${UI.fmtNum(m.xpNext)} XP</span>
      </div>
      <div class="res-row">
        <div class="clickable" onclick="App.go('bank')">$ <span class="money" id="hd-dollars">${UI.fmtMoney(m.dollars)}</span></div>
        <div class="clickable" onclick="App.go('market')"><span class="ic-gold" aria-hidden="true"></span> <span class="gold" id="hd-gold">${UI.fmtNum(m.gold)}</span></div>
        <div class="clickable" onclick="App.go('${lvlTarget}')">⭐ <span class="lvl">Ур. ${m.level}</span>${m.skillPoints > 0 ? ' <span class="badge">+' + m.skillPoints + '</span>' : ''}</div>
        <div class="clickable" onclick="App.go('notifications')">${bell}</div>
        <div class="clickable" onclick="App.go('mail')">${mail}</div>
      </div>
      <div class="stat-row">
        <div class="clickable" onclick="App.go('hospital')" title="В госпиталь">❤ <span class="stat-hp" id="st-hp">${m.res.hp.cur}/${m.res.hp.max}</span> <span class="timer" id="st-hp-t"></span></div>
        <div class="clickable" onclick="App.go('missions')" title="В спецоперации">⚡ <span class="stat-en" id="st-en">${m.res.en.cur}/${m.res.en.max}</span> <span class="timer" id="st-en-t"></span></div>
        <div class="clickable" onclick="App.go('war')" title="В бой">🎯 <span class="stat-am" id="st-am">${m.res.am.cur}/${m.res.am.max}</span> <span class="timer" id="st-am-t"></span></div>
      </div>
      ${m.res.hp.cur < 25 ? `
        <div class="low-hp-banner" onclick="App._quickHeal()">
          ⚠️ Здоровье ниже 25 — атаки запрещены. <b>Восстановить полностью за $${UI.fmtMoney(m.healCost || 0)}</b>
        </div>` : ''}`;
    App.tickHeader(true);
  },

  // Каждую секунду уменьшаем локальные таймеры регенерации.
  // Когда таймер дошёл до нуля — прибавляем единицу ресурса сами,
  // а раз в 20 секунд pollMe() всё равно сверит нас с сервером.
  tickHeader(noDecrement) {
    const m = App.me;
    if (!m || !API.token()) return;
    const map = { hp: 'st-hp', en: 'st-en', am: 'st-am' };
    for (const key of Object.keys(map)) {
      const r = m.res[key];
      if (!noDecrement && r.cur < r.max) {
        r.toNextSec--;
        if (r.toNextSec <= 0) {
          r.cur = Math.min(r.max, r.cur + 1);
          r.toNextSec = r.cur >= r.max ? 0 : r.regenSec;
        }
      }
      const el = document.getElementById(map[key]);
      const tEl = document.getElementById(map[key] + '-t');
      if (el) el.textContent = `${r.cur}/${r.max}`;
      if (tEl) tEl.textContent = r.cur < r.max ? UI.fmtTimer(r.toNextSec) : '';
    }
    if (!noDecrement && m.nextPayoutSec > 0) m.nextPayoutSec--;
  },

  // Быстрое лечение по нажатию на баннер HP<25
  async _quickHeal() {
    if (!confirm(`Восстановить здоровье за $${UI.fmtMoney(App.me.healCost)}?`)) return;
    try {
      await API.post('/api/hospital/heal');
      await App.refreshMe();
      App.renderHeader();
      UI.toast('🏥 Здоровье восстановлено!');
    } catch (e) { UI.toast('⛔ ' + e.message); }
  },

  // Модальное окно результата открытия контейнеров. Не закрывается само —
  // только по нажатию игроком кнопки «Закрыть».
  _showContainerResult(r) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    const dropsList = Object.keys(r.droppedCount || {}).length
      ? Object.entries(r.droppedCount).map(([n, c]) => `<div class="kv"><span class="k">${UI.esc(n)}</span><span class="v gold">×${c}</span></div>`).join('')
      : '<p class="muted center">Ничего не выпало.</p>';
    const box = document.createElement('div');
    box.className = 'card';
    box.style.cssText = 'max-width:380px;width:100%;max-height:80vh;overflow-y:auto;';
    box.innerHTML = `
      <div class="title" style="margin-top:0">📦 Открыто контейнеров: ${r.qty}</div>
      <p class="muted small center">Потрачено: <span class="gold">🪙 ${UI.fmtNum(r.spent)}</span></p>
      <hr class="hr">
      <p class="small mt"><b>Итоговая добыча:</b></p>
      ${dropsList}
      <button class="btn btn-orange mt" id="container-result-close" style="width:100%">Закрыть</button>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('container-result-close').onclick = () => {
      document.body.removeChild(overlay);
      App.rerender();
    };
  },

  // Обработка ссылки из письма подтверждения: #verify/<token>
  async _handleVerify(token) {
    const c = document.getElementById('content');
    c.innerHTML = '<div class="loading">Подтверждаем вашу почту…</div>';
    App.renderHeader();
    try {
      const r = await API.post('/api/verify-email', { token });
      API.setToken(r.token);
      App.me = await API.get('/api/me');
      c.innerHTML = `
        <div class="title">✅ Почта подтверждена</div>
        <div class="card center">
          <p style="font-size:40px">🎖</p>
          <p class="mt">Добро пожаловать, <b>${UI.esc(r.name)}</b>!</p>
          <p class="muted small mt">Регистрация завершена. Вступайте в строй, боец.</p>
          <button class="btn btn-orange mt" onclick="App.go('home')">В игру!</button>
        </div>`;
    } catch (e) {
      c.innerHTML = `
        <div class="title">❌ Ошибка</div>
        <div class="card center">
          <p style="color:var(--red)">${UI.esc(e.message)}</p>
          <p class="muted small mt">Ссылка уже использована или истекла. Попробуйте <a href="#auth">войти</a> — возможно, почта уже подтверждена.</p>
        </div>`;
    }
  },
};
