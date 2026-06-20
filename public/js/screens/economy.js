// ===================================================================
// public/js/screens/economy.js — экраны «Техника», «Постройки»,
// «Производство». Сортировка: самая близкая к разблокировке наверху,
// дальше — уже доступные от новой к старой. Поддерживается акционное
// окошко и перечёркивание старой цены.
// ===================================================================

// Сортировка списка по логике игрока:
//   1) Следующая открывающаяся (минимальный unlock среди заблокированных) — наверху
//   2) Уже разблокированные — от высокого unlock к низкому (новые сверху)
//   3) Остальные заблокированные — по возрастанию unlock (далёкие перспективы внизу)
function sortByProgress(items) {
  const unlocked = items.filter((x) => !x.locked).sort((a, b) => b.unlock - a.unlock);
  const locked   = items.filter((x) =>  x.locked).sort((a, b) => a.unlock - b.unlock);
  const next     = locked.shift();          // самая близкая к разблокировке — одна
  const out = [];
  if (next) out.push({ ...next, isNext: true });
  return out.concat(unlocked).concat(locked);
}

// ---------- ТЕХНИКА ----------
App.screens.units = async (c, param) => {
  await App.refreshMe();
  const data = await API.get('/api/units');
  const tab = param || 'ground';

  const tabs = [
    ['ground', '🚜 Наземная'],
    ['air', '✈ Воздушная'],
    ['sea', '🚢 Морская'],
  ];

  const items = sortByProgress(data.items.filter((x) => x.type === tab));

  c.innerHTML = `
    <div class="title">Техника</div>
    ${UI.saleBanner(data.discount)}
    <div class="tabs">${tabs.map(([id, label]) =>
      `<div class="tab ${id === tab ? 'active' : ''}" onclick="location.hash='#units/${id}'">${label}</div>`).join('')}
    </div>
    <div class="card"><p class="muted small">
      ${tab === 'ground' ? 'Наземные войска — баланс атаки и защиты, опора любой армии.' : ''}
      ${tab === 'air' ? 'Авиация — высокая атака, слабая защита. Бей первым!' : ''}
      ${tab === 'sea' ? 'Флот — высокая защита, скромная атака. Крепость на воде.' : ''}
      Содержание всей техники: <b style="color:var(--red)">$ ${UI.fmtMoney(data.upkeepPerHour)}/час</b>.</p>
    </div>
    ${items.map((x) => `
      <div class="card" ${x.locked ? 'style="opacity:.6"' : ''}>
        <div class="name">
          ${x.isNext ? '⏳ ' : ''}${UI.esc(x.name)}
          ${x.isNext ? '<span class="badge">скоро</span>' : ''}
          <span class="muted">(всего: ${UI.fmtNum(x.owned)})</span>
        </div>
        ${(x.ownedMk && (x.ownedMk[1] > 0 || x.ownedMk[2] > 0)) ? `
          <div class="muted small mt">
            Mk0: <b>${UI.fmtNum(x.ownedMk[0])}</b>
            ${x.ownedMk[1] > 0 ? ` · Mk1: <b>${UI.fmtNum(x.ownedMk[1])}</b>` : ''}
            ${x.ownedMk[2] > 0 ? ` · Mk2: <b>${UI.fmtNum(x.ownedMk[2])}</b>` : ''}
          </div>` : ''}
        <div class="kv mt"><span class="k">база: атака <b>${UI.fmtNum(x.baseAttack)}</b> · защита <b>${UI.fmtNum(x.baseDefense)}</b></span>
          <span class="k">содержание: <b style="color:var(--red)">$ ${UI.fmtMoney(x.upkeep)}</b>/ч</span></div>
        <div class="kv"><span class="k">стоимость</span><span class="v">${UI.priceWithSale(x.basePrice, x.price, '$')}</span></div>
        ${x.locked
          ? `<p class="center muted mt">🔒 Откроется на ${x.unlock} уровне</p>`
          : `<div class="field-row mt">
              <input type="number" class="qty" value="1" min="1" id="qty-${x.id}">
              <button class="btn btn-orange" data-buy="${x.id}">Купить</button>
              <button class="btn" data-sell="${x.id}" ${x.owned ? '' : 'disabled'}>Продать ½</button>
            </div>`}
      </div>`).join('')}`;

  const qtyOf = (id) => document.getElementById('qty-' + id).value;
  c.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/units/buy', { unitId: btn.dataset.buy, qty: qtyOf(btn.dataset.buy) });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-sell]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const r = await API.post('/api/units/sell', { unitId: btn.dataset.sell, qty: qtyOf(btn.dataset.sell) });
        UI.toast(`Продано. Возврат: $${UI.fmtNum(r.refund)}`);
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
};

