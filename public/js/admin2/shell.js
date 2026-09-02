// ===================================================================
// public/js/admin2/shell.js — оболочка панели v2
//
// Что это и почему не «переписали панель заново».
//
// В v1 все тринадцать разделов жили в одном файле на 3 700 строк,
// а положение внутри панели нигде не хранилось. Переписывать такое
// целиком одним заходом — значит на неделю оставить игру без рабочей
// панели и потерять по дороге десятки мелочей, которые дописывались
// месяцами (подтверждения, права, счётчики, обходы багов).
//
// Поэтому здесь оболочка + переходник:
//   • оболочка — боковое меню, адресная строка, поиск, очередь работ;
//   • переходник — старые экраны вызываются как есть, внутрь новой
//     рабочей области. Панель работает целиком с первого дня.
// Экраны переносим по одному: перенесённый регистрируется в A2.screens
// и вытесняет старый. Список внизу файла — он же план работ.
// ===================================================================

const A2 = {
  ready: false,
  _badges: {},      // счётчики у пунктов меню: {reports: 3, support: 1}
  _lastRoute: null,

  // ── Разделы ──────────────────────────────────────────────────────
  // zone — нужное право, zones — достаточно любого из.
  // legacy — имя метода старой панели, пока экран не перенесён.
  NAV: [
    { id: 'queue',      label: 'Очередь работ', icon: '🗂', group: 'Работа' },
    { id: 'players',    label: 'Игроки',        icon: '👥', group: 'Работа', zone: 'players',    legacy: 'renderPlayers' },
    { id: 'reports',    label: 'Жалобы',        icon: '📨', group: 'Работа', zone: 'moderation', legacy: 'renderReports', badge: 'reports' },
    { id: 'support',    label: 'Заявки',        icon: '🛟', group: 'Работа', zone: 'support',    legacy: 'renderSupport', badge: 'support' },
    { id: 'econ',       label: 'Экономика',     icon: '🛠', group: 'Игра', zones: ['economy', 'discounts'], legacy: 'renderEcon' },
    { id: 'events',     label: 'Событие',       icon: '🐉', group: 'Игра', zone: 'event',   legacy: 'renderEvents' },
    { id: 'tournament', label: 'Турниры',       icon: '⚔️', group: 'Игра', zone: 'legions', legacy: 'renderTournament' },
    { id: 'legions',    label: 'Легионы',       icon: '🎖', group: 'Игра', zone: 'legions', legacy: 'renderLegions' },
    { id: 'analytics',  label: 'Аналитика',     icon: '📈', group: 'Служебное', zone: 'analytics', legacy: 'renderAnalytics' },
    { id: 'logs',       label: 'Журнал',        icon: '📋', group: 'Служебное', zone: 'players',   legacy: 'renderLogs' },
    { id: 'tech',       label: 'Техника',       icon: '🔧', group: 'Служебное', zone: 'security',  legacy: 'renderTech' },
    { id: 'roles',      label: 'Роли',          icon: '🛡', group: 'Служебное', zone: 'roles',     legacy: 'renderRoles' },
    // Значок валюты — картинкой, как в игре: сотрудник ищет глазом
    // знакомую монету, а не эмодзи, которое в каждой системе своё.
    { id: 'gold',       label: 'Золото',        icon: '<span class="ic-gold"></span>', group: 'Служебное', zone: 'roles', legacy: 'renderGold', ownerOnly: true },
    // Защита собственного входа доступна КАЖДОМУ сотруднику независимо
    // от зон: это его учётная запись, а не раздел игры.
    { id: 'security',   label: 'Защита входа',  icon: '🔐', group: 'Служебное' },
    { id: 'sessions',   label: 'Открытые входы', icon: '🚪', group: 'Служебное', zone: 'security' },
    // Письма уходят от имени игры — правит только владелец
    { id: 'mail',       label: 'Письма',        icon: '✉️', group: 'Служебное', zone: 'roles', ownerOnly: true },
    // Остановка игры и выкат кода. Только владелец: раздать это
    // администратору значит раздать возможность остановить проект.
    { id: 'release',    label: 'Обновление',    icon: '🚀', group: 'Служебное', zone: 'roles', ownerOnly: true },
    // Обнуление мира — последним в списке намеренно. Раздел, стирающий
    // всех игроков, не должен стоять рядом с теми, куда заходят каждый
    // день: промах мышью по соседнему пункту здесь стоит слишком дорого.
    { id: 'wipe',       label: 'Обнуление мира', icon: '💥', group: 'Служебное', zone: 'roles', ownerOnly: true },
  ],
  GROUPS: ['Работа', 'Игра', 'Служебное'],

  // Экраны, уже переписанные под v2. Ключ — id раздела.
  // Подпись: fn(el, route) → void | Promise
  screens: {},

  // ── Права ────────────────────────────────────────────────────────
  can(zone) { return Admin.zones.indexOf(zone) !== -1; },
  isOwner() { return !!(Admin.me && Admin.me.staffRole === 'owner'); },
  visible(item) {
    const byZone = item.zones ? item.zones.some((z) => A2.can(z))
                              : (!item.zone || A2.can(item.zone));
    return byZone && (!item.ownerOnly || A2.isOwner());
  },
  allowed() { return A2.NAV.filter(A2.visible); },
  find(id) { return A2.NAV.find((n) => n.id === id) || null; },

  // ── Каркас ───────────────────────────────────────────────────────
  render() {
    const root = document.getElementById('content');
    root.innerHTML = `
      <div class="a2" id="a2-root">
        <div class="a2-brand"><span class="a2-star">★</span> ШТАБ</div>
        <div class="a2-top">
          <button class="a2-burger" id="a2-burger" aria-label="Меню разделов">☰</button>
          <div class="a2-crumbs" id="a2-crumbs"></div>
          <div class="a2-search">
            <input id="a2-find" type="search" autocomplete="off"
              placeholder="Найти игрока по позывному…" aria-label="Найти игрока">
            <span class="a2-kbd">/</span>
          </div>
          <div class="a2-who">${UI.esc((Admin.me && Admin.me.name) || '')}
            · <b>${UI.esc(A2.roleName())}</b>
            · <a href="/" style="color:var(--dim)">в игру →</a></div>
        </div>
        <nav class="a2-side" id="a2-side" aria-label="Разделы панели"></nav>
        <main class="a2-main" id="a2-main">
          <div id="tab-content"></div>
        </main>
        <div class="a2-backdrop" id="a2-backdrop"></div>
      </div>`;

    A2.renderNav();
    A2.markWorld();

    // Меню-ящик на телефоне
    const rootEl = document.getElementById('a2-root');
    const close = () => rootEl.classList.remove('is-open');
    document.getElementById('a2-burger').onclick = () => rootEl.classList.toggle('is-open');
    document.getElementById('a2-backdrop').onclick = close;

    // Поиск игрока из любой точки панели
    const find = document.getElementById('a2-find');
    find.onkeydown = (e) => {
      if (e.key === 'Enter' && find.value.trim()) {
        A2Router.go('players', '', { q: find.value.trim() });
        close();
      }
      if (e.key === 'Escape') { find.value = ''; find.blur(); }
    };
    // «/» — в поиск. Самое частое действие за смену не должно требовать мыши.
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); find.focus(); find.select();
      }
    });

    // ── Переходник для старых экранов ──────────────────────────────
    // Старый код в десяти местах делает `Admin.tab = X; Admin.renderTab()`.
    // Не переписываем эти места — переопределяем сам метод: он теперь
    // означает «перейти в раздел X», то есть меняет адрес, а не рисует
    // поверх. Плюс единственный способ обновить экран после действия.
    Admin.renderTab = function () {
      const id = Admin.tab;
      const cur = A2Router.parse();
      if (id && id !== cur.name && A2.find(id)) return A2Router.go(id);
      A2.refresh();
    };
    // Старая render() перерисовывала весь каркас вкладок. В v2 каркас
    // рисует оболочка; иначе выход из карточки игрока сносил бы меню.
    Admin.render = function () { A2.refresh(); };

    A2.ready = true;
  },

  roleName() {
    const r = (Admin.me && Admin.me.staffRole) || '';
    return { owner: 'владелец', admin: 'администратор', moderator: 'модератор' }[r] || r || 'сотрудник';
  },

  // ── Какой это мир ─────────────────────────────────────────────────
  //
  // Панели боевого и тестового мира выглядели ОДИНАКОВО. Различить их
  // можно было только по адресу в строке браузера — а вкладки у
  // владельца открыты обе, и обе называются «Альянс Генералов».
  //
  // В игре полоса «ТЕСТОВЫЙ МИР» есть давно (App.markTestWorld), но
  // панель грузит свои файлы и app.js в неё не попадает — до неё эта
  // пометка не доходила вовсе. При этом именно в панели цена ошибки
  // выше всего: выдать ресурсы, забанить или обнулить мир не в той
  // вкладке — это не опечатка, а происшествие.
  //
  // Спрашиваем открытый /api/world: он ничего не считает и не требует
  // прав. Не ответил — молчим: пометка полезная, но не обязательная,
  // и ронять из-за неё панель незачем.
  async markWorld() {
    if (document.getElementById('a2-world-bar')) return;
    let w = null;
    try { w = await API.get('/api/world'); } catch (e) { return; }
    if (!w || !w.test || !w.test.on) return;
    const bar = document.createElement('div');
    bar.id = 'a2-world-bar';
    // Класс — не украшение: стили панели обязаны быть ограничены .a2,
    // иначе они протекут в игру. За этим следит admin2.test.js.
    bar.className = 'a2-world-bar';
    bar.textContent = '🧪 ' + (w.test.name || 'ТЕСТОВЫЙ МИР')
      + ' — это НЕ боевая игра. Изменения здесь игроков не касаются.';
    document.body.appendChild(bar);
    document.body.classList.add('a2-is-test');
  },

  renderNav() {
    const cur = A2Router.parse().name;
    const item = (n) => {
      const b = A2._badges[n.badge];
      const badge = (n.badge && b && b.count)
        ? `<span class="a2-badge ${b.tone === 'hot' ? 'is-hot' : (b.tone === 'warn' ? 'is-warn' : '')}">${b.count}</span>`
        : '';
      return `<a class="a2-nav ${cur === n.id ? 'is-active' : ''}" href="${A2Router.build(n.id)}"
        data-nav="${n.id}" ${cur === n.id ? 'aria-current="page"' : ''}>${n.icon} ${UI.esc(n.label)}${badge}</a>`;
    };
    const group = (name) => {
      const list = A2.allowed().filter((n) => n.group === name);
      if (!list.length) return '';       // пустых подписей не рисуем
      return `<div class="a2-group">${name}</div>` + list.map(item).join('');
    };
    document.getElementById('a2-side').innerHTML = A2.GROUPS.map(group).join('');
    document.querySelectorAll('#a2-side .a2-nav').forEach((a) => {
      a.onclick = () => { const r = document.getElementById('a2-root'); if (r) r.classList.remove('is-open'); };
    });
  },

  crumbs(route) {
    const n = A2.find(route.name);
    const el = document.getElementById('a2-crumbs');
    if (!el) return;
    let txt = n ? `${n.icon} <b>${UI.esc(n.label)}</b>` : '<b>Панель</b>';
    if (route.name === 'player') {
      txt = `<a href="${A2Router.build('players')}" style="color:var(--dim)">👥 Игроки</a> › <b>${UI.esc(A2._playerName || route.arg)}</b>`;
    }
    el.innerHTML = txt;
  },

  // ── Переход по разделам ──────────────────────────────────────────
  onRoute(route) {
    A2._lastRoute = route;
    // Раздел закрыт правами или не существует — уводим в очередь работ,
    // а не показываем пустой экран без объяснения.
    const known = route.name === 'player' || A2.find(route.name);
    if (!known) return A2Router.go('queue', '', null, true);
    // Страница игрока пунктом меню не является, но право на неё нужно
    // то же самое — иначе прямая ссылка обошла бы проверку раздела.
    if (route.name === 'player' && !A2.can('players')) {
      UI.toast('⛔ Раздел закрыт: нет права «players»');
      return A2Router.go('queue', '', null, true);
    }
    const n = A2.find(route.name);
    if (n && !A2.visible(n)) {
      UI.toast('⛔ Раздел закрыт: нет права «' + (n.zone || (n.zones || []).join('/')) + '»');
      return A2Router.go('queue', '', null, true);
    }
    A2.renderNav();
    A2.crumbs(route);
    A2.mount(route);
  },

  refresh() { if (A2._lastRoute) A2.mount(A2Router.parse()); },

  mount(route) {
    const host = document.getElementById('a2-main');
    if (!host) return;
    // Контейнер каждый раз новый: старые экраны вешают обработчики прямо
    // на узлы, и переиспользование одного и того же div копило их.
    // Плюс id="tab-content" — его ищет по имени старый код.
    host.innerHTML = '<div id="tab-content"></div>';
    const el = document.getElementById('tab-content');
    Admin.tab = route.name;

    const own = A2.screens[route.name];
    if (own) {
      el.className = '';
      try {
        const res = own(el, route);
        if (res && res.catch) res.catch((e) => A2.fail(el, e));
      } catch (e) { A2.fail(el, e); }
      return;
    }

    // Старый экран — как есть, внутрь новой области
    const n = A2.find(route.name);
    const fn = n && n.legacy && Admin[n.legacy];
    if (typeof fn !== 'function') return A2.fail(el, new Error('Экран «' + route.name + '» не найден'));
    el.className = 'a2-legacy';
    try {
      const res = fn.call(Admin, el);
      if (res && res.catch) res.catch((e) => A2.fail(el, e));
    } catch (e) { A2.fail(el, e); }
  },

  fail(el, e) {
    // Пустой экран без причины — худшее, что может показать панель:
    // сотрудник не знает, сломалось оно или так и надо.
    el.innerHTML = `<div class="a2-card"><h3 style="color:var(--red)">Раздел не открылся</h3>
      <p class="a2-muted">${UI.esc((e && e.message) || 'неизвестная ошибка')}</p>
      <p class="a2-muted">Попробуйте обновить страницу. Если повторяется — покажите этот текст владельцу.</p>
      <button class="btn btn-inline" id="a2-retry">Повторить</button></div>`;
    const b = document.getElementById('a2-retry');
    if (b) b.onclick = () => A2.refresh();
    if (window.console) console.error('[A2]', e);
  },

  // Счётчики у пунктов меню обновляет очередь работ
  setBadge(key, count, tone) {
    A2._badges[key] = { count: count, tone: tone };
    if (document.getElementById('a2-side')) A2.renderNav();
  },

  // ── Запуск ───────────────────────────────────────────────────────
  async init() {
    if (!API.token()) return Admin.renderLogin();
    let me = null;
    try { me = await API.get('/api/me'); } catch (e) { return Admin.renderLogin(); }
    if (!me.staffZones || !me.staffZones.length) {
      UI.toast(me.staffRole === 'moderator'
        ? '⛔ Модератор работает из чата игры, панель ему не нужна'
        : '⛔ У этой учётной записи нет доступа к панели');
      return Admin.renderLogin();
    }
    Admin.me = me;
    Admin.zones = me.staffZones;
    A2.render();
    // Первый доступный раздел — на случай, если очередь закрыта правами
    const first = (A2.allowed()[0] || { id: 'queue' }).id;
    A2Router.start(A2.onRoute, first);
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = A2;
