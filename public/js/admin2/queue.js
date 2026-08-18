// ===================================================================
// public/js/admin2/queue.js — очередь работ
//
// Первый экран смены. В v1 на его месте была «Сводка»: она показывала
// много верного, но отвечала на вопрос «как дела в игре», а сотруднику
// нужен ответ на другой — «что мне сейчас делать».
//
// Отличие принципиальное:
//   • только то, что требует ДЕЙСТВИЯ, и в порядке срочности;
//   • у каждой строки есть кнопка, ведущая ровно туда, где это чинят;
//   • пусто — значит пусто, и так и написано. Пустая очередь это
//     хороший результат смены, а не подозрительно голый экран;
//   • состояние базы и вывоза копий тут же: их не проверяет никто,
//     пока не случится авария, поэтому спрашиваем сами.
//
// Счётчики отсюда же уезжают в боковое меню (A2.setBadge) — чтобы
// «жалобы ждут» было видно с любого экрана, а не только на этом.
// ===================================================================

(function () {
  const ago = (ms) => {
    if (!ms) return '';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' ч назад' : Math.round(h / 24) + ' дн назад';
  };

  // Строка очереди. tone: hot (просрочено) | warn | info
  const itemHtml = (it) => `
    <div class="a2-item ${it.tone === 'hot' ? 'is-hot' : ''}">
      <div class="a2-item-ico">${it.icon}</div>
      <div class="a2-item-txt">${it.text}
        ${it.when ? `<div class="a2-item-when">${UI.esc(it.when)}</div>` : ''}</div>
      ${it.go ? `<a class="btn btn-inline" href="${it.go}">${UI.esc(it.btn || 'Открыть')}</a>` : ''}
    </div>`;

  async function render(el) {
    el.innerHTML = '<div class="a2-title">Очередь работ</div><div class="loading">Собираю…</div>';

    let d = null, dbState = null;
    try { d = await API.get('/api/admin/dashboard'); }
    catch (e) {
      el.innerHTML = `<div class="a2-card"><h3 style="color:var(--red)">Сводка не собралась</h3>
        <p class="a2-muted">${UI.esc(e.message)}</p></div>`;
      return;
    }
    // Состояние базы спрашиваем только у тех, кому оно доступно, и
    // молча пропускаем при отказе: очередь работ не должна падать
    // целиком из-за одного необязательного блока.
    if (A2.can('security')) {
      try { dbState = await API.get('/api/admin/db/stats'); } catch (e) { dbState = null; }
    }

    const has = (z) => (d.zones || []).indexOf(z) >= 0;
    const items = [];

    // ── Что требует действия ───────────────────────────────────────
    if (has('moderation') && d.reportsNew) {
      items.push({
        icon: '📨', tone: d.reportsNew >= 5 ? 'hot' : 'warn',
        text: `Неразобранных жалоб: <b>${d.reportsNew}</b>`,
        go: A2Router.build('reports'), btn: 'Разобрать',
      });
      A2.setBadge('reports', d.reportsNew, d.reportsNew >= 5 ? 'hot' : 'warn');
    } else { A2.setBadge('reports', 0); }

    if (has('support') && d.tickets && d.tickets.open) {
      const old = d.tickets.oldest || 0;
      items.push({
        icon: '🛟', tone: old >= 24 ? 'hot' : 'warn',
        text: `Открытых обращений: <b>${d.tickets.open}</b>`
            + (d.tickets.answered ? ` · отвечено, ждут игрока: ${d.tickets.answered}` : ''),
        when: old ? `самое старое ждёт ${old} ч` : '',
        go: A2Router.build('support'), btn: 'Ответить',
      });
      A2.setBadge('support', d.tickets.open, old >= 24 ? 'hot' : 'warn');
    } else { A2.setBadge('support', 0); }

    // ── Состояние защиты данных ────────────────────────────────────
    // Это не «информация», а именно работа: если вывоз копий сломан,
    // чинить его нужно сегодня, а не в день аварии.
    if (dbState) {
      const off = dbState.offsite || null;
      // Признак настройки — configured с сервера, а не «есть ли время
      // последнего отчёта»: сломавшийся при первом же запуске вывоз
      // тоже приходит без времени, и его нельзя путать с ненастроенным.
      if (!off || (!off.configured && !off.at)) {
        items.push({
          icon: '🚚', tone: 'warn',
          text: 'Вывоз копий за пределы сервера <b>не настроен</b>',
          when: 'пока не настроен, авария диска уносит и базу, и все копии',
          go: A2Router.build('tech'), btn: 'Техника',
        });
      } else if (!off.ok) {
        items.push({
          icon: '🚚', tone: 'hot',
          text: `Вывоз копий <b>сломан</b>: ${UI.esc(String(off.error || 'причина не указана').slice(0, 90))}`,
          when: ago(off.at), go: A2Router.build('tech'), btn: 'Техника',
        });
      } else if (Date.now() - off.at > 2 * 24 * 3600 * 1000) {
        items.push({
          icon: '🚚', tone: 'warn',
          text: 'Вывоз копий <b>не срабатывал больше двух суток</b>',
          when: 'последний успех ' + ago(off.at),
          go: A2Router.build('tech'), btn: 'Техника',
        });
      } else if (off.encrypted === false) {
        items.push({
          icon: '🔓', tone: 'warn',
          text: 'Копии уезжают <b>без шифрования</b>',
          when: 'в копии почты и хеши паролей всех игроков',
          go: A2Router.build('tech'), btn: 'Техника',
        });
      }
      const last = dbState.backups && dbState.backups.length ? dbState.backups[0] : null;
      if (last && last.at && Date.now() - last.at > 12 * 3600 * 1000) {
        items.push({
          icon: '💾', tone: 'hot',
          text: 'Свежей копии базы <b>нет больше 12 часов</b>',
          when: 'последняя ' + ago(last.at),
          go: A2Router.build('tech'), btn: 'Сделать копию',
        });
      }
    }

    const queueHtml = items.length
      ? items.map(itemHtml).join('')
      : `<p class="a2-muted">Разбирать нечего — жалоб и обращений нет, копии на месте.
         Пустая очередь это нормальный конец смены, а не сломанный экран.</p>`;

    // ── Кто под мерами ─────────────────────────────────────────────
    const bans = [];
    if (has('moderation') && d.accountBansTotal) {
      bans.push(`<div class="a2-item"><div class="a2-item-ico">🚫</div>
        <div class="a2-item-txt">Заблокированных аккаунтов: <b>${d.accountBansTotal}</b></div>
        <a class="btn btn-inline" href="${A2Router.build('players')}">К игрокам</a></div>`);
    }
    if (has('moderation') && d.chatBansTotal) {
      bans.push(`<div class="a2-item"><div class="a2-item-ico">🔇</div>
        <div class="a2-item-txt">Блокировок чата: <b>${d.chatBansTotal}</b></div></div>`);
    }

    // ── Мои действия за сутки ──────────────────────────────────────
    // Сотрудник должен видеть свой след сам: это и память («что я уже
    // сделал»), и защита («я этого не делал» проверяется за секунду).
    const mine = (d.myActions || []).map((l) => `
      <div class="a2-item"><div class="a2-item-ico">·</div>
        <div class="a2-item-txt">${UI.esc(l.human || l.path || '')}
          <div class="a2-item-when">${UI.esc(ago(l.at))}</div></div></div>`).join('');

    const p = d.players || {};
    el.innerHTML = `
      <div class="a2-title">Очередь работ</div>
      <div class="a2-sub">${UI.esc(d.me && d.me.name || '')} · ${UI.esc(d.me && d.me.label || '')}</div>

      <div class="a2-card">
        <h3>Требует внимания</h3>
        ${queueHtml}
      </div>

      <div class="a2-grid">
        <div class="a2-card">
          <h3>Люди сейчас</h3>
          <div class="a2-item"><div class="a2-item-ico">🟢</div>
            <div class="a2-item-txt">В игре: <b>${p.online || 0}</b>
              <div class="a2-item-when">всего ${p.total || 0} · новых за сутки ${p.newToday || 0}</div></div></div>
          ${bans.join('') || '<p class="a2-muted">Действующих мер нет.</p>'}
        </div>

        ${dbState ? `<div class="a2-card">
          <h3>Данные</h3>
          <div class="a2-item"><div class="a2-item-ico">💾</div>
            <div class="a2-item-txt">Копий на диске: <b>${(dbState.backups || []).length}</b>
              <div class="a2-item-when">последняя ${UI.esc(ago(dbState.backups && dbState.backups[0] && dbState.backups[0].at))}</div></div></div>
          <div class="a2-item"><div class="a2-item-ico">🚚</div>
            <div class="a2-item-txt">Вывоз наружу:
              ${dbState.offsite && dbState.offsite.at
                ? `<span class="a2-pill ${dbState.offsite.ok ? 'is-ok' : 'is-bad'}">${dbState.offsite.ok ? 'доехало' : 'сломан'}</span>
                   ${dbState.offsite.ok && dbState.offsite.encrypted === false ? '<span class="a2-pill is-warn">без шифрования</span>' : ''}`
                : '<span class="a2-pill is-warn">не настроен</span>'}
              <div class="a2-item-when">${UI.esc(ago(dbState.offsite && dbState.offsite.at))}</div></div></div>
          <div class="a2-row" style="margin-top:6px">
            <a class="btn btn-inline" href="${A2Router.build('tech')}">Открыть «Технику»</a></div>
        </div>` : ''}

        <div class="a2-card">
          <h3>Мои действия за сутки</h3>
          ${mine || '<p class="a2-muted">Сегодня вы ещё ничего не делали.</p>'}
        </div>
      </div>`;
  }

  A2.screens.queue = render;
})();
