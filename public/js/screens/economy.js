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
App.screens.production = async (c) => {
  await App.refreshMe();
  const p = await API.get('/api/production');

  if (!p.unlocked) {
    c.innerHTML = `
      <div class="title">Производство</div>
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
