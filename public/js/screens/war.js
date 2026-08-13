// ===================================================================
// public/js/screens/war.js — экраны «Война» и «Миссии»
// Война: 10 целей (игроки ±10 уровней + 2–3 бота-террориста 💀),
// панель результата боя и окно фаталити. Миссии: карточки операций
// с этапами по 3 шага и кнопкой «Выполнить шаг».
// ===================================================================

// Предложить купить восстановление ресурса за золото (чёрный рынок).
// kind: 'ammo' | 'energy' | 'health'. Возвращает true, если куплено.
async function _offerRestore(kind) {
  const map = {
    ammo:   { item: 'ammo',   label: 'боеприпасы', icon: '<span class="ic-ammo"></span>' },
    energy: { item: 'energy', label: 'энергия',    icon: '<span class="ic-energy"></span>' },
    health: { item: 'medkit', label: 'здоровье',   icon: '<span class="ic-health"></span>' },
  };
  const cfg = map[kind];
  if (!cfg) return false;
  // Актуальная цена (с учётом скидок) из чёрного рынка
  let price = null;
  try {
    const data = await API.get('/api/market/items');
    const it = (data.buffs || []).find((x) => x.id === cfg.item);
    if (it) price = it.gold;
  } catch (e) {}
  const priceTxt = price != null ? `${price} золота` : 'золото';
  const ok = await UI.confirm(
    `У вас закончились ресурсы: ${cfg.label}!\n\nВосстановить полностью с чёрного рынка за ${priceTxt}?`,
    { title: `Пополнить ресурсы: ${cfg.label}`, icon: cfg.icon, okText: `Купить за ${priceTxt}`, cancelText: 'Отмена' }
  );
  if (!ok) return false;
  try {
    await API.post('/api/market/buy', { itemId: cfg.item });
    await App.refreshMe();
    UI.toast(`Ресурс восстановлен: ${cfg.label}!`);
    return true;
  } catch (e) { UI.toast('⛔ ' + e.message); return false; }
}

// ---------- Шаблон карточки взлома банка (сейф + мини-игра быки/коровы) ----------
function bankHackCardHtml(enc) {
  const historyHtml = (enc.history || []).slice().reverse().map((h) =>
    `<div class="kv"><span class="k">${h.guess.split('').join(' ')}</span><span class="v">🎯 ${h.bulls} · 🔵 ${h.cows}</span></div>`
  ).join('');
  return `
    <div class="card" id="bankhack-card" style="border-color:var(--gold)">
      <img class="safe-banner" src="/img/safe/found.webp" alt="Обнаружено хранилище" loading="eager"
           onerror="this.style.display='none'">
      <div class="result-title" style="color:var(--gold)">🔓 Обнаружен сейф!</div>
      <p class="center">У игрока <b>${UI.esc(enc.targetName)}</b> в банке лежит <b class="gold"><span class="ic-dollar"></span> ${UI.fmtNum(enc.bankAmount)}</b>.
      Взломать сейф можно только <b>1 раз в день</b> — используйте попытку с умом!</p>
      <div class="field-row mt">
        <input type="text" id="bh-code" placeholder="4 разные цифры" maxlength="4" inputmode="numeric" style="flex:1;text-align:center;font-size:20px;letter-spacing:6px">
        <button class="btn btn-orange btn-inline" id="bh-guess">Ввести</button>
      </div>
      <p class="muted small center mt">Осталось попыток разгадать код: <b>${enc.triesLeft}</b> / ${enc.maxTries}. 🎯 — цифра на своём месте, 🔵 — цифра есть, но не там.</p>
      ${historyHtml ? `<div class="mt">${historyHtml}</div>` : ''}
      <button class="btn btn-inline mt" id="bh-cancel" style="width:100%;opacity:.65">✖ Не взламывать (закрыть)</button>
    </div>`;
}

