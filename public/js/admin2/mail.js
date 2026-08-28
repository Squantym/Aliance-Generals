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

// ── Визуальный редактор письма ─────────────────────────────────────
// Раньше тут было голое окно с разметкой, и владельцу приходилось писать
// теги руками. Отсюда и брались поломки вроде {{Альянс Генералов}} в
// теме: человек видел фигурные скобки, думал, что так задаётся любое
// значение, и почтовый сервис отклонял письмо целиком.
//
// Теперь письмо правится как в обычном редакторе, а подстановки —
// цветные метки, которые вставляются кнопкой. Режим «Код» оставлен: он
// нужен, когда надо вставить готовую вёрстку письма.
window.MailEdit = {
  // {{имя}} в ТЕКСТЕ становится меткой. В атрибутах не трогаем: ссылка
  // кнопки — это href="{{ссылка}}", и подмена там сломала бы переход.
  toEditor(html) {
    const box = document.createElement('div');
    box.innerHTML = String(html || '');
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach((node) => {
      const val = node.nodeValue || '';
      if (!/\{\{[^{}]+\}\}/.test(val)) return;
      const frag = document.createDocumentFragment();
      const re = /\{\{([^{}]+)\}\}/g;
      let last = 0, m;
      while ((m = re.exec(val))) {
        if (m.index > last) frag.appendChild(document.createTextNode(val.slice(last, m.index)));
        frag.appendChild(MailEdit.chip(m[1].trim()));
        last = m.index + m[0].length;
      }
      if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return box.innerHTML;
  },

  chip(name) {
    const s = document.createElement('span');
    s.className = 'mail-var';
    s.setAttribute('contenteditable', 'false');
    s.setAttribute('data-var', name);
    s.textContent = name;
    return s;
  },

  // Обратно: метки — снова {{имя}}. Работаем на копии, чтобы не мигал
  // экран и не сбивалась каретка во время набора.
  toHtml(editor) {
    const box = editor.cloneNode(true);
    box.querySelectorAll('.mail-var').forEach((s) => {
      s.parentNode.replaceChild(
        document.createTextNode('{{' + (s.getAttribute('data-var') || '') + '}}'), s);
    });
    return box.innerHTML;
  },

  // Вставка в место, где стоит каретка
  insertNode(editor, node) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      editor.appendChild(node);
    } else {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  },

  // Кнопка перехода: тот же вид, что в заводских письмах. Собираем её
  // здесь, чтобы владельцу не пришлось знать про inline-стили — почтовые
  // клиенты общий CSS всё равно вырезают, стиль обязан быть на теге.
  linkButton(href, text) {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('style', 'display:inline-block;padding:12px 24px;background:#d9a546;'
      + 'color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold');
    a.textContent = text;
    return a;
  },

  bindToolbar(card, editor, code) {
    const exec = (cmd, val) => { editor.focus(); document.execCommand(cmd, false, val || null); };

    card.querySelectorAll('.mail-tb').forEach((btn) => {
      const cmd = btn.getAttribute('data-cmd');
      if (!cmd) return;
      btn.onclick = async (e) => {
        e.preventDefault();
        if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') return exec(cmd);
        if (cmd === 'h2') return exec('formatBlock', 'h2');
        if (cmd === 'p') return exec('formatBlock', 'p');
        if (cmd === 'list') return exec('insertUnorderedList');

        if (cmd === 'link' || cmd === 'button') {
          const isBtn = cmd === 'button';
          // Для писем подтверждения и сброса нужная ссылка почти всегда
          // одна и та же — предлагаем её сразу, чтобы не заставлять
          // вспоминать написание подстановки.
          const href = await UI.prompt('Куда ведёт ссылка?', {
            title: isBtn ? 'Кнопка перехода' : 'Ссылка',
            icon: isBtn ? '▭' : '🔗',
            value: '{{ссылка}}',
            hint: '{{ссылка}} — подтверждение или смена пароля. Можно вписать любой адрес.',
            okText: 'Вставить',
          });
          if (!href) return;
          if (isBtn) {
            const text = await UI.prompt('Надпись на кнопке', {
              title: 'Кнопка перехода', icon: '▭', value: 'Подтвердить почту', okText: 'Вставить',
            });
            if (!text) return;
            MailEdit.insertNode(editor, MailEdit.linkButton(href, text));
          } else {
            exec('createLink', href);
          }
        }
      };
    });

    // Метки-подстановки: и в текст письма, и в тему
    card.querySelectorAll('.mail-varbtn').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const name = (btn.getAttribute('data-var') || '').replace(/[{}]/g, '');
        if (btn.getAttribute('data-into') === 'subject') {
          // Тема — обычное поле ввода, метку туда не вставить: пишем текстом
          const input = card.querySelector('.tpl-subject');
          const at = input.selectionStart === null ? input.value.length : input.selectionStart;
          const ins = '{{' + name + '}}';
          input.value = input.value.slice(0, at) + ins + input.value.slice(input.selectionEnd || at);
          input.focus();
          input.setSelectionRange(at + ins.length, at + ins.length);
          return;
        }
        MailEdit.insertNode(editor, MailEdit.chip(name));
      };
    });

    // Переключение «как выглядит» ↔ «разметка». Содержимое переносим в
    // обе стороны: иначе правка в одном окне пропадала бы при переходе.
    const toggle = card.querySelector('.tpl-codetoggle');
    if (toggle) toggle.onclick = (e) => {
      e.preventDefault();
      if (code.hidden) {
        code.value = MailEdit.toHtml(editor);
        code.hidden = false; editor.hidden = true;
        toggle.textContent = '👁 Как выглядит';
      } else {
        editor.innerHTML = MailEdit.toEditor(code.value);
        code.hidden = true; editor.hidden = false;
        toggle.innerHTML = '&lt;/&gt; Код';
      }
    };

    // Вставка из Word и с сайтов тащит чужие шрифты и цвета, которые в
    // письме выглядят инородно. Берём только текст — оформление
    // накладывается кнопками.
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  },
};

