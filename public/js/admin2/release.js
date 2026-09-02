// ═══════════════════════════════════════════════════════════════════
// public/js/admin2/release.js — «Обновление» в панели
//
// Три действия владельца в одном месте:
//   1. Закрыть игру на обновление и открыть обратно.
//   2. Выкатить версию, проверенную в тестовом мире.
//   3. Завести тестовый аккаунт (только в тестовом мире).
//
// Почему открытие игры — отдельная кнопка, а не хвост выката. После
// обновления игра может не подняться: ошибка сборки, забытая переменная
// окружения, несовместимая правка. Автоматически открытые двери
// означали бы, что о поломке сообщат игроки. Здесь человек сначала
// смотрит своими глазами, потом открывает.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const dt = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU',
    { dateStyle: 'short', timeStyle: 'medium' }) : '—');

  async function render(el) {
    el.innerHTML = '<div class="a2-title">Обновление</div><p class="a2-muted">Загружаю…</p>';
    let d = null;
    try { d = await API.get('/api/admin/release'); }
    catch (e) {
      el.innerHTML = `<div class="a2-title">Обновление</div>
        <div class="a2-card"><p style="color:var(--red)">⛔ ${UI.esc(e.message)}</p></div>`;
      return;
    }

    const m = d.maintenance || {};
    const cur = d.current || {};
    const dep = d.deploy;
    const isTest = !!(d.world && d.world.on);

    // ── Тестовый мир: тут выката нет, зато есть выдача аккаунтов ──
    const testBlock = !isTest ? '' : `
      <div class="a2-card" style="border-color:var(--orange-1)">
        <h3>🧪 Это тестовый мир</h3>
        <p class="a2-muted">Публичная регистрация здесь закрыта. Аккаунты заводите сами
        и передавайте тестировщикам — почта не нужна и не проверяется.</p>
        ${d.world.mailConfigured
          ? '<p class="a2-muted" style="color:var(--orange-1)">⚠ В тестовом мире задан ключ почтового сервиса. '
            + 'Письма отсюда будут уходить по-настоящему и тратить лимит боевого тарифа — уберите SMTPBZ_API_KEY.</p>'
          : '<p class="a2-muted">Почта не настроена — письма никуда не уходят, адрес подтверждается сам. Так и надо.</p>'}
        <p style="margin-top:10px">Выдача аккаунтов переехала в раздел
          <a href="${A2Router.build('players')}"><b>«Игроки»</b></a> — искать её приходили
          именно туда, а здесь не находили.</p>
      </div>`;

    // ── Состояние игры ────────────────────────────────────────────
    // Три разных состояния, а не два: игра открыта; игра закрыта;
    // окно назначено на потом, но игра пока работает. Третье выглядит
    // иначе намеренно — увидев жёлтую рамку «закрыта», владелец начал
    // бы выкатывать, хотя игроки ещё в игре.
    const inp = 'padding:6px 10px;background:var(--bg);color:var(--text);'
      + 'border:1px solid var(--border);border-radius:8px';

    // Текст многострочный: в окне обновления это единственное, что
    // владелец может сказать игрокам, и одной строки на «что чиним,
    // надолго ли и что будет с прогрессом» не хватает.
    const openForm = `
      <div class="a2-row" style="margin-top:10px">
        <textarea id="m-reason" rows="4" maxlength="1500"
               placeholder="Текст, который увидят игроки в окне обновления. Можно в несколько абзацев."
               style="${inp};flex:1;min-width:240px;resize:vertical;line-height:1.5;font:inherit"
        >Идёт обновление игры. Скоро вернёмся.</textarea>
      </div>
      <div class="a2-row" style="margin-top:8px;flex-wrap:wrap;gap:8px;align-items:center">
        <label class="a2-muted small">начать через
          <input id="m-delay" type="number" min="0" max="10080" value="0"
                 style="${inp};width:80px;margin-left:6px"> мин</label>
        <label class="a2-muted small">длительность
          <input id="m-min" type="number" min="0" max="1440" value="15"
                 style="${inp};width:80px;margin-left:6px"> мин</label>
        <label class="a2-muted small" title="Только для заранее назначенных окон">
          <input type="checkbox" id="m-auto"> открыть игру самому по истечении срока</label>
      </div>
      <div class="a2-row" style="margin-top:10px;flex-wrap:wrap;gap:8px">
        <button class="btn btn-red btn-inline" id="m-on">Закрыть игру сейчас</button>
        <button class="btn btn-inline" id="m-plan">Назначить на потом</button>
      </div>
      <p class="a2-muted" style="margin-top:6px">«Начать через 0» — то же самое, что «закрыть
      сейчас». Назначенное окно игру не закрывает: до его начала люди играют как обычно и видят
      сверху полосу с обратным отсчётом, чтобы успеть доиграть бой, а не вылететь из него.</p>
      <p class="a2-muted" style="margin-top:6px">Галочка самооткрытия по умолчанию снята и для
      выката не ставится никогда: если обновление затянулось, автоматически открытые двери
      впустили бы людей в сломанную игру. Она нужна для ночной профилактики, которую вы не
      собираетесь закрывать вручную в четыре утра.</p>`;

    const maintBlock = m.pending ? `
      <div class="a2-card" style="border-color:var(--orange-1)">
        <h3>🕒 Окно обслуживания назначено</h3>
        <p class="a2-muted">Начнётся <b>${UI.esc(dt(m.startAt))}</b>
        ${m.until ? ' и продлится до ' + UI.esc(dt(m.until)) : ''}.
        ${m.auto ? 'По истечении срока игра откроется сама.'
          : 'Открывать игру придётся кнопкой — сама она не откроется.'}</p>
        <p class="a2-muted">Игроки сейчас <b>играют как обычно</b> и видят полосу с обратным
        отсчётом. Причина: «${UI.esc(m.reason || '')}»
        ${m.by ? ' · назначил ' + UI.esc(m.by) : ''}.</p>
        <button class="btn btn-orange" id="m-off" style="margin-top:8px">Отменить назначенное окно</button>
      </div>`
      : `
      <div class="a2-card" style="${m.on ? 'border-color:var(--orange-1)' : ''}">
        <h3>${m.on ? '🛠 Игра закрыта на обновление' : '✅ Игра открыта для игроков'}</h3>
        ${m.on ? `
          <p class="a2-muted">Текст в окне у игроков:</p>
          <p class="a2-muted" style="white-space:pre-line;border-left:2px solid var(--border);
             padding-left:10px;color:var(--text)">${UI.esc(m.reason || '')}</p>
          <p class="a2-muted">Включено ${UI.esc(dt(m.at))}${m.by ? ', ' + UI.esc(m.by) : ''}.
          ${m.until ? 'Обещано до ' + UI.esc(dt(m.until)) + '.' : 'Срок не назывался.'}
          ${m.auto ? '<b>Игра откроется сама по истечении срока.</b>' : ''}</p>
          ${m.frozenFrom ? `<p class="a2-muted">⏳ Игровые таймеры стоят с ${UI.esc(dt(m.frozenFrom))}.
          Бои, ракеты и постройки не двигаются; при открытии все сроки уедут вперёд ровно на
          время простоя.</p>` : ''}
          <p class="a2-muted">Сотрудники в игру и в панель проходят как обычно — иначе снять режим
          было бы нечем.</p>
          <button class="btn btn-orange" id="m-off" style="margin-top:8px">Открыть игру для игроков</button>
        ` : `
          <p class="a2-muted">Закройте игру перед обновлением: во время выката данные меняются на
          ходу, и запрос, пришедший не вовремя, может оставить в базе полурассчитанный бой.</p>
          ${openForm}
          ${m.lastFreeze && m.lastFreeze.moved ? `
            <p class="a2-muted" style="margin-top:8px">⏳ После прошлого обновления сроки сдвинуты
            на ${Math.round((m.lastFreeze.delta || 0) / 1000)} с — переехало
            ${m.lastFreeze.moved} значений.</p>` : ''}
          ${m.lastFreeze && !m.lastFreeze.moved && m.lastFreeze.why ? `
            <p class="a2-muted" style="margin-top:8px;color:var(--orange-1)">⏳ Прошлая разморозка
            ничего не сдвинула: ${UI.esc(m.lastFreeze.why)}</p>` : ''}
        `}
      </div>`;

    // ── Версия и выкат ────────────────────────────────────────────
    const depState = dep ? dep.state : '';
    const running = depState === 'идёт' || depState === 'перезапуск';
    const verBlock = `
      <div class="a2-card">
        <h3>Версия на этом сервере</h3>
        ${cur.isGit ? `
          <div class="a2-muted small">
            <code>${UI.esc(cur.short || '')}</code> · ветка ${UI.esc(cur.branch || '—')} ·
            ${UI.esc((cur.at || '').slice(0, 16).replace('T', ' '))}
          </div>
          <div style="margin-top:4px">${UI.esc(cur.subject || '')}</div>
          ${cur.dirty ? '<p class="a2-muted" style="color:var(--orange-1);margin-top:6px">⚠ В рабочем дереве есть незакоммиченные правки — выкат их сбросит.</p>' : ''}
          <div class="a2-row" style="margin-top:8px">
            <input readonly value="${UI.esc(cur.commit || '')}" onclick="this.select()"
                   style="flex:1;padding:6px 10px;background:var(--bg);color:var(--text);
                          border:1px solid var(--border);border-radius:8px;
                          font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">
          </div>
          ${isTest ? '<p class="a2-muted" style="margin-top:6px">Это номер версии, которую вы тут проверяете. '
            + 'Скопируйте его и вставьте в поле выката на боевом сервере.</p>' : ''}
        ` : `<p class="a2-muted">${UI.esc(d.why || 'Сведения о версии недоступны.')}</p>`}
      </div>

      <div class="a2-card">
        <h3>${isTest ? 'Обновить тестовый мир' : 'Выкатить версию'}</h3>
        ${d.canDeploy ? `
          <p class="a2-muted">${isTest
            ? 'Подтянуть свежий код из ветки и пересобрать тестовый мир. Оставьте поле пустым — '
              + 'возьмётся последнее из <code>origin/' + UI.esc(cur.branch || 'main') + '</code>. '
              + 'Это замена команде в консоли.'
            : 'Вставьте номер версии, проверенной в тестовом мире. Пусто — '
              + 'выкатится последнее из текущей ветки.'}</p>
          <div class="a2-row" style="margin-top:8px;flex-wrap:wrap;gap:8px">
            <input id="dp-commit" placeholder="номер коммита или origin/${UI.esc(cur.branch || 'main')}"
                   style="flex:1;min-width:260px;padding:6px 10px;background:var(--bg);color:var(--text);
                          border:1px solid var(--border);border-radius:8px;
                          font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">
            <button class="btn ${isTest ? 'btn-orange' : 'btn-red'} btn-inline" id="dp-go" ${running ? 'disabled' : ''}>
              ${running ? 'Идёт…' : (isTest ? 'Обновить тестовый мир' : 'Выкатить на боевой')}
            </button>
          </div>
          <p class="a2-muted" style="margin-top:6px">${isTest
            ? 'Тестовый мир закроется на время сборки и не откроется сам — так же, как боевой. '
              + 'Это намеренно: пусть тест ведёт себя как боевой сервер, тогда сюрпризов на выкате не будет.'
            : 'Игра будет закрыта автоматически. После выката проверьте её и откройте кнопкой выше — '
              + 'сама она не откроется.'}</p>
        ` : `<p class="a2-muted">${UI.esc(d.why || '')}</p>`}

        ${dep ? `
          <hr class="a2-hr">
          <div class="a2-muted small">
            Последний выкат: <b>${UI.esc(dep.state || '—')}</b> ·
            <code>${UI.esc((dep.commit || '').slice(0, 12))}</code> ·
            ${UI.esc(dep.by || '')} · начат ${UI.esc(dt(dep.startedAt))}
            ${dep.finishedAt ? ' · закончен ' + UI.esc(dt(dep.finishedAt)) : ''}
          </div>
          ${dep.error ? `<div style="color:var(--red);margin-top:4px">⛔ ${UI.esc(dep.error)}</div>` : ''}
          ${dep.rollbackTo ? `
            <p class="a2-muted small" style="margin-top:6px">Точка отката:
              <code>${UI.esc(dep.rollbackTo.slice(0, 12))}</code> — вставьте её в поле выше, чтобы вернуться.</p>` : ''}
        ` : ''}
      </div>

      ${d.log ? `
      <div class="a2-card">
        <h3>Журнал выката</h3>
        <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;
                    background:var(--bg);border:1px solid var(--border);border-radius:8px;
                    padding:10px;max-height:320px;overflow:auto">${UI.esc(d.log)}</pre>
        <button class="btn btn-inline" id="dp-refresh" style="margin-top:8px">Обновить</button>
      </div>` : ''}`;

    el.innerHTML = `<div class="a2-title">Обновление${isTest ? ' · тестовый мир' : ''}</div>
      ${testBlock}${maintBlock}${verBlock}`;

    // ── Обработчики ───────────────────────────────────────────────
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };

    // Обе кнопки — одна и та же ручка, разница только в «через сколько».
    // Кнопка «сейчас» намеренно игнорирует поле задержки: человек,
    // заполнивший его и нажавший не ту кнопку, не должен обнаружить, что
    // игра всё ещё открыта, а окно тихо назначено на восемь часов вперёд.
    const closeGame = async (planned) => {
      const reason = (document.getElementById('m-reason').value || '').trim();
      const durationMin = Number(document.getElementById('m-min').value || 0);
      const delayMin = planned ? Number(document.getElementById('m-delay').value || 0) : 0;
      const auto = !!(document.getElementById('m-auto') || {}).checked;
      if (planned && delayMin <= 0) return UI.toast('⛔ Укажите, через сколько минут начать');
      const when = planned
        ? new Date(Date.now() + delayMin * 60000).toLocaleString('ru-RU',
          { dateStyle: 'short', timeStyle: 'short' })
        : '';
      const q = planned
        ? `Назначить окно обслуживания на ${when}?\n\n`
          + `Игроки продолжат играть и увидят обратный отсчёт.`
          + (durationMin ? `\nДлительность: ${durationMin} мин.` : '')
          + (auto ? '\nПо истечении срока игра откроется САМА.' : '')
        : 'Закрыть игру для всех игроков прямо сейчас?\nСотрудники продолжат заходить как обычно.';
      if (!await UI.confirm(q)) return;
      try {
        await API.post('/api/admin/maintenance', { on: true, reason, delayMin, durationMin, auto });
        render(el);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    on('m-on', () => closeGame(false));
    on('m-plan', () => closeGame(true));

    on('m-off', async () => {
      const q = m.pending
        ? 'Отменить назначенное окно обслуживания?\nИгроки перестанут видеть обратный отсчёт.'
        : 'Открыть игру для игроков?\nУбедитесь, что она работает — проверьте её сами.';
      if (!await UI.confirm(q)) return;
      try { await API.post('/api/admin/maintenance', { on: false }); render(el); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    });

    on('dp-go', async () => {
      const commit = (document.getElementById('dp-commit').value || '').trim();
      const what = commit || `последнее из origin/${cur.branch || 'main'}`;
      const q = isTest
        ? `Обновить тестовый мир до ${what}?\n\nОн закроется на время сборки — несколько минут.`
        : `Выкатить ${what} НА БОЕВОЙ?\n\nИгра закроется для игроков, сервер пересоберётся `
          + 'и перезапустится. Это несколько минут.';
      if (!await UI.confirm(q)) return;
      try {
        await API.post('/api/admin/release/deploy', { commit });
        UI.toast('🚀 Выкат запущен');
        // Через несколько секунд сервер перезапустится и панель отвалится —
        // это ожидаемо. Пока он жив, показываем ход работы.
        setTimeout(() => render(el), 3000);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    });

    on('dp-refresh', () => render(el));

  }

  A2.screens.release = render;
})();