// ---------- Шаблон карточки разминирования (провода) ----------
function mineDefuseCardHtml(enc) {
  const swatch = (w) => `background:${w.hex};border:2px solid rgba(255,255,255,.25)`;
  return `
    <div class="card" id="minedefuse-card" style="border-color:var(--red)">
      <img class="mine-banner" src="/img/mine/field.webp" alt="Минное поле" loading="eager"
           onerror="this.style.display='none'">
      <div class="result-title" style="color:var(--red)">💥 РАСТЯЖКА!</div>
      <p class="center">Вы наступили на мину. Среди проводов только <b>один</b> цвет встречается в одиночку — остальные идут парами/тройками. Перережьте <b>именно его</b>. Ошибётесь — взрыв. Второго шанса не будет.</p>
      ${enc.canSacrifice ? `
        <button class="btn btn-orange mt" id="minedefuse-sacrifice" style="width:100%">💀 Пожертвовать смертником (гарантированное спасение)</button>
        <p class="center small muted mt">— или рискните и обезвредьте провода сами —</p>
      ` : ''}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px">
        ${enc.wires.map((w, i) => `
          <button class="btn" data-wire="${i}" style="height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
            <span style="display:inline-block;width:22px;height:22px;border-radius:5px;${swatch(w)}"></span>
            <span class="small">${UI.esc(w.name)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

// ---------- ВОЙНА ----------
App.screens.war = async (c) => {
  await App.refreshMe();
  const m = App.me;

  // Восстановление окна сейфа: если сервер помнит незавершённый взлом, а
  // клиент потерял карточку (обновление страницы, возврат на экран) —
  // пересоздаём её из состояния игрока, чтобы окно всегда можно было открыть.
  if (!App._warEncounter && m.pendingBankHack) {
    App._warEncounter = { type: 'bank_hack', encounter: 'bank_hack', ...m.pendingBankHack };
  }

  // Восстановление окна РАСТЯЖКИ: если игрок нарвался на мину и случайно вышел
  // в главное (или из окна боя/мины), сервер помнит незавершённое
  // разминирование (pendingMineDefuse блокирует атаки). Пересоздаём карточку,
  // чтобы игрок обязательно разобрался с миной, прежде чем атаковать других.
  if (!App._warEncounter && m.pendingMineDefuse) {
    App._warEncounter = {
      type: 'mine_defuse', encounter: 'mine_defuse',
      wires: m.pendingMineDefuse.wires,
      canSacrifice: m.pendingMineDefuse.canSacrifice,
    };
  }
  // Если сервер уже снял мину (разминирована/взорвалась), а локально осталась
  // карточка — убираем её, чтобы не «залипала».
  if (App._warEncounter && App._warEncounter.type === 'mine_defuse' && !m.pendingMineDefuse) {
    App._warEncounter = null;
  }

  // Уход с экрана войны с открытым сейфом = отказ от сейфа. Молча снимаем
  // блокировку атаки на сервере, иначе игрок «застрянет»: атаковать нельзя,
  // а вернуться в окно неоткуда. _tear вызывается роутером при следующей
  // навигации; для смены под-вкладок войны (rerender) хэш остаётся #war —
  // тогда сейф НЕ отменяем.
  App._tear = () => {
    const next = ((location.hash || '').slice(1).split('/')[0]) || 'home';
    if (next !== 'war' && App._warEncounter && App._warEncounter.type === 'bank_hack') {
      App._warEncounter = null;
      if (App.me) App.me.pendingBankHack = null;
      API.post('/api/war/bank-hack/cancel').catch(() => {});
    }
  };

  // Баннер мирового события (активного или запланированного с таймером)
  let eventBanner = '';
  try {
    const ev = await API.get('/api/event');
    if (ev.scheduled) {
      eventBanner = `
        <div class="card" style="border-color:var(--orange);cursor:pointer" onclick="App.go('event')">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:28px">⏳</span>
            <div>
              <div style="font-weight:bold;color:var(--orange)">Скоро: ${UI.esc(ev.name)}</div>
              <div class="small muted">До начала: <span id="war-event-timer" style="color:var(--orange);font-weight:bold">${UI.fmtTimer(ev.startsInSec)}</span></div>
            </div>
          </div>
        </div>`;
    } else if (ev.active) {
      eventBanner = `
        <div class="card" style="border-color:var(--red);cursor:pointer" onclick="App.go('event')">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:28px">🐉</span>
            <div>
              <div style="font-weight:bold;color:var(--red)">Идёт событие: ${UI.esc(ev.name)}</div>
              <div class="small muted">HP босса: ${ev.hpPct}% · нажмите, чтобы атаковать</div>
            </div>
          </div>
        </div>`;
    }
  } catch (e) {}

  // Панель результата последнего боя (если только что дрались)
  let resultHtml = '';
  const b = App._lastBattle;
  if (b) {
    const marks = [
      b.crit ? '💥 Критический удар!' : '',
      b.dodge ? '🌀 Враг увернулся (урон 0)' : '',
      b.attackerDodge ? '🌀 Вы увернулись от ответного урона' : '',
    ].filter(Boolean).join(' · ');
    resultHtml = `
      <div class="card" id="battle-result">
        <img class="result-banner" src="/img/battle/${b.win ? 'win' : 'lose'}.webp"
             alt="${b.win ? 'Победа' : 'Поражение'}" loading="eager"
             onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'result-title ${b.win ? 'win' : 'lose'}',textContent:'${b.win ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}'}))">
        <p class="center muted small">${UI.esc(b.targetName)} (ур. ${b.targetLevel})${b.isBot ? ' 💀' : ''}</p>
        <div style="margin:8px 0">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span class="muted"><span class="ic-health"></span> Здоровье врага</span><span style="font-weight:bold;color:var(--${b.targetHpPct>50?'green':b.targetHpPct>20?'orange':'red'})">${b.targetHpPct}%</span>
          </div>
          <div style="height:10px;background:rgba(255,255,255,.08);border-radius:5px;overflow:hidden">
            <div style="height:100%;width:${b.targetHpPct}%;background:linear-gradient(90deg, var(--${b.targetHpPct>50?'green':b.targetHpPct>20?'orange':'red'}), var(--${b.targetHpPct>20?'orange':'red'}));transition:width .4s ease"></div>
          </div>
        </div>
        ${marks ? `<p class="center small mt">${marks}</p>` : ''}
        ${!m.pendingFatality ? `<button class="btn btn-orange mt" id="atk-again" style="width:100%">⚔️ Атаковать снова</button>` : ''}
        <hr class="hr">
        <div class="kv"><span class="k">Нанесено</span><span class="v dmg-deal">${b.dealt} урона</span></div>
        <div class="kv"><span class="k">Получено</span><span class="v dmg-take">${b.received} урона</span></div>
        <div class="kv"><span class="k">Награблено</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtNum(b.loot)}</span></div>
        <div class="kv"><span class="k">Заработано</span><span class="v">${b.xp} опыта</span></div>
        ${(b.myArmy && b.myArmy.length) ? `
          <hr class="hr">
          <p class="small mt"><b>Ваша техника в бою:</b></p>
          ${UI.battleImgRow(b.myArmy, 'units')}` : ''}
        ${(b.mySaboteurs && b.mySaboteurs.length) ? `
          <p class="small mt"><b>Ваши диверсанты:</b></p>
          ${UI.sabRow(b.mySaboteurs)}` : ''}
        ${(b.enemyArmy && b.enemyArmy.length) ? `
          <p class="small mt"><b>Техника врага:</b></p>
          ${UI.battleImgRow(b.enemyArmy, 'units')}` : ''}
        ${(b.enemySaboteurs && b.enemySaboteurs.length) ? `
          <p class="small mt"><b>Диверсанты врага:</b></p>
          ${UI.sabRow(b.enemySaboteurs)}` : ''}
        ${(b.enemyDefenseBuildings && b.enemyDefenseBuildings.length) ? `
          <details class="def-buildings" style="margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:8px">
            <summary style="cursor:pointer;font-weight:bold;list-style:none;display:flex;align-items:center;justify-content:space-between">
              <span>🛡 Постройки врага в защите (${b.enemyDefenseBuildings.length})</span>
              <span class="def-toggle" style="color:var(--orange)"></span>
            </summary>
            <div style="margin-top:8px">
              ${UI.battleImgRow(b.enemyDefenseBuildings, 'buildings')}
            </div>
          </details>` : ''}
        ${(b.myLosses && b.myLosses.length) ? `
          <p class="small mt">⚠️ <span class="dmg-take">Ваши потери:</span></p>
          ${UI.battleImgRow(b.myLosses, 'units')}` : '<p class="small mt muted">Без потерь техники с вашей стороны</p>'}
        ${(b.enemyLosses && b.enemyLosses.length) ? `
          <p class="small mt">💥 <span class="dmg-deal">Потери врага:</span></p>
          ${UI.battleImgRow(b.enemyLosses, 'units')}` : ''}
      </div>`;
  }

  // Окно фаталити: враг повержен, решаем его судьбу
  const fatalityHtml = m.pendingFatality ? `
    <div class="card fatality-card">
      <div class="result-title" style="color:var(--red)">💀 КОМАНДИР ВРАГА ПОВЕРЖЕН</div>
      <p class="center">Ваш отряд наткнулся на командира врага <b>${UI.esc(m.pendingFatality.name)}</b>. Вы можете взять его в плен и решить его судьбу. Решайте быстро — окно закроется через 3 минуты!</p>
      <button class="btn btn-red mt" id="fat-capture" style="width:100%;padding:12px">🪖 Взять в плен</button>
    </div>` : '';

  // Вкладку держим в адресе (#war/arena): при обновлении страницы игрок
  // остаётся там же, где был, а не улетает на «Вторжение».
  if (!App._warTab) {
    const fromHash = (location.hash || '').split('/')[1] || '';
    const known = ['targets', 'group', 'arena', 'sanctions', 'event'];
    if (known.includes(fromHash)) App._warTab = fromHash;
  }
  const warTab = App._warTab || 'targets';

  // Окно «встречи». Мина срабатывает ДО боя — прячет результат, пока игрок
  // не разберётся с проводом. Сейф выпадает ПОСЛЕ боя — показываем его ВМЕСТЕ
  // с результатом боя и окном фаталити (бой уже прошёл).
  const enc = App._warEncounter;
  const preCombat = enc && enc.type === 'mine_defuse'; // только мина прячет итог боя
  const encounterHtml = enc
    ? `<div id="war-encounter">${enc.type === 'bank_hack' ? bankHackCardHtml(enc) : mineDefuseCardHtml(enc)}</div>`
    : '';

  c.innerHTML = `
    <div class="title">Война</div>
    ${eventBanner}
    ${encounterHtml}
    ${!preCombat ? fatalityHtml : ''}
    ${!preCombat ? resultHtml : ''}
    <div class="tabs">
      <div class="tab ${warTab === 'targets' ? 'active' : ''}" data-wartab="targets">${App.tabImg('war_targets', 20)}Вторжение</div>
      <div class="tab ${warTab === 'group' ? 'active' : ''}" data-wartab="group">🤝 Групповые бои</div>
      <div class="tab ${warTab === 'arena' ? 'active' : ''}" data-wartab="arena">🏟 Арена</div>
      <div class="tab ${warTab === 'sanctions' ? 'active' : ''}" data-wartab="sanctions">💰 Санкции</div>
      <div class="tab ${warTab === 'event' ? 'active' : ''}" data-wartab="event">🐉 Событие</div>
    </div>
    ${warTab === 'arena' ? '<div id="arena-box"><div class="loading">Загружаю арену…</div></div>'
      : warTab === 'group' ? '<div id="gb-box"><div class="loading">Загружаю групповые бои…</div></div>'
      : warTab === 'event' ? `
      <div class="card center">
        <p class="muted small">Мировое PvE-событие: командиры вместе бьют общего босса. Открыть полный экран события:</p>
        <button class="btn btn-orange mt" onclick="App.go('event')" style="width:100%">🐉 Перейти к событию</button>
      </div>
    ` : warTab === 'targets' ? `
      <div class="card">
        <p class="muted small">Цели подобраны в диапазоне ±10 уровней. 💀 — боты-террористы. Каждая атака тратит 1 боеприпас 🎯.</p>
        <button class="btn mt" id="war-refresh">🔄 Обновить список целей</button>
      </div>
      <div class="card" id="war-list"><div class="loading">Разведка ищет цели…</div></div>
    ` : `
      <div class="card">
        <p class="muted small">🎯 <b>Санкции</b> — заказы на игроков. Любой может объявить санкцию на любого через его профиль, заморозив награду. Кто снизит HP цели до ≤5% в бою — забирает всю награду. Несколько заказов на одну цель суммируются. По цели под санкцией <b>фаталити не срабатывает</b> — уши в санкциях не режут, награда и есть трофей.</p>
      </div>
      <div class="card" id="sanctions-list"><div class="loading">Загрузка списка санкций…</div></div>
    `}`;

  // Переключение вкладок войны
  c.querySelectorAll('[data-wartab]').forEach((t) => {
    t.onclick = () => { App._setWarTab(t.dataset.wartab); };
  });
  c.querySelectorAll('[data-wartab-go]').forEach((t) => {
    t.onclick = () => { App._setWarTab(t.dataset.wartabGo); };
  });

  // Арена рисуется отдельно: у неё своё обновление и боевое окно
  if (warTab === 'arena') App.renderArena();
  if (warTab === 'group') App.renderGroup();

  // Тикающий таймер баннера события (если запланировано)
  const evTimer = document.getElementById('war-event-timer');
  if (evTimer) {
    let secs = parseInt(evTimer.dataset.left || '0', 10);
    // считываем стартовое значение из текста (мм:сс)
    const startTxt = evTimer.textContent.trim();
    const parts = startTxt.split(':').map((x) => parseInt(x, 10));
    secs = parts.length === 3 ? parts[0]*3600+parts[1]*60+parts[2] : parts[0]*60+(parts[1]||0);
    const iv = setInterval(() => {
      secs--;
      if (secs <= 0) { clearInterval(iv); if (App._screen === 'war') App.rerender(); return; }
      const t = document.getElementById('war-event-timer');
      if (!t) { clearInterval(iv); return; }
      t.textContent = UI.fmtTimer(secs);
    }, 1000);
  }

  // Кнопки результата и фаталити
  if (b && !m.pendingFatality) {
    const again = document.getElementById('atk-again');
    if (again) again.onclick = () => attackTarget(b.targetId);
  }
  if (m.pendingFatality) {
    const cap = document.getElementById('fat-capture');
    if (cap) cap.onclick = () => App._showFatalityFlow(m.pendingFatality);
  }
  if (enc && enc.type === 'bank_hack') wireBankHackHandlers();
  if (enc && enc.type === 'mine_defuse') {
    c.querySelectorAll('[data-wire]').forEach((btn) => {
      btn.onclick = () => {
        if (!confirm('Перерезать этот провод? Отменить будет нельзя.')) return;
        mineDefuseWire(Number(btn.dataset.wire));
      };
    });
    const sacrificeBtn = document.getElementById('minedefuse-sacrifice');
    if (sacrificeBtn) sacrificeBtn.onclick = () => {
      if (!confirm('Пожертвовать смертником? Он погибнет, но вы гарантированно избежите взрыва.')) return;
      mineSacrifice();
    };
  }
  function wireBankHackHandlers() {
    const guessBtn = document.getElementById('bh-guess');
    const input = document.getElementById('bh-code');
    if (guessBtn && input) {
      const submit = () => {
        const code = input.value.trim();
        if (!/^\d{4}$/.test(code)) { UI.toast('⛔ Введите 4 цифры'); return; }
        if (new Set(code.split('')).size !== 4) { UI.toast('⛔ Цифры не должны повторяться'); return; }
        bankHackGuess(code);
      };
      guessBtn.onclick = submit;
      input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
      input.focus();
    }
    const cancelBtn = document.getElementById('bh-cancel');
    if (cancelBtn) cancelBtn.onclick = () => bankHackCancel();
  }
  const refreshBtn = document.getElementById('war-refresh');
  if (refreshBtn) refreshBtn.onclick = () => { App._lastBattle = null; App.rerender(); };

  // Выполнить атаку и перерисовать экран с результатом (либо результат
  // боя, либо «встреча» — окно сейфа или мины, которое перекрывает
  // обычную панель результата, пока игрок не примет решение)
  async function attackTarget(targetId) {
    try {
      const r = await API.post('/api/war/attack', { targetId });
      handleAttackOutcome(r);
      await App.refreshMe();
      // Прокручиваем к нужному блоку: к панели результата боя, а если после
      // атаки выпал сейф или мина — к окну встречи. Раньше страница уезжала
      // в самый верх, и игрок, пролиставший список противников, терял итог.
      // Уводим страницу к самому началу карточки боя: результат — первый
      // блок экрана, поэтому сначала поднимаемся наверх, а затем точно
      // наводимся на карточку (на случай, если сверху что-то добавится)
      window.scrollTo({ top: 0, behavior: 'auto' });
      App.rerenderTo(r.encounter ? 'war-encounter' : 'battle-result');
    } catch (e) {
      // Нет боеприпасов — предложить восстановление за золото и повторить атаку
      if (/боеприпас/i.test(e.message)) {
        if (await _offerRestore('ammo')) return attackTarget(targetId);
        return;
      }
      // Здоровье слишком низкое для атаки — предложить аптечку с рынка
      if (/подлечитесь/i.test(e.message)) {
        if (await _offerRestore('health')) return attackTarget(targetId);
        return;
      }
      UI.toast('⛔ ' + e.message);
    }
  }

  // Разбираем ответ атаки. Мина — окно ДО боя (результата ещё нет). Иначе бой
  // прошёл: сохраняем результат и, если ПОСЛЕ боя выпал сейф, показываем его
  // поверх итога боя.
  function handleAttackOutcome(r) {
    if (r.encounter === 'mine_defuse') {
      App._warEncounter = { type: 'mine_defuse', wires: r.wires, canSacrifice: r.canSacrifice };
      App._lastBattle = null;
      return;
    }
    App._lastBattle = r;
    App._warEncounter = (r.encounter === 'bank_hack') ? { type: 'bank_hack', ...r } : null;
  }

  // ---------- Взлом банка: ввод кода ----------
  async function bankHackGuess(code) {
    try {
      const r = await API.post('/api/war/bank-hack/guess', { code });
      if (r.encounter === 'bank_hack') {
        // Мини-игра продолжается — обновляем окно (не полный rerender,
        // чтобы не сбросить фокус на поле ввода)
        App._warEncounter = { type: 'bank_hack', ...App._warEncounter, ...r };
        renderBankHackCard();
        return;
      }
      // Взлом завершён. Бой уже прошёл при атаке — результат боя (_lastBattle)
      // сохраняем, просто закрываем окно сейфа и уведомляем об итоге.
      if (r.bankHack) await showSafeResult(r.bankHack);
      App._warEncounter = null;
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  // Окно результата взлома сейфа — раньше итог показывался коротким тостом,
  // и игрок не успевал понять, сколько унёс и почему сорвалось.
  function showSafeResult(bh) {
    const win = bh.stolen > 0 && !bh.alarmed;
    const title = bh.alarmed ? '🚨 Сигнализация!' : (win ? '🔓 Сейф взломан' : '⛔ Взлом сорван');
    const text = bh.alarmed
      ? `Код <b>${UI.esc(String(bh.code))}</b> был верным, но охрана успела поднять тревогу — пришлось уходить пустым.`
      : win
        ? 'Замок поддался. Содержимое сейфа перекочевало в ваши карманы.'
        : `Попытки закончились, сейф остался закрыт. Код был: <b>${UI.esc(String(bh.code))}</b>.`;
    const sum = win
      ? `<div class="safe-sum"><span class="ic-dollar"></span> <b class="money">${UI.fmtNum(bh.stolen)}</b></div>`
      : '';
    // Картинка исхода: вскрытое хранилище при удаче, закрытое с тревогой —
    // при провале. Не загрузилась — окно просто останется текстовым.
    const img = `<img class="safe-banner safe-banner-dialog" src="/img/safe/${win ? 'success' : 'fail'}.webp"
         alt="${win ? 'Хранилище взломано' : 'Хранилище не взломано'}" loading="eager"
         onerror="this.style.display='none'">`;
    return UI.confirm(
      `${img}<div class="safe-result">${text}${sum}</div>`,
      { title, icon: bh.alarmed ? '🚨' : (win ? '🔓' : '🔒'), html: true, okText: 'Понятно', cancelText: '' }
    );
  }

  async function bankHackSkip() {
    App._warEncounter = null;
    if (App.me) App.me.pendingBankHack = null;
    try { await API.post('/api/war/bank-hack/skip'); } catch (e) {}
    await App.refreshMe();
    App.rerender();
  }

  // Отмена сейфа без боя — просто закрываем окно и снимаем блокировку атаки.
  async function bankHackCancel() {
    App._warEncounter = null;
    if (App.me) App.me.pendingBankHack = null;
    try { await API.post('/api/war/bank-hack/cancel'); } catch (e) {}
    await App.refreshMe();
    App.rerender();
  }

  // ---------- Разминирование: выбор провода ----------
  async function mineDefuseWire(idx) {
    try {
      const r = await API.post('/api/war/mine-defuse', { wireIndex: idx });
      App._warEncounter = null;
      if (r.exploded) {
        const lostTechText = (r.lostTech || []).map((x) => `${UI.esc(x.name)} ×${x.count}`).join(', ') || 'без потерь техники';
        const SAB_RU = { ground: 'наземные', sea: 'морские', air: 'воздушные', secret: 'секретные', building: 'построечные', suicide: 'смертники' };
        const lostSabText = Object.entries(r.lostSaboteurs || {}).map(([k, v]) => `${SAB_RU[k] || k} ×${v}`).join(', ');
        await UI.confirm(
          `<img class="mine-banner mine-banner-dialog" src="/img/mine/boom.webp" alt="Подрыв"
                loading="eager" onerror="this.style.display='none'">
           <div class="mine-result">
             <p>Провод оказался с сюрпризом — взрыв!</p>
             <p>Здоровье снесено полностью. Уничтожено <b>${r.techLossPct}%</b> техники,
                участвовавшей в бою: ${lostTechText}.</p>
             ${lostSabText ? `<p>Погибло диверсантов: ${lostSabText}.</p>` : ''}
           </div>`,
          { title: '💥 ВЗРЫВ', icon: '💥', html: true, okText: 'Понятно', cancelText: '' }
        );
        App._lastBattle = null;
      } else {
        App._lastBattle = r;
      }
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  // ---------- Разминирование: пожертвовать смертником ----------
  async function mineSacrifice() {
    try {
      const r = await API.post('/api/war/mine-sacrifice');
      App._warEncounter = null;
      App._lastBattle = r;
      UI.toast('💀 Смертник пожертвовал собой — вы избежали взрыва!');
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  // Точечное обновление карточки взлома банка без полного rerender
  // (иначе при вводе кода сбрасывался бы фокус/значение поля)
  function renderBankHackCard() {
    const card = document.getElementById('bankhack-card');
    if (card) card.outerHTML = bankHackCardHtml(App._warEncounter);
    wireBankHackHandlers();
  }

  async function doFatality(choice) {
    try {
      const res = await API.post('/api/war/fatality', { choice });
      App._lastBattle = null;
      // Жертва ускользнула благодаря ловкости
      if (res && res.escaped) {
        UI.toast('💨 Жертва ускользнула — фаталити сорвалось!');
      }
      // Если игрок отрезал ОБА уха одной жертве — предлагаем оставить послание
      if (res && res.canLeaveMessage && res.victimId) {
        App._showEarMessagePrompt(res.victimId);
      }
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  // Загружаем список целей (только на вкладке «Цели»)
  if (warTab === 'targets') {
    const { opponents } = await API.get('/api/war/opponents');
    const list = document.getElementById('war-list');
    list.innerHTML = opponents.map((o) => `
      <div class="list-row">
        <div class="grow">
          <span class="name" style="cursor:pointer" onclick="App.go('profile/${o.id}')">${App._flagImg(o.flag)} ${UI.esc(o.name)}${App.vipMark(o.vip)}${App.staffMark(o.staffRole)}${o.inMyAlliance ? ' <span class="ally-star" title="Состоит в вашем альянсе">⭐</span>' : ''}</span>
          <span class="muted small"> Ур. ${o.level}</span>
          ${o.allianceMembers > 0 ? `<span class="muted small"> · 🤝 ${o.allianceMembers}</span>` : ''}
          ${o.isBot
            ? '<span class="online-dot off" title="Бот / террорист"></span>'
            : `<span class="online-dot ${o.online ? 'on' : 'off'}" title="${o.online ? 'В сети' : 'Не в сети'}"></span>`}
        </div>
        <button class="btn btn-orange btn-inline" data-target="${o.id}">Атака</button>
      </div>`).join('');

    list.querySelectorAll('[data-target]').forEach((btn) => {
      btn.onclick = () => attackTarget(btn.dataset.target);
    });
  }

  // Загружаем список санкций (только на вкладке «Санкции»)
  if (warTab === 'sanctions') {
    const { sanctions, threshold } = await API.get('/api/sanctions');
    const list = document.getElementById('sanctions-list');
    if (!sanctions.length) {
      list.innerHTML = '<p class="muted center" style="padding:20px">Активных санкций нет. Объявите санкцию через профиль любого игрока.</p>';
    } else {
      list.innerHTML = sanctions.map((s, i) => `
        <div class="list-row">
          <div class="grow">
            <span class="name" style="cursor:pointer" onclick="App.go('profile/${s.targetId}')">${App._flagImg(s.flag)} ${UI.esc(s.targetName)}</span>
            <span class="muted small"> Ур. ${s.level} · HP ${s.hpPct}%</span>
            <div class="small" style="color:var(--money)">💰 Награда: <span class="ic-dollar"></span>${UI.fmtNum(s.bounty)}</div>
            <div class="small">🎯 Охоту объявил${(s.ordererCount || 1) > 1
              ? `и: <span class="sanc-toggle" data-sanc-orders="${s.targetId}" data-idx="${i}" style="cursor:pointer;text-decoration:underline;color:var(--orange-1)">${s.ordererCount} заказчика ▾</span>`
              : `: <b>${UI.esc((s.ordererNames && s.ordererNames[0]) || '—')}</b>`}</div>
            ${s.myOrder > 0 ? `<div class="muted small">ваш вклад: <span class="ic-dollar"></span>${UI.fmtNum(s.myOrder)}</div>` : ''}
            <div class="sanc-orders" id="sanc-orders-${i}" hidden></div>
          </div>
          <button class="btn btn-red btn-inline" data-sanction-target="${s.targetId}">⚔ Охота</button>
        </div>`).join('');

      list.querySelectorAll('[data-sanction-target]').forEach((btn) => {
        btn.onclick = () => attackTarget(btn.dataset.sanctionTarget);
      });

      // Раскрытие разбивки: кто сколько заплатил в общий банк
      list.querySelectorAll('[data-sanc-orders]').forEach((el) => {
        el.onclick = async () => {
          const box = document.getElementById('sanc-orders-' + el.dataset.idx);
          if (!box) return;
          if (!box.hidden) { box.hidden = true; el.innerHTML = el.innerHTML.replace('▴', '▾'); return; }
          box.innerHTML = '<div class="muted small">Загрузка…</div>';
          box.hidden = false;
          el.innerHTML = el.innerHTML.replace('▾', '▴');
          try {
            const d = await API.get('/api/sanctions/' + encodeURIComponent(el.dataset.sancOrders) + '/orders');
            box.innerHTML = `
              <div class="sanc-breakdown">
                <div class="sanc-b-head">Из чего складывается награда <span class="ic-dollar"></span>${UI.fmtNum(d.bounty)}:</div>
                ${d.orders.map((o) => `
                  <div class="sanc-b-row${o.isMe ? ' me' : ''}">
                    <span class="grow">${UI.esc(o.byName)}${o.isMe ? ' <span class="muted">(вы)</span>' : ''}${o.count > 1 ? ` <span class="muted small">×${o.count}</span>` : ''}</span>
                    <span class="sanc-b-amt"><span class="ic-dollar"></span>${UI.fmtNum(o.amount)} <span class="muted small">${o.pct}%</span></span>
                  </div>`).join('')}
              </div>`;
          } catch (e) {
            box.innerHTML = '<div class="muted small">Не удалось загрузить разбивку.</div>';
          }
        };
      });
    }
  }
};

// ---------- МИССИИ (конфликты) ----------
App.screens.missions = async (c, param) => {
  await App.refreshMe();
  // Подробный вид конкретного конфликта: #missions/border
  if (param) return renderConflictDetail(c, param);

  const data = await API.get('/api/missions');

  // Активный шаг — карточка наверху с обратным отсчётом и кнопкой ускорения
  let activeBlock = '';
  if (data.active) {
    const a = data.active;
    activeBlock = `
      <div class="card fatality-card" id="mission-active">
        <div class="name">⏳ Идёт шаг: ${UI.esc(a.confName)}</div>
        <div class="muted small mt">${UI.esc(a.opName)} · ${UI.esc(a.stepName)}</div>
        <div class="mt">${UI.bar(a.totalSec - a.secondsLeft, a.totalSec, 'xp',
          a.secondsLeft > 0 ? 'Осталось: ' + UI.fmtTimer(a.secondsLeft) : 'Готово'
        )}</div>
        ${a.canBoost ? `<button class="btn mt" id="m-boost" data-pid="${a.id}">⚡ Ускорить за <span class="ic-gold"></span> ${UI.fmtNum(a.boostGold || data.boostGoldCost)}</button>` : ''}
      </div>`;
  }

  c.innerHTML = `
    <div class="title">Военные конфликты</div>
    ${activeBlock}
    <div class="card"><p class="muted small">10 конфликтов в мире. У каждого 7-10 спецопераций по 3 шага. Шаги требуют времени и условий. Награда: 7-10 очков навыков и 30-500 золота за первое полное прохождение конфликта.</p></div>
    ${data.conflicts.map((cf) => `
      <div class="card conf-card" ${cf.locked ? 'style="opacity:.6"' : 'style="cursor:pointer"'} ${!cf.locked ? `onclick="App.go('missions/${cf.id}')"` : ''}>
        <img class="conf-banner${cf.locked ? ' conf-locked' : ''}" src="/img/conflicts/${cf.id}.webp" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="name">${UI.esc(cf.name)}${cf.completed > 0 ? ` <span class="badge green">пройден ×${cf.completed}</span>` : ''}${cf.rewardAvailable && !cf.locked ? ' <span class="badge">⭐ ' + cf.spReward + ' + <span class="ic-gold"></span> ' + cf.goldReward + '</span>' : ''}</div>
        ${cf.locked
          ? `<p class="muted small mt">🔒 Откроется на ${cf.minLevel} уровне</p>`
          : `<div class="mt">${UI.bar(cf.opsDone, cf.opsTotal, 'gold', `Спецопераций: ${cf.opsDone} / ${cf.opsTotal}`)}</div>
             <p class="muted small mt">${cf.rewardAvailable ? 'Награда за первое прохождение ещё не получена.' : 'Награда уже получена. Можно проходить повторно для опыта.'}</p>`}
      </div>`).join('')}`;

  const boostBtn = document.getElementById('m-boost');
  if (boostBtn) {
    boostBtn.onclick = async () => {
      try { await API.post('/api/missions/boost', { processId: boostBtn.dataset.pid }); await App.refreshMe(); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  // Живой таймер активного шага в списке конфликтов (аналогично detail-виду)
  if (App._missionTimer) { clearInterval(App._missionTimer); App._missionTimer = null; }
  if (data.active) {
    let secs = data.active.secondsLeft;
    const total = data.active.totalSec || 1;
    App._missionTimer = setInterval(async () => {
      if ((location.hash || '').indexOf('missions') < 0) { clearInterval(App._missionTimer); App._missionTimer = null; return; }
      secs--;
      const barLabel = document.querySelector('#mission-active .txt');
      const barFill = document.querySelector('#mission-active .fill');
      if (secs > 0) {
        if (barLabel) barLabel.textContent = 'Осталось: ' + UI.fmtTimer(secs);
        if (barFill) barFill.style.width = Math.min(100, Math.round((total - secs) / total * 100)) + '%';
      } else {
        clearInterval(App._missionTimer); App._missionTimer = null;
        if (barLabel) barLabel.textContent = 'Готово!';
        await App.refreshMe();
        App.rerender();
      }
    }, 1000);
  }

  // Авто-обновление пока идёт активный шаг
  if (data.active) {
}
};

// Подробный экран одного конфликта
async function renderConflictDetail(c, confId) {
  await App.refreshMe();
  const conf = await API.get('/api/missions/' + encodeURIComponent(confId));

  // Точки прогресса в спецоперации: ●●○
  const stepDots = (done) => [0, 1, 2].map((i) => i < done ? '●' : '○').join(' ');

  // Активный шаг — баннер
  let activeBlock = '';
  if (conf.activeStep) {
    const a = conf.activeStep;
    activeBlock = `
      <div class="card fatality-card" id="mission-active">
        <div class="name">⏳ ${UI.esc(a.opName)} · ${UI.esc(a.stepName)}</div>
        <div class="mt">${UI.bar(a.totalSec - a.secondsLeft, a.totalSec, 'xp',
          a.secondsLeft > 0 ? 'Осталось: ' + UI.fmtTimer(a.secondsLeft) : 'Готово'
        )}</div>
        ${a.canBoost ? `<button class="btn mt" id="m-boost" data-pid="${a.id}">⚡ Ускорить за <span class="ic-gold"></span> ${conf.boostGoldCost}</button>` : ''}
      </div>`;
  }

  c.innerHTML = `
    <div class="title">${UI.esc(conf.name)}</div>
    <button class="btn" onclick="App.go('missions')" style="margin-bottom:10px">← К списку конфликтов</button>
    ${activeBlock}
    ${conf.locked ? `<div class="card center muted">🔒 Конфликт закрыт. Откроется на ${conf.minLevel} уровне.</div>` : ''}
    <div class="card">
      <p>Награда за первое полное прохождение: <b class="gold">⭐ ${conf.spReward}</b> + <b class="gold"><span class="ic-gold"></span> ${conf.goldReward}</b></p>
      <p class="muted small mt">${conf.rewardAvailable ? 'Награда ещё не получена.' : 'Награда уже получена ранее. Дальнейшие прохождения — только за опыт.'}</p>
    </div>
    ${conf.operations.map((op) => {
      const doneSteps = op.stepsDone;
      const nextStep = doneSteps < 3 ? op.steps[doneSteps] : null;
      const fullyDone = doneSteps >= 3;
      return `
      <div class="card conf-card" ${fullyDone ? 'style="opacity:.7"' : ''}>
        ${op.img ? `<img class="conf-banner op-banner${fullyDone ? ' conf-locked' : ''}" src="/img/conflicts/${conf.id}/${op.img}.webp" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="name">${fullyDone ? '✅ ' : ''}${UI.esc(op.name)} <span class="muted">${stepDots(doneSteps)}</span></div>
        ${fullyDone
          ? '<p class="muted small mt">Спецоперация завершена</p>'
          : `<div class="muted small mt">Следующий шаг: <b>${UI.esc(nextStep.name)}</b></div>
             <div class="kv mt"><span class="k"><span class="ic-energy"></span> Энергия</span><span class="v">${nextStep.energy}</span></div>
             <div class="kv"><span class="k">⏱ Время</span><span class="v">${nextStep.timeMin} мин</span></div>
             <div class="kv"><span class="k">Награда</span><span class="v">${nextStep.xp} опыта, <span class="ic-dollar"></span>${UI.fmtMoney(nextStep.money)}</span></div>
             <div class="kv"><span class="k">Требования</span><span class="v small">мощь ${UI.fmtNum(nextStep.require.power)}, ур. ${nextStep.require.level}</span></div>
             ${nextStep.require.units && nextStep.require.units.byType ? `
               <div class="kv"><span class="k">Техника${nextStep.require.units.profile ? ` <span class="muted">(${UI.esc(nextStep.require.units.profile)})</span>` : ''}</span>
                 <span class="v small req-units">${Object.entries(nextStep.require.units.byType).map(([t, n]) =>
                   `<span class="req-unit" title="${UI.esc(App._typeRu(t))}">${App.tabImg('tech_' + t, 20)}${n}</span>`).join('')}
                 <span class="muted"> ур. ${nextStep.require.units.minLevel}+</span></span></div>` : ''}
             <button class="btn btn-orange mt" data-start="${op.idx}-${nextStep.idx}" ${conf.activeStep || conf.locked ? 'disabled' : ''}>Начать шаг</button>
             ${conf.activeStep ? '<p class="muted small center mt">Сначала завершите текущий активный шаг</p>' : ''}`}
      </div>`;
    }).join('')}`;

  // Кнопки запуска шагов
  c.querySelectorAll('[data-start]').forEach((btn) => {
    btn.onclick = async () => {
      const [opIdx, stepIdx] = btn.dataset.start.split('-').map(Number);
      const runStep = async () => {
        const r = await API.post('/api/missions/start', { confId, opIdx, stepIdx });
        // Не хватает техники — предлагаем докупить всё разом по цене магазина
        if (r && r.needUnits) { await _offerBuyUnits(r.needUnits); return; }
        await App.refreshMe();
        App.rerender();
      };
      // Окно покупки недостающей техники (цена магазина с учётом акции).
      // Показываем картинку каждой единицы, сколько нужно/есть/докупить,
      // цену за штуку, а внизу — итоговую сумму и кнопку покупки.
      // Раньше эта разметка уходила в UI.confirm без опции html и игрок
      // видел сырые HTML-теги вместо таблицы.
      const _offerBuyUnits = async (s) => {
        const disc = s.discount && s.discount.pct
          ? `<span class="gold small">акция −${s.discount.pct}%</span>` : '';
        const rows = (s.items || []).map((it) => `
          <div class="buy-units-row">
            <img class="buy-units-img" src="/img/units/${String(it.unitId).replace(/[^a-z0-9_]/gi, '')}.webp"
                 alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'buy-units-stub',textContent:'🚜'}))">
            <div class="buy-units-info">
              <div class="buy-units-name">${UI.esc(it.unitName)}</div>
              <div class="muted small">${App.tabImg('tech_' + it.type, 14)} ${UI.esc(it.typeRu)} · есть ${UI.fmtNum(it.have)} из ${UI.fmtNum(it.need)}</div>
            </div>
            <div class="buy-units-num">
              <div class="buy-units-count">×${UI.fmtNum(it.deficit)}</div>
              <div class="muted small"><span class="ic-dollar"></span>${UI.fmtNum(it.unitPrice)} за ед.</div>
              <div class="money small"><span class="ic-dollar"></span>${UI.fmtNum(it.cost)}</div>
            </div>
          </div>`).join('');
        const body = `
          <div class="buy-units-head">Для шага нужна техника уровня ${s.minLevel}+${s.profile ? ` <span class="muted">(${UI.esc(s.profile)})</span>` : ''}</div>
          <div class="buy-units-list">${rows}</div>
          <div class="buy-units-total">
            <span>Итого за ${UI.fmtNum(s.deficit)} ед.:</span>
            <b class="money"><span class="ic-dollar"></span>${UI.fmtNum(s.totalCost)}</b> ${disc}
          </div>
          ${s.canAfford
            ? `<div class="muted small center">Покупка по цене магазина</div>`
            : `<div class="small center" style="color:var(--red)">Не хватает денег: на счету <span class="ic-dollar"></span>${UI.fmtNum((App.me && App.me.dollars) || 0)}</div>`}`;
        const ok = await UI.confirm(body, {
          title: 'Не хватает техники', icon: '🚜', html: true,
          okText: s.canAfford ? `Купить всё` : 'Купить всё (не хватает $)',
          cancelText: 'Отмена',
        });
        if (!ok) return;
        try {
          await API.post('/api/missions/buy-required', { confId, opIdx, stepIdx });
          await App.refreshMe();
          // Техника куплена — сразу пробуем запустить шаг снова
          await runStep();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
      try {
        await runStep();
      } catch (e) {
        // Нет энергии — предложить восстановление за золото и повторить запуск
        if (/энерги/i.test(e.message)) {
          if (await _offerRestore('energy')) {
            try { await runStep(); } catch (e2) { UI.toast('⛔ ' + e2.message); }
          }
          return;
        }
        UI.toast('⛔ ' + e.message);
      }
    };
  });
  const boostBtn = document.getElementById('m-boost');
  if (boostBtn) {
    boostBtn.onclick = async () => {
      try { await API.post('/api/missions/boost', { processId: boostBtn.dataset.pid }); await App.refreshMe(); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  // Живой таймер активного шага: раньше этот блок был ПУСТ — из-за чего игрок
  // видел статичный таймер, а прогресс не двигался, пока экран не переоткроют
  // вручную. Теперь тикаем каждую секунду, а по завершении шага дёргаем сервер
  // (refreshMe вызывает checkCompleted → шаг засчитывается) и перерисовываем.
  if (App._missionTimer) { clearInterval(App._missionTimer); App._missionTimer = null; }
  if (conf.activeStep) {
    let secs = conf.activeStep.secondsLeft;
    App._missionTimer = setInterval(async () => {
      // Ушли с экрана миссий — гасим таймер
      if ((location.hash || '').indexOf('missions') < 0) {
        clearInterval(App._missionTimer); App._missionTimer = null; return;
      }
      secs--;
      const barLabel = document.querySelector('#mission-active .txt');
      const barFill = document.querySelector('#mission-active .fill');
      if (secs > 0) {
        if (barLabel) barLabel.textContent = 'Осталось: ' + UI.fmtTimer(secs);
        if (barFill) {
          const total = conf.activeStep.totalSec || 1;
          barFill.style.width = Math.min(100, Math.round((total - secs) / total * 100)) + '%';
        }
      } else {
        // Шаг завершился — засчитываем на сервере и обновляем экран
        clearInterval(App._missionTimer); App._missionTimer = null;
        if (barLabel) barLabel.textContent = 'Готово!';
        await App.refreshMe();          // → player.refresh → missions.checkCompleted
        App.rerender();                 // прогресс сдвинется: ●●○ → ●●●
      }
    }, 1000);
  }
}

// Переключение вкладки войны. Пишем её в адрес, чтобы обновление
// страницы возвращало игрока туда же, где он был.
App._setWarTab = (tab) => {
  App._warTab = tab;
  App._gbPage = null;              // раздел улучшений закрываем
  try {
    const want = '#war/' + tab;
    if (location.hash !== want) {
      // replaceState, а не переход: иначе кнопка «назад» в браузере
      // проходила бы через каждую открытую вкладку
      history.replaceState(null, '', want);
    }
  } catch (e) {}
  App.rerender();
};

// Отпечаток данных: перерисовываем экран, только если что-то реально
// изменилось. Иначе при обновлении раз в несколько секунд страница
// моргала бы вхолостую, сбрасывая прокрутку и введённые числа.
// Живой отсчёт до старта. Секунды считаем локально от времени старта,
// присланного сервером: опрашивать сервер каждую секунду ради таймера
// незачем, а между опросами он иначе стоит на месте.
App._startTicker = (selector, startsAt, onZero) => {
  clearInterval(App._tickTimer);
  let misses = 0;
  const paint = () => {
    const el = document.querySelector(selector);
    if (!el) {
      // Разметка ещё не отрисована — подождём несколько тактов.
      // Раньше тикер сдавался сразу и таймер замирал на нуле.
      if (++misses > 5) clearInterval(App._tickTimer);
      return;
    }
    misses = 0;
    const left = Math.max(0, Math.round((startsAt - Date.now()) / 1000));
    const m = Math.floor(left / 60), sec = left % 60;
    el.textContent = `${m}:${String(sec).padStart(2, '0')}`;
    if (left <= 0) {
      clearInterval(App._tickTimer);
      // Бой начался — обновляем экран, чтобы показать боевое окно
      if (onZero) setTimeout(onZero, 800);
    }
  };
  paint();
  App._tickTimer = setInterval(paint, 1000);
};

// Правила свёрнуты по умолчанию — они длинные и оттесняют вниз всё
// важное. Выбор игрока запоминается на время сессии.
App._rulesOpen = {};
App._bindRules = (root) => {
  root.querySelectorAll('[data-rules]').forEach((btn) => {
    const key = btn.dataset.rules;
    const body = root.querySelector(`[data-rules-body="${key}"]`);
    if (!body) return;
    const paint = () => {
      const open = !!App._rulesOpen[key];
      body.style.display = open ? '' : 'none';
      const arrow = btn.querySelector('.rules-arrow');
      if (arrow) arrow.textContent = open ? '▴' : '▾';
      btn.classList.toggle('open', open);
    };
    paint();
    btn.onclick = () => { App._rulesOpen[key] = !App._rulesOpen[key]; paint(); };
  });
};

App._sameAsBefore = (key, data) => {
  const sign = JSON.stringify(data);
  if (App['_sign_' + key] === sign) return true;
  App['_sign_' + key] = sign;
  return false;
};
App._resetSign = (key) => { delete App['_sign_' + key]; };

// ═══ АРЕНА: бой каждый сам за себя ══════════════════════════════════
// Экран живёт в двух состояниях: витрина с записью на ближайший бой и
// боевое окно. Переключение по данным сервера, а не по нажатию: игрок
// мог закрыть вкладку и вернуться посреди боя.
App._arenaTimer = null;

App.renderArena = async () => {
  clearInterval(App._arenaTimer);
  const box = document.getElementById('arena-box');
  if (!box) return;

  let d = null;
  try { d = await API.get('/api/arena?div=' + (App._arenaDiv || 'elite')); }
  catch (e) { box.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

  // Витрина перерисовывается, только если что-то поменялось. Секунды до
  // старта в отпечаток не берём — иначе экран моргал бы каждый раз.
  const fingerprint = { ...d, secondsLeft: undefined, rating: undefined,
                        registered: d.registered.map((x) => x.id) };
  // Время старта считаем сейчас, отсчёт запускаем после отрисовки
  const arenaStartAt = d.nextStartAt || (Date.now() + (d.secondsLeft || 0) * 1000);
  const arenaNeedTicker = d.secondsLeft > 0 || !!d.nextStartAt;
  const startArenaTicker = () => {
    if (!arenaNeedTicker) return;
    App._startTicker('#arena-timer', arenaStartAt, () => {
      App._resetSign('arenaLobby');
      App.renderArena();
    });
  };

  if (box.dataset.mode === 'lobby' && App._sameAsBefore('arenaLobby', fingerprint)) {
    startArenaTicker();
    return;
  }
  box.dataset.mode = 'lobby';

  // Игрок в идущем бою — показываем боевое окно
  if (d.battle && d.battle.iAmIn && d.battle.entered && d.battle.state === 'running') {
    return App.renderArenaBattle();
  }

  const mmss = (sec) => {
    const m = Math.floor(sec / 60), s2 = sec % 60;
    return `${m}:${String(s2).padStart(2, '0')}`;
  };
  const r = d.rules;

  const money = (n) => d.currency === 'gold'
    ? `<span class="ic-gold"></span> ${UI.fmtNum(n)}`
    : `<span class="ic-dollar"></span> ${UI.fmtMoney(n)}`;

  box.innerHTML = `
    <div class="arena-divs">
      ${d.divisions.map((x) => `
        <button class="arena-div${x.id === d.div ? ' active' : ''}" data-div="${x.id}">
          <span class="arena-div-icon">${x.icon}</span>
          <span class="arena-div-name">${UI.esc(x.short)}</span>
          <span class="arena-div-fee">${x.currency === 'gold'
            ? '<span class="ic-gold"></span> ' + x.entry
            : '<span class="ic-dollar"></span> ' + UI.fmtMoney(x.entry)}</span>
        </button>`).join('')}
    </div>

    ${d.lastResultId ? `
      <button class="btn mt" id="arena-last" style="width:100%">📊 Итоги последнего боя</button>` : ''}

    <div class="card arena-head">
      <img class="arena-banner" src="/img/arena/arena.webp" alt="Арена"
           loading="eager" decoding="sync" onerror="this.style.display='none'">
      <div class="arena-title">${UI.esc(d.divName).toUpperCase()}</div>
      <p class="muted small mt">Бой каждый сам за себя. Побеждает последний выживший — он забирает
      весь банк целиком.</p>
    </div>

    <div class="card rules-card">
      <button class="rules-toggle" data-rules="arena">
        <span>📜 Правила</span>
        <span class="rules-arrow">▾</span>
      </button>
      <ul class="arena-rules" data-rules-body="arena" style="display:none">
        <li>Бои стартуют каждые <b>${d.slotMinutes} минут</b>: в 00:15, 00:30, 00:45 и так далее.</li>
        <li>Взнос — <b>${money(d.entry)}</b> (${UI.esc(d.currencyLabel || '')}). Каждый участник
            поднимает банк на столько же. Победитель забирает весь банк
            <b>той же валютой</b>, остальные не получают ничего.</li>
        <li>Характеристики у всех <b>одинаковые</b>: ${UI.fmtNum(r.hp)} HP и ${r.atk} атаки.
            Уровень и техника значения не имеют.</li>
        <li>Между ударами — <b>${(r.cooldownMs / 1000).toFixed(1)} секунды</b> перезарядки.</li>
        <li>Четыре умения: 💉 аптечка (+${r.medkitPct}% здоровья), 💥 крит (×${r.critMin}–×${r.critMax}
            на ${r.critMs / 1000} с), 🛡 броня (−${r.armorPct}% урона на ${r.armorMs / 1000} с),
            🌫 дымовая завеса (${r.smokeUses} применения — уводит из-под прицела).</li>
        <li>Если записалось меньше <b>${d.minPlayers}</b> человек — бой отменяется, взносы возвращаются.</li>
        <li>Рейтинг: <b>1</b> очко за убийство, <b>3</b> за победу и ещё <b>3</b> за убийство фаворита боя.</li>
        <li>За проигрыш очки снимаются по месту: кто выбыл первым, теряет больше всех.
            В бою впятером — <b>−4, −3, −2, −1</b>, у победителя штрафа нет. Убийства штраф
            перекрывают, а ниже нуля рейтинг не опускается.</li>
        <li>Рейтинг у каждого дивизиона свой и ни на что не влияет — это просто мера мастерства.</li>
        <li>Запись можно отменить до старта, взнос вернётся полностью.</li>
      </ul>
    </div>

    ${d.battle && d.battle.iAmIn && d.battle.canEnter ? `
      <div class="card center arena-call">
        <div class="name">⚔ Бой начался!</div>
        <p class="muted small mt">Выйдите на арену, пока не истекло время:
          <b class="gold">${d.battle.enterLeftSec} с</b></p>
        <button class="btn btn-orange mt" id="arena-enter" style="width:100%">В БОЙ</button>
      </div>` : ''}

    <div class="card">
      <div class="arena-next">
        <div>
          <div class="muted small">Следующий бой через</div>
          <div class="arena-timer" id="arena-timer">${mmss(d.secondsLeft)}</div>
        </div>
        <div class="arena-pot">
          <div class="muted small">Банк</div>
          <div class="arena-pot-val">${money(d.pot)}</div>
        </div>
      </div>
      ${d.iAmRegistered
        ? `<button class="btn btn-red mt" id="arena-out" style="width:100%">Отменить запись и вернуть взнос</button>`
        : `<button class="btn btn-orange mt" id="arena-in" style="width:100%">
             Записаться — ${money(d.entry)}</button>
           <p class="muted small mt center">У вас: ${d.currency === 'gold'
             ? '<span class="ic-gold"></span> ' + UI.fmtNum(d.myGold)
             : '<span class="ic-dollar"></span> ' + UI.fmtMoney(d.myMoney)}</p>`}
    </div>

    <div class="card">
      <div class="name">Участники (${d.registered.length})</div>
      ${d.registered.length ? `
        <div class="arena-list mt">
          ${d.registered.map((p, i) => `
            <div class="arena-row">
              <span class="arena-num">${i + 1}</span>
              <span class="grow">${App._flagImg(p.flag)} ${UI.esc(p.name)}
                <span class="muted small">ур. ${p.level}</span></span>
              <span class="gold small">${money(d.entry)}</span>
            </div>`).join('')}
        </div>
        <div class="arena-total mt">
          <span class="grow">Победитель получит</span>
          <b class="gold">${money(d.pot)}</b>
        </div>`
        : '<p class="muted small mt">Пока никто не записался. Будьте первым.</p>'}
    </div>

    ${(d.history || []).length ? `
      <div class="card">
        <div class="name">Последние бои</div>
        <div class="mt">
          ${d.history.map((h) => `
            <div class="arena-row">
              <span class="grow">🏆 <b>${UI.esc(h.winnerName)}</b>
                <span class="muted small">· участников ${h.players}</span></span>
              <span class="gold small">${money(h.pot)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

    <div class="card">
      <div class="name">🏅 Рейтинг — ${UI.esc(d.divName)}</div>
      <p class="muted small mt">Очки: 1 за убийство, 3 за победу, 3 за убийство фаворита.
      Ни на что не влияет — просто показывает, кто чего стоит.</p>
      ${d.rating.top.length ? `
        <div class="table-wrap mt">
          <table class="gold-table">
            <thead><tr><th>#</th><th>Боец</th><th class="num">Очки</th><th class="num">Побед</th><th class="num">Убийств</th></tr></thead>
            <tbody>
              ${d.rating.top.map((x) => `
                <tr${x.isMe ? ' class="arena-row-me"' : ''}>
                  <td class="muted small">${x.place}</td>
                  <td>${App._flagImg(x.flag)} ${UI.esc(x.name)}${x.isMe ? ' <span class="muted small">(вы)</span>' : ''}</td>
                  <td class="num"><b class="gold">${UI.fmtNum(x.points)}</b></td>
                  <td class="num">${x.wins}</td>
                  <td class="num">${x.kills}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${d.rating.me && d.rating.me.place > d.rating.top.length
          ? `<p class="muted small mt">Вы на ${d.rating.me.place} месте — ${d.rating.me.points} очков</p>` : ''}`
        : '<p class="muted small mt">Пока никто не набрал очков. Проведите первый бой.</p>'}
    </div>`;

  box.querySelectorAll('[data-div]').forEach((b2) => {
    b2.onclick = () => { App._arenaDiv = b2.dataset.div; App.renderArena(); };
  });
  const lastBtn = document.getElementById('arena-last');
  if (lastBtn) lastBtn.onclick = () => App.renderArenaResult(d.lastResultId);

  App._bindRules(box);

  // Разметка построена — запускаем отсчёт
  startArenaTicker();

  const inBtn = document.getElementById('arena-in');
  if (inBtn) inBtn.onclick = async () => {
    inBtn.disabled = true;
    try { await API.post('/api/arena/register', { div: App._arenaDiv || 'elite' }); await App.refreshMe(); App.renderArena(); }
    catch (e) { UI.toast('⛔ ' + e.message); inBtn.disabled = false; }
  };
  const outBtn = document.getElementById('arena-out');
  if (outBtn) outBtn.onclick = async () => {
    outBtn.disabled = true;
    try { await API.post('/api/arena/unregister', { div: App._arenaDiv || 'elite' }); await App.refreshMe(); App.renderArena(); }
    catch (e) { UI.toast('⛔ ' + e.message); outBtn.disabled = false; }
  };
  const enterBtn = document.getElementById('arena-enter');
  if (enterBtn) enterBtn.onclick = async () => {
    enterBtn.disabled = true;
    try { await API.post('/api/arena/enter', {}); App.renderArenaBattle(); }
    catch (e) { UI.toast('⛔ ' + e.message); enterBtn.disabled = false; }
  };

  // Обновляем витрину раз в 5 секунд: чаще незачем, а старт боя
  // пропустить нельзя
  App._arenaTimer = setInterval(() => {
    if (document.hidden) return;
    if ((App._warTab || '') !== 'arena') { clearInterval(App._arenaTimer); return; }
    App.renderArena();
  }, 5000);
};

// Боевое окно. Раскладка сверху вниз, как описал владелец:
// логи → карточка игрока → карточка противника → «Атаковать» и
// «Сменить цель» → четыре умения → список оставшихся.
App.renderArenaBattle = async () => {
  clearInterval(App._arenaTimer);
  const box = document.getElementById('arena-box');
  if (!box) return;

  let b = null;
  try { b = await API.get('/api/arena/battle'); }
  catch (e) { box.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

  // Ничего не изменилось — не трогаем разметку. Иначе экран моргал бы
  // каждые пять секунд и сбрасывал прокрутку списка бойцов.
  if (box.dataset.mode === 'battle' && App._sameAsBefore('arenaBattle', b)) {
    scheduleArenaBattle();
    return;
  }
  box.dataset.mode = 'battle';

  // Бой окончен — показываем итог и возвращаем к витрине
  // Бой окончен — сразу открываем полную страницу разбора
  if (!b.active || b.finished) {
    if (b.battleId) return App.renderArenaResult(b.battleId);
    return App.renderArena();
  }

  const pct = (h, m) => Math.max(0, Math.round(h / m * 100));
  const me = b.me, t = b.target;
  const cdLeft = me.cooldownLeftMs;
  const SK = [
    ['medkit', '💉', 'Аптечка'],
    ['crit', '💥', 'Крит'],
    ['armor', '🛡', 'Броня'],
    ['smoke', '🌫', 'Дым'],
  ];

  box.innerHTML = `
    <div class="card arena-fight">
      <div class="arena-fight-head">
        <span>🏟 Бой идёт</span>
        <span class="muted small">осталось ${b.aliveCount} из ${b.total}</span>
        <span class="gold"><span class="ic-gold"></span> ${UI.fmtNum(b.pot)}</span>
      </div>

      <div class="arena-log" id="arena-log">
        ${(b.log || []).slice().reverse().map((l) => `<div>${UI.esc(l.text)}</div>`).join('')
          || '<div class="muted">Бой начался…</div>'}
      </div>

      ${b.huntersCount > 0
        ? `<div class="arena-hunted">⚠ Вас атакуют: ${b.huntersCount}</div>`
        : '<div class="arena-safe">Вас никто не преследует</div>'}

      <div class="arena-card arena-card-me">
        <div class="arena-card-top">
          <b>${App._flagImg(me.flag)} ${UI.esc(me.name)}</b>
          <span class="muted small">вы</span>
        </div>
        <div class="arena-hp"><i style="width:${pct(me.hp, me.maxHp)}%"></i></div>
        <div class="arena-hp-num">${UI.fmtNum(me.hp)} / ${UI.fmtNum(me.maxHp)}</div>
        ${(me.critLeftSec > 0 || me.armorLeftSec > 0) ? `
          <div class="arena-buffs">
            ${me.critLeftSec > 0 ? `<span class="arena-buff">💥 крит ${me.critLeftSec} с</span>` : ''}
            ${me.armorLeftSec > 0 ? `<span class="arena-buff">🛡 броня ${me.armorLeftSec} с</span>` : ''}
          </div>` : ''}
      </div>

      ${t ? `
        <div class="arena-vs">против</div>
        <div class="arena-card arena-card-foe">
          <div class="arena-card-top">
            <b>${App._flagImg(t.flag)} ${UI.esc(t.name)}
              <span class="rt-badge" title="Рейтинг">${UI.fmtNum(t.rating || 0)}</span></b>
            <span class="muted small">цель</span>
          </div>
          <div class="arena-hp arena-hp-foe"><i style="width:${pct(t.hp, t.maxHp)}%"></i></div>
          <div class="arena-hp-num">${UI.fmtNum(t.hp)} / ${UI.fmtNum(t.maxHp)}</div>
        </div>` : '<p class="muted center mt">Цель не выбрана</p>'}

      <div class="arena-acts">
        <button class="btn btn-orange" id="ar-attack" ${cdLeft > 0 ? 'disabled' : ''}
                data-cd-until="${Date.now() + cdLeft}">
          <span id="ar-attack-label">⚔ Атаковать</span>
        </button>
        <button class="btn" id="ar-switch">🎯 Сменить цель</button>
      </div>

      <div class="arena-skills">
        ${SK.map(([id, icon, name]) => `
          <button class="btn arena-skill" data-skill="${id}" ${me.skills[id] > 0 ? '' : 'disabled'}
                  ${id === 'crit' && me.critLeftMs > 0 ? `data-active-until="${Date.now() + me.critLeftMs}"` : ''}
                  ${id === 'armor' && me.armorLeftMs > 0 ? `data-active-until="${Date.now() + me.armorLeftMs}"` : ''}>
            <span class="arena-skill-icon">${icon}</span>
            <span class="arena-skill-name">${name}</span>
            <span class="arena-skill-left" data-left-for="${id}">${me.skills[id] || 0}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="name">Оставшиеся бойцы (${b.aliveCount})</div>
      <div class="mt">
        ${b.alive.map((f) => `
          <div class="arena-row${f.isMe ? ' arena-row-me' : ''}">
            <span class="arena-row-name">${App._flagImg(f.flag)} ${UI.esc(f.name)}${f.isMe ? ' <span class="muted small">(вы)</span>' : ''}
              <span class="rt-badge" title="Рейтинг">${UI.fmtNum(f.rating || 0)}</span></span>
            <span class="arena-mini-hp"><i style="width:${pct(f.hp, f.maxHp)}%"></i></span>
            <span class="small muted">${UI.fmtNum(f.hp)}</span>
          </div>`).join('')}
      </div>
    </div>`;

  // Живые отсчёты на кнопках: откат атаки и остаток действия умений.
  // Считаем локально раз в десятую секунды — сервер для этого дёргать
  // незачем, а игрок видит точное время.
  clearInterval(App._arenaBtnTimer);
  App._arenaBtnTimer = setInterval(() => {
    const atkBtn = document.getElementById('ar-attack');
    if (!atkBtn) { clearInterval(App._arenaBtnTimer); return; }
    const until = Number(atkBtn.dataset.cdUntil || 0);
    const left = Math.max(0, until - Date.now());
    const label = document.getElementById('ar-attack-label');
    if (label) label.textContent = left > 0
      ? `⚔ Атака (${(left / 1000).toFixed(1)})` : '⚔ Атаковать';
    atkBtn.disabled = left > 0;

    box.querySelectorAll('[data-active-until]').forEach((b2) => {
      const rest = Math.max(0, Number(b2.dataset.activeUntil || 0) - Date.now());
      const el = b2.querySelector('.arena-skill-left');
      if (!el) return;
      if (rest > 0) { el.textContent = Math.ceil(rest / 1000) + ' с'; b2.classList.add('skill-active'); }
      else { b2.classList.remove('skill-active'); b2.removeAttribute('data-active-until'); }
    });
  }, 100);

  const act = async (url, body) => {
    try { await API.post(url, body || {}); App.renderArenaBattle(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  const leave = document.getElementById('ar-leave');
  if (leave) leave.onclick = async () => {
    const go = await UI.confirm(
      'Покинуть бой?<br><span class="muted small">Засчитается поражение, награды не начислят.</span>',
      { title: 'Выйти из боя', icon: '🚪', html: true, okText: 'Выйти', cancelText: 'Остаться' });
    if (!go) return;
    try { await API.post('/api/arena/leave', {}); await App.refreshMe(); App.renderArena(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };

  const atk = document.getElementById('ar-attack');
  if (atk) atk.onclick = () => act('/api/arena/attack');
  const sw = document.getElementById('ar-switch');
  if (sw) sw.onclick = () => act('/api/arena/switch');
  box.querySelectorAll('[data-skill]').forEach((btn) => {
    btn.onclick = () => act('/api/arena/skill', { skill: btn.dataset.skill });
  });

  // Обновляем часто: бой идёт в реальном времени, и чужие удары нужно
  // видеть без задержки. Секунда — разумный предел: чаще нагружало бы
  // сервер без пользы, реже бой ощущался бы рваным.
  scheduleArenaBattle();
};

// Обновление боя раз в 5 секунд. Секундный опрос давал мигание и грузил
// сервер, а в отзывчивости не выигрывал: удары ограничены перезарядкой.
function scheduleArenaBattle() {
  clearInterval(App._arenaTimer);
  App._arenaTimer = setInterval(() => {
    if (document.hidden) return;
    if ((App._warTab || '') !== 'arena') { clearInterval(App._arenaTimer); return; }
    App.renderArenaBattle();
  }, 5000);
}

// ═══ СТРАНИЦА ИТОГОВ БОЯ ════════════════════════════════════════════
// Полноценный разбор: кто сколько нанёс, кого убил, сколько получил
// или потерял и как изменился рейтинг.
App.renderArenaResult = async (battleId) => {
  clearInterval(App._arenaTimer);
  const box = document.getElementById('arena-box');
  if (!box) return;
  box.innerHTML = '<div class="loading">Собираю итоги боя…</div>';

  let r = null;
  try { r = await API.get('/api/arena/result/' + encodeURIComponent(battleId)); }
  catch (e) {
    box.innerHTML = `<div class="card center"><p class="muted">${UI.esc(e.message)}</p>
      <button class="btn btn-orange mt" id="arena-back" style="width:100%">Вернуться на арену</button></div>`;
    const bk = document.getElementById('arena-back');
    if (bk) bk.onclick = () => App.renderArena();
    return;
  }

  const money = (n) => r.currency === 'gold'
    ? `<span class="ic-gold"></span> ${UI.fmtNum(Math.abs(n))}`
    : `<span class="ic-dollar"></span> ${UI.fmtMoney(Math.abs(n))}`;
  const me = r.rows.find((x) => x.id === (App.me && App.me.id));
  const dt = new Date(r.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  box.innerHTML = `
    <div class="card center arena-res-head">
      <img class="gb-banner arena-res-banner" src="/img/arena/${me && me.winner ? 'win' : 'lose'}.webp"
           alt="${me && me.winner ? 'Победа' : 'Поражение'}" loading="eager" decoding="async"
           onerror="this.style.display='none'">
      <div class="arena-title ${me && me.winner ? 'gb-win-title' : 'gb-lose-title'}">
        ${me && me.winner ? 'ПОБЕДА' : 'БОЙ ОКОНЧЕН'}
      </div>
      <p class="muted small mt">${UI.esc(r.divName)} · ${dt}</p>
      <p class="mt">Победитель: <b class="gold">${UI.esc(r.winnerName)}</b></p>
      <div class="arena-res-pot">Банк боя: <b>${money(r.pot)}</b>
        <span class="muted small">(${r.currency === 'gold' ? 'золото' : 'игровые деньги'})</span></div>
      ${me ? `
        <div class="arena-res-mine">
          <div><span class="muted small">ваш урон</span><b>${UI.fmtNum(me.damage)}</b></div>
          <div><span class="muted small">убийств</span><b>${me.kills}</b></div>
          <div><span class="muted small">место</span><b>${me.place}</b></div>
          <div><span class="muted small">рейтинг</span>
            <b class="${me.ratingNet >= 0 ? 'gold' : 'arena-res-minus'}">
              ${me.ratingNet >= 0 ? '+' : '−'}${Math.abs(me.ratingNet)}</b></div>
          <div><span class="muted small">итог</span>
            <b class="${me.delta >= 0 ? 'gold' : ''}">${me.delta >= 0 ? '+' : '−'}${money(me.delta)}</b></div>
        </div>` : ''}
    </div>

    <div class="card">
      <div class="name">Все участники (${r.rows.length})</div>
      <div class="table-wrap mt">
        <table class="gold-table arena-res-table">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Боец</th>
              <th class="num">Урон</th>
              <th class="num">Убийств</th>
              <th class="num">Рейтинг</th>
              <th class="num">Итог</th>
            </tr>
          </thead>
          <tbody>
            ${r.rows.map((x) => `
              <tr class="${x.winner ? 'arena-res-win' : ''}${x.id === (App.me && App.me.id) ? ' arena-row-me' : ''}">
                <td class="num muted small">${x.place}</td>
                <td>
                  ${x.winner ? '🏆 ' : ''}${App._flagImg(x.flag)} <b>${UI.esc(x.name)}</b>
                  ${x.favourite ? '<span class="arena-fav" title="Фаворит боя — наибольший рейтинг">★</span>' : ''}
                  ${x.killedFavourite ? '<span class="arena-fav-kill" title="Убил фаворита">+3</span>' : ''}
                </td>
                <td class="num">${UI.fmtNum(x.damage)}</td>
                <td class="num">${x.kills}</td>
                <td class="num arena-rt">
                  ${x.ratingGained ? `<span class="gold">+${x.ratingGained}</span>` : ''}
                  ${x.penalty ? `<span class="arena-res-minus">−${x.penalty}</span>` : ''}
                  <b class="${x.ratingNet >= 0 ? 'gold' : 'arena-res-minus'}">
                    ${x.ratingNet >= 0 ? '+' : '−'}${Math.abs(x.ratingNet)}</b>
                </td>
                <td class="num ${x.delta >= 0 ? 'gold' : 'arena-res-minus'}">
                  ${x.delta >= 0 ? '+' : '−'}${money(x.delta)}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted small mt">★ — фаворит боя, за его убийство даётся 3 очка рейтинга.<br>
      Штраф зависит от места: кто выбыл первым, теряет больше всех. Но убийства его перекрывают —
      наказывается не гибель, а бездействие. Ниже нуля рейтинг не опускается.</p>
    </div>

    <button class="btn btn-orange mt" id="arena-back" style="width:100%">← Вернуться на арену</button>`;

  const back = document.getElementById('arena-back');
  if (back) back.onclick = () => App.renderArena();
};

// ═══ ГРУППОВЫЕ БОИ 5 на 5 ═══════════════════════════════════════════
App._gbTimer = null;

App.renderGroup = async () => {
  clearInterval(App._gbTimer);
  const box = document.getElementById('gb-box');
  if (!box) return;

  // Открыт отдельный раздел — рисуем его вместо витрины
  if (App._gbPage === 'upgrades') return App.renderUpgradesPage();
  if (App._gbPage === 'supply') return App.renderSupplyPage();

  let d = null;
  try { d = await API.get('/api/group'); }
  catch (e) { box.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

  // Перерисовываем только при изменениях; секунды до старта обновляем
  // точечно, чтобы страница не моргала
  const fp = { ...d, secondsLeft: undefined, rating: undefined,
               registered: d.registered.map((x) => x.id + ':' + x.role) };
  // Время старта. Считаем его ДО отрисовки, а сам отсчёт запускаем
  // ПОСЛЕ — элемента таймера в разметке ещё не существует.
  const gbStartAt = d.nextStartAt || (Date.now() + (d.secondsLeft || 0) * 1000);
  const gbNeedTicker = d.registered.length > 0 && (d.secondsLeft > 0 || d.nextStartAt);
  const startGbTicker = () => {
    if (!gbNeedTicker) return;
    App._startTicker('#gb-timer', gbStartAt, () => {
      App._resetSign('gbLobby');
      App.renderGroup();
    });
  };

  if (box.dataset.mode === 'lobby' && App._sameAsBefore('gbLobby', fp)) {
    startGbTicker();   // разметка на месте, но отсчёт мог остановиться
    return;
  }
  box.dataset.mode = 'lobby';

  // Игрок вышел в бой — показываем боевое окно
  // Боевое окно показываем СРАЗУ, как только бой пошёл: игрок уже на
  // поле и его бьют, даже если он не нажал «В бой»
  if (d.battle && d.battle.iAmIn && d.battle.state === 'running') {
    return App.renderGroupBattle();
  }

  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const r = d.rules;

  box.innerHTML = `
    <div class="card gb-head">
      <img class="gb-banner" src="/img/group/preview.webp" alt="Групповой бой"
           loading="eager" decoding="async" onerror="this.style.display='none'">
      <div class="arena-title">🤝 ГРУППОВЫЕ БОИ</div>
      <p class="muted small mt">Команда на команду, до ${d.teamSize} человек с каждой стороны.
      Характеристики у всех одинаковые — важна только слаженность.</p>
    </div>

    <div class="card rules-card">
      <button class="rules-toggle" data-rules="arena">
        <span>📜 Правила</span>
        <span class="rules-arrow">▾</span>
      </button>
      <ul class="arena-rules" data-rules-body="arena" style="display:none">
        <li>Отсчёт начинается с первой записи: на сбор <b>${d.lobbyMinutes} минут</b>. Участники делятся на две команды
            поровну: при пятерых будет <b>3 на 2</b>, а не 4 на 1.</li>
        <li>В бою у всех <b>${UI.fmtNum(r.hp)} HP</b>, <b>${UI.fmtNum(r.energy)}</b> энергии
            и <b>${r.ammo}</b> боеприпасов. Эти запасы живут только внутри боя и не связаны
            с вашими обычными.</li>
        <li>Удар тратит боеприпас, лечение — ${r.costHeal} энергии, прикрытие — ${r.costGuard}.
            Между действиями ${(r.cooldownMs / 1000).toFixed(1)} секунды.</li>
        <li>Если участников не хватает, за <b>${d.botFillSec} секунд</b> до старта места
            начнут занимать боты — постепенно, чтобы опоздавшие успели. Они играют сами: атакуют, лечат и прикрывают.</li>
      </ul>
    </div>

    <div class="card">
      <div class="name">Ваша роль</div>
      <div class="gb-roles mt">
        ${d.roles.map((x) => `
          <button class="gb-role${x.id === d.myRole ? ' active' : ''}" data-role="${x.id}">
            <span class="gb-role-icon">${x.icon}</span>
            <span class="gb-role-name">${UI.esc(x.label)}</span>
            <span class="gb-role-desc">${UI.esc(x.desc)}</span>
          </button>`).join('')}
      </div>
    </div>

    ${d.battle && d.battle.canEnter ? `
      <div class="card center arena-call">
        <div class="name">⚔ Бой начался!</div>
        <p class="muted small mt">Выходите на поле: <b class="gold">${d.battle.enterLeftSec} с</b></p>
        <button class="btn btn-orange mt" id="gb-enter" style="width:100%">В БОЙ</button>
      </div>` : ''}

    <div class="card">
      <div class="arena-next">
        <div>
          <div class="muted small">Следующий бой через</div>
          <div class="arena-timer" id="gb-timer">${d.secondsLeft > 0 ? mmss(d.secondsLeft) : '—'}</div>
        </div>
        <div class="arena-pot">
          <div class="muted small">Записалось</div>
          <div class="arena-pot-val">${d.registered.length} / ${d.teamSize * 2}</div>
        </div>
      </div>
      ${d.iAmRegistered
        ? `<button class="btn btn-red mt" id="gb-out" style="width:100%">Отменить запись</button>`
        : `<button class="btn btn-orange mt" id="gb-in" style="width:100%">Записаться на бой</button>`}
    </div>

    <div class="card">
      <div class="name">Участники (${d.registered.length})</div>
      ${d.registered.length ? `
        <div class="arena-list mt">
          ${d.registered.map((p, i) => `
            <div class="arena-row">
              <span class="arena-num">${i + 1}</span>
              <span class="grow">${p.isBot ? '🤖' : App._flagImg(p.flag)} ${UI.esc(p.name)}
                ${p.isBot ? '<span class="muted small">бот</span>'
                  : `<span class="muted small">ур. ${p.level}</span>`}</span>
              <span class="gb-role-tag">${UI.esc(p.roleLabel)}</span>
            </div>`).join('')}
        </div>`
        : '<p class="muted small mt">Пока никто не записался.</p>'}
    </div>

    <div class="card">
      <div class="gb-my-rank">
        <div>
          <div class="muted small">Ваш ранг</div>
          <div class="gb-rank-name">${d.rating.myRank
            ? d.rating.myRank.icon + ' ' + UI.esc(d.rating.myRank.name)
            : '— без ранга'}</div>
        </div>
        <div class="right">
          <div class="muted small">Очков</div>
          <div class="gb-rank-pts">${UI.fmtNum(d.rating.myPoints)}</div>
        </div>
      </div>
      ${d.rating.nextRank ? `
        <div class="gb-rank-bar mt">
          <i style="width:${Math.min(100, Math.round(d.rating.myPoints / d.rating.nextRank.need * 100))}%"></i>
        </div>
        <p class="muted small mt">До ранга «${UI.esc(d.rating.nextRank.name)}» осталось
          <b>${UI.fmtNum(d.rating.nextRank.need - d.rating.myPoints)}</b> очков</p>` : ''}

      <div class="gb-sections mt">
        <button class="btn gb-section" data-section="upgrades">🔧 Улучшения</button>
        <button class="btn gb-section" data-section="supply">📦 База снабжения</button>
      </div>
    </div>

    <div class="card">
      <div class="name">🏅 Рейтинг групповых боёв</div>
      <p class="muted small mt">Победа команде +${d.rating.rules.win}, поражение ${d.rating.rules.loss}.
      Лично: +${d.rating.rules.kill} за убийство и +${d.rating.rules.best} лучшему бойцу,
      защитнику и медику боя.</p>
      ${d.rating.top.length ? `
        <div class="table-wrap mt">
          <table class="gold-table">
            <thead><tr><th>#</th><th>Боец</th><th>Ранг</th><th class="num">Очки</th><th class="num">Побед</th></tr></thead>
            <tbody>
              ${d.rating.top.map((x) => `
                <tr${x.isMe ? ' class="arena-row-me"' : ''}>
                  <td class="muted small">${x.place}</td>
                  <td>${App._flagImg(x.flag)} ${UI.esc(x.name)}${x.isMe ? ' <span class="muted small">(вы)</span>' : ''}</td>
                  <td class="small muted">${UI.esc(x.rank)}</td>
                  <td class="num"><b class="gold">${UI.fmtNum(x.points)}</b></td>
                  <td class="num">${x.wins}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${d.rating.me && d.rating.me.place > d.rating.top.length
          ? `<p class="muted small mt">Вы на ${d.rating.me.place} месте</p>` : ''}`
        : '<p class="muted small mt">Пока никто не набрал очков.</p>'}
    </div>`;

  // Улучшения и база снабжения: категории открываются по рангу
  // Разделы открываются ОТДЕЛЬНОЙ страницей: внутри витрины они мигали
  // при каждом её обновлении и перезапрашивали данные
  box.querySelectorAll('[data-section]').forEach((b2) => {
    b2.onclick = () => {
      App._gbPage = b2.dataset.section;
      App.renderGroup();
    };
  });

  App._bindRules(box);

  // Разметка построена — теперь элемент таймера существует
  startGbTicker();

  box.querySelectorAll('[data-role]').forEach((b2) => {
    b2.onclick = async () => {
      const role = b2.dataset.role;
      try {
        if (d.iAmRegistered) await API.post('/api/group/role', { role });
        else App._gbRole = role;
        App.renderGroup();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  const inB = document.getElementById('gb-in');
  if (inB) inB.onclick = async () => {
    inB.disabled = true;
    try { await API.post('/api/group/register', { role: App._gbRole || d.myRole }); App.renderGroup(); }
    catch (e) { UI.toast('⛔ ' + e.message); inB.disabled = false; }
  };
  const outB = document.getElementById('gb-out');
  if (outB) outB.onclick = async () => {
    outB.disabled = true;
    try { await API.post('/api/group/unregister', {}); App.renderGroup(); }
    catch (e) { UI.toast('⛔ ' + e.message); outB.disabled = false; }
  };
  const entB = document.getElementById('gb-enter');
  if (entB) entB.onclick = async () => {
    entB.disabled = true;
    try { await API.post('/api/group/enter', {}); App.renderGroupBattle(); }
    catch (e) { UI.toast('⛔ ' + e.message); entB.disabled = false; }
  };

  App._gbTimer = setInterval(() => {
    if (document.hidden) return;
    if ((App._warTab || '') !== 'group') { clearInterval(App._gbTimer); return; }
    App.renderGroup();
  }, 5000);
};

// Боевое окно группового боя. Раскладка как в боях легиона: логи
// сверху, под ними свои ресурсы, дальше списки команд с выбором цели.
// Выйти из окна нельзя, пока бой идёт — это оговорено в правилах.
App.renderGroupBattle = async () => {
  clearInterval(App._gbTimer);
  const box = document.getElementById('gb-box');
  if (!box) return;

  let b = null;
  try { b = await API.get('/api/group/battle' + (App._gbWatch ? '?watch=' + encodeURIComponent(App._gbWatch) : '')); }
  catch (e) { box.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

  // Отсчёт до конца входа меняется каждую секунду — из отпечатка его
  // убираем, иначе смысла в проверке нет
  if (box.dataset.mode === 'battle' && App._sameAsBefore('gbBattle', { ...b, enterLeftSec: undefined })) {
    const t = document.getElementById('gb-enter-left');
    if (t) t.textContent = b.enterLeftSec;
    return;
  }
  box.dataset.mode = 'battle';

  if (!b.active && !b.finished) return App.renderGroup();

  const pct = (h, m) => Math.max(0, Math.round(h / m * 100));
  const me = b.me;

  // Комната подготовки: бой ещё не начался, все занимают места
  if (b.preparing) {
    const teamList = (arr, title, cls) => `
      <div class="prep-team ${cls}">
        <div class="prep-team-title">${title}</div>
        ${arr.map((f) => `
          <div class="prep-row${f.isMe ? ' gb-me' : ''}">
            <span class="gb-role-icon">${f.roleIcon}</span>
            <span class="grow">${f.isBot ? '🤖' : App._flagImg(f.flag)} ${UI.esc(f.name)}
              ${f.isMe ? '<span class="muted small">(вы)</span>' : ''}</span>
            <span class="rt-badge" title="Рейтинг">${UI.fmtNum(f.rating || 0)}</span>
          </div>`).join('')}
      </div>`;
    box.innerHTML = `
      <div class="card center prep-card">
        <div class="arena-title">⏳ ПОДГОТОВКА К БОЮ</div>
        <p class="muted small mt">Займите места — бой начнётся автоматически.</p>
        <div class="prep-timer" id="prep-left">${b.prepareLeftSec}</div>
        <p class="muted small">секунд до начала</p>
      </div>
      <div class="card">
        ${teamList(b.allies, '🟢 Ваша команда', 'prep-ally')}
        ${teamList(b.enemies, '🔴 Противники', 'prep-foe')}
      </div>`;
    // Живой отсчёт подготовки
    clearInterval(App._gbTimer);
    const until = Date.now() + b.prepareLeftSec * 1000;
    App._gbTimer = setInterval(() => {
      const el = document.getElementById('prep-left');
      if (!el) { clearInterval(App._gbTimer); return; }
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      el.textContent = left;
      if (left <= 0) { clearInterval(App._gbTimer); App.renderGroupBattle(); }
    }, 250);
    return;
  }

  // Итог боя
  if (b.finished) {
    box.innerHTML = `
      <div class="card center gb-result-head">
        ${b.winnerTeam === -1 ? '<p style="font-size:44px">🤝</p>' : `
          <img class="gb-banner gb-result-banner" src="/img/group/${b.iWon ? 'win' : 'lose'}.webp"
               alt="${b.iWon ? 'Победа' : 'Поражение'}" loading="eager" decoding="async"
               onerror="this.style.display='none'">`}
        <div class="arena-title ${b.iWon ? 'gb-win-title' : (b.winnerTeam === -1 ? '' : 'gb-lose-title')}">
          ${b.iWon ? 'ПОБЕДА' : (b.winnerTeam === -1 ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ')}
        </div>
        ${(() => {
          const mine = (b.result || []).find((x) => x.id === me.id);
          return mine ? `
            <div class="arena-res-mine mt">
              <div><span class="muted small">урон</span><b>${UI.fmtNum(mine.damage)}</b></div>
              <div><span class="muted small">защищено</span><b>${UI.fmtNum(mine.absorbed)}</b></div>
              <div><span class="muted small">лечение</span><b>${UI.fmtNum(mine.healed)}</b></div>
              <div><span class="muted small">рейтинг</span>
                <b class="${mine.ratingGained >= 0 ? 'gold' : 'arena-res-minus'}">
                  ${mine.ratingGained >= 0 ? '+' : '−'}${Math.abs(mine.ratingGained)}</b></div>
              <div><span class="muted small">боевые очки</span><b class="gold">+${UI.fmtNum(mine.tokens)}</b></div>
            </div>` : '';
        })()}
      </div>

      ${(b.result || []).length ? `
        <div class="card">
          <div class="name">Итоги боя</div>
          <div class="table-wrap mt">
            <table class="gold-table arena-res-table">
              <thead>
                <tr><th>Боец</th><th class="num">Урон</th><th class="num">Защита</th>
                    <th class="num">Лечение</th><th class="num">Убийств</th>
                    <th class="num">Рейтинг</th><th class="num">Очки</th></tr>
              </thead>
              <tbody>
                ${b.result.map((x) => `
                  <tr class="${x.won ? 'arena-res-win' : ''}${x.id === me.id ? ' arena-row-me' : ''}">
                    <td>
                      ${x.isBot ? '🤖' : App._flagImg(x.flag)} <b>${UI.esc(x.name)}</b>
                      <span class="muted small">${UI.esc(x.roleLabel)}</span>
                      ${x.bestFighter ? '<span class="gb-best" title="Лучший боец">⚔</span>' : ''}
                      ${x.bestGuard ? '<span class="gb-best" title="Лучший защитник">🛡</span>' : ''}
                      ${x.bestMedic ? '<span class="gb-best" title="Лучший медик">💉</span>' : ''}
                    </td>
                    <td class="num">${UI.fmtNum(x.damage)}</td>
                    <td class="num">${UI.fmtNum(x.absorbed)}</td>
                    <td class="num">${UI.fmtNum(x.healed)}</td>
                    <td class="num">${x.kills}</td>
                    <td class="num ${x.ratingGained >= 0 ? 'gold' : 'arena-res-minus'}">
                      ${x.isBot ? '—' : (x.ratingGained >= 0 ? '+' : '−') + Math.abs(x.ratingGained)}
                    </td>
                    <td class="num gold">${x.isBot ? '—' : '+' + UI.fmtNum(x.tokens)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <p class="muted small mt">⚔ лучший урон, 🛡 больше всех защитил, 💉 больше всех вылечил —
          за каждое звание 3 очка рейтинга.</p>
        </div>` : ''}

      <button class="btn btn-orange mt" id="gb-back" style="width:100%">← К групповым боям</button>`;
    const bk = document.getElementById('gb-back');
    if (bk) bk.onclick = () => { App._gbWatch = ''; App.renderGroup(); };
    return;
  }

  const rowOf = (f, enemy) => `
    <div class="gb-row${f.alive ? '' : ' gb-dead'}${f.isMe ? ' gb-me' : ''}${me.targetId === f.id ? ' gb-target' : ''}">
      <span class="gb-role-icon" title="${UI.esc(f.roleLabel)}">${f.roleIcon}</span>
      <span class="grow">
        <span class="gb-row-name">${f.isBot ? '🤖' : App._flagImg(f.flag)} ${UI.esc(f.name)}${f.isMe ? ' <span class="muted small">(вы)</span>' : ''}
          <span class="rt-badge" title="Рейтинг">${UI.fmtNum(f.rating || 0)}</span>
          ${f.guarded ? '<span class="gb-guarded" title="Прикрыт">🛡</span>' : ''}</span>
        <span class="gb-hp"><i style="width:${pct(f.hp, f.maxHp)}%"></i></span>
      </span>
      <span class="small muted gb-hp-num">${UI.fmtNum(f.hp)}</span>
      ${f.alive ? `
        <span class="gb-acts">
          ${enemy ? `<button class="btn btn-inline gb-act" data-act="attack" data-id="${f.id}"
                       ${me.cooldownLeftMs > 0 || me.ammo < 1 ? 'disabled' : ''}>⚔</button>` : ''}
          ${!enemy && b.canHeal && !f.isMe ? `<button class="btn btn-inline gb-act" data-act="heal" data-id="${f.id}"
                       ${me.cooldownLeftMs > 0 || me.energy < 120 ? 'disabled' : ''}>💉</button>` : ''}
          ${!enemy && b.canGuard && !f.isMe ? `<button class="btn btn-inline gb-act" data-act="guard" data-id="${f.id}"
                       ${me.cooldownLeftMs > 0 || me.energy < 80 ? 'disabled' : ''}>🛡</button>` : ''}
        </span>` : '<span class="small muted">выбыл</span>'}
    </div>`;

  box.innerHTML = `
    <div class="card gb-fight">
      <div class="gb-fight-head">
        <span>🤝 Групповой бой</span>
        <span class="muted small">${b.state === 'waiting' ? 'ждём остальных' : 'идёт'}</span>
      </div>

      ${(b.entered === false && me.alive) ? `
        <div class="gb-enter-now">
          <div class="gb-enter-title">⚠ Вы ещё не вступили в бой!</div>
          <div class="small">Вас уже могут атаковать. Осталось
            <b id="gb-enter-left">${b.enterLeftSec}</b> с</div>
          <button class="btn btn-orange mt" id="gb-enter-fight" style="width:100%">В БОЙ</button>
        </div>` : ''}

      ${!me.alive ? `
        <div class="gb-dead-panel">
          <div class="gb-dead-title">☠ Вы выведены из боя</div>
          ${b.killedBy ? `<div class="small">Вас добил: <b>${UI.esc(b.killedBy)}</b></div>` : ''}
          <div class="muted small mt">Бой продолжается — можно следить за союзниками.</div>
          ${(b.watchable || []).length ? `
            <div class="gb-watch mt">
              ${b.watchable.map((w) => `
                <button class="btn btn-inline gb-watch-btn${(App._gbWatch || '') === w.id || (!App._gbWatch && w.isMe) ? ' active' : ''}${w.alive ? '' : ' dead'}"
                        data-watch="${w.id}">
                  ${UI.esc(w.name)}${w.isMe ? ' (вы)' : ''}
                  <span class="muted small">${Math.round(w.hp / w.maxHp * 100)}%</span>
                </button>`).join('')}
            </div>` : ''}
        </div>` : ''}

      ${b.watching ? `
        <div class="gb-watching">
          👁 Смотрите бой глазами: <b>${UI.esc(b.watching.name)}</b>
          <span class="muted small">${UI.esc(b.watching.roleLabel)} ·
          ${UI.fmtNum(b.watching.hp)}/${UI.fmtNum(b.watching.maxHp)} HP ·
          урон ${UI.fmtNum(b.watching.damageDealt)}</span>
        </div>` : ''}

      <div class="arena-log" id="gb-log">
        ${(b.log || []).map((l) => `<div class="gb-log-${UI.esc(l.kind)}">${UI.esc(l.text)}</div>`).join('')
          || '<div class="muted">Бой начинается…</div>'}
      </div>

      <div class="gb-self">
        <div class="gb-self-top">
          <b>${me.roleIcon} ${UI.esc(me.name)}</b>
          <span class="muted small">${UI.esc(me.roleLabel)} · команда ${me.team + 1}</span>
        </div>
        <div class="gb-bars">
          <div class="gb-bar">
            <span class="gb-bar-l">❤ HP</span>
            <span class="gb-bar-t"><i class="gb-bar-hp" style="width:${pct(me.hp, me.maxHp)}%"></i></span>
            <span class="gb-bar-n">${UI.fmtNum(me.hp)}/${UI.fmtNum(me.maxHp)}</span>
          </div>
          <div class="gb-bar">
            <span class="gb-bar-l">⚡ Энергия</span>
            <span class="gb-bar-t"><i class="gb-bar-en" style="width:${pct(me.energy, me.maxEnergy)}%"></i></span>
            <span class="gb-bar-n">${UI.fmtNum(me.energy)}/${UI.fmtNum(me.maxEnergy)}</span>
          </div>
          <div class="gb-bar">
            <span class="gb-bar-l">🎯 Боеприпасы</span>
            <span class="gb-bar-t"><i class="gb-bar-am" style="width:${pct(me.ammo, me.maxAmmo)}%"></i></span>
            <span class="gb-bar-n">${me.ammo}/${me.maxAmmo}</span>
          </div>
        </div>
        ${me.cooldownLeftMs > 0
          ? `<div class="gb-cd">Перезарядка ${(me.cooldownLeftMs / 1000).toFixed(1)} с</div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="name">🔴 Противники</div>
      <div class="mt">${b.enemies.map((f) => rowOf(f, true)).join('')}</div>
    </div>

    <div class="card">
      <div class="name">🟢 Ваша команда</div>
      <div class="mt">${b.allies.map((f) => rowOf(f, false)).join('')}</div>
    </div>

    <button class="btn btn-red mt" id="gb-leave" style="width:100%">🚪 Покинуть бой</button>
    <p class="muted small center">Засчитается поражение, награды не начислят.</p>`;

  const enterNow = document.getElementById('gb-enter-fight');
  if (enterNow) enterNow.onclick = async () => {
    enterNow.disabled = true;
    try { await API.post('/api/group/enter', {}); App._resetSign('gbBattle'); App.renderGroupBattle(); }
    catch (e) { UI.toast('⛔ ' + e.message); enterNow.disabled = false; }
  };

  box.querySelectorAll('[data-watch]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.watch;
      App._gbWatch = (App._gbWatch === id) ? '' : id;
      App.renderGroupBattle();
    };
  });

  const gbLeave = document.getElementById('gb-leave');
  if (gbLeave) gbLeave.onclick = async () => {
    const go = await UI.confirm(
      'Покинуть бой?<br><span class="muted small">Засчитается поражение, награды не начислят.</span>',
      { title: 'Выйти из боя', icon: '🚪', html: true, okText: 'Выйти', cancelText: 'Остаться' });
    if (!go) return;
    try { await API.post('/api/group/leave', {}); await App.refreshMe(); App.renderGroup(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };

  box.querySelectorAll('.gb-act').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await API.post('/api/group/act', { action: btn.dataset.act, targetId: btn.dataset.id });
        App.renderGroupBattle();
      } catch (e) { UI.toast('⛔ ' + e.message); App.renderGroupBattle(); }
    };
  });

  // Раз в 5 секунд — как и на арене
  App._gbTimer = setInterval(() => {
    if (document.hidden) return;
    if ((App._warTab || '') !== 'group') { clearInterval(App._gbTimer); return; }
    App.renderGroupBattle();
  }, 5000);
};

// ═══ УЛУЧШЕНИЯ: отдельная страница ══════════════════════════════════
// Раньше раздел раскрывался прямо в витрине и мигал при каждом её
// обновлении, повторяя запрос к серверу. Теперь это самостоятельная
// страница со своей кнопкой «Назад».
App.renderUpgradesPage = async () => {
  clearInterval(App._gbTimer);
  const box = document.getElementById('gb-box');
  if (!box) return;
  box.dataset.mode = 'upgrades';
  box.innerHTML = '<div class="loading">Загружаю улучшения…</div>';

  let up = null;
  try { up = await API.get('/api/group/upgrades'); }
  catch (e) {
    box.innerHTML = `
      <button class="btn mt" id="gb-back-page" style="width:100%">← Назад к групповым боям</button>
      <div class="card mt"><p style="color:var(--red)">${UI.esc(e.message)}</p>
        <button class="btn btn-inline mt" id="gb-up-retry">Повторить</button></div>`;
    const b1 = document.getElementById('gb-back-page');
    if (b1) b1.onclick = () => { App._gbPage = null; App.renderGroup(); };
    const r = document.getElementById('gb-up-retry');
    if (r) r.onclick = () => App.renderUpgradesPage();
    return;
  }

  const cost = (c) => c ? `
    <span class="gb-cost">
      ${up.currencyIcon} ${UI.fmtNum(c.amount)}
      <span class="gb-cost-sep">·</span> <span class="ic-ear"></span> ${c.ears}
      <span class="gb-cost-sep">·</span> <span class="ic-token"></span> ${c.tokens}
    </span>` : '';

  box.innerHTML = `
    <button class="btn" id="gb-back-page" style="width:100%">← Назад к групповым боям</button>

    <div class="card mt">
      <div class="title" style="margin:0">🔧 Улучшения</div>
      <p class="muted small mt">Навыки прокачиваются по ступеням: на каждом ранге свои десять
      уровней. Следующая ступень откроется, только когда предыдущая выкачана до конца.</p>
      <p class="muted small">Платите ${up.currencyIcon} <b>боевыми очками</b> (их дают за бои),
      <span class="ic-ear"></span> ушами и <span class="ic-token"></span> жетонами милосердия.</p>
      <div class="gb-wallet mt">
        <span title="${UI.esc(up.currencyName)}">${up.currencyIcon} ${UI.fmtNum(up.wallet.points)}</span>
        <span title="Уши"><span class="ic-ear"></span> ${UI.fmtNum(up.wallet.ears)}</span>
        <span title="Жетоны милосердия"><span class="ic-token"></span> ${UI.fmtNum(up.wallet.tokens)}</span>
      </div>
    </div>

    ${up.tierSkills.map((t) => `
      <div class="card tier-card${t.unlocked ? '' : ' locked'}" style="--tier:${t.color}">
        <div class="tier-head">
          <span class="tier-dot"></span>
          <span class="grow">
            <b class="tier-name">${UI.esc(t.name)}</b>
            <span class="muted small">уровни ${t.from}–${t.to} · от ${UI.fmtNum(t.need)} очков</span>
          </span>
          <span class="small ${t.unlocked ? 'gold' : 'muted'}">
            ${t.unlocked ? 'открыто' : '🔒 ещё ' + UI.fmtNum(t.left)}
          </span>
        </div>
        <div class="gb-skills mt">
          ${t.skills.map((sk) => `
            <div class="gb-skill${sk.atMaxTier ? ' maxed' : ''}">
              <div class="gb-skill-top">
                <span class="gb-skill-icon">${sk.icon}</span>
                <span class="grow">
                  <b class="tier-name">${UI.esc(sk.name)}</b>
                  <span class="muted small">${UI.esc(sk.desc)}</span>
                </span>
                <span class="gb-skill-lvl tier-name">${sk.inTier}<span class="muted">/${sk.tierMax}</span></span>
              </div>
              <div class="gb-skill-bar"><i style="width:${sk.inTier / sk.tierMax * 100}%;background:${t.color}"></i></div>
              <div class="gb-skill-now">
                Сейчас: <b class="tier-name">${sk.kind === 'flat' ? '+' + sk.value : '+' + sk.value + '%'}</b>
                ${sk.isCurrent && !sk.atMaxTier
                  ? `<span class="muted small">· уровень +${sk.kind === 'flat' ? sk.step : sk.step + '%'}</span>` : ''}
              </div>
              ${sk.atMaxTier
                ? '<div class="gb-skill-max">Ступень пройдена</div>'
                : (sk.isCurrent
                  ? `<div class="gb-skill-buy">
                       ${sk.nextCost ? `<span class="gb-cost">
                         ${up.currencyIcon} ${UI.fmtNum(sk.nextCost.amount)}
                         <span class="gb-cost-sep">·</span> <span class="ic-ear"></span> ${sk.nextCost.ears}
                         <span class="gb-cost-sep">·</span> <span class="ic-token"></span> ${sk.nextCost.tokens}
                       </span>` : ''}
                       <button class="btn btn-inline gb-up" data-skill="${sk.id}"
                               ${sk.canUpgrade ? '' : 'disabled'}>
                         ${sk.blockedByRank ? '🔒 ранг' : 'Улучшить'}
                       </button>
                     </div>`
                  : '<div class="muted small">Сначала пройдите предыдущую ступень</div>')}
            </div>`).join('')}
        </div>
      </div>`).join('')}

    <div class="card">
      <div class="name">Ваши характеристики в бою</div>
      <div class="gb-stats-grid mt">
        <span>❤ ${UI.fmtNum(up.stats.hp)} HP</span>
        <span>⚡ ${UI.fmtNum(up.stats.energy)}</span>
        <span>🎯 ${up.stats.ammo}</span>
        <span>💥 крит ${Math.round(up.stats.critChance * 100)}% (×${up.critMin}–×${up.critMax})</span>
        <span>💨 уворот ${Math.round(up.stats.dodgeChance * 100)}%</span>
        <span>🛡 −${Math.round(up.stats.damageReduce * 1000) / 10}% урона</span>
        <span>💚 крит-лечение ${Math.round(up.stats.healCritChance * 100)}%</span>
        <span>🪙 награда +${Math.round(up.stats.rewardBonus * 100)}%</span>
      </div>
    </div>

    <button class="btn mt" id="gb-back-page2" style="width:100%">← Назад к групповым боям</button>`;

  const back = () => { App._gbPage = null; App._resetSign('gbLobby'); App.renderGroup(); };
  const b1 = document.getElementById('gb-back-page');
  if (b1) b1.onclick = back;
  const b2 = document.getElementById('gb-back-page2');
  if (b2) b2.onclick = back;

  box.querySelectorAll('.gb-up').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await API.post('/api/group/upgrade', { skill: btn.dataset.skill });
        await App.refreshMe();
        App.renderUpgradesPage();
      } catch (e) { UI.toast('⛔ ' + e.message); btn.disabled = false; }
    };
  });
};

// ═══ БАЗА СНАБЖЕНИЯ: торговцы и временные усиления ══════════════════
App.renderSupplyPage = async () => {
  clearInterval(App._gbTimer);
  const box = document.getElementById('gb-box');
  if (!box) return;
  box.dataset.mode = 'supply';
  box.innerHTML = '<div class="loading">Загружаю базу снабжения…</div>';

  let d = null;
  try { d = await API.get('/api/group/supply'); }
  catch (e) {
    box.innerHTML = `
      <button class="btn" id="gb-back-page" style="width:100%">← Назад к групповым боям</button>
      <div class="card mt"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`;
    const b0 = document.getElementById('gb-back-page');
    if (b0) b0.onclick = () => { App._gbPage = null; App.renderGroup(); };
    return;
  }

  const mmss = (sec) => {
    const m = Math.floor(sec / 60), s2 = sec % 60;
    return `${m}:${String(s2).padStart(2, '0')}`;
  };

  box.innerHTML = `
    <button class="btn" id="gb-back-page" style="width:100%">← Назад к групповым боям</button>

    <div class="card mt">
      <div class="title" style="margin:0">📦 База снабжения</div>
      <p class="muted small mt">Временные усиления для групповых боёв. Действуют по времени —
      купил и живёшь с ними, пока не истечёт срок.</p>
      <div class="gb-wallet mt">
        <span title="Боевые очки">🎗 ${UI.fmtNum(d.wallet.points)}</span>
        <span title="Ваш рейтинг">🏅 ${UI.fmtNum(d.myPoints)}</span>
      </div>
    </div>

    ${d.active.length ? `
      <div class="card sup-active-card">
        <div class="name">✨ Действует сейчас</div>
        <div class="mt">
          ${d.active.map((a) => `
            <div class="sup-active" data-buff-until="${Date.now() + a.leftSec * 1000}">
              <span class="sup-icon">${a.icon}</span>
              <span class="grow"><b>${UI.esc(a.name)}</b>
                <span class="gold">+${a.pct}%</span></span>
              <span class="sup-left">${mmss(a.leftSec)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${d.traders.map((t) => `
      <div class="card sup-trader${t.unlocked ? '' : ' locked'}">
        <div class="sup-head">
          <span class="sup-face">${t.icon}</span>
          <span class="grow">
            <b>${UI.esc(t.name)}</b>
            <span class="muted small">${UI.esc(t.about)}</span>
          </span>
          <span class="small ${t.unlocked ? 'gold' : 'muted'} nowrap">
            ${t.unlocked ? 'торгует' : '🔒 рейтинг ' + UI.fmtNum(t.need)}
          </span>
        </div>
        ${t.unlocked ? `
          <div class="sup-items mt">
            ${t.items.map((it) => `
              <div class="sup-item">
                <span class="sup-icon">${it.icon}</span>
                <span class="grow">
                  <b>${UI.esc(it.name)}</b>
                  <span class="muted small">${UI.esc(it.desc)} · ${it.minutes} мин</span>
                  ${it.activeNow ? `<span class="sup-note">уже действует — покупка продлит</span>` : ''}
                </span>
                <span class="sup-buy">
                  <span class="sup-price">🎗 ${UI.fmtNum(it.price)}</span>
                  <button class="btn btn-inline sup-go" data-item="${it.id}"
                          ${it.canBuy ? '' : 'disabled'}>Купить</button>
                </span>
              </div>`).join('')}
          </div>`
        : `<p class="muted small mt">Откроется при рейтинге ${UI.fmtNum(t.need)} —
           осталось набрать ${UI.fmtNum(t.left)}.</p>`}
      </div>`).join('')}

    <button class="btn mt" id="gb-back-page2" style="width:100%">← Назад к групповым боям</button>`;

  const back = () => { App._gbPage = null; App._resetSign('gbLobby'); App.renderGroup(); };
  const b1 = document.getElementById('gb-back-page');
  if (b1) b1.onclick = back;
  const b2 = document.getElementById('gb-back-page2');
  if (b2) b2.onclick = back;

  box.querySelectorAll('.sup-go').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await API.post('/api/group/supply/buy', { item: btn.dataset.item });
        await App.refreshMe();
        App.renderSupplyPage();
      } catch (e) { UI.toast('⛔ ' + e.message); btn.disabled = false; }
    };
  });

  // Живой отсчёт действующих усилений
  clearInterval(App._supTimer);
  App._supTimer = setInterval(() => {
    const rows = box.querySelectorAll('[data-buff-until]');
    if (!rows.length) { clearInterval(App._supTimer); return; }
    rows.forEach((r) => {
      const left = Math.max(0, Math.round((Number(r.dataset.buffUntil) - Date.now()) / 1000));
      const el = r.querySelector('.sup-left');
      if (el) el.textContent = mmss(left);
      if (left <= 0) App.renderSupplyPage();
    });
  }, 1000);
};


// Боевое окно группового боя. Раскладка как в боях легиона: логи
// сверху, под ними свои ресурсы, дальше списки команд с выбором цели.
// Выйти из окна нельзя, пока бой идёт — это оговорено в правилах.
App.renderGroupBattle = async () => {
  clearInterval(App._gbTimer);
  const box = document.getElementById('gb-box');
  if (!box) return;

  let b = null;
  try { b = await API.get('/api/group/battle' + (App._gbWatch ? '?watch=' + encodeURIComponent(App._gbWatch) : '')); }
  catch (e) { box.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

  // Отсчёт до конца входа меняется каждую секунду — из отпечатка его
  // убираем, иначе смысла в проверке нет
  if (box.dataset.mode === 'battle' && App._sameAsBefore('gbBattle', { ...b, enterLeftSec: undefined })) {
    const t = document.getElementById('gb-enter-left');
    if (t) t.textContent = b.enterLeftSec;
    return;
  }
  box.dataset.mode = 'battle';

  if (!b.active && !b.finished) return App.renderGroup();

  const pct = (h, m) => Math.max(0, Math.round(h / m * 100));
  const me = b.me;

  // Комната подготовки: бой ещё не начался, все занимают места
  if (b.preparing) {
    const teamList = (arr, title, cls) => `
      <div class="prep-team ${cls}">
        <div class="prep-team-title">${title}</div>
        ${arr.map((f) => `
          <div class="prep-row${f.isMe ? ' gb-me' : ''}">
            <span class="gb-role-icon">${f.roleIcon}</span>
            <span class="grow">${f.isBot ? '🤖' : App._flagImg(f.flag)} ${UI.esc(f.name)}
              ${f.isMe ? '<span class="muted small">(вы)</span>' : ''}</span>
            <span class="rt-badge" title="Рейтинг">${UI.fmtNum(f.rating || 0)}</span>
          </div>`).join('')}
      </div>`;
    box.innerHTML = `
      <div class="card center prep-card">
        <div class="arena-title">⏳ ПОДГОТОВКА К БОЮ</div>
        <p class="muted small mt">Займите места — бой начнётся автоматически.</p>
        <div class="prep-timer" id="prep-left">${b.prepareLeftSec}</div>
        <p class="muted small">секунд до начала</p>
      </div>
      <div class="card">
        ${teamList(b.allies, '🟢 Ваша команда', 'prep-ally')}
        ${teamList(b.enemies, '🔴 Противники', 'prep-foe')}
      </div>`;
    // Живой отсчёт подготовки
    clearInterval(App._gbTimer);
    const until = Date.now() + b.prepareLeftSec * 1000;
    App._gbTimer = setInterval(() => {
      const el = document.getElementById('prep-left');
      if (!el) { clearInterval(App._gbTimer); return; }
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      el.textContent = left;
      if (left <= 0) { clearInterval(App._gbTimer); App.renderGroupBattle(); }
    }, 250);
    return;
  }

  // Итог боя
  if (b.finished) {
    box.innerHTML = `
      <div class="card center gb-result-head">
        ${b.winnerTeam === -1 ? '<p style="font-size:44px">🤝</p>' : `
          <img class="gb-banner gb-result-banner" src="/img/group/${b.iWon ? 'win' : 'lose'}.webp"
               alt="${b.iWon ? 'Победа' : 'Поражение'}" loading="eager" decoding="async"
               onerror="this.style.display='none'">`}
        <div class="arena-title ${b.iWon ? 'gb-win-title' : (b.winnerTeam === -1 ? '' : 'gb-lose-title')}">
          ${b.iWon ? 'ПОБЕДА' : (b.winnerTeam === -1 ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ')}
        </div>
        ${(() => {
          const mine = (b.result || []).find((x) => x.id === me.id);
          return mine ? `
            <div class="arena-res-mine mt">
              <div><span class="muted small">урон</span><b>${UI.fmtNum(mine.damage)}</b></div>
              <div><span class="muted small">защищено</span><b>${UI.fmtNum(mine.absorbed)}</b></div>
              <div><span class="muted small">лечение</span><b>${UI.fmtNum(mine.healed)}</b></div>
              <div><span class="muted small">рейтинг</span>
                <b class="${mine.ratingGained >= 0 ? 'gold' : 'arena-res-minus'}">
                  ${mine.ratingGained >= 0 ? '+' : '−'}${Math.abs(mine.ratingGained)}</b></div>
              <div><span class="muted small">боевые очки</span><b class="gold">+${UI.fmtNum(mine.tokens)}</b></div>
            </div>` : '';
        })()}
      </div>

      ${(b.result || []).length ? `
        <div class="card">
          <div class="name">Итоги боя</div>
          <div class="table-wrap mt">
            <table class="gold-table arena-res-table">
              <thead>
                <tr><th>Боец</th><th class="num">Урон</th><th class="num">Защита</th>
                    <th class="num">Лечение</th><th class="num">Убийств</th>
                    <th class="num">Рейтинг</th><th class="num">Очки</th></tr>
              </thead>
              <tbody>
                ${b.result.map((x) => `
                  <tr class="${x.won ? 'arena-res-win' : ''}${x.id === me.id ? ' arena-row-me' : ''}">
                    <td>
                      ${x.isBot ? '🤖' : App._flagImg(x.flag)} <b>${UI.esc(x.name)}</b>
                      <span class="muted small">${UI.esc(x.roleLabel)}</span>
                      ${x.bestFighter ? '<span class="gb-best" title="Лучший боец">⚔</span>' : ''}
                      ${x.bestGuard ? '<span class="gb-best" title="Лучший защитник">🛡</span>' : ''}
                      ${x.bestMedic ? '<span class="gb-best" title="Лучший медик">💉</span>' : ''}
                    </td>
                    <td class="num">${UI.fmtNum(x.damage)}</td>
                    <td class="num">${UI.fmtNum(x.absorbed)}</td>
                    <td class="num">${UI.fmtNum(x.healed)}</td>
                    <td class="num">${x.kills}</td>
                    <td class="num ${x.ratingGained >= 0 ? 'gold' : 'arena-res-minus'}">
                      ${x.isBot ? '—' : (x.ratingGained >= 0 ? '+' : '−') + Math.abs(x.ratingGained)}
                    </td>
                    <td class="num gold">${x.isBot ? '—' : '+' + UI.fmtNum(x.tokens)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <p class="muted small mt">⚔ лучший урон, 🛡 больше всех защитил, 💉 больше всех вылечил —
          за каждое звание 3 очка рейтинга.</p>
        </div>` : ''}

      <button class="btn btn-orange mt" id="gb-back" style="width:100%">← К групповым боям</button>`;
    const bk = document.getElementById('gb-back');
    if (bk) bk.onclick = () => { App._gbWatch = ''; App.renderGroup(); };
    return;
  }

  const rowOf = (f, enemy) => `
    <div class="gb-row${f.alive ? '' : ' gb-dead'}${f.isMe ? ' gb-me' : ''}${me.targetId === f.id ? ' gb-target' : ''}">
      <span class="gb-role-icon" title="${UI.esc(f.roleLabel)}">${f.roleIcon}</span>
      <span class="grow">
        <span class="gb-row-name">${f.isBot ? '🤖' : App._flagImg(f.flag)} ${UI.esc(f.name)}${f.isMe ? ' <span class="muted small">(вы)</span>' : ''}
          <span class="rt-badge" title="Рейтинг">${UI.fmtNum(f.rating || 0)}</span>
          ${f.guarded ? '<span class="gb-guarded" title="Прикрыт">🛡</span>' : ''}</span>
        <span class="gb-hp"><i style="width:${pct(f.hp, f.maxHp)}%"></i></span>
      </span>
      <span class="small muted gb-hp-num">${UI.fmtNum(f.hp)}</span>
      ${f.alive ? `
        <span class="gb-acts">
          ${enemy ? `<button class="btn btn-inline gb-act" data-act="attack" data-id="${f.id}"
                       ${me.cooldownLeftMs > 0 || me.ammo < 1 ? 'disabled' : ''}>⚔</button>` : ''}
          ${!enemy && b.canHeal && !f.isMe ? `<button class="btn btn-inline gb-act" data-act="heal" data-id="${f.id}"
                       ${me.cooldownLeftMs > 0 || me.energy < 120 ? 'disabled' : ''}>💉</button>` : ''}
          ${!enemy && b.canGuard && !f.isMe ? `<button class="btn btn-inline gb-act" data-act="guard" data-id="${f.id}"
                       ${me.cooldownLeftMs > 0 || me.energy < 80 ? 'disabled' : ''}>🛡</button>` : ''}
        </span>` : '<span class="small muted">выбыл</span>'}
    </div>`;

  box.innerHTML = `
    <div class="card gb-fight">
      <div class="gb-fight-head">
        <span>🤝 Групповой бой</span>
        <span class="muted small">${b.state === 'waiting' ? 'ждём остальных' : 'идёт'}</span>
      </div>

      ${(b.entered === false && me.alive) ? `
        <div class="gb-enter-now">
          <div class="gb-enter-title">⚠ Вы ещё не вступили в бой!</div>
          <div class="small">Вас уже могут атаковать. Осталось
            <b id="gb-enter-left">${b.enterLeftSec}</b> с</div>
          <button class="btn btn-orange mt" id="gb-enter-fight" style="width:100%">В БОЙ</button>
        </div>` : ''}

      ${!me.alive ? `
        <div class="gb-dead-panel">
          <div class="gb-dead-title">☠ Вы выведены из боя</div>
          ${b.killedBy ? `<div class="small">Вас добил: <b>${UI.esc(b.killedBy)}</b></div>` : ''}
          <div class="muted small mt">Бой продолжается — можно следить за союзниками.</div>
          ${(b.watchable || []).length ? `
            <div class="gb-watch mt">
              ${b.watchable.map((w) => `
                <button class="btn btn-inline gb-watch-btn${(App._gbWatch || '') === w.id || (!App._gbWatch && w.isMe) ? ' active' : ''}${w.alive ? '' : ' dead'}"
                        data-watch="${w.id}">
                  ${UI.esc(w.name)}${w.isMe ? ' (вы)' : ''}
                  <span class="muted small">${Math.round(w.hp / w.maxHp * 100)}%</span>
                </button>`).join('')}
            </div>` : ''}
        </div>` : ''}

      ${b.watching ? `
        <div class="gb-watching">
          👁 Смотрите бой глазами: <b>${UI.esc(b.watching.name)}</b>
          <span class="muted small">${UI.esc(b.watching.roleLabel)} ·
          ${UI.fmtNum(b.watching.hp)}/${UI.fmtNum(b.watching.maxHp)} HP ·
          урон ${UI.fmtNum(b.watching.damageDealt)}</span>
        </div>` : ''}

      <div class="arena-log" id="gb-log">
        ${(b.log || []).map((l) => `<div class="gb-log-${UI.esc(l.kind)}">${UI.esc(l.text)}</div>`).join('')
          || '<div class="muted">Бой начинается…</div>'}
      </div>

      <div class="gb-self">
        <div class="gb-self-top">
          <b>${me.roleIcon} ${UI.esc(me.name)}</b>
          <span class="muted small">${UI.esc(me.roleLabel)} · команда ${me.team + 1}</span>
        </div>
        <div class="gb-bars">
          <div class="gb-bar">
            <span class="gb-bar-l">❤ HP</span>
            <span class="gb-bar-t"><i class="gb-bar-hp" style="width:${pct(me.hp, me.maxHp)}%"></i></span>
            <span class="gb-bar-n">${UI.fmtNum(me.hp)}/${UI.fmtNum(me.maxHp)}</span>
          </div>
          <div class="gb-bar">
            <span class="gb-bar-l">⚡ Энергия</span>
            <span class="gb-bar-t"><i class="gb-bar-en" style="width:${pct(me.energy, me.maxEnergy)}%"></i></span>
            <span class="gb-bar-n">${UI.fmtNum(me.energy)}/${UI.fmtNum(me.maxEnergy)}</span>
          </div>
          <div class="gb-bar">
            <span class="gb-bar-l">🎯 Боеприпасы</span>
            <span class="gb-bar-t"><i class="gb-bar-am" style="width:${pct(me.ammo, me.maxAmmo)}%"></i></span>
            <span class="gb-bar-n">${me.ammo}/${me.maxAmmo}</span>
          </div>
        </div>
        ${me.cooldownLeftMs > 0
          ? `<div class="gb-cd">Перезарядка ${(me.cooldownLeftMs / 1000).toFixed(1)} с</div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="name">🔴 Противники</div>
      <div class="mt">${b.enemies.map((f) => rowOf(f, true)).join('')}</div>
    </div>

    <div class="card">
      <div class="name">🟢 Ваша команда</div>
      <div class="mt">${b.allies.map((f) => rowOf(f, false)).join('')}</div>
    </div>

    <button class="btn btn-red mt" id="gb-leave" style="width:100%">🚪 Покинуть бой</button>
    <p class="muted small center">Засчитается поражение, награды не начислят.</p>`;

  const enterNow = document.getElementById('gb-enter-fight');
  if (enterNow) enterNow.onclick = async () => {
    enterNow.disabled = true;
    try { await API.post('/api/group/enter', {}); App._resetSign('gbBattle'); App.renderGroupBattle(); }
    catch (e) { UI.toast('⛔ ' + e.message); enterNow.disabled = false; }
  };

  box.querySelectorAll('[data-watch]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.watch;
      App._gbWatch = (App._gbWatch === id) ? '' : id;
      App.renderGroupBattle();
    };
  });

  const gbLeave = document.getElementById('gb-leave');
  if (gbLeave) gbLeave.onclick = async () => {
    const go = await UI.confirm(
      'Покинуть бой?<br><span class="muted small">Засчитается поражение, награды не начислят.</span>',
      { title: 'Выйти из боя', icon: '🚪', html: true, okText: 'Выйти', cancelText: 'Остаться' });
    if (!go) return;
    try { await API.post('/api/group/leave', {}); await App.refreshMe(); App.renderGroup(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };

  box.querySelectorAll('.gb-act').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await API.post('/api/group/act', { action: btn.dataset.act, targetId: btn.dataset.id });
        App.renderGroupBattle();
      } catch (e) { UI.toast('⛔ ' + e.message); App.renderGroupBattle(); }
    };
  });

  // Раз в 5 секунд — как и на арене
  App._gbTimer = setInterval(() => {
    if (document.hidden) return;
    if ((App._warTab || '') !== 'group') { clearInterval(App._gbTimer); return; }
    App.renderGroupBattle();
  }, 5000);
};

// ═══ УЛУЧШЕНИЯ: отдельная страница ══════════════════════════════════
// Раньше раздел раскрывался прямо в витрине и мигал при каждом её
// обновлении, повторяя запрос к серверу. Теперь это самостоятельная
// страница со своей кнопкой «Назад».
App.renderUpgradesPage = async () => {
  clearInterval(App._gbTimer);
  const box = document.getElementById('gb-box');
  if (!box) return;
  box.dataset.mode = 'upgrades';
  box.innerHTML = '<div class="loading">Загружаю улучшения…</div>';

  let up = null;
  try { up = await API.get('/api/group/upgrades'); }
  catch (e) {
    box.innerHTML = `
      <button class="btn mt" id="gb-back-page" style="width:100%">← Назад к групповым боям</button>
      <div class="card mt"><p style="color:var(--red)">${UI.esc(e.message)}</p>
        <button class="btn btn-inline mt" id="gb-up-retry">Повторить</button></div>`;
    const b1 = document.getElementById('gb-back-page');
    if (b1) b1.onclick = () => { App._gbPage = null; App.renderGroup(); };
    const r = document.getElementById('gb-up-retry');
    if (r) r.onclick = () => App.renderUpgradesPage();
    return;
  }

  const cost = (c) => c ? `
    <span class="gb-cost">
      ${up.currencyIcon} ${UI.fmtNum(c.amount)}
      <span class="gb-cost-sep">·</span> <span class="ic-ear"></span> ${c.ears}
      <span class="gb-cost-sep">·</span> <span class="ic-token"></span> ${c.tokens}
    </span>` : '';

  box.innerHTML = `
    <button class="btn" id="gb-back-page" style="width:100%">← Назад к групповым боям</button>

    <div class="card mt">
      <div class="title" style="margin:0">🔧 Улучшения</div>
      <p class="muted small mt">Навыки прокачиваются по ступеням: на каждом ранге свои десять
      уровней. Следующая ступень откроется, только когда предыдущая выкачана до конца.</p>
      <p class="muted small">Платите ${up.currencyIcon} <b>боевыми очками</b> (их дают за бои),
      <span class="ic-ear"></span> ушами и <span class="ic-token"></span> жетонами милосердия.</p>
      <div class="gb-wallet mt">
        <span title="${UI.esc(up.currencyName)}">${up.currencyIcon} ${UI.fmtNum(up.wallet.points)}</span>
        <span title="Уши"><span class="ic-ear"></span> ${UI.fmtNum(up.wallet.ears)}</span>
        <span title="Жетоны милосердия"><span class="ic-token"></span> ${UI.fmtNum(up.wallet.tokens)}</span>
      </div>
    </div>

    ${up.tierSkills.map((t) => `
      <div class="card tier-card${t.unlocked ? '' : ' locked'}" style="--tier:${t.color}">
        <div class="tier-head">
          <span class="tier-dot"></span>
          <span class="grow">
            <b class="tier-name">${UI.esc(t.name)}</b>
            <span class="muted small">уровни ${t.from}–${t.to} · от ${UI.fmtNum(t.need)} очков</span>
          </span>
          <span class="small ${t.unlocked ? 'gold' : 'muted'}">
            ${t.unlocked ? 'открыто' : '🔒 ещё ' + UI.fmtNum(t.left)}
          </span>
        </div>
        <div class="gb-skills mt">
          ${t.skills.map((sk) => `
            <div class="gb-skill${sk.atMaxTier ? ' maxed' : ''}">
              <div class="gb-skill-top">
                <span class="gb-skill-icon">${sk.icon}</span>
                <span class="grow">
                  <b class="tier-name">${UI.esc(sk.name)}</b>
                  <span class="muted small">${UI.esc(sk.desc)}</span>
                </span>
                <span class="gb-skill-lvl tier-name">${sk.inTier}<span class="muted">/${sk.tierMax}</span></span>
              </div>
              <div class="gb-skill-bar"><i style="width:${sk.inTier / sk.tierMax * 100}%;background:${t.color}"></i></div>
              <div class="gb-skill-now">
                Сейчас: <b class="tier-name">${sk.kind === 'flat' ? '+' + sk.value : '+' + sk.value + '%'}</b>
                ${sk.isCurrent && !sk.atMaxTier
                  ? `<span class="muted small">· уровень +${sk.kind === 'flat' ? sk.step : sk.step + '%'}</span>` : ''}
              </div>
              ${sk.atMaxTier
                ? '<div class="gb-skill-max">Ступень пройдена</div>'
                : (sk.isCurrent
                  ? `<div class="gb-skill-buy">
                       ${sk.nextCost ? `<span class="gb-cost">
                         ${up.currencyIcon} ${UI.fmtNum(sk.nextCost.amount)}
                         <span class="gb-cost-sep">·</span> <span class="ic-ear"></span> ${sk.nextCost.ears}
                         <span class="gb-cost-sep">·</span> <span class="ic-token"></span> ${sk.nextCost.tokens}
                       </span>` : ''}
                       <button class="btn btn-inline gb-up" data-skill="${sk.id}"
                               ${sk.canUpgrade ? '' : 'disabled'}>
                         ${sk.blockedByRank ? '🔒 ранг' : 'Улучшить'}
                       </button>
                     </div>`
                  : '<div class="muted small">Сначала пройдите предыдущую ступень</div>')}
            </div>`).join('')}
        </div>
      </div>`).join('')}

    <div class="card">
      <div class="name">Ваши характеристики в бою</div>
      <div class="gb-stats-grid mt">
        <span>❤ ${UI.fmtNum(up.stats.hp)} HP</span>
        <span>⚡ ${UI.fmtNum(up.stats.energy)}</span>
        <span>🎯 ${up.stats.ammo}</span>
        <span>💥 крит ${Math.round(up.stats.critChance * 100)}% (×${up.critMin}–×${up.critMax})</span>
        <span>💨 уворот ${Math.round(up.stats.dodgeChance * 100)}%</span>
        <span>🛡 −${Math.round(up.stats.damageReduce * 1000) / 10}% урона</span>
        <span>💚 крит-лечение ${Math.round(up.stats.healCritChance * 100)}%</span>
        <span>🪙 награда +${Math.round(up.stats.rewardBonus * 100)}%</span>
      </div>
    </div>

    <button class="btn mt" id="gb-back-page2" style="width:100%">← Назад к групповым боям</button>`;

  const back = () => { App._gbPage = null; App._resetSign('gbLobby'); App.renderGroup(); };
  const b1 = document.getElementById('gb-back-page');
  if (b1) b1.onclick = back;
  const b2 = document.getElementById('gb-back-page2');
  if (b2) b2.onclick = back;

  box.querySelectorAll('.gb-up').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await API.post('/api/group/upgrade', { skill: btn.dataset.skill });
        await App.refreshMe();
        App.renderUpgradesPage();
      } catch (e) { UI.toast('⛔ ' + e.message); btn.disabled = false; }
    };
  });
};

