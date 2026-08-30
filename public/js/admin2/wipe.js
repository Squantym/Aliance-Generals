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

  const NAMES = {
    legions: 'легионы', alliances: 'альянсы', alliance_invites: 'приглашения в альянс',
    battles: 'бои', arena: 'арена', groupBattle: 'групповые бои', rockets: 'ракеты',
    sanctions: 'санкции', news: 'новости', broadcast: 'рассылки', mail: 'почта в игре',
    world: 'мир (чат, аукцион)', world_event: 'событие мира', discounts: 'скидки',
    dailyFame: 'слава за день', season: 'сезон', weeklySeason: 'недельный сезон',
  };

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

    const rows = Object.keys(d.counts || {})
      .filter((k) => d.counts[k] > 0)
      .map((k) => `<li>${UI.esc(NAMES[k] || k)}: <b>${d.counts[k]}</b></li>`)
      .join('');

    const arch = (d.archive || []).length ? `
      <div class="a2-card">
        <h3>Прошлые миры</h3>
        <p class="a2-muted">Эти записи обнуление не стирает — новый мир пишет свою строку
        рядом. Здесь же виден файл копии базы, из которой мир можно поднять целиком.</p>
        <table class="a2-table" style="margin-top:8px">
          <tr><th>Мир</th><th>Закрыт</th><th>Игроков</th><th>Кто</th><th>Причина</th></tr>
          ${d.archive.slice().reverse().map((a) => `<tr>
            <td>№${a.n}</td><td>${UI.esc(dt(a.endedAt))}</td>
            <td>${a.players || 0}</td><td>${UI.esc(a.by || '')}</td>
            <td>${UI.esc(a.reason || '—')}</td></tr>`).join('')}
        </table>
      </div>` : '';

    el.innerHTML = `
      <div class="a2-title">Обнуление мира</div>

      <div class="a2-card" style="border-color:var(--red)">
        <h3 style="color:var(--red)">Идёт мир №${d.world}</h3>
        <p class="a2-muted">Обнуление стирает всех игроков и всё, что они нажили. Люди
        заходят и не находят ни аккаунта, ни армии — и регистрируются заново. <b>Отменить это
        нельзя</b>: единственный путь назад — развернуть копию базы, которая снимается прямо
        перед стиранием.</p>

        <p class="a2-muted" style="margin-top:10px">Сейчас в игре:</p>
        <ul class="a2-muted" style="margin:4px 0 0 18px">
          <li>игроков: <b style="color:var(--red)">${d.players}</b></li>
          ${rows}
        </ul>

        <p class="a2-muted" style="margin-top:10px"><b>Останется:</b> ваш аккаунт (логин,
        пароль и второй фактор — регистрироваться заново не придётся), журнал действий,
        итоги прошлых миров, счётчик тарифа почты и настройки ролей.</p>
        ${d.canBackup ? '' : '<p class="a2-muted" style="color:var(--orange-1)">⚠ База файловая — '
          + 'автоматическая копия не снимается. Сделайте копию папки data вручную.</p>'}
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
        const r = await API.post('/api/admin/world-reset', { confirm: conf.value, reason, resetOwner });
        el.innerHTML = `
          <div class="a2-title">Обнуление мира</div>
          <div class="a2-card" style="border-color:var(--gold)">
            <h3 style="color:var(--gold)">💥 Мир №${r.world} закрыт</h3>
            <p class="a2-muted">Удалено игроков: <b>${r.removed}</b>. Оставлено: ${r.kept}.</p>
            ${r.backup ? `<p class="a2-muted">Копия базы: <code>${UI.esc(r.backup)}</code> —
              из неё прошлый мир поднимается целиком.</p>` : ''}
            <p class="a2-muted">Игра <b>закрыта на обслуживание</b>. Это намеренно: посмотрите
            своими глазами, что мир действительно пуст и игра работает, и только потом
            открывайте — «Обновление» → «Открыть игру для игроков».</p>
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
