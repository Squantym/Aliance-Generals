// ===================================================================
// public/js/screens/market.js — «Чёрный рынок», «Клуб офицеров», «Трофеи»
// Рынок: допинг себе, падлянки врагам, контейнеры с секретными
// разработками и аукцион аренды командиров. Клуб: три мини-игры
// за золото. Трофеи: уникальные предметы с прокачкой до 10 уровня.
// ===================================================================

// ---------- ЧЁРНЫЙ РЫНОК ----------
App.screens.market = async (c, param) => {
  await App.refreshMe();
  const tab = param || 'buffs'; // buffs | debuffs | containers | auction

  const tabs = [
    ['buffs', '💉 Допинг'],
    ['debuffs', '😈 Падлянки'],
    ['mines', '💣 Мины'],
    ['containers', '📦 Контейнеры'],
    ['auction', '🔨 Аукцион'],
    ['passport', '🛂 Паспорт'],
  ];
  const tabsHtml = `<div class="tabs">${tabs.map(([id, label]) =>
    `<div class="tab ${id === tab ? 'active' : ''}" onclick="location.hash='#market/${id}'">${label}</div>`).join('')}</div>`;

  // --- Вкладка: допинг (баффы и восстановители себе) ---
  if (tab === 'buffs' || tab === 'debuffs') {
    const data = await API.get('/api/market/items');
    const items = tab === 'buffs' ? data.buffs : data.debuffs;

    c.innerHTML = `
      <div class="title">Чёрный рынок</div>
      ${UI.saleBanner(data.discount)}
      ${tabsHtml}
      ${tab === 'debuffs' ? `
        <div class="card">
          <label>😈 Имя жертвы (точный позывной)</label>
          <input type="text" id="victim-name" placeholder="Кому подложить свинью">
        </div>` : ''}
      ${items.map((x) => `
        <div class="card">
          ${App._marketImg(x.id) ? `<img src="${App._marketImg(x.id)}" alt="${UI.esc(x.name)}" class="market-img">` : `<div class="name">${UI.esc(x.name)}</div>`}
          <p class="muted small">${UI.esc(x.desc)}${x.durMin ? ` · действует ${x.durMin >= 60 ? (x.durMin / 60) + ' ч' : x.durMin + ' мин'}` : ''}</p>
          <button class="btn btn-orange mt" data-item="${x.id}">${tab === 'debuffs' ? 'Применить' : 'Купить'} за ${UI.priceWithSale(x.baseGold, x.gold, '<span class="ic-gold"></span>', UI.fmtNum)}</button>
        </div>`).join('')}`;

    c.querySelectorAll('[data-item]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const body = { itemId: btn.dataset.item };
          if (tab === 'debuffs') body.targetName = document.getElementById('victim-name').value;
          await API.post('/api/market/buy', body);
          await App.refreshMe();
          App.renderHeader();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
    return;
  }

  // --- Вкладка: мины (трофей «Растяжка») ---
  if (tab === 'mines') {
    const info = await API.get('/api/market/mines');
    const room = Math.max(0, info.maxStock - info.stock);
    c.innerHTML = `
      <div class="title">Чёрный рынок</div>
      ${tabsHtml}
      <div class="card">
        ${App._marketImg('landmine') ? `<img src="${App._marketImg('landmine')}" alt="Растяжка" class="market-img">` : `<div class="name">💣 Растяжка</div>`}
        <p class="muted small">Мина в ваш личный запас. Срабатывает АВТОМАТИЧЕСКИ, если враг атакует вас — шанс срабатывания и урон технике нападающего зависят от трофея «Растяжка» (раздел «Трофеи»). При взрыве нападающий полностью теряет здоровье, если не разминирует растяжку в мини-игре.</p>
        <div class="kv mt"><span class="k">В запасе</span><span class="v">${info.stock} / ${info.maxStock}</span></div>
        <div class="kv"><span class="k">Цена за штуку</span><span class="v gold"><span class="ic-gold"></span> ${info.price}</span></div>
        ${room > 0 ? `
          <div class="field-row mt">
            <input type="number" id="mine-qty" min="1" max="${Math.min(5, room)}" value="${Math.min(5, room)}" style="flex:1">
            <button class="btn btn-orange btn-inline" id="mine-buy">Купить</button>
          </div>
          <p class="muted small center mt">До ${Math.min(5, room)} шт. за раз (максимум в запасе — ${info.maxStock}).</p>
        ` : `<p class="center gold mt">Запас полон ✔</p>`}
      </div>`;
    const buyBtn = document.getElementById('mine-buy');
    if (buyBtn) buyBtn.onclick = async () => {
      try {
        const qty = parseInt(document.getElementById('mine-qty').value, 10) || 1;
        const r = await API.post('/api/market/mines/buy', { qty });
        UI.toast(`💣 Куплено мин: ${r.bought} за 🪙 ${r.cost}`);
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    return;
  }

  // --- Вкладка: контейнеры с секретными разработками ---
  if (tab === 'containers') {
    const data = await API.get('/api/market/containers');
    const { history } = await API.get('/api/market/container-history');
    c.innerHTML = `
      <div class="title">Чёрный рынок</div>
      ${UI.saleBanner(data.discount)}
      ${tabsHtml}
      <div class="card"><p class="muted small">
        Внутри — одна из 9 секретных разработок. Они не уничтожаются в боях и не требуют содержания.
        У каждой разработки <b>свои уникальные</b> характеристики атаки и защиты (см. ниже).
        До 50 уровня значения статичны, дальше +1% к атаке/защите за каждый ваш уровень${data.levelBonusPct > 0 ? ` (сейчас +<b class="gold">${data.levelBonusPct}%</b>)` : ''}.
        Каждая собранная «${UI.esc(data.superSecret.name)}» даёт ещё +0.5% ко ВСЕМ секретным разработкам${data.superBonusPct > 0 ? ` (сейчас +<b class="gold">${data.superBonusPct}%</b>)` : ''}.
        Шанс 150% = одна гарантированная + 50% на вторую. Полный комплект из 9 разных = бесплатный «Абсолют».</p>
      </div>
      ${data.containers.map((x) => `
        <div class="card container-card">
          <div class="img-frame img-frame-lg">
            <img src="/img/containers/${x.id}.webp" alt="${UI.esc(x.name)}" loading="lazy" decoding="async">
          </div>
          <div class="container-card-body">
            <div class="name">📦 ${UI.esc(x.name)}</div>
            <div class="muted small">Шанс разработки: <b class="gold">${x.chance}%</b></div>
            <div class="muted small">Цена за 1 шт: ${UI.priceWithSale(x.baseGold, x.gold, '<span class="ic-gold"></span>', UI.fmtNum)}</div>
            <div class="btn-row mt">
              <button class="btn btn-orange btn-inline" data-open="${x.tier}" data-qty="1">×1</button>
              <button class="btn btn-orange btn-inline" data-open="${x.tier}" data-qty="5">×5</button>
              <button class="btn btn-orange btn-inline" data-open="${x.tier}" data-qty="10">×10</button>
            </div>
          </div>
        </div>`).join('')}
      <div class="card">
        <div class="title" style="margin-top:0">Ваша коллекция</div>
        ${data.collection.map((d) => `
          <div class="secret-row ${d.count ? '' : 'secret-row-empty'}">
            <div class="img-frame img-frame-row">
              <img src="/img/secret/${d.id}.webp" alt="${UI.esc(d.name)}" loading="lazy" decoding="async">
            </div>
            <div class="secret-row-info">
              <div class="secret-row-name">${UI.esc(d.name)}</div>
              <div class="muted secret-row-stats">⚔ ${UI.fmtNum(d.atkNow)} · 🛡 ${UI.fmtNum(d.defNow)}</div>
            </div>
            <div class="${d.count ? 'gold' : 'muted'} secret-row-count">×${d.count}</div>
          </div>`).join('')}
        <div class="secret-row secret-row-super ${data.superSecret.count ? '' : 'secret-row-empty'}">
          <div class="img-frame img-frame-row img-frame-super">
            <img src="/img/secret/${data.superSecret.id}.webp" alt="${UI.esc(data.superSecret.name)}" loading="lazy" decoding="async">
          </div>
          <div class="secret-row-info">
            <div class="secret-row-name gold">🛸 ${UI.esc(data.superSecret.name)}</div>
            <div class="muted secret-row-stats">⚔ ${UI.fmtNum(data.superSecret.atkNow)} · 🛡 ${UI.fmtNum(data.superSecret.defNow)}</div>
          </div>
          <div class="gold secret-row-count">×${data.superSecret.count}</div>
        </div>
      </div>
      <div class="card">
        <div class="title" style="margin-top:0">📜 История последних открытий</div>
        ${history.length === 0 ? '<p class="muted small center">Вы ещё не открывали контейнеры.</p>' : history.map((h) => `
          <div class="history-row">
            <div class="history-row-head">
              <span class="name small">${UI.esc(h.tierName)} ×${h.qty}</span>
              <span class="muted small">${UI.fmtDate(h.at)}</span>
            </div>
            <div class="muted small">Потрачено: <span class="ic-gold"></span> ${UI.fmtNum(h.spent)}</div>
            <div class="small mt">${Object.keys(h.dropped).length ? Object.entries(h.dropped).map(([n, c]) => `${UI.esc(n)} ×${c}`).join(', ') : 'Пусто — ничего не выпало'}</div>
          </div>`).join('')}
      </div>`;

    c.querySelectorAll('[data-open]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const r = await API.post('/api/market/open', { tier: btn.dataset.open, qty: btn.dataset.qty });
          await App.refreshMe();
          App._showContainerResult(r);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
    return;
  }

  // --- Вкладка: паспорт (смена имени и гражданства) ---
  if (tab === 'passport') {
    const p = await API.get('/api/passport');
    const flagOf = (id) => App._flagImg((p.countries.find((cc) => cc.id === id) || {}).flag, 'big');
    c.innerHTML = `
      <div class="title">Чёрный рынок</div>
      ${tabsHtml}
      <div class="card">
        <p class="muted small">Контакт в министерстве оформит вам новые документы — но не дёшево. Каждая следующая смена в 2 раза дороже предыдущей.</p>
      </div>

      <div class="card">
        <div class="name">📛 Новое имя</div>
        <p class="muted small mt">Текущий позывной: <b>${UI.esc(p.currentName)}</b></p>
        <label>Новый позывной (3–16 символов)</label>
        <input type="text" id="pp-newname" maxlength="16" value="${UI.esc(p.currentName)}">
        <button class="btn btn-orange mt" id="pp-name-go">Сменить имя за <span class="ic-gold"></span> ${UI.fmtNum(p.namePrice)}</button>
        ${p.nameChanges > 0 ? `<p class="muted small center mt">Имя менялось ${p.nameChanges} раз(а)</p>` : ''}
      </div>

      <div class="card">
        <div class="name">🌍 Новое гражданство</div>
        <p class="muted small mt">Текущее: ${flagOf(p.currentCountry)} <b>${UI.esc(p.currentCountry.toUpperCase())}</b>. Смена даёт бонус новой страны.</p>
        <label>Выберите новую страну</label>
        <select id="pp-newcountry">
          ${p.countries.map((cc) => `
            <option value="${cc.id}" ${cc.id === p.currentCountry ? 'selected' : ''}>
              ${cc.flag} ${UI.esc(cc.name)} — ${UI.esc(cc.desc)}
            </option>`).join('')}
        </select>
        <button class="btn btn-orange mt" id="pp-country-go">Сменить гражданство за <span class="ic-gold"></span> ${UI.fmtNum(p.countryPrice)}</button>
        ${p.countryChanges > 0 ? `<p class="muted small center mt">Гражданство менялось ${p.countryChanges} раз(а)</p>` : ''}
      </div>`;

    document.getElementById('pp-name-go').onclick = async () => {
      const newName = document.getElementById('pp-newname').value.trim();
      if (!await UI.confirm(`Сменить имя на «${newName}» за ${p.namePrice} золота?`, {title:'Смена позывного', icon:'📛', okText:'Сменить'})) return;
      try {
        await API.post('/api/passport/name', { newName });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('pp-country-go').onclick = async () => {
      const country = document.getElementById('pp-newcountry').value;
      if (!await UI.confirm(`Сменить гражданство на «${country.toUpperCase()}» за ${p.countryPrice} золота?`, {title:'Смена гражданства', icon:'🏴', okText:'Сменить'})) return;
      try {
        await API.post('/api/passport/country', { country });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    return;
  }

  // --- Вкладка: аукцион командиров ---
  const data = await API.get('/api/market/auction');
  c.innerHTML = `
    <div class="title">Чёрный рынок</div>
    ${tabsHtml}
    <div class="card"><p class="muted small">Уникальные наёмники сдаются в аренду на ${data.rentHours} часа. Ставки от <span class="ic-gold"></span> ${UI.fmtNum(data.minBid||500)}, шаг <span class="ic-gold"></span> ${data.bidStep||50}. Аукцион закрывается в 23:59 по Москве, эффект начинает действовать с 00:00. Перебитая ставка возвращается.</p></div>
    ${data.lots.map((l) => `
      <div class="card merc-card">
        ${App._mercImg(l.commander.id) ? `<img src="${App._mercImg(l.commander.id)}" alt="${UI.esc(l.commander.name)}" class="merc-img">` : ''}
        <div class="name" style="font-size:16px">⭐ ${UI.esc(l.commander.name)}</div>
        <p class="muted small">${UI.esc(l.commander.desc)}</p>
        <div class="kv mt"><span class="k">Лидер</span><span class="v">${l.best ? UI.esc(l.best.name) + ' — <span class="ic-gold"></span> ' + UI.fmtNum(l.best.amount) : '<span class="muted">ставок нет</span>'}</span></div>
        <div class="kv"><span class="k">До закрытия</span><span class="v">${UI.fmtTimer(l.endsInSec)}</span></div>
        <div class="field-row mt">
          <input type="number" class="qty" style="width:110px" min="${l.minBid}" step="${data.bidStep||50}" value="${l.minBid}" id="bid-${l.id}">
          <button class="btn btn-orange" data-bid="${l.id}">Ставка (мин. <span class="ic-gold"></span> ${UI.fmtNum(l.minBid)})</button>
        </div>
      </div>`).join('')}
    ${(data.holders && data.holders.length) ? `
      <div class="card">
        <div class="name">🎖 Наёмники сейчас на службе</div>
        <p class="muted small">У кого сейчас действуют выигранные наёмники:</p>
        ${data.holders.map((h) => `
          <div class="kv mt"><span class="k">⭐ ${UI.esc(h.commanderName)}</span>
            <span class="v"><a href="#" onclick="App.go('profile/${h.holderId}');return false" style="color:var(--gold)">${UI.esc(h.holderName)}</a> <span class="muted small">(${UI.fmtTimer(h.expiresInSec)})</span></span></div>`).join('')}
      </div>` : ''}
    <button class="btn" onclick="App.rerender()">🔄 Обновить лоты</button>`;

  c.querySelectorAll('[data-bid]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/market/bid', {
          lotId: btn.dataset.bid,
          amount: document.getElementById('bid-' + btn.dataset.bid).value,
        });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
};

// ---------- КЛУБ ОФИЦЕРОВ ----------
// ---------- КЛУБ ОФИЦЕРОВ (5 многоступенчатых игр) ----------
App.screens.club = async (c) => {
  await App.refreshMe();
  const data = await API.get('/api/club');
  const R = (id) => document.getElementById(id);
  const post = async (url, body) => {
    try { return await API.post(url, body || {}); }
    catch (e) { UI.toast('⛔ ' + e.message); return null; }
  };
  const cdLine = (sec) => `<p class="muted center mt">⏳ Доступно через ${UI.fmtTimer(sec)}</p>`;

  // ── 1. ВОЕННЫЙ ПРЕФЕРАНС ──────────────────────────────────────
  let prefHtml;
  const pf = data.pref;
  if (pf.state === 'active') {
    prefHtml = `
      <p class="small">Ваши карты: <b class="gold" style="font-size:18px">${pf.hand.join(' + ')}</b> = <b>${pf.sum}</b></p>
      <p class="muted small">Цель — набрать как можно ближе к ${pf.target}, не перебрав. Затем добирает генерал.</p>
      <div class="field-row mt">
        <button class="btn btn-orange btn-inline" id="pref-hit">🃏 Ещё карту</button>
        <button class="btn btn-inline" id="pref-stand">✋ Хватит</button>
      </div>`;
  } else if (pf.state === 'cooldown') {
    prefHtml = cdLine(pf.cooldownSec);
  } else {
    prefHtml = `
      <p class="muted small">Наберите ближе к ${pf.target}, чем генерал, не перебрав. Награда <span class="ic-gold"></span> ${pf.rewardMin}–${pf.rewardMax}.</p>
      <button class="btn btn-orange mt" id="pref-start">Сесть за стол</button>`;
  }

  // ── 2. СЕЙФ ШТАБА ─────────────────────────────────────────────
  let safeHtml;
  const sf = data.safe;
  if (sf.state === 'active') {
    const hist = (sf.history || []).map((h) =>
      `<div class="kv"><span class="k" style="font-family:monospace;letter-spacing:3px">${h.guess}</span>
        <span class="v">🎯 ${h.bulls} точно · 🔄 ${h.cows} не на месте</span></div>`).join('');
    safeHtml = `
      <p class="small">Подберите ${sf.digits}-значный код (цифры не повторяются). Осталось попыток: <b class="gold">${sf.triesLeft}</b></p>
      <p class="muted small">🎯 — цифра на своём месте, 🔄 — есть в коде, но не там.</p>
      ${hist ? `<div class="mt">${hist}</div>` : ''}
      <div class="field-row mt">
        <input type="text" id="safe-guess" maxlength="${sf.digits}" inputmode="numeric" placeholder="${'0'.repeat(sf.digits)}" style="font-family:monospace;letter-spacing:4px">
        <button class="btn btn-orange btn-inline" id="safe-go">Ввести</button>
      </div>`;
  } else if (sf.state === 'cooldown') {
    safeHtml = cdLine(sf.cooldownSec);
  } else {
    safeHtml = `
      <p class="muted small">Взломайте код за ${sf.tries} попыток методом дедукции. Награда <span class="ic-gold"></span> ${sf.reward}.</p>
      <button class="btn btn-orange mt" id="safe-start">Подойти к сейфу</button>`;
  }

  // ── 3. МИННОЕ ПОЛЕ ────────────────────────────────────────────
  let mineHtml;
  const mn = data.mine;
  if (mn.state === 'active') {
    const grid = Array.from({ length: mn.cells }, (_, i) => {
      const opened = mn.opened.includes(i);
      return `<button class="mine-cell${opened ? ' mine-open' : ''}" data-mine="${i}" ${opened ? 'disabled' : ''}>${opened ? '✅' : '?'}</button>`;
    }).join('');
    mineHtml = `
      <p class="small">Накоплено: <b class="gold" style="font-size:18px"><span class="ic-gold"></span> ${mn.pot}</b> · безопасных ячеек: ${mn.safeLeft}</p>
      <p class="muted small">Под ${mn.bombs} ячейками — мины. Открывайте по одной, забирайте до взрыва!</p>
      <div class="mine-grid mt">${grid}</div>
      <button class="btn btn-orange mt" id="mine-cashout" ${mn.pot <= 0 ? 'disabled' : ''} style="width:100%">💰 Забрать <span class="ic-gold"></span> ${mn.pot}</button>`;
  } else if (mn.state === 'cooldown') {
    mineHtml = cdLine(mn.cooldownSec);
  } else {
    mineHtml = `
      <p class="muted small">Поле ${mn.cells} ячеек, ${mn.bombs} мин. Открывайте и копите награду, забирайте вовремя! До <span class="ic-gold"></span> ${mn.rewardMax}.</p>
      <button class="btn btn-orange mt" id="mine-start">Выйти на поле</button>`;
  }

  // ── 4. ПОЛОСА ПРЕПЯТСТВИЙ ─────────────────────────────────────
  let runHtml;
  const rn = data.run;
  if (rn.state === 'active') {
    const lv = rn.levels;
    runHtml = `
      <p class="small">Этап <b class="gold">${rn.stage}</b> из ${rn.totalStages} · накоплено: <b class="gold"><span class="ic-gold"></span> ${rn.pot}</b></p>
      <p class="muted small">Выберите сложность этапа. Провал — потеряете всё накопленное!</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="btn btn-inline" data-run="easy">🟢 Лёгкий — ${Math.round(lv.easy.chance*100)}% · +<span class="ic-gold"></span> ${lv.easy.reward}</button>
        <button class="btn btn-inline" data-run="medium">🟡 Средний — ${Math.round(lv.medium.chance*100)}% · +<span class="ic-gold"></span> ${lv.medium.reward}</button>
        <button class="btn btn-inline" data-run="hard">🔴 Тяжёлый — ${Math.round(lv.hard.chance*100)}% · +<span class="ic-gold"></span> ${lv.hard.reward}</button>
      </div>
      ${rn.canCashout ? `<button class="btn btn-orange mt" id="run-cashout" style="width:100%">🏃 Сойти с наградой <span class="ic-gold"></span> ${rn.pot}</button>` : '<p class="muted small center mt">Сойти можно после 3-го этапа</p>'}`;
  } else if (rn.state === 'cooldown') {
    runHtml = cdLine(rn.cooldownSec);
  } else {
    runHtml = `
      <p class="muted small">${rn.totalStages} этапов, на каждом выбор риска. Награда копится, провал обнуляет. До <span class="ic-gold"></span> ${rn.rewardMax}.</p>
      <button class="btn btn-orange mt" id="run-start">На старт</button>`;
  }

  // ── 5. ШТАБНАЯ ПАРТИЯ ─────────────────────────────────────────
  let duelHtml;
  const dl = data.duel;
  if (dl.state === 'active') {
    const lr = dl.lastRound;
    const lrText = lr
      ? `<p class="small mt">Прошлый ход: вы ${dl.units[lr.my]} · генерал ${dl.units[lr.foe]} → <b class="${lr.outcome==='win'?'gold':lr.outcome==='lose'?'red':''}">${lr.outcome==='win'?'победа':lr.outcome==='lose'?'поражение':'ничья'}</b></p>`
      : '';
    duelHtml = `
      <p class="small">Счёт: вы <b class="gold">${dl.myWins}</b> — <b class="red">${dl.foeWins}</b> генерал (до ${dl.needed} побед)</p>
      <p class="muted small">🪖 Пехота сбивает ✈️ авиацию · ✈️ авиация бьёт 🛡 танк · 🛡 танк давит 🪖 пехоту.</p>
      ${lrText}
      <div class="field-row mt">
        <button class="btn btn-inline" data-duel="infantry">🪖 Пехота</button>
        <button class="btn btn-inline" data-duel="air">✈️ Авиация</button>
        <button class="btn btn-inline" data-duel="tank">🛡 Танк</button>
      </div>`;
  } else if (dl.state === 'cooldown') {
    duelHtml = cdLine(dl.cooldownSec);
  } else {
    duelHtml = `
      <p class="muted small">Тактическая дуэль до ${dl.needed} побед. Угадывайте ход генерала. Награда <span class="ic-gold"></span> ${dl.rewardMin}–${dl.rewardMax}.</p>
      <button class="btn btn-orange mt" id="duel-start">Бросить вызов</button>`;
  }

  c.innerHTML = `
    <div class="title">Клуб офицеров</div>
    <p class="muted small" style="margin:-4px 4px 10px">Пять игр на удачу и смекалку. Награды от <span class="ic-gold"></span> 10 до 20.</p>
    <div class="card"><div class="name">🃏 Военный преферанс</div><div class="mt">${prefHtml}</div></div>
    <div class="card"><div class="name">🗝 Сейф штаба</div><div class="mt">${safeHtml}</div></div>
    <div class="card"><div class="name">💣 Минное поле</div><div class="mt">${mineHtml}</div></div>
    <div class="card"><div class="name">🎯 Полоса препятствий</div><div class="mt">${runHtml}</div></div>
    <div class="card"><div class="name">♟ Штабная партия</div><div class="mt">${duelHtml}</div></div>`;

  // ── Обработчики ──
  // Преферанс
  if (R('pref-start')) R('pref-start').onclick = async () => { if (await post('/api/club/pref/start')) App.rerender(); };
  if (R('pref-hit')) R('pref-hit').onclick = async () => {
    const r = await post('/api/club/pref/hit');
    if (r && r.result === 'bust') UI.toast(`🃏 Перебор! ${r.sum} > 21. Вы проиграли.`);
    await App.refreshMe(); App.rerender();
  };
  if (R('pref-stand')) R('pref-stand').onclick = async () => {
    const r = await post('/api/club/pref/stand');
    if (r && r.result === 'lose') UI.toast(`🃏 Генерал сильнее: ${r.mySum} против ${r.dealerSum}.`);
    await App.refreshMe(); App.rerender();
  };
  // Сейф
  if (R('safe-start')) R('safe-start').onclick = async () => { if (await post('/api/club/safe/start')) App.rerender(); };
  if (R('safe-go')) R('safe-go').onclick = async () => {
    const r = await post('/api/club/safe/try', { guess: R('safe-guess').value });
    if (r && r.result === 'fail') UI.toast(`🗝 Сейф заблокирован! Код был: ${r.code}`);
    await App.refreshMe(); App.rerender();
  };
  // Минное поле
  if (R('mine-start')) R('mine-start').onclick = async () => { if (await post('/api/club/mine/start')) App.rerender(); };
  if (R('mine-cashout')) R('mine-cashout').onclick = async () => { await post('/api/club/mine/cashout'); await App.refreshMe(); App.rerender(); };
  c.querySelectorAll('[data-mine]').forEach((btn) => {
    btn.onclick = async () => {
      const r = await post('/api/club/mine/open', { cell: btn.dataset.mine });
      if (r && r.result === 'boom') UI.toast('💥 БУМ! Вы подорвались и потеряли накопленное.');
      await App.refreshMe(); App.rerender();
    };
  });
  // Полоса
  if (R('run-start')) R('run-start').onclick = async () => { if (await post('/api/club/run/start')) App.rerender(); };
  if (R('run-cashout')) R('run-cashout').onclick = async () => { await post('/api/club/run/cashout'); await App.refreshMe(); App.rerender(); };
  c.querySelectorAll('[data-run]').forEach((btn) => {
    btn.onclick = async () => {
      const r = await post('/api/club/run/step', { level: btn.dataset.run });
      if (r && r.result === 'fail') UI.toast(`🎯 Провал на этапе «${r.level}»! Награда потеряна.`);
      await App.refreshMe(); App.rerender();
    };
  });
  // Дуэль
  if (R('duel-start')) R('duel-start').onclick = async () => { if (await post('/api/club/duel/start')) App.rerender(); };
  c.querySelectorAll('[data-duel]').forEach((btn) => {
    btn.onclick = async () => {
      const r = await post('/api/club/duel/move', { unit: btn.dataset.duel });
      if (r && r.result === 'match_lose') UI.toast('♟ Генерал переиграл вас в этой партии.');
      await App.refreshMe(); App.rerender();
    };
  });
};

// ---------- ТРОФЕИ ----------
App.screens.trophies = async (c) => {
  await App.refreshMe();
  const data = await API.get('/api/trophies');

  // Форматирование минут прокачки: "Xм / Xч Yм / Xсут Yч"
  const fmtMin = (min) => {
    if (min == null) return '';
    if (min < 60) return `${min} мин`;
    if (min < 24 * 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
    const days = Math.floor(min / (24 * 60));
    const hours = Math.floor((min % (24 * 60)) / 60);
    return `${days} сут ${hours} ч`;
  };
  // Текущий/будущий бонус: для спутника-шпиona bonusNow — строка, иначе проценты
  const bonusStr = (t, val) => (t.spy ? UI.esc(String(val)) : `${val}%`);

  c.innerHTML = `
    <div class="title">Трофеи</div>
    ${UI.saleBanner(data.discount)}
    <div class="card"><p class="muted small">
      Уникальные предметы с прокачкой до ${data.maxLevel} уровня. Время прокачки
      растёт с уровнем (у некоторых трофеев — дольше). Можно ускорить за
      <span class="ic-gold"></span> ${data.boostGoldCost} (мгновенно). Помеченные
      «🔧 в разработке» эффекты — декоративные.</p>
    </div>
    ${data.trophies.map((t) => `
      <div class="card">
        <div class="name">${UI.esc(t.name)} <span class="muted">ур. ${t.level}/${data.maxLevel}</span>${t.flavor ? ' <span class="badge">🔧 в разработке</span>' : ''}${t.spy ? ' <span class="badge">🛰 разведка</span>' : ''}</div>
        <p class="muted small">${UI.esc(t.desc)}</p>
        <div class="mt">${UI.bar(t.level, data.maxLevel, 'gold', `${t.level} / ${data.maxLevel}`)}</div>
        ${t.level > 0
          ? `<p class="small mt">${t.spy ? 'Сейчас раскрывает' : 'Текущий бонус'}: <b class="gold">${bonusStr(t, t.bonusNow)}</b></p>`
          : ''}
        ${t.training
          ? `<div class="mt">${UI.bar(
              t.totalSec - t.secondsLeft,
              t.totalSec,
              'xp',
              t.secondsLeft > 0 ? '⏳ Прокачка: ' + UI.fmtTimer(t.secondsLeft) : 'Готово, обновите страницу'
            )}</div>
            <button class="btn mt" data-tboost="${t.id}">⚡ Ускорить за <span class="ic-gold"></span> ${data.boostGoldCost}</button>`
          : (t.nextCost !== null
              ? `<p class="small mt">${t.spy ? 'Станет раскрывать' : 'Будущий бонус'}: <b>${bonusStr(t, t.bonusNext)}</b></p>
                 <button class="btn btn-orange mt" data-tstart="${t.id}">Прокачать до ур. ${t.level + 1} за ${UI.priceWithSale(t.baseNextCost, t.nextCost, '<span class="ic-gold"></span>', UI.fmtNum)}</button>
                 <p class="muted small center mt">Прокачка займёт ${fmtMin(t.trainMinutes)}</p>`
              : `<p class="center gold mt">Максимальный уровень ✔</p>`)}
      </div>`).join('')}`;

  c.querySelectorAll('[data-tstart]').forEach((btn) => {
    btn.onclick = async () => {
      try { await API.post('/api/trophies/start', { id: btn.dataset.tstart }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-tboost]').forEach((btn) => {
    btn.onclick = async () => {
      try { await API.post('/api/trophies/boost', { id: btn.dataset.tboost }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  // Автообновление, если есть активные прокачки
  if (data.trophies.some((t) => t.training)) {
}
};

// ---------- ГОСПИТАЛЬ ----------
App.screens.hospital = async (c) => {
  await App.refreshMe();
  const data = await API.get('/api/hospital');
  const needsHeal = data.hp < data.maxHp;
  const onCooldown = (data.cooldownLeft || 0) > 0;

  c.innerHTML = `
    <div class="title">Полевой госпиталь</div>
    <div class="card center">
      <p style="font-size:40px">🏥</p>
      <p class="muted small">Полное восстановление здоровья за доллары. Цена растёт с уровнем — берегите бойцов, лечение дорогое. Лечиться можно раз в 5 минут.</p>
    </div>
    <div class="card">
      <div class="kv"><span class="k"><span class="ic-health"></span> Здоровье</span><span class="v">${data.hp} / ${data.maxHp}</span></div>
      <div class="kv"><span class="k">Наличные</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtMoney(data.dollars)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">Полное восстановление</span><span class="v">${UI.priceWithSale(data.baseFullHeal, data.fullHeal, '<span class="ic-dollar"></span>')}</span></div>
      ${onCooldown ? `<div class="kv"><span class="k">⏳ До следующего лечения</span><span class="v" style="color:var(--orange)">${UI.fmtTimer(data.cooldownLeft)}</span></div>` : ''}
      <button class="btn btn-orange mt" id="hp-heal" ${!needsHeal || onCooldown || data.dollars < data.fullHeal ? 'disabled' : ''}>
        ${!needsHeal ? 'Здоровье в норме' : onCooldown ? `Лечение через ${UI.fmtTimer(data.cooldownLeft)}` : (data.dollars < data.fullHeal ? 'Не хватает денег' : 'Полностью вылечиться')}
      </button>
      ${data.baseFullHeal !== data.fullHeal ? `<p class="muted small center mt">Учтена скидка трофея «Полевой госпиталь»</p>` : ''}
    </div>`;

  const btn = document.getElementById('hp-heal');
  if (btn && !btn.disabled) {
    btn.onclick = async () => {
      try { await API.post('/api/hospital/heal'); await App.refreshMe(); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }
};
