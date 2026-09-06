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
    ['buffs', App.tabImg('market_doping', 20) + 'Допинг'],
    ['debuffs', App.tabImg('market_padlyanki', 20) + 'Падлянки'],
    ['mines', App.tabImg('market_mines', 20) + 'Мины'],
    ['lots', '🎯 Лоты дня'],
    ['containers', App.tabImg('market_containers', 20) + 'Контейнеры'],
    ['auction', App.tabImg('market_auction', 20) + 'Аукцион'],
    ['passport', App.tabImg('market_passport', 20) + 'Паспорт'],
  ];
  const tabsHtml = `<div class="tabs">${tabs.map(([id, label]) =>
    `<div class="tab ${id === tab ? 'active' : ''}" onclick="location.hash='#market/${id}'">${label}</div>`).join('')}</div>`;

  // --- Вкладка: лоты дня ---
  // Аукцион секретных разработок и допинг со скидкой. Набор меняется
  // в полночь по Москве и одинаков для всех игроков.
  if (tab === 'lots') {
    let d = null;
    try { d = await API.get('/api/lots'); }
    catch (e) {
      c.innerHTML = `<div class="title">Чёрный рынок</div>${tabsHtml}
        <div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`;
      return;
    }
    const left = (sec) => {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
    };

    c.innerHTML = `
      <div class="title">Чёрный рынок</div>
      ${tabsHtml}
      <div class="card lots-head">
        <div class="name">🎯 Лоты дня</div>
        <p class="muted small mt">Набор меняется в полночь по Москве и одинаков для всех.</p>
        <div class="lots-meta">
          <span>⏳ до смены: <b class="gold">${left(d.secondsLeft)}</b></span>
          <span>у вас: <span class="ic-gold"></span> <b class="gold">${UI.fmtNum(d.myGold)}</b></span>
        </div>
      </div>

      <div class="card">
        <div class="name">🔨 Аукцион: секретные разработки</div>
        <p class="muted small mt">По одной штуке на всех. Побеждает наибольшая ставка —
        разработка зачисляется победителю в полночь, остальным золото возвращается.</p>
        <div class="lot-grid">
        ${d.devs.map((x) => `
          <div class="lot-card${x.leading ? ' lot-leading' : ''}">
            <div class="lot-card-img img-frame">
              <img src="/img/secret/${x.devId}.webp" alt="${UI.esc(x.name)}" loading="lazy"
                   onerror="this.style.display='none'">
            </div>
            <div class="lot-card-body">
              <div class="lot-card-name">${UI.esc(x.name)}</div>
              <div class="lot-stats">
                <span title="Атака">⚔ ${UI.fmtNum(x.atk)}</span>
                <span title="Защита">🛡 ${UI.fmtNum(x.def)}</span>
              </div>
              <div class="lot-bid-info">
                ${x.topGold
                  ? `<div class="lot-top">Лидер: <b>${UI.esc(x.topName)}</b> <span class="muted small">· ставок ${x.bidders}</span></div>
                     <div class="lot-top-gold"><span class="ic-gold"></span> <b>${UI.fmtNum(x.topGold)}</b></div>`
                  : '<span class="muted small">Ставок пока нет — заберите первым</span>'}
                ${x.myBid ? `<div class="lot-mine">Ваша ставка: <span class="ic-gold"></span> ${UI.fmtNum(x.myBid)}${x.leading ? ' · вы лидируете' : ''}</div>` : ''}
              </div>
              <div class="lot-actions">
                <input type="number" class="field lot-input" id="bid-${x.devId}"
                       value="${x.nextBid}" min="${x.nextBid}" step="${d.bidStep}">
                <button class="btn btn-orange btn-inline" data-bid="${x.devId}">Ставка</button>
              </div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="name">💊 Допинг со скидкой</div>
        <p class="muted small mt">Запас общий на всех: кто успел, тот и купил.
        Действует сразу, ждать полуночи не нужно.</p>
        <div class="lot-grid">
        ${d.buffs.map((b) => {
          const pct = b.stock ? Math.round(b.left / b.stock * 100) : 0;
          return `
          <div class="lot-card${b.left <= 0 ? ' lot-out' : ''}">
            <div class="lot-card-img img-frame">
              ${App._marketImg(b.itemId)
                ? `<img src="${App._marketImg(b.itemId)}" alt="${UI.esc(b.name)}" loading="lazy" onerror="this.style.display='none'">`
                : '<span class="lot-noimg">💊</span>'}
              <span class="lot-disc">−${b.discountPct}%</span>
            </div>
            <div class="lot-card-body">
              <div class="lot-card-name">${UI.esc(b.name)}</div>
              <div class="muted small lot-desc">${UI.esc(b.desc)}</div>
              <div class="lot-stock">
                <div class="lot-stock-bar"><i style="width:${pct}%"></i></div>
                <span class="muted small">осталось <b>${b.left}</b> из ${b.stock}</span>
              </div>
              <div class="lot-price">
                <s class="muted small"><span class="ic-gold"></span> ${b.basePrice}</s>
                <b class="gold"><span class="ic-gold"></span> ${b.price}</b>
              </div>
              ${b.left > 0
                ? `<div class="lot-actions">
                     <input type="number" class="field lot-input" id="qty-${b.itemId}" value="1" min="1" max="${b.left}">
                     <button class="btn btn-orange btn-inline" data-buy="${b.itemId}">Купить</button>
                   </div>`
                : '<div class="lot-sold">Разобрали</div>'}
            </div>
          </div>`; }).join('')}
        </div>
      </div>`;

    c.querySelectorAll('[data-bid]').forEach((btn) => {
      btn.onclick = async () => {
        const inp = document.getElementById('bid-' + btn.dataset.bid);
        btn.disabled = true;
        try { await API.post('/api/lots/bid', { devId: btn.dataset.bid, gold: Number(inp.value) || 0 }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); btn.disabled = false; }
      };
    });
    c.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.onclick = async () => {
        const inp = document.getElementById('qty-' + btn.dataset.buy);
        btn.disabled = true;
        try { await API.post('/api/lots/buy', { itemId: btn.dataset.buy, qty: Number(inp.value) || 1 }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); btn.disabled = false; }
      };
    });
    return;
  }

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
          ${App._marketImg(x.id) ? `<img src="${App._marketImg(x.id)}" alt="${UI.esc(x.name)}" class="market-img" loading="lazy" decoding="async">` : `<div class="name">${UI.esc(x.name)}</div>`}
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
        ${App._marketImg('landmine') ? `<img src="${App._marketImg('landmine')}" alt="Растяжка" class="market-img" loading="lazy" decoding="async">` : `<div class="name">💣 Растяжка</div>`}
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
        ${App._mercImg(l.commander.id) ? `<img src="${App._mercImg(l.commander.id)}" alt="${UI.esc(l.commander.name)}" class="merc-img" loading="lazy" decoding="async">` : ''}
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
  const [data, lot] = await Promise.all([API.get('/api/club'), API.get('/api/lottery')]);
  const R = (id) => document.getElementById(id);
  const post = async (url, body) => {
    try { return await API.post(url, body || {}); }
    catch (e) { UI.toast('⛔ ' + e.message); return null; }
  };
  const cdLine = (sec) => `<p class="muted center mt">⏳ Доступно через ${UI.fmtTimer(sec)}</p>`;

  // ── 1. ВОЕННЫЙ ПРЕФЕРАНС ──────────────────────────────────────
  // Карты рисуются картинками из /img/cards. Стоимость и сумму считает
  // СЕРВЕР и присылает готовыми: посчитай их здесь заново — и однажды
  // клиент разойдётся с сервером в тузе, показав «21» при проигрыше.
  const cardHtml = (c) => `
    <div class="pf-card" data-cid="${UI.esc(c.id)}" title="${UI.esc(c.rank + ' ' + c.suitName)}">
      <img src="${UI.esc(c.img)}" alt="${UI.esc(c.rank + ' ' + c.suitName)}" loading="lazy">
      <b class="pf-rank${c.red ? ' pf-red' : ''}">${UI.esc(c.rank)}${UI.esc(c.suit)}</b>
      <i class="pf-back"></i>
    </div>`;
  const handHtml = (cards) => `<div class="pf-hand">${(cards || []).map(cardHtml).join('')}</div>`;
  // Стол: сначала генерал, под ним игрок — как за настоящим столом
  const tableHtml = (foe, foeSum, mine, mySum, foeLabel) => `
    <div class="pf-side">
      <div class="pf-who"><span class="grow">🎖 ${foeLabel || 'Генерал'}</span><b class="gold">${foeSum}</b></div>
      ${handHtml(foe)}
    </div>
    <div class="pf-side mt">
      <div class="pf-who"><span class="grow">Вы</span><b class="gold">${mySum}</b></div>
      ${handHtml(mine)}
    </div>`;

  let prefHtml;
  const pf = data.pref;
  const last = App._prefLast;
  if (pf.state === 'active') {
    prefHtml = `
      ${tableHtml(pf.foe, pf.foeSum, pf.hand, pf.sum)}
      <p class="muted small mt">Цель — подойти к ${pf.target} ближе генерала, не перебрав.
        Его карты открыты, но он ещё доберёт, пока у него меньше ${pf.dealerStop}.
        Ничья считается его победой.</p>
      <div class="field-row mt">
        <button class="btn btn-orange btn-inline grow" id="pref-hit">🃏 Ещё карту</button>
        <button class="btn btn-inline grow" id="pref-stand">✋ Хватит</button>
      </div>`;
  } else {
    // Итог прошлой партии остаётся на экране. Иначе вскрытие карт
    // мелькало бы на долю секунды и пропадало вместе с перерисовкой —
    // а посмотреть, чем всё кончилось, игрок как раз и хочет.
    const outcome = !last ? '' : `
      <div class="pf-result ${last.result === 'win' ? 'pf-win' : 'pf-lose'}">
        ${last.result === 'win' ? '🏆 Партия ваша'
          : (last.result === 'bust' ? '💥 Перебор' : '🎖 Генерал забрал')}
        · <b>${last.mySum}</b> против <b>${last.foeSum}</b>${last.reward ? ` · +🪙 ${last.reward}` : ''}
      </div>
      ${tableHtml(last.foe, last.foeSum, last.hand, last.mySum)}`;
    if (pf.state === 'cooldown') {
      prefHtml = outcome + cdLine(pf.cooldownSec);
    } else {
      prefHtml = outcome + `
        <p class="muted small mt">Колода на 36 карт: 6…10 по номиналу, валет 2, дама 3, король 4, туз 11
          (а если рука перебирает — туз считается за 1). Наберите ближе к ${pf.target},
          чем генерал. Награда <span class="ic-gold"></span> ${pf.rewardMin}–${pf.rewardMax}.</p>
        <button class="btn btn-orange mt" id="pref-start">Сесть за стол</button>`;
    }
  }

  // ── 2. СЕЙФ ШТАБА: ОДИН на весь мир ───────────────────────────
  // Главное на карточке — общая маска: то, что мир уже вскрыл. Она и
  // есть «счёт» этой игры, поэтому крупная и наверху.
  let safeHtml;
  const sf = data.safe;
  const maskHtml = sf.mask.split('').map((ch) =>
    `<span class="sf-d${ch === '*' ? ' sf-hidden' : ''}">${ch}</span>`).join('');
  const hist = (sf.history || []).map((h) =>
    `<div class="field-row small sf-row">
       <span class="sf-guess grow">${UI.esc(h.guess)}</span>
       <span class="muted">взломщик ${UI.esc(h.tag)}</span>
     </div>`).join('');
  const histBlock = hist
    ? `<p class="muted small mt">Последние попытки — чьи, не показывается:</p><div>${hist}</div>`
    : '<p class="muted small mt">К этому сейфу ещё никто не подходил.</p>';

  if (sf.state === 'locked') {
    safeHtml = `
      <div class="sf-mask">${maskHtml}</div>
      <p class="center"><b class="gold">Сейф вскрыт!</b></p>
      ${sf.last ? `<p class="muted small center">Взял <b>${UI.esc(sf.last.name)}</b> с ${sf.last.attempts}-й попытки мира.</p>` : ''}
      <p class="muted small center mt">Новый сейф привезут через <b>${UI.fmtTimer(sf.lockedSec)}</b> — для всех сразу.</p>`;
  } else {
    safeHtml = `
      <div class="sf-mask">${maskHtml}</div>
      <p class="muted small center">Открыто цифр: <b>${sf.opened}</b> из ${sf.digits}
        · попыток мира <b>${sf.attempts}</b> · взломщиков <b>${sf.crackers}</b></p>
      <p class="muted small mt">Сейф ОДИН на всех. Любая попытка — чья угодно — навсегда
        открывает цифры, которые оказались на своём месте. В коде ${sf.digits} цифр,
        одна цифра может встретиться до ${sf.maxRepeat} раз. Вскрывшему —
        <span class="ic-gold"></span> ${sf.reward}.</p>
      ${histBlock}
      ${sf.myCooldownSec > 0
        ? `<p class="muted small mt">⏳ Отмычки остывают: <b>${UI.fmtTimer(sf.myCooldownSec)}</b></p>`
        : `<div class="field-row mt">
             <input type="text" id="safe-guess" maxlength="${sf.digits}" inputmode="numeric"
               placeholder="${'0'.repeat(sf.digits)}" class="sf-input" style="flex:1">
             <button class="btn btn-orange btn-inline" id="safe-go">Ввести</button>
           </div>
           <p class="muted small">Между попытками — ${sf.tryCdSec} с. После ввода вам лично
             скажут, сколько цифр есть в коде, но стоят не на своём месте.</p>`}`;
  }

  // ── 3. НОЧНОЙ РЕЙД ────────────────────────────────────────────
  let raidHtml;
  const rd = data.raid;
  if (rd.state === 'active') {
    raidHtml = `
      <p class="small">Взято рубежей: <b class="gold">${rd.step}</b> из ${rd.total}
        · добыча при отходе: <span class="ic-gold"></span> <b>${rd.loot}</b></p>
      ${rd.atEnd
        ? '<p class="muted small">Рубежи кончились — отходите, дальше идти некуда.</p>'
        : `<p class="muted small">Следующий рубеж: риск сорваться <b style="color:var(--red)">${rd.nextRisk}%</b>,
             добыча вырастет до <span class="ic-gold"></span> <b>${rd.nextLoot}</b>.
             Сорвались — теряете всё набранное.</p>`}
      <div class="field-row mt">
        ${rd.atEnd ? '' : '<button class="btn btn-inline grow" id="raid-push">Дальше</button>'}
        <button class="btn btn-orange btn-inline grow" id="raid-pull">Отойти с добычей</button>
      </div>`;
  } else if (rd.state === 'cooldown') {
    raidHtml = cdLine(rd.cooldownSec);
  } else {
    raidHtml = `
      <p class="muted small">Группа идёт через ${rd.total} рубежей. После каждого добыча растёт,
        но растёт и риск: сорвались — теряете всё, что набрали. Уносит только тот, кто вовремя отошёл.
        Первый рубеж: риск ${rd.firstRisk}%, добыча <span class="ic-gold"></span> ${rd.firstLoot}.
        До последнего — <span class="ic-gold"></span> ${rd.maxLoot}, если дойдёте.</p>
      <button class="btn btn-orange mt" id="raid-start">🌒 Вывести группу</button>`;
  }

  // ── 4. ВОЕННЫЕ КОСТИ ──────────────────────────────────────────
  let diceHtml;
  const dc = data.dice;
  const diceFaces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  if (dc.state === 'active') {
    const cubes = dc.dice.map((d, i) =>
      `<button class="dice-cube" data-dice="${i}" title="Нажмите, чтобы оставить/перебросить">${diceFaces[d]}</button>`).join('');
    diceHtml = `
      <p class="small">Ваш бросок: <span class="muted small">нажмите на кубики, которые ОСТАВИТЬ</span></p>
      <div class="dice-row mt">${cubes}</div>
      <p class="small mt">Комбинация: <b class="gold">${dc.combo ? dc.combo.name + ' — ' + dc.combo.gold + ' 🪙' : 'пока ничего'}</b></p>
      <p class="muted small">Перебросов осталось: <b>${dc.rerollsLeft}</b></p>
      <div class="field-row mt">
        <button class="btn btn-inline" id="dice-reroll" ${dc.rerollsLeft <= 0 ? 'disabled' : ''}>🎲 Перебросить</button>
        <button class="btn btn-orange btn-inline" id="dice-finish">✅ Забрать результат</button>
      </div>`;
  } else if (dc.state === 'cooldown') {
    diceHtml = cdLine(dc.cooldownSec);
  } else {
    diceHtml = `
      <p class="muted small">Бросьте ${dc.count} кубиков и соберите комбинацию за ${dc.rerolls} переброса. Награда <span class="ic-gold"></span> ${dc.rewardMin}–${dc.rewardMax}.</p>
      <div class="muted small mt">${dc.payouts.map(p => `${p.name} — 🪙 ${p.gold}`).join('<br>')}</div>
      <button class="btn btn-orange mt" id="dice-start">Бросить кости</button>`;
  }

  // ── 5. ШТАБНОЙ АУКЦИОН ────────────────────────────────────────
  let bidsHtml;
  const bd = data.bids;
  if (bd.state === 'cooldown') {
    bidsHtml = cdLine(bd.cooldownSec);
  } else {
    bidsHtml = `
      <p class="muted small">У вас <b class="gold">${bd.points}</b> очков влияния. Распределите их между лотами втёмную — против ${bd.rivals} генералов. Лот забирает тот, кто поставил больше (при равенстве лот уходит казне).</p>
      <p class="muted small">За лот <span class="ic-gold"></span> ${bd.perLot}, за все сразу +<span class="ic-gold"></span> ${bd.sweepBonus}.</p>
      ${bd.lots.map((name, i) => `
        <div class="field-row mt">
          <span class="grow small">${UI.esc(name)}</span>
          <input type="number" class="bids-input" data-bid="${i}" min="0" max="${bd.points}" value="0" style="width:80px">
        </div>`).join('')}
      <p class="small mt">Распределено: <b id="bids-total">0</b> / ${bd.points}</p>
      <button class="btn btn-orange mt" id="bids-go" style="width:100%">💼 Сделать ставки</button>`;
  }


  // ── ВОЕННЫЙ ЗАЙМ (лотерея) ────────────────────────────────────
  // Главное на карточке — банк и шанс. Оба считает сервер; здесь их
  // только показываем, чтобы клиент и сервер не разошлись в арифметике.
  const lotHtml = `
    <div class="lot-pot">
      <div class="lot-pot-num"><span class="ic-gold"></span> ${UI.fmtNum(lot.pot)}</div>
      <div class="muted small">банк тиража — уйдёт одному победителю</div>
    </div>
    <div class="field-row mt">
      <span class="grow small">Продано билетов</span>
      <b>${lot.sold} / ${lot.maxTickets}</b>
    </div>
    <div class="cap-bar mt"><i style="width:${lot.maxTickets ? Math.min(100, Math.round(lot.sold / lot.maxTickets * 100)) : 0}%"></i></div>
    <div class="field-row mt">
      <span class="grow small">Ваши билеты</span>
      <b class="gold">${lot.myTickets}</b>
      <span class="small muted">шанс ${lot.myChancePct}%</span>
    </div>
    <p class="muted small mt">Шанс — это доля ваших билетов среди проданных.
      Купили 1 из 10 проданных — 10%. Купили 1 из 1000 — 0.1%.
      Чем больше продано, тем дороже стоит один и тот же шанс.</p>
    <p class="muted small">До розыгрыша: <b>${UI.fmtTimer(lot.secondsLeft)}</b>
      · билет <span class="ic-gold"></span> ${lot.ticketGold}
      · не больше ${lot.maxPerPlayer} в одни руки${lot.myLeft <= 0 ? ' <b>(предел выбран)</b>' : ''}</p>
    ${lot.left <= 0 ? '<p class="muted small"><b>Билеты кончились</b> — ждём розыгрыша.</p>' : `
    <div class="field-row mt">
      <input type="number" id="lot-count" class="field" min="1" max="${Math.max(1, Math.min(lot.myLeft, lot.left))}" value="1" style="width:90px">
      <button class="btn btn-orange btn-inline grow" id="lot-buy" ${lot.myLeft <= 0 ? 'disabled' : ''}>🎟 Купить билеты</button>
    </div>`}
    ${lot.last ? `<p class="muted small mt">Прошлый тираж: ${lot.last.winnerName
      ? `выиграл <b>${UI.esc(lot.last.winnerName)}</b> — <span class="ic-gold"></span> ${UI.fmtNum(lot.last.pot)} (билетов ${lot.last.winnerTickets} из ${lot.last.sold})`
      : 'билеты не покупали, розыгрыша не было'}</p>` : ''}`;

  // ── ТАКТИЧЕСКАЯ ДУЭЛЬ ─────────────────────────────────────────
  let tacticHtml;
  const dl = data.tactic;
  const kindBtn = (k) => `<button class="btn btn-inline tactic-kind" data-kind="${k.id}">${k.icon} ${UI.esc(k.name)}</button>`;
  const roundRow = (r, kinds) => {
    const nm = (id) => { const k = kinds.find((x) => x.id === id); return k ? k.icon + ' ' + k.name : id; };
    const mark = r.res === 'win' ? '<b class="gold">победа</b>' : (r.res === 'lose' ? '<b style="color:var(--red)">поражение</b>' : 'ничья');
    return `<div class="field-row small"><span class="grow">${nm(r.mine)} против ${nm(r.foe)}</span>${mark}</div>`;
  };
  if (dl.state === 'active') {
    tacticHtml = `
      <p class="small">Счёт: <b class="gold">${dl.my}</b> : <b>${dl.foe}</b> (до ${dl.needed} побед)</p>
      ${dl.rounds.length ? `<div class="mt">${dl.rounds.map((r) => roundRow(r, dl.kinds)).join('')}</div>` : ''}
      <p class="muted small mt">Генерал — человек привычки: он повторяет то, чем выиграл,
        и уходит от того, чем проиграл. История выше — это подсказка.</p>
      <div class="field-row mt">${dl.kinds.map(kindBtn).join('')}</div>`;
  } else if (dl.state === 'cooldown') {
    tacticHtml = cdLine(dl.cooldownSec);
  } else {
    tacticHtml = `
      <p class="muted small">Три рода войск бьют друг друга по кругу:
        ${dl.kinds.map((k) => `${k.icon} ${UI.esc(k.name)} — ${UI.esc(k.note)}`).join('; ')}.
        До ${dl.needed} побед. Награда <span class="ic-gold"></span> ${dl.rewardMin}–${dl.rewardMax}:
        чем чище разгром, тем больше.</p>
      <button class="btn btn-orange mt" id="tactic-start">⚔ Вызвать генерала</button>`;
  }

  // ── Суточный предел: виден всегда ────────────────────────────
  // Скрытый потолок читается как поломка — «выиграл, а золото не дали».
  // Поэтому остаток показан числом и полосой ещё до первой партии.
  const bg = data.budget || { cap: 0, spent: 0, left: 0 };
  const pct = bg.cap > 0 ? Math.min(100, Math.round((bg.spent / bg.cap) * 100)) : 0;
  const capHtml = `
    <div class="card">
      <div class="field-row"><span class="grow small">Суточный предел клуба</span>
        <b class="${bg.left > 0 ? 'gold' : 'muted'}">${bg.spent} / ${bg.cap} <span class="ic-gold"></span></b></div>
      <div class="cap-bar mt"><i style="width:${pct}%"></i></div>
      <p class="muted small mt">${bg.left > 0
        ? 'Осталось <b>' + bg.left + '</b> — сбрасывается в полночь по Москве.'
        : 'Предел исчерпан. Играть можно, золото снова пойдёт после полуночи по Москве.'}</p>
      ${data.sharedCooldownSec > 0
        ? '<p class="muted small">⏳ Перерыв после выигрыша: ' + UI.fmtTimer(data.sharedCooldownSec) + '</p>' : ''}
    </div>`;

  c.innerHTML = `
    <div class="title">Клуб офицеров</div>
    <p class="muted small" style="margin:-4px 4px 10px">Игры на удачу и смекалку. После каждого выигрыша — общий перерыв.</p>
    ${capHtml}
    <div class="card"><div class="name">🎟 Военный займ</div><div class="mt">${lotHtml}</div></div>
    <div class="card"><div class="name">⚔ Тактическая дуэль</div><div class="mt">${tacticHtml}</div></div>
    <div class="card"><div class="name">🗝 Сейф штаба</div><div class="mt">${safeHtml}</div></div>
    <div class="card"><div class="name">🃏 Военный преферанс</div><div class="mt">${prefHtml}</div></div>
    <div class="card"><div class="name">🌒 Ночной рейд</div><div class="mt">${raidHtml}</div></div>
    <div class="card"><div class="name">🎲 Военные кости</div><div class="mt">${diceHtml}</div></div>
    <div class="card"><div class="name">💼 Штабной аукцион</div><div class="mt">${bidsHtml}</div></div>`;

  // ── Обработчики ──
  // Преферанс
  if (R('pref-start')) R('pref-start').onclick = async () => {
    App._prefLast = null;              // новая партия — старый итог убираем
    App._prefSeen = null;              // и раздаём заново, с анимацией
    if (await post('/api/club/pref/start')) App.rerender();
  };
  if (R('pref-hit')) R('pref-hit').onclick = async () => {
    const r = await post('/api/club/pref/hit');
    if (r && r.result === 'bust') {
      App._prefLast = { result: 'bust', mySum: r.sum, foeSum: r.foeSum, hand: r.hand, foe: r.foe };
      UI.toast(`🃏 Перебор! ${r.sum} больше 21.`);
    }
    await App.refreshMe(); App.rerender();
  };
  if (R('pref-stand')) R('pref-stand').onclick = async () => {
    const r = await post('/api/club/pref/stand');
    if (r) {
      App._prefLast = { result: r.result, mySum: r.mySum, foeSum: r.foeSum,
                        hand: r.hand, foe: r.foe, reward: r.reward || 0 };
      if (r.result === 'lose') UI.toast(`🃏 Генерал сильнее: ${r.mySum} против ${r.foeSum}.`);
    }
    await App.refreshMe(); App.rerender();
  };
  // Сейф: общий на весь мир, «начать» его нельзя
  if (R('safe-go')) R('safe-go').onclick = async () => {
    const r = await post('/api/club/safe/try', { guess: R('safe-guess').value });
    if (r && r.result === 'win') UI.toast(`🗝 Сейф ваш! Код ${r.code}. +🪙 ${r.reward}`);
    // Личная подсказка: сколько цифр есть в коде, но не на своём месте.
    // Общей её делать нельзя — вместе с общей маской это выдало бы код.
    if (r && r.result === 'miss') {
      UI.toast(r.cows > 0
        ? `🔄 Не на своём месте: ${r.cows}` + (r.bulls ? ` · открыто новых: ${r.bulls}` : '')
        : (r.bulls ? `🎯 На своём месте: ${r.bulls}` : '❌ Ни одной цифры из кода'));
    }
    await App.refreshMe(); App.rerender();
  };
  const safeInput = R('safe-guess');
  if (safeInput) safeInput.onkeydown = (e) => { if (e.key === 'Enter' && R('safe-go')) R('safe-go').click(); };

  // Ночной рейд
  if (R('raid-start')) R('raid-start').onclick = async () => { if (await post('/api/club/raid/start')) App.rerender(); };
  if (R('raid-push')) R('raid-push').onclick = async () => {
    const r = await post('/api/club/raid/push');
    if (r && r.result === 'lost') UI.toast(`💥 Сорвались на ${r.step}-м рубеже. Потеряно ${r.lostLoot} 🪙 добычи.`);
    await App.refreshMe(); App.rerender();
  };
  if (R('raid-pull')) R('raid-pull').onclick = async () => {
    const r = await post('/api/club/raid/pull');
    if (r && r.result === 'home') UI.toast(`🌒 Группа вернулась. +🪙 ${r.reward}`);
    if (r && r.result === 'empty') UI.toast('Группа вернулась ни с чем — рубежей не взяли.');
    await App.refreshMe(); App.rerender();
  };
  // Кости: клик по кубику — оставить/перебросить (визуальная отметка)
  c.querySelectorAll('[data-dice]').forEach((btn) => {
    btn.onclick = () => btn.classList.toggle('dice-keep');
  });
  if (R('dice-start')) R('dice-start').onclick = async () => { if (await post('/api/club/dice/start')) App.rerender(); };
  if (R('dice-reroll')) R('dice-reroll').onclick = async () => {
    const keep = [...c.querySelectorAll('[data-dice].dice-keep')].map((b) => b.dataset.dice);
    await post('/api/club/dice/reroll', { keep });
    App.rerender();
  };
  if (R('dice-finish')) R('dice-finish').onclick = async () => {
    const r = await post('/api/club/dice/finish');
    if (r && r.result === 'nothing') UI.toast('🎲 Комбинация не собралась. В другой раз!');
    await App.refreshMe(); App.rerender();
  };
  // Лотерея
  if (R('lot-buy')) R('lot-buy').onclick = async () => {
    const n = parseInt((R('lot-count') || {}).value, 10) || 1;
    const r = await post('/api/lottery/buy', { count: n });
    if (r) await App.refreshMe();
    App.rerender();
  };
  // Тактическая дуэль
  if (R('tactic-start')) R('tactic-start').onclick = async () => {
    if (await post('/api/club/tactic/start')) App.rerender();
  };
  [...c.querySelectorAll('.tactic-kind')].forEach((el) => {
    el.onclick = async () => {
      const r = await post('/api/club/tactic/play', { kind: el.dataset.kind });
      if (r && r.result === 'draw') UI.toast('⚔ Ничья — раунд переигрывается');
      if (r && r.result === 'lose' && r.foe >= 3) UI.toast('⚔ Дуэль проиграна. Генерал разгадал вас.');
      await App.refreshMe(); App.rerender();
    };
  });
  // ── Раздача карт: анимируем ТОЛЬКО новые ──────────────────────
  // Экран перерисовывается целиком после каждого действия. Если
  // анимировать все карты подряд, вся рука заново «прилетала» бы на
  // каждый добор — и разобрать, какая карта пришла сейчас, стало бы
  // невозможно. Поэтому помним, что уже показывали.
  const seen = App._prefSeen instanceof Set ? App._prefSeen : new Set();
  let fresh = 0;
  c.querySelectorAll('.pf-card').forEach((el) => {
    const cid = el.dataset.cid;
    if (seen.has(cid)) return;
    seen.add(cid);
    el.classList.add('pf-deal');
    // Задержка по порядку: карты ложатся одна за другой, а не разом
    el.style.animationDelay = (fresh++ * 110) + 'ms';
    const back = el.querySelector('.pf-back');
    if (back) back.style.animationDelay = (fresh * 110 - 110) + 'ms';
  });
  App._prefSeen = seen;

  // Аукцион: живой счётчик распределённых очков
  const bidInputs = [...c.querySelectorAll('.bids-input')];
  const recount = () => {
    const sum = bidInputs.reduce((s2, el) => s2 + (parseInt(el.value, 10) || 0), 0);
    if (R('bids-total')) R('bids-total').textContent = sum;
  };
  bidInputs.forEach((el) => el.oninput = recount);
  if (R('bids-go')) R('bids-go').onclick = async () => {
    const bids = bidInputs.map((el) => parseInt(el.value, 10) || 0);
    const r = await post('/api/club/bids/play', { bids });
    if (r && r.result === 'lost') UI.toast('💼 Все лоты ушли генералам. Не в этот раз.');
    if (r && r.result === 'win') UI.toast(`💼 Выиграно лотов: ${r.won}. +🪙 ${r.reward}`);
    await App.refreshMe(); App.rerender();
  };
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
  // У «текстовых» трофеев (спутник, медвежатник, растяжка) значение уже
  // содержит проценты внутри — второй знак приводил к «окно 5%, успех 20%%»
  const bonusStr = (t, val) => ((t.spy || t.bankHack || t.mine) ? UI.esc(String(val)) : `${val}%`);

  c.innerHTML = `
    <div class="title">Трофеи</div>
    ${UI.saleBanner(data.discount)}
    <div class="card"><p class="muted small">
      Уникальные предметы с прокачкой до ${data.maxLevel} уровня. Время прокачки
      растёт с уровнем (у некоторых трофеев — дольше). Ускорение стоит
      10 <span class="ic-gold"></span> за каждый час прокачки (мгновенно). Помеченные
      «🔧 в разработке» эффекты — декоративные.</p>
    </div>
    ${data.trophies.map((t) => `
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px">
          ${App.trophyImg(t.id, 44)}
          <div class="grow">
            <div class="name">${UI.esc(t.name)} <span class="muted">ур. ${t.level}/${data.maxLevel}</span>${t.flavor ? ' <span class="badge">🔧 в разработке</span>' : ''}${t.spy ? ' <span class="badge">🛰 разведка</span>' : ''}</div>
            <p class="muted small">${UI.esc(t.desc)}</p>
          </div>
        </div>
        <div class="mt">${UI.bar(t.level, data.maxLevel, 'gold', `${t.level} / ${data.maxLevel}`)}</div>
        ${t.level > 0
          ? `<p class="small mt">${t.spy ? 'Сейчас раскрывает' : ((t.bankHack || t.mine) ? 'Сейчас' : 'Текущий бонус')}: <b class="gold">${bonusStr(t, t.bonusNow)}</b></p>`
          : ''}
        ${t.training
          ? `<div class="mt">${UI.bar(
              t.totalSec - t.secondsLeft,
              t.totalSec,
              'xp',
              t.secondsLeft > 0 ? '⏳ Прокачка: ' + UI.fmtTimer(t.secondsLeft) : 'Готово, обновите страницу'
            )}</div>
            <button class="btn mt" data-tboost="${t.id}">⚡ Ускорить за <span class="ic-gold"></span> ${UI.fmtNum(t.boostGold)}</button>`
          : (t.nextCost !== null
              ? `<p class="small mt">${t.spy ? 'Станет раскрывать' : ((t.bankHack || t.mine) ? 'Станет' : 'Будущий бонус')}: <b>${bonusStr(t, t.bonusNext)}</b></p>
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
  // Подписчик лечится вне очереди, пока есть суточные лечения: сервер
  // уже обнулил ожидание, здесь только подписываем это на экране
  const vipSkip = (data.vipHealsLeft || 0) > 0 && (data.cooldownRaw || 0) > 0;

  c.innerHTML = `
    <div class="title">Полевой госпиталь</div>
    <div class="card center">
      <p style="font-size:40px">🏥</p>
      <p class="muted small">Полное восстановление здоровья за доллары. Цена растёт с уровнем — берегите бойцов, лечение дорогое. Лечиться можно раз в 5 минут.${(data.vipHealsLeft || 0) > 0 ? ' По VIP-подписке доступно ' + data.vipHealsLeft + ' лечений вне очереди сегодня.' : ''}</p>
    </div>
    <div class="card">
      <div class="kv"><span class="k"><span class="ic-health"></span> Здоровье</span><span class="v">${data.hp} / ${data.maxHp}</span></div>
      <div class="kv"><span class="k">Наличные</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtMoney(data.dollars)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">Полное восстановление</span><span class="v">${UI.priceWithSale(data.baseFullHeal, data.fullHeal, '<span class="ic-dollar"></span>')}</span></div>
      ${onCooldown ? `<div class="kv"><span class="k">⏳ До следующего лечения</span><span class="v" style="color:var(--orange)">${UI.fmtTimer(data.cooldownLeft)}</span></div>` : ''}
      ${vipSkip ? `<div class="kv"><span class="k"><span class="vip-mark">VIP</span> Лечений вне очереди</span><span class="v gold">${data.vipHealsLeft} на сегодня</span></div>` : ''}
      <button class="btn btn-orange mt" id="hp-heal" ${!needsHeal || onCooldown || data.dollars < data.fullHeal ? 'disabled' : ''}>
        ${!needsHeal ? 'Здоровье в норме' : onCooldown ? `Лечение через ${UI.fmtTimer(data.cooldownLeft)}` : (data.dollars < data.fullHeal ? 'Не хватает денег' : (vipSkip ? 'Вылечиться вне очереди' : 'Полностью вылечиться'))}
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