// ---------- ПОСТРОЙКИ ----------
App.screens.buildings = async (c, param) => {
  await App.refreshMe();
  const data = await API.get('/api/buildings');
  const tab = param || 'income';
  const rawList = tab === 'income' ? data.income : data.defense;
  const list = sortByProgress(rawList);
  const t = data.totals;

  c.innerHTML = `
    <div class="title">Постройки</div>
    ${UI.saleBanner(data.discount)}
    <div class="card">
      <div class="kv"><span class="k">Общий доход</span><span class="v money">$ ${UI.fmtMoney(t.incomePerHour)} /час</span></div>
      <div class="kv"><span class="k">Содержание техники</span><span class="v" style="color:var(--red)">$ ${UI.fmtMoney(t.upkeepPerHour)} /час</span></div>
      <div class="kv"><span class="k">Очки защиты базы</span><span class="v">${UI.fmtNum(t.defensePoints)}</span></div>
      <div class="kv"><span class="k">Следующая выплата через</span><span class="v">${UI.fmtTimer(t.nextPayoutSec)}</span></div>
    </div>
    <div class="tabs">
      <div class="tab ${tab === 'income' ? 'active' : ''}" onclick="location.hash='#buildings/income'">💵 Доходные</div>
      <div class="tab ${tab === 'defense' ? 'active' : ''}" onclick="location.hash='#buildings/defense'">🛡 Оборонительные</div>
    </div>
    ${list.map((x) => `
      <div class="card" ${x.locked ? 'style="opacity:.6"' : ''}>
        <div class="name">
          ${x.isNext ? '⏳ ' : ''}${UI.esc(x.name)}
          ${x.isNext ? '<span class="badge">скоро</span>' : ''}
          <span class="muted">(${UI.fmtNum(x.owned)})</span>
        </div>
        <div class="kv mt">
          ${x.kind === 'income'
            ? `<span class="k">Доход: <b class="money">$ ${UI.fmtMoney(x.income)}</b>/час за штуку</span>`
            : `<span class="k">Защита: <b>+${UI.fmtNum(x.def)}</b> очков за штуку</span>`}
          <span class="k">Цена: ${UI.priceWithSale(x.baseNextPrice, x.nextPrice, '$')}</span>
        </div>
        ${x.locked
          ? `<p class="center muted mt">🔒 Откроется на ${x.unlock} уровне</p>`
          : `<div class="field-row mt">
              <input type="number" class="qty" value="1" min="1" id="bq-${x.id}">
              <button class="btn btn-orange" data-build="${x.id}">Построить</button>
            </div>
            <p class="muted small mt">Цена каждой следующей копии немного выше — стройматериалы дорожают.</p>`}
      </div>`).join('')}`;

  c.querySelectorAll('[data-build]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/buildings/build', {
          buildingId: btn.dataset.build,
          qty: document.getElementById('bq-' + btn.dataset.build).value,
        });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
};

