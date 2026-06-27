// ===================================================================
// public/js/screens/war.js — экраны «Война» и «Миссии»
// Война: 10 целей (игроки ±10 уровней + 2–3 бота-террориста 💀),
// панель результата боя и окно фаталити. Миссии: карточки операций
// с этапами по 3 шага и кнопкой «Выполнить шаг».
// ===================================================================

// ---------- ВОЙНА ----------
App.screens.war = async (c) => {
  await App.refreshMe();
  const m = App.me;

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
        <p class="center muted small">${UI.esc(b.targetName)} (ур. ${b.targetLevel})${b.isBot ? ' 💀' : ''} · здоровье врага: ${b.targetHpPct}%</p>
        ${marks ? `<p class="center small mt">${marks}</p>` : ''}
        <hr class="hr">
        <div class="kv"><span class="k">Нанесено</span><span class="v dmg-deal">${b.dealt} урона</span></div>
        <div class="kv"><span class="k">Получено</span><span class="v dmg-take">${b.received} урона</span></div>
        <div class="kv"><span class="k">Награблено</span><span class="v money">$ ${UI.fmtNum(b.loot)}</span></div>
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
        ${!m.pendingFatality ? `<button class="btn btn-orange mt" id="atk-again">Атаковать снова</button>` : ''}
      </div>`;
  }

  // Окно фаталити: враг повержен, решаем его судьбу
  const fatalityHtml = m.pendingFatality ? `
    <div class="card fatality-card">
      <div class="result-title" style="color:var(--red)">💀 ФАТАЛИТИ</div>
      <p class="center">Враг <b>${UI.esc(m.pendingFatality.name)}</b> повержен в пыль и полностью в вашей власти. Решайте быстро — окно закроется через 3 минуты!</p>
      <div class="btn-row mt">
        <button class="btn btn-red" id="fat-ear">✂️ Отрезать ухо</button>
        <button class="btn btn-green" id="fat-mercy">🎖 Отпустить</button>
      </div>
      <p class="muted small mt center">Ухо — трофей жестокости, жетон — знак милосердия. Оба ресурса пригодятся альянсу в будущем.</p>
    </div>` : '';

  const warTab = App._warTab || 'targets';

  c.innerHTML = `
    <div class="title">Война</div>
    ${fatalityHtml}
    ${resultHtml}
    <div class="tabs">
      <div class="tab ${warTab === 'targets' ? 'active' : ''}" data-wartab="targets">🎯 Цели</div>
      <div class="tab ${warTab === 'sanctions' ? 'active' : ''}" data-wartab="sanctions">💰 Санкции</div>
    </div>
    ${warTab === 'targets' ? `
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

  // Кнопки результата и фаталити
  if (b && !m.pendingFatality) {
    const again = document.getElementById('atk-again');
    if (again) again.onclick = () => attackTarget(b.targetId);
  }
  if (m.pendingFatality) {
    document.getElementById('fat-ear').onclick = () => doFatality('ear');
    document.getElementById('fat-mercy').onclick = () => doFatality('mercy');
  }
  const refreshBtn = document.getElementById('war-refresh');
  if (refreshBtn) refreshBtn.onclick = () => { App._lastBattle = null; App.rerender(); };

  // Выполнить атаку и перерисовать экран с результатом
  async function attackTarget(targetId) {
    try {
      App._lastBattle = await API.post('/api/war/attack', { targetId });
      await App.refreshMe();
      App.rerender();
      // Прокручиваем наверх к окну боя, чтобы игрок видел результат атаки
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  async function doFatality(choice) {
    try {
      const res = await API.post('/api/war/fatality', { choice });
      App._lastBattle = null;
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
          <span class="name" style="cursor:pointer" onclick="App.go('profile/${o.id}')">${o.flag} ${UI.esc(o.name)}</span>
          <span class="muted small"> Ур. ${o.level}</span>
          ${o.allianceMembers > 0 ? `<span class="muted small"> · 🤝 ${o.allianceMembers}</span>` : ''}
          ${o.online ? '<span class="small" style="color:var(--green)"> ●</span>' : ''}
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
            <span class="name" style="cursor:pointer" onclick="App.go('profile/${s.targetId}')">${s.flag} ${UI.esc(s.targetName)}</span>
            <span class="muted small"> Ур. ${s.level} · HP ${s.hpPct}%</span>
            <div class="small" style="color:var(--money)">💰 Награда: $${UI.fmtNum(s.bounty)}${s.orderCount > 1 ? ` (${s.orderCount} заказов)` : ''}</div>
            ${s.myOrder > 0 ? `<div class="muted small">ваш вклад: $${UI.fmtNum(s.myOrder)}</div>` : ''}
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
        ${a.canBoost ? `<button class="btn mt" id="m-boost" data-pid="${a.id}">⚡ Ускорить за <span class="ic-gold"></span> ${data.boostGoldCost}</button>` : ''}
      </div>`;
  }

  c.innerHTML = `
    <div class="title">Военные конфликты</div>
    ${activeBlock}
    <div class="card"><p class="muted small">10 конфликтов в мире. У каждого 7-10 спецопераций по 3 шага. Шаги требуют времени и условий. Награда: 7-10 очков навыков и 30-500 золота за первое полное прохождение конфликта.</p></div>
    ${data.conflicts.map((cf) => `
      <div class="card" ${cf.locked ? 'style="opacity:.6"' : 'style="cursor:pointer"'} ${!cf.locked ? `onclick="App.go('missions/${cf.id}')"` : ''}>
        <div class="name">${UI.esc(cf.name)}${cf.completed > 0 ? ` <span class="badge green">пройден ×${cf.completed}</span>` : ''}${cf.rewardAvailable && !cf.locked ? ' <span class="badge">⭐ ' + cf.spReward + ' + 🪙 ' + cf.goldReward + '</span>' : ''}</div>
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
             <div class="kv mt"><span class="k">⚡ Энергия</span><span class="v">${nextStep.energy}</span></div>
             <div class="kv"><span class="k">⏱ Время</span><span class="v">${nextStep.timeMin} мин</span></div>
             <div class="kv"><span class="k">Награда</span><span class="v">${nextStep.xp} опыта, $${UI.fmtMoney(nextStep.money)}</span></div>
             <div class="kv"><span class="k">Требования</span><span class="v small">мощь ${UI.fmtNum(nextStep.require.power)}, ур. ${nextStep.require.level}</span></div>
             <button class="btn btn-orange mt" data-start="${op.idx}-${nextStep.idx}" ${conf.activeStep || conf.locked ? 'disabled' : ''}>Начать шаг</button>
             ${conf.activeStep ? '<p class="muted small center mt">Сначала завершите текущий активный шаг</p>' : ''}`}
      </div>`;
    }).join('')}`;

  // Кнопки запуска шагов
  c.querySelectorAll('[data-start]').forEach((btn) => {
    btn.onclick = async () => {
      const [opIdx, stepIdx] = btn.dataset.start.split('-').map(Number);
      try {
        await API.post('/api/missions/start', { confId, opIdx, stepIdx });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
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
