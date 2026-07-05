// ===================================================================
// public/js/ui.js — мелкие помощники интерфейса
// Экранирование HTML, форматирование денег «как в оригинале»
// (14,000 → 24.6 M → 8.24 Bn), таймеры, тосты и прогресс-бары.
// ===================================================================

// Хелпер для безопасного преобразования в число (как в утилитах сервера)
const u = {
  toIntSafe(v, def) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
  },
};

const UI = {
  // Защита от HTML-инъекций: всё, что пришло от игроков, идёт через esc
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },

  // Картинка техники/постройки по ID. Если файла нет (нарисованы не все),
  // элемент сам скрывается через onerror, и остаётся текстовая иконка.
  // kind: 'units' | 'buildings'; id — id юнита/здания (ground_1, sklad, ...)
  img(kind, id, size) {
    const px = size || 64;
    const safeId = String(id || '').replace(/[^a-z0-9_]/gi, '');
    if (!safeId) return '';
    return `<img src="img/${kind}/${safeId}.webp" loading="lazy"
      style="width:${px}px;height:${px}px;object-fit:contain;flex:0 0 auto"
      onerror="this.style.display='none'">`;
  },

  // Компактный горизонтальный ряд картинок с количеством — для окна боя.
  // items: [{id, name, count, ...}], kind: 'units'|'buildings'
  battleImgRow(items, kind) {
    if (!items || !items.length) return '';
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
      ${items.map((x) => {
        const payload = encodeURIComponent(JSON.stringify({
          kind, id: x.id, name: x.name, count: x.count,
          attack: x.attack, defense: x.defense, def: x.def, type: x.type, kindB: x.kind,
        }));
        return `<div onclick="UI.showItemModal('${payload}')"
          style="width:62px;cursor:pointer;text-align:center">
          <div style="height:46px;display:flex;align-items:center;justify-content:center">
            <img src="img/${kind}/${String(x.id||'').replace(/[^a-z0-9_]/gi,'')}.webp" loading="lazy"
              style="max-width:56px;max-height:44px;object-fit:contain"
              onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
            <span style="display:none;font-size:10px;color:var(--dim)">${UI.esc((x.name||'').slice(0,8))}</span>
          </div>
          <div style="font-size:12px;font-weight:bold">×${UI.fmtNum(x.count)}</div>
        </div>`;
      }).join('')}
    </div>`;
  },

  // Сетка карточек техники/построек: картинка + количество под ней.
  // Название скрыто, по клику открывается модалка с деталями.
  // items: [{id, name, count, ...}], kind: 'units'|'buildings'
  imgGrid(items, kind) {
    if (!items || !items.length) return '<p class="muted small">Пусто</p>';
    return `<div style="display:flex;flex-wrap:wrap;gap:10px">
      ${items.map((x, i) => {
        // Кладём данные в data-атрибуты, чтобы модалка их прочитала
        const payload = encodeURIComponent(JSON.stringify({
          kind, id: x.id, name: x.name, count: x.count,
          attack: x.attack, defense: x.defense,
          income: x.income, def: x.def, type: x.type, kindB: x.kind,
        }));
        return `<div onclick="UI.showItemModal('${payload}')"
          style="width:84px;cursor:pointer;text-align:center;border:1px solid var(--border);border-radius:10px;padding:8px 4px;background:rgba(255,255,255,.02)">
          <div style="height:64px;display:flex;align-items:center;justify-content:center">
            ${UI.img(kind, x.id, 60)}
            <span class="img-fallback" style="display:none;font-size:11px;color:var(--dim)">${UI.esc(x.name)}</span>
          </div>
          <div style="font-weight:bold;font-size:13px;margin-top:4px">×${UI.fmtNum(x.count)}</div>
        </div>`;
      }).join('')}
    </div>`;
  },

  // Модалка с деталями техники/постройки (крупная картинка + название + статы)
  showItemModal(payload) {
    let d;
    try { d = JSON.parse(decodeURIComponent(payload)); } catch (e) { return; }
    const old = document.getElementById('item-modal');
    if (old) old.remove();
    const isUnit = d.kind === 'units';
    const isSecret = d.kind === 'secret';
    const statsHtml = (isUnit || isSecret)
      ? `<div class="kv"><span class="k">⚔ Атака</span><span class="v">${UI.fmtNum(d.attack||0)}</span></div>
         <div class="kv"><span class="k">🛡 Защита</span><span class="v">${UI.fmtNum(d.defense||0)}</span></div>
         ${d.type ? `<div class="kv"><span class="k">Тип</span><span class="v">${UI.esc(d.type)}</span></div>` : ''}
         ${isSecret ? `<div class="kv"><span class="k gold">🔬 Секретная разработка</span><span class="v"></span></div>` : ''}`
      : (d.kindB === 'income'
          ? `<div class="kv"><span class="k">Доход</span><span class="v"><span class="ic-dollar"></span> ${UI.fmtMoney(d.income||0)}/час</span></div>`
          : `<div class="kv"><span class="k">🛡 Защита</span><span class="v">+${UI.fmtNum(d.def||0)} очков</span></div>`);
    const fallbackIcon = isSecret ? '🛸' : (isUnit ? '🚜' : '🏛');
    const m = document.createElement('div');
    m.id = 'item-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10003;display:flex;align-items:center;justify-content:center;padding:16px';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.innerHTML = `
      <div style="background:var(--card);border:2px solid var(--orange);border-radius:14px;max-width:340px;width:100%;padding:20px;text-align:center">
        <div style="height:180px;display:flex;align-items:center;justify-content:center;margin-bottom:8px">
          <img src="img/${d.kind}/${String(d.id||'').replace(/[^a-z0-9_]/gi,'')}.webp"
            style="max-width:100%;max-height:180px;object-fit:contain"
            onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
          <span style="display:none;font-size:40px">${fallbackIcon}</span>
        </div>
        <div style="font-size:18px;font-weight:bold;margin-bottom:4px">${UI.esc(d.name)}</div>
        <div style="font-size:14px;color:var(--gold);margin-bottom:12px">В наличии: ×${UI.fmtNum(d.count)}</div>
        <div style="text-align:left;margin-bottom:14px">${statsHtml}</div>
        <button class="btn btn-orange" style="width:100%" onclick="document.getElementById('item-modal').remove()">Закрыть</button>
      </div>`;
    document.body.appendChild(m);
  },

  // Деньги с суффиксами: до 100 тыс. — полностью, дальше K / M / Bn / Tr
  fmtMoney(n) {
    n = Math.round(Number(n) || 0);
    const abs = Math.abs(n);
    const cut = (v) => {
      const s = v.toFixed(2).replace(/\.?0+$/, '');
      return s;
    };
    if (abs >= 1e12) return cut(n / 1e12) + ' Tr';
    if (abs >= 1e9) return cut(n / 1e9) + ' Bn';
    if (abs >= 1e6) return cut(n / 1e6) + ' M';
    if (abs >= 1e5) return cut(n / 1e3) + ' K';
    return n.toLocaleString('ru-RU');
  },

  fmtNum(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU'); },

  // Секунды → «м:сс» или «ч:мм:сс»
  fmtTimer(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  },

  // Дата для чата и почты
  fmtDate(ts) {
    const d = new Date(ts);
    const pad = (x) => String(x).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // Всплывающее уведомление внизу экрана
  toast(msg) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    el.onclick = () => el.remove();
    box.appendChild(el);
    // Не копим больше пяти тостов одновременно
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => el.remove(), 4500);
  },

  // Игровое окно подтверждения (замена браузерного confirm).
  // Возвращает Promise<boolean>. Использование: if (await UI.confirm('...')) {...}
  // opts: { title, okText, cancelText, danger, icon }
  confirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const old = document.getElementById('game-dialog');
      if (old) old.remove();
      const m = document.createElement('div');
      m.id = 'game-dialog';
      m.className = 'game-dialog-overlay';
      const okClass = opts.danger ? 'btn-red' : 'btn-orange';
      m.innerHTML = `
        <div class="game-dialog">
          ${opts.icon ? `<div class="game-dialog-icon">${opts.icon}</div>` : ''}
          ${opts.title ? `<div class="game-dialog-title">${UI.esc(opts.title)}</div>` : ''}
          <div class="game-dialog-body">${UI.esc(message).replace(/\n/g, '<br>')}</div>
          <div class="game-dialog-actions">
            <button class="btn ${okClass}" id="gd-ok">${UI.esc(opts.okText || 'Подтвердить')}</button>
            <button class="btn btn-inline" id="gd-cancel">${UI.esc(opts.cancelText || 'Отмена')}</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      const close = (val) => { m.remove(); resolve(val); };
      m.querySelector('#gd-ok').onclick = () => close(true);
      m.querySelector('#gd-cancel').onclick = () => close(false);
      m.onclick = (e) => { if (e.target === m) close(false); };
      // Enter подтверждает, Esc отменяет
      m.querySelector('#gd-ok').focus();
      m.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close(true);
        if (e.key === 'Escape') close(false);
      });
    });
  },

  // Игровое окно ввода текста (замена браузерного prompt).
  // Возвращает Promise<string|null> (null если отменили).
  // opts: { title, placeholder, value, okText, multiline, maxLength, type, icon, hint }
  prompt(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const old = document.getElementById('game-dialog');
      if (old) old.remove();
      const m = document.createElement('div');
      m.id = 'game-dialog';
      m.className = 'game-dialog-overlay';
      const ml = opts.multiline;
      const maxAttr = opts.maxLength ? `maxlength="${opts.maxLength}"` : '';
      const field = ml
        ? `<textarea id="gd-input" class="game-dialog-input" rows="3" ${maxAttr} placeholder="${UI.esc(opts.placeholder || '')}">${UI.esc(opts.value || '')}</textarea>`
        : `<input id="gd-input" class="game-dialog-input" type="${opts.type || 'text'}" ${maxAttr} placeholder="${UI.esc(opts.placeholder || '')}" value="${UI.esc(opts.value || '')}">`;
      m.innerHTML = `
        <div class="game-dialog">
          ${opts.icon ? `<div class="game-dialog-icon">${opts.icon}</div>` : ''}
          ${opts.title ? `<div class="game-dialog-title">${UI.esc(opts.title)}</div>` : ''}
          ${message ? `<div class="game-dialog-body">${UI.esc(message).replace(/\n/g, '<br>')}</div>` : ''}
          ${field}
          ${opts.hint ? `<div class="game-dialog-hint">${UI.esc(opts.hint)}</div>` : ''}
          <div class="game-dialog-actions">
            <button class="btn btn-orange" id="gd-ok">${UI.esc(opts.okText || 'OK')}</button>
            <button class="btn btn-inline" id="gd-cancel">Отмена</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      const input = m.querySelector('#gd-input');
      const close = (val) => { m.remove(); resolve(val); };
      m.querySelector('#gd-ok').onclick = () => close(input.value);
      m.querySelector('#gd-cancel').onclick = () => close(null);
      m.onclick = (e) => { if (e.target === m) close(null); };
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !ml) { e.preventDefault(); close(input.value); }
        if (e.key === 'Escape') close(null);
      });
    });
  },

  // Прогресс-бар: cur/max c подписью. cls: hp | en | xp | gold
  bar(cur, max, cls, label) {
    const pct = max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : 0;
    return `<div class="bar"><div class="fill ${cls}" style="width:${pct}%"></div>` +
      `<div class="txt">${UI.esc(label ?? `${UI.fmtNum(cur)} / ${UI.fmtNum(max)}`)}</div></div>`;
  },

  // Звёзды этапов достижений: ★★★☆☆
  stars(on, total) {
    let html = '<span class="stars">';
    for (let i = 0; i < total; i++) {
      html += `<span class="${i < on ? 'on' : 'off'}">★</span>`;
    }
    return html + '</span>';
  },

  // Окошко акции сверху раздела. discount = { pct, expiresAt, label } | null
  saleBanner(discount) {
    if (!discount) return '';
    const sec = Math.max(0, Math.floor((discount.expiresAt - Date.now()) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const left = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
    return `<div class="sale-banner">
        🏷 <b>АКЦИЯ −${discount.pct}%</b> · ${UI.esc(discount.label)} · действует ещё ${left}
      </div>`;
  },

  // Пара «старая→новая» цена с перечёркиванием. Если discount=null, обычная цена.
  // currency: '$' или 🪙 (через UI.gold или текст)
  priceWithSale(basePrice, price, currency, fmt) {
    const f = fmt || UI.fmtMoney;
    if (basePrice && price && basePrice !== price) {
      return `<span class="price-old">${currency} ${f(basePrice)}</span> <span class="price-new">${currency} ${f(price)}</span>`;
    }
    return `${currency} ${f(price || basePrice || 0)}`;
  },
};
