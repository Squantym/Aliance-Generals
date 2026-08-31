// ═══════════════════════════════════════════════════════════════════
// public/js/admin2/wipe.js — «Обнуление мира» в панели
//
// Экран одной кнопки, которую нельзя нажать случайно. Отменить её
// нельзя — можно только развернуть копию базы, поэтому здесь всё
// устроено против быстрого клика:
//
//  1. СНАЧАЛА ПОКАЗЫВАЕМ, ЧТО ПРОПАДЁТ. Не «вы уверены?», а числа:
//     столько-то игроков, столько-то легионов. Вопрос «уверены?» без
//     цифр люди подтверждают не думая.
//  2. ФРАЗУ НАДО НАБРАТЬ РУКАМИ, и она с номером мира — то, что
//     набирают одинаково каждый раз, набирается не глядя.
//  3. КНОПКА НЕ АКТИВНА, пока фраза не совпала. Проверка есть и на
//     сервере: тут она лишь бережёт от лишнего запроса.
//  4. НИЖЕ — АРХИВ ПРОШЛЫХ МИРОВ. Он остаётся после обнуления, и
//     видеть его прямо здесь важно: становится понятно, что стирается
//     не всё, и решение принимается спокойнее.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const dt = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU',
    { dateStyle: 'short', timeStyle: 'short' }) : '—');

  const mb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' МБ'
    : b >= 1024 ? Math.round(b / 1024) + ' КБ' : b + ' Б');

  async function render(el) {
    el.innerHTML = '<div class="a2-title">Обнуление мира</div><p class="a2-muted">Считаю…</p>';
    let d = null;
    try { d = await API.get('/api/admin/world-reset'); }
    catch (e) {
      el.innerHTML = `<div class="a2-title">Обнуление мира</div>
        <div class="a2-card"><p style="color:var(--red)">⛔ ${UI.esc(e.message)}</p></div>`;
      return;
    }

    const inp = 'padding:6px 10px;background:var(--bg);color:var(--text);'
      + 'border:1px solid var(--border);border-radius:8px';

    const human = d.human || {};
    const rows = Object.keys(d.counts || {})
      .sort((a, b) => d.counts[b] - d.counts[a])
      .map((k) => `<li>${UI.esc(human[k] || k)}: <b>${d.counts[k]}</b></li>`)
      .join('');

    const arch = (d.archive || []).length ? `
      <div class="a2-card">
        <h3>Прошлые миры</h3>
        <p class="a2-muted">Каждый закрытый мир заморожен в отдельный файл в
        <code>data/worlds/</code>. Ротация копий его не касается: он лежит, пока вы сами
        его не удалите. Из этого файла прошлый мир поднимается целиком — со всеми игроками,
        журналом и историей.</p>
        <table class="a2-table" style="margin-top:8px">
          <tr><th>Мир</th><th>Закрыт</th><th>Игроков</th><th>Кто</th><th>Причина</th><th>Файл</th></tr>
          ${d.archive.slice().reverse().map((a) => `<tr>
            <td>№${a.n}</td><td>${UI.esc(dt(a.endedAt))}</td>
            <td>${a.players || 0}</td><td>${UI.esc(a.by || '')}</td>
            <td>${UI.esc(a.reason || '—')}</td>
            <td><code>${UI.esc(a.file || '—')}</code>${a.bytes ? ' · ' + mb(a.bytes) : ''}</td></tr>`).join('')}
        </table>
      </div>` : '';

    el.innerHTML = `
      <div class="a2-title">Обнуление мира</div>

      <div class="a2-card" style="border-color:var(--red)">
        <h3 style="color:var(--red)">Идёт мир №${d.world}</h3>
        <p class="a2-muted">Обнуление стирает игру начисто: игроков, всё нажитое, журнал
        действий, историю состояний. Люди заходят и не находят ни аккаунта, ни армии — и
        регистрируются заново. <b>Отменить это нельзя.</b></p>

        <p class="a2-muted" style="margin-top:10px">Сейчас в игре:</p>
        <ul class="a2-muted" style="margin:4px 0 0 18px">
          <li>игроков: <b style="color:var(--red)">${d.players}</b></li>
          ${d.logs ? `<li>записей в журнале действий: <b>${d.logs}</b></li>` : ''}
          ${d.history ? `<li>срезов истории игроков: <b>${d.history}</b></li>` : ''}
          ${rows}
        </ul>

        <p class="a2-muted" style="margin-top:10px"><b>Останется только это:</b> ваш аккаунт
        (логин, пароль, роль владельца и второй фактор — регистрироваться заново не
        придётся), указатель на замороженные миры, счётчик тарифа почты, ключи
        push-уведомлений и настройки ролей. Всё остальное уходит.</p>

        ${d.canFreeze ? `
          <p class="a2-muted" style="margin-top:10px">Прямо перед стиранием мир
          <b>замораживается</b>: полный слепок базы ляжет отдельным файлом в
          <code>data/worlds/</code>, и ротация копий его не тронет. Не удастся заморозить —
          обнуление отменится, не стерев ничего.</p>`
        : `<p class="a2-muted" style="color:var(--orange-1);margin-top:10px">⚠ База файловая:
          заморозить мир в отдельный файл нечем. Скопируйте папку <code>data</code> вручную
          и поставьте галочку ниже — иначе обнуление откажется работать.</p>
          <p class="a2-muted" style="margin-top:6px">
            <label><input type="checkbox" id="w-nofreeze"> копию папки data я сделал,
            стирать без слепка</label></p>`}
      </div>

      <div class="a2-card">
        <h3>Подтверждение</h3>
        <label class="a2-muted">Зачем обнуляем (попадёт в архив и в журнал)</label>
        <input id="w-reason" maxlength="300" placeholder="например: конец первого сезона"
               style="${inp};width:100%;margin-top:4px">

        <p class="a2-muted" style="margin-top:12px">
          <label><input type="checkbox" id="w-self" checked> обнулить и мой прогресс тоже</label>
        </p>
        <p class="a2-muted small">Снимете галочку — останетесь с прежним уровнем, армией и
        постройками в мире, где у всех остальных первый уровень. Купленное золото не сгорает
        в любом случае: оно оплачено настоящими деньгами.</p>

        <p class="a2-muted" style="margin-top:12px">Наберите руками, без копирования:
          <b style="color:var(--red)">${UI.esc(d.phrase)}</b></p>
        <input id="w-confirm" placeholder="${UI.esc(d.phrase)}" autocomplete="off"
               style="${inp};width:100%;max-width:320px">

        <div class="a2-row" style="margin-top:12px">
          <button class="btn btn-red btn-inline" id="w-go" disabled>Обнулить мир</button>
        </div>
      </div>

      ${arch}`;

    const conf = document.getElementById('w-confirm');
    const go = document.getElementById('w-go');
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    // Кнопка оживает только на совпавшей фразе. Это не защита — защита на
    // сервере, — а способ не дать нажать раньше, чем человек прочитал.
    conf.oninput = () => { go.disabled = norm(conf.value) !== norm(d.phrase); };

    go.onclick = async () => {
      const resetOwner = document.getElementById('w-self').checked;
      const reason = (document.getElementById('w-reason').value || '').trim();
      if (!await UI.confirm(
        `Обнулить мир №${d.world}?\n\n`
        + `Будет удалено игроков: ${d.players}.\n`
        + `${resetOwner ? 'Ваш прогресс тоже обнулится.' : 'Ваш прогресс сохранится.'}\n\n`
        + 'Отменить это нельзя. Копия базы снимется автоматически.', {
        title: 'Обнуление мира', icon: '💥', okText: 'Обнулить', danger: true,
      })) return;

      go.disabled = true;
      go.textContent = 'Стираю…';
      try {
        const nf = document.getElementById('w-nofreeze');
        const r = await API.post('/api/admin/world-reset', {
          confirm: conf.value, reason, resetOwner,
          allowNoFreeze: !!(nf && nf.checked),
        });
        const w = r.wiped || {};
        el.innerHTML = `
          <div class="a2-title">Обнуление мира</div>
          <div class="a2-card" style="border-color:var(--gold)">
            <h3 style="color:var(--gold)">💥 Мир №${r.world} закрыт</h3>
            <p class="a2-muted">Удалено игроков: <b>${r.removed}</b>. Оставлено: ${r.kept}.</p>
            ${w.action_logs || w.player_history ? `<p class="a2-muted">Стёрто записей журнала:
              <b>${w.action_logs || 0}</b>, срезов истории: <b>${w.player_history || 0}</b>,
              коллекций: <b>${w.collections || 0}</b>.</p>` : ''}
            ${r.file ? `<p class="a2-muted">Мир заморожен в <code>data/worlds/${UI.esc(r.file)}</code>
              (${mb(r.bytes || 0)}) — из этого файла он поднимается целиком.</p>`
              : '<p class="a2-muted" style="color:var(--orange-1)">Слепок не снимался (файловая база).</p>'}
            <p class="a2-muted">Игра <b>закрыта на обслуживание</b>. Это намеренно: посмотрите
            своими глазами, что мир действительно пуст и игра работает, и только потом
            открывайте — «Обновление» → «Открыть игру для игроков».</p>
            <p class="a2-muted">Если игроки не смогут зарегистрироваться — проверьте почту:
            без <code>SMTPBZ_API_KEY</code> регистрация закрыта намеренно, чтобы аккаунты не
            заводились на неподтверждённые адреса.</p>
            <button class="btn btn-orange mt" id="w-again">К списку миров</button>
          </div>`;
        const b = document.getElementById('w-again');
        if (b) b.onclick = () => render(el);
      } catch (e) {
        go.disabled = false;
        go.textContent = 'Обнулить мир';
        UI.toast('⛔ ' + e.message);
      }
    };
  }

  A2.screens.wipe = render;
})();
