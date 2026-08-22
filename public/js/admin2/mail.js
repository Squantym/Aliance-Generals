// ===================================================================
// public/js/admin2/mail.js — письма игрокам #/mail
//
// Здесь владелец правит тексты писем и отправляет новостную рассылку.
// Тексты хранятся в базе, а не в коде: чтобы поменять «Привет, боец» на
// «Здравия желаю», не нужны ни программист, ни перезапуск сервера.
//
// Экран нарочно показывает состояние почты сверху: если отправка не
// настроена, правка шаблонов бессмысленна, и об этом надо сказать до
// того, как человек полчаса писал текст.
// ===================================================================

(function () {
  const dt = (ms) => ms
    ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';

  async function render(el) {
    el.innerHTML = '<div class="a2-title">Письма игрокам</div><div class="loading">Загружаю…</div>';
    let d = null;
    try { d = await API.get('/api/admin/mail/templates'); }
    catch (e) {
      el.innerHTML = `<div class="a2-title">Письма игрокам</div>
        <div class="a2-card"><p class="a2-muted">${UI.esc(e.message)}</p></div>`;
      return;
    }

    const mail = d.mail || {};
    const aud = d.audience || {};
    const bc = (d.broadcast && d.broadcast.last) || null;
    const running = !!(d.broadcast && d.broadcast.running);

    el.innerHTML = `
      <div class="a2-title">Письма игрокам</div>

      <div class="a2-card">
        <h3 style="margin:0">Состояние отправки</h3>
        <p class="a2-muted" style="margin:6px 0 0">
          ${mail.configured
            ? `Сервис подключён. Отправитель: <b>${UI.esc(mail.from || '—')}</b>.`
            : '<b style="color:var(--red)">Отправка не настроена.</b> Письма никуда не уходят, а новым игрокам почта подтверждается сама. Пока это так, правка шаблонов ни на что не влияет.'}
        </p>
        ${mail.hint ? `<p class="a2-muted" style="margin-top:6px">${UI.esc(mail.hint)}</p>` : ''}
      </div>

      ${(d.templates || []).map((t) => `
        <div class="a2-card" data-tpl="${UI.esc(t.id)}">
          <div class="a2-row" style="justify-content:space-between;align-items:baseline">
            <h3 style="margin:0">${UI.esc(t.name)}
              ${t.isDefault ? '<span class="a2-pill">заводской</span>'
                            : `<span class="a2-pill is-ok">изменён ${dt(t.changedAt)}${t.changedBy ? ' · ' + UI.esc(t.changedBy) : ''}</span>`}
            </h3>
          </div>
          <p class="a2-muted" style="margin:4px 0 8px">${UI.esc(t.about)}</p>
          <p class="a2-muted" style="margin:0 0 8px">Подстановки: ${t.vars.map((v) => `<code>${UI.esc(v)}</code>`).join(' ')}
            — вместо них в письме окажутся настоящие значения.</p>

          <label class="a2-muted small">Тема письма</label>
          <input class="tpl-subject" value="${UI.esc(t.subject)}"
            style="width:100%;box-sizing:border-box;padding:6px 10px;margin:4px 0 8px;background:var(--bg);
                   color:var(--text);border:1px solid var(--border);border-radius:8px">

          <label class="a2-muted small">Текст письма (разметка)</label>
          <textarea class="tpl-html" rows="10"
            style="width:100%;box-sizing:border-box;padding:8px 10px;margin:4px 0 8px;background:var(--bg);
                   color:var(--text);border:1px solid var(--border);border-radius:8px;
                   font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">${UI.esc(t.html)}</textarea>

          <div class="a2-row">
            <button class="btn btn-orange tpl-save">Сохранить</button>
            <button class="btn btn-inline tpl-default">Вернуть заводской</button>
            <input class="tpl-to" placeholder="почта для образца"
              style="width:210px;padding:6px 10px;background:var(--bg);color:var(--text);
                     border:1px solid var(--border);border-radius:8px">
            <button class="btn btn-inline tpl-preview">Отправить образец себе</button>
          </div>
        </div>`).join('')}

      <div class="a2-card">
        <h3 style="margin:0">Рассылка</h3>
        <p class="a2-muted" style="margin:6px 0">Уходит текст шаблона «Новостная рассылка» — тот,
          что выше. Получателей сейчас: <b>${aud.ready || 0}</b> из ${aud.total || 0} игроков
          (без подтверждённой почты — ${aud.unverified || 0}, вовсе без почты — ${aud.noEmail || 0}).</p>
        <p class="a2-muted" style="margin:0 0 8px">Шлём только на подтверждённые адреса. Неподтверждённый
          адрес — это чаще всего опечатка, а письма на несуществующие ящики портят репутацию отправителя,
          после чего в спам начинают уходить и подтверждения регистрации.</p>

        ${bc ? `
          <div class="a2-card" style="margin:8px 0;background:rgba(255,255,255,.03)">
            <div><b>${running ? 'Идёт рассылка' : 'Прошлая рассылка'}</b>
              <span class="a2-muted">${dt(bc.startedAt)}${bc.by ? ' · запустил ' + UI.esc(bc.by) : ''}</span></div>
            <div class="a2-muted">Отправлено ${bc.sent} из ${bc.total}${bc.failed ? ` · не дошло ${bc.failed}` : ''}${running ? ` · осталось ${bc.left}` : ''}${bc.stopped ? ' · остановлена вручную' : ''}</div>
            ${(bc.errors || []).length ? `<div class="a2-muted small" style="margin-top:6px">Ошибки:
              ${bc.errors.map((e) => `${UI.esc(e.email)} — ${UI.esc(e.error)}`).join('<br>')}</div>` : ''}
          </div>` : ''}

        <div class="a2-row">
          ${running
            ? '<button class="btn btn-red" id="bc-stop">⏹ Остановить рассылку</button>'
            : `<button class="btn btn-orange" id="bc-start" ${mail.configured ? '' : 'disabled'}>✉️ Разослать всем (${aud.ready || 0})</button>`}
          <button class="btn btn-inline" id="bc-refresh">Обновить</button>
        </div>
      </div>`;

    el.querySelectorAll('[data-tpl]').forEach((card) => {
      const id = card.getAttribute('data-tpl');
      const subject = () => card.querySelector('.tpl-subject').value;
      const html = () => card.querySelector('.tpl-html').value;

      card.querySelector('.tpl-save').onclick = async () => {
        try {
          await API.post('/api/admin/mail/template', { id, subject: subject(), html: html() });
          render(el);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
      card.querySelector('.tpl-default').onclick = async () => {
        const ok = await UI.confirm('Вернуть заводской текст? Ваша правка этого письма пропадёт.',
          { title: 'Вернуть заводской', icon: '↩️', danger: true, okText: 'Вернуть' });
        if (!ok) return;
        try {
          await API.post('/api/admin/mail/template/default', { id });
          render(el);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
      card.querySelector('.tpl-preview').onclick = async () => {
        const to = card.querySelector('.tpl-to').value;
        try {
          // Отправляем ТО, ЧТО СЕЙЧАС В ПОЛЯХ, а не сохранённое: смысл
          // образца — посмотреть правку до того, как она уйдёт игрокам.
          await API.post('/api/admin/mail/template', { id, subject: subject(), html: html() });
          const r = await API.post('/api/admin/mail/preview', { id, to });
          UI.toast('✉️ Образец отправлен на ' + r.to);
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });

    const start = document.getElementById('bc-start');
    if (start) start.onclick = async () => {
      const ok = await UI.confirm(
        `Разослать письмо ${aud.ready || 0} игрокам? Отменить уже ушедшие письма нельзя.
         Проверьте текст образцом на свою почту, если ещё не проверяли.`,
        { title: 'Рассылка', icon: '✉️', okText: 'Разослать' });
      if (!ok) return;
      try { await API.post('/api/admin/mail/broadcast', {}); render(el); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const stop = document.getElementById('bc-stop');
    if (stop) stop.onclick = async () => {
      try { await API.post('/api/admin/mail/broadcast', { stop: true }); render(el); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const refresh = document.getElementById('bc-refresh');
    if (refresh) refresh.onclick = () => render(el);
  }

  A2.screens.mail = render;
})();
