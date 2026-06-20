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
          <div class="name">${UI.esc(x.name)}</div>
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
        <div class="card">
          <div class="name">📦 ${UI.esc(x.name)}</div>
          <div class="muted small">Шанс разработки: <b class="gold">${x.chance}%</b> · цена за 1 шт: ${UI.priceWithSale(x.baseGold, x.gold, '<span class="ic-gold"></span>', UI.fmtNum)}</div>
          <div class="btn-row mt">
            <button class="btn btn-orange btn-inline" data-open="${x.tier}" data-qty="1">×1</button>
            <button class="btn btn-orange btn-inline" data-open="${x.tier}" data-qty="3">×3</button>
            <button class="btn btn-orange btn-inline" data-open="${x.tier}" data-qty="5">×5</button>
          </div>
        </div>`).join('')}
      <div class="card">
        <div class="title" style="margin-top:0">Ваша коллекция</div>
        ${data.collection.map((d) => `
          <div class="list-row" style="padding:6px 0">
            <div class="grow">
              <span class="${d.count ? 'name' : 'muted'}">${UI.esc(d.name)}</span>
              <div class="muted small">⚔ ${UI.fmtNum(d.atkNow)} · 🛡 ${UI.fmtNum(d.defNow)}</div>
            </div>
            <span class="${d.count ? 'gold' : 'muted'}">×${d.count}</span>
          </div>`).join('')}
        <hr class="hr">
        <div class="list-row" style="padding:6px 0">
          <div class="grow">
            <span class="gold">🛸 ${UI.esc(data.superSecret.name)}</span>
            <div class="muted small">⚔ ${UI.fmtNum(data.superSecret.atkNow)} · 🛡 ${UI.fmtNum(data.superSecret.defNow)}</div>
          </div>
          <span class="gold">×${data.superSecret.count}</span>
        </div>
      </div>
      <div class="card">
        <div class="title" style="margin-top:0">📜 История последних открытий</div>
        ${history.length === 0 ? '<p class="muted small center">Вы ещё не открывали контейнеры.</p>' : history.map((h) => `
          <div class="list-row" style="padding:6px 0">
            <div class="grow">
              <span class="small">${UI.esc(h.tierName)} ×${h.qty}</span>
              <div class="muted small">${UI.fmtDate(h.at)} · потрачено 🪙 ${UI.fmtNum(h.spent)}</div>
            </div>
            <span class="small">${Object.keys(h.dropped).length ? Object.entries(h.dropped).map(([n, c]) => `${UI.esc(n)}×${c}`).join(', ') : 'пусто'}</span>
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
    const flagOf = (id) => (p.countries.find((cc) => cc.id === id) || {}).flag || '';
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
      if (!confirm(`Сменить имя на «${newName}» за ${p.namePrice} золота?`)) return;
      try {
        await API.post('/api/passport/name', { newName });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('pp-country-go').onclick = async () => {
      const country = document.getElementById('pp-newcountry').value;
      if (!confirm(`Сменить гражданство на «${country.toUpperCase()}» за ${p.countryPrice} золота?`)) return;
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
    <div class="card"><p class="muted small">Уникальные командиры сдаются в аренду на ${data.rentHours} часа. Ставки золотом, шаг +10%. Перебитая ставка возвращается. Победитель определяется по истечении таймера.</p></div>
    ${data.lots.map((l) => `
      <div class="card">
        <div class="name">⭐ ${UI.esc(l.commander.name)}</div>
        <p class="muted small">${UI.esc(l.commander.desc)}</p>
        <div class="kv mt"><span class="k">Лидер</span><span class="v">${l.best ? UI.esc(l.best.name) + ' — <span class="ic-gold"></span> ' + UI.fmtNum(l.best.amount) : '<span class="muted">ставок нет</span>'}</span></div>
        <div class="kv"><span class="k">До закрытия</span><span class="v">${UI.fmtTimer(l.endsInSec)}</span></div>
        <div class="field-row mt">
          <input type="number" class="qty" style="width:110px" min="${l.minBid}" value="${l.minBid}" id="bid-${l.id}">
          <button class="btn btn-orange" data-bid="${l.id}">Ставка (мин. <span class="ic-gold"></span> ${UI.fmtNum(l.minBid)})</button>
        </div>
      </div>`).join('')}
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
App.screens.club = async (c) => {
  await App.refreshMe();
  const data = await API.get('/api/club');

  // Стенгазета (загадка)
  let riddleHtml;
  if (data.riddle.state === 'active') {
    riddleHtml = `
      <p class="story small">«${UI.esc(data.riddle.q)}»</p>
      <div class="field-row mt">
        <input type="text" id="riddle-answer" placeholder="Ваш ответ">
        <button class="btn btn-orange btn-inline" id="riddle-go">Ответить</button>
      </div>`;
  } else {
    riddleHtml = `<p class="muted center">Свежий выпуск стенгазеты через ${UI.fmtTimer(data.riddle.cooldownSec)}</p>`;
  }

  // Загадка ветерана (угадай число)
  let guessHtml;
  if (data.guess.state === 'active') {
    guessHtml = `
      <p class="small">Дедуля загадал число от 1 до ${UI.fmtNum(data.guess.range)}. Осталось попыток: <b class="gold">${data.guess.left}</b></p>
      ${data.guess.lastHint ? `<p class="small mt">Подсказка: <b>${UI.esc(data.guess.lastHint)}</b></p>` : ''}
      <div class="field-row mt">
        <input type="number" id="guess-n" min="1" placeholder="Число">
        <button class="btn btn-orange btn-inline" id="guess-go">Назвать</button>
      </div>`;
  } else if (data.guess.state === 'cooldown') {
    guessHtml = `<p class="muted center">Дедуля отдыхает ещё ${UI.fmtTimer(data.guess.cooldownSec)}</p>`;
  } else {
    guessHtml = `
      <p class="small muted">Цель игры — угадать число, которое загадал дедуля, за ${data.guess.tries} попыток. Победитель получит кучу золота (<span class="ic-gold"></span> ${data.guess.reward}). Удачи!</p>
      <button class="btn btn-orange mt" id="guess-start">Начать игру</button>`;
  }

  c.innerHTML = `
    <div class="title">Клуб офицеров</div>
    <div class="card">
      <div class="name">📰 Стенгазета</div>
      <p class="muted small">Верный ответ на загадку — <span class="ic-gold"></span> ${data.riddle.reward}.</p>
      <div class="mt">${riddleHtml}</div>
    </div>
    <div class="card">
      <div class="name">🎲 Загадка ветерана</div>
      <div class="mt">${guessHtml}</div>
    </div>
    <div class="card">
      <div class="name">💪 Армрестлинг</div>
      <p class="muted small">Ставка от $ ${UI.fmtNum(data.arm.minBet)}. Победа удваивает ставку. Жестокость укрепляет хват!</p>
      ${data.arm.cooldownSec > 0
        ? `<p class="muted center mt">Рука отдыхает ${UI.fmtTimer(data.arm.cooldownSec)}</p>`
        : `<div class="field-row mt">
            <input type="number" id="arm-bet" min="${data.arm.minBet}" value="${data.arm.minBet}">
            <button class="btn btn-orange btn-inline" id="arm-go">Бороться</button>
          </div>`}
    </div>`;

  // Обработчики мини-игр
  const r = (id) => document.getElementById(id);
  if (r('riddle-go')) r('riddle-go').onclick = async () => {
    try {
      const res = await API.post('/api/club/riddle', { answer: r('riddle-answer').value });
      if (!res.correct) UI.toast(`📰 Мимо! Правильный ответ: ${res.rightAnswer}`);
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  if (r('guess-start')) r('guess-start').onclick = async () => {
    try { await API.post('/api/club/guess/start'); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  if (r('guess-go')) r('guess-go').onclick = async () => {
    try {
      const res = await API.post('/api/club/guess', { number: r('guess-n').value });
      if (res.result === 'fail') UI.toast(`🎲 Попытки кончились. Дедуля загадал: ${res.secret}`);
      if (res.result === 'hint') UI.toast(`🎲 ${res.hint}. Осталось: ${res.left}`);
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  if (r('arm-go')) r('arm-go').onclick = async () => {
    try {
      const res = await API.post('/api/club/arm', { bet: r('arm-bet').value });
      if (!res.win) UI.toast(`💪 Хрусть… Вы проиграли $${UI.fmtNum(res.bet)}. Реванш через минуту!`);
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- ТРОФЕИ ----------
App.screens.trophies = async (c) => {
  await App.refreshMe();
  const data = await API.get('/api/trophies');

  c.innerHTML = `
    <div class="title">Трофеи</div>
    ${UI.saleBanner(data.discount)}
    <div class="card"><p class="muted small">
      Уникальные предметы с прокачкой до ${data.maxLevel} уровня. Прокачка занимает
      <b>${data.trainMinutesPerLevel} минут</b> и стоит золото. Можно ускорить за
      <span class="ic-gold"></span> ${data.boostGoldCost} (мгновенно). Помеченные
      «🔧 в разработке» эффекты — декоративные.</p>
    </div>
    ${data.trophies.map((t) => `
      <div class="card">
        <div class="name">${UI.esc(t.name)} <span class="muted">ур. ${t.level}/${data.maxLevel}</span>${t.flavor ? ' <span class="badge">🔧 в разработке</span>' : ''}</div>
        <p class="muted small">${UI.esc(t.desc)}</p>
        <div class="mt">${UI.bar(t.level, data.maxLevel, 'gold', `${t.level} / ${data.maxLevel}`)}</div>
        ${t.level > 0
          ? `<p class="small mt">Текущий бонус: <b class="gold">${t.bonusNow}%</b></p>`
          : ''}
        ${t.training
          ? `<div class="mt">${UI.bar(
              data.trainMinutesPerLevel * 60 - t.secondsLeft,
              data.trainMinutesPerLevel * 60,
              'xp',
              t.secondsLeft > 0 ? '⏳ Прокачка: ' + UI.fmtTimer(t.secondsLeft) : 'Готово, обновите страницу'
            )}</div>
            <button class="btn mt" data-tboost="${t.id}">⚡ Ускорить за <span class="ic-gold"></span> ${data.boostGoldCost}</button>`
          : (t.nextCost !== null
              ? `<p class="small mt">Будущий бонус: <b>${t.bonusNext}%</b></p>
                 <button class="btn btn-orange mt" data-tstart="${t.id}">Прокачать до ур. ${t.level + 1} за ${UI.priceWithSale(t.baseNextCost, t.nextCost, '<span class="ic-gold"></span>', UI.fmtNum)}</button>
                 <p class="muted small center mt">Прокачка займёт ${data.trainMinutesPerLevel} минут</p>`
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
    const timer = setInterval(() => App.rerender(), 10000);
    App._tear = () => clearInterval(timer);
  }
};

// ---------- ГОСПИТАЛЬ ----------
App.screens.hospital = async (c) => {
  await App.refreshMe();
  const data = await API.get('/api/hospital');
  const needsHeal = data.hp < data.maxHp;

  c.innerHTML = `
    <div class="title">Полевой госпиталь</div>
    <div class="card center">
      <p style="font-size:40px">🏥</p>
      <p class="muted small">Полное восстановление здоровья за доллары. Цена растёт с уровнем — берегите бойцов, лечение дорогое.</p>
    </div>
    <div class="card">
      <div class="kv"><span class="k">❤ Здоровье</span><span class="v">${data.hp} / ${data.maxHp}</span></div>
      <div class="kv"><span class="k">💵 У вас</span><span class="v money">$ ${UI.fmtMoney(data.dollars)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">Полное восстановление</span><span class="v">${UI.priceWithSale(data.baseFullHeal, data.fullHeal, '$')}</span></div>
      <button class="btn btn-orange mt" id="hp-heal" ${!needsHeal || data.dollars < data.fullHeal ? 'disabled' : ''}>
        ${!needsHeal ? 'Здоровье в норме' : (data.dollars < data.fullHeal ? 'Не хватает денег' : 'Полностью вылечиться')}
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
