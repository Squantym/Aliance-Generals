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
