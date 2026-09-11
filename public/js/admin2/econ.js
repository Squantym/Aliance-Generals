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
