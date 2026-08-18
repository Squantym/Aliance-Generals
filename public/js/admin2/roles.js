// ===================================================================
// public/js/admin2/roles.js — роли #/roles?p=staff|log|perms&who=…
//
// Раздел владельца, и в нём три разных занятия, которые в v1 лежали
// одним свитком:
//   • кто в штате и кому что назначить;
//   • журнал действий сотрудников — единственная проверка того, как
//     используются выданные права;
//   • настройка возможностей ролей.
//
// Журнал сотрудников выигрывает от адреса ровно так же, как игровой:
// «посмотри, что делал вот этот администратор» теперь ссылка
// #/roles?p=log&who=u_5, а не диктовка из четырёх шагов.
//
// Разметку и обработчики берём общими со старой панелью
// (_rolesHtml / _bindRoles). Копировать разметку прав нельзя вдвойне:
// разойдись две копии — и один из экранов начнёт врать про полномочия
// сотрудников, а по нему их и выдают.
// ===================================================================

(function () {
  const PAGES = [
    ['staff', '🛡 Штат и назначения'],
    ['log', '📜 Журнал сотрудников'],
    ['perms', '⚙️ Возможности ролей'],
  ];

  async function render(el, route) {
    const page = ['staff', 'log', 'perms'].indexOf(route.query.p) >= 0 ? route.query.p : 'staff';

    el.innerHTML = '<div class="a2-title">Роли</div><div class="loading">Загружаю сотрудников…</div>';
    let data = null;
    try { data = await API.get('/api/staff'); }
    catch (e) {
      el.innerHTML = `<div class="a2-card"><h3 style="color:var(--red)">Сотрудники не загрузились</h3>
        <p class="a2-muted">${UI.esc(e.message)}</p></div>`;
      return;
    }
    const iAmOwner = data.me && data.me.role === 'owner';

    // Не владельцу показывать нечего, кроме штата: журнал и настройка
    // прав — его инструменты. Молча отдавать пустую страницу нельзя,
    // поэтому вкладки просто не рисуем.
    const pages = iAmOwner ? PAGES : PAGES.filter(([id]) => id === 'staff');
    const cur = iAmOwner ? page : 'staff';

    el.innerHTML = `
      <div class="a2-title">Сотрудники</div>
      ${pages.length > 1 ? `<div class="a2-card">
        <div class="a2-row">
          ${pages.map(([id, label]) => `<button class="btn btn-inline ${cur === id ? 'btn-orange' : ''}"
            data-p="${id}">${label}</button>`).join('')}
        </div>
      </div>` : ''}
      <div id="roles-body" class="a2-legacy"></div>`;

    el.querySelectorAll('[data-p]').forEach((b) => {
      // Смена страницы сбрасывает выбранного сотрудника: он относится
      // только к журналу, и «залипший» who в адресе другой страницы
      // сбивал бы с толку при пересылке ссылки.
      b.onclick = () => A2Router.setQuery({ p: b.dataset.p, who: '' });
    });

    const body = document.getElementById('roles-body');
    body.innerHTML = Admin._rolesHtml(data, {
      staff: cur === 'staff' ? 1 : 0,
      assign: cur === 'staff' ? 1 : 0,
      log: cur === 'log' ? 1 : 0,
      perms: cur === 'perms' ? 1 : 0,
    });
    Admin._bindRoles(data, body, () => A2.refresh());

    if (cur === 'log') {
      // Кто выбран — из адреса. Это и делает ссылку пересылаемой.
      const sel = document.getElementById('staff-log-who');
      const go = document.getElementById('staff-log-go');
      if (sel && go) {
        if (route.query.who) { sel.value = route.query.who; go.click(); }
        // Выбор в списке уезжает в адрес, а не остаётся в памяти вкладки
        sel.onchange = () => A2Router.setQuery({ who: sel.value });
      }
    }

    if (cur === 'staff') {
      // Кнопка «журнал» у сотрудника ведёт на страницу журнала с ним же,
      // вместо прокрутки к блоку ниже на том же экране.
      body.querySelectorAll('[data-staff-log]').forEach((b) => {
        // false = записать в историю: это переход на другую страницу
        // раздела, и «Назад» должен вернуть к штату, а не за его пределы.
        b.onclick = () => A2Router.setQuery({ p: 'log', who: b.dataset.staffLog }, false);
      });
    }
  }

  A2.screens.roles = render;
})();