// ---------- ПРОИЗВОДСТВО ----------
App.screens.production = async (c, param) => {
  await App.refreshMe();
  const tab = param || 'workshops';

  const tabsHtml = `
    <div class="tabs">
      <div class="tab ${tab === 'workshops' ? 'active' : ''}" onclick="location.hash='#production/workshops'">🏭 Цехи</div>
      <div class="tab ${tab === 'mines' ? 'active' : ''}" onclick="location.hash='#production/mines'">⛏ Шахты</div>
      <div class="tab ${tab === 'silos' ? 'active' : ''}" onclick="location.hash='#production/silos'">🚀 Ракетные шахты</div>
    </div>`;

  if (tab === 'mines') return App._renderMines(c, tabsHtml);
  if (tab === 'silos') return App._renderSilos(c, tabsHtml);

  const p = await API.get('/api/production');

  if (!p.unlocked) {
    c.innerHTML = `
      <div class="title">Производство</div>
      ${tabsHtml}
      <div class="card center">
        <p style="font-size:40px">🏭🔒</p>
        <p class="mt">Военные заводы доверяют только опытным командирам.</p>
        <p class="gold mt">Раздел откроется на ${p.unlockLevel} уровне (сейчас: ${p.level}).</p>
      </div>`;
    return;
  }

  // Объединяем баннеры акций (на цехи и на модернизацию)
  const banner =
    (p.discountWorkshop ? UI.saleBanner(p.discountWorkshop) : '') +
    (p.discountModernize ? UI.saleBanner(p.discountModernize) : '');

  // ---------- Блок: общая информация о цехах ----------
  const workshopsBlock = `
    <div class="card">
      <div class="kv"><span class="k">🏭 Цехов построено</span><span class="v">${p.workshops}</span></div>
      <div class="kv"><span class="k">Свободных слотов</span><span class="v ${p.slotsFree > 0 ? 'gold' : ''}">${p.slotsFree} / ${p.workshops}</span></div>
      <p class="muted small mt">Один цех = одна линия. За партию — до ${p.maxBatch} единиц. Время: Mk1 — <b>${p.minutesPerUnitMk1} мин/ед.</b>, Mk2 — <b>${p.minutesPerUnitMk2} мин/ед.</b>. Можно ускорить за <span class="ic-gold"></span> ${p.boostGoldCost}.</p>
      <button class="btn btn-orange mt" id="ws-buy">Построить цех за ${UI.priceWithSale(p.baseNextWorkshopGold, p.nextWorkshopGold, '<span class="ic-gold"></span>', UI.fmtNum)}</button>
      <p class="muted small center mt">Каждый следующий цех вдвое дороже предыдущего</p>
    </div>`;

  // ---------- Блок: слоты цехов (все, занятые и свободные) ----------
  // Каждый цех — отдельная карточка-слот. Занятый показывает прогресс,
  // свободный — приглашение нажать «Запустить модернизацию» ниже.
  let slotsBlock = '';
  if (p.workshops > 0) {
    const occupied = p.queue.map((q) => ({ ...q, occupied: true }));
    const freeCount = p.workshops - occupied.length;
    const slots = occupied.concat(
      Array.from({ length: freeCount }, (_, i) => ({ occupied: false, slotIdx: occupied.length + i + 1 }))
    );
    slotsBlock = `
      <div class="title" style="font-size:14px">Слоты цехов (${p.workshops})</div>
      ${slots.map((s, idx) => {
        if (s.occupied) {
          const totalSec = s.qty * (s.toMk === 1 ? p.minutesPerUnitMk1 : p.minutesPerUnitMk2) * 60;
          return `
            <div class="card">
              <div class="name">🏭 Слот ${idx + 1}: ⏳ ${UI.esc(s.unitName)} → <span class="gold">Mk${s.toMk}</span></div>
              <div class="muted small mt">Партия: ${UI.fmtNum(s.qty)} ед.</div>
              <div class="mt">${UI.bar(
                totalSec - s.secondsLeft,
                totalSec,
                'gold',
                s.secondsLeft > 0 ? 'Осталось: ' + UI.fmtTimer(s.secondsLeft) : 'Готово, обработается при следующем обновлении'
              )}</div>
              ${s.canBoost ? `<button class="btn mt" data-boost="${s.id}">⚡ Ускорить за <span class="ic-gold"></span> ${s.boostCost}</button>` : ''}
            </div>`;
        } else {
          return `
            <div class="card" style="opacity:.7">
              <div class="name">🏭 Слот ${s.slotIdx}: <span class="gold">свободен</span></div>
              <p class="muted small mt">Готов принять партию техники. Выберите ниже что и сколько модернизировать.</p>
            </div>`;
        }
      }).join('')}
    `;
  }

  // ---------- Блок: запуск новой модернизации ----------
  let startBlock = '';
  if (p.candidates.length === 0) {
    // Возможные причины: совсем нет техники, или вся уже на Mk2
    startBlock = `
      <div class="card center muted">
        <p>Модернизировать нечего: либо у вас нет техники, либо вся уже на Mk2 (максимум).</p>
        <p class="small mt">Купите новую технику в разделе «Техника» — она появится здесь как Mk0 и её можно будет прокачать через цеха.</p>
      </div>`;
  } else if (p.slotsFree <= 0) {
    startBlock = `<div class="card center muted">Все цехи заняты. Дождитесь окончания работ или постройте ещё цех.</div>`;
  } else {
    startBlock = `
      <div class="title" style="font-size:14px">Запустить модернизацию (свободно слотов: ${p.slotsFree})</div>
      ${p.candidates.map((cand, i) => {
        const id = `mod-${cand.unitId}-${cand.fromMk}`;
        const maxQty = Math.min(cand.available, p.maxBatch);
        return `
        <div class="card">
          <div class="name">${UI.esc(cand.name)} <span class="badge">Mk${cand.fromMk} → Mk${cand.toMk}</span></div>
          <div class="muted small">${UI.esc(cand.type)} · в наличии: <b>${UI.fmtNum(cand.available)}</b>${cand.available > p.maxBatch ? ` (за партию — макс. ${p.maxBatch})` : ''}</div>
          <div class="kv mt"><span class="k">Бонус сейчас → после</span><span class="v">+${cand.bonusBefore}% → +${cand.bonusAfter}%</span></div>
          <div class="kv"><span class="k">Цена за единицу</span><span class="v">${UI.priceWithSale(cand.basePricePerUnit, cand.pricePerUnit, '$')}</span></div>
          <label>Количество (1–${maxQty}):</label>
          <div class="field-row">
            <input type="number" class="qty" id="${id}" value="${maxQty}" min="1" max="${maxQty}" style="width:90px">
            <button class="btn btn-orange" data-start="${cand.unitId}" data-frommk="${cand.fromMk}" data-input="${id}">🏭 Запустить</button>
          </div>
          <p class="muted small mt">Время партии: ~${maxQty * cand.minutesPerUnit} мин при максимуме (${cand.minutesPerUnit} мин × ${maxQty})</p>
        </div>`;
      }).join('')}`;
  }

  c.innerHTML = `
    <div class="title">Производство</div>
    ${tabsHtml}
    ${banner}
    ${workshopsBlock}
    ${slotsBlock}
    ${startBlock}`;

  // Покупка цеха
  document.getElementById('ws-buy').onclick = async () => {
    try { await API.post('/api/production/workshop'); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  // Запуск партии модернизации
  c.querySelectorAll('[data-start]').forEach((btn) => {
    btn.onclick = async () => {
      const qty = document.getElementById(btn.dataset.input).value;
      try {
        await API.post('/api/production/start', {
          unitId: btn.dataset.start,
          fromMk: u.toIntSafe(btn.dataset.frommk, 0),
          qty,
        });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  // Ускорение процесса
  c.querySelectorAll('[data-boost]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Ускорить за ${p.boostGoldCost} золота?`)) return;
      try {
        await API.post('/api/production/boost', { processId: btn.dataset.boost });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  // Автообновление экрана каждые 10 секунд, пока есть активные процессы
  if (p.queue.length > 0) {
    const timer = setInterval(() => App.rerender(), 10000);
    App._tear = () => clearInterval(timer);
  }
};

// ---------- ШАХТЫ (вкладка внутри Производства) ----------
App._renderMines = async (c, tabsHtml) => {
  const m = await API.get('/api/mines');

  if (App.me.level < m.unlockLevel) {
    c.innerHTML = `
      <div class="title">Производство</div>
      ${tabsHtml}
      <div class="card center">
        <p style="font-size:40px">⛏🔒</p>
        <p class="mt">Шахты доверяют только опытным командирам.</p>
        <p class="gold mt">Раздел откроется на ${m.unlockLevel} уровне (сейчас: ${App.me.level}).</p>
      </div>`;
    return;
  }

  const statusLabel = (s) => ({
    building: '🏗 Строится', idle: '⛏ Готова к спуску', descending: '⬇ Шахтёры внизу',
    extracting: '🪙 Золото добывается', collapsed: '💥 Обрушена',
  }[s] || s);

  const mineCard = (mine) => {
    let body = '';
    if (mine.status === 'building') {
      body = `<p class="muted small mt">Строительство завершится через ${UI.fmtTimer(mine.buildRemainingSec)}</p>`;
    } else if (mine.status === 'collapsed') {
      const ready = mine.rebuildReadyAt <= Date.now();
      body = ready
        ? `<p class="small mt" style="color:var(--money)">Участок расчищен — можно строить новую шахту.</p>`
        : `<p class="muted small mt">Восстановление участка: ${UI.fmtTimer(Math.max(0, Math.ceil((mine.rebuildReadyAt - Date.now()) / 1000)))}</p>`;
    } else if (mine.status === 'descending') {
      body = `
        <p class="muted small mt">Шахтёры вернутся через ${UI.fmtTimer(mine.descent.remainingSec)} (спуск на ${mine.descent.minutes} мин.)</p>
        ${mine.descent.terroristAttack && !mine.descent.terroristResolved ? `
          <div class="low-hp-banner" style="margin-top:8px;border-radius:4px" data-fight="${mine.id}">
            ⚠️ Нападение террористов на шахтёров! Реагируйте за ${UI.fmtTimer(mine.descent.terroristRemainingSec)} — нажмите чтобы устранить угрозу.
          </div>` : ''}`;
    } else if (mine.status === 'extracting') {
      const ready = mine.goldReady.remainingSec <= 0;
      body = ready
        ? `<button class="btn btn-orange mt" data-collect="${mine.id}">🪙 Забрать золото: +${mine.goldReady.amount}</button>`
        : `<p class="muted small mt">Золото будет готово через ${UI.fmtTimer(mine.goldReady.remainingSec)} (+${mine.goldReady.amount} 🪙)</p>`;
    } else if (mine.status === 'idle') {
      const opts = m.minutesOptions
        .filter((min) => min <= mine.minutesLeftToday)
        .map((min) => `<option value="${min}">${min} мин.</option>`).join('');
      body = mine.minutesLeftToday > 0 ? `
        <div class="field-row mt">
          <select id="desc-min-${mine.id}">${opts}</select>
          <button class="btn btn-orange btn-inline" data-descend="${mine.id}">Спуститься</button>
        </div>
        <p class="muted small mt">Доступно сегодня: ${mine.minutesLeftToday} мин. из ${90}</p>` :
        `<p class="muted small mt" style="color:var(--red)">Дневной лимит спуска исчерпан (90 мин). Возвращайтесь завтра.</p>`;
    }

    return `
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div class="grow">
            <div class="name">⛏ Шахта <span class="muted small">№${mine.id.slice(0, 4)}</span></div>
            <div class="muted small">${statusLabel(mine.status)} · Золото: ${mine.goldLeft} / ${mine.goldTotal}</div>
          </div>
        </div>
        ${body}
      </div>`;
  };

  c.innerHTML = `
    <div class="title">Производство</div>
    ${tabsHtml}
    <div class="card">
      <p class="muted small">Шахта при постройке получает случайный запас золота (20-50). Спуск шахтёров — от 10 до 90 минут, не более 90 мин. в сутки на шахту. Есть шанс не найти золото, а есть риск нападения террористов — нужно успеть среагировать за 10 минут.</p>
    </div>
    ${m.mines.length === 0 ? '<div class="card center muted">У вас пока нет шахт.</div>' : ''}
    ${m.mines.map(mineCard).join('')}
    <div class="card center">
      <button class="btn btn-orange" id="mine-build">⛏ Построить шахту: <span class="ic-gold"></span> ${UI.fmtNum(m.nextMineCostGold)} + $${UI.fmtNum(m.nextMineDollars)}</button>
    </div>`;

  document.getElementById('mine-build').onclick = async () => {
    try {
      await API.post('/api/mines/build');
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-descend]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.descend;
      const minutes = document.getElementById('desc-min-' + id).value;
      try {
        await API.post('/api/mines/descend', { mineId: id, minutes });
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-fight]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/mines/fight', { mineId: btn.dataset.fight });
        UI.toast('⚔ Угроза устранена!');
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-collect]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const r = await API.post('/api/mines/collect', { mineId: btn.dataset.collect });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  // Автообновление, пока есть активные процессы (спуск, добыча, постройка)
  const hasActive = m.mines.some((x) => ['building', 'descending', 'extracting'].includes(x.status));
  if (hasActive) {
    const timer = setInterval(() => App.rerender(), 10000);
    App._tear = () => clearInterval(timer);
  }
};

// ---------- РАКЕТНЫЕ ШАХТЫ (вкладка внутри Производства) ----------
App._renderSilos = async (c, tabsHtml) => {
  const s = await API.get('/api/silos');

  if (App.me.level < s.unlockLevel) {
    c.innerHTML = `
      <div class="title">Производство</div>
      ${tabsHtml}
      <div class="card center">
        <p style="font-size:40px">🚀🔒</p>
        <p class="mt">Ракетные шахты доверяют только опытным командирам.</p>
        <p class="gold mt">Раздел откроется на ${s.unlockLevel} уровне (сейчас: ${App.me.level}).</p>
      </div>`;
    return;
  }

  const siloCard = (silo) => {
    let body = '';
    if (silo.building) {
      body = `
        <p class="muted small mt">Готовность ракеты через ${UI.fmtTimer(silo.buildRemainingSec)}</p>
        <button class="btn btn-orange btn-inline mt" data-boost="${silo.id}">⚡ Ускорить за <span class="ic-gold"></span> ${UI.fmtNum(silo.boostCostGold)}</button>`;
    } else {
      body = `
        <div class="mt">
          <p class="small">🔋 Готовность: ${silo.readyEnergy} / ${silo.readyNeeded} энергии</p>
          ${UI.bar(silo.readyEnergy, silo.readyNeeded, 'en')}
        </div>
        <div class="mt">
          <p class="small">💪 Мощность: ${silo.powerAmmo} / ${silo.powerNeeded} боеприпасов (урон: ${UI.fmtNum(silo.estimatedDamage)})</p>
          ${UI.bar(silo.powerAmmo, silo.powerNeeded, 'am')}
        </div>
        <div class="field-row mt">
          <input type="number" id="fuel-en-${silo.id}" placeholder="Энергия" min="1" style="width:90px">
          <button class="btn btn-inline" data-fuel-ready="${silo.id}">Залить энергию</button>
        </div>
        <div class="field-row mt">
          <input type="number" id="fuel-am-${silo.id}" placeholder="Боеприпасы" min="1" style="width:90px">
          <button class="btn btn-inline" data-fuel-power="${silo.id}">Залить боеприпасы</button>
        </div>
        ${silo.canLaunch
          ? `<button class="btn btn-red mt" data-launch="${silo.id}" style="width:100%">🚀 Запустить ракету по цели</button>`
          : `<p class="muted small mt center">Заполните шкалу готовности до 100% для запуска</p>`}`;
    }
    return `
      <div class="card">
        <div class="name">🚀 Ракетная шахта <span class="muted small">№${silo.id.slice(0, 4)}</span></div>
        ${body}
      </div>`;
  };

  c.innerHTML = `
    <div class="title">Производство</div>
    ${tabsHtml}
    <div class="card">
      <p class="muted small">Ракета заправляется энергией (готовность, нужно 3000) и боеприпасами (мощность, нужно 1000). Запуск возможен только при полной готовности — урон зависит от текущей мощности (макс. 3000 урона). Ракета разрушает постройки и технику цели.</p>
    </div>
    ${s.silos.length === 0 ? '<div class="card center muted">У вас пока нет ракетных шахт.</div>' : ''}
    ${s.silos.map(siloCard).join('')}
    <div class="card center">
      <button class="btn btn-orange" id="silo-build">🚀 Построить ракетную шахту: <span class="ic-gold"></span> ${UI.fmtNum(s.nextSiloCostGold)}</button>
    </div>`;

  document.getElementById('silo-build').onclick = async () => {
    try {
      await API.post('/api/silos/build');
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-boost]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/silos/boost', { siloId: btn.dataset.boost });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-fuel-ready]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.fuelReady;
      const amount = document.getElementById('fuel-en-' + id).value;
      try {
        await API.post('/api/silos/fuel-ready', { siloId: id, amount });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-fuel-power]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.fuelPower;
      const amount = document.getElementById('fuel-am-' + id).value;
      try {
        await API.post('/api/silos/fuel-power', { siloId: id, amount });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-launch]').forEach((btn) => {
    btn.onclick = async () => {
      const targetName = prompt('Введите позывной цели для ракетного удара:');
      if (!targetName) return;
      try {
        // Находим ID цели по имени через поиск в админке-подобный публичный поиск
        const found = await API.get('/api/find-player?name=' + encodeURIComponent(targetName));
        if (!found.userId) { UI.toast('⛔ Игрок не найден'); return; }
        if (!confirm(`Запустить ракету по «${targetName}»? Это нанесёт урон постройкам и технике цели.`)) return;
        const r = await API.post('/api/silos/launch', { siloId: btn.dataset.launch, targetId: found.userId });
        UI.toast(`🚀 Удар нанесён! Урон: ${r.damage}`);
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  const hasActive = s.silos.some((x) => x.building);
  if (hasActive) {
    const timer = setInterval(() => App.rerender(), 10000);
    App._tear = () => clearInterval(timer);
  }
};
