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

  async req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-token': this.token() || '' },
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
