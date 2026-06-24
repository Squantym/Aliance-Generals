// ===================================================================
// public/js/screens/war.js — экраны «Война» и «Мissions»
// Война: 10 целей (игроки ±10 уровней + 2–3 бота-террориста 💀),
// панель результата боя и окно фаталити. Миссии: карточки операций
// с этапами по 3 шага и кнопкой «Выполнить шаг».
// ===================================================================

const SANCTIONS_LEVEL = 50;

// ---------- ВОЙНА ----------
// Два таба: «Цели» (обычные противники ±10 уровней) и «Санкции»
// (контракты с 50 уровня; атака из вкладки «Санкции» даёт награду).
App.screens.war = async (c, param) => {
  const tab = param || 'targets';
  if (tab === 'sanctions') return renderSanctions(c);
  return renderWarTargets(c);
};

async function renderWarTargets(c) {
  await App.refreshMe();
  const m = App.me;
  const canSanctions = (m.level || 1) >= SANCTIONS_LEVEL;

  const tabsHtml = `
    <div class="tabs">
      <div class="tab active" onclick="location.hash='#war'">🎯 Цели</div>
      ${canSanctions
        ? `<div class="tab" onclick="location.hash='#war/sanctions'">📜 Санкции</div>`
        : `<div class="tab muted" title="С ${SANCTIONS_LEVEL} уровня">🔒 Санкции</div>`}
    </div>`;

  // Панель результата последнего боя (если только что дрались)
  let resultHtml = '';
  const b = App._lastBattle;
  if (b) {
    const marks = [
      b.crit ? '💥 Критический удар!' : '',
      b.dodge ? '🌀 Враг увернулся' : '',
      b.sanctionPayout && b.sanctionPayout.totalPayout > 0 ? `💰 Контракт: +$${UI.fmtNum(b.sanctionPayout.totalPayout)}` : '',
    ].filter(Boolean).join(' · ');
    resultHtml = `
      <div class="card" id="war-result-card">
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
          <p class="muted small">${b.myArmy.map((x) => `${UI.esc(x.name)} ×${UI.fmtNum(x.count)}`).join(' · ')}</p>` : ''}
        ${(b.enemyArmy && b.enemyArmy.length) ? `
          <p class="small mt"><b>Техника врага:</b></p>
          <p class="muted small">${b.enemyArmy.map((x) => `${UI.esc(x.name)} ×${UI.fmtNum(x.count)}`).join(' · ')}</p>` : ''}
        ${b.myLosses.length ? `<p class="small mt">⚠️ Ваши потери: <span class="dmg-take">${UI.esc(b.myLosses.join(', '))}</span></p>` : '<p class="small mt muted">Без потерь техники с вашей стороны</p>'}
        ${b.enemyLosses.length ? `<p class="small mt">💥 Потери врага: <span class="dmg-deal">${UI.esc(b.enemyLosses.join(', '))}</span></p>` : ''}
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

  c.innerHTML = `
    <div class="title">Война</div>
    ${tabsHtml}
    ${fatalityHtml}
    ${resultHtml}
    <div class="card">
      <p class="muted small">Цели подобраны в диапазоне ±10 уровней. 💀 — боты-террористы. Каждая атака тратит 1 боеприпас 🎯.</p>
      <button class="btn mt" id="war-refresh">🔄 Обновить список целей</button>
    </div>
    <div class="card" id="war-list"><div class="loading">Разведка ищет цели…</div></div>`;

  // Кнопки результата и фаталити
  if (b && !m.pendingFatality) {
    const again = document.getElementById('atk-again');
    if (again) again.onclick = () => attackTarget(b.targetId, false);
  }
  if (m.pendingFatality) {
    document.getElementById('fat-ear').onclick = () => doFatality('ear');
    document.getElementById('fat-mercy').onclick = () => doFatality('mercy');
  }
  document.getElementById('war-refresh').onclick = () => { App._lastBattle = null; App.rerender(); };

  async function attackTarget(targetId, isSanctionAttack) {
    try {
      App._lastBattle = await API.post('/api/war/attack', { targetId, isSanctionAttack: !!isSanctionAttack });
      await App.refreshMe();
      App.rerender();
      requestAnimationFrame(() => {
        const result = document.querySelector('.result-title');
        if (result) result.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  async function doFatality(choice) {
    try {
      await API.post('/api/war/fatality', { choice });
      App._lastBattle = null;
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  // Загружаем список целей
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
    btn.onclick = () => attackTarget(btn.dataset.target, false);
  });
}

// ---------- ВКЛАДКА «САНКЦИИ» (с 50 уровня) ----------
async function renderSanctions(c) {
  await App.refreshMe();
  const m = App.me;

  if ((m.level || 1) < SANCTIONS_LEVEL) {
    c.innerHTML = `
      <div class="title">Война</div>
      <div class="tabs">
        <div class="tab" onclick="location.hash='#war'">🎯 Цели</div>
        <div class="tab active">📜 Санкции</div>
      </div>
      <div class="card center">
        <p class="name">🔒 Раздел закрыт</p>
        <p class="muted small mt">Санкции доступны с <b>${SANCTIONS_LEVEL} уровня</b>. У вас: ${m.level}.</p>
      </div>`;
    return;
  }

  const data = await API.get('/api/sanctions');

  const tabsHtml = `
    <div class="tabs">
      <div class="tab" onclick="location.hash='#war'">🎯 Цели</div>
      <div class="tab active" onclick="location.hash='#war/sanctions'">📜 Санкции</div>
    </div>`;

  const r = data.rules || {};
  let resultHtml = '';
  const b = App._lastSanctionBattle || App._lastBattle;
  if (b && App._lastSanctionBattle) {
    resultHtml = `
      <div class="card" id="sanction-result-card">
        <div class="result-title ${b.win ? 'win' : 'lose'}">${b.win ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}</div>
        <p class="center muted small">${UI.esc(b.targetName)} · HP: ${b.targetHpPct}%</p>
        ${b.sanctionPayout && b.sanctionPayout.totalPayout > 0
          ? `<p class="center money mt"><b>💰 Контракт выполнен: +$${UI.fmtMoney(b.sanctionPayout.totalPayout)}</b></p>`
          : ''}
        <div class="kv mt"><span class="k">Нанесено</span><span class="v dmg-deal">${b.dealt} урона</span></div>
        <div class="kv"><span class="k">Награблено</span><span class="v money">$ ${UI.fmtNum(b.loot)}</span></div>
      </div>`;
  }

  const onMeHtml = data.onMe ? `
    <div class="card" style="border:2px solid var(--red);background:rgba(255,80,80,.08)">
      <div class="name" style="color:var(--red)">⚠️ На ВАС открыты контракты!</div>
      <p class="small mt">Активных контрактов: <b>${data.onMe.count}</b> на общую сумму <b class="money">$${UI.fmtMoney(data.onMe.totalReward)}</b>.
      Любой игрок, добивший вас во вкладке «Санкции», получит эту сумму.</p>
    </div>` : '';

  const myContractsHtml = (data.myAsSponsor && data.myAsSponsor.length) ? `
    <div class="card">
      <div class="name">💼 Мои контракты как заказчика</div>
      ${data.myAsSponsor.map(ct => {
        const left = Math.max(0, Math.ceil((ct.expiresAt - Date.now()) / 1000));
        return `
        <div class="list-row">
          <div class="grow">
            <span class="name">${UI.esc(ct.targetFlag||'')} ${UI.esc(ct.targetName)}</span>
            <span class="muted small"> · награда <b class="money">$${UI.fmtMoney(ct.reward)}</b> · ${UI.fmtTimer(left)} до возврата</span>
          </div>
          <button class="btn btn-red btn-inline" data-cancel="${ct.targetId}">Отменить</button>
        </div>`;
      }).join('')}
    </div>` : '';

  const targetsHtml = (data.targets && data.targets.length) ? data.targets.map(t => `
    <div class="card">
      <div class="list-row" style="border:none;padding:0">
        <div class="grow">
          <span class="name" style="cursor:pointer" onclick="App.go('profile/${t.targetId}')">${UI.esc(t.targetFlag||'')} ${UI.esc(t.targetName)}</span>
          <span class="muted small"> Ур. ${t.targetLevel}${t.targetAlliance ? ' · 🤝 ' + UI.esc(t.targetAlliance) : ''}</span>
          <div class="small mt">HP цели: <b style="color:${t.targetHpPct<=10?'var(--red)':'var(--text)'}">${t.targetHpPct}%</b>
            ${t.myContract ? ' · <span class="gold">(ваш контракт)</span>' : ''}</div>
        </div>
        <div style="text-align:right">
          <div class="money" style="font-size:18px">$${UI.fmtMoney(t.totalReward)}</div>
          <div class="muted small">${t.contractsCount} контракт(ов)</div>
        </div>
      </div>
      ${t.canHunt ? `<button class="btn btn-orange mt" data-hunt="${t.targetId}" style="width:100%">🎯 Атаковать (санкции)</button>` : ''}
    </div>
  `).join('') : `<div class="card center muted">Активных санкций нет. Откройте профиль игрока и нажмите «Объявить санкции».</div>`;

  c.innerHTML = `
    <div class="title">Война</div>
    ${tabsHtml}
    ${resultHtml}
    <div class="card">
      <p class="muted small">Объявить санкции можно с <b>${SANCTIONS_LEVEL} ур.</b> через профиль игрока.
      Награда выплачивается только при атаке <b>из этой вкладки</b> — атака во «Войне» даёт обычный грабёж.
      Цель нужно <b>добить</b> (довести HP до лазарета).
      Минимум: <b>$${UI.fmtNum(r.minReward||100000)}</b>. Срок: <b>${r.ttlDays||7} сут.</b></p>
    </div>
    ${onMeHtml}
    ${myContractsHtml}
    ${targetsHtml}`;

  async function huntTarget(targetId) {
    try {
      App._lastSanctionBattle = await API.post('/api/war/attack', { targetId, isSanctionAttack: true });
      App._lastBattle = null;
      await App.refreshMe();
      App.rerender();
      requestAnimationFrame(() => {
        const card = document.getElementById('sanction-result-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }

  c.querySelectorAll('[data-hunt]').forEach(btn => {
    btn.onclick = () => huntTarget(btn.dataset.hunt);
  });
  c.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Отменить контракт? Деньги вернутся в полном объёме.')) return;
      try { await API.post('/api/sanctions/cancel', { targetId: btn.dataset.cancel }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
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
