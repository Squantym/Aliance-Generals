// ===================================================================
// public/js/admin2/network.js — адреса и устройства #/network?who=a,b
//
// Здесь отвечают на вопрос «это один человек?» и закрывают вход с
// адреса или устройства тому, кому бан аккаунта не помеха: он просто
// заводит новый.
//
// Экран нарочно показывает факты по силе, а не выносит приговор: общий
// компьютер в семье даёт те же совпадения, что и мультовод. И перед
// каждым баном показывает, кого ещё заденет, — за одним адресом бывает
// целый мобильный оператор.
//
// Диалог бана (A2Net.banDialog) общий: его зовёт и карточка игрока.
// ===================================================================

(function () {
  const dt = (ms) => (ms
    ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—');
  const esc = (s) => UI.esc(s == null ? '' : String(s));
  const inputStyle = 'padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px';

  window.A2Net = {
    // opts: { type: 'ip', value } или { type: 'device', userId, key }; targetName — для журнала
    async banDialog(opts, done) {
      const params = new URLSearchParams({
        type: opts.type, value: opts.value || '', userId: opts.userId || '', key: opts.key || '',
      });
      let pv = null;
      try { pv = await API.get('/api/admin/net-ban-preview?' + params.toString()); }
      catch (e) { UI.toast('⛔ ' + e.message); return; }
      const isIp = opts.type === 'ip';
      if (!pv.canBan) {
        UI.toast(`⛔ ${isIp ? 'Этим адресом' : 'Этим устройством'} пользуется сотрудник: ${(pv.staff || []).join(', ')}. Бан запер бы и его.`);
        return;
      }
      const who = (pv.accounts || []).map((a) => a.name).join(', ') || 'пока никто';
      const how = [pv.hasDid ? 'метке браузера' : '', pv.hasFp ? 'отпечатку (экран, пояс, ядра)' : ''].filter(Boolean).join(' и ');
      const warn = isIp
        ? 'За одним адресом бывает квартира, общежитие или мобильный оператор — бан закроет вход всем, кто за ним сидит. Лучше поставить срок.'
        : `Устройство узнаётся по ${how}. Метка снимается очисткой данных браузера; тогда сработает отпечаток. Честного владельца такой же модели телефона бан не заденет.`;
      const reason = await UI.prompt(
        `Закрыть вход с ${isIp ? 'адреса ' + pv.value : 'устройства «' + pv.label + '»'}?\n\n`
        + `С него заходили: ${who}.\n\n${warn}\n\nПричина — её увидит тот, кого не пустит в игру:`,
        { title: isIp ? 'Бан по адресу' : 'Бан по устройству', icon: '🚫', okText: 'Дальше', maxLength: 200,
          placeholder: 'Мультоводство, обход бана…' });
      if (reason === null || !String(reason).trim()) return;
      const days = await UI.prompt('На сколько дней закрыть вход? 0 — бессрочно.',
        { title: 'Срок', icon: '⏳', okText: '🚫 Закрыть вход', maxLength: 4, placeholder: '30' });
      if (days === null) return;
      try {
        await API.post('/api/admin/net-ban', {
          type: opts.type, value: pv.value, userId: opts.userId || '', key: opts.key || '',
          reason: String(reason).trim(), days: Number(days) || 0, targetName: opts.targetName || '',
        });
        UI.toast('🚫 Вход закрыт');
        if (done) done();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    },
  };

  const LEVEL = { high: 'is-bad', mid: 'is-warn', low: '', none: 'is-ok' };
  const playerLink = (w) => `<a href="${A2Router.build('player', w.id)}">${esc(w.name)}</a>`;

  function bindBans(box, refresh) {
    box.querySelectorAll('[data-ban-ip]').forEach((b) => {
      b.onclick = () => A2Net.banDialog({ type: 'ip', value: b.getAttribute('data-ban-ip') }, refresh);
    });
    box.querySelectorAll('[data-ban-dev]').forEach((b) => {
      b.onclick = () => A2Net.banDialog({
        type: 'device', key: b.getAttribute('data-ban-dev'), userId: b.getAttribute('data-ban-user'),
        targetName: b.getAttribute('data-ban-name') || '',
      }, refresh);
    });
  }

  async function renderCompare(who) {
    const box = document.getElementById('net-result');
    if (!box) return;
    box.innerHTML = '<div class="loading">Сравниваю…</div>';
    let d = null;
    try { d = await API.get('/api/admin/net-compare?who=' + encodeURIComponent(who)); }
    catch (e) { box.innerHTML = `<p class="a2-warn">${esc(e.message)}</p>`; return; }
    const canMod = A2.can('moderation');
    box.innerHTML = `
      ${d.notFound && d.notFound.length ? `<p class="a2-warn">Не найдены: ${esc(d.notFound.join(', '))}</p>` : ''}
      <h4>Вывод по парам</h4>
      <table class="a2-table">
        <thead><tr><th>Игроки</th><th class="num">Общих адресов</th><th class="num">Общих устройств</th><th class="num">Отпечатков</th><th>Что это значит</th></tr></thead>
        <tbody>${(d.pairs || []).map((p) => `<tr>
          <td>${esc(p.a)} ↔ ${esc(p.b)}</td>
          <td class="num">${p.ips}</td><td class="num">${p.dids + p.keys}</td><td class="num">${p.fps}</td>
          <td><span class="a2-pill ${LEVEL[p.level] || ''}">${esc(p.verdict)}</span></td></tr>`).join('')}</tbody>
      </table>

      <h4>Общие устройства</h4>
      ${(d.sharedDevices || []).length ? d.sharedDevices.map((g) => `
        <div class="a2-item"><div class="a2-item-ico">💻</div><div class="a2-item-txt">
          <b>${esc(g.title)}</b>
          <div class="a2-muted">${g.who.map((w) => `${playerLink(w)}: ${esc(w.label)}
            ${canMod && w.canBan ? `<button class="btn btn-inline" data-ban-dev="${esc(w.key)}" data-ban-user="${esc(w.id)}" data-ban-name="${esc(w.name)}" title="Закрыть вход с этого устройства">🚫</button>` : ''}`).join('<br>')}</div>
        </div></div>`).join('')
      : '<p class="a2-muted">Общих устройств нет.</p>'}

      <h4>Общие адреса</h4>
      ${(d.sharedIps || []).length ? `
        <table class="a2-table">
          <thead><tr><th>Адрес</th><th>Кто заходил</th><th></th></tr></thead>
          <tbody>${d.sharedIps.map((x) => `<tr>
            <td class="mono">${esc(x.ip)}</td>
            <td>${x.who.map((w) => `${playerLink(w)} ×${w.count}`).join(', ')}</td>
            <td>${canMod ? `<button class="btn btn-inline" data-ban-ip="${esc(x.ip)}" title="Закрыть вход с этого адреса">🚫</button>` : ''}</td></tr>`).join('')}</tbody>
        </table>`
      : '<p class="a2-muted">Общих внешних адресов нет.</p>'}

      <h4>По каждому игроку</h4>
      <div class="a2-grid2">${(d.players || []).map((p) => `
        <div>
          <b>${playerLink(p)}</b>${p.staff ? ' <span class="a2-pill">сотрудник</span>' : ''}
          <div class="a2-muted" style="margin-top:2px">Адреса: ${p.ips.slice(0, 8).map((x) => `<span class="mono">${esc(x.ip)}</span> ×${x.count}`).join(' · ') || '—'}</div>
          <div class="a2-muted">Устройства: ${p.devices.slice(0, 6).map((v) => esc(v.label)).join(' · ') || '—'}</div>
        </div>`).join('')}</div>`;
    bindBans(box, () => renderCompare(who));
  }

  async function renderDeviceGroups() {
    const box = document.getElementById('net-devgroups');
    if (!box) return;
    let d = null;
    try { d = await API.get('/api/admin/device-groups'); }
    catch (e) { box.innerHTML = `<h3>Общие устройства у разных аккаунтов</h3><p class="a2-muted">${esc(e.message)}</p>`; return; }
    const groups = d.groups || [];
    box.innerHTML = `
      <h3>Общие устройства у разных аккаунтов</h3>
      <p class="a2-muted">Устройства, с которых заходят разные аккаунты. Свои персонажи одного кабинета сюда
        не попадают — это разрешено. Нажмите «Сравнить», чтобы увидеть подробности.</p>
      ${groups.length ? `
        <table class="a2-table">
          <thead><tr><th>Устройство</th><th>Совпало по</th><th class="num">Аккаунтов</th><th>Кто</th><th></th></tr></thead>
          <tbody>${groups.map((g) => `<tr>
            <td>${esc(g.label)}</td>
            <td>${g.by === 'did' ? 'метке браузера' : 'устройству и отпечатку'}</td>
            <td class="num">${g.accounts}</td>
            <td>${g.players.map(playerLink).join(', ')}</td>
            <td><a class="btn btn-inline" href="${A2Router.build('network', '', { who: g.players.map((x) => x.name).join(', ') })}">Сравнить</a></td></tr>`).join('')}</tbody>
        </table>`
      : '<p class="a2-muted">Совпадений нет.</p>'}`;
  }

  async function renderBans() {
    const box = document.getElementById('net-bans');
    if (!box) return;
    let d = null;
    try { d = await API.get('/api/admin/net-bans'); }
    catch (e) { box.innerHTML = `<h3>Баны по адресу и устройству</h3><p class="a2-muted">${esc(e.message)}</p>`; return; }
    const bans = d.bans || [];
    const state = (b) => b.active
      ? '<span class="a2-pill is-bad">действует</span>'
      : (b.removedAt ? `<span class="a2-pill">снят ${esc(b.removedBy)}</span>` : '<span class="a2-pill">срок вышел</span>');
    box.innerHTML = `
      <h3>Баны по адресу и устройству</h3>
      <p class="a2-muted">Закрывают вход любым аккаунтом, включая новые, и регистрацию. Сотрудников не запирают.
        Браузер не отдаёт сайту серийные номера оборудования, поэтому «устройство» — это метка браузера
        и отпечаток (экран, часовой пояс, язык, ядра), а не железо в прямом смысле.</p>
      <div class="a2-row" style="margin:6px 0 10px">
        <input id="net-ip" placeholder="IP-адрес, например 93.184.216.34" style="${inputStyle};width:230px">
        <button class="btn btn-inline" id="net-ip-ban">🚫 Закрыть вход с адреса</button>
      </div>
      ${bans.length ? `
        <table class="a2-table">
          <thead><tr><th>Что</th><th>Причина</th><th>Кто и когда</th><th>До</th><th>Кого касалось</th><th>Статус</th><th></th></tr></thead>
          <tbody>${bans.map((b) => `<tr>
            <td>${b.type === 'ip' ? `адрес <span class="mono">${esc(b.value)}</span>` : `устройство «${esc(b.label)}»`}</td>
            <td>${esc(b.reason)}</td>
            <td class="a2-muted">${esc(b.byName)}, ${dt(b.at)}</td>
            <td class="a2-muted">${b.until ? dt(b.until) : 'бессрочно'}</td>
            <td class="a2-muted">${(b.accounts || []).map((a) => esc(a.name)).join(', ') || '—'}</td>
            <td>${state(b)}</td>
            <td>${b.active ? `<button class="btn btn-inline" data-unban="${esc(b.id)}">Снять</button>` : ''}</td></tr>`).join('')}</tbody>
        </table>`
      : '<p class="a2-muted">Банов по адресу и устройству нет.</p>'}`;
    const ipBtn = document.getElementById('net-ip-ban');
    if (ipBtn) ipBtn.onclick = () => {
      const v = (document.getElementById('net-ip').value || '').trim();
      if (!v) return UI.toast('⛔ Введите адрес');
      A2Net.banDialog({ type: 'ip', value: v }, renderBans);
    };
    box.querySelectorAll('[data-unban]').forEach((b) => {
      b.onclick = async () => {
        if (!await UI.confirm('Снять бан? Вход с этого адреса или устройства снова откроется.',
          { title: 'Снять бан', icon: '✅', okText: 'Снять' })) return;
        try { await API.post('/api/admin/net-unban', { id: b.getAttribute('data-unban') }); renderBans(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
  }

  function render(el, route) {
    const q = (route && route.query) || {};
    const canSec = A2.can('security');
    const canMod = A2.can('moderation');
    el.innerHTML = `
      <div class="a2-title">Адреса и устройства</div>
      ${canSec ? `
        <div class="a2-card">
          <h3>Сравнить игроков</h3>
          <p class="a2-muted">Позывные через запятую — от двух до шести. Совпадения по силе: общая метка браузера
            или устройство — почти наверняка одна машина; общий отпечаток — похожее железо; общий адрес — возможно,
            одна сеть. Решение за вами: общий компьютер в семье даёт те же совпадения честно.</p>
          <div class="a2-row">
            <input id="net-who" value="${esc(q.who || '')}" placeholder="Позывной, позывной" style="${inputStyle};flex:1;min-width:220px">
            <button class="btn btn-orange btn-inline" id="net-go">Сравнить</button>
          </div>
          <div id="net-result"></div>
        </div>
        <div class="a2-card" id="net-devgroups"><h3>Общие устройства у разных аккаунтов</h3><div class="loading">Считаю…</div></div>` : ''}
      ${canMod ? '<div class="a2-card" id="net-bans"><h3>Баны по адресу и устройству</h3><div class="loading">Загружаю…</div></div>' : ''}`;

    const go = document.getElementById('net-go');
    if (go) go.onclick = () => {
      const who = (document.getElementById('net-who').value || '').trim();
      if (!who) return UI.toast('⛔ Впишите хотя бы двух игроков');
      if (who === (q.who || '')) renderCompare(who);
      else A2Router.setQuery({ who }, false);
    };
    if (canSec && q.who) renderCompare(q.who);
    if (canSec) renderDeviceGroups();
    if (canMod) renderBans();
  }

  A2.screens.network = render;
})();
