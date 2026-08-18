// ===================================================================
// public/js/admin2/reports.js — жалобы #/reports?status=new
//
// Логика группировки перенесена из v1 без изменений, и это осознанно:
// очередь сгруппирована по НАРУШИТЕЛЮ, а не по жалобе (одна жалоба —
// шум, пять от разных людей — сигнал), наверху те, на кого пожаловалось
// больше всего РАЗНЫХ игроков. Это правило дороже любого оформления.
//
// Что изменилось против v1:
//   • фильтр лежит в адресе (?status=accepted) — ссылку на разобранное
//     можно переслать, а F5 не сбрасывает выбор;
//   • имена ведут на страницу игрока, а не открывают окно поверх:
//     разбор жалобы почти всегда продолжается на этой странице;
//   • после решения перерисовывается только очередь, а не вся панель.
// ===================================================================

(function () {
  // Без значков: часть из них (🆕, 📭) не входит в системный шрифт и
  // рисуется пустым прямоугольником — кнопка выглядит сломанной.
  const STATUSES = [
    ['new', 'Новые', 'new'],
    ['accepted', 'Подтверждённые', 'accepted'],
    ['rejected', 'Отклонённые', 'rejected'],
    ['all', 'Все', 'total'],
  ];

  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 60) return m + ' мин назад';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' ч назад' : Math.round(h / 24) + ' дн назад';
  };

  // Одна жалоба внутри группы
  const itemHtml = (r) => {
    // Много отклонённых жалоб у автора — повод отнестись к сигналу спокойнее
    const bad = r.rejectedByAuthor >= 3
      ? `<span class="a2-pill is-bad" title="Столько жалоб этого игрока уже отклонили">ложных: ${r.rejectedByAuthor}</span>`
      : '';
    const state = r.status === 'new' ? ''
      : `<span class="a2-pill">${r.status === 'accepted' ? '✅ подтверждена' : '📭 отклонена'}${r.handledBy ? ' · ' + UI.esc(r.handledBy) : ''}</span>`;
    return `<div class="a2-item">
      <div class="a2-item-ico">·</div>
      <div class="a2-item-txt">
        <b>${UI.esc(r.reason)}</b> ${UI.esc(r.where)} ·
        от <a href="${A2Router.build('player', r.fromId)}">${UI.esc(r.fromName)}</a> ${bad} ${state}
        <div style="white-space:pre-wrap;margin-top:3px">${UI.esc(r.text)}</div>
        ${r.verdict ? `<div class="a2-item-when">Комментарий: ${UI.esc(r.verdict)}</div>` : ''}
        <div class="a2-item-when">${ago(r.at)}</div>
        ${r.status === 'new' ? `<div class="a2-row" style="margin-top:5px">
          <button class="btn btn-inline" data-acc="${UI.esc(r.id)}">Подтвердить</button>
          <button class="btn btn-inline" data-rej="${UI.esc(r.id)}">Отклонить</button>
        </div>` : ''}
      </div>
    </div>`;
  };

  const groupHtml = (g) => {
    // Цвет рамки по числу РАЗНЫХ жалобщиков: сговором такое труднее накрутить
    const hot = g.uniqueReporters >= 3 ? 'var(--red)' : (g.uniqueReporters >= 2 ? 'var(--gold)' : 'var(--border)');
    return `<div class="a2-card" style="border-color:${hot}">
      <h3 style="text-transform:none;font-size:14px">
        <a href="${A2Router.build('player', g.targetId)}">${UI.esc(g.targetName)}</a>
        ${g.banned ? '<span class="a2-pill is-bad">заблокирован</span>' : ''}
        ${!g.exists ? '<span class="a2-pill">аккаунт удалён</span>' : ''}
        <span class="a2-muted" style="font-weight:400"> · ур. ${g.level} ·
          жалоб ${g.total} от ${g.uniqueReporters} разных игроков · последняя ${ago(g.lastAt)}</span>
      </h3>
      ${g.uniqueReporters >= 3 ? `<p style="color:var(--red);font-size:12px;margin:0 0 6px">
        ⚠️ На этого игрока жалуются много и независимо — стоит посмотреть в первую очередь.</p>` : ''}
      ${g.reports.map(itemHtml).join('')}
      ${g.reports.some((r) => r.status === 'new') ? `<div class="a2-row" style="margin-top:6px">
        <button class="btn btn-inline" data-all-rej="${UI.esc(g.targetId)}">Отклонить все по этому игроку</button>
      </div>` : ''}
    </div>`;
  };

  async function render(el, route) {
    const status = route.query.status || 'new';
    el.innerHTML = '<div class="a2-title">Жалобы</div><div class="loading">Загружаю очередь…</div>';

    let d = null;
    try { d = await API.get('/api/mod/reports?status=' + encodeURIComponent(status) + '&limit=60'); }
    catch (e) {
      el.innerHTML = `<div class="a2-card"><h3 style="color:var(--red)">Очередь не загрузилась</h3>
        <p class="a2-muted">${UI.esc(e.message)}</p></div>`;
      return;
    }

    // Счётчик в меню обновляем отсюда: сотрудник мог разобрать всё, и
    // красная цифра на кнопке не должна висеть до перезагрузки панели.
    A2.setBadge('reports', d.counts.new, d.counts.new >= 5 ? 'hot' : 'warn');

    el.innerHTML = `
      <div class="a2-title">Жалобы игроков</div>
      <div class="a2-card">
        <p class="a2-muted" style="margin:0 0 8px">Сгруппированы по тому, <b>на кого</b> жалуются.
          Сверху — те, на кого пожаловалось больше всего <b>разных</b> игроков: сговором такое
          накрутить труднее, чем пять жалоб с одного аккаунта.
          <b>Санкции здесь не выдаются</b> — решение только помечает жалобу разобранной,
          наказание выдаётся на странице игрока осознанно и отдельно.</p>
        <div class="a2-row">
          ${STATUSES.map(([id, label, key]) => `<button class="btn btn-inline ${status === id ? 'btn-orange' : ''}"
            data-filt="${id}">${label} (${d.counts[key]})</button>`).join('')}
        </div>
      </div>
      <div id="rp-list">
        ${d.groups.length ? d.groups.map(groupHtml).join('')
          : `<div class="a2-card"><p class="a2-muted">${status === 'new'
              ? '✅ Новых жалоб нет — очередь разобрана.' : 'Здесь пусто.'}</p></div>`}
      </div>`;

    el.querySelectorAll('[data-filt]').forEach((b) => {
      b.onclick = () => A2Router.setQuery({ status: b.dataset.filt });
    });

    const decide = async (url, data, question) => {
      const verdict = await UI.prompt(question, {
        title: 'Решение по жалобе', icon: '📨', multiline: true, maxLength: 300,
        placeholder: 'Комментарий жалобщику (можно оставить пустым)', okText: 'Применить',
      });
      if (verdict === null) return;
      try {
        await API.post(url, Object.assign({}, data, { verdict }));
        render(el, A2Router.parse());   // перерисовываем очередь, не всю панель
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    el.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => decide(
      '/api/mod/report/resolve', { id: b.dataset.acc, accept: true },
      'Жалоба обоснована. Жалобщик получит уведомление. Наказание нарушителю выдаётся отдельно.'));
    el.querySelectorAll('[data-rej]').forEach((b) => b.onclick = () => decide(
      '/api/mod/report/resolve', { id: b.dataset.rej, accept: false },
      'Жалоба не подтвердилась. Жалобщик получит уведомление — объясните почему, это учит жаловаться по делу.'));
    el.querySelectorAll('[data-all-rej]').forEach((b) => b.onclick = () => decide(
      '/api/mod/report/resolve-all', { targetId: b.dataset.allRej, accept: false },
      'Отклонить ВСЕ новые жалобы на этого игрока разом.'));
  }

  A2.screens.reports = render;
})();
