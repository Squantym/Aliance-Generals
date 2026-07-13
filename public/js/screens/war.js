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
      b.dodge ? '🌀 Враг увернулся' : '',
    ].filter(Boolean).join(' · ');
    resultHtml = `
      <div class="card">
        <div class="result-title ${b.win ? 'win' : 'lose'}">${b.win ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}</div>
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
        ${(b.enemyArmy && b.enemyArmy.length) ? `
          <p class="small mt"><b>Техника врага:</b></p>
          ${UI.battleImgRow(b.enemyArmy, 'units')}` : ''}
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

  const warTab = App._warTab || 'targets';

  // Окно «встречи». Мина срабатывает ДО боя — прячет результат, пока игрок
  // не разберётся с проводом. Сейф выпадает ПОСЛЕ боя — показываем его ВМЕСТЕ
  // с результатом боя и окном фаталити (бой уже прошёл).
  const enc = App._warEncounter;
  const preCombat = enc && enc.type === 'mine_defuse'; // только мина прячет итог боя
  const encounterHtml = enc
    ? (enc.type === 'bank_hack' ? bankHackCardHtml(enc) : mineDefuseCardHtml(enc))
    : '';

  c.innerHTML = `
    <div class="title">Война</div>
    ${eventBanner}
    ${encounterHtml}
    ${!preCombat ? fatalityHtml : ''}
    ${!preCombat ? resultHtml : ''}
    <div class="tabs">
      <div class="tab ${warTab === 'targets' ? 'active' : ''}" data-wartab="targets">🎯 Цели</div>
      <div class="tab ${warTab === 'sanctions' ? 'active' : ''}" data-wartab="sanctions">💰 Санкции</div>
      <div class="tab ${warTab === 'event' ? 'active' : ''}" data-wartab="event">🐉 Событие</div>
    </div>
    ${warTab === 'event' ? `
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
        <p class="muted small">🎯 <b>Санкции</b> — заказы на игроков. Любой может объявить санкцию на любого через его профиль, заморозив награду. Кто снизит HP цели до ≤5% в бою — забирает всю награду. Несколько заказов на одну цель суммируются.</p>
      </div>
      <div class="card" id="sanctions-list"><div class="loading">Загрузка списка санкций…</div></div>
    `}`;

  // Переключение вкладок войны
  c.querySelectorAll('[data-wartab]').forEach((t) => {
    t.onclick = () => { App._warTab = t.dataset.wartab; App.rerender(); };
  });

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
      App.rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      if (r.bankHack) {
        const bh = r.bankHack;
        if (bh.alarmed) UI.toast(`🚨 Код ${bh.code} верный, но сработала сигнализация — взлом сорван!`);
        else if (bh.stolen > 0) UI.toast(`🔓 Сейф взломан! Похищено 🪙 из банка: $${UI.fmtNum(bh.stolen)}`);
        else if (bh.outOfTries) UI.toast(`⛔ Попытки закончились. Код сейфа был: ${bh.code}`);
      }
      App._warEncounter = null;
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
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
        const lostSabText = Object.entries(r.lostSaboteurs || {}).map(([k, v]) => `${k} ×${v}`).join(', ');
        await UI.confirm(
          `Провод оказался с сюрпризом — взрыв!\n\nЗдоровье снесено полностью. Уничтожено ${r.techLossPct}% техники, участвовавшей в бою: ${lostTechText}.` +
          (lostSabText ? `\n\nПогибло диверсантов: ${lostSabText}.` : ''),
          { title: '💥 ВЗРЫВ', icon: '💥', okText: 'Понятно', cancelText: '' }
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
          <span class="name" style="cursor:pointer" onclick="App.go('profile/${o.id}')">${App._flagImg(o.flag)} ${UI.esc(o.name)}</span>
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
      list.innerHTML = sanctions.map((s) => `
        <div class="list-row">
          <div class="grow">
            <span class="name" style="cursor:pointer" onclick="App.go('profile/${s.targetId}')">${App._flagImg(s.flag)} ${UI.esc(s.targetName)}</span>
            <span class="muted small"> Ур. ${s.level} · HP ${s.hpPct}%</span>
            <div class="small" style="color:var(--money)">💰 Награда: <span class="ic-dollar"></span>${UI.fmtNum(s.bounty)}${s.orderCount > 1 ? ` (${s.orderCount} заказов)` : ''}</div>
            ${s.myOrder > 0 ? `<div class="muted small">ваш вклад: <span class="ic-dollar"></span>${UI.fmtNum(s.myOrder)}</div>` : ''}
          </div>
          <button class="btn btn-red btn-inline" data-sanction-target="${s.targetId}">⚔ Охота</button>
        </div>`).join('');

      list.querySelectorAll('[data-sanction-target]').forEach((btn) => {
        btn.onclick = () => attackTarget(btn.dataset.sanctionTarget);
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
      <div class="card fatality-card">
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
      <div class="card" ${cf.locked ? 'style="opacity:.6"' : 'style="cursor:pointer"'} ${!cf.locked ? `onclick="App.go('missions/${cf.id}')"` : ''}>
        <div class="name">${UI.esc(cf.name)}${cf.completed > 0 ? ` <span class="badge green">пройден ×${cf.completed}</span>` : ''}${cf.rewardAvailable && !cf.locked ? ' <span class="badge">⭐ ' + cf.spReward + ' + <span class="ic-gold"></span> ' + cf.goldReward + '</span>' : ''}</div>
        ${cf.locked
          ? `<p class="muted small mt">🔒 Откроется на ${cf.minLevel} уровне</p>`
          : `<div class="mt">${UI.bar(cf.opsDone, cf.opsTotal, 'gold', `Спецопераций: ${cf.opsDone} / ${cf.opsTotal}`)}</div>
             <p class="muted small mt">${cf.rewardAvailable ? 'Награда за первое прохождение ещё не получена.' : 'Награда уже получена. Можно проходить повторно для опыта.'}</p>`}
      </div>`).join('')}`;

  const boostBtn = document.getElementById('m-boost');
  if (boostBtn) {
    boostBtn.onclick = async () => {
      try { await API.post('/api/missions/boost', { processId: boostBtn.dataset.pid }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
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
      <div class="card fatality-card">
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
      <div class="card" ${fullyDone ? 'style="opacity:.7"' : ''}>
        <div class="name">${fullyDone ? '✅ ' : ''}${UI.esc(op.name)} <span class="muted">${stepDots(doneSteps)}</span></div>
        ${fullyDone
          ? '<p class="muted small mt">Спецоперация завершена</p>'
          : `<div class="muted small mt">Следующий шаг: <b>${UI.esc(nextStep.name)}</b></div>
             <div class="kv mt"><span class="k"><span class="ic-energy"></span> Энергия</span><span class="v">${nextStep.energy}</span></div>
             <div class="kv"><span class="k">⏱ Время</span><span class="v">${nextStep.timeMin} мин</span></div>
             <div class="kv"><span class="k">Награда</span><span class="v">${nextStep.xp} опыта, <span class="ic-dollar"></span>${UI.fmtMoney(nextStep.money)}</span></div>
             <div class="kv"><span class="k">Требования</span><span class="v small">мощь ${UI.fmtNum(nextStep.require.power)}, ур. ${nextStep.require.level}${nextStep.require.units ? `, ${nextStep.require.units.count} ед. техники ур. ${nextStep.require.units.minLevel}+` : ''}</span></div>
             <button class="btn btn-orange mt" data-start="${op.idx}-${nextStep.idx}" ${conf.activeStep || conf.locked ? 'disabled' : ''}>Начать шаг</button>
             ${conf.activeStep ? '<p class="muted small center mt">Сначала завершите текущий активный шаг</p>' : ''}`}
      </div>`;
    }).join('')}`;

  // Кнопки запуска шагов
  c.querySelectorAll('[data-start]').forEach((btn) => {
    btn.onclick = async () => {
      const [opIdx, stepIdx] = btn.dataset.start.split('-').map(Number);
      const runStep = async () => {
        await API.post('/api/missions/start', { confId, opIdx, stepIdx });
        await App.refreshMe();
        App.rerender();
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
      try { await API.post('/api/missions/boost', { processId: boostBtn.dataset.pid }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  if (conf.activeStep) {
}
}
