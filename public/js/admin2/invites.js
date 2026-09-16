// ===================================================================
// public/js/admin2/invites.js — приглашения #/invites
//
// Кто кого привёл в игру: по каждому пригласившему — сколько человек
// пришло, сколько дошло до 50 уровня, сколько из них ещё заходит и
// сколько золота пригласивший с них получил. Раскрыв строку, видно
// каждого приглашённого.
//
// Зачем: награды за приглашения — золото из воздуха, и первым делом
// ими пользуются мультоводы. Подозрительная картина видна сразу:
// десяток «друзей», никто не заходит, а доля с покупок идёт. Такие
// связи дальше разбираются в «Мультоводах» и «Адресах и устройствах».
//
// Сколько приглашённый ПОТРАТИЛ, здесь нет — только доля, ушедшая
// пригласившему.
//
// У каждого — адрес и устройство регистрации и последнего входа, и
// отдельной колонкой: что из этого совпало с пригласившим. Совпадение —
// повод разобраться («Сравнить» ведёт в «Адреса и устройства»), но не
// приговор: семья за одним компьютером выглядит так же.
// ===================================================================

(function () {
  const esc = (s) => UI.esc(s == null ? '' : String(s));
  const num = (n) => Number(n || 0).toLocaleString('ru-RU');
  const dt = (ms) => (ms
    ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—');
  const G = '<span class="ic-gold"></span>';
  const inputStyle = 'padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px';
  const who = (p) => p.level
    ? `<a href="${A2Router.build('player', p.id)}">${esc(p.name)}</a>`
      + ` <span class="a2-muted">${p.level} ур.</span>`
      + (p.banned ? ' <span class="a2-pill is-bad">бан</span>' : '')
    : `<span class="a2-muted">${esc(p.name)}</span>`;
  const seen = (p) => (p.active
    ? '<span class="a2-pill is-ok">заходит</span>'
    : `<span class="a2-muted">был ${dt(p.lastSeen)}</span>`);

  // Адрес и устройство: регистрация и последний вход. Совпадают — одной
  // строкой, разные — двумя: перемена сама по себе подсказка.
  const accessCell = (a) => {
    if (!a || (!a.regIp && !a.lastIp)) return '<span class="a2-muted">входов не записано</span>';
    const line = (label, ip, dev) => `<div><span class="a2-muted">${label}</span> <span class="mono">${esc(ip || '—')}</span>`
      + `<div class="a2-muted" style="font-size:11px">${esc(dev || '')}</div></div>`;
    const same = a.regIp === a.lastIp && a.regDevice === a.lastDevice;
    return (same ? line('рег. и вход:', a.regIp, a.regDevice)
      : line('рег.:', a.regIp, a.regDevice) + line('вход:', a.lastIp, a.lastDevice))
      + `<div class="a2-muted" style="font-size:11px">всего адресов: ${a.ipCount}, устройств: ${a.devCount}</div>`;
  };
  const sameCell = (f, boss) => {
    if (!f.matched) return '<span class="a2-muted">нет</span>';
    const parts = [];
    if (f.same.devices.length) parts.push('<span class="a2-pill is-bad">общее устройство</span> ' + f.same.devices.map(esc).join(', '));
    if (f.same.ips.length) parts.push('<span class="a2-pill is-warn">общий адрес</span> <span class="mono">' + f.same.ips.map(esc).join(', ') + '</span>');
    return parts.join('<br>')
      + `<div><a class="btn btn-inline" style="margin-top:4px" href="${A2Router.build('network', '', { who: boss.name + ', ' + f.name })}">🌐 Сравнить</a></div>`;
  };

  function friendsTable(r) {
    return `
      <div style="overflow-x:auto">
      <table class="a2-table">
        <thead><tr><th>Приглашённый</th><th>Пришёл</th><th>В сети</th><th>50 ур.</th><th class="num">Доля с покупок</th>
          <th>Адрес и устройство</th><th>Совпадает с пригласившим</th></tr></thead>
        <tbody>
        ${r.inviter.access ? `<tr style="background:var(--bg)">
          <td>${who(r.inviter)} <span class="a2-muted">— пригласивший</span></td>
          <td colspan="4"></td>
          <td>${accessCell(r.inviter.access)}</td><td></td></tr>` : ''}
        ${r.friends.map((f) => `<tr>
          <td>${who(f)}</td>
          <td class="nowrap">${dt(f.joinedAt)}</td>
          <td>${seen(f)}</td>
          <td>${f.reached50 ? '<span class="a2-pill is-ok">да</span>' : '<span class="a2-muted">нет</span>'}</td>
          <td class="num">${f.goldToInviter ? G + ' ' + num(f.goldToInviter) : '—'}</td>
          <td>${accessCell(f.access)}</td>
          <td>${r.inviter.access ? sameCell(f, r.inviter) : '<span class="a2-muted">—</span>'}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  async function render(el, route) {
    const q = (route && route.query) || {};
    el.innerHTML = '<div class="a2-title">Приглашения</div><div class="loading">Считаю…</div>';
    let d = null;
    try {
      d = await API.get('/api/admin/invites?' + new URLSearchParams({ q: q.q || '', sort: q.sort || '', match: q.match || '' }).toString());
    } catch (e) {
      el.innerHTML = `<div class="a2-title">Приглашения</div><div class="a2-card"><p class="a2-muted">${esc(e.message)}</p></div>`;
      return;
    }
    const t = d.totals || {};
    const rl = d.rules || {};
    const opt = (v, label) => `<option value="${v}"${(q.sort || 'count') === v ? ' selected' : ''}>${label}</option>`;
    el.innerHTML = `
      <div class="a2-title">Приглашения</div>
      <div class="a2-card">
        <div class="a2-row" style="gap:18px">
          <div><b>${num(t.invited)}</b> <span class="a2-muted">пришло по приглашениям</span></div>
          <div><b>${num(t.inviters)}</b> <span class="a2-muted">пригласивших</span></div>
          <div><b>${num(t.reached50)}</b> <span class="a2-muted">дошли до 50 ур.</span></div>
          <div><b>${num(t.active)}</b> <span class="a2-muted">заходят (3 дня)</span></div>
          <div><b${t.matched ? ' style="color:var(--red)"' : ''}>${num(t.matched)}</b> <span class="a2-muted">с тем же адресом или устройством, что у пригласившего</span></div>
        </div>
        <div class="a2-row" style="gap:18px;margin-top:6px">
          <div class="a2-muted">Выдано золота: новичкам ${G} ${num(t.goldToNewbies)} ·
            за 50 ур. ${G} ${num(t.goldForLevel50)} · доля с покупок ${G} ${num(t.goldFromPurchases)}</div>
        </div>
        <p class="a2-muted" style="margin-top:6px">Правила: новичку ${G} ${num(rl.inviteeGold)} сразу; пригласившему
          ${G} ${num(rl.level50Reward)} и 🎖 ${num(rl.level50Tokens)} за друга на 50 ур. и от ${num(rl.sharePct)}% с золота,
          которое друг купил. Много приглашённых, никто не заходит, а доля идёт — повод заглянуть в «Мультоводы».</p>
      </div>
      <div class="a2-card">
        <div class="a2-row">
          <input id="inv-q" value="${esc(q.q || '')}" placeholder="позывной пригласившего или приглашённого, код"
            style="${inputStyle};flex:1;min-width:220px">
          <select id="inv-sort" style="${inputStyle}">
            ${opt('count', 'больше всего приглашённых')}${opt('level50', 'больше всего дошло до 50')}
            ${opt('gold', 'больше всего получил золота')}${opt('recent', 'недавние приглашения')}
            ${opt('matched', 'больше всего совпадений')}
          </select>
          <label class="a2-muted" style="display:flex;align-items:center;gap:4px">
            <input type="checkbox" id="inv-match" ${q.match === '1' ? 'checked' : ''}> только с совпадениями</label>
          <button class="btn btn-inline" id="inv-find">Найти</button>
        </div>
      </div>
      <div class="a2-card">
        ${d.rows.length ? `
          ${d.found > d.shown ? `<p class="a2-muted">Показаны первые ${d.shown} из ${d.found} — уточните поиск.</p>` : ''}
          ${d.rows.map((r) => `
            <details class="a2-item" style="display:block">
              <summary style="cursor:pointer">
                <b>${who(r.inviter)}</b>
                ${r.inviter.refCode ? ` <span class="a2-muted mono">${esc(r.inviter.refCode)}</span>` : ''}
                — пригласил <b>${r.count}</b>${r.counter > r.count ? ` <span class="a2-muted">(по счётчику ${r.counter}: остальные удалены)</span>` : ''},
                до 50 ур.: <b>${r.reached50}</b>, заходят: <b>${r.active}</b>
                ${r.matched ? ` <span class="a2-pill is-bad">совпадений: ${r.matched}</span>` : ''}
                <div class="a2-muted" style="margin-top:2px">получил ${G} ${num(r.goldForLevel50)} за 50 ур. и ${G} ${num(r.goldFromPurchases)}
                  с покупок (доля сейчас ${r.sharePct}%) · последний пришёл ${dt(r.lastJoinedAt)}</div>
              </summary>
              <div style="margin-top:8px">${friendsTable(r)}</div>
            </details>`).join('')}`
        : '<p class="a2-muted">Ничего не найдено.</p>'}
      </div>`;

    const find = () => A2Router.setQuery({
      q: (document.getElementById('inv-q').value || '').trim(),
      sort: document.getElementById('inv-sort').value,
      match: document.getElementById('inv-match').checked ? '1' : '',
    }, false);
    document.getElementById('inv-match').onchange = find;
    document.getElementById('inv-find').onclick = find;
    document.getElementById('inv-sort').onchange = find;
    document.getElementById('inv-q').onkeydown = (e) => { if (e.key === 'Enter') find(); };
    // Нашли конкретного человека — сразу раскрываем его строку
    if (q.q && d.rows.length === 1) { const one = el.querySelector('details'); if (one) one.open = true; }
  }

  A2.screens.invites = render;
})();
