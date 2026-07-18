// ===================================================================
// public/js/screens/saboteurs.js — вкладка «Диверсанты»
// 6 видов: наземные/морские/воздушные (снижают мощь техники врага по
// типу), секретные (мощь секретных разработок), построечные (мощь
// обороны), смертники (спасают от взрыва мины вместо мини-игры).
// ===================================================================

App.screens.saboteurs = async (c, param) => {
  await App.refreshMe();
  const data = await API.get('/api/saboteurs');
  const tab = param || 'ground';

  const tabs = [
    ['ground', 'Наземные'],
    ['sea', 'Морские'],
    ['air', 'Воздушные'],
    ['secret', 'Секретные'],
    ['building', 'Построечные'],
    ['suicide', 'Смертники'],
  ];
  const tabsHtml = `<div class="tabs" style="flex-wrap:wrap">${tabs.map(([id, label]) =>
    `<div class="tab sab-tab ${id === tab ? 'active' : ''}" onclick="location.hash='#saboteurs/${id}'">${App.sabImg(id, 20)}${label}</div>`).join('')}</div>`;

  c.innerHTML = `
    <div class="title">${App.menuImg('saboteurs', 26)} Диверсанты</div>
    <p class="muted small" style="margin:-4px 4px 10px">Диверсанты в наличии сверх лимита не работают — лежат в запасе, пока не поднят лимит. Действуют в ОБЕ стороны боя: и когда вы атакуете, и когда атакуют вас.</p>
    ${tabsHtml}
    <div id="sab-body"></div>`;

  const box = document.getElementById('sab-body');

  if (tab === 'suicide') {
    const s = data.suicide;
    box.innerHTML = `
      <div class="card">
        <div class="sab-head">${App.sabImg('suicide', 44)}<div class="name">Смертники</div></div>
        <p class="muted small">Не снижают мощь врага. Если вы наступите на растяжку — можно пожертвовать смертником вместо игры в провода и гарантированно избежать взрыва (−1 смертник за подрыв). Лимит фиксирован, апгрейда нет.</p>
        <div class="kv mt"><span class="k">В наличии</span><span class="v">${s.count} / ${s.limit}</span></div>
        <div class="kv"><span class="k">Цена за штуку</span><span class="v gold"><span class="ic-gold"></span> ${s.priceGold}</span></div>
        ${s.count < s.limit ? `
          <div class="field-row mt">
            <input type="number" id="sab-suicide-qty" min="1" max="${s.limit - s.count}" value="1" style="flex:1">
            <button class="btn btn-orange btn-inline" id="sab-suicide-buy">Купить</button>
          </div>` : `<p class="center gold mt">Максимум ✔</p>`}
      </div>`;
    const buyBtn = document.getElementById('sab-suicide-buy');
    if (buyBtn) buyBtn.onclick = async () => {
      try {
        const qty = parseInt(document.getElementById('sab-suicide-qty').value, 10) || 1;
        await API.post('/api/saboteurs/suicide/buy', { qty });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    return;
  }

  const t = data.types.find((x) => x.id === tab);
  if (!t) return;
  const targetLabel = {
    ground: 'наземной техники', sea: 'морской техники', air: 'воздушной техники',
    secret: 'секретных разработок', building: 'оборонительных построек',
  }[tab];
  box.innerHTML = `
    <div class="card">
      <div class="sab-head">${App.sabImg(tab, 44)}<div class="name">${UI.esc(t.name)}</div></div>
      <p class="muted small">Каждый работающий диверсант снижает мощь ${targetLabel} противника на 0.1% (100 шт. = −10%). Работает только количество В ПРЕДЕЛАХ лимита — излишек в запасе бездействует.</p>
      <div class="kv mt"><span class="k">В наличии</span><span class="v">${UI.fmtNum(t.count)}</span></div>
      <div class="kv"><span class="k">Лимит (работает)</span><span class="v">${UI.fmtNum(t.active)} / ${UI.fmtNum(t.limit)}</span></div>
      <div class="kv"><span class="k">Снижение мощи врага сейчас</span><span class="v gold">−${t.effectPct}%</span></div>
      <hr class="hr">
      <div class="name" style="font-size:14px">🛒 Купить пачку (${t.packSize} шт.)</div>
      <div class="kv"><span class="k">Цена пачки</span><span class="v">$${UI.fmtNum(t.packPriceDollars)}${t.packPriceGold ? ` + <span class="ic-gold"></span> ${t.packPriceGold}` : ''}</span></div>
      <div class="field-row mt">
        <input type="number" id="sab-packs" min="1" max="20" value="1" style="flex:1">
        <button class="btn btn-orange btn-inline" id="sab-buy">Купить</button>
      </div>
      <hr class="hr">
      <div class="name" style="font-size:14px">📈 Повысить лимит на +10</div>
      ${t.atMaxLimit
        ? `<p class="center gold mt">Лимит уже максимальный (${t.maxLimit}) ✔</p>`
        : `<div class="kv"><span class="k">Новый лимит будет</span><span class="v">${UI.fmtNum(t.limit + 10)} / ${UI.fmtNum(t.maxLimit)}</span></div>
           <button class="btn mt" id="sab-upgrade" style="width:100%">Повысить за <span class="ic-gold"></span> ${UI.fmtNum(t.upgradeCost)}</button>`}
    </div>`;

  const buyBtn = document.getElementById('sab-buy');
  if (buyBtn) buyBtn.onclick = async () => {
    try {
      const packs = parseInt(document.getElementById('sab-packs').value, 10) || 1;
      await API.post('/api/saboteurs/buy', { type: tab, packs });
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  const upgBtn = document.getElementById('sab-upgrade');
  if (upgBtn) upgBtn.onclick = async () => {
    try {
      await API.post('/api/saboteurs/upgrade', { type: tab });
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};
