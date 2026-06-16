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
  THEMES: ['classic', 'steel', 'cyber'],
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

    // Периодическая синхронизация с сервером и посекундный тик шапки
    setInterval(() => App.pollMe(), 20000);
    setInterval(() => App.tickHeader(), 1000);
  },

  // Обновить состояние игрока с сервера и перерисовать шапку
  async pollMe() {
    if (!API.token()) return;
    try {
      App.me = await API.get('/api/me');
      App.renderHeader();
    } catch (e) { /* сеть моргнула — попробуем в следующий раз */ }
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
    const [name, param] = hash.split('/');

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
    h.innerHTML = `
      <div class="logo" onclick="App.go('home')"><span class="star">★</span> ГЕНЕРАЛЫ <span class="star">★</span></div>
      <div class="res-row">
        <div class="clickable" onclick="App.go('bank')">$ <span class="money" id="hd-dollars">${UI.fmtMoney(m.dollars)}</span></div>
        <div class="clickable" onclick="App.go('market')"><span class="ic-gold" aria-hidden="true"></span> <span class="gold" id="hd-gold">${UI.fmtNum(m.gold)}</span></div>
        <div class="clickable" onclick="App.go('skills')">⭐ <span class="lvl">Ур. ${m.level}</span>${m.skillPoints > 0 ? ' <span class="badge">+' + m.skillPoints + '</span>' : ''}</div>
        <div class="clickable" onclick="App.go('mail')">${mail}</div>
      </div>
      <div class="stat-row">
        <div>❤ <span class="stat-hp" id="st-hp">${m.res.hp.cur}/${m.res.hp.max}</span> <span class="timer" id="st-hp-t"></span></div>
        <div>⚡ <span class="stat-en" id="st-en">${m.res.en.cur}/${m.res.en.max}</span> <span class="timer" id="st-en-t"></span></div>
        <div>🎯 <span class="stat-am" id="st-am">${m.res.am.cur}/${m.res.am.max}</span> <span class="timer" id="st-am-t"></span></div>
      </div>`;
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
};
