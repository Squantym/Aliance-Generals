// ===================================================================
// public/js/admin2/payments.js — платежи #/payments, #/payments/<заказ>
//
// Экран владельца для разбора проблем с оплатой: «деньги списались, а
// золота нет», «это не я платил», возврат, спор через банк. На каждый
// такой вопрос ответ — в данных одного заказа: что покупали, чем и из
// какого банка платили, откуда нажимали «Купить», какие уведомления
// приходили от ЮKassa и когда.
//
// Полного номера карты здесь нет и быть не может: ЮKassa отдаёт только
// первые 6 и последние 4 цифры. Налоговые чеки самозанятого лежат в
// «Мой налог» — в панели всё о самой оплате, а не чек ФНС.
// ===================================================================

(function () {
  const dt = (ms) => (ms
    ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—');
  const iso = (s) => (s ? dt(Date.parse(s)) : '—');
  const esc = (s) => UI.esc(s == null ? '' : String(s));
  const rub = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
  const inputStyle = 'padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px';
  const STATUS = {
    paid: ['оплачен', 'is-ok'], pending: ['ждёт оплаты', 'is-warn'],
    cancelled: ['отменён', 'is-bad'], failed: ['не создан', 'is-bad'],
  };
  const pill = (o) => {
    const s = STATUS[o.status] || [o.status, ''];
    return `<span class="a2-pill ${s[1]}">${s[0]}</span>`
      + (o.refundedRub ? ` <span class="a2-pill is-bad">возврат ${rub(o.refundedRub)}</span>` : '')
      + (o.test ? ' <span class="a2-pill">тест</span>' : '');
  };
  const kv = (k, v, mono) => (v === null || v === undefined || v === '')
    ? ''
    : `<div class="a2-kv"><span>${esc(k)}</span><b${mono ? ' class="mono"' : ''}>${esc(v)}</b></div>`;
  const EVENT = {
    'payment.succeeded': 'ЮKassa: платёж прошёл', 'payment.canceled': 'ЮKassa: платёж отменён',
    'payment.waiting_for_capture': 'ЮKassa: ждёт подтверждения', 'refund.succeeded': 'ЮKassa: возврат выполнен',
  };

  async function renderList(el, route) {
    const q = route.query || {};
    el.innerHTML = '<div class="a2-title">Платежи</div><div class="loading">Загружаю…</div>';
    let d = null;
    try {
      d = await API.get('/api/admin/payments?' + new URLSearchParams({ q: q.q || '', status: q.status || '', test: q.test || '' }).toString());
    } catch (e) {
      el.innerHTML = `<div class="a2-title">Платежи</div><div class="a2-card"><p class="a2-muted">${esc(e.message)}</p></div>`;
      return;
    }
    const t = d.totals || {};
    const rows = d.rows || [];
    const opt = (v, label, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`;
    el.innerHTML = `
      <div class="a2-title">Платежи</div>
      <div class="a2-card">
        <div class="a2-row" style="gap:18px">
          <div><b>${rub(t.paidRub)}</b> <span class="a2-muted">оплачено по-настоящему · заказов: ${t.paidCount || 0}</span></div>
          <div><b>${rub(t.refundedRub)}</b> <span class="a2-muted">возвращено</span></div>
          <div class="a2-muted">ждут оплаты: ${t.pendingCount || 0} · тестовых оплат: ${t.testCount || 0}</div>
        </div>
        <p class="a2-muted" style="margin-top:6px">Карта — только то, что отдаёт ЮKassa: первые 6 и последние 4 цифры,
          банк и страна. Полного номера нет ни в ответе ЮKassa, ни в игре. Налоговые чеки — в «Мой налог».</p>
      </div>
      <div class="a2-card">
        <div class="a2-row">
          <input id="pay-q" value="${esc(q.q || '')}" placeholder="заказ, платёж, позывной, 4 цифры карты, IP"
            style="${inputStyle};flex:1;min-width:220px">
          <select id="pay-status" style="${inputStyle}">
            ${opt('', 'все статусы', q.status || '')}${opt('paid', 'оплачен', q.status)}${opt('pending', 'ждёт оплаты', q.status)}
            ${opt('cancelled', 'отменён', q.status)}${opt('failed', 'не создан', q.status)}${opt('refunded', 'с возвратом', q.status)}
          </select>
          <select id="pay-test" style="${inputStyle}">
            ${opt('', 'все', q.test || '')}${opt('0', 'настоящие', q.test)}${opt('1', 'тестовые', q.test)}
          </select>
          <button class="btn btn-inline" id="pay-find">Найти</button>
        </div>
      </div>
      <div class="a2-card">
        ${rows.length ? `
          <div style="overflow-x:auto">
          <table class="a2-table">
            <thead><tr><th>Когда</th><th>Игрок</th><th>Покупка</th><th class="num">Сумма</th><th>Статус</th><th>Способ оплаты</th><th>IP</th></tr></thead>
            <tbody>${rows.map((o) => `<tr data-open="${esc(o.id)}" style="cursor:pointer">
              <td class="nowrap">${dt(o.createdAt)}</td>
              <td>${esc(o.userName || o.userId)}</td>
              <td>${esc(o.title)}</td>
              <td class="num">${rub(o.priceRub)}</td>
              <td>${pill(o)}</td>
              <td>${esc(o.method)}</td>
              <td class="mono">${esc(o.buyerIp || '—')}</td></tr>`).join('')}</tbody>
          </table></div>`
        : '<p class="a2-muted">Ничего не найдено.</p>'}
      </div>`;

    const find = () => A2Router.setQuery({
      q: (document.getElementById('pay-q').value || '').trim(),
      status: document.getElementById('pay-status').value,
      test: document.getElementById('pay-test').value,
    }, false);
    document.getElementById('pay-find').onclick = find;
    document.getElementById('pay-q').onkeydown = (e) => { if (e.key === 'Enter') find(); };
    el.querySelectorAll('[data-open]').forEach((tr) => {
      tr.onclick = () => A2Router.go('payments', tr.getAttribute('data-open'));
    });
  }

  async function renderOne(el, id) {
    el.innerHTML = '<div class="loading">Открываю платёж…</div>';
    let o = null;
    try { o = await API.get('/api/admin/payments/' + encodeURIComponent(id)); }
    catch (e) {
      el.innerHTML = `<div class="a2-card"><h3 style="color:var(--red)">Платёж не открылся</h3>
        <p class="a2-muted">${esc(e.message)}</p><a class="btn btn-inline" href="${A2Router.build('payments')}">← Все платежи</a></div>`;
      return;
    }
    const m = o.method || {};
    const c = m.card || null;
    const b = o.buyer || null;
    const money = o.money || {};

    // Хронология одной лентой: создание, уведомления, оплата, возвраты
    const timeline = [
      { at: o.createdAt, text: 'Игрок нажал «Купить», создан заказ' },
      ...(o.events || []).map((ev) => ({ at: ev.at, text: `${EVENT[ev.event] || ev.event}${ev.ip ? ' · с адреса ' + ev.ip : ''}` })),
      ...(o.paidAt ? [{ at: o.paidAt, text: 'Покупка зачислена игроку' }] : []),
      ...(o.refunds || []).map((r) => ({ at: Date.parse(r.createdAt) || 0, text: `Возврат ${rub(r.amount)} — ${r.status}` })),
    ].filter((x) => x.at).sort((x, y) => x.at - y.at);

    el.innerHTML = `
      <div class="a2-title">Платёж · ${esc(o.title)} ${pill({ status: o.status, refundedRub: o.refundedRub, test: money.test })}</div>
      <div class="a2-sub"><a href="${A2Router.build('payments')}">← Все платежи</a> · заказ <code>${esc(o.id)}</code></div>

      <div class="a2-grid">
        <div class="a2-card">
          <h3>Заказ</h3>
          ${kv('Покупка', o.title)}
          ${kv('Цена', rub(o.priceRub))}
          ${kv('Зачислено золота', o.creditedGold ? o.creditedGold.toLocaleString('ru-RU') : '')}
          ${kv('Создан', dt(o.createdAt))}
          ${kv('Зачислен', o.paidAt ? dt(o.paidAt) : '')}
          ${kv('Причина отмены', o.cancelReason ? o.cancelReason + (o.cancelParty ? ' (' + o.cancelParty + ')' : '') : '')}
          ${kv('Возвращено', o.refundedRub ? rub(o.refundedRub) : '')}
          ${(o.receiptLines || []).length ? `<div class="offer-items">${o.receiptLines.map((l) => `
            <div class="offer-item">${l.icon ? `<img src="${esc(l.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(l.text)}</span></div>`).join('')}</div>` : ''}
        </div>

        <div class="a2-card">
          <h3>Покупатель</h3>
          <div class="a2-kv"><span>Игрок</span><b><a href="${A2Router.build('player', o.userId)}">${esc(o.userName || o.userId)}</a></b></div>
          ${b ? `
            ${kv('Адрес при покупке', b.ip, true)}
            ${kv('Устройство', b.device)}
            ${kv('Метка браузера', b.did, true)}
            ${kv('Отпечаток', b.fp, true)}
            ${kv('Строка браузера', b.ua)}
            <div class="a2-row" style="margin-top:6px">
              <a class="btn btn-inline" href="${A2Router.build('network', '', { who: o.userName || '' })}">🌐 Сравнить с другими</a>
            </div>`
          : '<p class="a2-muted">Адрес и устройство не записаны — заказ создан до появления учёта.</p>'}
        </div>

        <div class="a2-card">
          <h3>Оплата</h3>
          ${kv('Способ', m.name)}
          ${kv('Как назвала ЮKassa', m.title)}
          ${c ? `
            ${kv('Карта', `${c.first6 || '••••••'}•••••• ${c.last4 || '••••'}`, true)}
            ${kv('Платёжная система', c.type)}
            ${kv('Банк карты', c.issuerName)}
            ${kv('Страна банка', c.issuerCountry)}
            ${kv('Срок карты', c.expiry)}
            ${kv('Вид карты', c.product)}
            ${kv('Откуда карта', c.source)}` : ''}
          ${kv('Банк плательщика', m.bank)}
          ${kv('Операция СБП', m.sbpOperationId, true)}
          ${kv('Кошелёк ЮMoney', m.account, true)}
          ${kv('Телефон', m.phone, true)}
          ${kv('3-D Secure', o.auth && o.auth.threeDs)}
          ${kv('RRN (номер операции в банке)', o.auth && o.auth.rrn, true)}
          ${kv('Код авторизации', o.auth && o.auth.authCode, true)}
        </div>

        <div class="a2-card">
          <h3>Деньги и ЮKassa</h3>
          ${kv('Сумма платежа', `${Number(money.amount || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${money.currency || 'RUB'}`)}
          ${kv('Придёт на счёт', money.income !== null && money.income !== undefined ? rub(money.income) : '')}
          ${kv('Комиссия ЮKassa', money.commission !== null && money.commission !== undefined ? rub(money.commission) : '')}
          ${kv('Возвращено по данным ЮKassa', money.refunded ? rub(money.refunded) : '')}
          ${kv('Тестовый платёж', money.test ? 'да — деньги не настоящие' : 'нет')}
          ${kv('Статус в ЮKassa', money.ykStatus)}
          ${kv('Платёж в ЮKassa', o.providerRef, true)}
          ${kv('Создан в ЮKassa', money.createdAt ? iso(money.createdAt) : '')}
          ${kv('Списан', money.capturedAt ? iso(money.capturedAt) : '')}
          ${kv('Сверено с ЮKassa', o.ykSyncedAt ? dt(o.ykSyncedAt) : '')}
          ${o.providerRef ? '<button class="btn btn-inline" id="pay-refresh" style="margin-top:8px">🔄 Сверить с ЮKassa</button>' : ''}
        </div>
      </div>

      <div class="a2-card">
        <h3>Хронология</h3>
        ${timeline.map((x) => `<div class="a2-item"><div class="a2-item-ico">·</div>
          <div class="a2-item-txt">${esc(x.text)}<div class="a2-item-when">${dt(x.at)}</div></div></div>`).join('')}
      </div>

      ${(o.refunds || []).length ? `
        <div class="a2-card">
          <h3>Возвраты</h3>
          <table class="a2-table">
            <thead><tr><th>Возврат</th><th class="num">Сумма</th><th>Статус</th><th>Когда</th><th>Комментарий</th></tr></thead>
            <tbody>${o.refunds.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td class="num">${rub(r.amount)}</td>
              <td>${esc(r.status)}</td><td>${iso(r.createdAt)}</td><td>${esc(r.description)}</td></tr>`).join('')}</tbody>
          </table>
          <p class="a2-muted">Золото и набор при возврате автоматически не списываются: возврат бывает частичным,
            а часть покупки игрок мог уже потратить. Решение — за вами.</p>
        </div>` : ''}

      ${o.raw ? `
        <div class="a2-card">
          <details><summary>Полный ответ ЮKassa — для разбора спора с банком или поддержкой ЮKassa</summary>
            <pre style="white-space:pre-wrap;word-break:break-all;font-size:11px;margin-top:8px">${esc(JSON.stringify(o.raw, null, 2))}</pre>
          </details>
        </div>` : ''}`;

    const refresh = document.getElementById('pay-refresh');
    if (refresh) refresh.onclick = async () => {
      refresh.disabled = true;
      try { await API.post('/api/admin/payments/' + encodeURIComponent(id) + '/refresh', {}); UI.toast('🔄 Сверено с ЮKassa'); renderOne(el, id); }
      catch (e) { UI.toast('⛔ ' + e.message); refresh.disabled = false; }
    };
  }

  function render(el, route) {
    return route && route.arg ? renderOne(el, route.arg) : renderList(el, route || { query: {} });
  }

  A2.screens.payments = render;
})();
