// ===================================================================
// public/js/admin2/econ.js — экономика #/econ?t=discounts
//
// Раздел собирает бывшие вкладки про одно и то же — раздачу благ:
// массовая выдача, наёмники, наборы, акции, бонусы. Подвкладка теперь
// в адресе: «глянь акции» пересылается ссылкой, а F5 не выкидывает
// на первую подвкладку из списка.
//
// Каждая подвкладка рисуется своей старой функцией (renderTools,
// renderMercs, renderOffers, renderDiscounts, renderBuffs) — они и так
// принимают контейнер, переписывать там нечего. Список подвкладок
// приходится держать здесь ЗАНОВО, и это уже стоило одной пропажи:
// конструктор наборов был в старой панели, а в этот список не попал —
// собрать предложение стало негде.
//
// Важная тонкость с правами: вход в раздел даёт ЛЮБОЕ из двух прав
// («Ресурсы» или «Акции»), а подвкладки требуют своё. Сотруднику,
// которому выдали только акции, показываем только их — и сразу,
// а не «первую из списка, которая всё равно закрыта».
// ===================================================================

(function () {
  const SUBS = [
    { id: 'tools', label: '🎁 Массовая выдача', zone: 'economy', fn: 'renderTools' },
    { id: 'mercs', label: '🥷 Наёмники', zone: 'economy', fn: 'renderMercs' },
    { id: 'offers', label: '🎁 Наборы', zone: 'economy', fn: 'renderOffers' },
    { id: 'discounts', label: '🏷 Акции', zone: 'discounts', fn: 'renderDiscounts' },
    { id: 'buffs', label: '🎉 Бонусы', zone: 'economy', fn: 'renderBuffs' },
    { id: 'donate', label: '💳 Бонусы к покупкам', zone: 'discounts', fn: 'renderDonateBonus' },
    { id: 'giveaways', label: '🎁 Раздачи наград', zone: 'economy', fn: 'renderGiveaways' },
  ];

  // ── Бонусы к покупкам за рубли ─────────────────────────────────
  // Заготовки — ровно четыре частых случая, чтобы не собирать их руками.
  const DB_LIMIT = { first: 'За первое пополнение', once: 'Один раз на игрока', daily: 'Несколько раз в день', every: 'К каждой покупке' };
  const DB_PRESETS = [
    { title: 'Первое пополнение', kind: 'gold', pct: 100, limit: 'first' },
    { title: 'Двойное золото — один раз', kind: 'gold', pct: 100, limit: 'once' },
    { title: 'Ускорение опыта за покупку', kind: 'xp', pct: 100, limit: 'daily', perDay: 5, hours: 1, target: 'all' },
    { title: 'Опыт ×2 на сутки', kind: 'xp', pct: 100, limit: 'every', hours: 24, target: 'all' },
  ];
  const inStyle = 'padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font:inherit';
  const toLocal = (ms) => (ms ? new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const fromLocal = (v) => (v ? new Date(v).getTime() : 0);
  const dtShort = (ms) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  Admin.renderDonateBonus = async function (box, editId) {
    box.innerHTML = '<div class="loading">Загружаю…</div>';
    let d = null;
    try { d = await API.get('/api/admin/donate-bonuses'); }
    catch (e) { box.innerHTML = `<div class="a2-card"><p class="a2-muted">${UI.esc(e.message)}</p></div>`; return; }
    const list = d.promos || [];
    const cur = list.find((p) => p.id === editId) || null;
    const v = cur || { title: '', kind: 'gold', pct: 100, limit: 'first', perDay: 5, hours: 24, target: 'all', startAt: 0, endAt: 0, enabled: true };
    const opt = (val, label, sel) => `<option value="${val}"${val === sel ? ' selected' : ''}>${label}</option>`;
    const period = (p) => `${p.startAt ? 'с ' + dtShort(p.startAt) : 'сразу'} · ${p.endAt ? 'до ' + dtShort(p.endAt) : 'бессрочно'}`;
    box.innerHTML = `
      <div class="a2-card">
        <h3>Бонусы к покупкам за рубли</h3>
        <p class="a2-muted">Игрок видит бонус в банке до оплаты и получает его при зачислении покупки. Условия
          уходят в заказ в момент его создания: изменить или удалить акцию можно когда угодно — уже оформленные заказы
          получат обещанное. Бонус к золоту складывается с акцией «Бонус к покупаемому золоту» и VIP. Ускорение опыта
          при повторной покупке продлевается, а не складывается (не дольше месяца вперёд).</p>
        <div class="a2-row">${DB_PRESETS.map((p, i) => `<button class="btn btn-inline" data-preset="${i}">${UI.esc(p.title)}</button>`).join('')}</div>
      </div>
      <div class="a2-card">
        <h3>${cur ? 'Изменить акцию' : 'Новая акция'}</h3>
        <div class="db-grid">
          <label>Название — его видят игроки<input id="db-title" maxlength="60" style="${inStyle}" value="${UI.esc(v.title)}"></label>
          <label>Что даёт<select id="db-kind" style="${inStyle}">${opt('gold', '+% к золоту пакета', v.kind)}${opt('xp', 'Ускорение опыта', v.kind)}</select></label>
          <label>Процент (1–300)<input id="db-pct" type="number" min="1" max="300" style="${inStyle}" value="${v.pct}"></label>
          <label>Как часто<select id="db-limit" style="${inStyle}">${Object.keys(DB_LIMIT).map((k) => opt(k, DB_LIMIT[k], v.limit)).join('')}</select></label>
          <label data-db="daily">Сколько раз в день<input id="db-perday" type="number" min="1" max="50" style="${inStyle}" value="${v.perDay || 5}"></label>
          <label data-db="xp">Ускорение на, часов (1–720)<input id="db-hours" type="number" min="1" max="720" style="${inStyle}" value="${v.hours || 24}"></label>
          <label data-db="xp">К каким покупкам<select id="db-target" style="${inStyle}">${opt('all', 'к любым', v.target)}${opt('gold', 'к пакетам золота', v.target)}${opt('offers', 'к наборам', v.target)}</select></label>
          <label>Начало — пусто, если сразу<input id="db-start" type="datetime-local" style="${inStyle}" value="${toLocal(v.startAt)}"></label>
          <label>Конец — пусто, если бессрочно<input id="db-end" type="datetime-local" style="${inStyle}" value="${toLocal(v.endAt)}"></label>
          <label class="db-check"><span><input id="db-enabled" type="checkbox" ${v.enabled ? 'checked' : ''}> Акция включена</span></label>
        </div>
        <div class="a2-row" style="margin-top:10px">
          <button class="btn btn-orange btn-inline" id="db-save">💾 Сохранить</button>
          ${cur ? '<button class="btn btn-inline" id="db-cancel">Отмена</button>' : ''}
        </div>
      </div>
      <div class="a2-card">
        <h3>Акции (${list.length})</h3>
        ${list.length ? `<div style="overflow-x:auto"><table class="a2-table">
          <thead><tr><th>Акция</th><th>Условия</th><th>Срок</th><th class="num">Выдано</th><th>Статус</th><th></th></tr></thead>
          <tbody>${list.map((p) => `<tr>
            <td><b>${UI.esc(p.title)}</b><div class="a2-muted">${UI.esc(p.byName || '')}</div></td>
            <td>${UI.esc(p.text)}</td>
            <td class="a2-muted">${period(p)}</td>
            <td class="num">${p.applied || 0}</td>
            <td>${p.live ? '<span class="a2-pill is-ok">идёт</span>' : (p.enabled ? '<span class="a2-pill">не в сроке</span>' : '<span class="a2-pill is-bad">выключена</span>')}</td>
            <td class="nowrap"><button class="btn btn-inline" data-db-edit="${UI.esc(p.id)}">✏️</button>
              <button class="btn btn-inline" data-db-del="${UI.esc(p.id)}">🗑</button></td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="a2-muted">Акций пока нет — начните с заготовки выше.</p>'}
      </div>`;

    const $ = (id) => document.getElementById(id);
    const sync = () => {
      const xp = $('db-kind').value === 'xp';
      box.querySelectorAll('[data-db="xp"]').forEach((x) => { x.style.display = xp ? '' : 'none'; });
      box.querySelectorAll('[data-db="daily"]').forEach((x) => { x.style.display = $('db-limit').value === 'daily' ? '' : 'none'; });
    };
    $('db-kind').onchange = sync;
    $('db-limit').onchange = sync;
    sync();
    box.querySelectorAll('[data-preset]').forEach((b) => {
      b.onclick = () => {
        const p = DB_PRESETS[Number(b.dataset.preset)];
        $('db-title').value = p.title; $('db-kind').value = p.kind; $('db-pct').value = p.pct; $('db-limit').value = p.limit;
        if (p.perDay) $('db-perday').value = p.perDay;
        if (p.hours) $('db-hours').value = p.hours;
        if (p.target) $('db-target').value = p.target;
        sync();
      };
    });
    $('db-save').onclick = async () => {
      try {
        await API.post('/api/admin/donate-bonus/save', {
          id: cur ? cur.id : '', title: $('db-title').value.trim(), kind: $('db-kind').value,
          pct: Number($('db-pct').value), limit: $('db-limit').value, perDay: Number($('db-perday').value),
          hours: Number($('db-hours').value), target: $('db-target').value,
          startAt: fromLocal($('db-start').value), endAt: fromLocal($('db-end').value), enabled: $('db-enabled').checked,
        });
        UI.toast('🎁 Акция сохранена');
        Admin.renderDonateBonus(box);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const cancel = $('db-cancel');
    if (cancel) cancel.onclick = () => Admin.renderDonateBonus(box);
    box.querySelectorAll('[data-db-edit]').forEach((b) => { b.onclick = () => Admin.renderDonateBonus(box, b.dataset.dbEdit); });
    box.querySelectorAll('[data-db-del]').forEach((b) => {
      b.onclick = async () => {
        if (!await UI.confirm('Удалить акцию? Заказы, оформленные до удаления, всё равно получат обещанный бонус.',
          { title: 'Удаление акции', icon: '🗑', okText: 'Удалить', danger: true })) return;
        try { await API.post('/api/admin/donate-bonus/delete', { id: b.dataset.dbDel }); Admin.renderDonateBonus(box); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
  };

  // ── Раздачи наград к праздникам и событиям ─────────────────────
  // Состав награды собирается теми же позициями, что и наборы
  // «Спецпредложений» (palette с сервера): золото, деньги, жетоны, очки,
  // опыт, VIP, наёмник, контейнер, техника.
  const GW_IN = 'padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font:inherit';
  const gwLocal = (ms) => (ms ? new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const gwFromLocal = (v) => (v ? new Date(v).getTime() : 0);

  // Одна строка состава. Поля зависят от вида позиции: «золото» просит
  // количество, VIP — дни, наёмник — кого и на сколько дней.
  function gwItemRow(pal, it) {
    const t = (it && it.type) || 'gold';
    const opt = (v, label, sel) => `<option value="${v}"${String(v) === String(sel) ? ' selected' : ''}>${UI.esc(label)}</option>`;
    return `<div class="gw-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
      <select class="gw-type" style="${GW_IN}">${pal.types.map((x) => opt(x.id, x.name, t)).join('')}</select>
      <select class="gw-merc" style="${GW_IN};display:none">${pal.mercs.map((m) => opt(m.id, m.name, it && it.id)).join('')}</select>
      <select class="gw-cont" style="${GW_IN};display:none">${pal.containers.map((c) => opt(c.tier, c.name, it && it.tier)).join('')}</select>
      <select class="gw-unit" style="${GW_IN};display:none">${pal.units.map((x) => opt(x.id, x.name, it && it.id)).join('')}</select>
      <input class="gw-qty" type="number" min="1" style="${GW_IN};width:110px" placeholder="сколько" value="${(it && it.qty) || ''}">
      <input class="gw-days" type="number" min="1" style="${GW_IN};width:90px;display:none" placeholder="дней" value="${(it && it.days) || ''}">
      <button class="btn btn-inline gw-del">✕</button>
    </div>`;
  }
  // Показываем только те поля, которые нужны выбранному виду позиции
  function gwSyncRow(row) {
    const t = row.querySelector('.gw-type').value;
    const show = (sel, on) => { row.querySelector(sel).style.display = on ? '' : 'none'; };
    show('.gw-merc', t === 'merc');
    show('.gw-cont', t === 'container');
    show('.gw-unit', t === 'unit');
    show('.gw-qty', ['gold', 'dollars', 'tokens', 'skill', 'xp', 'container', 'unit'].indexOf(t) >= 0);
    show('.gw-days', t === 'vip' || t === 'merc');
  }
  function gwBindRows(box) {
    box.querySelectorAll('.gw-row').forEach((row) => {
      gwSyncRow(row);
      row.querySelector('.gw-type').onchange = () => gwSyncRow(row);
      row.querySelector('.gw-del').onclick = () => { row.remove(); };
    });
  }
  function gwReadRows(box) {
    const out = [];
    box.querySelectorAll('.gw-row').forEach((row) => {
      const type = row.querySelector('.gw-type').value;
      const qty = Number(row.querySelector('.gw-qty').value) || 0;
      const days = Number(row.querySelector('.gw-days').value) || 0;
      const it = { type };
      if (type === 'merc') { it.id = row.querySelector('.gw-merc').value; it.days = days; }
      else if (type === 'container') { it.tier = Number(row.querySelector('.gw-cont').value); it.qty = qty; }
      else if (type === 'unit') { it.id = row.querySelector('.gw-unit').value; it.qty = qty; }
      else if (type === 'vip') { it.days = days; }
      else { it.qty = qty; }
      out.push(it);
    });
    return out;
  }

  Admin.renderGiveaways = async function (box, editId) {
    box.innerHTML = '<div class="loading">Загружаю…</div>';
    let d = null;
    try { d = await API.get('/api/admin/giveaways'); }
    catch (e) { box.innerHTML = `<div class="a2-card"><p class="a2-muted">${UI.esc(e.message)}</p></div>`; return; }
    const list = d.giveaways || [];
    const pal = d.palette;
    const cur = list.find((g) => g.id === editId) || null;
    const v = cur || { title: '', note: '', emoji: '🎁', kind: 'once', items: [{ type: 'gold', qty: 100 }], days: [[{ type: 'gold', qty: 50 }]], startAt: 0, endAt: 0, enabled: true };
    const dt = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
    const days = (v.kind === 'daily' ? v.days : [[]]);

    box.innerHTML = `
      <div class="a2-card">
        <h3>Раздачи наград</h3>
        <p class="a2-muted">Выложенная награда появляется у всех игроков плашкой над экраном, с составом и кнопкой
          «Забрать». Разовая забирается один раз до указанного срока. Награда по дням выдаётся по списку:
          каждый московский день игрок забирает следующую. Кончился срок — плашка исчезает, забрать больше нельзя;
          уже полученное остаётся у игроков.</p>
      </div>
      <div class="a2-card">
        <h3>${cur ? 'Изменить раздачу' : 'Новая раздача'}</h3>
        <div class="db-grid">
          <label>Название — его видят игроки<input id="gw-title" maxlength="60" style="${GW_IN}" value="${UI.esc(v.title)}"></label>
          <label>Значок<input id="gw-emoji" maxlength="4" style="${GW_IN}" value="${UI.esc(v.emoji || '🎁')}"></label>
          <label>Вид<select id="gw-kind" style="${GW_IN}">
            <option value="once"${v.kind === 'once' ? ' selected' : ''}>Разовая — одна награда на игрока</option>
            <option value="daily"${v.kind === 'daily' ? ' selected' : ''}>По дням — награда каждый день</option>
          </select></label>
          <label>Начало — пусто, если сразу<input id="gw-start" type="datetime-local" style="${GW_IN}" value="${gwLocal(v.startAt)}"></label>
          <label>Забрать до<input id="gw-end" type="datetime-local" style="${GW_IN}" value="${gwLocal(v.endAt)}"></label>
          <label class="db-check"><span><input id="gw-enabled" type="checkbox" ${v.enabled ? 'checked' : ''}> Раздача включена</span></label>
        </div>
        <label class="a2-muted" style="display:block;margin-top:8px">Пояснение под названием (необязательно)
          <input id="gw-note" maxlength="300" style="${GW_IN};width:100%" value="${UI.esc(v.note || '')}"></label>
        <div id="gw-once" style="margin-top:10px">
          <div class="a2-muted">Состав награды</div>
          <div id="gw-items">${(v.items && v.items.length ? v.items : [{ type: 'gold', qty: 100 }]).map((it) => gwItemRow(pal, it)).join('')}</div>
          <button class="btn btn-inline" id="gw-add">+ позиция</button>
        </div>
        <div id="gw-daily" style="margin-top:10px">
          <div class="a2-muted">Награды по дням — день 1 достанется игроку в первый заход, день 2 на следующие сутки и так далее</div>
          <div id="gw-days">${days.map((items, i) => `
            <div class="a2-card gw-day" data-day="${i}" style="margin-top:6px">
              <div class="a2-row"><b>День ${i + 1}</b><button class="btn btn-inline gw-day-del">✕ день</button></div>
              <div class="gw-day-items">${(items || []).map((it) => gwItemRow(pal, it)).join('')}</div>
              <button class="btn btn-inline gw-day-add">+ позиция</button>
            </div>`).join('')}</div>
          <button class="btn btn-inline" id="gw-add-day" style="margin-top:6px">+ день</button>
        </div>
        <div class="a2-row" style="margin-top:10px">
          <button class="btn btn-orange btn-inline" id="gw-save">💾 Сохранить</button>
          ${cur ? '<button class="btn btn-inline" id="gw-cancel">Отмена</button>' : ''}
        </div>
      </div>
      <div class="a2-card">
        <h3>Раздачи (${list.length})</h3>
        ${list.length ? `<div style="overflow-x:auto"><table class="a2-table">
          <thead><tr><th>Награда</th><th>Вид</th><th>Срок</th><th class="num">Забрали</th><th>Статус</th><th></th></tr></thead>
          <tbody>${list.map((g) => `<tr>
            <td><b>${UI.esc(g.emoji || '🎁')} ${UI.esc(g.title)}</b><div class="a2-muted">${UI.esc((g.itemsText || []).join(', '))}</div></td>
            <td>${g.kind === 'daily' ? `по дням (${(g.days || []).length})` : 'разовая'}</td>
            <td class="a2-muted">${dt(g.startAt)} — ${g.endAt ? dt(g.endAt) : 'бессрочно'}</td>
            <td class="num">${g.taken || 0}</td>
            <td>${g.live ? '<span class="a2-pill is-ok">идёт</span>' : (g.enabled ? '<span class="a2-pill">не в сроке</span>' : '<span class="a2-pill is-bad">выключена</span>')}</td>
            <td class="nowrap"><button class="btn btn-inline" data-gw-edit="${UI.esc(g.id)}">✏️</button>
              <button class="btn btn-inline" data-gw-del="${UI.esc(g.id)}">🗑</button></td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="a2-muted">Раздач пока нет.</p>'}
      </div>`;

    const $ = (id) => document.getElementById(id);
    const syncKind = () => {
      const daily = $('gw-kind').value === 'daily';
      $('gw-once').style.display = daily ? 'none' : '';
      $('gw-daily').style.display = daily ? '' : 'none';
    };
    $('gw-kind').onchange = syncKind;
    syncKind();
    gwBindRows(box);
    $('gw-add').onclick = () => {
      $('gw-items').insertAdjacentHTML('beforeend', gwItemRow(pal, null));
      gwBindRows(box);
    };
    const bindDays = () => {
      box.querySelectorAll('.gw-day').forEach((card, i) => {
        card.querySelector('.gw-day-add').onclick = () => {
          card.querySelector('.gw-day-items').insertAdjacentHTML('beforeend', gwItemRow(pal, null));
          gwBindRows(box);
        };
        card.querySelector('.gw-day-del').onclick = () => { card.remove(); };
      });
      gwBindRows(box);
    };
    bindDays();
    $('gw-add-day').onclick = () => {
      const n = box.querySelectorAll('.gw-day').length;
      $('gw-days').insertAdjacentHTML('beforeend', `
        <div class="a2-card gw-day" data-day="${n}" style="margin-top:6px">
          <div class="a2-row"><b>День ${n + 1}</b><button class="btn btn-inline gw-day-del">✕ день</button></div>
          <div class="gw-day-items">${gwItemRow(pal, null)}</div>
          <button class="btn btn-inline gw-day-add">+ позиция</button>
        </div>`);
      bindDays();
    };
    $('gw-save').onclick = async () => {
      const kind = $('gw-kind').value;
      const body = {
        id: cur ? cur.id : '',
        title: $('gw-title').value.trim(), note: $('gw-note').value.trim(),
        emoji: $('gw-emoji').value.trim() || '🎁', kind,
        startAt: gwFromLocal($('gw-start').value), endAt: gwFromLocal($('gw-end').value),
        enabled: $('gw-enabled').checked,
        items: kind === 'once' ? gwReadRows($('gw-items')) : [],
        days: kind === 'daily' ? Array.from(box.querySelectorAll('.gw-day')).map((c) => gwReadRows(c.querySelector('.gw-day-items'))) : [],
      };
      try {
        await API.post('/api/admin/giveaway/save', body);
        UI.toast('🎁 Раздача сохранена');
        Admin.renderGiveaways(box);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const cancel = $('gw-cancel');
    if (cancel) cancel.onclick = () => Admin.renderGiveaways(box);
    box.querySelectorAll('[data-gw-edit]').forEach((b) => { b.onclick = () => Admin.renderGiveaways(box, b.dataset.gwEdit); });
    box.querySelectorAll('[data-gw-del]').forEach((b) => {
      b.onclick = async () => {
        if (!await UI.confirm('Удалить раздачу? Плашка исчезнет у всех, кто ещё не забрал награду.',
          { title: 'Удаление раздачи', icon: '🗑', okText: 'Удалить', danger: true })) return;
        try { await API.post('/api/admin/giveaway/delete', { id: b.dataset.gwDel }); Admin.renderGiveaways(box); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
  };

  function render(el, route) {
    const subs = SUBS.filter((s) => A2.can(s.zone));
    if (!subs.length) {
      el.innerHTML = `<div class="a2-title">Экономика</div>
        <div class="a2-card"><p class="a2-muted">Раздел закрыт: нужны права «Ресурсы» или «Акции».</p></div>`;
      return;
    }
    const cur = subs.some((s) => s.id === route.query.t) ? route.query.t : subs[0].id;

    el.innerHTML = `
      <div class="a2-title">Экономика</div>
      <div class="a2-card">
        <div class="a2-row">
          ${subs.map((s) => `<button class="btn btn-inline ${cur === s.id ? 'btn-orange' : ''}"
            data-t="${s.id}">${s.label}</button>`).join('')}
        </div>
      </div>
      <div id="econ-body" class="a2-legacy"></div>`;

    el.querySelectorAll('[data-t]').forEach((b) => {
      b.onclick = () => A2Router.setQuery({ t: b.dataset.t });
    });

    const body = document.getElementById('econ-body');
    const sub = subs.find((s) => s.id === cur);
    return Admin[sub.fn](body);
  }

  A2.screens.econ = render;
})();
