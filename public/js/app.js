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
    // Открываем боевое окно автоматически:
    //   • если игрок участник боя клана (фаза prep/active);
    //   • если игрок — лидер и есть входящий вызов (нужно решить).
    // Дальше окно периодически перерисовывается через _bwPoll.
    if (App.me && App.me.legionId) {
      try {
        const r = await API.get('/api/legion/battle');
        if (App._shouldShowBattleWindow(r)) {
          setTimeout(() => App._openBattleWindow(), 500);
        }
      } catch(e) {}
    }

    // Периодическая синхронизация с сервером и посекундный тик шапки
    // pollMe вызывается только при действиях игрока
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
      // Открываем боевое окно если игрок участвует в бою
      // (или если лидеру пришёл вызов, требующий решения)
      if (App.me.legionId && !document.getElementById('battle-window')) {
        try {
          const r = await API.get('/api/legion/battle');
          if (App._shouldShowBattleWindow(r)) App._openBattleWindow();
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
  // Это ОТДЕЛЬНЫЙ DOM-узел поверх любого экрана: при переходе на
  // другой раздел (#war, #home, …) окно не закрывается — игрок может
  // продолжать управлять боем, оставаясь в любой части игры.
  _battleWindow: null,
  _bwPollId: null,
  _bwClosedManually: false, // игрок свернул окно — не открываем снова сам

  // Окно показываем, когда:
  //   • есть activeBattle и фаза prep/active (для всех членов легиона);
  //   • есть pendingChallenge с role='challenged' (только лидеру —
  //     ему надо принять или отклонить вызов).
  _shouldShowBattleWindow(r) {
    if (!r) return false;
    if (r.battle && (r.battle.phase === 'prep' || r.battle.phase === 'active')) return true;
    if (r.challenge && r.challenge.canDecide) return true;
    return false;
  },

  async _openBattleWindow() {
    if (document.getElementById('battle-window')) return; // уже открыто
    App._bwClosedManually = false;
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
    // Авто-обновление окна раз в 3 сек, пока оно открыто
    if (App._bwPollId) clearInterval(App._bwPollId);
    App._bwPollId = setInterval(() => {
      if (!document.getElementById('battle-window')) {
        clearInterval(App._bwPollId); App._bwPollId = null; return;
      }
      App._renderBattleWindow();
    }, 3000);
  },

  async _renderBattleWindow() {
    const win = document.getElementById('battle-window');
    if (!win) return;
    if (!App.me || !App.me.legionId) { App._closeBattleWindow(); return; }
    try {
      const r = await API.get('/api/legion/battle');
      // 1) Активный бой
      if (r.battle) {
        if (r.battle.phase === 'done') {
          App._renderBattleDone(win, r.battle);
        } else {
          App._renderBattleContent(win, r.battle);
        }
        return;
      }
      // 2) Входящий вызов — окно для лидера с «Принять/Отклонить»
      if (r.challenge && r.challenge.canDecide) {
        App._renderChallengePrompt(win, r.challenge);
        return;
      }
      // Ни боя, ни вызова — закрываем
      App._closeBattleWindow();
    } catch(e) {
      App._closeBattleWindow();
    }
  },

  _closeBattleWindow() {
    const win = document.getElementById('battle-window');
    if (win) win.remove();
    App._battleWindow = null;
    if (App._bwPollId) { clearInterval(App._bwPollId); App._bwPollId = null; }
  },

  // Свернуть окно вручную — игрок хочет временно вернуться к игре,
  // но не выходит из боя. Окно можно открыть снова из карточки боя
  // на странице легиона (или вернётся само при следующем pollMe).
  _hideBattleWindow() {
    App._closeBattleWindow();
    App._bwClosedManually = true;
    UI.toast('Окно боя свёрнуто. Нажмите «Открыть бой» в меню легиона, чтобы вернуться.');
  },

  // Окно «Вам бросили вызов». Только лидер обороняющегося легиона.
  _renderChallengePrompt(win, ch) {
    win.innerHTML = `
      <div style="padding:24px 16px;text-align:center;max-width:480px;margin:0 auto">
        <div style="font-size:60px;margin-bottom:8px">⚔️</div>
        <div style="font-size:22px;font-weight:bold;color:var(--red);margin-bottom:6px">ВАМ БРОСИЛИ ВЫЗОВ!</div>
        <p class="muted">Легион <b style="color:var(--text)">«${UI.esc(ch.enemyName)}»</b> вызывает вас на бой.</p>
        <p class="muted small" style="margin-top:12px">На решение: <b id="ch-timer" style="color:var(--orange)">${UI.fmtTimer(ch.secondsLeft)}</b></p>
        <p class="muted small">Если принять — 10 минут на подготовку, затем 1 час боя.</p>
        <div style="display:flex;gap:10px;margin-top:24px">
          <button id="ch-accept" class="btn btn-orange" style="flex:1;padding:14px;font-weight:bold">✅ Принять</button>
          <button id="ch-decline" class="btn btn-red" style="flex:1;padding:14px">🚫 Отклонить</button>
        </div>
        <button id="ch-hide" class="btn" style="width:100%;margin-top:8px;padding:10px;opacity:.7">Закрыть окно</button>
      </div>`;

    // Локальный обратный отсчёт
    let secs = ch.secondsLeft;
    const tEl = document.getElementById('ch-timer');
    const t = setInterval(() => {
      secs--;
      if (secs < 0) { clearInterval(t); App._renderBattleWindow(); return; }
      if (tEl) tEl.textContent = UI.fmtTimer(secs);
    }, 1000);

    win.querySelector('#ch-accept').onclick = async () => {
      try {
        await API.post('/api/legion/challenge/accept');
        UI.toast('✅ Вызов принят! Окно подготовки открыто.');
        await App._renderBattleWindow();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
    win.querySelector('#ch-decline').onclick = async () => {
      if (!confirm('Отклонить вызов?')) return;
      try {
        await API.post('/api/legion/challenge/decline');
        UI.toast('🚫 Вызов отклонён.');
        App._closeBattleWindow();
        App.rerender();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };
    win.querySelector('#ch-hide').onclick = () => App._hideBattleWindow();
  },

  _renderBattleContent(win, b) {
    const ROLE_ICON = { assault: '🎯', guardian: '🛡️', medic: '➕' };

    const hpBar = (hp, maxHp, color) => {
      const pct = Math.round(hp / Math.max(1, maxHp) * 100);
      return `<div style="background:rgba(255,255,255,.1);border-radius:4px;height:7px;margin:3px 0;overflow:hidden">
        <div style="background:${color};height:100%;width:${pct}%;transition:width .2s"></div>
      </div><div style="font-size:11px;color:var(--dim)">HP ${hp}/${maxHp}</div>`;
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
      <div style="position:sticky;top:0;z-index:10;background:var(--bg, #0a0f1a);border-bottom:2px solid var(--border);padding:10px 16px">
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
          <span style="color:var(--red)">🔴 Врagi: ${UI.fmtNum(scores[mySide==='A'?'B':'A']||0)} очк.</span>
        </div>` : ''}
      </div>
      <div style="padding:10px 16px">`;

    // ── ФАЗА ПОДГОТОВКИ ──────────────────────────────────────────
    // Логика:
    //   1) Игрок ВЫБИРАЕТ роль (если ещё не выбрал) — это создаёт
    //      combatant с ready=false. Зайти в окно может любой член
    //      легиона, выбор роли пока не блокирует ничего.
    //   2) Кнопка «Готов / Не готов» — toggle. Без нажатия Готов в
    //      бой не попадёшь.
    //   3) Если Готов — открывается выбор направления. Имя и роль
    //      попадают в карточку направления, видны союзникам.
    //   4) Воевать (Атаковать / Защищать / Лечить) — только когда
    //      бой стартанёт (фаза active).
    if (b.phase === 'prep') {
      const me = b.me;
      const isReady = !!(me && me.ready);
      const hasRole = !!me;

      // Карточка «Моя роль и готовность»
      html += `<div style="background:${isReady?'rgba(0,200,0,.08)':'rgba(255,150,0,.08)'};border:1px solid ${isReady?'var(--green)':'var(--orange)'};border-radius:8px;padding:10px;margin-bottom:12px">`;
      if (!hasRole) {
        html += `<p style="margin:0 0 10px"><b>Выберите роль:</b> все роли могут атаковать.</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button id="bw-join-assault" class="btn btn-orange" style="width:100%;padding:12px;text-align:left">
              🎯 <b>Штурмовик</b> <span class="muted small">— +20% атаки</span>
            </button>
            <button id="bw-join-guardian" class="btn btn-orange" style="width:100%;padding:12px;text-align:left">
              🛡️ <b>Защитник</b> <span class="muted small">— +20% защиты, −20% урона, прикрытие союзников</span>
            </button>
            <button id="bw-join-medic" class="btn btn-orange" style="width:100%;padding:12px;text-align:left">
              ➕ <b>Медик</b> <span class="muted small">— лечение союзников + атака</span>
            </button>
          </div>`;
      } else {
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:18px">${ROLE_ICON[me.role]||'?'}</span>
          <b>Ваша роль: ${UI.esc(me.roleName)}</b>
        </div>
        <button id="bw-ready" class="btn ${isReady?'btn-red':'btn-orange'}" style="width:100%;padding:12px;font-weight:bold">
          ${isReady ? '❌ Снять готовность' : '✅ Я ГОТОВ'}
        </button>
        ${!isReady ? '<p class="muted small" style="margin:8px 0 0">Не нажав «Готов», вы НЕ попадёте в бой.</p>' : ''}
        <details style="margin-top:10px"><summary class="muted small" style="cursor:pointer">Сменить роль</summary>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            ${['assault','guardian','medic'].map(r => r === me.role ? '' : `
              <button class="btn btn-inline" id="bw-join-${r}" style="flex:1;padding:8px">${ROLE_ICON[r]} ${r === 'assault' ? 'Штурмовик' : r === 'guardian' ? 'Защитник' : 'Медик'}</button>
            `).join('')}
          </div>
        </details>`;
      }
      html += `</div>`;

      // Направления (всегда видны)
      html += `<p style="margin:14px 0 6px;font-weight:bold">📍 Направления</p>`;
      if (!isReady && hasRole) {
        html += `<p class="muted small" style="margin:0 0 8px">Нажмите «Готов», чтобы занять направление.</p>`;
      }
      html += `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">`;
      for (const d of (b.directions || [])) {
        const allies  = (d.allies  || []);
        const enemies = (d.enemies || []);
        const sel = me && me.direction === d.dir;
        const full = allies.length >= 5;
        const canPick = isReady && (sel || !full);
        html += `<div style="border:1px solid ${sel?'var(--green)':'var(--border)'};border-radius:8px;overflow:hidden">
          <button id="bw-dir-${d.dir}" class="btn btn-inline" ${canPick?'':'disabled'} style="width:100%;padding:10px;text-align:left;background:${sel?'rgba(0,200,0,.10)':'transparent'};border:none;border-radius:0;${canPick?'':'opacity:.5;cursor:not-allowed'}">
            ${sel?'📍':'○'} <b>${d.name}</b>
            <span style="float:right;font-size:12px">🟢${allies.length}/5 · 🔴${enemies.length}</span>
          </button>
          ${(allies.length || enemies.length) ? `
            <div style="padding:6px 12px 10px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <div>
                ${allies.map(a => `<div style="padding:2px 0;color:${a.userId===(me&&me.userId)?'var(--gold)':'var(--text)'}">${ROLE_ICON[a.role]||'?'} ${UI.esc(a.name)}</div>`).join('') || '<span class="muted">пусто</span>'}
              </div>
              <div>
                ${enemies.map(e => `<div style="padding:2px 0;color:var(--dim)">${ROLE_ICON[e.role]||'?'} ${UI.esc(e.name)}</div>`).join('') || '<span class="muted">пусто</span>'}
              </div>
            </div>` : ''}
        </div>`;
      }
      html += `</div>`;

      // Общий список (без направления) + готовы / не готовы
      const all = b.allCombatants || [];
      const myUnassigned = all.filter(c => c.side === mySide && !c.direction);
      const enUnassigned = all.filter(c => c.side !== mySide && !c.direction);
      const myReady = all.filter(c => c.side === mySide && c.ready).length;
      const enReady = all.filter(c => c.side !== mySide && c.ready).length;

      html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <div style="padding:10px;border-right:1px solid var(--border)">
          <div style="color:var(--green);font-weight:bold;margin-bottom:6px">🟢 Ваши: ${myReady} готовы / ${all.filter(c => c.side===mySide).length} зашло</div>
          ${myUnassigned.length ? `<div class="muted small" style="margin-bottom:4px">Без направления:</div>
            ${myUnassigned.map(c => `<div style="padding:2px 0;font-size:12px">${ROLE_ICON[c.role]||'?'} ${UI.esc(c.name)} ${c.ready?'<span style="color:var(--green)">●</span>':'<span style="color:var(--dim)">○</span>'}</div>`).join('')}` : '<span class="muted small">все распределены</span>'}
        </div>
        <div style="padding:10px">
          <div style="color:var(--red);font-weight:bold;margin-bottom:6px">🔴 Враги: ${enReady} готовы / ${all.filter(c => c.side!==mySide).length} зашло</div>
          ${enUnassigned.length ? enUnassigned.map(c => `<div style="padding:2px 0;font-size:12px">${ROLE_ICON[c.role]||'?'} ${UI.esc(c.name)} ${c.ready?'<span style="color:var(--green)">●</span>':'<span style="color:var(--dim)">○</span>'}</div>`).join('') : '<span class="muted small">ожидаем...</span>'}
        </div>
      </div>`;
    }

    // ── АКТИВНЫЙ БОЙ ─────────────────────────────────────────────
    if (b.phase === 'active' && b.me) {
      const me = b.me;
      const myCDs = b.cooldowns || {};

      // Мой статус
      const myAm = App.me && App.me.res && App.me.res.am ? App.me.res.am.cur : '?';
      const myEn = App.me && App.me.res && App.me.res.en ? App.me.res.en.cur : '?';
      html += `<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:18px">${ROLE_ICON[me.role]||'?'}</span>
          <b>Вы — ${me.roleName}</b>
          ${statusBadge(me)}
        </div>
        ${hpBar(me.hp, me.maxHp, '#e33')}
        <div style="font-size:12px;color:var(--dim);margin-top:4px;display:flex;gap:10px;flex-wrap:wrap">
          <span>🎯 <b>${myAm}</b> боеприпасов</span>
          <span>⚡ <b>${myEn}</b> энергии</span>
          <span>Кд действия: <b id="bw-cd-action">${myCDs.action||0}с</b></span>
          <span>Кд перемещения: <b id="bw-cd-move">${myCDs.move||0}с</b></span>
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:11px">1 удар = −1 боеприпас. Эффекты чёрного рынка (стимулятор, накладки и т.д.) учитываются.</p>
      </div>`;

      // Направления — кнопки
      html += `<div style="margin-bottom:10px">
        ${b.directions.map(d => {
          const sel = me.direction === d.dir;
          const al = (d.allies||[]).filter(x=>x.alive).length;
          const en2 = (d.enemies||[]).filter(x=>x.alive).length;
          return `<button id="bw-dir-${d.dir}" class="btn ${sel?'btn-green':'btn-inline'}" style="width:100%;padding:10px;text-align:left;margin-bottom:6px;${sel?'border:2px solid var(--green)':''}">
            ${sel?'📍':'○'} <b>${d.name}</b>
            <span style="float:right;font-size:12px">🟢${al} 🔴${en2}</span>
          </button>`;
        }).join('')}
      </div>`;

      // Союзники на моём направлении
      if (me.direction !== null) {
        const dirData = b.directions.find(x=>x.dir===me.direction);
        if (dirData) {
          const aliveAllies = (dirData.allies||[]).filter(a=>a.userId!==me.userId&&a.alive);
          if (aliveAllies.length > 0) {
            html += `<div style="border-left:3px solid var(--green);padding:8px 12px;margin-bottom:8px">
              <div style="color:var(--green);font-weight:bold;margin-bottom:6px">🟢 Союзники — ${dirData.name}</div>
              ${aliveAllies.map(a => `
                <div style="padding:8px 0;border-bottom:1px solid var(--border-dim)">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span>${ROLE_ICON[a.role]||'?'}</span><b>${UI.esc(a.name)}</b>
                    <span class="muted small">${a.roleName}</span> ${statusBadge(a)}
                  </div>
                  ${hpBar(a.hp, a.maxHp, '#0a8')}
                  <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
                    ${me.role==='guardian'?`<button class="btn btn-orange" style="flex:1;padding:8px" id="bw-guard-${a.userId}">🛡️ Прикрыть</button>`:''}
                    ${me.role==='medic'?`<button class="btn btn-green" style="flex:1;padding:8px" id="bw-heal-${a.userId}">➕ Лечить</button>`:''}
                  </div>
                </div>`).join('')}
            </div>`;
          }

          // Враги
          const aliveEn = (dirData.enemies||[]).filter(e=>e.alive);
          if (aliveEn.length > 0) {
            html += `<div style="border-left:3px solid var(--red);padding:8px 12px;margin-bottom:8px">
              <div style="color:var(--red);font-weight:bold;margin-bottom:6px">🔴 Враги — ${dirData.name}</div>
              ${aliveEn.map(en => `
                <div style="padding:8px 0;border-bottom:1px solid var(--border-dim)">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span>${ROLE_ICON[en.role]||'?'}</span><b>${UI.esc(en.name)}</b>
                    <span class="muted small">${en.roleName}</span> ${statusBadge(en)}
                  </div>
                  ${hpBar(en.hp, en.maxHp, '#c22')}
                  <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
                    <button class="btn btn-red" style="flex:1;padding:8px" id="bw-attack-${en.userId}">🎯 Атаковать</button>
                    ${me.gear&&me.gear.length?`<button class="btn btn-orange" style="flex:1;padding:8px" onclick="App._bwItemTarget='${en.userId}';App._bwItemTargetName='${UI.esc(en.name).replace(/'/g,'')}';App._renderBattleWindow()">🎒 Предмет</button>`:''}
                  </div>
                </div>`).join('')}
            </div>`;
          }

          if (!aliveAllies.length && !aliveEn.length) {
            html += `<p class="muted center small">На «${dirData.name}» никого — перейдите на другое направление</p>`;
          }
        }
      }

      // Боевой пояс
      if (me.gear && me.gear.length > 0) {
        const itemNames = {
          gas_grenade:'💨 Газовая шашка',flashbang:'💥 Светошумовая',
          assault_grenade:'🔴 Граната',napalm:'🔥 Напалм',
          uranium_ammo:'☢️ Боеприпасы с ураном',hydrogen_bomb:'💣 Водородная бомба',
          medkit:'🩹 Аптечка',dome:'🔵 Купол',kevlar:'🦺 Бронеплиты',reflect_shield:'🪞 Отраж. щит',
        };
        const done = new Set();
        html += `<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <b>🎒 Боевой пояс${App._bwItemTarget?` → цель: <span style="color:var(--gold)">${App._bwItemTargetName||App._bwItemTarget}</span>`:''}</b>
          <div style="margin-top:8px">
          ${me.gear.map(id=>{
            if(done.has(id))return'';done.add(id);
            const cnt=me.gear.filter(x=>x===id).length;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-dim)">
              <span style="font-size:13px">${itemNames[id]||id} ×${cnt}</span>
              <button class="btn btn-orange btn-inline" id="bw-item-${id}">Применить</button>
            </div>`;
          }).join('')}
          </div>
        </div>`;
      }

      // Лог
      if (b.log && b.log.length) {
        html += `<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <b style="font-size:13px">📋 Лог</b>
          <div style="max-height:120px;overflow-y:auto;margin-top:6px">
          ${b.log.slice().reverse().map(e=>{
            const col=e.kind==='crit'?'#f55':e.kind==='heal'?'#0b8':e.kind==='item'?'#fa0':'var(--dim)';
            return `<div style="color:${col};font-size:11px;padding:2px 0">${UI.esc(e.text)}</div>`;
          }).join('')}
          </div>
        </div>`;
      }
    }

    html += `</div>
      <div style="padding:10px 16px 20px;border-top:1px solid var(--border);display:flex;gap:10px">
        <button id="bw-hide" class="btn btn-inline" style="flex:1;padding:12px">↘️ Свернуть</button>
        <button id="bw-leave" class="btn btn-red" style="flex:1;padding:12px;opacity:.85">🚪 Покинуть бой</button>
      </div>
      <p style="text-align:center;font-size:11px;color:var(--dim);margin-top:0;padding:0 16px 20px">
        «Свернуть» — окно скроется, но вы остаётесь в бою.&nbsp;«Покинуть» — выход без сохранения статистики.
      </p>`;

    win.innerHTML = html;
    App._bindBattleWindowEvents(win, b);
    App._startBattleWindowTimer(b);
  },

  _renderBattleDone(win, b) {
    const mySide = b.mySide;
    const won = b.winningSide === mySide;
    const r = b.finalReport;
    const scores = r ? r.activityScores : {};
    const ROLE_ICON = { assault: '🎯', guardian: '🛡️', medic: '➕' };

    win.innerHTML = `
      <div style="padding:24px 16px;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">${won ? '🏆' : '💀'}</div>
        <div style="font-size:22px;font-weight:bold;color:var(--${won?'green':'red'});margin-bottom:12px">
          ${won ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}
        </div>
        ${r ? `
        <div style="display:flex;justify-content:space-around;margin:16px 0;font-size:18px">
          <span style="color:var(--green)">🟢 ${UI.fmtNum(scores[mySide]||0)}</span>
          <span>vs</span>
          <span style="color:var(--red)">🔴 ${UI.fmtNum(scores[mySide==='A'?'B':'A']||0)}</span>
        </div>
        <div style="margin-bottom:16px;text-align:left">
          <p style="font-weight:bold;margin-bottom:8px">🏅 Лучшие</p>
          ${r.topAssault  ? `<div>🎯 ${UI.esc(r.topAssault.name)}: ${UI.fmtNum(r.topAssault.stats.dmgDealt)} урона</div>` : ''}
          ${r.topGuardian ? `<div>🛡️ ${UI.esc(r.topGuardian.name)}: ${r.topGuardian.stats.guards} прикрытий</div>` : ''}
          ${r.topMedic    ? `<div>➕ ${UI.esc(r.topMedic.name)}: ${UI.fmtNum(r.topMedic.stats.healed)} HP вылечено</div>` : ''}
        </div>` : ''}
        <button class="btn btn-orange" style="width:100%;padding:14px" id="bw-close">
          ← Вернуться в легион
        </button>
      </div>`;

    win.querySelector('#bw-close').onclick = () => App._closeBattleWindow();
  },

  _bindBattleWindowEvents(win, b) {
    const api = async (url, body, cb) => {
      try {
        const r = await API.post(url, body || {});
        if (cb) cb(r);
        // Обновим состояние игрока (HP/EN/AM в шапке) и перерисуем окно
        await App.pollMe();
        await App._renderBattleWindow();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };

    // Выбор / смена роли
    ['assault','guardian','medic'].forEach(role => {
      const btn = win.querySelector('#bw-join-'+role);
      if (btn) btn.onclick = () => api('/api/legion/battle/join', { role });
    });

    // Кнопка «Готов / Не готов»
    const readyBtn = win.querySelector('#bw-ready');
    if (readyBtn) readyBtn.onclick = () => {
      const isReady = b.me && b.me.ready;
      api('/api/legion/battle/ready', { ready: !isReady });
    };

    // Направления — кликабельны только не-disabled
    for (let d = 1; d <= 5; d++) {
      const btn = win.querySelector('#bw-dir-'+d);
      if (btn && !btn.disabled) btn.onclick = () => api('/api/legion/battle/direction', { direction: d });
    }

    // Атака
    win.querySelectorAll('[id^="bw-attack-"]').forEach(btn => {
      const uid = btn.id.replace('bw-attack-','');
      btn.onclick = () => api('/api/legion/battle/attack', { targetId: uid }, r => {
        UI.toast(`🎯 ${r.dmg} урона${r.crit?' 💥':''}${!r.targetAlive?' 💀':''}`)
      });
    });

    // Лечение
    win.querySelectorAll('[id^="bw-heal-"]').forEach(btn => {
      const uid = btn.id.replace('bw-heal-','');
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

    // Предметы
    win.querySelectorAll('[id^="bw-item-"]').forEach(btn => {
      const itemId = btn.id.replace('bw-item-','');
      btn.onclick = () => {
        if (!App._bwItemTarget) { UI.toast('⛔ Сначала выберите цель — нажмите «Предмет» рядом с врагом'); return; }
        api('/api/legion/battle/item', { itemId, targetId: App._bwItemTarget }, () => {
          App._bwItemTarget = null; App._bwItemTargetName = null;
          UI.toast('🎒 Предмет применён');
        });
      };
    });

    // Покинуть бой
    const leaveBtn = win.querySelector('#bw-leave');
    if (leaveBtn) leaveBtn.onclick = async () => {
      if (!confirm('⚠️ Покинуть бой?\nВаша статистика не сохранится.')) return;
      try {
        await API.post('/api/legion/battle/leave');
        App._closeBattleWindow();
        App.rerender();
      } catch(e) { UI.toast('⛔ ' + e.message); }
    };

    // Свернуть окно (не выходим из боя)
    const hideBtn = win.querySelector('#bw-hide');
    if (hideBtn) hideBtn.onclick = () => App._hideBattleWindow();
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
      if (secs <= 0) clearInterval(t);
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