(function () {
  const dt = (ms) => ms
    ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';

  // Виды писем по-русски: в расходе лимита «verify» ничего не говорит
  const KIND_RU = {
    verify: 'подтверждения почты', reset: 'восстановление пароля',
    welcome: 'приветственные', news: 'рассылка', test: 'проверочные',
  };

  // Полоса расхода. Цвет меняется у порога: пока запас есть — обычный,
  // на исходе — предупреждающий. Число рядом обязательно: полоса
  // показывает «примерно», а решение принимается по цифрам.
  const bar = (label, used, limit) => {
    if (!limit) return '';
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const cls = pct >= 90 ? 'is-danger' : (pct >= 70 ? 'is-warn' : '');
    return `
      <div class="mail-bar-row">
        <div class="mail-bar-head">
          <span>${label}</span>
          <span><b>${used}</b> из ${limit} · ${pct}%</span>
        </div>
        <div class="mail-bar"><i class="${cls}" style="width:${pct}%"></i></div>
      </div>`;
  };

  const progress = (done, total) => {
    if (!total) return '';
    const pct = Math.min(100, Math.round((done / total) * 100));
    return `<div class="mail-bar" style="margin:6px 0"><i style="width:${pct}%"></i></div>`;
  };

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
    const q = mail.quota || null;

    el.innerHTML = `
      <div class="a2-title">Письма игрокам</div>

      <div class="a2-card">
        <h3 style="margin:0">Состояние отправки</h3>
        <p class="a2-muted" style="margin:6px 0 0">
          ${mail.configured
            ? `Отправитель: <b>${UI.esc(mail.from || '—')}</b>`
            : '<b style="color:var(--red)">Отправка не настроена.</b> Письма никуда не уходят, а новым игрокам почта подтверждается сама. Пока это так, правка шаблонов ни на что не влияет.'}
        </p>
        ${(mail.chain || []).length ? `
          <div class="mail-chain">
            ${mail.chain.map((p, i) => `
              <span class="mail-chain-item ${i === 0 ? 'is-main' : ''}">
                ${i === 0 ? '① основной' : '② запасной'}: <b>${UI.esc(p.name)}</b>
              </span>`).join('<span class="mail-chain-arrow">→</span>')}
          </div>
          ${mail.hasBackup
            ? '<p class="a2-muted small" style="margin:6px 0 0">Откажет основной — письмо уйдёт через запасной само.</p>'
            : '<p class="a2-muted small" style="margin:6px 0 0;color:var(--orange-1)">Сервис один. Откажет он — письма перестанут уходить совсем, и регистрация встанет.</p>'}
        ` : ''}
        ${mail.hint ? `<p class="a2-muted" style="margin-top:6px">${UI.esc(mail.hint)}</p>` : ''}
        ${mail.configured ? `
          <div class="a2-row" style="margin-top:10px">
            <button class="btn btn-inline" id="mail-diag">🔎 Проверить домен</button>
            <span class="a2-muted small">читает записи DNS, ничего не отправляет и лимит не тратит</span>
          </div>
          <div id="mail-diag-out"></div>` : ''}
      </div>

      ${q ? `
      <div class="a2-card">
        <h3 style="margin:0">Расход лимита</h3>
        <p class="a2-muted small" style="margin:6px 0 10px">
          Игра считает письма сама и останавливается заранее. Иначе тариф кончился бы
          молча — и первым перестал бы работать не список новостей, а подтверждение почты
          у новых игроков.
        </p>

        ${bar('За сутки', q.used.day, q.limits.day)}
        ${bar('За месяц', q.used.month, q.limits.month)}

        <div class="mail-quota-facts">
          <div><span class="a2-muted">Осталось сегодня</span><b>${q.left.day}</b></div>
          <div><span class="a2-muted">Осталось в месяце</span><b>${q.left.month}</b></div>
          <div><span class="a2-muted">Доступно рассылке</span><b>${q.left.broadcast}</b></div>
          <div><span class="a2-muted">Запас на служебные</span><b>${q.limits.reserve}</b></div>
        </div>
        <p class="a2-muted small" style="margin:8px 0 0">
          Запас в ${q.limits.reserve} писем рассылке недоступен: он держится на подтверждения
          почты и восстановление паролей. Месячный счётчик обнулится ${UI.esc(q.resetsAt)}.
        </p>
        ${Object.keys(q.byKind || {}).length ? `
          <p class="a2-muted small" style="margin:8px 0 0">На что ушли в этом месяце:
            ${Object.entries(q.byKind).map(([k, v]) => `${UI.esc(KIND_RU[k] || k)} — ${v}`).join(' · ')}</p>` : ''}
      </div>` : ''}

      ${(d.templates || []).map((t) => `
        <div class="a2-card" data-tpl="${UI.esc(t.id)}">
          <div class="a2-row" style="justify-content:space-between;align-items:baseline">
            <h3 style="margin:0">${UI.esc(t.name)}
              ${t.isDefault ? '<span class="a2-pill">заводской</span>'
                            : `<span class="a2-pill is-ok">изменён ${dt(t.changedAt)}${t.changedBy ? ' · ' + UI.esc(t.changedBy) : ''}</span>`}
            </h3>
          </div>
          ${(t.missing || []).length ? `
            <div class="a2-card" style="margin:8px 0;background:rgba(220,60,60,.12);border-color:var(--red)">
              <b style="color:var(--red)">Шаблон устарел.</b>
              В нём нет ${t.missing.map((v) => `<code>${UI.esc(v)}</code>`).join(', ')} —
              а без этого письмо приходит неполным.
              Так бывает с шаблонами, сохранёнными до появления новых полей:
              сохранённый текст живёт своей жизнью и заводские улучшения до него не доходят.
              Нажмите <b>«Вернуть заводской»</b> — или впишите недостающее сами.
            </div>` : ''}
          <p class="a2-muted" style="margin:4px 0 8px">${UI.esc(t.about)}</p>

          <label class="a2-muted small">Тема письма</label>
          <div class="mail-subject-row">
            <input class="tpl-subject" value="${UI.esc(t.subject)}">
            ${t.vars.map((v) => `<button class="mail-varbtn" data-into="subject"
              data-var="${UI.esc(v)}" title="Вставить в тему">${UI.esc(v.replace(/[{}]/g, ''))}</button>`).join('')}
          </div>

          <label class="a2-muted small">Текст письма</label>

          <div class="mail-toolbar">
            <button class="mail-tb" data-cmd="bold" title="Жирный"><b>Ж</b></button>
            <button class="mail-tb" data-cmd="italic" title="Наклонный"><i>К</i></button>
            <button class="mail-tb" data-cmd="underline" title="Подчёркнутый"><u>Ч</u></button>
            <span class="mail-tb-sep"></span>
            <button class="mail-tb" data-cmd="h2" title="Заголовок">Заголовок</button>
            <button class="mail-tb" data-cmd="p" title="Обычный текст">Текст</button>
            <button class="mail-tb" data-cmd="list" title="Список">• Список</button>
            <span class="mail-tb-sep"></span>
            <button class="mail-tb" data-cmd="link" title="Ссылка">🔗 Ссылка</button>
            <button class="mail-tb" data-cmd="button" title="Кнопка перехода">▭ Кнопка</button>
            <span class="mail-tb-sep"></span>
            ${t.vars.map((v) => `<button class="mail-varbtn" data-into="body"
              data-var="${UI.esc(v)}" title="Вставить в текст">${UI.esc(v.replace(/[{}]/g, ''))}</button>`).join('')}
            <span style="flex:1"></span>
            <button class="mail-tb tpl-codetoggle" title="Показать разметку">&lt;/&gt; Код</button>
          </div>

          <div class="tpl-editor mail-editor" contenteditable="true"></div>
          <textarea class="tpl-html mail-code" rows="12" hidden>${UI.esc(t.html)}</textarea>

          <p class="a2-muted small" style="margin:6px 0 8px">
            Цветные метки — это подставляемые значения: вместо них в письме окажутся
            позывной игрока, ссылка, название и адрес игры. Вставляются кнопками, руками
            фигурные скобки писать не нужно.
          </p>

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
        <p class="a2-muted" style="margin:6px 0 10px">Уходит текст шаблона «Новостная рассылка».
          Шлём только на подтверждённые адреса живых игроков: письма на несуществующие ящики
          портят репутацию отправителя, после чего в спам начинают уходить и подтверждения регистрации.</p>

        <div class="mail-groups">
          ${(aud.groups || []).map((g) => `
            <label class="mail-group ${g.count === 0 || !g.fits ? 'is-off' : ''}">
              <input type="radio" name="bc-group" value="${UI.esc(g.id)}" ${g.id === 'all' ? 'checked' : ''}
                ${g.count === 0 || !g.fits ? 'disabled' : ''}>
              <span class="mail-group-name">${UI.esc(g.name)} <b>${g.count}</b></span>
              <span class="mail-group-about">${UI.esc(g.about)}</span>
              ${!g.fits && g.count > 0 ? '<span class="mail-group-warn">не влезает в остаток лимита</span>' : ''}
            </label>`).join('')}
        </div>

        <p class="a2-muted small" style="margin:10px 0 0">
          Всего игроков ${aud.total || 0}: без подтверждённой почты — ${aud.unverified || 0},
          вовсе без почты — ${aud.noEmail || 0}${aud.banned ? `, в бане — ${aud.banned}` : ''}.
          Рассылке сейчас доступно <b>${aud.canSend || 0}</b> писем.
        </p>

        ${bc ? `
          <div class="a2-card" style="margin:10px 0 0;background:rgba(255,255,255,.03)">
            <div><b>${running ? 'Идёт рассылка' : 'Прошлая рассылка'}</b>
              <span class="a2-muted">${dt(bc.startedAt)}${bc.by ? ' · запустил ' + UI.esc(bc.by) : ''}${bc.audience ? ' · ' + UI.esc(bc.audience) : ''}</span></div>
            ${running ? progress(bc.sent, bc.total) : ''}
            <div class="a2-muted">Отправлено ${bc.sent} из ${bc.total}${bc.failed ? ` · не дошло ${bc.failed}` : ''}${running ? ` · осталось ${bc.left}` : ''}</div>
            ${bc.stopped ? `<div style="color:var(--orange-1);margin-top:4px">
              ⏹ Остановлена${bc.stopReason ? ': ' + UI.esc(bc.stopReason) : ' вручную'}
              ${bc.left ? ` Не отправлено: ${bc.left}.` : ''}</div>` : ''}
            ${(bc.errors || []).length ? `<div class="a2-muted small" style="margin-top:6px">Ошибки:
              ${bc.errors.map((e) => `${UI.esc(e.email)} — ${UI.esc(e.error)}`).join('<br>')}</div>` : ''}
          </div>` : ''}

        <div class="a2-row" style="margin-top:10px">
          ${running
            ? '<button class="btn btn-red" id="bc-stop">⏹ Остановить рассылку</button>'
            : `<button class="btn btn-orange" id="bc-start" ${mail.configured && (aud.canSend || 0) > 0 ? '' : 'disabled'}>✉️ Разослать</button>`}
          <button class="btn btn-inline" id="bc-refresh">Обновить</button>
          ${running ? '<span class="a2-muted small">обновляется само каждые 5 секунд</span>' : ''}
        </div>
      </div>`;

    el.querySelectorAll('[data-tpl]').forEach((card) => {
      const id = card.getAttribute('data-tpl');
      const editor = card.querySelector('.tpl-editor');
      const code = card.querySelector('.tpl-html');
      const subject = () => card.querySelector('.tpl-subject').value;

      // Разметку показываем как готовое письмо, а подстановки — цветными
      // метками. Владелец правит текст, а не теги: именно из-за тегов
      // руками появлялись {{Альянс Генералов}} и ломали отправку.
      editor.innerHTML = MailEdit.toEditor(code.value);

      // Что уходит на сервер. В визуальном режиме собираем из редактора,
      // в режиме кода берём как есть — иначе правка в одном окне молча
      // терялась бы при сохранении из другого.
      const html = () => (code.hidden ? MailEdit.toHtml(editor) : code.value);

      MailEdit.bindToolbar(card, editor, code);

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
      const picked = el.querySelector('input[name="bc-group"]:checked');
      const gid = picked ? picked.value : 'all';
      const g = (aud.groups || []).find((x) => x.id === gid) || { name: 'Всем', count: aud.ready || 0 };
      // В подтверждении — конкретика: кому, сколько и что останется от
      // лимита. Иначе «разослать всем» нажимается на автомате, а потом
      // выясняется, что месячный запас ушёл за один вечер.
      const ok = await UI.confirm(
        `Группа «${g.name}» — ${g.count} писем.\n\n`
        + `После рассылки в месячном лимите останется ${Math.max(0, (q ? q.left.month : 0) - g.count)}.\n`
        + `Отменить уже ушедшие письма нельзя.\n\n`
        + `Проверьте текст образцом на свою почту, если ещё не проверяли.`,
        { title: 'Рассылка', icon: '✉️', okText: `Разослать (${g.count})` });
      if (!ok) return;
      try { await API.post('/api/admin/mail/broadcast', { group: gid }); render(el); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const stop = document.getElementById('bc-stop');
    if (stop) stop.onclick = async () => {
      const ok = await UI.confirm(
        'Остановить рассылку? Уже отправленные письма не вернуть, '
        + 'а продолжить с того же места будет нельзя — только запустить заново, '
        + 'и тогда получившие письмо получат его второй раз.',
        { title: 'Остановить рассылку', icon: '⏹', danger: true, okText: 'Остановить' });
      if (!ok) return;
      try { await API.post('/api/admin/mail/broadcast', { stop: true }); render(el); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const refresh = document.getElementById('bc-refresh');
    if (refresh) refresh.onclick = () => render(el);

    // Пока рассылка идёт — обновляем сами. Иначе владелец смотрит на
    // застывшие цифры и не понимает, идёт процесс или встал.
    if (running) {
      const t = setTimeout(() => { if (document.body.contains(el)) render(el); }, 5000);
      A2._mailTimer = t;
    } else if (A2._mailTimer) {
      clearTimeout(A2._mailTimer); A2._mailTimer = null;
    }

    // ── Проверка домена ────────────────────────────────────────────
    // Когда письма «не доходят», подозреваемых трое: ключ, сервис и
    // домен. Первые двое отвечают сами — их ответ виден дословно при
    // тестовой отправке. Домен молчит: записи не прописаны, сервис
    // письмо принял, почтовик получателя выбросил, и никто ничего не
    // сказал. Эта кнопка спрашивает у DNS напрямую.
    const diag = document.getElementById('mail-diag');
    if (diag) diag.onclick = async () => {
      const out = document.getElementById('mail-diag-out');
      diag.disabled = true;
      out.innerHTML = '<p class="a2-muted" style="margin-top:8px">Спрашиваю DNS…</p>';
      let r = null;
      try { r = await API.post('/api/admin/mail/diagnose', {}); }
      catch (e) {
        diag.disabled = false;
        out.innerHTML = `<p class="a2-muted" style="margin-top:8px;color:var(--red)">⛔ ${UI.esc(e.message)}</p>`;
        return;
      }
      diag.disabled = false;

      if (r.skipped) {
        out.innerHTML = `<p class="a2-muted" style="margin-top:8px">${UI.esc(r.verdict)}</p>`;
        return;
      }

      const rows = (r.checks || []).map((c) => `
        <div style="margin-top:6px">
          ${c.ok ? '✅' : '⛔'} <b>${UI.esc(c.title)}</b>
          <div class="a2-muted small" style="margin-left:18px;word-break:break-all">${UI.esc(c.value)}</div>
          ${c.hint ? `<div class="small" style="margin-left:18px;color:var(--orange-1)">${UI.esc(c.hint)}</div>` : ''}
        </div>`).join('');

      out.innerHTML = `
        <div class="a2-card" style="margin-top:8px;background:rgba(255,255,255,.03)">
          <div class="a2-muted small">Домен: <code>${UI.esc(r.domain || '—')}</code>
            · ключ <code>${UI.esc(r.keyMasked || '—')}</code> · длина ${r.keyLength || 0}
            ${r.keyDirty ? ' · <b style="color:var(--red)">в ключе посторонние символы (пробел, кавычка, перенос)</b>' : ''}</div>
          ${r.panel ? `<div class="a2-muted small">Записи правятся здесь: ${UI.esc(r.panel)}</div>` : ''}
          ${rows}
          <p style="margin:10px 0 0"><b>${UI.esc(r.verdict || '')}</b></p>
          ${r.spfFix ? `
            <p class="a2-muted" style="margin:8px 0 4px">SPF в домене может быть только ОДНА.
              Не добавляйте вторую запись — <b>исправьте существующую</b> на эту строку:</p>
            <input readonly value="${UI.esc(r.spfFix)}" onclick="this.select()"
              style="width:100%;box-sizing:border-box;padding:6px 10px;background:var(--bg);color:var(--text);
                     border:1px solid var(--border);border-radius:8px;
                     font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">` : ''}
        </div>`;
    };
  }

  A2.screens.mail = render;
})();
