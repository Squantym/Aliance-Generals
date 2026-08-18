// ===================================================================
// public/js/admin2/router.js — адресная строка панели
//
// Зачем это вообще. В панели v1 состояние жило только в памяти:
// Admin.tab и Admin.selected. Последствия были ежедневные —
//   • «кинь ссылку на этого игрока» не работало вообще;
//   • F5 после часа работы возвращал на первую вкладку;
//   • «Назад» в браузере выкидывал из панели в игру;
//   • две вкладки браузера мешали друг другу, потому что показывали
//     одно и то же состояние.
// Всё это лечится одним: положение в панели должно быть адресом.
//
// Формат: #/раздел/аргумент?ключ=значение
//   #/queue
//   #/player/u_12345
//   #/logs?user=u_12345&cat=economy
//
// Нарочно НЕ используем history.pushState: панель отдаётся статикой,
// и любой «красивый» путь вида /admin/players после F5 упёрся бы в 404.
// Хэш переживает перезагрузку без единой строчки на сервере.
// ===================================================================

const A2Router = {
  _handler: null,
  _last: '',

  // Разобрать текущий адрес. Возвращает {name, arg, query, hash}
  parse(hash) {
    const raw = String(hash === undefined ? location.hash : hash).replace(/^#/, '');
    const [pathPart, queryPart] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    const query = {};
    if (queryPart) {
      for (const pair of queryPart.split('&')) {
        if (!pair) continue;
        const i = pair.indexOf('=');
        const k = i < 0 ? pair : pair.slice(0, i);
        const v = i < 0 ? '' : pair.slice(i + 1);
        try { query[decodeURIComponent(k)] = decodeURIComponent(v); }
        catch (e) { query[k] = v; }   // битый percent-encoding не должен ронять панель
      }
    }
    return {
      name: parts[0] || '',
      arg: parts[1] ? decodeURIComponent(parts[1]) : '',
      query,
      hash: raw,
    };
  },

  // Собрать адрес обратно
  build(name, arg, query) {
    let out = '#/' + name;
    if (arg) out += '/' + encodeURIComponent(arg);
    const keys = Object.keys(query || {}).filter((k) => query[k] !== '' && query[k] !== null && query[k] !== undefined);
    if (keys.length) {
      out += '?' + keys.map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
    }
    return out;
  },

  // Перейти. replace=true — не оставлять след в истории (нужно, когда
  // экран сам поправляет свой адрес: иначе «Назад» упирался бы в
  // бесконечную цепочку собственных уточнений).
  go(name, arg, query, replace) {
    const next = A2Router.build(name, arg, query);
    if (next === '#' + A2Router._last) return;   // уже там — не мигаем
    if (replace && location.replace) {
      location.replace(location.pathname + location.search + next);
      // replace не всегда шлёт hashchange — зовём разбор сами
      A2Router._fire();
    } else {
      location.hash = next;
    }
  },

  // Изменить только параметры текущего экрана, сохранив раздел.
  // Ради этого всё и затевалось: фильтр журнала, страница списка,
  // выбранный игрок — всё это должно попадать в ссылку, которую можно
  // переслать напарнику.
  setQuery(patch, replace) {
    const r = A2Router.parse();
    const q = Object.assign({}, r.query, patch || {});
    A2Router.go(r.name, r.arg, q, replace !== false);
  },

  _fire() {
    const r = A2Router.parse();
    A2Router._last = r.hash;
    if (A2Router._handler) A2Router._handler(r);
  },

  start(handler, fallback) {
    A2Router._handler = handler;
    const onChange = () => {
      const r = A2Router.parse();
      if (!r.name) return A2Router.go(fallback || 'queue', '', null, true);
      A2Router._fire();
    };
    window.addEventListener('hashchange', onChange);
    onChange();
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = A2Router;
