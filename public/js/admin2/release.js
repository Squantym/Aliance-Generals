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
        <div class="a2-row" style="margin-top:10px;flex-wrap:wrap;gap:8px">
          <input id="ta-login" placeholder="позывной" maxlength="16"
                 style="padding:6px 10px;background:var(--bg);color:var(--text);
                        border:1px solid var(--border);border-radius:8px;width:180px">
          <input id="ta-pass" placeholder="пароль (мин. 8)" maxlength="40"
                 style="padding:6px 10px;background:var(--bg);color:var(--text);
                        border:1px solid var(--border);border-radius:8px;width:200px">
          <button class="btn btn-orange btn-inline" id="ta-go">Создать аккаунт</button>
          <button class="btn btn-inline" id="ta-rand">Придумать за меня</button>
        </div>
        <div id="ta-out"></div>
      </div>`;

    // ── Состояние игры ────────────────────────────────────────────
    const maintBlock = `
      <div class="a2-card" style="${m.on ? 'border-color:var(--orange-1)' : ''}">
        <h3>${m.on ? '🛠 Игра закрыта на обновление' : '✅ Игра открыта для игроков'}</h3>
        ${m.on ? `
          <p class="a2-muted">Причина: <b>${UI.esc(m.reason || '')}</b></p>
          <p class="a2-muted">Включено ${UI.esc(dt(m.at))}${m.by ? ', ' + UI.esc(m.by) : ''}.
          ${m.until ? 'Обещано до ' + UI.esc(dt(m.until)) + '.' : 'Срок не назывался.'}</p>
          <p class="a2-muted">Сотрудники в игру и в панель проходят как обычно — иначе снять режим
          было бы нечем.</p>
          <button class="btn btn-orange" id="m-off" style="margin-top:8px">Открыть игру для игроков</button>
        ` : `
          <p class="a2-muted">Закройте игру перед обновлением: во время выката данные меняются на
          ходу, и запрос, пришедший не вовремя, может оставить в базе полурассчитанный бой.</p>
          <div class="a2-row" style="margin-top:10px;flex-wrap:wrap;gap:8px">
            <input id="m-reason" placeholder="Что показать игрокам"
                   value="Идёт обновление игры. Скоро вернёмся."
                   style="padding:6px 10px;background:var(--bg);color:var(--text);
                          border:1px solid var(--border);border-radius:8px;flex:1;min-width:240px">
            <input id="m-min" type="number" min="0" max="1440" value="15" title="ориентировочно минут"
                   style="padding:6px 10px;background:var(--bg);color:var(--text);
                          border:1px solid var(--border);border-radius:8px;width:90px">
            <button class="btn btn-red btn-inline" id="m-on">Закрыть игру</button>
          </div>
          <p class="a2-muted" style="margin-top:6px">Срок — только надпись для игроков. Сам режим
          по времени не снимается: если обновление затянулось, автоматически открытые двери
          впустили бы людей в сломанную игру.</p>
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

    on('m-on', async () => {
      const reason = (document.getElementById('m-reason').value || '').trim();
      const minutes = Number(document.getElementById('m-min').value || 0);
      if (!await UI.confirm('Закрыть игру для всех игроков?\nСотрудники продолжат заходить как обычно.')) return;
      try { await API.post('/api/admin/maintenance', { on: true, reason, minutes }); render(el); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    });

    on('m-off', async () => {
      if (!await UI.confirm('Открыть игру для игроков?\nУбедитесь, что она работает — проверьте её сами.')) return;
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

    on('ta-rand', () => {
      const n = Math.floor(Math.random() * 900 + 100);
      document.getElementById('ta-login').value = 'Тестер' + n;
      document.getElementById('ta-pass').value = 'test' + n + 'pass';
    });

    on('ta-go', async () => {
      const login = (document.getElementById('ta-login').value || '').trim();
      const password = (document.getElementById('ta-pass').value || '').trim();
      if (!login || password.length < 8) return UI.toast('⛔ Нужен позывной и пароль от 8 символов');
      try {
        const r = await API.post('/api/admin/test-account', { login, password });
        // Пароль показываем ОДИН раз и сразу: хранить его в базе в
        // читаемом виде нельзя, а передать тестировщику надо.
        document.getElementById('ta-out').innerHTML = `
          <div class="a2-card" style="margin-top:10px;background:rgba(255,255,255,.03)">
            <div>✅ Аккаунт создан. Передайте тестировщику:</div>
            <div style="margin-top:6px;font-family:ui-monospace,Menlo,Consolas,monospace">
              логин: <b>${UI.esc(r.login)}</b><br>пароль: <b>${UI.esc(r.password)}</b>
            </div>
            <p class="a2-muted small" style="margin-top:6px">${UI.esc(r.note || '')}
            Пароль больше нигде не показывается — в базе он хранится только в виде хеша.</p>
          </div>`;
        document.getElementById('ta-login').value = '';
        document.getElementById('ta-pass').value = '';
      } catch (e) { UI.toast('⛔ ' + e.message); }
    });
  }

  A2.screens.release = render;
})();
