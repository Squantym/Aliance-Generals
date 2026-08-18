// ===================================================================
// public/js/admin2/econ.js — экономика #/econ?t=discounts
//
// Раздел собирает четыре бывшие вкладки про одно и то же — раздачу
// благ: массовая выдача, наёмники, акции, бонусы. Подвкладка теперь
// в адресе: «глянь акции» пересылается ссылкой, а F5 не выкидывает
// на первую подвкладку из четырёх.
//
// Каждая подвкладка рисуется своей старой функцией (renderTools,
// renderMercs, renderDiscounts, renderBuffs) — они и так принимают
// контейнер, переписывать там нечего.
//
// Важная тонкость с правами: вход в раздел даёт ЛЮБОЕ из двух прав
// («Ресурсы» или «Акции»), а подвкладки требуют своё. Сотруднику,
// которому выдали только акции, показываем только их — и сразу,
// а не «первую из списка, которая всё равно закрыта».
// ===================================================================

(function () {
  const SUBS = [
    { id: 'tools', label: '🎁 Массовая выдача', zone: 'economy', fn: 'renderTools' },
    { id: 'mercs', label: '🥷 Наёмники', zone: 'economy', fn: 'renderMercs' },
    { id: 'discounts', label: '🏷 Акции', zone: 'discounts', fn: 'renderDiscounts' },
    { id: 'buffs', label: '🎉 Бонусы', zone: 'economy', fn: 'renderBuffs' },
  ];

  function render(el, route) {
    const subs = SUBS.filter((s) => A2.can(s.zone));
    if (!subs.length) {
      el.innerHTML = `<div class="a2-title">Экономика</div>
        <div class="a2-card"><p class="a2-muted">Раздел закрыт: нужны права «Ресурсы» или «Акции».</p></div>`;
      return;
    }
    const cur = subs.some((s) => s.id === route.query.t) ? route.query.t : subs[0].id;

    el.innerHTML = `
      <div class="a2-title">Экономика</div>
      <div class="a2-card">
        <div class="a2-row">
          ${subs.map((s) => `<button class="btn btn-inline ${cur === s.id ? 'btn-orange' : ''}"
            data-t="${s.id}">${s.label}</button>`).join('')}
        </div>
      </div>
      <div id="econ-body" class="a2-legacy"></div>`;

    el.querySelectorAll('[data-t]').forEach((b) => {
      b.onclick = () => A2Router.setQuery({ t: b.dataset.t });
    });

    const body = document.getElementById('econ-body');
    const sub = subs.find((s) => s.id === cur);
    return Admin[sub.fn](body);
  }

  A2.screens.econ = render;
})();
