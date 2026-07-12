// ===================================================================
// public/js/app.js — ядро интерфейса
// Хранит состояние игрока (App.me), переключает экраны по hash-адресу
// (#war, #units, ...), рисует шапку с ресурсами и каждую секунду
// локально тикает таймеры регенерации, не дёргая сервер.
// Сервер опрашивается раз в 20 секунд для синхронизации.
// ===================================================================

const App = {
  // ── Картинки предметов чёрного рынка (допинг/падлянки/мина) ──
  // Возвращает путь к картинке предмета по его id, либо null (нет картинки).
  _MARKET_IMG_IDS: ['stim','armor','energy','medkit','ammo','sabotage','diversia','ammo_boost','energy_boost','crit_boost','dodge_boost','bureaucracy','espionage','landmine'],
  _marketImg(id) { return this._MARKET_IMG_IDS.indexOf(id) >= 0 ? `/img/market/${id}.webp` : null; },
  // ── Картинки наёмников аукциона ──
  _MERC_IMG_IDS: ['berserk','fortress','tycoon','envoy','ghost'],
  _mercImg(id) { return this._MERC_IMG_IDS.indexOf(id) >= 0 ? `/img/mercenaries/${id}.webp` : null; },
  // ── Флаги стран: эмодзи → картинка ──
  _FLAG_MAP: { '🇧🇾':'by', '🇩🇪':'de', '🇰🇿':'kz', '🇨🇳':'cn', '🇷🇺':'ru', '🇺🇸':'us', '🇺🇦':'ua' },
  _flagImg(flag, cls) {
    const code = this._FLAG_MAP[flag];
    if (!code) return flag || '';
    return `<img src="/img/flags/${code}.webp" class="flag-img ${cls || ''}" alt="">`;
  },

  // ── ФАТАЛИТИ: взятие в плен → фото + выбор → результат → возврат ──
  // Шаг 1: крупное фото момента + выбор (отрезать ухо / помиловать).
  async _showFatalityFlow(fat) {
    const old = document.getElementById('fatality-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'fatality-overlay';
    overlay.className = 'fatality-overlay';
    overlay.innerHTML = `
      <div class="fatality-modal">
        <img src="/img/fatality/moment.webp" class="fatality-photo" alt="">
        <div class="fatality-title" style="color:var(--red)">🪖 Пленный командир</div>
        <p class="center muted small">Командир <b style="color:var(--fg)">${UI.esc(fat.name)}</b> полностью в вашей власти. Решите его судьбу:</p>
        <div class="fatality-choices">
          <button class="btn btn-red fatality-choice-btn" data-fat="ear">✂️ Отрезать ухо</button>
          <button class="btn btn-green fatality-choice-btn" data-fat="mercy">🎖 Помиловать</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-fat]').forEach((b) => b.onclick = async () => {
      overlay.querySelectorAll('[data-fat]').forEach((x) => { x.disabled = true; x.style.opacity = '.5'; });
      const choice = b.dataset.fat;
      try {
        const res = await API.post('/api/war/fatality', { choice });
        App._lastBattle = null;
        overlay.remove();
        if (res && res.escaped) {
          UI.toast('💨 Жертва ускользнула — фаталити сорвалось!');
          await App.refreshMe();
          if ((location.hash||'').indexOf('war')>=0) App.rerender(); else App.go('war');
          return;
        }
        App._showFatalityResult(choice, res);
      } catch (e) {
        UI.toast('⛔ ' + e.message);
        overlay.remove(); await App.refreshMe(); App.rerender();
      }
    });
  },

  // Шаг 2: картинка результата + кнопка «Вернуться на поле боя».
  _showFatalityResult(choice, res) {
    const isEar = choice === 'ear';
    const overlay = document.createElement('div');
    overlay.id = 'fatality-overlay';
    overlay.className = 'fatality-overlay';
    overlay.innerHTML = `
      <div class="fatality-modal">
        <img src="/img/fatality/${isEar ? 'cut' : 'pardon'}.webp" class="fatality-photo" alt="">
        <div class="fatality-title" style="color:${isEar ? 'var(--red)' : 'var(--green)'}">${isEar ? '✂️ Ухо отрезано' : '🎖 Враг помилован'}</div>
        <p class="center muted small">${isEar
          ? 'Вы отрезали ухо поверженному командиру — трофей жестокости пополнил вашу коллекцию.'
          : 'Вы проявили милосердие и отпустили командира. Знак чести и жетон милосердия — ваши.'}</p>
        <button class="btn btn-orange" id="fat-return" style="width:100%;padding:12px;margin-top:10px">🔙 Вернуться на поле боя</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('fat-return').onclick = async () => {
      overlay.remove();
      await App.refreshMe();
      // Если отрезаны ОБА уха одной жертве — предложим оставить послание
      if (res && res.canLeaveMessage && res.victimId) App._showEarMessagePrompt(res.victimId);
      // Возврат на поле боя: если уже на войне — принудительно перерисовываем
      // (App.go с тем же хешем не вызывает hashchange), иначе переходим.
      if ((location.hash||'').indexOf('war')>=0) App.rerender(); else App.go('war');
    };
  },

  // ── Аватары профиля ──
  _AVATARS: { male: ['m1','m2','m3','m4','m5','m6'], female: ['f1','f2','f3','f4','f5','f6'] },
  // Окно выбора аватара: мужские + женские; текущий подсвечен; можно снять.
  _showAvatarPicker(current) {
    const old = document.getElementById('avatar-picker');
    if (old) old.remove();
    const cell = (id) => `
      <button class="avatar-cell ${id === current ? 'sel' : ''}" data-avatar="${id}">
        <img src="/img/avatars/${id}.webp" alt="${id}" loading="lazy">
      </button>`;
    const m = document.createElement('div');
    m.id = 'avatar-picker';
    m.className = 'game-dialog-overlay';
    m.innerHTML = `
      <div class="game-dialog" style="max-width:460px;width:100%;max-height:85vh;overflow-y:auto">
        <div class="game-dialog-title">📷 Выбор аватара</div>
        <div class="avatar-group-label">👨 Мужские</div>
        <div class="avatar-grid">${this._AVATARS.male.map(cell).join('')}</div>
        <div class="avatar-group-label">👩 Женские</div>
        <div class="avatar-grid">${this._AVATARS.female.map(cell).join('')}</div>
        <div class="game-dialog-actions" style="margin-top:14px">
          ${current ? '<button class="btn" id="avatar-clear">Убрать аватар</button>' : ''}
          <button class="btn" id="avatar-cancel">Закрыть</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const pick = async (avatar) => {
      try {
        await API.post('/api/avatar', { avatar });
        if (App.me) App.me.avatar = avatar || null;
        m.remove();
        UI.toast(avatar ? '📷 Аватар обновлён' : '📷 Аватар убран');
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    m.querySelectorAll('[data-avatar]').forEach((b) => b.onclick = () => pick(b.dataset.avatar));
    const clr = m.querySelector('#avatar-clear'); if (clr) clr.onclick = () => pick('');
    m.querySelector('#avatar-cancel').onclick = () => m.remove();
    m.onclick = (e) => { if (e.target === m) m.remove(); };
  },

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
    // Открываем боевое окно ТОЛЬКО если игрок уже вступил в бой (нажал
    // «Подготовиться к бою»). Тех, кто не вступил, в окно не закидываем.
    if (App.me && App.me.legion) {
      try {
        const { battle } = await API.get('/api/legion/battle');
        if (battle && battle.me && App._shouldOpenBattle(battle)) {
          setTimeout(() => App._openBattleWindow(), 500);
        }
      } catch(e) {}
    }

    // Периодическая синхронизация с сервером и посекундный тик шапки
    // pollMe вызывается только при действиях игрока
    setInterval(() => App.tickHeader(), 1000);
    // Автообновление боевого окна, пока оно открыто (чтобы видеть смену фаз
    // prep→active→done и действия других игроков без ручного нажатия).
    setInterval(() => {
      // Не поллим в фоновой вкладке (огромная экономия трафика при открытых вкладках)
      if (document.hidden) return;
      const win = document.getElementById('battle-window');
      // Окна нет или бой уже завершён — не перезапрашиваем состояние
      if (!win || win.dataset.done === '1') return;
      // Не перерисовываем, пока игрок печатает (чат/ввод) — иначе собьётся фокус.
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      App._renderBattleWindow();
    }, 4000);
  },

  // Обновить состояние игрока с сервера и перерисовать шапку
  async pollMe() {
    if (!API.token()) return;
    try {
      const prevNotifUnread = App.me ? App.me.notifUnread : 0;
      App.me = await API.get('/api/me');
      App.renderHeader();
      // Ежедневная награда за вход выдана автоматически — показываем тост
      if (App.me.dailyReward && App.me.dailyReward.message && !App._dailyShown) {
        App._dailyShown = true;
        UI.toast(App.me.dailyReward.message);
      }
      // Если появились новые уведомления — показываем окно/баннер атаки
      if (App.me.notifUnread > prevNotifUnread) {
        App._checkNewAttackNotification();
      }
      // Проверяем подарки от администратора
      if (App.me.pendingGifts && App.me.pendingGifts.length) {
        App._showGiftPopup(App.me.pendingGifts[0]);
      }
      // Ракеты, долетевшие за время отсутствия — показываем окна попаданий
      if (App.me.pendingRocketHits && App.me.pendingRocketHits.length) {
        App._showRocketHits(App.me.pendingRocketHits);
      }
      // Открываем боевое окно только если игрок уже участник боя
      if (App.me.legion && !document.getElementById('battle-window')) {
        try {
          const { battle } = await API.get('/api/legion/battle');
          if (battle && battle.me && App._shouldOpenBattle(battle)) {
            App._openBattleWindow();
          }
        } catch(e) {}
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
  // ── Боевое окно (полноэкранный overlay) ─────────────────────────
  _battleWindow: null,
  _bwArmedItem: null,      // id предмета, «взведённого» для выбора цели
  _bwCdTimer: null,        // тикер кулдауна действия/предмета в бою

  // Нужно ли автоматически открыть боевое окно для этого боя.
  // prep/active — всегда; done — только если итоги ещё не просмотрены (иначе
  // после закрытия результатов обновление страницы открывало бы их снова).
  _shouldOpenBattle(battle) {
    if (!battle) return false;
    if (battle.phase === 'prep' || battle.phase === 'active') return true;
    if (battle.phase === 'done') {
      let seen = null;
      try { seen = localStorage.getItem('bwDoneSeen'); } catch (e) {}
      return battle.id && seen !== battle.id;
    }
    return false;
  },

  // Метаданные предметов боевого пояса: как их применять.
  // kind: 'enemy' (по врагу) | 'ally' (по союзнику/себе) | 'self' (на себя) | 'aoe' (по направлению)
  _ITEM_META: {
    gas_grenade:     { name: '💨 Газовая шашка',  kind: 'enemy' },
    flashbang:       { name: '💥 Светошумовая',    kind: 'enemy' },
    assault_grenade: { name: '🔴 Граната',         kind: 'enemy' },
    napalm:          { name: '🔥 Напалм',          kind: 'aoe'   },
    hydrogen_bomb:   { name: '💣 Водородная бомба', kind: 'aoe'   },
    uranium_ammo:    { name: '☢️ Урановые БП',      kind: 'self'  },
    dome:            { name: '🔵 Купол',            kind: 'self'  },
    kevlar:          { name: '🦺 Бронеплиты',        kind: 'self'  },
    reflect_shield:  { name: '🪞 Отраж. щит',        kind: 'self'  },
    medkit:          { name: '🩹 Аптечка',          kind: 'ally'  },
  },

  // Тикающий кулдаун действия/предмета: каждую секунду обновляет кнопки атаки
  // (показывает «⏳ Nс» и блокирует), пока идёт КД. Значения берутся с сервера
  // при отрисовке, дальше тикаем локально — чтобы игрок видел живой отсчёт.
  _startActionCdTicker(b) {
    if (App._bwCdTimer) { clearInterval(App._bwCdTimer); App._bwCdTimer = null; }
    if (!b || b.phase !== 'active' || !b.me) return;
    const cds = b.cooldowns || {};
    let action = cds.action || 0;
    let move   = cds.move   || 0;
    let item   = cds.item   || 0;
    const paint = () => {
      // Кнопки атаки: пока КД действия > 0 — блок + «⏳ Nс»
      document.querySelectorAll('[data-atk]').forEach((btn) => {
        if (action > 0) { btn.disabled = true;  btn.textContent = `⏳ ${action}с`; btn.style.opacity = '.55'; }
        else            { btn.disabled = false; btn.textContent = btn.dataset.label || '🎯 Атаковать'; btn.style.opacity = ''; }
      });
      const aEl = document.getElementById('bw-cd-action'); if (aEl) aEl.textContent = action + 'с';
      const mEl = document.getElementById('bw-cd-move');   if (mEl) mEl.textContent = move + 'с';
      const iEl = document.getElementById('bw-cd-item');   if (iEl) iEl.textContent = item + 'с';
      // Кнопки «Применить» предмета — показываем таймер КД и блокируем,
      // пока идёт кулдаун предмета (как на кнопках атаки).
      document.querySelectorAll('[data-item-cd]').forEach((btn) => {
        if (item > 0) { btn.disabled = true;  btn.textContent = `⏳ ${item}с`; btn.style.opacity = '.55'; }
        else          { btn.disabled = false; btn.textContent = btn.dataset.itemLabel || 'Применить'; btn.style.opacity = ''; }
      });
    };
    paint();
    App._bwCdTimer = setInterval(() => {
      if (!document.getElementById('battle-window')) { clearInterval(App._bwCdTimer); App._bwCdTimer = null; return; }
      if (action > 0) action--;
      if (move > 0) move--;
      if (item > 0) item--;
      paint();
    }, 1000);
  },

  // Умное применение предмета боевого пояса:
  //  self/aoe — сразу (цель не нужна); enemy/ally — если цель одна, бьём сразу,
  //  иначе «взводим» предмет и просим выбрать цель на карточке бойца.
  _bwApplyItem(id, b) {
    const meta = App._ITEM_META[id];
    if (!meta) { App._bwItemPost(id, ''); return; }
    const me = b.me;
    if (meta.kind === 'self' || meta.kind === 'aoe') { App._bwItemPost(id, ''); return; }
    const dir = (b.directions || []).find(x => x.dir === (me && me.direction));
    if (meta.kind === 'enemy') {
      const enemies = dir ? (dir.enemies || []).filter(e => e.alive) : [];
      if (enemies.length === 0) { UI.toast('⛔ На направлении нет врагов'); return; }
      if (enemies.length === 1) { App._bwItemPost(id, enemies[0].userId); return; }
      App._bwArmedItem = id; App._renderBattleWindow(); return;   // несколько целей → выбор
    }
    if (meta.kind === 'ally') {
      const allies = dir ? (dir.allies || []).filter(a => a.alive && a.userId !== (me && me.userId)) : [];
      if (allies.length === 0) { App._bwItemPost(id, me ? me.userId : ''); return; } // некого лечить → себя
      App._bwArmedItem = id; App._renderBattleWindow(); return;
    }
  },

  _bwItemPost(itemId, targetId) {
    if (!itemId) return;
    App._bwArmedItem = null;
    (async () => {
      try {
        const r = await API.post('/api/legion/battle/item', { itemId, targetId: targetId || '' });
        const msg = r && r.notices && r.notices.length ? r.notices[0] : 'Применено';
        UI.toast('🎒 ' + msg);
      } catch (e) { UI.toast('⛔ ' + e.message); }
      await App._renderBattleWindow();
    })();
  },

  async _openBattleWindow() {
    if (document.getElementById('battle-window')) return; // уже открыто
    const win = document.createElement('div');
    win.id = 'battle-window';
    win.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:var(--bg, #0a0f1a);z-index:9990;
      overflow-y:auto;-webkit-overflow-scrolling:touch;
    `;
    document.body.appendChild(win);
    App._battleWindow = win;
    await App._renderBattleWindow();
  },

  // Полноэкранная информационная заглушка боевого окна. Используется вместо
  // чёрного пустого оверлея при любых сбоях (сеть, 500, ошибка отрисовки).
  // ВАЖНО: overlay #battle-window имеет тёмный фон — если оставить его пустым,
  // игрок видит именно «чёрный экран». Поэтому пустым он не остаётся НИКОГДА.
  _bwPlaceholder(win, opts) {
    opts = opts || {};
    const icon = opts.icon || '⚔️';
    const title = opts.title || 'Загрузка боя…';
    const sub = opts.sub ? `<p class="muted small mt">${opts.sub}</p>` : '';
    win.innerHTML = '<div class="bw-inner" style="padding:48px 16px;text-align:center;color:var(--text)">'
      + `<p style="font-size:40px;margin:0">${icon}</p>`
      + `<p class="mt" style="font-weight:bold">${title}</p>`
      + sub
      + '<button class="btn btn-orange mt" onclick="App._renderBattleWindow()" style="min-width:140px">🔄 Обновить</button>'
      + '<button class="btn btn-inline mt" style="margin-left:8px" onclick="App._closeBattleWindow()">Закрыть</button>'
      + '</div>';
  },

  async _renderBattleWindow() {
    const win = document.getElementById('battle-window');
    if (!win) return;
    if (!App.me || !App.me.legion) { App._closeBattleWindow(); return; }
    let battle;
    try {
      const res = await API.get('/api/legion/battle');
      battle = res.battle;
      win._bwFails = 0;   // успешный запрос — сбрасываем счётчик сбоев
    } catch (e) {
      // Сетевой сбой/таймаут/500. НЕ закрываем окно (иначе лаг выкидывает из
      // подготовки). Но и НЕ оставляем чёрный оверлей: если окно ещё ни разу
      // не отрисовано — показываем заглушку «Переподключение…» с кнопками,
      // чтобы игрок не залипал на чёрном экране все 10 минут. Автополлинг
      // (каждые 4 сек) сам восстановит окно, как только сервер ответит.
      win._bwFails = (win._bwFails || 0) + 1;
      if (!win.dataset.rendered) {
        App._bwPlaceholder(win, {
          icon: '📡', title: 'Переподключение к бою…',
          sub: 'Не удалось получить состояние боя. Пробуем снова автоматически.',
        });
      }
      return;
    }
    // Бой пропал из ответа сервера. Если окно ещё пустое (только открыли) —
    // показываем заглушку «Бой не найден» с кнопкой закрытия (а не чёрный экран
    // и не тихое закрытие в никуда). Если уже что-то отрисовано — оставляем как
    // есть: это может быть кратковременный сбой, следующий poll поправит.
    if (!battle) {
      if (!win.dataset.rendered) {
        App._bwPlaceholder(win, {
          icon: '🏳️', title: 'Активный бой не найден',
          sub: 'Возможно, бой ещё не начался или уже завершён.',
        });
      }
      return;
    }
    if (battle.phase === 'done') {
      try { App._renderBattleDone(win, battle); win.dataset.rendered = '1'; }
      catch (e) { console.error('Ошибка отрисовки итогов боя:', e);
        App._bwPlaceholder(win, { icon: '🏁', title: 'Бой завершён' }); }
      win.dataset.done = '1';   // бой завершён — прекращаем автополлинг окна
      return;
    }
    try {
      App._renderBattleContent(win, battle);
      // rendered уже выставлен ВНУТРИ _renderBattleContent (сразу после
      // установки innerHTML), поэтому ошибка в привязке событий не приводит
      // к затиранию уже нарисованного боя.
    } catch (e) {
      console.error('Ошибка отрисовки боя:', e);
      // Никогда не оставляем пустой полноэкранный оверлей (это и был «чёрный
      // экран»). Если окно ещё не отрисовано — показываем заглушку с кнопками.
      if (!win.dataset.rendered) {
        App._bwPlaceholder(win, {
          icon: '⚠️', title: 'Не удалось открыть бой',
          sub: 'Нажмите «Обновить». Если не помогает — закройте и войдите снова.',
        });
      }
    }
  },

  _closeBattleWindow() {
    const win = document.getElementById('battle-window');
    if (win) win.remove();
    App._battleWindow = null;
  },

  // Чат боя: общий и командный (вкладки), внизу окна
  _bwChatHtml(b) {
    const mode = App._bwChatMode || 'team';
    const msgs = (mode === 'team' ? (b.teamChat||[]) : (b.globalChat||[]));
    return `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:10px">
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button class="btn btn-inline" id="bw-chat-team" style="flex:1;padding:6px;${mode==='team'?'border:2px solid var(--green)':''}">👥 Командный</button>
        <button class="btn btn-inline" id="bw-chat-global" style="flex:1;padding:6px;${mode==='global'?'border:2px solid var(--orange)':''}">🌐 Общий</button>
      </div>
      <div style="max-height:110px;overflow-y:auto;margin-bottom:6px;font-size:12px" id="bw-chat-box">
        ${msgs.length ? msgs.slice(-30).map(m=>`<div style="padding:2px 0"><b style="color:var(--${mode==='team'?'green':'orange'})">${UI.esc(m.name)}:</b> ${UI.esc(m.text)}</div>`).join('') : '<span class="muted small">Сообщений нет</span>'}
      </div>
      <div style="display:flex;gap:6px">
        <input id="bw-chat-input" maxlength="200" placeholder="Сообщение..." style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
        <button class="btn btn-orange" id="bw-chat-send" style="padding:8px 14px">▶</button>
      </div>
    </div>`;
  },

  // Рисует боевой пояс как фиксированное число слотов (maxSlots).
  // Заполненные слоты показывают предмет; пустые — кнопку «+» для взятия
  // из арсенала (в подготовке) либо просто пустую ячейку (в бою).
  // mode: 'prep' — можно брать предметы; 'active' — можно применять.
  _gearSlotsHtml(b, mode) {
    const META = App._ITEM_META;
    const maxSlots = b.maxSlots || 3;
    const gear = (b.myGear || (b.me && b.me.gear) || []).slice();
    const arsenal = b.arsenal || [];
    const armed = App._bwArmedItem;

    let cells = '';
    for (let i = 0; i < maxSlots; i++) {
      const id = gear[i];
      if (id) {
        const nm = (META[id] && META[id].name) || id;
        const btn = mode === 'active'
          ? `<button class="btn btn-orange" data-item="${id}" data-item-cd="1" data-item-label="Применить">Применить</button>`
          : '';
        cells += `<div class="bw-slot ${armed===id?'bw-armed':''}"><div class="nm">${nm}</div>${btn}</div>`;
      } else {
        const plus = mode === 'prep' && arsenal.length
          ? `<button class="btn btn-inline" id="bw-gear-add-${i}" style="width:100%;height:100%;border-style:dashed">➕ Взять</button>`
          : '<span class="muted" style="font-size:22px">○</span>';
        cells += `<div class="bw-slot empty">${plus}</div>`;
      }
    }

    // Баннер «взведён предмет — выберите цель» (только в бою)
    let banner = '';
    if (mode === 'active' && armed && META[armed]) {
      banner = `<div class="bw-armed-banner">
        <span>▶ <b>${META[armed].name}</b> — выберите цель ниже</span>
        <button class="btn btn-inline" id="bw-item-cancel" style="padding:5px 10px">✖ Отмена</button>
      </div>`;
    }

    const hint = mode === 'active'
      ? '<p class="muted small" style="margin:6px 0 0">Тап «Применить»: по себе/направлению — сразу, по врагу/союзнику — выберите цель.</p>'
      : (mode === 'prep' && arsenal.length ? '<p class="muted small" style="margin:6px 0 0">Нажмите «Взять», чтобы выбрать предмет из арсенала легиона.</p>'
        : (mode === 'prep' && !arsenal.length && gear.length === 0 ? '<p class="muted small" style="margin:6px 0 0">Арсенал легиона пуст. Лидер может закупить предметы в разделе легиона.</p>' : ''));

    return `${banner}<div class="bw-card" style="border-color:var(--orange)">
      <b style="color:var(--orange)">🎒 Боевой пояс (${gear.length}/${maxSlots})</b>
      <div class="bw-belt" style="margin-top:8px">${cells}</div>
      ${hint}
    </div>`;
  },

  // Окно результатов ракетного удара — показывает что разрушено,
  // игрок закрывает сам, ознакомившись.
  _showRocketResult(r) {
    const existing = document.getElementById('rocket-result');
    if (existing) existing.remove();
    const techRows = Object.entries(r.techLost || {}).map(([n, c]) =>
      `<div class="kv"><span class="k">${UI.esc(n)}</span><span class="v dmg-take">−${c}</span></div>`).join('') || '<p class="muted small">Техника уцелела</p>';
    const buildRows = Object.entries(r.destroyedBuildings || {}).map(([n, c]) =>
      `<div class="kv"><span class="k">${UI.esc(n)}</span><span class="v dmg-take">−${c}</span></div>`).join('') || '<p class="muted small">Постройки уцелели</p>';
    const popup = document.createElement('div');
    popup.id = 'rocket-result';
    popup.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:10002;display:flex;align-items:center;justify-content:center;padding:16px';
    popup.innerHTML = `
      <div style="background:var(--card);border:2px solid var(--red);border-radius:12px;max-width:440px;width:100%;padding:20px;max-height:85vh;overflow-y:auto">
        <div style="font-size:18px;font-weight:bold;text-align:center;margin-bottom:4px">🚀 Ракетный удар нанесён!</div>
        <p class="muted small" style="text-align:center;margin-bottom:14px">Цель: <b>${UI.esc(r.targetName||'')}</b> · Мощность ${r.powerPct}%</p>
        <div style="display:flex;gap:10px;margin-bottom:14px">
          <div style="flex:1;text-align:center;padding:12px;border:1px solid var(--red);border-radius:8px">
            <div style="font-size:24px;font-weight:bold;color:var(--red)">${r.techDestroyedCount||0}</div>
            <div class="muted small">единиц техники</div>
          </div>
          <div style="flex:1;text-align:center;padding:12px;border:1px solid var(--red);border-radius:8px">
            <div style="font-size:24px;font-weight:bold;color:var(--red)">${r.buildingsDestroyedCount||0}</div>
            <div class="muted small">зданий</div>
          </div>
        </div>
        <div style="margin-bottom:10px"><b>🔧 Уничтоженная техника:</b>${techRows}</div>
        <div style="margin-bottom:14px"><b>🏚 Разрушенные здания:</b>${buildRows}</div>
        <button class="btn btn-orange" id="rocket-result-close" style="width:100%">Закрыть</button>
      </div>`;
    document.body.appendChild(popup);
    popup.querySelector('#rocket-result-close').onclick = () => popup.remove();
  },

  // Окно предложения оставить послание на профиле жертвы, которой
  // игрок отрезал ОБА уха. Можно написать текст или отказаться.
  _showEarMessagePrompt(victimId) {
    const existing = document.getElementById('ear-msg-prompt');
    if (existing) existing.remove();
    const popup = document.createElement('div');
    popup.id = 'ear-msg-prompt';
    popup.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10002;display:flex;align-items:center;justify-content:center;padding:16px';
    popup.innerHTML = `
      <div style="background:var(--card);border:2px solid var(--red);border-radius:12px;max-width:400px;width:100%;padding:20px">
        <div style="font-size:17px;font-weight:bold;margin-bottom:6px">✂️ Вы отрезали оба уха!</div>
        <p class="muted small" style="margin-bottom:12px">Можете оставить короткое послание на профиле жертвы — его увидят все. Или откажитесь.</p>
        <textarea id="ear-msg-text" maxlength="200" rows="3" placeholder="Ваше послание (до 200 символов)..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);resize:vertical"></textarea>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-orange" id="ear-msg-send" style="flex:1">✍️ Оставить</button>
          <button class="btn" id="ear-msg-skip" style="flex:1">Отказаться</button>
        </div>
      </div>`;
    document.body.appendChild(popup);

    popup.querySelector('#ear-msg-send').onclick = async () => {
      const text = popup.querySelector('#ear-msg-text').value.trim();
      if (!text) { popup.remove(); return; }
      try {
        await API.post('/api/war/ear-message', { victimId, text });
        UI.toast('✍️ Послание оставлено');
      } catch (e) { UI.toast('⛔ ' + e.message); }
      popup.remove();
    };
    popup.querySelector('#ear-msg-skip').onclick = () => popup.remove();
  },

  // Модалка выбора предмета из арсенала для взятия в слот (фаза подготовки)
  _showGearPicker(b) {
    const arsenal = b.arsenal || [];
    if (!arsenal.length) { UI.toast('Арсенал легиона пуст'); return; }
    const existing = document.getElementById('gear-picker');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'gear-picker';
    popup.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
    popup.innerHTML = `
      <div style="background:var(--card);border:2px solid var(--orange);border-radius:12px;max-width:380px;width:100%;padding:20px;max-height:80vh;overflow-y:auto">
        <div style="font-size:16px;font-weight:bold;margin-bottom:12px">🎒 Выберите предмет из арсенала</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${arsenal.map(it => `
            <button class="btn btn-inline gear-pick-btn" data-item="${it.itemId}" style="width:100%;padding:12px;text-align:left">
              <b>${UI.esc(it.name)}</b> <span class="muted small">×${it.qty}</span>
              ${it.desc?`<br><span class="muted small">${UI.esc(it.desc)}</span>`:''}
            </button>`).join('')}
        </div>
        <button class="btn btn-inline" id="gear-pick-cancel" style="width:100%;padding:10px;margin-top:12px">Отмена</button>
      </div>`;
    document.body.appendChild(popup);

    popup.querySelectorAll('.gear-pick-btn').forEach(btn => {
      btn.onclick = async () => {
        const itemId = btn.getAttribute('data-item');
        try {
          await API.post('/api/legion/gear/pick', { itemId });
          popup.remove();
          UI.toast('🎒 Предмет в поясе');
          await App._renderBattleWindow();
        } catch (e) {
          UI.toast('⛔ ' + (e.message || 'Не удалось взять предмет'));
        }
      };
    });
    popup.querySelector('#gear-pick-cancel').onclick = () => popup.remove();
  },

  _renderBattleContent(win, b) {
    const ROLE_ICON = { assault: '🎯', guardian: '🛡️', medic: '➕' };

    const hpBar = (hp, maxHp, color) => {
      const pct = Math.round(hp / Math.max(1, maxHp) * 100);
      return `<div style="background:rgba(255,255,255,.1);border-radius:4px;height:6px;margin:3px 0;overflow:hidden">
        <div style="background:${color};height:100%;width:${pct}%;transition:width .2s"></div>
      </div><div style="font-size:10.5px;color:var(--dim)">HP ${Math.round(hp)}/${maxHp}</div>`;
    };

    const statusBadge = (c) => [
      c.stunned   ? `<span style="color:var(--red);font-size:11px">💫${c.stunned}с</span>` : '',
      c.noHeal    ? `<span style="color:var(--orange);font-size:11px">🚫лечение</span>` : '',
      c.onFire    ? `<span style="color:var(--orange);font-size:11px">🔥</span>` : '',
      c.immune    ? `<span style="color:var(--green);font-size:11px">🔵${c.immune}с</span>` : '',
      c.reflecting? `<span style="color:var(--green);font-size:11px">🪞</span>` : '',
      c.shield > 0? `<span style="font-size:11px">🛡${c.shield}</span>` : '',
    ].filter(Boolean).join(' ');

    // Шапка с таймером — всегда видна
    const timeLeft = b.phase === 'active' ? b.timeLeft || 0 : 0;
    const scores = b.liveScores || {};
    const mySide = b.mySide;

    let html = `
      <div class="bw-inner">
      <div class="bw-head">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:bold;color:var(--${b.phase==='prep'?'orange':'green'})">
            ${b.phase === 'prep' ? '⏳ Подготовка' : '⚔️ БОЙ ИДЁТ'}
          </span>
          <span style="font-weight:bold" id="bw-timer">
            ${b.phase === 'prep' ? UI.fmtTimer(b.prepSecsLeft || 0) : UI.fmtTimer(timeLeft)}
          </span>
        </div>
        ${b.phase === 'active' && b.liveScores ? `
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:4px">
          <span style="color:var(--green)">🟢 Ваши: ${UI.fmtNum(scores[mySide]||0)} очк.</span>
          <span style="color:var(--red)">🔴 Враги: ${UI.fmtNum(scores[mySide==='A'?'B':'A']||0)} очк.</span>
        </div>` : ''}
      </div>
      <div class="bw-body">`;

    // ── ФАЗА ПОДГОТОВКИ ──────────────────────────────────────────
    if (b.phase === 'prep') {
      if (!b.me) {
        html += `<div style="background:rgba(255,150,0,.1);border:1px solid var(--orange);border-radius:8px;padding:12px;margin-bottom:12px">
          <p style="margin:0 0 10px">Выберите роль — все роли умеют атаковать:</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button id="bw-join-assault" class="btn btn-orange" style="width:100%;padding:14px;text-align:left">
              🎯 <b>Штурмовик</b> <span class="muted small">— +20% атаки</span>
            </button>
            <button id="bw-join-guardian" class="btn btn-orange" style="width:100%;padding:14px;text-align:left">
              🛡️ <b>Защитник</b> <span class="muted small">— +20% защиты, −20% урона, прикрытие</span>
            </button>
            <button id="bw-join-medic" class="btn btn-orange" style="width:100%;padding:14px;text-align:left">
              ➕ <b>Медик</b> <span class="muted small">— лечение союзников + атака</span>
            </button>
          </div>
        </div>`;
      } else {
        const ready = b.me.ready;
        // Блок роли + кнопка Готов/Не готов
        html += `<div style="background:${ready?'rgba(0,200,0,.08)':'rgba(255,150,0,.1)'};border:1px solid var(--${ready?'green':'orange'});border-radius:8px;padding:12px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <b>${ROLE_ICON[b.me.role]} ${b.me.roleName}</b>
            <span style="color:var(--${ready?'green':'orange'})">${ready ? '✅ Готов' : '⏳ Не готов'}</span>
          </div>
          <button id="bw-ready" class="btn ${ready?'btn-inline':'btn-green'}" style="width:100%;padding:12px">
            ${ready ? '❌ Не готов (сменить роль)' : '✅ Готов к бою'}
          </button>
          ${!ready ? '<p class="muted small" style="margin:8px 0 0">После «Готов» выберите направление. В бой попадут только готовые бойцы с направлением.</p>' : ''}
        </div>`;

        // ── Пока НЕ готов — можно сменить роль (выбрать заново) ──
        if (!ready) {
          html += `<div style="background:rgba(255,150,0,.06);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
            <p style="margin:0 0 8px;font-weight:bold">Сменить роль:</p>
            <div style="display:flex;flex-direction:column;gap:8px">
              <button id="bw-join-assault" class="btn ${b.me.role==='assault'?'btn-green':'btn-inline'}" style="width:100%;padding:12px;text-align:left">
                🎯 <b>Штурмовик</b> <span class="muted small">— +20% атаки</span>${b.me.role==='assault'?' ✓':''}
              </button>
              <button id="bw-join-guardian" class="btn ${b.me.role==='guardian'?'btn-green':'btn-inline'}" style="width:100%;padding:12px;text-align:left">
                🛡️ <b>Защитник</b> <span class="muted small">— +20% защиты, −20% урона</span>${b.me.role==='guardian'?' ✓':''}
              </button>
              <button id="bw-join-medic" class="btn ${b.me.role==='medic'?'btn-green':'btn-inline'}" style="width:100%;padding:12px;text-align:left">
                ➕ <b>Медик</b> <span class="muted small">— лечение союзников + атака</span>${b.me.role==='medic'?' ✓':''}
              </button>
            </div>
          </div>`;
        }

        // ── Боевой пояс: 3 слота, можно взять предметы из арсенала ──
        html += App._gearSlotsHtml(b, 'prep');

        // Выбор направления — только если готов
        if (ready) {
          html += `<p style="margin:0 0 8px;font-weight:bold">Выберите направление:</p>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
            ${b.directions.map(d => {
              const sel = b.me && b.me.direction === d.dir;
              return `<button id="bw-dir-${d.dir}" class="btn ${sel?'btn-green':'btn-inline'}" style="width:100%;padding:12px;text-align:left">
                ${sel ? '📍' : '○'} <b>${d.name}</b>
                <span style="float:right;font-size:12px">${(d.allies||[]).length}/5 союзн.</span>
              </button>`;
            }).join('')}
            </div>`;
        }
      }

      // Список участников: готовые и кто на каком направлении (значок роли)
      const sides = { A: [], B: [] };
      for (const c of (b.allCombatants||[])) sides[c.side].push(c);
      const my = sides[mySide]||[], en = sides[mySide==='A'?'B':'A']||[];
      const renderMember = (c, showDir) => {
        const readyMark = c.ready ? '<span style="color:var(--green)">✅</span>' : '<span class="muted">⏳</span>';
        const dirInfo = showDir && c.direction ? ` <span class="muted">→ ${c.dirName||('Напр.'+c.direction)}</span>` : '';
        return `<div style="padding:5px 0;font-size:13px;border-bottom:1px solid var(--border-dim)">
          ${readyMark} ${ROLE_ICON[c.role]||'?'} ${UI.esc(c.name)}${c.online?' <span style="color:var(--green)" title="В сети">●</span>':''}${dirInfo}
        </div>`;
      };
      html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <div style="padding:10px;border-right:1px solid var(--border)">
          <div style="color:var(--green);font-weight:bold;margin-bottom:6px">🟢 Ваши (${my.length})</div>
          ${my.map(c=>renderMember(c, true)).join('')||'<span class="muted small">ожидаем...</span>'}
        </div>
        <div style="padding:10px">
          <div style="color:var(--red);font-weight:bold;margin-bottom:6px">🔴 Враги (${en.length})</div>
          ${en.map(c=>renderMember(c, false)).join('')||'<span class="muted small">ожидаем...</span>'}
        </div>
      </div>`;

      // ── Чат в подготовке: можно писать своим и чужим (командный/общий) ──
      html += '<div style="margin-top:12px"></div>';
      html += App._bwChatHtml(b);
    }

    // ── АКТИВНЫЙ БОЙ ─────────────────────────────────────────────
    if (b.phase === 'active' && b.me) {
      const me = b.me;
      const myCDs = b.cooldowns || {};
      const armed = App._bwArmedItem;                 // «взведённый» предмет (id) или null
      const armedMeta = armed ? App._ITEM_META[armed] : null;

      // ── Лог боя (компактный, сворачивается прокруткой) — самый верх ──
      if (b.log && b.log.length) {
        html += `<div class="bw-card tight">
          <b style="font-size:12px">📋 Лог боя</b>
          <div style="max-height:96px;overflow-y:auto;margin-top:4px">
          ${b.log.slice().reverse().map(e=>{
            const col=e.kind==='crit'?'#f55':e.kind==='heal'?'#0b8':e.kind==='item'?'#fa0':'var(--dim)';
            return `<div style="color:${col};font-size:11px;padding:1px 0">${UI.esc(e.text)}</div>`;
          }).join('')}
          </div>
        </div>`;
      }

      // Данные по моему направлению
      const dirData = me.direction !== null ? b.directions.find(x=>x.dir===me.direction) : null;
      const aliveAllies = dirData ? (dirData.allies||[]).filter(a=>a.userId!==me.userId && a.alive) : [];
      const aliveEn = dirData ? (dirData.enemies||[]).filter(e=>e.alive) : [];

      // ── ВРАГИ — сразу после лога (чтобы на телефоне не прокручивать вниз) ──
      if (dirData && aliveEn.length > 0) {
        html += `<div class="bw-card" style="border-left:3px solid var(--red)">
          <div style="color:var(--red);font-weight:bold;font-size:12.5px;margin-bottom:4px">🔴 Враги — ${dirData.name}</div>
          ${aliveEn.map(en => `
            <div class="bw-fighter">
              <div class="bw-fighter-head">
                <span>${ROLE_ICON[en.role]||'?'}</span><b>${UI.esc(en.name)}</b>${en.online?' <span style="color:var(--green)" title="В сети">●</span>':''}
                <span class="muted small">${en.roleName}</span> ${statusBadge(en)}
              </div>
              ${hpBar(en.hp, en.maxHp, '#c22')}
              <div class="bw-fighter-acts">
                <button class="btn btn-red" id="bw-attack-${en.userId}" data-atk="${en.userId}" data-label="🎯 Атаковать">🎯 Атаковать</button>
                ${armedMeta && armedMeta.kind==='enemy'?`<button class="btn btn-orange" data-apply-item="${en.userId}">✅ ${armedMeta.name} сюда</button>`:''}
              </div>
            </div>`).join('')}
        </div>`;
      }

      // ── СОЮЗНИКИ, включая САМОГО ИГРОКА, в одном поле ──
      html += `<div class="bw-card" style="border-left:3px solid var(--green)">
        <div style="color:var(--green);font-weight:bold;font-size:12.5px;margin-bottom:4px">🟢 Ваш отряд${dirData?` — ${dirData.name}`:''}</div>
        <div class="bw-fighter" style="background:rgba(0,200,0,.07);border-radius:6px;padding:6px">
          <div class="bw-fighter-head">
            <span>${ROLE_ICON[me.role]||'?'}</span><b>Вы — ${me.roleName}</b> ${statusBadge(me)}
          </div>
          ${hpBar(me.hp, me.maxHp, '#e33')}
          <div class="bw-me-res">
            <span>❤️ <b>${Math.round(me.hp)}/${me.maxHp}</b></span>
            ${me.ammo!=null?`<span>🔫 <b>${me.ammo}</b></span>`:''}
            ${me.energy!=null?`<span><span class="ic-energy"></span> <b>${me.energy}</b></span>`:''}
            ${me.shield>0?`<span>🛡 <b>${me.shield}</b></span>`:''}
            <span>⏱ действие <b id="bw-cd-action">${myCDs.action||0}с</b></span>
          </div>
          <div class="bw-fighter-acts">
            ${me.role==='medic'?`<button class="btn btn-green" id="bw-heal-self">➕ Лечить себя</button>`:''}
            ${armedMeta && armedMeta.kind==='ally'?`<button class="btn btn-orange" data-apply-item="${me.userId}">✅ ${armedMeta.name} на себя</button>`:''}
          </div>
        </div>
        ${aliveAllies.map(a => `
          <div class="bw-fighter">
            <div class="bw-fighter-head">
              <span>${ROLE_ICON[a.role]||'?'}</span><b>${UI.esc(a.name)}</b>${a.online?' <span style="color:var(--green)" title="В сети">●</span>':''}
              <span class="muted small">${a.roleName}</span> ${statusBadge(a)}
            </div>
            ${hpBar(a.hp, a.maxHp, '#0a8')}
            <div class="bw-fighter-acts">
              ${me.role==='guardian'?`<button class="btn btn-orange" id="bw-guard-${a.userId}">🛡️ Прикрыть</button>`:''}
              ${me.role==='medic'?`<button class="btn btn-green" id="bw-heal-${a.userId}">➕ Лечить</button>`:''}
              ${armedMeta && armedMeta.kind==='ally'?`<button class="btn btn-orange" data-apply-item="${a.userId}">✅ ${armedMeta.name} сюда</button>`:''}
            </div>
          </div>`).join('')}
      </div>`;

      if (me.direction === null) {
        html += `<p class="muted center small">Выберите направление ниже, чтобы вступить в бой ⬇</p>`;
      } else if (dirData && !aliveAllies.length && !aliveEn.length) {
        html += `<p class="muted center small">На «${dirData.name}» больше никого — смените направление ⬇</p>`;
      }

      // ── Направления — компактные чипы ──
      html += `<div class="bw-dirs">
        ${b.directions.map(d => {
          const sel = me.direction === d.dir;
          const al = (d.allies||[]).filter(x=>x.alive).length;
          const en2 = (d.enemies||[]).filter(x=>x.alive).length;
          return `<div class="bw-dir ${sel?'sel':''}" id="bw-dir-${d.dir}">
            ${sel?'📍':''} <b>${d.name}</b>
            <span class="cnt">🟢${al} 🔴${en2}</span>
          </div>`;
        }).join('')}
      </div>`;

      // ── Боевой пояс — сразу применяется (см. _gearSlotsHtml) ──
      html += App._gearSlotsHtml(b, 'active');

      // ── Чат боя (общий + командный) внизу ──
      html += App._bwChatHtml(b);
    }

    html += `</div>
      <div style="padding:8px 12px 16px;border-top:1px solid var(--border)">
        <button id="bw-leave" class="btn btn-red" style="width:100%;padding:10px;opacity:.65">🚪 Покинуть бой</button>
        <p style="text-align:center;font-size:10.5px;color:var(--dim);margin-top:5px">При выходе ваша статистика не будет учтена</p>
      </div>
      </div>`;

    win.innerHTML = html;
    // Помечаем «отрисовано» СРАЗУ после установки содержимого — до привязки
    // событий и таймеров. Иначе ошибка в _bindBattleWindowEvents оставляла бы
    // dataset.rendered пустым, и обёртка-catch затирала бы уже готовый бой
    // заглушкой на КАЖДОМ 4-сек опросе → «экран с ошибкой не исчезал».
    win.dataset.rendered = '1';
    // Привязку и таймеры изолируем: сбой в них не должен рушить весь экран боя.
    try { App._bindBattleWindowEvents(win, b); } catch (e) { console.error('bindBattleWindowEvents:', e); }
    try { App._startBattleWindowTimer(b); }     catch (e) { console.error('startBattleWindowTimer:', e); }
    try { App._startActionCdTicker(b); }        catch (e) { console.error('startActionCdTicker:', e); }
  },

  _renderBattleDone(win, b) {
   try {
    const mySide = b.mySide;
    const won = b.winningSide === mySide;
    const r = b.finalReport;
    const scores = r ? r.activityScores : {};
    const ROLE_ICON = { assault: '🎯', guardian: '🛡️', medic: '➕' };
    const sideDot = (s) => s === mySide ? '🟢' : '🔴';

    // Мои личные результаты
    const myDetail = (r && b.me && r.playerDetails) ? r.playerDetails[b.me.userId] : null;
    const myStats = myDetail ? myDetail.stats : (b.me ? b.me.stats : null);
    const myBlock = myStats ? `
      <div class="bw-card">
        <p style="font-weight:bold;margin:0 0 6px">📈 Ваши результаты</p>
        <div class="kv"><span class="k">🎯 Нанесено урона</span><span class="v">${UI.fmtNum(myStats.dmgDealt||0)}</span></div>
        <div class="kv"><span class="k">➕ Вылечено</span><span class="v">${UI.fmtNum(myStats.healed||0)}</span></div>
        <div class="kv"><span class="k">🛡️ Прикрытий</span><span class="v">${myStats.guards||0}</span></div>
        <div class="kv"><span class="k">💀 Убийств</span><span class="v">${myStats.kills||0}</span></div>
      </div>` : '';

    // Топ-3 по характеристике
    const top3 = r ? r.top3 : null;
    const top3List = (arr, fmt) => (arr && arr.length)
      ? arr.map((x, i) => `<div class="kv"><span class="k">${['🥇','🥈','🥉'][i]||''} ${sideDot(x.side)} ${UI.esc(x.name)}</span><span class="v">${fmt(x.value)}</span></div>`).join('')
      : '<div class="muted small" style="padding:2px 0">—</div>';
    const top3Block = top3 ? `
      <div class="bw-card" style="border-color:var(--gold)">
        <p style="font-weight:bold;margin:0 0 6px;color:var(--gold)">🏅 Топ-3 боя</p>
        <div style="font-size:12.5px;font-weight:bold;margin:6px 0 2px">🎯 Урон</div>
        ${top3List(top3.damage,  (v)=>UI.fmtNum(v))}
        <div style="font-size:12.5px;font-weight:bold;margin:8px 0 2px">➕ Лечение</div>
        ${top3List(top3.healing, (v)=>UI.fmtNum(v))}
        <div style="font-size:12.5px;font-weight:bold;margin:8px 0 2px">🛡️ Защита (прикрытий)</div>
        ${top3List(top3.defense, (v)=>String(v))}
        ${(top3.kills && top3.kills.length) ? `<div style="font-size:12.5px;font-weight:bold;margin:8px 0 2px">💀 Убийства</div>${top3List(top3.kills, (v)=>String(v))}` : ''}
      </div>` : '';

    // Клановая сводка одной стороны
    const clanBlock = (cr, isMine) => cr ? `
      <div class="bw-card" style="border-color:var(--${isMine?'green':'red'})">
        <div style="font-weight:bold;color:var(--${isMine?'green':'red'});margin-bottom:6px">${isMine?'🟢':'🔴'} ${UI.esc(cr.name||'Легион')} ${isMine?'(ваш)':''}</div>
        <div class="kv"><span class="k">Участников</span><span class="v">${cr.memberCount}</span></div>
        <div class="kv"><span class="k">Суммарный урон</span><span class="v">${UI.fmtNum(cr.totalDamage)}</span></div>
        <div class="kv"><span class="k">Суммарное лечение</span><span class="v">${UI.fmtNum(cr.totalHealed)}</span></div>
        <div class="kv"><span class="k">Убийств</span><span class="v">${cr.totalKills}</span></div>
        <div style="margin-top:6px">
          ${(cr.members||[]).map(m => `<div style="font-size:12px;padding:3px 0;border-top:1px solid var(--border-dim)">${ROLE_ICON[m.role]||''} ${UI.esc(m.name)} — <span class="muted">🎯${UI.fmtNum(m.dmgDealt)} ➕${UI.fmtNum(m.healed)} 🛡️${m.guards}</span></div>`).join('')}
        </div>
      </div>` : '';

    const cr = r ? r.clanResults : null;

    win.innerHTML = `
      <div class="bw-inner" style="padding-top:20px">
        <div style="text-align:center">
          <div style="font-size:44px;margin-bottom:6px">${won ? '🏆' : '💀'}</div>
          <div style="font-size:20px;font-weight:bold;color:var(--${won?'green':'red'});margin-bottom:6px">
            ${won ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}
          </div>
          ${r ? `<div style="display:flex;justify-content:space-around;margin:10px 0 14px;font-size:17px">
            <span style="color:var(--green)">🟢 ${UI.fmtNum(scores[mySide]||0)}</span>
            <span>vs</span>
            <span style="color:var(--red)">🔴 ${UI.fmtNum(scores[mySide==='A'?'B':'A']||0)}</span>
          </div>` : ''}
        </div>
        <div class="bw-body" style="padding-top:0">
          ${myBlock}
          ${top3Block}
          ${cr ? `<p style="font-weight:bold;margin:4px 0 8px">📊 Результаты кланов</p>
          ${clanBlock(cr[mySide], true)}
          ${clanBlock(cr[mySide==='A'?'B':'A'], false)}` : ''}
          <button class="btn btn-orange" style="width:100%;padding:13px;margin-top:8px" id="bw-close">← Вернуться в легион</button>
        </div>
      </div>`;

    const closeBtn = win.querySelector('#bw-close');
    if (closeBtn) closeBtn.onclick = () => {
      // Запоминаем, что итоги этого боя просмотрены — чтобы обновление страницы
      // не открывало окно результатов повторно.
      try { if (b.id) localStorage.setItem('bwDoneSeen', b.id); } catch (e) {}
      App._closeBattleWindow();
    };
   } catch (e) {
    console.error('Ошибка отрисовки итогов боя:', e);
    win.innerHTML = '<div class="bw-inner" style="padding:40px 16px;text-align:center;color:var(--text)">'
      + '<p style="font-size:40px;margin:0">🏁</p><p class="mt">Бой завершён.</p>'
      + '<button class="btn btn-orange mt" onclick="App._closeBattleWindow()">← Вернуться в легион</button></div>';
   }
  },

  _bindBattleWindowEvents(win, b) {
    const api = async (url, body, cb) => {
      try { const r = await API.post(url, body || {}); if(cb) cb(r); await App._renderBattleWindow(); }
      catch(e) { UI.toast('⛔ ' + e.message); }
    };

    // Выбор роли
    ['assault','guardian','medic'].forEach(role => {
      const btn = win.querySelector('#bw-join-'+role);
      if (btn) btn.onclick = () => api('/api/legion/battle/join', { role });
    });

    // Кнопка Готов / Не готов
    const readyBtn = win.querySelector('#bw-ready');
    if (readyBtn) {
      const newReady = !(b.me && b.me.ready);
      readyBtn.onclick = () => api('/api/legion/battle/ready', { ready: newReady });
    }

    // Направления
    for (let d = 1; d <= 5; d++) {
      const btn = win.querySelector('#bw-dir-'+d);
      if (btn) btn.onclick = () => api('/api/legion/battle/direction', { direction: d });
    }

    // Кнопки «Взять» в пустых слотах боевого пояса (фаза подготовки)
    win.querySelectorAll('[id^="bw-gear-add-"]').forEach(btn => {
      btn.onclick = () => App._showGearPicker(b);
    });

    // Атака
    win.querySelectorAll('[id^="bw-attack-"]').forEach(btn => {
      const uid = btn.id.replace('bw-attack-','');
      btn.onclick = () => api('/api/legion/battle/attack', { targetId: uid }, r => {
        UI.toast(`🎯 ${r.dmg} урона${r.crit?' 💥':''}${!r.targetAlive?' 💀':''}`)
      });
    });

    // Лечение
    win.querySelectorAll('[id^="bw-heal-"]').forEach(btn => {
      let uid = btn.id.replace('bw-heal-','');
      // Кнопка «Лечить себя» — подставляем свой userId
      if (uid === 'self') uid = b.me ? b.me.userId : '';
      btn.onclick = () => api('/api/legion/battle/heal', { targetId: uid }, r => {
        UI.toast(`➕ +${r.healed} HP${r.critHeal?' ✨':''}`)
      });
    });

    // Прикрытие
    win.querySelectorAll('[id^="bw-guard-"]').forEach(btn => {
      const uid = btn.id.replace('bw-guard-','');
      btn.onclick = () => api('/api/legion/battle/guard', { targetId: uid }, () => {
        UI.toast('🛡️ Прикрытие активировано')
      });
    });

    // Чат боя: переключение вкладок (командный/общий)
    const chatTeam = win.querySelector('#bw-chat-team');
    if (chatTeam) chatTeam.onclick = () => { App._bwChatMode = 'team'; App._renderBattleWindow(); };
    const chatGlobal = win.querySelector('#bw-chat-global');
    if (chatGlobal) chatGlobal.onclick = () => { App._bwChatMode = 'global'; App._renderBattleWindow(); };
    // Отправка сообщения
    const chatSend = win.querySelector('#bw-chat-send');
    if (chatSend) chatSend.onclick = async () => {
      const input = win.querySelector('#bw-chat-input');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      try {
        await API.post('/api/legion/battle/chat', { scope: App._bwChatMode || 'team', text });
        if (input) input.value = '';
        await App._renderBattleWindow();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    // Предметы — новый удобный поток. Тап «Применить» на поясе:
    win.querySelectorAll('[data-item]').forEach(btn => {
      btn.onclick = () => App._bwApplyItem(btn.dataset.item, b);
    });
    // «Применить сюда» на карточке цели (когда предмет взведён)
    win.querySelectorAll('[data-apply-item]').forEach(btn => {
      btn.onclick = () => App._bwItemPost(App._bwArmedItem, btn.dataset.applyItem);
    });
    // Отмена выбора цели
    const itemCancel = win.querySelector('#bw-item-cancel');
    if (itemCancel) itemCancel.onclick = () => { App._bwArmedItem = null; App._renderBattleWindow(); };

    // Покинуть бой
    const leaveBtn = win.querySelector('#bw-leave');
    if (leaveBtn) leaveBtn.onclick = async () => {
      if (!await UI.confirm('Ваша статистика не сохранится.', {title:'Покинуть бой?', icon:'🚪', okText:'Покинуть', danger:true})) return;
      try {
        await API.post('/api/legion/battle/leave');
        App._closeBattleWindow();
        App.rerender();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
  },

  _startBattleWindowTimer(b) {
    // Запускаем обратный отсчёт в шапке окна
    const timerEl = document.getElementById('bw-timer');
    if (!timerEl) return;
    const isPrep = b.phase === 'prep';
    let secs = isPrep ? (b.prepSecsLeft || 0) : (b.timeLeft || 0);
    const t = setInterval(() => {
      secs--;
      if (secs < 0) secs = 0;
      timerEl.textContent = UI.fmtTimer(secs);
      if (secs <= 0) {
        clearInterval(t);
        // Таймер подготовки истёк — не ждём следующий 4-сек poll, сразу
        // запрашиваем состояние (сервер лениво переведёт prep→active).
        if (isPrep) setTimeout(() => App._renderBattleWindow(), 300);
      }
    }, 1000);
  },

  // Публичная карточка легиона (модальное окно)
  async _showPublicLegion(legionId) {
    try {
      const data = await API.get('/api/legion/public/' + encodeURIComponent(legionId));
      const RANKS = ['Новобранец', 'Боец', 'Лидер отряда', 'Зам. Генерала', 'Генерал'];
      const popup = document.createElement('div');
      popup.id = 'legion-public-popup';
      popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px';
      const peek = data.adminPeek;
      const peekHtml = peek ? `
          <hr style="border:none;border-top:1px solid var(--gold);margin:12px 0">
          <div style="font-weight:bold;margin-bottom:8px;color:var(--gold)">👑 Обзор администратора</div>
          <div class="kv"><span class="k">💰 Казна</span><span class="v gold">$${UI.fmtNum(peek.treasury)}</span></div>
          <div class="kv"><span class="k">🔷 Резервы</span><span class="v">${UI.fmtNum(peek.reserves)} РЕЗ</span></div>
          <div class="kv"><span class="k">👂 Уши / 🎫 Жетоны казны</span><span class="v">${peek.treasuryEars} / ${peek.treasuryTokens}</span></div>
          <div class="kv"><span class="k">Лидер</span><span class="v">${UI.esc(peek.leaderName)}</span></div>
          <div class="kv"><span class="k">В бою сейчас</span><span class="v">${peek.hasActiveBattle ? '⚔️ да' : 'нет'}</span></div>
          ${peek.arsenal.length ? `<div style="margin-top:6px;font-size:12px"><b>Арсенал:</b> ${peek.arsenal.map(a => `${UI.esc(a.name)}×${a.count}`).join(', ')}</div>` : ''}
          ${peek.buildings.length ? `<div style="margin-top:4px;font-size:12px"><b>Постройки:</b> ${peek.buildings.map(a => `${UI.esc(a.name)}×${a.count}`).join(', ')}</div>` : ''}
          <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-green" id="lgadmin-join" style="flex:1;padding:8px">👑 Вступить</button>
            <button class="btn btn-orange" id="lgadmin-invest" style="flex:1;padding:8px">💰 Вложить ресурсы</button>
          </div>` : '';
      popup.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;max-width:420px;width:100%;max-height:80vh;overflow-y:auto;padding:20px">
          <div style="text-align:right"><button onclick="document.getElementById('legion-public-popup').remove()" class="btn btn-inline">✕</button></div>
          <div style="font-size:18px;font-weight:bold;text-align:center;margin-bottom:12px">🏰 ${UI.esc(data.name)}</div>
          <div class="kv"><span class="k">Уровень</span><span class="v gold">${data.legionLevel} ⭐</span></div>
          <div class="kv"><span class="k">Слава</span><span class="v">${UI.fmtNum(data.gloryPoints)} ⭐</span></div>
          <div class="kv"><span class="k">Победы</span><span class="v" style="color:var(--green)">${(data.battleStats || {}).wins || 0}</span></div>
          <div class="kv"><span class="k">Поражения</span><span class="v" style="color:var(--red)">${(data.battleStats || {}).losses || 0}</span></div>
          <div class="kv"><span class="k">Бойцов</span><span class="v">${data.memberCount}</span></div>
          ${peekHtml}
          <hr style="border:none;border-top:1px solid var(--border);margin:12px 0">
          <div style="font-weight:bold;margin-bottom:8px">👥 Состав</div>
          ${data.members.map(m => `<div class="kv"><span class="k">${App._flagImg(m.flag)} ${UI.esc(m.name)} <span class="muted small">Ур.${m.level}</span></span><span class="v"><span class="badge ${m.rank >= 4 ? 'green' : m.rank >= 3 ? 'orange' : ''}">${RANKS[m.rank] || 'Новобранец'}</span></span></div>`).join('')}
        </div>`;
      document.getElementById('legion-public-popup')?.remove();
      document.body.appendChild(popup);
      popup.onclick = e => { if (e.target === popup) popup.remove(); };

      // Админ-действия
      const joinBtn = popup.querySelector('#lgadmin-join');
      if (joinBtn) joinBtn.onclick = async () => {
        if (!await UI.confirm(`Вступить в легион «${data.name}» без разрешения лидера?`, { title: '👑 Админ-вступление', okText: 'Вступить' })) return;
        try { const r = await API.post('/api/legion/admin-join', { legionId }); UI.toast((r.notices && r.notices[0]) || 'Вступление выполнено'); popup.remove(); await App.refreshMe(); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
      const investBtn = popup.querySelector('#lgadmin-invest');
      if (investBtn) investBtn.onclick = () => App._adminInvestLegion(legionId, data.name);
    } catch(e) { UI.toast('⛔ ' + e.message); }
  },

  // Диалог админ-вклада ресурсов в легион
  async _adminInvestLegion(legionId, legionName) {
    const RES = [['treasury', '💰 Казна ($)'], ['reserves', '🔷 Резервы (РЕЗ)'], ['ears', '👂 Уши'], ['tokens', '🎫 Жетоны']];
    const pop = document.createElement('div');
    pop.id = 'lgadmin-invest-pop';
    pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
    pop.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--gold);border-radius:10px;max-width:360px;width:100%;padding:20px">
        <div style="font-weight:bold;text-align:center;margin-bottom:12px">💰 Вложить в «${UI.esc(legionName)}»</div>
        <label class="news-lbl">Ресурс</label>
        <select id="lgai-res" class="news-input">${RES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <label class="news-lbl mt">Количество</label>
        <input id="lgai-amt" class="news-input" type="number" min="1" placeholder="Например 10000" value="10000">
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn btn-orange" id="lgai-ok" style="flex:1">Вложить</button>
          <button class="btn btn-inline" id="lgai-cancel" style="flex:1">Отмена</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    const close = () => pop.remove();
    pop.onclick = (e) => { if (e.target === pop) close(); };
    pop.querySelector('#lgai-cancel').onclick = close;
    pop.querySelector('#lgai-ok').onclick = async () => {
      const resource = pop.querySelector('#lgai-res').value;
      const amount = parseInt(pop.querySelector('#lgai-amt').value, 10);
      if (!amount || amount <= 0) { UI.toast('⛔ Введите положительное число'); return; }
      try { const r = await API.post('/api/legion/admin-deposit', { legionId, amount, resource }); UI.toast((r.notices && r.notices[0]) || 'Вложено'); close(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
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
        ['attack_lost', 'attack_defended', 'rocket_incoming', 'mine_terror'].includes(n.kind));
      if (!latest) return;
      if (App._shownNotifIds && App._shownNotifIds.has(latest.id)) return;
      if (!App._shownNotifIds) App._shownNotifIds = new Set();
      App._shownNotifIds.add(latest.id);

      // Нападение террористов на шахту — отдельный баннер с переходом в «Шахты»,
      // показывается на любом экране (в т.ч. на главном).
      if (latest.kind === 'mine_terror') { App._showMineTerrorBanner(latest); return; }
      // Летящая ракета — баннер с переходом к лазерам (сбить за 10 минут).
      if (latest.kind === 'rocket_incoming') { App._showRocketIncomingBanner(latest); return; }

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
        <div class="kv"><span class="k">Награблено</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtNum(p.loot)}</span></div>
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

  // Баннер летящей ракеты — на любом экране; ведёт к лазерам (сбить за 10 мин).
  _showRocketIncomingBanner(n) {
    if (document.getElementById('rocket-incoming-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'rocket-incoming-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:linear-gradient(90deg,#8e2626,#5f1b1b);color:#fff;padding:10px 16px;text-align:center;cursor:pointer;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.3);';
    const att = (n.meta && n.meta.attackerName) ? UI.esc(n.meta.attackerName) : 'Противник';
    banner.innerHTML = `🚀 ${att} запустил по вам ракету! Долёт ~10 мин — нажмите, чтобы сбить её лазером.`;
    banner.onclick = () => {
      if (banner.parentNode) document.body.removeChild(banner);
      API.post(`/api/notifications/${n.id}/read`).catch(() => {});
      App.go('production/lasers');
    };
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) document.body.removeChild(banner); }, 12000);
  },

  // Окна попаданий ракет по игроку (для офлайн-цели). Показываем по очереди,
  // каждое — со списком жертв (техника/здания/диверсанты), затем закрываем на сервере.
  async _showRocketHits(list) {
    if (!list || !list.length) return;
    if (document.getElementById('rocket-hit-window')) return;
    for (const rep of list) {
      await new Promise((resolve) => {
        const techRows = Object.entries(rep.techLost || {}).map(([nm, cnt]) =>
          `<div class="kv"><span class="k">${UI.esc(nm)}</span><span class="v dmg-take">−${cnt}</span></div>`).join('') || '<p class="muted small">Техника уцелела</p>';
        const buildRows = Object.entries(rep.destroyedBuildings || {}).map(([nm, cnt]) =>
          `<div class="kv"><span class="k">${UI.esc(nm)}</span><span class="v dmg-take">−${cnt}</span></div>`).join('') || '<p class="muted small">Постройки уцелели</p>';
        const sab = rep.lostSaboteurs && Object.keys(rep.lostSaboteurs).length
          ? Object.entries(rep.lostSaboteurs).map(([nm, cnt]) => `<div class="kv"><span class="k">🥷 ${UI.esc(nm)}</span><span class="v dmg-take">−${cnt}</span></div>`).join('')
          : '';
        const popup = document.createElement('div');
        popup.id = 'rocket-hit-window';
        popup.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:10003;display:flex;align-items:center;justify-content:center;padding:16px';
        popup.innerHTML = `
          <div style="background:var(--card);border:2px solid var(--red);border-radius:12px;max-width:440px;width:100%;padding:20px;max-height:85vh;overflow-y:auto">
            <div style="font-size:18px;font-weight:bold;text-align:center;margin-bottom:4px">🚀 По вам нанесён ракетный удар!</div>
            <p class="muted small" style="text-align:center;margin-bottom:14px">От: <b>${UI.esc(rep.attackerName || 'неизвестно')}</b> · Мощность ${rep.powerPct}%</p>
            <div style="display:flex;gap:10px;margin-bottom:14px">
              <div style="flex:1;text-align:center;padding:12px;border:1px solid var(--red);border-radius:8px">
                <div style="font-size:24px;font-weight:bold;color:var(--red)">${rep.techDestroyedCount || 0}</div>
                <div class="muted small">единиц техники</div>
              </div>
              <div style="flex:1;text-align:center;padding:12px;border:1px solid var(--red);border-radius:8px">
                <div style="font-size:24px;font-weight:bold;color:var(--red)">${rep.buildingsDestroyedCount || 0}</div>
                <div class="muted small">зданий</div>
              </div>
            </div>
            <div style="margin-bottom:10px"><b>🔧 Уничтоженная техника:</b>${techRows}</div>
            <div style="margin-bottom:10px"><b>🏚 Разрушенные здания:</b>${buildRows}</div>
            ${sab ? `<div style="margin-bottom:14px"><b>🥷 Погибшие диверсанты:</b>${sab}</div>` : ''}
            <button class="btn btn-orange" id="rocket-hit-close" style="width:100%">Закрыть</button>
          </div>`;
        document.body.appendChild(popup);
        popup.querySelector('#rocket-hit-close').onclick = async () => {
          popup.remove();
          try { await API.post('/api/rockets/dismiss-hit'); } catch (e) {}
          resolve();
        };
      });
    }
    App.refreshMe && App.refreshMe();
  },

  // Баннер нападения террористов на шахту — на любом экране; ведёт в «Шахты».
  _showMineTerrorBanner(n) {
    if (document.getElementById('mine-terror-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'mine-terror-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:linear-gradient(90deg,#8e3326,#6b251b);color:#fff;padding:10px 16px;text-align:center;cursor:pointer;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.3);';
    banner.innerHTML = '⚠️ На вашу шахту напали террористы — нажмите, чтобы отбить атаку!';
    banner.onclick = () => {
      if (banner.parentNode) document.body.removeChild(banner);
      API.post(`/api/notifications/${n.id}/read`).catch(() => {});
      App.go('production/mines');
    };
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) document.body.removeChild(banner); }, 12000);
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
    // #reset/<token> — ссылка для сброса пароля из письма
    if (name === 'reset' && param) {
      App._handlePasswordReset(param); return;
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
    const mail = m.mailUnread > 0 ? `<span class="ic-mail"></span> <span class="badge">${m.mailUnread}</span>` : '<span class="ic-mail"></span>';
    const bell = m.notifUnread > 0 ? `<span class="ic-bell"></span> <span class="badge">${m.notifUnread}</span>` : '<span class="ic-bell"></span>';
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
        <div class="clickable" onclick="App.go('bank')"><span class="ic-dollar"></span> <span class="money" id="hd-dollars">${UI.fmtMoney(m.dollars)}</span></div>
        <div class="clickable" onclick="App.go('market')"><span class="ic-gold" aria-hidden="true"></span> <span class="gold" id="hd-gold">${UI.fmtNum(m.gold)}</span></div>
        <div class="clickable" onclick="App.go('${lvlTarget}')">⭐ <span class="lvl">Ур. ${m.level}</span>${m.skillPoints > 0 ? ' <span class="badge">+' + m.skillPoints + '</span>' : ''}</div>
        <div class="clickable" onclick="App.go('notifications')">${bell}</div>
        <div class="clickable" onclick="App.go('mail')">${mail}</div>
      </div>
      <div class="stat-row">
        <div class="clickable" onclick="App.go('hospital')" title="В госпиталь"><span class="ic-health"></span> <span class="stat-hp" id="st-hp">${m.res.hp.cur}/${m.res.hp.max}</span> <span class="timer" id="st-hp-t"></span></div>
        <div class="clickable" onclick="App.go('missions')" title="В спецоперации"><span class="ic-energy"></span> <span class="stat-en" id="st-en">${m.res.en.cur}/${m.res.en.max}</span> <span class="timer" id="st-en-t"></span></div>
        <div class="clickable" onclick="App.go('war')" title="В бой"><span class="ic-ammo"></span> <span class="stat-am" id="st-am">${m.res.am.cur}/${m.res.am.max}</span> <span class="timer" id="st-am-t"></span></div>
      </div>
      ${m.res.hp.cur < 25 ? `
        <div class="low-hp-banner" onclick="App._quickHeal()">
          ⚠️ Здоровье ниже 25 — атаки запрещены. <b>Восстановить полностью за <span class="ic-dollar"></span>${UI.fmtMoney(m.healCost || 0)}</b>
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
    if (!await UI.confirm(`Восстановить здоровье за $${UI.fmtMoney(App.me.healCost)}?`, {title:'Лазарет', icon:'🏥', okText:'Лечиться'})) return;
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
      <p class="muted small center">Потрачено: <span class="gold"><span class="ic-gold"></span> ${UI.fmtNum(r.spent)}</span></p>
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

  // Обработка ссылки сброса пароля: #reset/<token>
  async _handlePasswordReset(token) {
    const c = document.getElementById('content');
    App.renderHeader();
    c.innerHTML = `
      <div class="title">🔑 Новый пароль</div>
      <div class="card">
        <p class="muted small">Задайте новый пароль для входа в игру (минимум 8 символов, буквы и цифры).</p>
        <label for="rs-pass">Новый пароль</label>
        <input type="password" id="rs-pass" autocomplete="new-password" placeholder="Не менее 8 символов" minlength="8">
        <label for="rs-pass2">Повторите пароль</label>
        <input type="password" id="rs-pass2" autocomplete="new-password" placeholder="Ещё раз">
        <button class="btn btn-orange mt" id="rs-go">Сохранить пароль</button>
      </div>`;
    document.getElementById('rs-go').onclick = async () => {
      const p1 = document.getElementById('rs-pass').value;
      const p2 = document.getElementById('rs-pass2').value;
      if (p1.length < 8) { UI.toast('⛔ Пароль минимум 8 символов'); return; }
      if (!/[A-Za-zА-Яа-яЁё]/.test(p1) || !/[0-9]/.test(p1)) { UI.toast('⛔ Пароль должен содержать буквы и цифры'); return; }
      if (p1 !== p2) { UI.toast('⛔ Пароли не совпадают'); return; }
      try {
        await API.post('/api/reset-password', { token, password: p1 });
        c.innerHTML = `
          <div class="title">✅ Пароль изменён</div>
          <div class="card center">
            <p style="font-size:40px">🔓</p>
            <p class="mt">Новый пароль сохранён. Теперь войдите с ним.</p>
            <button class="btn btn-orange mt" onclick="location.hash='#auth'">Ко входу</button>
          </div>`;
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  },
};
