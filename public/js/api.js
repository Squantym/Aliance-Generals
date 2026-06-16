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
  post(url, body) { return this.req('POST', url, body || {}); },
};
