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
      Содержание всей техники: <b style="color:var(--red)"><span class="ic-dollar"></span> ${UI.fmtMoney(data.upkeepPerHour)}/час</b>.</p>
    </div>
    ${items.map((x) => `
      <div class="card" ${x.locked ? 'style="opacity:.6"' : ''} style="overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:center;height:120px;background:radial-gradient(circle at center, rgba(255,150,0,.08), transparent 70%);border-radius:10px;margin-bottom:8px">
          <img src="img/units/${String(x.id).replace(/[^a-z0-9_]/gi,'')}.webp" loading="lazy"
            style="max-height:110px;max-width:90%;object-fit:contain"
            onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
          <span style="display:none;font-size:48px">🚜</span>
        </div>
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
          <span class="k">содержание: <b style="color:var(--red)"><span class="ic-dollar"></span> ${UI.fmtMoney(x.upkeep)}</b>/ч</span></div>
        <div class="kv"><span class="k">стоимость</span><span class="v">${UI.priceWithSale(x.basePrice, x.price, '<span class="ic-dollar"></span>')}</span></div>
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
      <div class="kv"><span class="k">Общий доход</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtMoney(t.incomePerHour)} /час</span></div>
      <div class="kv"><span class="k">Содержание техники</span><span class="v" style="color:var(--red)"><span class="ic-dollar"></span> ${UI.fmtMoney(t.upkeepPerHour)} /час</span></div>
      <div class="kv"><span class="k">Очки защиты базы</span><span class="v">${UI.fmtNum(t.defensePoints)}</span></div>
      <div class="kv"><span class="k">Следующая выплата через</span><span class="v">${UI.fmtTimer(t.nextPayoutSec)}</span></div>
    </div>
    <div class="tabs">
      <div class="tab ${tab === 'income' ? 'active' : ''}" onclick="location.hash='#buildings/income'">💵 Доходные</div>
      <div class="tab ${tab === 'defense' ? 'active' : ''}" onclick="location.hash='#buildings/defense'">🛡 Оборонительные</div>
    </div>
    ${list.map((x) => `
      <div class="card" ${x.locked ? 'style="opacity:.6"' : ''} style="overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:center;height:110px;background:radial-gradient(circle at center, rgba(255,150,0,.08), transparent 70%);border-radius:10px;margin-bottom:8px">
          <img src="img/buildings/${String(x.id).replace(/[^a-z0-9_]/gi,'')}.webp" loading="lazy"
            style="max-height:100px;max-width:90%;object-fit:contain"
            onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
          <span style="display:none;font-size:44px">${tab === 'income' ? '🏭' : '🛡'}</span>
        </div>
        <div class="name">
          ${x.isNext ? '⏳ ' : ''}${UI.esc(x.name)}
          ${x.isNext ? '<span class="badge">скоро</span>' : ''}
          <span class="muted">(${UI.fmtNum(x.owned)})</span>
        </div>
        <div class="kv mt">
          ${x.kind === 'income'
            ? `<span class="k">Доход: <b class="money"><span class="ic-dollar"></span> ${UI.fmtMoney(x.income)}</b>/час за штуку</span>`
            : `<span class="k">Защита: <b>+${UI.fmtNum(x.def)}</b> очков за штуку</span>`}
          <span class="k">Цена: ${UI.priceWithSale(x.baseNextPrice, x.nextPrice, '<span class="ic-dollar"></span>')}</span>
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
      <div class="tab ${tab === 'lasers' ? 'active' : ''}" onclick="location.hash='#production/lasers'">🔦 Лазеры</div>
    </div>`;

  if (tab === 'mines') return App._renderMines(c, tabsHtml);
  if (tab === 'silos') return App._renderSilos(c, tabsHtml);
  if (tab === 'lasers') return App._renderLasers(c, tabsHtml);

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
          <div class="kv"><span class="k">Цена за единицу</span><span class="v">${UI.priceWithSale(cand.basePricePerUnit, cand.pricePerUnit, '<span class="ic-dollar"></span>')}</span></div>
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
      if (!await UI.confirm(`Ускорить за ${p.boostGoldCost} золота?`, {title:'Ускорение', icon:'⚡', okText:'Ускорить'})) return;
      try {
        await API.post('/api/production/boost', { processId: btn.dataset.boost });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  // Автообновление экрана каждые 10 секунд, пока есть активные процессы
  if (p.queue.length > 0) {
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
    empty: '📍 Участок (пусто)', building: '🏗 Шахта строится', idle: '⛏ Готова к спуску',
    descending: '⬇ Шахтёры внизу', collapsed: '💥 Обрушена',
  }[s] || s);

  // Маленькое окно с результатом прошлого спуска
  const resultBox = (mine) => {
    const r = mine.result;
    if (!r) return '';
    let inner;
    if (r.ruined) {
      inner = `<p style="color:var(--red)"><b>💥 Спуск сорван террористами.</b></p>
        <p class="muted small">Золото и деньги за этот спуск потеряны.</p>`;
    } else {
      const goldLine = r.found
        ? (r.extracted
          ? `<p style="color:var(--gold)"><b>🪙 Найдено ${r.foundGold} золота — добыто! +${r.goldGained}</b></p>`
          : `<p style="color:var(--orange)">🪙 Найдено ${r.foundGold} золота, но добыть не удалось (шанс был ${r.extractChancePct}%).</p>`)
        : `<p class="muted">Золото в этот раз не нашли.</p>`;
      inner = `${goldLine}
        <p style="color:var(--money)"><span class="ic-dollar"></span> Деньги: +${UI.fmtNum(r.money)}${r.goldGained <= 0 ? ' <span class="muted small">(повышенные)</span>' : ''}</p>
        ${!r.found || !r.extracted ? `<p class="muted small">Шанс добычи на этом времени: ${r.extractChancePct}%.</p>` : ''}`;
    }
    return `<div class="card" style="border-color:var(--gold);margin-top:8px">
      <div style="font-weight:bold;margin-bottom:4px">📋 Итог спуска (${r.minutes} мин.)</div>
      ${inner}
      ${r.collapsed ? '<p class="small mt" style="color:var(--red)">Шахта исчерпана и обрушилась.</p>' : ''}
      <button class="btn btn-inline mt" data-dismiss="${mine.id}" style="width:100%">Закрыть</button>
    </div>`;
  };

  const mineCard = (mine) => {
    let body = '';
    if (mine.status === 'empty') {
      body = `<p class="muted small mt">Участок готов. Постройте на нём шахту за деньги (стройка 3 суток).</p>
        <button class="btn btn-orange mt" data-build="${mine.id}" style="width:100%">🏗 Построить шахту: <span class="ic-dollar"></span> ${UI.fmtNum(m.buildDollars)}</button>`;
    } else if (mine.status === 'building') {
      body = `<p class="muted small mt">Шахта строится — готовность через ${UI.fmtTimer(mine.buildRemainingSec)}. Запас золота откроется после постройки.</p>`;
    } else if (mine.status === 'collapsed') {
      body = mine.canRebuild
        ? `<p class="small mt" style="color:var(--money)">✅ Участок расчищен.</p>
           <button class="btn btn-orange mt" data-rebuild="${mine.id}" style="width:100%">🔨 Перестроить шахту: <span class="ic-dollar"></span> ${UI.fmtNum(m.buildDollars)}</button>`
        : `<p class="muted small mt">💥 Обрушена. Расчистка завершится через ${UI.fmtTimer(mine.collapsedRemainingSec)}, затем можно перестроить шахту за деньги.</p>`;
    } else if (mine.status === 'descending') {
      const d = mine.descent;
      const terror = d.terror;
      body = `<p class="muted small mt">${d.timeUp ? 'Время спуска вышло.' : 'Шахтёры вернутся через ' + UI.fmtTimer(d.remainingSec)} (спуск ${d.minutes} мин.)</p>`;
      if (terror && terror.active) {
        body += `<div class="low-hp-banner" style="margin-top:8px;border-radius:6px;padding:10px">
          ⚠️ <b>Нападение террористов!</b> Отбейте атаку за ${UI.fmtTimer(terror.remainingSec)}, иначе спуск и золото пропадут.
          <button class="btn btn-red mt" data-fight="${mine.id}" style="width:100%">⚔ Отразить атаку</button>
        </div>`;
      }
    } else if (mine.status === 'idle') {
      const opts = m.minutesOptions
        .filter((min) => min <= mine.minutesLeftToday)
        .map((min) => `<option value="${min}">${min} мин.</option>`).join('');
      body = `<p class="muted small mt">Спусков осталось: <b>${mine.descentsLeft}/${mine.maxDescents}</b> · Сегодня доступно: <b>${mine.minutesLeftToday}</b> из ${mine.dailyLimit} мин.</p>`;
      if (mine.minutesLeftToday > 0 && mine.descentsLeft > 0) {
        body += `<div class="field-row mt">
          <select id="desc-min-${mine.id}">${opts}</select>
          <button class="btn btn-orange btn-inline" data-descend="${mine.id}">Спуститься</button>
        </div>`;
      } else if (mine.descentsLeft <= 0) {
        body += `<p class="muted small mt" style="color:var(--red)">Спуски закончились — шахта скоро обрушится.</p>`;
      } else {
        body += `<p class="muted small mt" style="color:var(--red)">Дневной лимит этой шахты исчерпан (90 мин). Сброс в 00:00 МСК.</p>`;
      }
    }

    const goldInfo = (mine.goldLeft !== null)
      ? `Золото: ${mine.goldLeft} / ${mine.goldTotal}`
      : (mine.status === 'building' ? 'Запас скрыт' : 'Участок');

    return `
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div class="grow">
            <div class="name">⛏ Шахта <span class="muted small">№${mine.id.slice(0, 4)}</span></div>
            <div class="muted small">${statusLabel(mine.status)} · ${goldInfo}</div>
          </div>
        </div>
        ${body}
        ${resultBox(mine)}
      </div>`;
  };

  const canBuyPlot = m.plotCount < m.maxPlots;
  c.innerHTML = `
    <div class="title">Производство</div>
    ${tabsHtml}
    <div class="card">
      <p class="muted small">Сначала купите <b>участок</b> за золото, затем постройте на нём <b>шахту</b> за деньги (3 суток). В шахте 200–300 <span class="ic-gold"></span> и 30 спусков. Спуск 10–90 мин (не более 90 мин/сутки на каждую шахту). Золото не гарантировано (два броска: найти и добыть), но деньги дают всегда. С шансом 50% нападают террористы — отбивайте атаку в бою, иначе спуск сгорит.</p>
    </div>
    ${m.mines.length === 0 ? '<div class="card center muted">У вас пока нет участков. Купите первый ниже.</div>' : ''}
    ${m.mines.map(mineCard).join('')}
    <div class="card center">
      <p class="muted small">Участков: ${m.plotCount} / ${m.maxPlots}</p>
      ${canBuyPlot
        ? `<button class="btn btn-orange" id="buy-plot">📍 Купить участок: <span class="ic-gold"></span> ${UI.fmtNum(m.nextPlotGold)}</button>`
        : '<p class="muted small">Достигнут максимум участков.</p>'}
    </div>`;

  const btn = document.getElementById('buy-plot');
  if (btn) btn.onclick = async () => {
    try { await API.post('/api/mines/buy-plot'); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  const doPost = (sel, url, body) => c.querySelectorAll(sel).forEach((b) => b.onclick = async () => {
    try {
      const payload = body ? body(b) : { mineId: b.dataset[Object.keys(b.dataset)[0]] };
      const r = await API.post(url, payload);
      if (r && r.notices && r.notices[0]) UI.toast(r.notices[0]);
      await App.refreshMe(); App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  });
  doPost('[data-build]', '/api/mines/build', (b) => ({ mineId: b.dataset.build }));
  doPost('[data-rebuild]', '/api/mines/rebuild', (b) => ({ mineId: b.dataset.rebuild }));
  doPost('[data-fight]', '/api/mines/fight', (b) => ({ mineId: b.dataset.fight }));
  doPost('[data-dismiss]', '/api/mines/dismiss', (b) => ({ mineId: b.dataset.dismiss }));
  c.querySelectorAll('[data-descend]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.descend;
    const minutes = document.getElementById('desc-min-' + id).value;
    try { const r = await API.post('/api/mines/descend', { mineId: id, minutes });
      if (r && r.notices && r.notices[0]) UI.toast(r.notices[0]);
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  });

  // Автообновление, пока есть активные процессы (стройка/спуск/расчистка)
  const hasActive = m.mines.some((x) => ['building', 'descending', 'collapsed'].includes(x.status));
  if (hasActive && (location.hash || '').indexOf('production') >= 0) {
    clearTimeout(App._minesTimer);
    App._minesTimer = setTimeout(() => {
      if ((location.hash || '').indexOf('production/mines') >= 0 || (location.hash || '').indexOf('production') >= 0) App.rerender();
    }, 5000);
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
          <p class="small">💪 Мощность: ${silo.powerAmmo} / ${silo.powerNeeded} боеприпасов</p>
          <p class="muted small">При ударе: техника ~${silo.estTechMin}-${silo.estTechMax} ед., здания ~${silo.estBuildMin}-${silo.estBuildMax} ед.</p>
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
      const targetName = await UI.prompt('', {title:'Ракетный удар', icon:'🚀', placeholder:'Позывной цели', okText:'Найти цель'});
      if (!targetName) return;
      try {
        // Находим ID цели по имени через поиск в админке-подобный публичный поиск
        const found = await API.get('/api/find-player?name=' + encodeURIComponent(targetName));
        if (!found.userId) { UI.toast('⛔ Игрок не найден'); return; }
        if (!await UI.confirm(`Это нанесёт урон постройкам и технике цели «${targetName}».`, {title:'Ракетный удар', icon:'🚀', okText:'Запустить', danger:true})) return;
        const r = await API.post('/api/silos/launch', { siloId: btn.dataset.launch, targetId: found.userId });
        const mins = Math.round((r.flightSec || 600) / 60);
        UI.toast(`🚀 Ракета запущена по «${r.targetName}» (мощность ${r.powerPct}%)! Летит ${mins} мин — цель может её сбить лазером.`);
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  const hasActive = s.silos.some((x) => x.building);
  if (hasActive) {
}
};

// ---------- ЛАЗЕРЫ (ПВО, вкладка внутри Производства) ----------
App._renderLasers = async (c, tabsHtml) => {
  const s = await API.get('/api/lasers');

  if (App.me.level < s.unlockLevel) {
    c.innerHTML = `
      <div class="title">Производство</div>
      ${tabsHtml}
      <div class="card center">
        <p style="font-size:40px">🔦🔒</p>
        <p class="mt">Лазерные комплексы доступны только опытным командирам.</p>
        <p class="gold mt">Раздел откроется на ${s.unlockLevel} уровне (сейчас: ${App.me.level}).</p>
      </div>`;
    return;
  }

  const laserCard = (laser) => {
    let body = '';
    if (laser.busy) {
      const label = laser.phase === 'cooling' ? '❄️ Охлаждение после выстрела' : '🏗 Постройка';
      body = `
        <p class="muted small mt">${label}: готовность через ${UI.fmtTimer(laser.busyRemainingSec)}</p>
        <button class="btn btn-orange btn-inline mt" data-lboost="${laser.id}">⚡ Ускорить за <span class="ic-gold"></span> ${UI.fmtNum(laser.boostCostGold)}</button>`;
    } else {
      body = `
        <div class="mt">
          <p class="small">🔋 Готовность: ${laser.readyEnergy} / ${laser.readyNeeded} энергии ${laser.canFire ? '<span class="gold">✓ можно стрелять</span>' : ''}</p>
          ${UI.bar(laser.readyEnergy, laser.readyNeeded, 'en')}
        </div>
        <div class="mt">
          <p class="small">🎯 Точность: ${laser.powerPct}% (шанс сбить ракету)</p>
          ${UI.bar(laser.powerAmmo, laser.powerNeeded, 'am')}
        </div>
        <div class="field-row mt">
          <input type="number" id="lfuel-en-${laser.id}" placeholder="Энергия" min="1" style="width:90px">
          <button class="btn btn-inline" data-lfuel-ready="${laser.id}">Залить энергию</button>
        </div>
        <div class="field-row mt">
          <input type="number" id="lfuel-am-${laser.id}" placeholder="Боеприпасы" min="1" style="width:90px">
          <button class="btn btn-inline" data-lfuel-power="${laser.id}">Залить боеприпасы</button>
        </div>
        ${laser.canFire
          ? '<p class="muted small mt center">Готов к перехвату — выберите ракету в списке ниже 👇</p>'
          : '<p class="muted small mt center">Заполните готовность до 100%, чтобы стрелять</p>'}`;
    }
    return `
      <div class="card">
        <div class="name">🔦 Лазер ПВО <span class="muted small">№${laser.id.slice(0, 4)}</span></div>
        ${body}
      </div>`;
  };

  // Список летящих ракет для перехвата
  const readyLasers = s.lasers.filter((l) => l.canFire);
  const rocketRow = (rk) => `
    <div class="card" style="${rk.isMe ? 'border-color:var(--red)' : ''}">
      <div class="list-row" style="border:none;padding:0">
        <div class="grow">
          <div class="name">${rk.isMe ? '🚨 Ракета ЛЕТИТ В ВАС' : '🚀 Ракета'} <span class="muted small">${rk.powerPct}% мощности</span></div>
          <div class="muted small">${UI.esc(rk.attackerName)} → ${UI.esc(rk.targetName)} · долёт через ${UI.fmtTimer(rk.impactRemainingSec)}</div>
        </div>
        <button class="btn btn-red btn-inline" data-shoot="${rk.id}" ${readyLasers.length ? '' : 'disabled'}>🔦 Сбить</button>
      </div>
    </div>`;

  c.innerHTML = `
    <div class="title">Производство</div>
    ${tabsHtml}
    <div class="card">
      <p class="muted small">Лазер сбивает летящие ракеты. Заряжается энергией (готовность — нужно 100% для выстрела) и боеприпасами (точность — шанс сбить равен % заполнения). После выстрела лазер обнуляется и охлаждается 24 ч. Можно сбивать ракеты, летящие и по вам, и по другим игрокам.</p>
    </div>

    <div style="font-weight:bold;margin:12px 4px 6px">🚀 Ракеты в полёте ${s.inFlight.length ? `(${s.inFlight.length})` : ''}</div>
    ${s.inFlight.length
      ? (readyLasers.length ? '' : '<p class="muted small" style="margin:0 4px 6px">Нет готового заряженного лазера — зарядите энергию до 100%.</p>') + s.inFlight.map(rocketRow).join('')
      : '<div class="card center muted">Сейчас ракет в полёте нет.</div>'}

    <div style="font-weight:bold;margin:16px 4px 6px">🔦 Ваши лазеры ${s.lasers.length ? `(${s.lasers.length})` : ''}</div>
    ${s.lasers.length === 0 ? '<div class="card center muted">У вас пока нет лазеров.</div>' : ''}
    ${s.lasers.map(laserCard).join('')}
    <div class="card center">
      <button class="btn btn-orange" id="laser-build">🔦 Купить лазер: <span class="ic-gold"></span> ${UI.fmtNum(s.nextLaserCostGold)}</button>
    </div>`;

  document.getElementById('laser-build').onclick = async () => {
    try { await API.post('/api/lasers/build'); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-lboost]').forEach((btn) => btn.onclick = async () => {
    try { await API.post('/api/lasers/boost', { laserId: btn.dataset.lboost }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  c.querySelectorAll('[data-lfuel-ready]').forEach((btn) => btn.onclick = async () => {
    const id = btn.dataset.lfuelReady;
    const amount = document.getElementById('lfuel-en-' + id).value;
    try { await API.post('/api/lasers/fuel-ready', { laserId: id, amount }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  c.querySelectorAll('[data-lfuel-power]').forEach((btn) => btn.onclick = async () => {
    const id = btn.dataset.lfuelPower;
    const amount = document.getElementById('lfuel-am-' + id).value;
    try { await API.post('/api/lasers/fuel-power', { laserId: id, amount }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  // Сбить ракету: берём готовый лазер с наибольшей точностью
  c.querySelectorAll('[data-shoot]').forEach((btn) => btn.onclick = async () => {
    const best = s.lasers.filter((l) => l.canFire).sort((a, b) => b.powerAmmo - a.powerAmmo)[0];
    if (!best) { UI.toast('⛔ Нет готового заряженного лазера'); return; }
    try {
      const r = await API.post('/api/lasers/intercept', { laserId: best.id, rocketId: btn.dataset.shoot });
      if (r && r.notices && r.notices[0]) UI.toast(r.notices[0]);
      await App.refreshMe(); App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  });

  // Автообновление, пока лазеры заняты или есть ракеты в полёте
  const active = s.lasers.some((l) => l.busy) || s.inFlight.length > 0;
  if (active && (location.hash || '').indexOf('production') >= 0) {
    clearTimeout(App._lasersTimer);
    App._lasersTimer = setTimeout(() => {
      if ((location.hash || '').indexOf('production') >= 0) App.rerender();
    }, 5000);
  }
};
