// ===================================================================
// public/js/api.js — общение с сервером
// Одна обёртка над fetch: подставляет токен из localStorage,
// разбирает JSON, показывает серверные уведомления (notices)
// и при «протухшем» токене отправляет игрока на экран входа.
// ===================================================================

const API = {
  // Токен сессии хранится в браузере между визитами
  token() { return localStorage.getItem('gtoken'); },
  setToken(t) {
    if (t) localStorage.setItem('gtoken', t);
    else localStorage.removeItem('gtoken');
  },

  // ═══ ОТПЕЧАТОК УСТРОЙСТВА ═════════════════════════════════════════
  // Строка браузера различает устройства плохо: у половины игроков там
  // одно и то же «Chrome на Windows 10», и в панели они выглядят как
  // одно устройство. Добавляем то, что браузер отдаёт без разрешений:
  // размер экрана, часовой пояс, язык, число ядер, глубину цвета.
  // Вместе это различает устройства заметно лучше, а по отдельности не
  // говорит ни о чём — ни имени, ни адреса, ни истории здесь нет.
  //
  // Считаем ОДИН раз за загрузку страницы: значения не меняются, а
  // обращение к screen и Intl на каждом запросе — лишняя работа.
  _fp: null,
  fp() {
    if (this._fp !== null) return this._fp;
    try {
      const s = window.screen || {};
      const tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '';
      const parts = [
        (s.width || 0) + 'x' + (s.height || 0),
        (s.colorDepth || 0) + 'bit',
        (window.devicePixelRatio || 1).toFixed(2),
        tz,
        (navigator.language || ''),
        'cpu' + (navigator.hardwareConcurrency || 0),
        'mem' + (navigator.deviceMemory || 0),
        (navigator.platform || ''),
        (navigator.maxTouchPoints || 0) + 'tp',
      ];
      this._fp = parts.join('|').slice(0, 200);
    } catch (e) { this._fp = ''; }
    return this._fp;
  },

  async req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-token': this.token() || '',
        'x-fp': this.fp(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* пустой ответ — не страшно */ }

    // Сессия умерла — чистим токен и показываем вход
    if (res.status === 401) {
      API.setToken(null);
      App.me = null;
      location.hash = '#auth';
      throw new Error(data.error || 'Требуется вход в игру');
    }
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    // Сервер прислал события (награды, уровни) — показываем тостами
    if (Array.isArray(data.notices)) data.notices.forEach((n) => UI.toast(n));
    return data;
  },

  get(url) { return this.req('GET', url); },

  // ═══ ЗАЩИТА ОТ ДВОЙНОГО ОТПРАВЛЕНИЯ ═══════════════════════════════
  // Раньше каждое нажатие уходило на сервер отдельно. Двойной клик по
  // «Выдать» — две выдачи; повтор при плохой сети — тоже две. Кнопки
  // блокировались не везде, и это было не забывчивостью в одном месте,
  // а отсутствием общего правила.
  //
  // Теперь правило одно и на всех: пока запрос на ТОТ ЖЕ адрес с ТЕМ ЖЕ
  // телом не завершился, повторный вызов возвращает то же обещание, а не
  // отправляет второй запрос. Разные запросы друг друга не блокируют, и
  // сознательный повтор после ответа работает как обычно.
  _inFlight: new Map(),

  post(url, body) {
    const payload = body || {};
    const key = url + '|' + JSON.stringify(payload);
    const running = this._inFlight.get(key);
    if (running) return running;                 // тот же запрос уже в пути
    const p = this.req('POST', url, payload)
      .finally(() => { this._inFlight.delete(key); });
    this._inFlight.set(key, p);
    return p;
  },
};
