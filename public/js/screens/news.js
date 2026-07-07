// ===================================================================
// public/js/screens/news.js — раздел «Новости».
// Читают все; создаёт/редактирует только администратор через кастомный
// блочный редактор. Блоки рендерятся безопасно (текст экранируется,
// инлайн-разметка превращается в известные теги).
// ===================================================================

(function () {
  // ---------- Инлайн-разметка (безопасно: сначала esc, потом теги) ----------
  // **жирный** *курсив* __подчерк__ ~~зачёркнутый~~ ==выделение==
  // [текст](ссылка)  {red|текст}  (цвета: red green gold blue gray)
  function parseInline(raw) {
    let t = UI.esc(raw == null ? '' : raw);
    // Ссылки: [label](href). Внешние — http(s), внутренние — экран (App.go).
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
      href = href.trim();
      if (/^https?:\/\//i.test(href)) return `<a href="${href.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      if (/^[a-z0-9/_-]+$/i.test(href)) return `<a href="#" onclick="App.go('${href}');return false;">${label}</a>`;
      return label;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    t = t.replace(/__([^_]+)__/g, '<u>$1</u>');
    t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    t = t.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    t = t.replace(/\{(red|green|gold|blue|gray)\|([^}]+)\}/g, (m, col, txt) =>
      `<span style="color:var(--${col === 'gray' ? 'dim' : col})">${txt}</span>`);
    return t;
  }
  function safeUrl(url) { url = String(url || '').trim(); return /^https?:\/\//i.test(url) ? url.replace(/"/g, '%22') : ''; }
  function nl2br(html) { return html.replace(/\n/g, '<br>'); }

  // ---------- Рендер блоков поста ----------
  function renderBlocks(blocks) {
    return (blocks || []).map((b) => {
      switch (b.type) {
        case 'heading': {
          const sz = b.level === 1 ? '20px' : b.level === 3 ? '14px' : '16px';
          return `<div style="font-weight:bold;font-size:${sz};margin:12px 0 4px;color:var(--gold)">${parseInline(b.text)}</div>`;
        }
        case 'text':
          return `<p style="margin:7px 0;line-height:1.55">${nl2br(parseInline(b.text))}</p>`;
        case 'callout': {
          const col = b.color === 'gray' ? 'dim' : b.color;
          return `<div style="border-left:3px solid var(--${col});background:rgba(255,255,255,.04);padding:9px 12px;border-radius:0 8px 8px 0;margin:9px 0;line-height:1.5">${nl2br(parseInline(b.text))}</div>`;
        }
        case 'quote':
          return `<blockquote style="border-left:3px solid var(--border);padding:2px 0 2px 12px;margin:9px 0;color:var(--dim);font-style:italic;line-height:1.5">${nl2br(parseInline(b.text))}</blockquote>`;
        case 'image': {
          const url = safeUrl(b.url);
          if (!url) return '';
          return `<figure style="margin:10px 0"><img src="${url}" style="max-width:100%;border-radius:8px;display:block;margin:0 auto" loading="lazy" onerror="this.parentElement.style.display='none'">${b.caption ? `<figcaption class="muted small" style="text-align:center;margin-top:5px">${UI.esc(b.caption)}</figcaption>` : ''}</figure>`;
        }
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          return `<${tag} style="margin:8px 0;padding-left:22px;line-height:1.65">${(b.items || []).map((i) => `<li>${parseInline(i)}</li>`).join('')}</${tag}>`;
        }
        case 'divider':
          return '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0">';
        case 'spacer':
          return '<div style="height:16px"></div>';
        case 'button': {
          const a = String(b.action || '').trim();
          let onclick = '';
          if (/^https?:\/\//i.test(a)) onclick = `window.open('${a.replace(/'/g, '')}','_blank')`;
          else if (/^[a-z0-9/_-]+$/i.test(a)) onclick = `App.go('${a}')`;
          return `<button class="btn btn-orange" style="margin:8px 0;width:100%" onclick="${onclick}">${UI.esc(b.text || 'Открыть')}</button>`;
        }
        case 'badge': {
          const col = b.color === 'gray' ? '' : b.color;
          return `<span class="badge ${col}" style="margin:2px 4px 2px 0;display:inline-block">${UI.esc(b.text)}</span>`;
        }
      }
      return '';
    }).join('');
  }

  // Экспортируем рендерер (может пригодиться в других экранах)
  window.NewsRender = { renderBlocks, parseInline };

  // ---------- ЭКРАН: лента новостей ----------
  App.screens.news = async (c) => {
    await App.refreshMe();
    let d;
    try { d = await API.get('/api/news'); } catch (e) { d = { posts: [], canManage: false }; }
    const canManage = !!d.canManage;

    const adminBar = canManage
      ? `<button class="btn btn-orange" style="width:100%;margin-bottom:12px" onclick="App.go('newsedit')">➕ Создать новость</button>`
      : '';

    const postsHtml = (d.posts && d.posts.length) ? d.posts.map((p) => {
      const preview = renderBlocks((p.blocks || []).slice(0, 2));
      const manageBtns = canManage ? `
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-inline" style="flex:1;padding:6px" onclick="event.stopPropagation();App.go('newsedit/${p.id}')">✏️ Изменить</button>
          <button class="btn btn-inline" style="flex:1;padding:6px" data-news-pin="${p.id}">${p.pinned ? '📌 Открепить' : '📌 Закрепить'}</button>
          <button class="btn btn-red" style="flex:1;padding:6px" data-news-del="${p.id}">🗑</button>
        </div>` : '';
      return `
        <div class="news-card" data-news-open="${p.id}">
          <div class="news-card-head">
            <span class="news-emoji">${UI.esc(p.emoji || '📰')}</span>
            <div style="flex:1;min-width:0">
              <div class="news-title">${UI.esc(p.title)}</div>
              <div class="news-meta">${p.pinned ? '<span class="badge gold" style="margin-right:6px">📌 Закреплено</span>' : ''}${p.tag ? `<span class="badge" style="margin-right:6px">${UI.esc(p.tag)}</span>` : ''}<span class="muted small">${UI.fmtDate(p.createdAt)}${p.updatedAt && p.updatedAt - p.createdAt > 60000 ? ' · ред.' : ''}</span></div>
            </div>
          </div>
          <div class="news-preview">${preview}</div>
          <div class="news-more muted small">Читать полностью →</div>
          ${manageBtns}
        </div>`;
    }).join('') : '<div class="card center muted" style="padding:30px 16px"><p style="font-size:38px;margin:0">📰</p><p class="mt">Новостей пока нет. Загляните позже!</p></div>';

    c.innerHTML = `
      <div class="title">📰 Новости</div>
      <p class="muted small" style="margin:-4px 4px 12px">Обновления, события и объявления по игре «Генералы».</p>
      ${adminBar}
      ${postsHtml}`;

    // Открытие поста целиком
    c.querySelectorAll('[data-news-open]').forEach((el) => {
      el.onclick = () => App.go('newsview/' + el.dataset.newsOpen);
    });
    // Управление (админ)
    c.querySelectorAll('[data-news-pin]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      try { await API.post('/api/news/pin', { id: b.dataset.newsPin }); App.rerender(); }
      catch (err) { UI.toast('⛔ ' + err.message); }
    });
    c.querySelectorAll('[data-news-del]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      if (!await UI.confirm('Удалить эту новость?', { title: 'Удаление', icon: '🗑', okText: 'Удалить', danger: true })) return;
      try { await API.post('/api/news/delete', { id: b.dataset.newsDel }); App.rerender(); }
      catch (err) { UI.toast('⛔ ' + err.message); }
    });
  };

  // ---------- ЭКРАН: чтение одной новости ----------
  App.screens.newsview = async (c, param) => {
    await App.refreshMe();
    let d;
    try { d = await API.get('/api/news'); } catch (e) { d = { posts: [] }; }
    const p = (d.posts || []).find((x) => x.id === param);
    if (!p) {
      c.innerHTML = `<div class="title">📰 Новость</div><div class="card center muted">Новость не найдена.</div><button class="btn" style="width:100%;margin-top:10px" onclick="App.go('news')">← К новостям</button>`;
      return;
    }
    c.innerHTML = `
      <button class="btn btn-inline" style="margin-bottom:10px" onclick="App.go('news')">← Все новости</button>
      <div class="news-article">
        <div class="news-article-head">
          <span style="font-size:34px">${UI.esc(p.emoji || '📰')}</span>
          <div>
            <div class="news-article-title">${UI.esc(p.title)}</div>
            <div style="margin-top:4px">${p.pinned ? '<span class="badge gold" style="margin-right:6px">📌</span>' : ''}${p.tag ? `<span class="badge" style="margin-right:6px">${UI.esc(p.tag)}</span>` : ''}<span class="muted small">${UI.fmtDate(p.createdAt)} · ${UI.esc(p.authorName || '')}</span></div>
          </div>
        </div>
        <div class="news-article-body">${renderBlocks(p.blocks)}</div>
      </div>`;
  };

  // ---------- ЭКРАН: редактор новости (только админ) ----------
  const EMOJI_PRESETS = ['📰', '🚀', '⚔️', '🎉', '🛠', '🔥', '⭐', '📢', '🎁', '⚠️', '🐉', '🏆'];
  const BLOCK_TOOLS = [
    ['heading', '🔠 Заголовок'], ['text', '📝 Текст'], ['callout', '💡 Выноска'],
    ['quote', '❝ Цитата'], ['image', '🖼 Картинка'], ['list', '📋 Список'],
    ['button', '🔘 Кнопка'], ['badge', '🏷 Значок'], ['divider', '➖ Разделитель'], ['spacer', '␣ Отступ'],
  ];
  const COLOR_OPTS = [['gold', 'Золотой'], ['green', 'Зелёный'], ['red', 'Красный'], ['blue', 'Синий'], ['gray', 'Серый']];

  function newBlock(type) {
    switch (type) {
      case 'heading': return { type, text: 'Заголовок', level: 2 };
      case 'text': return { type, text: '' };
      case 'callout': return { type, text: '', color: 'gold' };
      case 'quote': return { type, text: '' };
      case 'image': return { type, url: '', caption: '' };
      case 'list': return { type, ordered: false, items: [''] };
      case 'button': return { type, text: 'Открыть', action: '' };
      case 'badge': return { type, text: 'НОВОЕ', color: 'gold' };
      case 'divider': return { type };
      case 'spacer': return { type };
    }
    return { type: 'text', text: '' };
  }

  App.screens.newsedit = async (c, param) => {
    await App.refreshMe();
    if (!App.me || !App.me.isAdmin) { c.innerHTML = '<div class="card center muted">Доступно только администратору.</div>'; return; }

    // Загружаем черновик: существующий пост или новый
    if (!App._newsDraft || App._newsDraft._loadedFor !== (param || 'new')) {
      if (param) {
        let d; try { d = await API.get('/api/news'); } catch (e) { d = { posts: [] }; }
        const p = (d.posts || []).find((x) => x.id === param);
        App._newsDraft = p
          ? { _loadedFor: param, id: p.id, title: p.title, emoji: p.emoji || '📰', tag: p.tag || '', pinned: !!p.pinned, blocks: JSON.parse(JSON.stringify(p.blocks || [])) }
          : { _loadedFor: 'new', title: '', emoji: '📰', tag: '', pinned: false, blocks: [] };
      } else {
        App._newsDraft = { _loadedFor: 'new', title: '', emoji: '📰', tag: '', pinned: false, blocks: [] };
      }
    }
    renderEditor(c);
  };

  function renderEditor(c) {
    const dr = App._newsDraft;
    const isEdit = !!dr.id;

    const emojiPicker = EMOJI_PRESETS.map((e) =>
      `<button class="news-emoji-btn ${dr.emoji === e ? 'sel' : ''}" data-emoji="${e}">${e}</button>`).join('');

    const toolButtons = BLOCK_TOOLS.map(([t, label]) =>
      `<button class="btn btn-inline news-add-btn" data-add="${t}">${label}</button>`).join('');

    const blocksHtml = dr.blocks.length
      ? dr.blocks.map((b, i) => blockEditor(b, i, dr.blocks.length)).join('')
      : '<div class="card center muted" style="padding:20px">Пусто. Добавьте блоки кнопками выше ⬆️</div>';

    c.innerHTML = `
      <button class="btn btn-inline" style="margin-bottom:10px" onclick="App.go('news')">← Отмена</button>
      <div class="title">${isEdit ? '✏️ Редактор новости' : '➕ Новая новость'}</div>

      <div class="card">
        <label class="news-lbl">Иконка</label>
        <div class="news-emoji-row">${emojiPicker}
          <input id="news-emoji-custom" class="news-input news-emoji-input" maxlength="4" placeholder="✨" value="${UI.esc(EMOJI_PRESETS.indexOf(dr.emoji) < 0 ? dr.emoji : '')}">
        </div>
        <label class="news-lbl mt">Заголовок *</label>
        <input id="news-title" class="news-input" maxlength="200" placeholder="Например: Большое обновление 1.5" value="${UI.esc(dr.title)}">
        <div style="display:flex;gap:10px;margin-top:8px">
          <div style="flex:1">
            <label class="news-lbl">Метка (тег)</label>
            <input id="news-tag" class="news-input" maxlength="40" placeholder="Патч / Событие / Анонс" value="${UI.esc(dr.tag)}">
          </div>
          <div style="display:flex;align-items:flex-end;padding-bottom:8px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="news-pinned" ${dr.pinned ? 'checked' : ''}> 📌 Закрепить
            </label>
          </div>
        </div>
      </div>

      <div class="card">
        <label class="news-lbl">Добавить блок</label>
        <div class="news-tools">${toolButtons}</div>
        <p class="muted small" style="margin:8px 0 0">Форматирование внутри текста: <code>**жирный**</code> <code>*курсив*</code> <code>__подчерк__</code> <code>~~зачёркн~~</code> <code>==выделить==</code> <code>[текст](ссылка)</code> <code>{red|цвет}</code></p>
      </div>

      <div style="font-weight:bold;margin:14px 4px 8px">🧱 Содержимое (${dr.blocks.length})</div>
      ${blocksHtml}

      <div class="card" style="margin-top:12px">
        <label class="news-lbl">👁 Предпросмотр</label>
        <div class="news-article" style="margin-top:6px">
          <div class="news-article-head">
            <span style="font-size:30px">${UI.esc(dr.emoji || '📰')}</span>
            <div><div class="news-article-title">${UI.esc(dr.title || 'Заголовок новости')}</div>
            <div style="margin-top:3px">${dr.tag ? `<span class="badge">${UI.esc(dr.tag)}</span>` : ''}</div></div>
          </div>
          <div class="news-article-body">${dr.blocks.length ? renderBlocks(dr.blocks) : '<p class="muted">Содержимое появится здесь…</p>'}</div>
        </div>
      </div>

      <button class="btn btn-orange" id="news-publish" style="width:100%;margin-top:12px;padding:13px">${isEdit ? '💾 Сохранить изменения' : '🚀 Опубликовать'}</button>
    `;

    bindEditor(c);
  }

  // Редактор одного блока
  function blockEditor(b, i, total) {
    const move = `
      <div class="news-block-ctl">
        <button class="news-mini" data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="news-mini" data-down="${i}" ${i === total - 1 ? 'disabled' : ''}>▼</button>
        <button class="news-mini news-mini-del" data-del="${i}">✕</button>
      </div>`;
    let body = '';
    switch (b.type) {
      case 'heading':
        body = `<div class="news-block-label">🔠 Заголовок</div>
          <input class="news-input" data-f="text" data-i="${i}" value="${UI.esc(b.text)}" placeholder="Текст заголовка">
          <div style="display:flex;gap:6px;margin-top:6px">${[1, 2, 3].map((lv) => `<button class="btn btn-inline news-lvl ${b.level === lv ? 'sel' : ''}" data-level="${lv}" data-i="${i}" style="flex:1;padding:5px">H${lv}</button>`).join('')}</div>`;
        break;
      case 'text':
        body = `<div class="news-block-label">📝 Текст</div><textarea class="news-input" data-f="text" data-i="${i}" rows="3" placeholder="Текст абзаца. Поддерживает **разметку**.">${UI.esc(b.text)}</textarea>`;
        break;
      case 'callout':
        body = `<div class="news-block-label">💡 Выноска</div><textarea class="news-input" data-f="text" data-i="${i}" rows="2" placeholder="Важное примечание">${UI.esc(b.text)}</textarea>${colorPicker(b.color, i)}`;
        break;
      case 'quote':
        body = `<div class="news-block-label">❝ Цитата</div><textarea class="news-input" data-f="text" data-i="${i}" rows="2" placeholder="Текст цитаты">${UI.esc(b.text)}</textarea>`;
        break;
      case 'image':
        body = `<div class="news-block-label">🖼 Картинка</div>
          <input class="news-input" data-f="url" data-i="${i}" value="${UI.esc(b.url)}" placeholder="https://… (ссылка на изображение)">
          <input class="news-input" data-f="caption" data-i="${i}" value="${UI.esc(b.caption)}" placeholder="Подпись (необязательно)" style="margin-top:6px">
          ${safeUrl(b.url) ? `<img src="${safeUrl(b.url)}" style="max-width:100%;border-radius:6px;margin-top:8px" onerror="this.style.display='none'">` : ''}`;
        break;
      case 'list':
        body = `<div class="news-block-label">📋 Список</div>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:6px;cursor:pointer"><input type="checkbox" data-ordered="${i}" ${b.ordered ? 'checked' : ''}> Нумерованный</label>
          ${(b.items || []).map((it, j) => `<div style="display:flex;gap:4px;margin-bottom:4px"><input class="news-input" data-item="${i}_${j}" value="${UI.esc(it)}" placeholder="Пункт ${j + 1}" style="flex:1"><button class="news-mini news-mini-del" data-item-del="${i}_${j}">✕</button></div>`).join('')}
          <button class="btn btn-inline" data-item-add="${i}" style="padding:5px 10px;font-size:12px">➕ Пункт</button>`;
        break;
      case 'button':
        body = `<div class="news-block-label">🔘 Кнопка</div>
          <input class="news-input" data-f="text" data-i="${i}" value="${UI.esc(b.text)}" placeholder="Текст кнопки">
          <input class="news-input" data-f="action" data-i="${i}" value="${UI.esc(b.action)}" placeholder="Куда ведёт: экран (war) или https://…" style="margin-top:6px">`;
        break;
      case 'badge':
        body = `<div class="news-block-label">🏷 Значок</div><input class="news-input" data-f="text" data-i="${i}" value="${UI.esc(b.text)}" placeholder="Текст значка">${colorPicker(b.color, i)}`;
        break;
      case 'divider':
        body = `<div class="news-block-label">➖ Разделитель</div><hr style="border:none;border-top:1px solid var(--border);margin:4px 0">`;
        break;
      case 'spacer':
        body = `<div class="news-block-label">␣ Пустой отступ</div>`;
        break;
    }
    return `<div class="news-block">${move}${body}</div>`;
  }

  function colorPicker(cur, i) {
    return `<div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">${COLOR_OPTS.map(([col, name]) =>
      `<button class="news-color ${cur === col ? 'sel' : ''}" data-color="${col}" data-i="${i}" style="background:var(--${col === 'gray' ? 'dim' : col})" title="${name}"></button>`).join('')}</div>`;
  }

  // Привязка событий редактора. Мы НЕ перерисовываем на каждый ввод текста
  // (чтобы не сбивать курсор) — читаем значения из DOM перед сохранением и
  // перед действиями со структурой (добавить/удалить/переместить блок).
  function bindEditor(c) {
    const dr = App._newsDraft;

    // Считать все поля из DOM в черновик
    const syncFromDom = () => {
      const t = c.querySelector('#news-title'); if (t) dr.title = t.value;
      const tag = c.querySelector('#news-tag'); if (tag) dr.tag = tag.value;
      const pin = c.querySelector('#news-pinned'); if (pin) dr.pinned = pin.checked;
      const ec = c.querySelector('#news-emoji-custom'); if (ec && ec.value.trim()) dr.emoji = ec.value.trim();
      c.querySelectorAll('[data-f]').forEach((el) => {
        const i = +el.dataset.i; const f = el.dataset.f;
        if (dr.blocks[i]) dr.blocks[i][f] = el.value;
      });
      c.querySelectorAll('[data-item]').forEach((el) => {
        const [i, j] = el.dataset.item.split('_').map(Number);
        if (dr.blocks[i] && dr.blocks[i].items) dr.blocks[i].items[j] = el.value;
      });
    };
    const reRender = () => renderEditor(c);

    // Эмодзи-пресеты
    c.querySelectorAll('[data-emoji]').forEach((btn) => btn.onclick = () => { syncFromDom(); dr.emoji = btn.dataset.emoji; reRender(); });

    // Добавление блока
    c.querySelectorAll('[data-add]').forEach((btn) => btn.onclick = () => { syncFromDom(); dr.blocks.push(newBlock(btn.dataset.add)); reRender(); });

    // Управление блоками
    c.querySelectorAll('[data-up]').forEach((btn) => btn.onclick = () => { syncFromDom(); const i = +btn.dataset.up; if (i > 0) { [dr.blocks[i - 1], dr.blocks[i]] = [dr.blocks[i], dr.blocks[i - 1]]; } reRender(); });
    c.querySelectorAll('[data-down]').forEach((btn) => btn.onclick = () => { syncFromDom(); const i = +btn.dataset.down; if (i < dr.blocks.length - 1) { [dr.blocks[i + 1], dr.blocks[i]] = [dr.blocks[i], dr.blocks[i + 1]]; } reRender(); });
    c.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => { syncFromDom(); dr.blocks.splice(+btn.dataset.del, 1); reRender(); });

    // Заголовок: уровень
    c.querySelectorAll('[data-level]').forEach((btn) => btn.onclick = () => { syncFromDom(); dr.blocks[+btn.dataset.i].level = +btn.dataset.level; reRender(); });
    // Цвет (выноска/значок)
    c.querySelectorAll('[data-color]').forEach((btn) => btn.onclick = () => { syncFromDom(); dr.blocks[+btn.dataset.i].color = btn.dataset.color; reRender(); });
    // Список: нумерация / пункты
    c.querySelectorAll('[data-ordered]').forEach((el) => el.onchange = () => { syncFromDom(); dr.blocks[+el.dataset.ordered].ordered = el.checked; reRender(); });
    c.querySelectorAll('[data-item-add]').forEach((btn) => btn.onclick = () => { syncFromDom(); const bl = dr.blocks[+btn.dataset.itemAdd]; bl.items = bl.items || []; bl.items.push(''); reRender(); });
    c.querySelectorAll('[data-item-del]').forEach((btn) => btn.onclick = () => { syncFromDom(); const [i, j] = btn.dataset.itemDel.split('_').map(Number); dr.blocks[i].items.splice(j, 1); if (dr.blocks[i].items.length === 0) dr.blocks[i].items.push(''); reRender(); });

    // Живой предпросмотр по вводу текста (без полной перерисовки — только preview)
    const preview = c.querySelector('.news-article-body');
    const previewTitle = c.querySelector('.news-article-title');
    const updatePreview = () => {
      syncFromDom();
      if (preview) preview.innerHTML = dr.blocks.length ? renderBlocks(dr.blocks) : '<p class="muted">Содержимое появится здесь…</p>';
      if (previewTitle) previewTitle.textContent = dr.title || 'Заголовок новости';
    };
    c.querySelectorAll('.news-input, [data-f], [data-item]').forEach((el) => {
      el.addEventListener('input', updatePreview);
    });

    // Публикация / сохранение
    const pub = c.querySelector('#news-publish');
    if (pub) pub.onclick = async () => {
      syncFromDom();
      if (!dr.title.trim()) { UI.toast('⛔ Введите заголовок'); return; }
      if (!dr.blocks.length) { UI.toast('⛔ Добавьте хотя бы один блок'); return; }
      const payload = { title: dr.title, emoji: dr.emoji, tag: dr.tag, pinned: dr.pinned, blocks: dr.blocks };
      try {
        if (dr.id) await API.post('/api/news/update', Object.assign({ id: dr.id }, payload));
        else await API.post('/api/news/create', payload);
        App._newsDraft = null;
        UI.toast(dr.id ? '✅ Новость обновлена' : '🚀 Новость опубликована');
        App.go('news');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }
})();
