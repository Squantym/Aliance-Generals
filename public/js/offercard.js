// ===================================================================
// public/js/offercard.js — карточка спецпредложения.
//
// ОДНА разметка на два места: витрина в банке у игрока и предпросмотр в
// админ-панели, где владелец собирает набор. Своей вёрстки у панели нет
// намеренно — предпросмотр, который «примерно как у игрока», начинает
// врать с первой же правки витрины, а верят ему при этом как настоящему.
//
// Данные всегда приходят с сервера (offers.showcase): состав уже описан
// словами и снабжён картинками, здесь только рисование. Значит, и в
// предпросмотре видно ровно то, что увидит игрок, включая значки.
//
// Подключается и в игре (index.html), и в панели (admin2.html).
// ===================================================================

const OfferCard = {
  // Остаток срока словами. Секунды не показываем: набор живёт днями,
  // и «2 дн 3 ч» читается быстрее, чем точный отсчёт.
  timeLeft(sec) {
    if (sec === null || sec === undefined) return '';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d} дн ${h} ч`;
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
  },

  // o — карточка с сервера. opts.preview — режим панели: кнопки не
  // нажимаются, но выглядят как у игрока (по ним и оценивают набор).
  html(o, opts) {
    const p = (opts || {}).preview;
    const money = (n) => (window.UI && UI.fmtNum ? UI.fmtNum(n) : String(n));
    const esc = (s) => (window.UI && UI.esc ? UI.esc(s) : String(s == null ? '' : s));
    const items = (o.items || []).map((it) => `
      <div class="offer-item">
        ${it.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy" decoding="async"
             onerror="this.remove()">` : ''}
        <span>${esc(it.text)}</span>
      </div>`).join('');

    return `
      <div class="card offer-card">
        <div class="offer-head">
          <span class="offer-emoji">${esc(o.emoji || '🎁')}</span>
          <span class="grow"><b>${esc(o.title)}</b>
            ${o.note ? `<div class="muted small">${esc(o.note)}</div>` : ''}</span>
          ${o.endsInSec !== null && o.endsInSec !== undefined
            ? `<span class="offer-timer">⏳ ${OfferCard.timeLeft(o.endsInSec)}</span>` : ''}
        </div>
        <div class="offer-items">${items || '<div class="muted small">Состав пуст</div>'}</div>
        ${o.limitPerPlayer
          ? `<div class="muted small mt">В одни руки: ${o.limitPerPlayer} · вы взяли ${o.boughtByMe || 0}</div>` : ''}
        <div class="offer-buy mt">
          ${o.priceGold ? `
            <button class="btn btn-orange grow" ${p ? 'disabled' : `data-offer-gold="${esc(o.id)}"`}
              ${!p && o.canBuyGold ? '' : 'disabled'}>
              ${o.oldPriceGold ? `<s class="muted">${money(o.oldPriceGold)}</s> ` : ''}
              <span class="ic-gold"></span> ${money(o.priceGold)}
            </button>` : ''}
          ${o.priceRub ? `
            <button class="btn btn-inline grow" ${p ? 'disabled' : `data-offer-rub="${esc(o.id)}"`}
              ${!p && o.canBuyRub ? '' : 'disabled'}>
              ${o.oldPriceRub ? `<s class="muted">${money(o.oldPriceRub)} ₽</s> ` : ''}${money(o.priceRub)} ₽
            </button>` : ''}
          ${!o.priceGold && !o.priceRub ? '<span class="muted small">Цена не указана</span>' : ''}
        </div>
        ${!p && !o.canBuyGold && !o.canBuyRub
          ? '<p class="muted small center mt">Вы уже взяли этот набор</p>' : ''}
      </div>`;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = OfferCard;
