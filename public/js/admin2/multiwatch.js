// ===================================================================
// public/js/admin2/multiwatch.js — «Мультоводы» #/multi
//
// Отвечает на вопрос, который раньше приходилось задавать вручную:
// КОГО вообще проверять. Сервер сам обходит игроков и выдаёт пары с
// общим устройством, отпечатком или адресом, отсортированные по силе
// улик (services/multiWatch.ts).
//
// Экран нарочно не выносит приговор: у каждой строки перечислены
// причины, а рядом — кнопки «сравнить» и «карточка». Общий компьютер
// в семье выглядит так же, как твинк.
// ===================================================================

(function () {
  const esc = (s) => UI.esc(s == null ? '' : String(s));
  const dt = (ms) => (ms
    ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—');
  const num = (n) => Number(n || 0).toLocaleString('ru-RU');

  // Насколько крепки улики: цвет и слово, а не голое число
  function strength(score) {
    if (score >= 75) return { cls: 'a2-bad', label: 'очень похоже на одного человека' };
    if (score >= 50) return { cls: 'a2-warn', label: 'сильное совпадение' };
    return { cls: '', label: 'слабое совпадение' };
  }

  function pairRow(p) {
    const s = strength(p.score);
    const ref = p.referral
      ? `<div class="a2-muted" style="margin-top:2px">🎁 ${esc(p.referral.bossName)} → ${esc(p.referral.mateName)}`
        + (p.referral.goldPaid ? `, доля с покупок: <b class="gold">🪙 ${num(p.referral.goldPaid)}</b>` : '')
        + '</div>'
      : '';
    return `
      <div class="a2-item ${s.cls}">
        <div class="a2-row" style="justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:200px">
            <b><a href="${A2Router.build('player', p.a.id)}">${esc(p.a.name)}</a></b>
            <span class="a2-muted">${p.a.level} ур.${p.a.banned ? ' · 🚫 бан' : ''}</span>
            <span class="a2-muted"> ⇄ </span>
            <b><a href="${A2Router.build('player', p.b.id)}">${esc(p.b.name)}</a></b>
            <span class="a2-muted">${p.b.level} ур.${p.b.banned ? ' · 🚫 бан' : ''}</span>
            <div class="a2-muted" style="margin-top:2px">${p.reasons.map(esc).join(' · ')}</div>
            ${ref}
            <div class="a2-muted" style="margin-top:2px">был в сети: ${dt(p.a.lastSeen)} / ${dt(p.b.lastSeen)}</div>
          </div>
          <div style="text-align:right">
            <div><b>${p.score}</b> <span class="a2-muted">баллов</span></div>
            <div class="a2-muted" style="font-size:11px">${esc(s.label)}</div>
            <a class="btn btn-inline" style="margin-top:4px"
               href="${A2Router.build('network', '', { who: p.a.name + ', ' + p.b.name })}">🌐 Разобрать</a>
          </div>
        </div>
      </div>`;
  }

  function refRow(r) {
    return `
      <div class="a2-item">
        <div class="a2-row" style="justify-content:space-between;gap:8px">
          <div style="flex:1;min-width:200px">
            <b><a href="${A2Router.build('player', r.id)}">${esc(r.name)}</a></b>
            <span class="a2-muted">${r.level} ур.</span>
            <div class="a2-muted">приглашено ${r.invited}, из них с общим устройством или адресом — <b>${r.shared}</b></div>
            <div class="a2-muted">${r.names.map(esc).join(', ')}</div>
          </div>
          <div style="text-align:right">
            <div class="gold">🪙 ${num(r.goldPaid)}</div>
            <div class="a2-muted" style="font-size:11px">получено с их покупок</div>
          </div>
        </div>
      </div>`;
  }

  async function load(el, min) {
    const box = el.querySelector('#mw-body');
    box.innerHTML = '<div class="loading">Считаю…</div>';
    let d;
    try { d = await API.get('/api/admin/multi-watch?min=' + encodeURIComponent(min) + '&limit=80'); }
    catch (e) { box.innerHTML = `<p class="a2-muted">${esc(e.message)}</p>`; return; }
    box.innerHTML = `
      <p class="a2-muted">Проверено игроков: ${num(d.players)}. Пар с пересечениями: ${num(d.total)}, показано ${num(d.shown)} (порог ${d.minScore} баллов).</p>
      ${d.pairs.length ? d.pairs.map(pairRow).join('') : '<p class="a2-muted">Ничего похожего не нашлось.</p>'}
      ${d.referral && d.referral.length ? `
        <h3 style="margin-top:14px">🎁 Приглашения с одного устройства</h3>
        <p class="a2-muted">За приглашённых платят золотом и долей с покупок, поэтому это первое место, где заводят твинков.</p>
        ${d.referral.map(refRow).join('')}` : ''}
      ${d.crowded && d.crowded.length ? `
        <h3 style="margin-top:14px">Переполненные адреса и устройства</h3>
        <p class="a2-muted">Больше дюжины аккаунтов в одной ячейке — это оператор связи, общежитие или неверно настроенный прокси, а не улика. В пары они не идут.</p>
        <div class="a2-muted">${d.crowded.map((c) => `${c.kind === 'ip' ? '🌐' : '📱'} ${esc(c.key)} — ${c.count}`).join('<br>')}</div>` : ''}`;
  }

  function render(el) {
    el.innerHTML = `
      <div class="a2-title">Мультоводы</div>
      <div class="a2-card">
        <h3>Кого проверить</h3>
        <p class="a2-muted">Список собирается сам: общее устройство весит 50 баллов, совпавший отпечаток — 30,
          общий адрес — 15. Связь «пригласил» добавляет 25, ушедшее по ней золото — ещё 15, регистрация в один
          день — 10. Это повод посмотреть, а не приговор: общий компьютер в семье даёт те же совпадения.</p>
        <div class="a2-row">
          <label class="a2-muted">Порог:</label>
          <select id="mw-min" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px">
            <option value="30">30 — показывать всё</option>
            <option value="50" selected>50 — сильные совпадения</option>
            <option value="75">75 — почти наверняка</option>
          </select>
          <button class="btn btn-inline" id="mw-go">Обновить</button>
        </div>
      </div>
      <div class="a2-card"><div id="mw-body"></div></div>`;
    const sel = el.querySelector('#mw-min');
    el.querySelector('#mw-go').onclick = () => load(el, sel.value);
    load(el, sel.value);
  }

  A2.screens.multi = render;
})();
