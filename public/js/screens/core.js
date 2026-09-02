// ===================================================================
// public/js/screens/core.js — базовые экраны
// auth (вход/регистрация), home (главная с Майором и меню),
// profile (свой и чужой), skills (навыки), bank (хранилище).
// ===================================================================

// ---------- ВХОД И РЕГИСТРАЦИЯ ----------
App.screens.auth = async (c) => {
  const { countries } = await API.get('/api/countries');

  const countryOptions = countries.map((x) =>
    // ВНИМАНИЕ: в выпадающем списке отрисовывается только текст, HTML-теги
    // игнорируются. Поэтому здесь эмодзи, а не иконка-класс ic-gold.
    `<option value="${x.id}">${x.flag} ${UI.esc(x.name)} — ${UI.esc(x.bonus)}${x.gold ? ` (🪙 ${x.gold})` : ''}</option>`
  ).join('');

  // Открыта ли регистрация. Ответ уже пришёл вместе с состоянием мира —
  // второй раз тот же вопрос серверу не задаём.
  //
  // Вкладку прячем совсем, а не блокируем: форма, которая всегда
  // откажет, — это обещание, которое игра не собирается выполнять.
  // Человек заполняет пять полей, ставит три галочки, жмёт «Подписать
  // контракт» и только тогда узнаёт, что регистрации нет. Так устроен
  // тестовый мир: аккаунты там выдаёт владелец.
  //
  // Не знаем состояния (запрос не прошёл) — показываем как раньше:
  // отказать всегда успеет сервер, а вот спрятать регистрацию из-за
  // сетевой ошибки значило бы потерять живого новичка.
  const regState = (App._world && App._world.registration) || null;
  const regOpen = !regState || regState.open !== false;
  const regWhy = regState && regState.why ? regState.why : '';

  c.innerHTML = `
    <div class="title">Военкомат</div>
    <div class="tabs">
      <div class="tab active" id="tab-login">Вход</div>
      ${regOpen ? '<div class="tab" id="tab-reg">Регистрация</div>' : ''}
    </div>

    ${regOpen ? '' : `
      <div class="card" style="border-color:var(--gold)">
        <p class="small" style="margin:0">🚫 ${UI.esc(regWhy || 'Регистрация сейчас закрыта.')}</p>
      </div>`}

    <div class="card" id="form-login">
      <label for="li-name">Позывной</label>
      <input type="text" id="li-name" maxlength="16" autocomplete="username" required placeholder="Ваш игровой позывной">
      <label for="li-pass">Пароль</label>
      <input type="password" id="li-pass" autocomplete="current-password" required placeholder="Пароль от аккаунта">
      <button class="btn btn-orange mt" id="li-go">Войти в строй</button>

      <!-- Появляется, только если сервер ответил «подтвердите почту».
           Иначе форма входа обрастала бы полями, которые нужны раз в
           жизни и путают всех остальных. -->
      <div id="li-code-box" style="display:none">
        <div class="card mt" style="background:rgba(233,199,92,.06);border-color:var(--gold)">
          <p class="small" style="margin:0 0 8px">Почта ещё не подтверждена. Введите код из письма:</p>
          <input type="text" id="li-code" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="6" placeholder="000000"
                 style="letter-spacing:8px;text-align:center;font-size:22px;font-family:ui-monospace,Menlo,Consolas,monospace">
          <button class="btn btn-orange mt" id="li-code-go">Подтвердить и войти</button>
          <button class="btn mt" id="li-code-resend">Прислать код заново</button>
        </div>
      </div>

      <p class="center mt"><a href="javascript:void 0" id="li-forgot" class="small">Забыли пароль?</a></p>
    </div>

    <div class="card" id="form-forgot" style="display:none">
      <p class="muted small">Введите позывной или email — мы отправим ссылку для восстановления пароля на вашу почту.</p>
      <label for="fg-id">Позывной или email</label>
      <input type="text" id="fg-id" placeholder="Позывной или your@email.com">
      <button class="btn btn-orange mt" id="fg-go">Отправить ссылку</button>
      <p class="center mt"><a href="javascript:void 0" id="fg-back" class="small">← Назад ко входу</a></p>
    </div>

    <div class="card" id="form-reg" style="display:none">
      <p class="muted small">2034 год. Мир охвачен войной, и каждой армии нужны решительные командиры. Заполни личное дело, боец.</p>
      <label for="rg-name">Позывной (3–16 символов, только буквы/цифры/_ -)</label>
      <input type="text" id="rg-name" maxlength="16" autocomplete="username" required placeholder="Например: ShadowGeneral">
      <label for="rg-email">Email (для подтверждения регистрации)</label>
      <input type="email" id="rg-email" autocomplete="email" required placeholder="your@email.com">

      <!-- Появляется сразу после «Подписать контракт», без перезагрузки
           страницы: игрок остаётся в форме, где уже всё заполнено. -->
      <div id="rg-code-box" style="display:none">
        <div class="card mt" style="background:rgba(233,199,92,.06);border-color:var(--gold)">
          <p class="small" style="margin:0 0 8px">
            Код из 6 цифр отправлен на <b id="rg-code-email"></b>. Впишите его сюда —
            и сразу в игру.
          </p>
          <label for="rg-code">Код из письма</label>
          <input type="text" id="rg-code" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="6" placeholder="000000"
                 style="letter-spacing:8px;text-align:center;font-size:22px;font-family:ui-monospace,Menlo,Consolas,monospace">
          <button class="btn btn-orange mt" id="rg-code-go">Подтвердить и войти</button>
          <button class="btn mt" id="rg-code-resend">Прислать код заново</button>
          <p class="muted small mt" style="margin-bottom:0">
            Письма нет? Загляните в «Спам» — отправитель <b>noreply@aliance-general.ru</b>.
            Код действует 30 минут.
          </p>
        </div>
      </div>
      <label for="rg-pass">Пароль (минимум 8 символов, буквы + цифры)</label>
      <input type="password" id="rg-pass" autocomplete="new-password" required placeholder="Не менее 8 символов" minlength="8">
      <label for="rg-country">Страна (даёт постоянный бонус)</label>
      <select id="rg-country" required>${countryOptions}</select>
      <div id="rg-country-bonus" class="card" style="margin-top:8px;background:rgba(233,199,92,.06);border-color:var(--gold)">
        <div style="display:flex;align-items:center;gap:10px">
          <span id="rg-flag" style="font-size:32px"></span>
          <div>
            <div id="rg-cname" style="font-weight:bold;color:var(--gold)"></div>
            <div id="rg-cbonus" class="small" style="color:var(--text)"></div>
          </div>
        </div>
      </div>

      <!-- ── Согласия ────────────────────────────────────────────────
           Отметки пустые по умолчанию и разделены по смыслу: закон
           требует конкретного и сознательного согласия, а согласие на
           распространение данных — отдельного действия. Одна общая
           галка «со всем согласен» этому не отвечает.
           Реклама и публичный профиль на регистрацию не влияют. -->
      <div class="card mt" id="rg-consents" style="background:rgba(233,199,92,.05);border-color:var(--gold)">
        <div class="name" style="font-size:15px">Прежде чем подписать контракт</div>

        <label class="rg-check">
          <input type="checkbox" id="rg-age">
          <span>Мне исполнилось <b>18 лет</b></span>
        </label>

        <label class="rg-check">
          <input type="checkbox" id="rg-terms">
          <span>Я прочитал(а) и принимаю
            <a href="/terms.html" target="_blank" rel="noopener">Пользовательское соглашение</a>,
            <a href="/rules.html" target="_blank" rel="noopener">Правила игры</a> и
            <a href="/payments.html" target="_blank" rel="noopener">Правила платежей</a></span>
        </label>

        <label class="rg-check">
          <input type="checkbox" id="rg-pdn">
          <span>Даю <a href="/consent-pdn.html" target="_blank" rel="noopener">согласие на обработку
            персональных данных</a> в соответствии с
            <a href="/privacy.html" target="_blank" rel="noopener">Политикой</a></span>
        </label>

        <hr class="hr" style="margin:12px 0">
        <p class="muted small" style="margin:0 0 6px">Необязательно — на регистрацию не влияет:</p>

        <label class="rg-check">
          <input type="checkbox" id="rg-public">
          <span>Разрешаю <a href="/consent-public.html" target="_blank" rel="noopener">показывать мой
            профиль</a> другим игрокам</span>
        </label>
        <div id="rg-public-parts" style="display:none;margin:4px 0 8px 26px">
          <label class="rg-check small"><input type="checkbox" data-pub="nick" checked><span>Позывной</span></label>
          <label class="rg-check small"><input type="checkbox" data-pub="flag" checked><span>Страна и флаг</span></label>
          <label class="rg-check small"><input type="checkbox" data-pub="stats" checked><span>Уровень и статистика</span></label>
          <label class="rg-check small"><input type="checkbox" data-pub="ally" checked><span>Альянс и роль</span></label>
        </div>

        <label class="rg-check">
          <input type="checkbox" id="rg-ads">
          <span>Хочу получать <a href="/consent-ads.html" target="_blank" rel="noopener">новости, акции
            и предложения</a></span>
        </label>
        <p class="muted small" style="margin:8px 0 0">
          Код подтверждения, восстановление пароля и сообщения о санкциях приходят всегда —
          это служебные письма, а не реклама.
        </p>
      </div>

      <button class="btn btn-orange mt" id="rg-go">Подписать контракт</button>
    </div>`;

  // Подкатегории публичности раскрываются только когда разрешение дано:
  // выбор «по каждой категории» закон требует, но показывать его человеку,
  // который вообще отказался, незачем.
  const pubBox = document.getElementById('rg-public');
  if (pubBox) pubBox.onchange = () => {
    const parts = document.getElementById('rg-public-parts');
    if (parts) parts.style.display = pubBox.checked ? '' : 'none';
  };

  // Показ бонуса выбранной страны
  const updateCountryBonus = () => {
    const sel = document.getElementById('rg-country');
    if (!sel) return;
    const ct = countries.find((x) => x.id === sel.value);
    if (!ct) return;
    document.getElementById('rg-flag').innerHTML = App._flagImg(ct.flag, 'big');
    document.getElementById('rg-cname').textContent = ct.name;
    document.getElementById('rg-cbonus').innerHTML = '🎖 ' + UI.esc(ct.desc || ct.bonus || '') + (ct.gold ? ` <span class="gold">(+<span class="ic-gold"></span> ${ct.gold} на старте)</span>` : '');
  };

  // Переключение вкладок входа/регистрации. Вкладки регистрации может не
  // быть вовсе — тогда переключать нечего, и обращение к ней уронило бы
  // весь экран входа, то есть заперло бы игру целиком.
  const tabReg = document.getElementById('tab-reg');
  const show = (login) => {
    document.getElementById('form-login').style.display = login ? '' : 'none';
    document.getElementById('form-reg').style.display = login ? 'none' : '';
    document.getElementById('tab-login').classList.toggle('active', login);
    if (tabReg) tabReg.classList.toggle('active', !login);
  };
  document.getElementById('tab-login').onclick = () => show(true);
  if (tabReg) tabReg.onclick = () => show(false);
  // Обновление блока бонуса страны
  const countrySel = document.getElementById('rg-country');
  if (countrySel) { countrySel.onchange = updateCountryBonus; updateCountryBonus(); }

  // Общее завершение: сохранить токен, загрузить игрока, на главную
  const finish = async (token) => {
    API.setToken(token);
    App.me = await API.get('/api/me');
    App.go('home');
  };

  document.getElementById('li-go').onclick = async () => {
    try {
      const r = await API.post('/api/login', {
        login: document.getElementById('li-name').value,
        password: document.getElementById('li-pass').value,
      });
      // Второй фактор: токена ещё нет, есть только пропуск на второй шаг.
      // Спрашиваем код здесь же, не уводя человека на другой экран.
      if (r.needTotp) {
        const code = await UI.prompt(
          'Введите код из приложения-аутентификатора.\n\n'
          + 'Потеряли телефон — введите код восстановления.',
          { title: 'Подтверждение входа', icon: '🔐', okText: 'Войти', maxLength: 20,
            placeholder: '123 456' });
        if (code === null) return;
        const r2 = await API.post('/api/login/totp', { challengeId: r.challengeId, code });
        await finish(r2.token);
        return;
      }
      // Заблокированного впускаем, но показываем только окно с причиной
      // и сроком — так он понимает, что произошло и когда это кончится
      if (r.banned && r.banInfo) {
        API.setToken(r.token);
        App.showBanScreen(r.banInfo);
        return;
      }
      await finish(r.token);
    } catch (e) {
      UI.toast('⛔ ' + e.message);
      // «Подтвердите почту» — не тупик, а недоделанный шаг регистрации.
      // Раньше здесь была кнопка «отправить письмо повторно», игрок
      // уходил в почту, жал ссылку в другом браузере и возвращался к
      // той же надписи. Теперь код вводится прямо здесь.
      if (/Подтвердите почту/i.test(e.message || '')) {
        showLoginCode(document.getElementById('li-name').value.trim());
      }
    }
  };

  // Поле кода в форме входа — для тех, кто зарегистрировался раньше и
  // до игры так и не дошёл.
  function showLoginCode(login) {
    const box = document.getElementById('li-code-box');
    if (!box || !login) return;
    box.style.display = '';
    const input = document.getElementById('li-code');
    input.focus();

    const send = async () => {
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { UI.toast('⛔ Код состоит из 6 цифр'); return; }
      try {
        const r = await API.post('/api/verify-code', { login, code });
        UI.toast('✅ Почта подтверждена');
        await finish(r.token);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    document.getElementById('li-code-go').onclick = send;
    input.onkeydown = (ev) => { if (ev.key === 'Enter') send(); };
    input.oninput = () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value.length === 6) send();
    };
    document.getElementById('li-code-resend').onclick = async () => {
      try {
        const rr = await API.post('/api/resend-verification', { login });
        if (rr.autoVerified) UI.toast('✅ Почта подтверждена автоматически — войдите ещё раз');
        else UI.toast('📧 Новый код отправлен на вашу почту');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  // Восстановление пароля
  const showForgot = (on) => {
    document.getElementById('form-login').style.display = on ? 'none' : '';
    document.getElementById('form-forgot').style.display = on ? '' : 'none';
  };
  document.getElementById('li-forgot').onclick = () => showForgot(true);
  document.getElementById('fg-back').onclick = () => showForgot(false);
  document.getElementById('fg-go').onclick = async () => {
    const id = document.getElementById('fg-id').value.trim();
    if (!id) { UI.toast('⛔ Введите позывной или email'); return; }
    try {
      await API.post('/api/request-password-reset', { loginOrEmail: id });
      UI.toast('📧 Если аккаунт существует, письмо со ссылкой отправлено на почту');
      showForgot(false);
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };

  document.getElementById('rg-go').onclick = async () => {
    // БАГ 2: клиентская валидация перед отправкой
    const name = document.getElementById('rg-name').value.trim();
    const email = document.getElementById('rg-email').value.trim();
    const pass  = document.getElementById('rg-pass').value;
    if (!name)  { UI.toast('⛔ Введите позывной'); return; }
    if (name.length < 3) { UI.toast('⛔ Позывной минимум 3 символа'); return; }
    if (!email) { UI.toast('⛔ Введите email'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { UI.toast('⛔ Введите корректный email'); return; }
    if (!pass)  { UI.toast('⛔ Введите пароль'); return; }
    if (pass.length < 8) { UI.toast('⛔ Пароль минимум 8 символов'); return; }
    if (!/[A-Za-zА-Яа-яЁё]/.test(pass) || !/[0-9]/.test(pass)) { UI.toast('⛔ Пароль должен содержать буквы и цифры'); return; }

    // Согласия. Проверяем и здесь, и на сервере: клиентская проверка
    // подсказывает сразу, серверная — единственная, на которую можно
    // положиться.
    const ck = (id) => !!(document.getElementById(id) || {}).checked;
    if (!ck('rg-age'))   { UI.toast('⛔ Регистрация доступна с 18 лет'); return; }
    if (!ck('rg-terms')) { UI.toast('⛔ Примите Пользовательское соглашение'); return; }
    if (!ck('rg-pdn'))   { UI.toast('⛔ Нужно согласие на обработку персональных данных'); return; }
    const publicScope = {};
    document.querySelectorAll('#rg-public-parts input[data-pub]').forEach((el) => {
      publicScope[el.getAttribute('data-pub')] = !!el.checked;
    });
    const consents = {
      age18: ck('rg-age'), terms: ck('rg-terms'), pdn: ck('rg-pdn'),
      public: ck('rg-public'), ads: ck('rg-ads'), publicScope,
    };

    try {
      const r = await API.post('/api/register', {
        login: name,
        email: document.getElementById('rg-email').value,
        password: pass,
        country: document.getElementById('rg-country').value,
        consents,
      });
      if (r.isAdmin) UI.toast('👑 Вы первый игрок — вам выданы права администратора');
      if (r.token) {
        // Отправка писем не настроена — почта считается подтверждённой,
        // иначе новые игроки вообще не смогли бы войти
        await finish(r.token);
        return;
      }
      // Страницу НЕ перезагружаем: игрок остаётся в форме, где уже всё
      // заполнено, и просто дописывает код из письма. Раньше здесь
      // рисовался экран «идите в почту», игрок уходил по ссылке в другой
      // браузер — и возвращался к форме входа, которая его не пускала.
      showCodeBox(name, email);
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };

  // ── Ввод кода из письма ──────────────────────────────────────────
  function showCodeBox(login, mail) {
    const box = document.getElementById('rg-code-box');
    if (!box) return;
    box.style.display = '';
    document.getElementById('rg-code-email').textContent = mail;
    document.getElementById('rg-go').style.display = 'none';
    const input = document.getElementById('rg-code');
    input.value = '';
    input.focus();

    const send = async () => {
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { UI.toast('⛔ Код состоит из 6 цифр'); return; }
      try {
        const r = await API.post('/api/verify-code', { login, code });
        UI.toast('✅ Почта подтверждена');
        await finish(r.token);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    document.getElementById('rg-code-go').onclick = send;
    // Ввод шести цифр и Enter — привычнее, чем тянуться к кнопке
    input.onkeydown = (ev) => { if (ev.key === 'Enter') send(); };
    input.oninput = () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value.length === 6) send();
    };

    document.getElementById('rg-code-resend').onclick = async () => {
      try {
        const rr = await API.post('/api/resend-verification', { login });
        if (rr.autoVerified) UI.toast('✅ Почта подтверждена автоматически — можете войти');
        else UI.toast('📧 Новый код отправлен');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }
};

// ---------- ГЛАВНАЯ ----------
App.screens.home = async (c) => {
  await App.refreshMe();
  const m = App.me;
  if (!m) return App.go('auth');

  // Блок Майора: сюжетное задание или дежурная фраза
  let majorHtml;
  const t = m.tutorial;
  // Инструктор задания по его экрану/роли (обучение вводит Генерал Волков)
  const tutorChar = (screen) => ({
    war: { id: 'volkov', name: 'Генерал Волков', role: 'Командующий фронтом' },
    units: { id: 'kovac', name: 'Майор Ковач', role: 'Начальник снабжения' },
    buildings: { id: 'morozova', name: 'Полковник Морозова', role: 'Начальник тыла' },
    missions: { id: 'tesla', name: 'Аналитик Тесла', role: 'Куратор спецопераций' },
  }[screen] || { id: 'volkov', name: 'Генерал Волков', role: 'Командующий фронтом' });
  if (!t.done && t.quest) {
    const ch = t.step === 0 ? { id: 'volkov', name: 'Генерал Волков', role: 'Командующий фронтом' } : tutorChar(t.quest.screen);
    majorHtml = `
      <div class="card">
        <div class="tutor-head">
          ${App.instrImg(ch.id, 54)}
          <div><div class="th-name">${ch.name}</div><div class="th-role">${ch.role}</div></div>
        </div>
        ${t.step === 0 ? `<p class="story small">${UI.esc(t.prologue)}</p><hr class="hr">` : ''}
        <p><b>${ch.name}:</b> ${UI.esc(t.quest.story)}</p>
        <p class="mt small">📜 Задание ${t.step + 1}/${t.total}: <b>${UI.esc(t.quest.title)}</b><br>
        <span class="muted">Цель: ${UI.esc(t.quest.goal)}</span><br>
        <span class="gold">Награда: ${UI.esc(t.quest.reward)}</span></p>
        <button class="btn btn-orange mt" onclick="App.go('${t.quest.screen}')">Выполнить →</button>
      </div>`;
  } else {
    // Курс молодого бойца пройден — окно инструктора БОЛЬШЕ НЕ ПОКАЗЫВАЕТСЯ.
    // (Раньше здесь висела вечная карточка «курс пройден» — она мозолила глаза
    //  на главном экране всю оставшуюся игру.)
    majorHtml = '';
  }

  // Незавершённое фаталити — срочное напоминание
  const fatalityHtml = m.pendingFatality
    ? `<div class="card fatality-card center">💀 Враг <b>${UI.esc(m.pendingFatality.name)}</b> повержен и ждёт вашего решения!
       <button class="btn btn-red mt" onclick="App.go('war')">Решить судьбу →</button></div>`
    : '';

  // Предложение установить игру на телефон (PWA)
  const installBanner = App.canInstall() ? `
    <div class="card" style="border-color:var(--green);background:rgba(158,194,91,.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="name" style="margin:0">📲 Установить игру</div>
        <span class="muted small" style="cursor:pointer" onclick="App.hideInstall()">✕</span>
      </div>
      <p class="muted small" style="margin:4px 0 8px">Иконка на рабочем столе, запуск на весь экран без адресной строки.</p>
      <button class="btn btn-orange" style="width:100%" onclick="App.installApp()">Установить</button>
    </div>` : '';

  // Предложение включить push-уведомления (нападения, бои легиона)
  const pushBanner = App.canEnablePush() ? `
    <div class="card" style="border-color:var(--en)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="name" style="margin:0">🔔 Уведомления</div>
        <span class="muted small" style="cursor:pointer" onclick="App.hidePush()">✕</span>
      </div>
      <p class="muted small" style="margin:4px 0 8px">Сообщим, когда на вас напали, начался бой легиона или перебили вашу ставку.</p>
      <button class="btn" style="width:100%" onclick="App.enablePush()">Включить уведомления</button>
    </div>` : '';

  // Награды от «Система» (сезоны, администрация) — забрать можно тут или в почте
  let rewardsBanner = '';
  let rewardsList = [];
  try {
    const rd = await API.get('/api/rewards');
    rewardsList = (rd.rewards || []).filter((r) => !r.claimed);
    if (rewardsList.length) {
      rewardsBanner = `
        <div class="card" style="border:2px solid var(--gold);background:rgba(233,199,92,.08)">
          <div class="name gold">🎁 Награды (${rewardsList.length})</div>
          <p class="muted small">Письма от «Система». Заберите — награда зачислится сразу.</p>
          ${rewardsList.map((r) => `
            <div class="card" style="margin-top:8px">
              <div style="font-weight:600">${UI.esc(r.title)}</div>
              <div class="muted small" style="margin-top:2px">${UI.esc(r.reason)}</div>
              <div class="gold small mt">Награда: ${r.rewardText.map((x) => UI.esc(x)).join(' · ')}</div>
              <button class="btn btn-orange mt" data-claim-reward="${r.id}" style="width:100%">🎁 Забрать</button>
            </div>`).join('')}
        </div>`;
    }
  } catch (e) {}

  // Превью последних новостей для раздела внизу главного меню
  let newsSectionHtml = '';
  try {
    const nd = await API.get('/api/news');
    const latest = (nd.posts || []).slice(0, 3);
    const rows = latest.length
      ? latest.map((p) => `
        <div class="news-home-row" onclick="App.go('newsview/${p.id}')">
          <span style="font-size:20px">${UI.esc(p.emoji || '📰')}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.pinned ? '📌 ' : ''}${UI.esc(p.title)}</div>
            <div class="muted small">${p.tag ? UI.esc(p.tag) + ' · ' : ''}${UI.fmtDate(p.createdAt)}</div>
          </div>
          <span class="muted">›</span>
        </div>`).join('')
      : '<p class="muted small center" style="padding:10px 0">Новостей пока нет</p>';
    newsSectionHtml = `
      <div class="card" style="margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div class="name">📰 Новости</div>
          <button class="btn btn-inline" style="padding:5px 12px;font-size:12px" onclick="App.go('news')">Все →</button>
        </div>
        ${rows}
      </div>`;
  } catch (e) { /* новости недоступны — просто не показываем блок */ }

  // Главное меню — сетка 2 колонки. В верхнем (главном) блоке — Легион,
  // альянс — в нижнем (вторичном) меню.
  const prodLocked = !m.unlocked.production;
  // Иконки меню — картинки из /img/menu/<id>.webp (см. App.menuImg)
  const big = [
    ['war', 'war', 'Война'],
    ['legion', 'legion', 'Легион'],
    ['missions', 'missions', 'Спецоперации'],
    ['hq', 'hq', 'Поручения штаба'],
    ['production', 'production', 'Производство' + (prodLocked ? ` 🔒` : '')],
    ['units', 'units', 'Техника'],
    ['buildings', 'buildings', 'Постройки'],
    ['market', 'market', 'Чёрный рынок'],
    ['saboteurs', 'saboteurs', 'Диверсанты'],
    ['club', 'club', 'Клуб офицеров'],
  ];
  // Прямой доступ ко всем разделам. Достижения и внешний вид — внутри
  // профиля. Событие — во вкладке «Война» (бои). Ежедневный вход — авто.
  const small = [
    ['profile', 'profile', 'Профиль', ''],
    ['alliance', 'alliance', 'Альянс', ''],
    ['reinforcements', 'alliance', 'Подкрепления', ''],
    ['fame/alltime/level', 'fame', 'Зал славы', ''],
    ['chat', 'chat', 'Общение', ''],
    ['mail', 'mail', 'Почта', m.mailUnread > 0 ? `<span class="badge">${m.mailUnread}</span>` : ''],
    ['trophies', 'trophies', 'Трофеи', ''],
    ['season', 'season', 'Сезон', ''],
    ['referral', 'referral', 'Пригласить друга', ''],
    ['bank', 'bank', 'Банк', ''],
    ['hospital', 'hospital', 'Госпиталь', ''],
    ['settings', 'settings', 'Настройки', ''],
  ];

  // Вызов легиона — баннер для лидера клана (висит до истечения таймера вызова)
  let legionChallengeBanner = '';
  try {
    if (m.legionId) {
      const lgd = await API.get('/api/legion');
      const LC = lgd.mine && lgd.mine.challenge;
      if (LC && LC.role === 'challenged' && LC.secondsLeft > 0) {
        legionChallengeBanner = `
          <div class="card" style="border:2px solid var(--red);background:rgba(220,50,50,.08)">
            <div class="name" style="color:var(--red)">⚔️ ВЫЗОВ НА БОЙ!</div>
            <p class="small mt">Легион <b>${UI.esc(LC.enemyName)}</b> вызывает ваш клан на бой!</p>
            <div class="kv mt"><span class="k">Осталось</span><span class="v" id="lcg-timer">${UI.fmtTimer(LC.secondsLeft)}</span></div>
            <button class="btn btn-green mt" onclick="App.go('legion')">Принять / отклонить →</button>
          </div>`;
      }
    }
  } catch(e) {}

  c.innerHTML = `
    ${legionChallengeBanner}
    ${installBanner}
    ${pushBanner}
    ${rewardsBanner}
    ${fatalityHtml}
    ${majorHtml}
    <div class="menu-grid">
      ${big.map(([id, ic, label]) =>
        `<div class="menu-btn" onclick="App.go('${id}')">${App.menuImg(ic, 40)}${label}</div>`).join('')}
    </div>
    <div class="menu-grid">
      ${small.map(([id, ic, label, badge]) =>
        `<div class="menu-btn small-row" onclick="App.go('${id}')">${App.menuImg(ic, 28)}${label}${badge}</div>`).join('')}
    </div>
    <div class="card">
      <div class="kv"><span class="k">⚔ Мощь атаки</span><span class="v">${UI.fmtNum(m.power.atk)}</span></div>
      <div class="kv"><span class="k">🛡 Мощь обороны</span><span class="v">${UI.fmtNum(m.power.def)}</span></div>
      <div class="kv"><span class="k">🚚 Техники в бою</span><span class="v">${UI.fmtNum(m.power.unitTaken || 0)} / ${UI.fmtNum(m.capacity)}</span></div>
      ${m.power.secretTaken > 0 ? `<div class="kv"><span class="k">🛸 Секретные разработки в бою</span><span class="v gold">${UI.fmtNum(m.power.secretTaken)} (вне лимита)</span></div>` : ''}
      <div class="kv"><span class="k">Доход в час</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtMoney(m.incomePerHour)}</span></div>
      <div class="kv"><span class="k">🔧 Содержание в час</span><span class="v" style="color:var(--red)"><span class="ic-dollar"></span> ${UI.fmtMoney(m.upkeepPerHour)}</span></div>
      <div class="kv"><span class="k">⏱ Выплата через</span><span class="v">${UI.fmtTimer(m.nextPayoutSec)}</span></div>
    </div>
    <button class="btn" style="width:100%;margin-top:8px" onclick="App.go('support')">🛟 Служба поддержки</button>
    ${newsSectionHtml}`;

  // Обратный отсчёт таймера вызова на главном экране
  const lcgTimer = document.getElementById('lcg-timer');
  // Прошлый отсчёт гасим: главный экран перерисовывается часто, и каждая
  // отрисовка заводила ещё один секундный таймер. Мало того что они копились
  // — каждый на своём нуле дёргал App.rerender(), то есть десяток накопленных
  // таймеров устраивал экрану серию перерисовок подряд.
  if (App._lcgTimer) { clearInterval(App._lcgTimer); App._lcgTimer = null; }
  if (lcgTimer) {
    let secs = parseInt(lcgTimer.textContent) || 0;
    App._lcgTimer = setInterval(() => {
      if (!document.getElementById('lcg-timer')) {
        clearInterval(App._lcgTimer); App._lcgTimer = null; return;
      }
      secs--;
      if (secs <= 0) { clearInterval(App._lcgTimer); App._lcgTimer = null; App.rerender(); return; }
      lcgTimer.textContent = UI.fmtTimer(secs);
    }, 1000);
  }

  // Забрать награду-письмо прямо на главном экране
  c.querySelectorAll('[data-claim-reward]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const res = await API.post('/api/rewards/' + encodeURIComponent(btn.dataset.claimReward) + '/claim');
        UI.toast('🎁 Получено: ' + ((res.rewardText || []).join(', ') || 'награда'));
        await App.refreshMe();
        App.rerender();
      } catch (e) { btn.disabled = false; UI.toast('⛔ ' + e.message); }
    };
  });
};

// ---------- ПОРУЧЕНИЯ ШТАБА (хаб: ежедневные задания + контракты) ----------
App.screens.hq = async (c) => {
  await App.refreshMe();
  // Сводка по обоим разделам для бейджей
  // Счётчик «N осталось» убран: на узких экранах он выталкивал кнопки за
  // край. Оставляем только пометку о готовом бонусе — она короткая.
  let dailyBadge = '', contractBadge = '';
  try {
    const d = await API.get('/api/daily');
    dailyBadge = (d.allDone && !d.bonusClaimed) ? '<span class="badge green">бонус</span>' : '';
  } catch (e) {}
  try {
    const ct = await API.get('/api/contracts');
    const ready = (ct.contracts || []).filter((x) => x.done && !x.claimed).length;
    if (ready > 0) contractBadge = `<span class="badge green">${ready}</span>`;
  } catch (e) {}

  c.innerHTML = `
    <div class="title">🎖 Поручения штаба</div>
    <p class="muted small" style="margin:-4px 4px 12px">Задания от командования: ежедневные цели и боевые контракты. Выполняйте их — получайте награды.</p>
    <div class="menu-grid">
      <div class="menu-btn" onclick="App.go('daily')">${App.tabImg('daily', 26)}Ежедневные задания ${dailyBadge}</div>
      <div class="menu-btn" onclick="App.go('dailytasks')">${App.tabImg('contracts', 26)}Контракты ${contractBadge}</div>
    </div>`;
};

// ---------- ПРОФИЛЬ (свой или чужой: #profile/ид) ----------
// ---------- Контракты (боевые задания от штаба) ----------
App.screens.dailytasks = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/contracts');
  c.innerHTML = `
    <div class="title">📑 Контракты</div>
    <p class="muted small" style="margin:-4px 4px 10px">Боевые задания от штаба. Обновляются каждый день в 00:00 МСК. Выполняйте и забирайте награду.</p>
    ${d.contracts.length ? d.contracts.map((ct) => `
      <div class="card${ct.route && !ct.done ? ' quest-clickable' : ''}" ${ct.route && !ct.done ? `data-goto="${ct.route}"` : ''}>
        <div class="contract-head">
          ${ct.char ? App.instrImg(ct.char, 58) : ''}
          <div class="contract-head-info">
            <div class="name">${UI.esc(ct.name)} ${ct.claimed ? '<span class="badge">✅ выполнено</span>' : ''}</div>
            ${ct.charName ? `<div class="muted small">${UI.esc(ct.charName)}${ct.charRole ? ` · ${UI.esc(ct.charRole)}` : ''}</div>` : ''}
          </div>
        </div>
        <p class="muted small">${UI.esc(ct.desc)}</p>
        ${UI.bar(ct.current, ct.target, 'xp', `${ct.current} / ${ct.target}`)}
        <div class="kv mt"><span class="k">Награда</span><span class="v gold"><span class="ic-gold"></span> ${ct.reward}</span></div>
        ${ct.route && !ct.done ? '<div class="small quest-go">➜ Нажмите, чтобы перейти к выполнению</div>' : ''}
        ${!ct.claimed ? `<button class="btn btn-orange mt" data-claim="${ct.id}" ${ct.done ? '' : 'disabled'} style="width:100%">${ct.done ? 'Забрать награду' : 'Не выполнено'}</button>` : ''}
      </div>`).join('') : '<div class="card center muted">Заданий нет. Загляните позже.</div>'}`;
  c.querySelectorAll('[data-claim]').forEach((b) => b.onclick = async (ev) => {
    ev.stopPropagation(); // клик по кнопке не должен уводить на экран выполнения
    try { await API.post('/api/contracts/claim', { contractId: b.dataset.claim }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  // Клик по контракту — переход туда, где он выполняется
  c.querySelectorAll('[data-goto]').forEach((row) => {
    row.onclick = () => { location.hash = '#' + row.dataset.goto; };
  });
};

// ═══ Страница VIP-подписки ══════════════════════════════════════════
// Витрина преимуществ и состояние своей подписки. Список берём с
// сервера: там он рядом с самими механиками и не разъедется с ними.
// ═══ КАБИНЕТ: до трёх персонажей на аккаунт ═════════════════════════
App.screens.cabinet = async (c) => {
  c.innerHTML = '<div class="loading">Загружаю кабинет…</div>';
  let d = null;
  try { d = await API.get('/api/account'); }
  catch (e) { c.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

  const ago = (ms) => {
    if (!ms) return 'ещё не играл';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 5) return 'сейчас в игре';
    if (m < 60) return `${m} мин назад`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
  };

  c.innerHTML = `
    <div class="title">🎖 Мои персонажи</div>
    <div class="card">
      <p class="muted small">На один аккаунт можно создать до ${d.max} персонажей.
      Вход и почта у них общие — переключайтесь без ввода пароля.</p>
      <p class="muted small mt">⚠️ Персонажи одного аккаунта не воюют друг с другом,
      не шлют подкрепления и не разведывают: это было бы обманом остальных игроков.</p>
    </div>

    <div class="cab-grid">
      ${d.characters.map((ch) => `
        <div class="cab-card${ch.current ? ' cab-current' : ''}${ch.banned ? ' cab-banned' : ''}">
          <div class="cab-ava${ch.avatar ? ' has-photo' : ''}"
               ${ch.avatar ? `style="background-image:url(/img/avatars/${UI.esc(ch.avatar)}.webp)"` : ''}>
            ${ch.avatar ? '' : '<span class="cab-ava-stub">👤</span>'}
          </div>
          <div class="cab-body">
            <div class="cab-name">
              ${App._flagImg(ch.flag)} ${UI.esc(ch.name)}${App.vipMark(ch.vip)}
              ${ch.staffTag ? `<sup class="role-tag role-tag-${UI.esc(ch.staffTag)}">${UI.esc(ch.staffTag)}</sup>` : ''}
            </div>
            <div class="muted small">${UI.esc(ch.rank)} · ур. ${ch.level}</div>
            <div class="cab-rows">
              <div><span>Рейтинг</span><b>${UI.fmtNum(ch.rating)}</b></div>
              <div><span>Альянс</span><b>${ch.alliance ? UI.esc(ch.alliance) : '—'}</b></div>
              <div><span>Легион</span><b>${ch.legion ? UI.esc(ch.legion) : '—'}</b></div>
              <div><span><span class="ic-dollar"></span> Деньги</span><b class="money">${UI.fmtMoney(ch.dollars)}</b></div>
              <div><span><span class="ic-gold"></span> Золото</span><b class="gold">${UI.fmtNum(ch.gold)}</b></div>
            </div>
            <div class="muted small mt">${ago(ch.lastSeen)}</div>
            ${ch.banned ? '<div class="cab-ban">🚫 заблокирован</div>'
              : (ch.current
                ? '<div class="cab-here">Вы играете за него</div>'
                : `<button class="btn btn-orange mt" data-switch="${ch.id}" style="width:100%">Играть за него</button>`)}
          </div>
        </div>`).join('')}

      ${d.canCreate ? `
        <div class="cab-card cab-new" id="cab-create">
          <div class="cab-new-inner">
            <div class="cab-new-plus">＋</div>
            <div>Создать персонажа</div>
            <div class="muted small">осталось мест: ${d.max - d.characters.length}</div>
          </div>
        </div>` : ''}
    </div>`;

  c.querySelectorAll('[data-switch]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await API.post('/api/account/switch', { id: b.dataset.switch });
        API.setToken(r.token);
        UI.toast(`🔄 Вы играете за «${r.name}»`);
        await App.refreshMe();
        location.hash = '#home';
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); b.disabled = false; }
    };
  });

  const createBtn = document.getElementById('cab-create');
  if (createBtn) createBtn.onclick = () => App.showCreateCharacter();
};

App.screens.vip = async (c) => {
  c.innerHTML = '<div class="loading">Загружаю…</div>';
  let d = null;
  try { d = await API.get('/api/vip'); }
  catch (e) { c.innerHTML = `<div class="card"><p style="color:var(--red)">${UI.esc(e.message)}</p></div>`; return; }

  const until = d.until ? new Date(d.until).toLocaleDateString('ru-RU') : '';
  c.innerHTML = `
    <div class="title">VIP-подписка</div>

    <div class="card vip-head${d.active ? ' vip-head-on' : ''}">
      ${d.active ? `
        <div class="vip-head-title">👑 Подписка активна</div>
        <div class="muted small">Действует до ${until} · осталось ${d.daysLeft} дн.</div>
        <div class="vip-left mt">
          <div><b>${d.left.heal}</b><span>лечений</span></div>
          <div><b>${d.left.immunity}</b><span>уходов от фаталити</span></div>
          <div><b>${d.left.reroll}</b><span>замен поручений</span></div>
        </div>
        <p class="muted small mt">Счётчики обновляются в полночь по Москве.</p>
        ${d.canRenameFree ? '<p class="small mt">✏️ Доступна бесплатная смена позывного</p>' : ''}
      ` : `
        <div class="vip-head-title">👑 VIP-подписка</div>
        <p class="muted small mt">Двадцать преимуществ: меньше ожидания, больше лимитов,
        выгоднее экономика. Подписка не делает вас сильнее в бою — она экономит время.</p>
        <div class="vip-price mt">
          <span class="ic-gold"></span> <b>${UI.fmtNum(d.priceGold)}</b>
          <span class="muted">за ${d.priceDays} дней</span>
        </div>
        <button class="btn vip-buy mt" id="vip-buy">Купить VIP</button>
        <p class="muted small mt">У вас: <span class="ic-gold"></span> ${UI.fmtNum(d.myGold)}</p>
      `}
      ${d.active ? `
        <div class="vip-price mt"><span class="ic-gold"></span> <b>${UI.fmtNum(d.priceGold)}</b>
          <span class="muted">за ${d.priceDays} дней</span></div>
        <button class="btn vip-buy mt" id="vip-buy">Продлить подписку</button>` : ''}
    </div>

    <div class="card">
      <div class="name">Что входит</div>
      <div class="vip-list mt">
        ${(d.benefits || []).map((b) => {
          // Цифры выделяем золотым — по ним и читают выгоду
          const hl = (t) => UI.esc(t).replace(/(\d+[\d\s]*%?)/g, '<b class="vip-num">$1</b>');
          return `
          <div class="vip-item">
            <span class="vip-item-icon">${b.icon}</span>
            <div>
              <b class="vip-item-title">${hl(b.title)}</b>
              <div class="muted small vip-item-text">${hl(b.text)}</div>
            </div>
          </div>`; }).join('')}
      </div>
    </div>`;

  // Покупка подписки за золото
  const buyBtn = document.getElementById('vip-buy');
  if (buyBtn) buyBtn.onclick = async () => {
    const ok = await UI.confirm(
      `Оформить VIP-подписку на <b>${d.priceDays} дней</b> за <span class="ic-gold"></span> <b>${UI.fmtNum(d.priceGold)}</b>?` +
      `<br><span class="muted small">У вас сейчас: ${UI.fmtNum(d.myGold)} золота.` +
      `${d.active ? ' Дни прибавятся к текущей подписке.' : ''}</span>`,
      { title: 'VIP-подписка', icon: '👑', html: true, okText: 'Купить', cancelText: 'Отмена' });
    if (!ok) return;
    buyBtn.disabled = true;
    try {
      await API.post('/api/vip/buy', {});
      UI.toast('👑 Подписка оформлена');
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); buyBtn.disabled = false; }
  };
};

// ── Жалоба на игрока ──────────────────────────────────────────────
// Окно с причиной и описанием. Кнопка есть в профиле обидчика, поэтому
// «на кого» подставляется само — игроку не нужно вспоминать позывной.
// Заранее показываем остаток жалоб на сутки: лимит не должен всплывать
// сюрпризом уже после того, как человек написал текст.
App._reportPlayer = async (targetId, targetName, where) => {
  let info;
  try { info = await API.get('/api/reports/mine'); }
  catch (e) { UI.toast('⛔ ' + e.message); return; }
  if (info.left <= 0) {
    UI.toast(`⛔ Сегодня жалобы закончились (${info.dayLimit} в сутки). Лимит обновится завтра.`);
    return;
  }
  const old = document.getElementById('game-dialog');
  if (old) old.remove();
  const m = document.createElement('div');
  m.id = 'game-dialog';
  m.className = 'game-dialog-overlay';
  m.innerHTML = `
    <div class="game-dialog">
      <div class="game-dialog-icon">📨</div>
      <div class="game-dialog-title">Жалоба на «${UI.esc(targetName)}»</div>
      <div class="game-dialog-body">Выберите причину и коротко опишите, что произошло.
        Сотрудник увидит вашу жалобу и ответит уведомлением.</div>
      <select id="rp-reason" class="game-dialog-input">
        ${info.reasons.map((r) => `<option value="${UI.esc(r.id)}">${r.icon} ${UI.esc(r.label)}</option>`).join('')}
      </select>
      <textarea id="rp-text" class="game-dialog-input" rows="3" maxlength="500"
        placeholder="Что случилось, когда и где. Чем конкретнее — тем быстрее разберутся."></textarea>
      <div class="game-dialog-hint">Осталось жалоб сегодня: ${info.left} из ${info.dayLimit}.
        Ложные жалобы видны сотрудникам и портят доверие к следующим вашим сигналам.</div>
      <div class="game-dialog-actions">
        <button class="btn btn-orange" id="rp-ok">Отправить</button>
        <button class="btn btn-inline" id="rp-cancel">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  const release = UI._a11yDialog(m, m.querySelector('.game-dialog'), 'Жалоба на игрока');
  const close = () => { release(); m.remove(); };
  m.querySelector('#rp-cancel').onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector('#rp-ok').onclick = async () => {
    const reason = m.querySelector('#rp-reason').value;
    const text = m.querySelector('#rp-text').value.trim();
    if (text.length < 10) { UI.toast('⛔ Опишите подробнее: хотя бы 10 символов'); return; }
    m.querySelector('#rp-ok').disabled = true;
    try {
      await API.post('/api/reports/create', { targetId, reason, text, where: where || 'profile' });
      close();
    } catch (e) { UI.toast('⛔ ' + e.message); m.querySelector('#rp-ok').disabled = false; }
  };
};

App.screens.profile = async (c, param) => {
  const id = param || App.me.id;
  const { profile: p } = await API.get('/api/profile/' + encodeURIComponent(id));
  const own = p.id === App.me.id;

  const isBot = !!p.isBot;

  // Остаток блокировки: часы и минуты, без секунд и без таймера —
  // значение пересчитывается только при следующем открытии страницы
  const banLeftText = (until) => {
    if (!until) return 'бессрочно';
    const min = Math.max(0, Math.round((until - Date.now()) / 60000));
    const h = Math.floor(min / 60), m = min % 60;
    if (h >= 24) return `${Math.floor(h / 24)} дн ${h % 24} ч`;
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
  };
  // Плашка блокировки аккаунта — первым блоком профиля
  const banBanner = p.accountBan ? `
    <div class="pf-ban-banner">
      <div class="pf-ban-head">🚫 Аккаунт заблокирован</div>
      <div class="pf-ban-row"><span>Причина</span><b>${UI.esc(p.accountBan.reason)}</b></div>
      ${p.accountBan.byName ? `<div class="pf-ban-row"><span>Выдал</span><b>${UI.esc(p.accountBan.byName)}</b></div>` : ''}
      <div class="pf-ban-row"><span>Осталось</span><b class="pf-ban-left">${banLeftText(p.accountBan.until)}</b></div>
    </div>` : '';

  // Армия врага скрыта — рассекречивается разведкой (трофей «Спутник-шпион»).
  // Свои/открытые данные берём из p, разведданные по чужим — из p.spyIntel.
  const intel = p.spyIntel || null;
  const armyOpen = own || !p.hideArmy;
  const lockMsg = (what, hint) => `<p class="muted">🔒 ${what} скрыты.${hint ? ' ' + hint : ' Используйте «🛰 Разведку», чтобы рассекретить.'}</p>`;

  // --- Техника ---
  let unitsHtml;
  if (armyOpen) {
    unitsHtml = (!isBot && p.units && p.units.length)
      ? UI.imgGrid(p.units, 'units') : '<p class="muted">Ангар не разглашается.</p>';
  } else if (intel && intel.units) {
    unitsHtml = intel.units.length
      ? UI.imgGrid(intel.units, 'units') : '<p class="muted">Техники не обнаружено.</p>';
  } else {
    unitsHtml = lockMsg('Техника');
  }

  // --- Секретные разработки (сеткой картинок, kind='secret') ---
  let devsHtml;
  const secretItems = [];
  if (armyOpen) {
    if (!isBot) {
      for (const x of (p.secretDevs || [])) secretItems.push(x);
      if (p.superDevInfo) secretItems.push(p.superDevInfo);
    }
    devsHtml = secretItems.length ? UI.imgGrid(secretItems, 'secret') : '<p class="muted">Секретных разработок нет.</p>';
  } else if (intel && intel.secretDevs) {
    for (const x of (intel.secretDevs || [])) secretItems.push(x);
    if (intel.superDevInfo) secretItems.push(intel.superDevInfo);
    devsHtml = secretItems.length ? UI.imgGrid(secretItems, 'secret') : '<p class="muted">Секретных разработок не обнаружено.</p>';
  } else {
    devsHtml = lockMsg('Секретные разработки', intel ? 'Нужен «Спутник-шпион» 8+ ур.' : '');
  }

  // --- Постройки (доходные + оборонительные) ---
  let buildingsHtml;
  const bSource = armyOpen ? (!isBot && p.buildings ? p.buildings : null)
                           : (intel && intel.buildings ? intel.buildings : null);
  if (armyOpen && !bSource) {
    buildingsHtml = '<p class="muted">Постройки не разглашаются.</p>';
  } else if (!armyOpen && !bSource) {
    buildingsHtml = lockMsg('Постройки', intel ? 'Нужен «Спутник-шпион» 5+ ур.' : '');
  } else {
    const incomeB = bSource.filter((x) => x.kind === 'income');
    const defenseB = bSource.filter((x) => x.kind !== 'income');
    buildingsHtml = (!incomeB.length && !defenseB.length)
      ? '<p class="muted">Построек не обнаружено.</p>'
      : `${incomeB.length ? `<p class="small" style="margin:4px 0"><span class="ic-dollar"></span> Доходные</p>${UI.imgGrid(incomeB, 'buildings')}` : ''}
         ${defenseB.length ? `<p class="small" style="margin:10px 0 4px">🛡 Оборонительные (защита базы)</p>${UI.imgGrid(defenseB, 'buildings')}` : ''}`;
  }

  // --- Баннер разведданных (точность + свежесть) ---
  let intelBanner = '';
  if (!own && intel) {
    const acc = [`техника ${intel.accUnits}%`];
    if (intel.accBuild != null)  acc.push(`постройки ${intel.accBuild}%`);
    if (intel.accSecret != null) acc.push(`секретки ${intel.accSecret}%`);
    let fresh;
    if (intel.live && intel.liveUntil) {
      const leftH = Math.max(0, Math.floor((intel.liveUntil - Date.now()) / 3600000));
      fresh = `🟢 Live — данные в реальном времени, ещё ~${leftH} ч`;
    } else {
      const d = new Date(intel.at);
      fresh = `📅 Снимок от ${d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — мог устареть`;
    }
    intelBanner = `<div class="card" style="border-color:var(--gold)">
      <div class="name">🛰 Разведданные</div>
      <p class="muted small">Точность: ${acc.join(', ')}. Числа приблизительны — реальные значения в пределах ± по точности.</p>
      <p class="small">${fresh}</p>
    </div>`;
  }

  c.innerHTML = `
    ${banBanner}
    <div class="title">Личное дело</div>
    ${p.adminView ? '<div class="card" style="border-color:var(--gold);background:rgba(255,180,0,.06);padding:8px 12px;margin-bottom:8px"><b class="gold">👑 Обзор администратора</b><span class="muted small"> — техника, постройки и секретки видны без разведки.</span></div>' : ''}
    <div class="card pf-card ${p.profileBg ? UI.esc(p.profileBg) : ''}">
      <div class="pf2-head">
        <span class="pf2-name">${App._flagImg(p.flag,'mid')} ${UI.esc(p.name)}</span>${App.vipMark(p.vip)}
        ${p.staffRole ? `<sup class="role-tag role-tag-${p.staffRole}" title="${UI.esc(p.staffLabel || '')}">${UI.esc(p.staffTag || '')}</sup>` : ''}
        ${p.activeTitle ? `<span class="pf2-title">${UI.esc(p.activeTitle)}</span>` : ''}
        ${p.online ? '<span class="small" style="color:var(--green);font-weight:600">● Онлайн</span>' : '<span class="small muted">○ Не в сети</span>'}
      </div>
      <div class="pf2-meta">
        <span>Ур. <b>${p.level}</b></span>
        ${(p.alliance && p.alliance.members) ? `<span>Ал. <b>${p.alliance.members}</b></span>` : ''}
        <span>Рейтинг <b>${UI.fmtNum(p.rating)}</b></span>
      </div>
      <div id="status-box" class="pf2-status">
        <p class="small" style="font-style:italic;margin:0">${p.status ? UI.esc(p.status) : '<span class="muted">Статус не задан</span>'}</p>
        ${own ? '<a href="javascript:void 0" class="small pf2-edit-status" id="edit-status">редактировать статус</a>' : ''}
      </div>
      <div class="pf2-row">
        <div class="pf2-avatar-col">
          <div class="pf2-avatar ${!p.avatar && p.profileFrame ? UI.esc(p.profileFrame) : ''}"
               ${p.avatar ? `style="background-image:url(/img/avatars/${UI.esc(p.avatar)}.webp)"` : ''}>
            ${p.avatar ? '' : '<span class="pf2-avatar-stub">👤</span>'}
            <span class="pf-online-dot">${p.online ? '🟢' : '⚪'}</span>
          </div>
          ${own ? `<button class="btn btn-inline pf-avatar-change" id="pf-avatar-btn">${p.avatar ? '🖼 Сменить' : '🖼 Поставить'}</button>` : ''}
        </div>
        <div class="pf2-info">
          <div class="kv" style="padding:2px 0"><span class="k">Звание:</span><span class="v" style="color:var(--green);font-weight:700">${UI.esc(p.rank)}</span></div>
          <div class="pf2-stats-label">Статистика:</div>
          <div class="kv" style="padding:2px 0"><span class="k">победы</span><span class="v">${UI.fmtNum((p.battle.wins||0) + (p.battle.defWins||0))}</span></div>
          <div class="kv" style="padding:2px 0"><span class="k">поражения</span><span class="v">${UI.fmtNum((p.battle.losses||0) + (p.battle.defLosses||0))}</span></div>
          <div class="kv" style="padding:2px 0"><span class="k">убийства</span><span class="v">${UI.fmtNum(p.battle.fatalities||0)}</span></div>
          <div class="kv" style="padding:2px 0"><span class="k">смерти</span><span class="v">${UI.fmtNum(p.deathsCount||0)}</span></div>
        </div>
      </div>
      ${p.countryName ? `<div class="muted small mt">${App._flagImg(p.flag)} ${UI.esc(p.countryName)}: ${UI.esc(p.countryBonus || '')}</div>` : ''}
      ${p.legion ? `<div class="muted small">Легион: <b style="cursor:pointer;color:var(--gold)" onclick="App._showPublicLegion('${p.legion.id}')">🏰 ${UI.esc(p.legion.name)}</b> <span style="font-size:10px">(${p.legion.rankName || 'Боец'})</span></div>` : '<div class="muted small">Без легиона</div>'}
      ${own ? `
      <div class="pf2-vip${App.me.vip ? ' pf2-vip-active' : ''}">
        <div class="pf2-vip-note">${App.me.vip
          ? `👑 VIP активен · осталось ${Math.max(1, Math.ceil((App.me.vipUntil - Date.now()) / 86400000))} дн.`
          : 'Ощутите все преимущества и удобства игры!'}</div>
        <button class="btn pf2-vip-btn vip-buy" id="pf-vip">${App.me.vip ? 'Моя подписка' : 'Купить VIP'}</button>
        ${App.me.vip ? `
          <div class="pf2-vip-tools mt">
            <button class="btn btn-inline" id="pf-stats">📊 Полная статистика</button>
            <button class="btn btn-inline" id="pf-spied">🕵 Кто меня разведал</button>
            <button class="btn btn-inline" id="pf-rename">✏️ Сменить позывной</button>
          </div>` : ''}
        <a href="javascript:void 0" class="pf2-vip-more" id="pf-vip-more">Что даёт подписка</a>
      </div>
      ${p.power ? `
      <div class="pf2-be">
        <div class="pf2-be-title">Боевая эффективность:</div>
        <div class="pf2-be-grid">
          <span class="k">Атака</span><span class="pf2-be-val">${UI.fmtNum(p.power.atk)}</span><span class="k">Шанс крита</span><span class="pf2-be-val">${p.critChancePct} %</span>
          <span class="k">Защита</span><span class="pf2-be-val">${UI.fmtNum(p.power.def)}</span><span class="k">Шанс уворота</span><span class="pf2-be-val">${p.dodgeChancePct} %</span>
        </div>
      </div>` : ''}` : ''}
      ${!own && p.canAttack ? `<button class="btn btn-orange mt" id="pf-attack">⚔ Атаковать</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-spy">🔭 Разведка (шпионаж)</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-msg"><span class="ic-mail"></span> Написать сообщение</button>` : ''}
      ${!own ? `<button class="btn mt" id="pf-sanction" style="border-color:var(--red);color:var(--red)">🎯 Объявить санкции</button>` : ''}
      ${(!own && !isBot) ? `<button class="btn btn-inline mt" id="pf-report" style="width:100%">📨 Пожаловаться на игрока</button>` : ''}
      ${(!own && !isBot && App.me && App.me.staffRole) ? `
        <div class="pf-mod-block mt" id="pf-mod-block">
          <div class="pf-mod-title">🛡 Инструменты «Дозора»</div>
          <div class="muted small" id="pf-mod-status">Проверяю состояние…</div>
          <button class="btn mt" id="pf-chatban" style="width:100%">🔇 Блокировка чата</button>
          ${(App.me.staffZones || []).indexOf('moderation') >= 0
            ? `<button class="btn mt" id="pf-accban" style="width:100%">🚫 Блокировка аккаунта</button>`
            : ''}
        </div>` : ''}
      ${!own && !p.canAttack ? `<p class="muted small mt center">Цель вне диапазона ±10 уровней</p>` : ''}
      ${!own && App.me.alliance && App.me.alliance.leaderId === App.me.id && !p.alliance
        ? `<button class="btn btn-green mt" id="pf-invite-alliance">🤝 Пригласить в альянс «${UI.esc(App.me.alliance.name)}»</button>` : ''}
      ${!own && App.me.legion && App.me.legion.leaderId === App.me.id && !p.legion
        ? `<button class="btn btn-green mt" id="pf-invite-legion">🛡 Пригласить в легион «${UI.esc(App.me.legion.name)}»</button>` : ''}
    </div>

    ${own ? `
    <div class="card">
      <div class="title" style="margin-top:0">Разделы профиля</div>
      <div class="menu-grid">
        <div class="menu-btn small-row" onclick="App.go('skills')">${App.tabImg('profile_skills', 24)}Навыки ${App.me.skillPoints > 0 ? `<span class="badge">+${App.me.skillPoints}</span>` : ''}</div>
        <div class="menu-btn small-row" onclick="App.go('ach')">${App.tabImg('profile_ach', 24)}Достижения</div>
        <div class="menu-btn small-row" onclick="App.go('titles')">${App.tabImg('profile_titles', 24)}Титулы</div>
        <div class="menu-btn small-row" onclick="App.go('cosmetics')"><span class="ic">🎨</span>Внешний вид</div>
      </div>
    </div>` : ''}

    <div class="card">
      ${own ? `
      <div class="kv"><span class="k">📊 Опыт</span><span class="v">${UI.fmtNum(App.me.xp)} / ${UI.fmtNum(App.me.xpNext)}</span></div>
      <div class="mt">${UI.bar(App.me.xp, App.me.xpNext, 'xp', `До ${App.me.level + 1} уровня: ${UI.fmtNum(Math.max(0, App.me.xpNext - App.me.xp))} XP`)}</div>
      <hr class="hr">` : ''}
      <div class="kv"><span class="k">🚚 Вместимость армии</span><span class="v">${UI.fmtNum(p.capacity)}</span></div>
      ${p.isOwn ? `
      ${p.powerStats ? `<button class="btn mt" id="pf-stats-toggle" style="width:100%">📊 Подробная статистика</button>` : ''}` : ''}
      <hr class="hr">
      <div class="kv"><span class="k">Нападения</span><span class="v">${UI.fmtNum(p.battle.attacks)}</span></div>
      <div class="kv"><span class="k">Победы</span><span class="v">${UI.fmtNum((p.battle.wins||0) + (p.battle.defWins||0))}</span></div>
      <div class="kv"><span class="k">Поражения</span><span class="v">${UI.fmtNum((p.battle.losses||0) + (p.battle.defLosses||0))}</span></div>
      <div class="kv"><span class="k">Оборона: отбито / сдано</span><span class="v">${UI.fmtNum(p.battle.defWins)} / ${UI.fmtNum(p.battle.defLosses)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">💀 Фаталити</span><span class="v">${UI.fmtNum(p.battle.fatalities)}</span></div>
      <div class="kv"><span class="k"><span class="ic-ear"></span> Отрезанные уши (трофеи)</span><span class="v">${UI.fmtNum(p.ears)}</span></div>
      <div class="kv"><span class="k">🏷 Жетоны милосердия</span><span class="v">${UI.fmtNum(p.tokens)}</span></div>
      <div class="kv"><span class="k">Потеряно своих ушей</span><span class="v">${UI.fmtNum(p.earsLost)}</span></div>
      <div class="kv"><span class="k">Свои уши сейчас</span><span class="v">${p.earsCurrent} / ${p.earsMax}${p.earPenaltyActive ? ' <span style="color:var(--red)">⚠ штраф −10%</span>' : ''}</span></div>
      ${p.earCutInfo && p.earCutInfo.left ? `<div class="kv"><span class="k" style="color:var(--red)">✂️ Левое ухо у</span><span class="v"><a href="#" onclick="App.go('profile/${p.earCutInfo.left.id}');return false" style="color:var(--gold)">${UI.esc(p.earCutInfo.left.name)}</a></span></div>` : ''}
      ${p.earCutInfo && p.earCutInfo.right ? `<div class="kv"><span class="k" style="color:var(--red)">✂️ Правое ухо у</span><span class="v"><a href="#" onclick="App.go('profile/${p.earCutInfo.right.id}');return false" style="color:var(--gold)">${UI.esc(p.earCutInfo.right.name)}</a></span></div>` : ''}
      ${p.earMessage ? `<div style="margin-top:8px;padding:10px;border:1px solid var(--red);border-radius:8px;background:rgba(255,60,60,.08)"><div class="muted small">✍️ Послание от <a href="#" onclick="App.go('profile/${p.earMessage.byId}');return false" style="color:var(--gold)">${UI.esc(p.earMessage.byName)}</a>:</div><div style="margin-top:4px;font-style:italic">«${UI.esc(p.earMessage.text)}»</div></div>` : ''}
      ${own && p.earsCurrent < p.earsMax ? `<button class="btn btn-orange mt" id="pf-restore-ear" style="width:100%"><span class="ic-ear"></span> Восстановить ухо за <span class="ic-gold"></span> ${App.me.earRestoreCostGold || 20}</button>` : ''}
    </div>

    ${(p.activeEffects && p.activeEffects.length) ? `
    <div class="card">
      <div class="title" style="margin-top:0">✨ Активные эффекты</div>
      ${p.activeEffects.map(e => {
        const isMerc = !!(e.merc && e.commanderId);
        const img = isMerc ? App._mercImg(e.commanderId) : App._marketImg(e.id);
        const icon = e.hostile ? '😈' : isMerc ? '⭐' : '💉';
        // Имя показываем всегда для наёмника; для допинга — если нет картинки
        const showName = isMerc || !img;
        return `
        <div style="border-bottom:1px solid var(--border-dim);padding:8px 0">
          ${img ? `<img src="${img}" alt="${UI.esc(e.name)}" class="pf-effect-img" loading="lazy" decoding="async">` : ''}
          <div class="kv" style="padding:0">
            <span class="k" style="${e.hostile?'color:var(--red)':''}">${icon} ${showName ? UI.esc(e.name)+' ' : ''}<span class="muted small">(${UI.esc(e.desc)})</span>${e.byName?` <span class="muted small">— от <b style="color:var(--gold)">${UI.esc(e.byName)}</b></span>`:''}</span>
            <span class="v">${UI.esc(e.timeLeft)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}

    ${p.isOwn && p.powerStats ? `
    <div class="card" id="pf-stats-block" style="display:none">
      <div class="title" style="margin-top:0">📊 Подробная статистика мощи</div>

      <div class="kv"><span class="k">🚜 Наземная техника</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.ground.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.ground.def)} (${UI.fmtNum(p.powerStats.byCategory.ground.count)} ед.)</span></div>
      <div class="kv"><span class="k">✈ Воздушная техника</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.air.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.air.def)} (${UI.fmtNum(p.powerStats.byCategory.air.count)} ед.)</span></div>
      <div class="kv"><span class="k">🚢 Морская техника</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.sea.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.sea.def)} (${UI.fmtNum(p.powerStats.byCategory.sea.count)} ед.)</span></div>
      <div class="kv"><span class="k">🛸 Секретные разработки</span><span class="v">⚔ ${UI.fmtNum(p.powerStats.byCategory.secret.atk)} · 🛡 ${UI.fmtNum(p.powerStats.byCategory.secret.def)} (${UI.fmtNum(p.powerStats.byCategory.secret.count)} ед.)</span></div>

      ${p.powerStats.lines.length ? `
      <hr class="hr">
      <p class="small mt"><b>По каждой единице техники:</b></p>
      ${p.powerStats.lines.map((l) => `
        <div class="kv">
          <span class="k">${UI.esc(l.name)} <span class="muted small">×${UI.fmtNum(l.count)}</span></span>
          <span class="v small">⚔ ${UI.fmtNum(l.atkTotal)} · 🛡 ${UI.fmtNum(l.defTotal)}</span>
        </div>`).join('')}` : '<p class="muted small mt center">Техники нет.</p>'}

      ${p.powerStats.secretLines.length ? `
      <hr class="hr">
      <p class="small mt"><b>Секретные разработки:</b></p>
      ${p.powerStats.secretLines.map((l) => `
        <div class="secret-row">
          <div class="img-frame img-frame-row ${l.id === 'zero_judgement' ? 'img-frame-super' : ''}">
            <img src="/img/secret/${l.id}.webp" alt="${UI.esc(l.name)}" loading="lazy" decoding="async">
          </div>
          <div class="secret-row-info">
            <div class="secret-row-name">${UI.esc(l.name)}</div>
            <div class="muted secret-row-stats">⚔ ${UI.fmtNum(l.atkTotal)} · 🛡 ${UI.fmtNum(l.defTotal)}</div>
          </div>
          <div class="gold secret-row-count">×${UI.fmtNum(l.count)}</div>
        </div>`).join('')}` : ''}
    </div>` : ''}

    ${intelBanner}
    <div class="card"><div class="title" style="margin-top:0">Техника</div>${unitsHtml}</div>
    <div class="card"><div class="title" style="margin-top:0">Секретные разработки</div>${devsHtml}</div>
    <div class="card"><div class="title" style="margin-top:0">Постройки</div>${buildingsHtml}</div>`;

  // Редактирование собственного статуса
  if (own) {
    document.getElementById('edit-status').onclick = async () => {
      const text = await UI.prompt('', {title:'Новый статус', icon:'✍️', value:p.status||'', placeholder:'Ваш девиз...', multiline:true, maxLength:120, hint:'До 120 символов', okText:'Сохранить'});
      if (text === null) return;
      try {
        await API.post('/api/status', { text });
        App.rerender(); // перерисовать профиль
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const avBtn = document.getElementById('pf-avatar-btn');
    if (avBtn) avBtn.onclick = () => App._showAvatarPicker(p.avatar);
    // VIP: и кнопка, и ссылка ведут на страницу подписки
    const vipMore = document.getElementById('pf-vip-more');
    if (vipMore) vipMore.onclick = () => App.go('vip');
    const vipBtn = document.getElementById('pf-vip');
    if (vipBtn) vipBtn.onclick = () => App.go('vip');
  }

  // Разворачивание/сворачивание подробной статистики мощи
  // Инструменты подписки. Раньше они висели внутри ветки «чужой профиль»,
  // а показываются только в своём — обработчики не навешивались вовсе,
  // и кнопки не нажимались.
  const statsBtn = document.getElementById('pf-stats');
  if (statsBtn) statsBtn.onclick = () => App.showFullStats();
  const spiedBtn = document.getElementById('pf-spied');
  if (spiedBtn) spiedBtn.onclick = () => App.showSpiedBy();
  const renameBtn = document.getElementById('pf-rename');
  if (renameBtn) renameBtn.onclick = () => App.showRename();

  const statsToggle = document.getElementById('pf-stats-toggle');
  if (statsToggle) {
    statsToggle.onclick = () => {
      const block = document.getElementById('pf-stats-block');
      const opening = block.style.display === 'none';
      block.style.display = opening ? '' : 'none';
      statsToggle.textContent = opening ? '📊 Скрыть подробную статистику' : '📊 Подробная статистика';
      if (opening) block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  }

  const restoreEarBtn = document.getElementById('pf-restore-ear');
  if (restoreEarBtn) {
    restoreEarBtn.onclick = async () => {
      try {
        await API.post('/api/ears/restore');
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  // Атака из чужого профиля: бьём и уходим на экран войны с результатом
  if (!own && p.canAttack) {
    document.getElementById('pf-attack').onclick = async () => {
      try {
        App._lastBattle = await API.post('/api/war/attack', { targetId: p.id });
        await App.refreshMe();
        App.go('war');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }
  // Личное сообщение игроку
  if (!own) {
    // Инструменты «Дозора» в профиле игрока
    // ── Инструменты «Дозора» ──
    const modBlock = document.getElementById('pf-mod-block');
    if (modBlock) {
      const statusEl = document.getElementById('pf-mod-status');
      const chatBtn = document.getElementById('pf-chatban');
      const accBtn = document.getElementById('pf-accban');
      const refreshMod = async () => {
        try {
          const st = await API.get('/api/mod/chat-status/' + encodeURIComponent(p.id));
          const parts = [];
          if (st.banned) {
            parts.push(`<span class="wr-bad">🔇 Чат: ${UI.esc(st.scopeNames)}</span> · ${banLeftText(st.until)}`);
            chatBtn.textContent = '🔊 Снять блокировку чата';
            chatBtn.classList.add('btn-orange');
          } else {
            chatBtn.textContent = '🔇 Блокировка чата';
            chatBtn.classList.remove('btn-orange');
          }
          // Кнопки бана аккаунта у модератора нет вовсе — она не
          // отрисовывается, поэтому здесь просто проверяем её наличие
          if (accBtn) {
            if (st.account && st.account.banned) {
              parts.push(`<span class="wr-bad">🚫 Аккаунт заблокирован</span> · ${banLeftText(st.account.until)}`);
              accBtn.textContent = '✅ Разблокировать аккаунт';
              accBtn.classList.add('btn-orange');
            } else {
              accBtn.textContent = '🚫 Блокировка аккаунта';
              accBtn.classList.remove('btn-orange');
            }
          }
          if (!st.canBan) {
            statusEl.innerHTML = '<span class="muted">Сотрудник проекта — меры недоступны</span>';
            chatBtn.style.display = 'none';
            if (accBtn) accBtn.style.display = 'none';
            return;
          }
          chatBtn.style.display = '';
          if (accBtn) accBtn.style.display = '';
          statusEl.innerHTML = parts.length ? parts.join('<br>') : '<span class="muted">Нарушений не зафиксировано</span>';
        } catch (e) { statusEl.innerHTML = `<span class="muted">${UI.esc(e.message)}</span>`; }
      };
      refreshMod();
      if (chatBtn) chatBtn.onclick = async () => {
        await App.showChatBanDialog(p.id, p.name);
        setTimeout(refreshMod, 400);
      };
      if (accBtn) accBtn.onclick = async () => {
        await App.showAccountBanDialog(p.id, p.name);
        setTimeout(() => { refreshMod(); App.rerender(); }, 400);
      };
    }

    const btnSpy = document.getElementById('pf-spy');
    if (btnSpy) btnSpy.onclick = async () => {
      try {
        const r = await API.post('/api/spy', { targetId: p.id });
        await App.refreshMe();
        UI.toast(r.live
          ? '🛰 Спутник-шпион ведёт цель в реальном времени (3 дня)'
          : `🔭 Разведка проведена. Осталось бесплатной: ${r.spyLeft} (далее 🪙 20)`);
        App.rerender(); // перерисовать профиль — данные раскроются ниже
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };

    const btnMsg = document.getElementById('pf-msg');
    if (btnMsg) btnMsg.onclick = async () => {
      const text = await UI.prompt('', {title:'Письмо игроку ' + p.name, icon:'<span class="ic-mail"></span>', placeholder:'Ваше сообщение...', multiline:true, maxLength:500, okText:'Отправить'});
      if (!text || !text.trim()) return;
      API.post('/api/mail', { toName: p.name, subject: '', text })
        .then(() => UI.toast('✉ Сообщение отправлено игроку ' + p.name))
        .catch((e) => UI.toast('⛔ ' + e.message));
    };

    const btnSanction = document.getElementById('pf-sanction');
    if (btnSanction) btnSanction.onclick = async () => {
      const amountStr = await UI.prompt(`Награда из вашего кармана (минимум 1000 $). Деньги спишутся сразу. Кто снизит HP цели до ≤5% — заберёт награду.`, {title:`Санкция на ${p.name}`, icon:'🎯', type:'number', placeholder:'Сумма $', okText:'Далее'});
      if (amountStr === null) return;
      const amount = parseInt(String(amountStr).replace(/\D/g, ''), 10);
      if (!amount || amount < 1000) { UI.toast('⛔ Минимум 1000 $'); return; }
      if (!await UI.confirm(`Списать $${UI.fmtNum(amount)} и объявить санкцию на «${p.name}»?`, {title:'Подтверждение', icon:'🎯', okText:'Объявить', danger:true})) return;
      try {
        const r = await API.post('/api/sanctions/declare', { targetId: p.id, amount });
        await App.refreshMe();
        UI.toast(`🎯 Санкция объявлена! Награда за цель: $${UI.fmtNum(r.bounty)}`);
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  const btnReport = document.getElementById('pf-report');
  if (btnReport) btnReport.onclick = () => App._reportPlayer(p.id, p.name, 'profile');

  // Приглашения в альянс/легион (доступно лидерам соответствующих групп)
  const invite = (kind) => async () => {
    try {
      await API.post(`/api/group/${kind}/invite`, { userId: p.id });
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  const inv1 = document.getElementById('pf-invite-alliance');
  const inv2 = document.getElementById('pf-invite-legion');
  if (inv1) inv1.onclick = invite('alliance');
  if (inv2) inv2.onclick = invite('legion');
};

// ---------- НАВЫКИ ----------
App.screens.skills = async (c) => {
  await App.refreshMe();
  const m = App.me;
  // [id, лейбл, описание, сколько единиц даёт прокачка] — цена берётся
  // из m.skillCosts (приходит с сервера, всегда актуальна)
  const defs = [
    ['energy',  '<span class="ic-energy"></span> Энергия',     'Расходуется в миссиях. +10 к максимуму за прокачку.', 10],
    ['health',  '<span class="ic-health"></span> Здоровье',    'Ниже 25 — в бой нельзя. +10 к максимуму за прокачку.', 10],
    ['ammo',    '<span class="ic-ammo"></span> Боеприпасы', 'Сколько атак в запасе. +1 к максимуму.', 1],
    ['cruelty', '💀 Жестокость', '+0.5% к шансу крита и +0.5% к шансу фаталити (макс. 50% каждое).', 1],
    ['agility', '🏃 Ловкость',    '+0.5% к шансу увернуться от атаки и +0.5% ускользнуть от фаталити (макс. 50% каждое).', 1],
  ];

  const caps = m.skillCaps || {};
  // Есть ли что сбрасывать (хоть один навык вложен) — иначе кнопка сброса не нужна
  const anySpent = defs.some(([id]) => (m.skills[id] || 0) > 0);
  const resetCost = m.skillResetCost || 0;
  const resetLabel = resetCost > 0
    ? `Сбросить навыки — <span class="gold">${UI.fmtNum(resetCost)}</span> зол.`
    : `Сбросить навыки — <span class="gold">бесплатно</span>`;

  c.innerHTML = `
    <div class="title">Навыки</div>
    <div class="card center">Неиспользовано: <b class="gold">${m.skillPoints}</b> очков навыков
      <p class="muted small mt">+5 очков за каждый уровень и за прохождение конфликтов</p></div>
    ${defs.map(([id, name, desc, plus]) => {
      const cost = m.skillCosts[id];
      const cap = caps[id];
      const val = m.skills[id] || 0;
      const atCap = cap != null && val >= cap;
      // Значение: при наличии потолка показываем «текущее / потолок»
      const valHtml = cap != null
        ? `<span class="gold">${val}</span><span class="muted"> / ${cap}</span>`
        : `<span class="gold">${val}</span>`;
      // Кнопка: на потолке — «МАКС» (disabled), иначе покупка (disabled без очков)
      const btnHtml = atCap
        ? `<button class="btn btn-inline" disabled>МАКС</button>`
        : `<button class="btn btn-orange btn-inline" data-skill="${id}" ${m.skillPoints < cost ? 'disabled' : ''}>+${plus} за ${cost} оч.</button>`;
      return `
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div class="grow">
            <div class="name">${name} — ${valHtml}</div>
            <div class="muted small">${desc}</div>
          </div>
          ${btnHtml}
        </div>
      </div>`;
    }).join('')}
    ${anySpent ? `
    <div class="card center">
      <button class="btn btn-red" id="skill-reset" style="width:100%">${resetLabel}</button>
      <p class="muted small mt">Все вложенные очки вернутся — распределишь заново.${resetCost > 0 ? ' Каждый следующий сброс дороже вдвое.' : ' Первый сброс бесплатный.'}</p>
    </div>` : ''}`;

  c.querySelectorAll('[data-skill]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.post('/api/skill', { stat: btn.dataset.skill });
        await App.refreshMe();
        App.rerender(); // перерисовать с новыми значениями
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  const resetBtn = c.querySelector('#skill-reset');
  if (resetBtn) resetBtn.onclick = async () => {
    const priceText = resetCost > 0 ? `Это стоит ${UI.fmtNum(resetCost)} золота.` : 'Первый сброс — бесплатно.';
    const ok = await UI.confirm(
      `Сбросить все навыки и вернуть очки?\n${priceText}\nСледующий сброс будет дороже.`,
      { title: 'Сброс навыков', icon: '♻', okText: 'Сбросить', cancelText: 'Отмена', danger: true }
    );
    if (!ok) return;
    try {
      const r = await API.post('/api/skill/reset', {});
      await App.refreshMe();
      App.rerender();
      UI.toast(`♻ Возвращено ${r.refunded} очков.`);
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- БАНК ----------
App.screens.bank = async (c, param) => {
  await App.refreshMe();
  const m = App.me;
  const tab = param || 'storage';

  const tabs = `
    <div class="tabs">
      <div class="tab ${tab === 'storage' ? 'active' : ''}" onclick="location.hash='#bank/storage'">${App.tabImg('bank_vault', 20)}Хранилище</div>
      <div class="tab ${tab === 'reserve' ? 'active' : ''}" onclick="location.hash='#bank/reserve'"><span class="ic-reserve"></span> Резерв</div>
      <div class="tab ${tab === 'gold'    ? 'active' : ''}" onclick="location.hash='#bank/gold'">${App.tabImg('bank_gold', 20)}Купить золото</div>
    </div>`;

  if (tab === 'gold') {
    const data = await API.get('/api/payments/packages');
    const { orders } = await API.get('/api/payments/orders');
    c.innerHTML = `
      <div class="title">Банк · Покупка золота</div>
      ${tabs}
      <div class="card"><p class="muted small">Золото — премиум-валюта: ускоряет прокачку, открывает контейнеры на чёрном рынке, оплачивает услуги клуба офицеров. На крупных пакетах — бонусное золото.</p></div>
      ${!data.enabled ? `<div class="card center"><p class="muted">${UI.esc(data.note || 'Онлайн-оплата скоро будет доступна.')}</p></div>` : ''}
      ${data.packages.map((p) => `
        <div class="card">
          <div class="name">${UI.esc(p.label)} ${p.bonus ? `<span class="badge" style="background:var(--green)">${p.bonus}</span>` : ''}</div>
          <div class="kv mt"><span class="k"><span class="ic-gold"></span> ${UI.fmtNum(p.gold)} золота</span><span class="v gold">${p.priceRub} ₽</span></div>
          <button class="btn btn-orange mt" data-buy-pkg="${p.id}" style="width:100%">Купить</button>
        </div>`).join('')}
      ${orders.length ? `
        <div class="card">
          <div class="name">🧾 История заказов</div>
          ${orders.map((o) => `
            <div class="kv"><span class="k"><span class="ic-gold"></span> ${UI.fmtNum(o.gold)} · ${o.priceRub} ₽</span>
              <span class="v">${o.status === 'paid' ? '✅ оплачено' : o.status === 'pending' ? '⏳ ожидает' : '❌ ' + o.status}</span></div>`).join('')}
        </div>` : ''}`;
    c.querySelectorAll('[data-buy-pkg]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const r = await API.post('/api/payments/create', { packageId: btn.dataset.buyPkg });
          if (r.payUrl) { window.location.href = r.payUrl; }
          else { UI.toast('🛒 Заказ создан. Онлайн-оплата скоро будет доступна.'); App.rerender(); }
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });
    return;
  }

  if (tab === 'reserve') {
    const legionName = m.legion ? m.legion.name : null;
    c.innerHTML = `
      <div class="title">Банк · Резерв</div>
      ${tabs}
      <div class="card">
        <p class="muted small">Конвертируй доллары в <span class="ic-reserve"></span> РЕЗ для казны легиона.</p>
        <div class="kv mt"><span class="k">Курс</span><span class="v">1 000 <span class="ic-dollar"></span> = 1 <span class="ic-reserve"></span> РЕЗ</span></div>
        ${legionName
          ? `<div class="kv"><span class="k">Ваш легион</span><span class="v">${UI.esc(legionName)}</span></div>`
          : '<p class="muted small mt" style="color:var(--red)">⛔ Вы не состоите в легионе</p>'}
      </div>
      ${legionName ? `
      <div class="card">
        <label>Сумма (<span class="ic-dollar"></span>)</label>
        <div class="field-row mt">
          <input type="number" id="res-amt" min="1000" step="1000" placeholder="мин. 1 000 $">
          <button class="btn btn-orange btn-inline" id="res-go">Зарезервировать</button>
        </div>
        <p class="muted small mt">Деньги списываются из ваших наличных и поступают в казну легиона как <span class="ic-reserve"></span> РЕЗ.</p>
      </div>` : ''}`;
    if (legionName) {
      document.getElementById('res-go').onclick = async () => {
        try {
          await API.post('/api/bank/reserve', { dollars: document.getElementById('res-amt').value });
          await App.refreshMe();
          App.rerender();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
    }
    return;
  }

  // Вкладка «Хранилище»
  c.innerHTML = `
    <div class="title">Банк · Хранилище</div>
    ${tabs}
    <div class="card">
      <div class="kv"><span class="k">Наличные</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtNum(m.dollars)}</span></div>
      <div class="kv"><span class="k">В хранилище</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtNum(m.bank)}</span></div>
      <p class="muted small mt">При вложении снимается комиссия 10%. Деньги в хранилище нельзя ограбить.</p>
    </div>
    <div class="card">
      <label>Положить в хранилище</label>
      <div class="field-row">
        <input type="number" id="bk-dep" min="1" placeholder="Сумма">
        <button class="btn btn-orange btn-inline" id="bk-dep-go">Положить</button>
      </div>
      <label>Снять из хранилища</label>
      <div class="field-row">
        <input type="number" id="bk-wd" min="1" placeholder="Сумма">
        <button class="btn btn-inline" id="bk-wd-go">Снять</button>
      </div>
    </div>
    <div id="bank-history"></div>`;

  App._renderBankHistory();

  const op = (action, inputId) => async () => {
    try {
      await API.post('/api/bank', { action, amount: document.getElementById(inputId).value });
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  document.getElementById('bk-dep-go').onclick = op('deposit', 'bk-dep');
  document.getElementById('bk-wd-go').onclick  = op('withdraw', 'bk-wd');
};

// ---------- ИСТОРИЯ СЕЙФА ----------
// Уведомление говорит «вас вскрыли», а подробности — здесь: кто, когда
// и сколько унёс. Отдельным запросом, чтобы переключение вкладок не
// перезагружало весь экран банка.
App._bankHistTab = 'incoming';

App._renderBankHistory = async () => {
  const box = document.getElementById('bank-history');
  if (!box) return;
  let h;
  try { h = await API.get('/api/bank/history'); }
  catch (e) { box.innerHTML = ''; return; }
  if (!document.getElementById('bank-history')) return;   // экран сменился
  App._bankHist = h;

  const tab = App._bankHistTab === 'outgoing' ? 'outgoing' : 'incoming';
  const list = h[tab] || [];

  const row = (e) => {
    const mine = e.role === 'attack';
    const who = mine ? (e.targetName || '—') : (e.attackerName || '—');
    // Три исхода: унёс деньги, попался на сигнализации, не подобрал код
    const R = {
      stolen: mine
        ? `<span class="dmg-give">💰 украдено $${UI.fmtNum(e.stolen || 0)}</span>`
        : `<span class="dmg-take">💸 украдено $${UI.fmtNum(e.stolen || 0)}</span>`,
      alarm:  `<span style="color:var(--orange-1)">🚨 сигнализация — денег не унёс</span>`,
      failed: `<span class="muted">🔒 код не подобран</span>`,
    };
    return `
      <div class="bh-row">
        <div class="bh-main">
          <div class="bh-who">${mine ? '🔓 сейф ' : '🛡 взломщик '}<b>«${UI.esc(who)}»</b></div>
          <div class="bh-res">${R[e.outcome] || R.failed}</div>
          <div class="muted small">${UI.fmtDate(e.at)}</div>
        </div>
      </div>`;
  };

  const empty = tab === 'incoming'
    ? 'К вашему сейфу пока никто не подбирался.'
    : 'Вы ещё не пытались вскрывать чужие сейфы.';

  box.innerHTML = `
    <div style="font-weight:bold;margin:18px 4px 6px">🏦 История сейфа</div>
    <div class="tabs bh-tabs">
      <div class="tab bh-tab ${tab === 'incoming' ? 'active' : ''}" data-bhtab="incoming">🛡 По мне${h.incoming.length ? ` (${h.incoming.length})` : ''}</div>
      <div class="tab bh-tab ${tab === 'outgoing' ? 'active' : ''}" data-bhtab="outgoing">🔓 Мои взломы${h.outgoing.length ? ` (${h.outgoing.length})` : ''}</div>
    </div>
    ${list.length
      ? `<div class="card bh-list">${list.map(row).join('')}</div>`
      : `<div class="card center muted">${empty}</div>`}`;

  box.querySelectorAll('[data-bhtab]').forEach((t) => {
    t.onclick = () => { App._bankHistTab = t.dataset.bhtab; App._renderBankHistory(); };
  });
};

App.screens.settings = async (c) => {
  await App.refreshMe();
  const current = App.theme();
  const tab = App._settingsTab || 'app';

  // Согласия тянем только когда вкладка открыта: на остальных они не
  // нужны, а лишний запрос при каждом заходе в настройки — лишний.
  let consents = null;
  if (tab === 'consents') {
    try { consents = await API.get('/api/consents'); } catch (e) { consents = { items: [], error: e.message }; }
  }

  // Состояние второго фактора. Спрашиваем только у сотрудников — у
  // обычного игрока этой ручки нет, и запрос вернул бы отказ.
  let tfa = null;
  if (tab === 'account' && App.me && App.me.staffPanel) {
    try { tfa = await API.get('/api/2fa/status'); } catch (e) { tfa = null; }
  }

  const themeBtn = (id, name, desc) => `
    <div class="card">
      <div class="list-row" style="border:none;padding:0">
        <div class="grow">
          <div class="name">${name}${id === current ? ' <span class="badge green">активна</span>' : ''}</div>
          <div class="muted small">${desc}</div>
        </div>
        <button class="btn ${id === current ? '' : 'btn-orange'} btn-inline" data-theme="${id}" ${id === current ? 'disabled' : ''}>
          ${id === current ? 'Выбрана' : 'Включить'}
        </button>
      </div>
    </div>`;

  // ── Вкладка «Приложение»: установка иконки на главный экран + уведомления
  let appTabHtml = '';
  // Установка на главный экран
  if (App.isStandalone()) {
    appTabHtml += `<div class="card"><div class="name">📲 Иконка на главном экране</div>
      <p class="muted small mt">Игра уже запущена как установленное приложение ✔</p></div>`;
  } else if (App.canInstall()) {
    appTabHtml += `<div class="card"><div class="name">📲 Иконка на главном экране</div>
      <p class="muted small mt">Установите игру отдельной иконкой — будет открываться на весь экран, как приложение.</p>
      <button class="btn btn-orange mt" id="set-install" style="width:100%">Установить на главный экран</button></div>`;
  } else {
    appTabHtml += `<div class="card"><div class="name">📲 Иконка на главном экране</div>
      <p class="muted small mt">Установка недоступна в этом браузере. Откройте игру в Chrome (Android) или Safari (iPhone), либо воспользуйтесь меню браузера «Установить приложение / На экран Домой».</p></div>`;
  }
  // Уведомления
  if (!App.pushSupported()) {
    appTabHtml += `<div class="card"><div class="name">🔔 Уведомления</div>
      <p class="muted small mt">Этот браузер не поддерживает push-уведомления.${App.isIOS() && !App.isStandalone() ? ' На iPhone уведомления работают только после установки игры на главный экран.' : ''}</p></div>`;
  } else {
    const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'default';
    if (perm === 'granted') {
      appTabHtml += `<div class="card"><div class="name">🔔 Уведомления</div>
        <p class="muted small mt">Уведомления включены — вы получите сигнал об атаках, санкциях и событиях.</p>
        <button class="btn btn-red mt" id="set-push-off" style="width:100%">🔕 Выключить уведомления</button></div>`;
    } else if (perm === 'denied') {
      appTabHtml += `<div class="card"><div class="name">🔔 Уведомления</div>
        <p class="muted small mt">Уведомления запрещены в настройках браузера. Разрешите их в настройках сайта, чтобы получать сигналы об атаках и событиях.</p></div>`;
    } else {
      appTabHtml += `<div class="card"><div class="name">🔔 Уведомления</div>
        <p class="muted small mt">Включите уведомления, чтобы получать сигналы об атаках на вас, санкциях и важных событиях.</p>
        <button class="btn btn-orange mt" id="set-push-on" style="width:100%">🔔 Включить уведомления</button></div>`;
    }
  }

  // ── Вкладка «Оформление игры»: все темы
  const themesHtml = `
    <div class="card"><p class="muted small">Смена темы оформления. Изменения применяются сразу.</p></div>
    ${themeBtn('classic', '🎨 Классическая хаки', 'Тёмная зелень и хаки — стиль оригинальной игры.')}
    ${themeBtn('steel',   '⚙ Военная сталь',    'Тёмный металл с зернистостью и царапинами.')}
    ${themeBtn('cyber',   '⚡ Кибер-война',      'Футуристический HUD: неоновая бирюза, геометрия, glassmorphism.')}
    ${themeBtn('desert',  '☀ Пустынный фронт',   'Жёлтые пески, выгоревший камуфляж и солнечный жар.')}
    ${themeBtn('noir',    '🌑 Полуночный штаб',  'Мягкий чёрно-серый интерфейс без резких цветов — для глаз ночью.')}
    ${themeBtn('aurora',  '🌅 Аврора',           'Светлая молочно-бежевая тема: тёплый мягкий фон, приглушённые акценты, без резкого контраста.')}`;

  // ── Вкладка «Аккаунт»: смена пароля ────────────────────────────
  // Старый пароль подтверждает, что аккаунт свой; новый вводится дважды,
  // чтобы опечатка не заперла игрока снаружи.
  const accountHtml = `
    ${(App._world && App._world.test && App._world.test.on) ? '' : `
    <div class="card">
      <!-- Свёрнуто в две кнопки. Раньше здесь всегда были развёрнуты семь
           полей подряд, хотя логин и пароль меняют раз в год: экран
           настроек начинался с длинной формы, а всё остальное — тема,
           уведомления, согласия — оказывалось под ней.
           <details> вместо своего кода: раскрытие, доступность с
           клавиатуры и чтение с экрана работают сами. -->
      <details class="acc-fold">
        <summary class="acc-sum">🔑 Сменить пароль</summary>
        <p class="muted small mt">Введите текущий пароль для подтверждения, затем новый — дважды.
        Минимум 8 символов, буквы и цифры. После смены все остальные входы в аккаунт будут сброшены.</p>

        <label class="field-label">Текущий пароль</label>
        <input type="password" id="pw-old" class="field" placeholder="ваш нынешний пароль" autocomplete="current-password">

        <label class="field-label">Новый пароль</label>
        <input type="password" id="pw-new1" class="field" placeholder="минимум 8 символов" autocomplete="new-password">

        <label class="field-label">Новый пароль ещё раз</label>
        <input type="password" id="pw-new2" class="field" placeholder="повторите новый пароль" autocomplete="new-password">

        <div id="pw-hint" class="field-hint"></div>
        <button class="btn btn-orange mt" id="pw-go" style="width:100%">Сменить пароль</button>
      </details>

      <details class="acc-fold">
        <summary class="acc-sum">🔑 Сменить логин аккаунта</summary>
        <p class="muted small mt">Логин один на все ваши персонажи и не связан с их позывными.
        По нему вы входите в игру.${App.me && App.me.accountLogin ? ` Сейчас: <b>${UI.esc(App.me.accountLogin)}</b>` : ' Пока не задан — вход по почте или позывному.'}</p>
        <label class="field-label">Новый логин</label>
        <input type="text" id="al-new" class="field" maxlength="20" placeholder="4–20 символов, латиница и цифры">
        <label class="field-label">Текущий пароль</label>
        <input type="password" id="al-pass" class="field" placeholder="подтвердите паролем" autocomplete="current-password">
        <button class="btn mt" id="al-go" style="width:100%">Сменить логин</button>
      </details>
    </div>`}

    ${!tfa ? '' : `
    <div class="card">
      <div class="name">🔐 Второй фактор входа
        ${tfa.enabled ? '<span class="badge green">включён</span>'
          : '<span class="badge red">выключен</span>'}</div>
      ${tfa.enabled ? `
        <p class="muted small mt">Вход в игру и в панель требует код из приложения-аутентификатора.
        Осталось кодов восстановления: <b>${tfa.recoveryLeft != null ? tfa.recoveryLeft : '—'}</b>.</p>`
      : `
        <p class="muted small mt">Панель управления не откроется, пока второй фактор не включён.
        Это не прихоть: у сотрудника есть доступ к чужим аккаунтам, переписке и платежам, и одного
        украденного пароля для этого достаточно.</p>
        <p class="muted small mt">Подойдёт любое приложение, которое у вас уже есть: Google
        Authenticator, Яндекс.Ключ, Authy, 1Password. Ставить специальное не нужно.</p>
        <button class="btn btn-orange mt" id="tfa-start" style="width:100%">
          ${tfa.pending ? 'Показать ключ заново' : 'Подключить второй фактор'}</button>`}
      <div id="tfa-box"></div>
    </div>`}`;

  // ── Вкладка «Согласия» ─────────────────────────────────────────
  // Право отозвать согласие есть у каждого, но «напишите нам письмо»
  // формально законно и практически означает, что не отзовёт никто.
  // Здесь видно, что и когда принято, какой редакции, и всё
  // необязательное снимается кнопкой.
  const dt = (ms) => ms ? new Date(ms).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const consentsHtml = !consents ? '' : (consents.error
    ? `<div class="card"><p class="muted">Не удалось загрузить: ${UI.esc(consents.error)}</p></div>`
    : `
    ${(consents.needed || []).length ? `
      <div class="card" style="border-color:var(--orange-1)">
        <div class="name">📋 Требуется подтверждение</div>
        <p class="muted small mt">Вы регистрировались до того, как появились отдельные отметки, либо
        документ с тех пор изменился. Подтвердите ниже — это займёт минуту и ничего не меняет в игре.</p>
        <div class="muted small mt">${(consents.needed || []).map((x) => UI.esc(x.title)).join('<br>')}</div>
      </div>` : ''}
    <div class="card">
      <p class="muted small" style="margin:0">Здесь видно, что вы приняли при регистрации и когда.
      Обязательные согласия нужны, чтобы игра работала. Необязательные можно снять в любой момент —
      на игру это не влияет.</p>
    </div>
    ${(consents.items || []).map((it) => `
      <div class="card" data-consent="${UI.esc(it.id)}">
        <div class="list-row" style="border:none;padding:0;align-items:flex-start">
          <div class="grow">
            <div class="name">${it.given ? '✅' : '⬜'} ${UI.esc(it.title)}
              ${it.required ? '<span class="badge">обязательное</span>' : ''}</div>
            <div class="muted small mt">${UI.esc(it.about)}</div>
            <div class="muted small mt">
              ${it.given
                ? `Принято ${UI.esc(dt(it.at))}${it.version ? `, редакция ${UI.esc(it.version)}` : ''}`
                : (it.withdrawnAt ? `Отозвано ${UI.esc(dt(it.withdrawnAt))}` : 'Не давалось')}
              ${it.doc ? ` · <a href="${UI.esc(it.doc.url)}" target="_blank" rel="noopener">текст документа</a>` : ''}
            </div>
            ${it.stale ? '<div class="small mt" style="color:var(--orange-1)">Документ обновился — подтвердите заново</div>' : ''}
            ${it.id === 'public' && it.given && it.scope ? `
              <div class="muted small mt">Показывается:
                ${(consents.parts || []).filter((pt) => it.scope[pt.id]).map((pt) => UI.esc(pt.name)).join(', ') || '—'}</div>` : ''}
          </div>
          ${it.required
            ? (it.given && !it.stale ? '' : `
              <button class="btn btn-inline btn-orange"
                      data-consent-go="${UI.esc(it.id)}" data-on="1">Подтвердить</button>`)
            : `
            <button class="btn btn-inline ${it.given ? 'btn-red' : 'btn-orange'}"
                    data-consent-go="${UI.esc(it.id)}" data-on="${it.given ? '0' : '1'}">
              ${it.given ? 'Отозвать' : 'Дать'}
            </button>`}
        </div>
      </div>`).join('')}
    <div class="card">
      <div class="name">📄 Копия моих данных</div>
      <p class="muted small mt">Выгрузка того, что хранится о вашем аккаунте. Пароль и служебные
      токены не выгружаются — в читаемом виде их нет даже у нас.</p>
      <button class="btn mt" id="my-data" style="width:100%">Скачать копию данных</button>
    </div>
    <div class="card">
      <p class="muted small" style="margin:0">Вопросы по обработке данных и удалению аккаунта —
      через <a href="/privacy.html" target="_blank" rel="noopener">Политику</a>, раздел «Права субъекта».</p>
    </div>`);

  c.innerHTML = `
    <div class="title">Настройки</div>
    <div class="tabs">
      <div class="tab ${tab === 'app' ? 'active' : ''}" data-stab="app">Приложение</div>
      <div class="tab ${tab === 'account' ? 'active' : ''}" data-stab="account">Аккаунт</div>
      <div class="tab ${tab === 'consents' ? 'active' : ''}" data-stab="consents">Согласия</div>
      <div class="tab ${tab === 'appearance' ? 'active' : ''}" data-stab="appearance">Оформление игры</div>
    </div>
    ${tab === 'app' ? appTabHtml : tab === 'account' ? accountHtml : tab === 'consents' ? consentsHtml : themesHtml}
    ${(App.me && App.me.staffPanel && App.me.staffRole !== 'moderator') ? `
      <hr class="hr">
      <div class="card">
        <div class="name">🛡 Служебный доступ</div>
        <p class="muted small mt">Ваша роль: <b>${UI.esc(App.me.staffLabel || '')}</b>.
        Адрес панели виден только сотрудникам — запоминать его не нужно, открывайте отсюда.</p>
        <a class="btn btn-orange mt" href="${UI.esc(App.me.staffPanel)}" target="_blank" rel="noopener"
           style="width:100%;display:block;text-align:center;text-decoration:none">⚙️ Открыть панель управления</a>
      </div>` : ''}
    ${(App.me && App.me.staffRole === 'moderator') ? `
      <hr class="hr">
      <div class="card">
        <div class="name">🛡 Дозор</div>
        <p class="muted small mt">Ваши инструменты — в общем чате: рядом с каждым сообщением
        есть кнопка блокировки. Отдельная панель модератору не нужна.</p>
        <button class="btn btn-orange mt" style="width:100%" onclick="App.go('chat')">💬 Перейти в чат</button>
      </div>` : ''}
    <hr class="hr">
    <button class="btn btn-red" id="set-logout" style="width:100%">🚪 Выйти из аккаунта</button>`;

  // ── Обработчики смены пароля ────────────────────────────────────
  // Проверка на наличие полей, а не только на вкладку: в тестовом мире
  // смены логина и пароля нет вовсе — аккаунты там раздаёт владелец, и
  // сменивший пароль тестировщик просто потеряет выданный ему доступ.
  if (tab === 'account' && document.getElementById('pw-old')) {
    const oldI = document.getElementById('pw-old');
    const n1 = document.getElementById('pw-new1');
    const n2 = document.getElementById('pw-new2');
    const hint = document.getElementById('pw-hint');

    // Живая подсказка: совпадают ли новые пароли и годится ли пароль
    const validate = () => {
      const a = n1.value, b = n2.value;
      n1.classList.remove('field-bad', 'field-good');
      n2.classList.remove('field-bad', 'field-good');
      if (!a && !b) { hint.textContent = ''; hint.className = 'field-hint'; return; }
      if (a.length < 8) {
        hint.textContent = 'Новый пароль слишком короткий — нужно минимум 8 символов.';
        hint.className = 'field-hint field-hint-bad'; n1.classList.add('field-bad'); return;
      }
      if (!/[A-Za-zА-Яа-яЁё]/.test(a) || !/[0-9]/.test(a)) {
        hint.textContent = 'Пароль должен содержать и буквы, и цифры.';
        hint.className = 'field-hint field-hint-bad'; n1.classList.add('field-bad'); return;
      }
      if (b && a !== b) {
        hint.textContent = 'Пароли не совпадают.';
        hint.className = 'field-hint field-hint-bad'; n2.classList.add('field-bad'); return;
      }
      if (b && a === b) {
        hint.textContent = 'Пароли совпадают ✔';
        hint.className = 'field-hint field-hint-good';
        n1.classList.add('field-good'); n2.classList.add('field-good'); return;
      }
      hint.textContent = 'Повторите новый пароль во втором поле.';
      hint.className = 'field-hint';
    };
    [n1, n2].forEach((el) => { el.oninput = validate; });

    // Общий глаз на три поля убран: теперь кнопка появляется у КАЖДОГО
    // поля пароля сама (UI.watchPasswords), и рядом со старой они
    // выглядели как две одинаковые кнопки подряд — так и было на
    // «Текущем пароле».

    // Смена логина аккаунта. Пароль обязателен: логин — это вход,
  // и менять его по перехваченной сессии не должно быть можно.
  const alGo = document.getElementById('al-go');
  if (alGo) alGo.onclick = async () => {
    const login = (document.getElementById('al-new') || {}).value || '';
    const pass = (document.getElementById('al-pass') || {}).value || '';
    if (!login.trim()) return UI.toast('⛔ Введите новый логин');
    if (!pass) return UI.toast('⛔ Подтвердите паролем');
    alGo.disabled = true;
    try {
      await API.post('/api/account/login', { login: login.trim(), password: pass });
      UI.toast('🔑 Логин изменён');
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); alGo.disabled = false; }
  };

  const pwGo = document.getElementById('pw-go');
  if (pwGo) pwGo.onclick = async () => {
      if (!oldI.value) return UI.toast('⛔ Введите текущий пароль');
      if (n1.value !== n2.value) return UI.toast('⛔ Новые пароли не совпадают');
      try {
        const r = await API.post('/api/change-password', {
          oldPassword: oldI.value, newPassword: n1.value, newPassword2: n2.value,
        });
        // Сервер сбросил все сессии и выдал новый токен — сохраняем его,
        // иначе игрока выкинет на экран входа сразу после смены пароля
        if (r.token) API.setToken(r.token);
        oldI.value = n1.value = n2.value = '';
        validate();
        UI.toast('🔑 Пароль изменён. Другие входы в аккаунт сброшены.');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  }

  // ── Подключение второго фактора ───────────────────────────────
  // Раньше эта настройка жила ТОЛЬКО внутри панели управления. После
  // того как панель закрылась до включения второго фактора, получался
  // замкнутый круг: чтобы включить фактор, нужно войти в панель; чтобы
  // войти в панель, нужен включённый фактор. Поэтому настройка стоит
  // здесь — в личных настройках, куда сотрудник попадает как обычный
  // игрок.
  const tfaStart = document.getElementById('tfa-start');
  if (tfaStart) tfaStart.onclick = async () => {
    const box = document.getElementById('tfa-box');
    let d = null;
    try { d = await API.post('/api/2fa/setup', {}); }
    catch (e) { return UI.toast('⛔ ' + e.message); }
    // Без ключа показывать нечего, а обращение к d.secret уронило бы
    // экран целиком — человек остался бы с пустой страницей.
    if (!d || !d.secret) return UI.toast('⛔ Сервер не выдал ключ — попробуйте ещё раз');
    box.innerHTML = `
      <hr class="hr">
      <div class="name">Шаг 1 — добавьте запись в приложение</div>
      ${d.otpauth ? `
        <p class="muted small mt">С телефона проще всего так: нажмите ссылку — приложение-аутентификатор
        откроется само и добавит запись.</p>
        <a class="btn btn-orange mt" href="${UI.esc(d.otpauth)}" style="width:100%;display:block;
           text-align:center;text-decoration:none">Открыть в приложении</a>
        <p class="muted small mt">Не сработало (например, вы за компьютером) — введите ключ руками,
        в приложении это кнопка «ввести ключ»:</p>
      ` : '<p class="muted small mt">Введите этот ключ вручную (в приложении это кнопка «ввести ключ»):</p>'}
      <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;letter-spacing:2px;
                  padding:10px;border:1px solid var(--border);border-radius:8px;word-break:break-all">
        ${UI.esc(d.secret.replace(/(.{4})/g, '$1 ').trim())}</div>
      <button class="btn mt" id="tfa-copy" style="width:100%">Скопировать ключ</button>
      <p class="muted small mt">${d.digits} цифр, обновляется раз в ${d.step} секунд.</p>

      <div class="name mt">Шаг 2 — подтвердите кодом</div>
      <p class="muted small mt">Введите код, который приложение показывает прямо сейчас.
      Пока код не проверен, фактор <b>не включается</b> — так нельзя запереть себя опечаткой.</p>
      <input type="text" id="tfa-code" class="field" inputmode="numeric" autocomplete="one-time-code"
             maxlength="8" placeholder="123456"
             style="letter-spacing:6px;text-align:center;font-size:20px;
                    font-family:ui-monospace,Menlo,Consolas,monospace">
      <button class="btn btn-orange mt" id="tfa-on" style="width:100%">Включить</button>
      <p class="muted small mt">Код не подходит? Проверьте время на телефоне — коды считаются
      от часов, и расхождение больше минуты их ломает.</p>`;

    const cp = document.getElementById('tfa-copy');
    if (cp) cp.onclick = async () => {
      try { await navigator.clipboard.writeText(d.secret); UI.toast('📋 Ключ скопирован'); }
      catch (e) { UI.toast('⛔ Скопируйте вручную'); }
    };
    document.getElementById('tfa-on').onclick = async () => {
      const code = (document.getElementById('tfa-code').value || '').trim();
      if (!code) return UI.toast('⛔ Введите код из приложения');
      try {
        const r = await API.post('/api/2fa/enable', { code });
        // Коды восстановления показываются ОДИН раз. Уйти с экрана, не
        // сохранив их, — значит потерять единственный запасной путь при
        // утрате телефона, поэтому просто перерисовать нельзя.
        box.innerHTML = `
          <hr class="hr">
          <div class="name">🔑 Коды восстановления</div>
          <p class="muted small mt">Сохраните их сейчас — <b>больше они не покажутся</b>.
          Каждый работает один раз и заменяет код из приложения, если телефон потерян.</p>
          <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;line-height:2;
                      padding:10px;border:1px solid var(--gold);border-radius:8px">
            ${(r.recoveryCodes || []).map((x) => UI.esc(x)).join('<br>')}</div>
          <button class="btn mt" id="tfa-save" style="width:100%">Сохранить в файл</button>
          <button class="btn btn-orange mt" id="tfa-done" style="width:100%">Я сохранил коды</button>`;
        const sv = document.getElementById('tfa-save');
        if (sv) sv.onclick = () => {
          const blob = new Blob([(r.recoveryCodes || []).join('\n') + '\n'], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'коды-восстановления-альянс-генералов.txt';
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        };
        document.getElementById('tfa-done').onclick = () => App.rerender();
        UI.toast('🔐 Второй фактор включён');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  };

  // ── Кнопки согласий ───────────────────────────────────────────
  c.querySelectorAll('[data-consent-go]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-consent-go');
      const on = btn.getAttribute('data-on') === '1';
      btn.disabled = true;
      try {
        // Разрешение на публичный профиль без выбора категорий смысла не
        // имеет: включаем всё, а тонкую настройку игрок делает потом.
        const body = { id, on };
        if (id === 'public' && on) body.scope = { nick: true, flag: true, stats: true, ally: true };
        await API.post('/api/consents', body);
        App.rerender();
      } catch (e) { btn.disabled = false; UI.toast('⛔ ' + e.message); }
    };
  });

  const myData = document.getElementById('my-data');
  if (myData) myData.onclick = async () => {
    myData.disabled = true;
    try {
      const r = await API.get('/api/my-data');
      // Отдаём файлом, а не показываем на экране: копию данных человек
      // сохраняет себе, а не читает в браузере.
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'мои-данные-альянс-генералов.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      UI.toast('📄 Копия данных сохранена');
    } catch (e) { UI.toast('⛔ ' + e.message); }
    myData.disabled = false;
  };

  c.querySelectorAll('[data-stab]').forEach((btn) => {
    btn.onclick = () => { App._settingsTab = btn.dataset.stab; App.rerender(); };
  });
  c.querySelectorAll('[data-theme]').forEach((btn) => {
    btn.onclick = () => {
      App.setTheme(btn.dataset.theme);
      App.rerender(); // перерисовать экран, чтобы метка «активна» переехала
    };
  });
  const instBtn = document.getElementById('set-install');
  if (instBtn) instBtn.onclick = () => App.installApp();
  const pushOn = document.getElementById('set-push-on');
  if (pushOn) pushOn.onclick = () => App.enablePush();
  const pushOff = document.getElementById('set-push-off');
  if (pushOff) pushOff.onclick = () => App.disablePush();
  document.getElementById('set-logout').onclick = async () => {
    try { await API.post('/api/logout', { token: API.token() }); } catch (e) {}
    API.setToken(null);
    App.me = null;
    location.hash = '#auth';
  };
};

// ---------- ПОРУЧЕНИЯ: ЕЖЕДНЕВНЫЕ И НЕДЕЛЬНЫЕ ----------
// Два раздела с независимыми пулами, счётчиками и сроками сброса:
// дневные обнуляются в полночь UTC, недельные — в понедельник.
App.screens.daily = async (c) => {
  await App.refreshMe();
  const tab = App._questTab === 'weekly' ? 'weekly' : 'daily';
  const isWeekly = tab === 'weekly';
  const d = await API.get(isWeekly ? '/api/weekly' : '/api/daily');
  // Эндпоинты различаются только адресом — разметка ниже общая
  const acceptUrl = isWeekly ? '/api/weekly/accept' : '/api/daily/accept';
  const claimUrl  = isWeekly ? '/api/weekly/claim'  : '/api/daily/claim';
  const bonusUrl  = isWeekly ? '/api/weekly/bonus'  : '/api/daily/bonus';
  const resetText = isWeekly
    ? `Смена поручений через ~${d.resetInDays} дн.`
    : `Обнуление через ~${d.resetInHours} ч`;

  c.innerHTML = `
    <div class="title">🎯 Поручения штаба</div>
    <div class="tabs">
      <div class="tab ${!isWeekly ? 'active' : ''}" data-qtab="daily">Ежедневные</div>
      <div class="tab ${isWeekly ? 'active' : ''}" data-qtab="weekly">Недельные</div>
    </div>
    <div class="card center">
      <p class="muted small">${isWeekly
        ? `На этой неделе активно <b>${d.total}</b> особых поручений — лимиты и награды кратно выше дневных, за каждое дают ещё и золото.`
        : `Сегодня активно <b>${d.total}</b> поручений от заказчиков (меняются каждый день).`}
        Выполнено: <b>${d.doneCount} / ${d.total}</b> · ${resetText}</p>
      ${d.allDone && !d.bonusClaimed ? `
        <button class="btn btn-orange mt" id="daily-bonus">🎉 Забрать бонус за все: <span class="ic-gold"></span> ${d.bonusGold}</button>
      ` : d.bonusClaimed ? `
        <p class="small mt" style="color:var(--money)">✅ Бонус <span class="ic-gold"></span> ${d.bonusGold} за все поручения уже получен</p>
      ` : `
        <p class="small mt muted">Выполните все ${d.total} поручений — бонус <span class="ic-gold"></span> ${d.bonusGold}</p>
      `}
    </div>
    ${App.me && App.me.vip ? `
      <div class="vip-bulk">
        <span class="vip-mark">VIP</span>
        <button class="btn btn-inline" id="q-accept-all">📋 Принять все</button>
        <button class="btn btn-orange btn-inline" id="q-claim-all">✅ Сдать выполненные</button>
      </div>` : ''}
    ${(() => {
      const diffBadge = (df) => df === 'hard'
        ? '<span class="badge" style="background:var(--red)">сложное</span>'
        : df === 'medium' ? '<span class="badge" style="background:var(--orange-1)">среднее</span>'
        : '<span class="badge" style="background:var(--green)">простое</span>';
      // Группируем поручения по заказчику, сохраняя порядок появления
      const order = [];
      const groups = {};
      d.quests.forEach((q) => { if (!groups[q.char]) { groups[q.char] = []; order.push(q.char); } groups[q.char].push(q); });
      return order.map((cid) => {
        const g = groups[cid];
        const h = g[0];
        return `
          <div class="card">
            <div class="quest-giver">
              ${App.instrImg(h.char, 58)}
              <div class="grow">
                <div class="qg-name">${UI.esc(h.charName)}</div>
                <div class="qg-role">${h.charIcon} ${UI.esc(h.charRole)}</div>
                ${h.charIntro ? `<div class="qg-intro">«${UI.esc(h.charIntro)}»</div>` : ''}
              </div>
            </div>
            ${g.map((q) => `
              <div class="quest-row${q.route && q.accepted && !q.done ? ' quest-clickable' : ''}"
                   ${q.route && q.accepted && !q.done ? `data-goto="${q.route}"` : ''}
                   style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
                <div class="list-row" style="border:none;padding:0">
                  <div class="grow">
                    <div class="name">${q.char ? App.instrImg(q.char, 26) : q.icon} ${UI.esc(q.name)} ${diffBadge(q.difficulty)}</div>
                    <div class="muted small" style="font-style:italic;margin:2px 0 4px">«${UI.esc(q.flavor)}»</div>
                    <div class="small" style="margin-bottom:6px">Условие: <b>${UI.esc(q.name)}</b> — ${UI.fmtNum(q.target)} ${q.done ? '<span style="color:var(--money)">(выполнено)</span>' : ''}</div>
                    ${q.accepted
                      ? UI.bar(q.progress, q.target, 'xp', `${UI.fmtNum(q.progress)} / ${UI.fmtNum(q.target)}`)
                      : '<div class="muted small quest-not-accepted">Поручение не принято — прогресс не идёт</div>'}
                    <div class="small mt">Награда: +${UI.fmtNum(q.reward.xp)} XP, +<span class="ic-dollar"></span>${UI.fmtNum(q.reward.dollars)}${q.reward.gold ? `, <span class="ic-gold"></span> ${UI.fmtNum(q.reward.gold)}` : ''}</div>
                    ${q.route && q.accepted && !q.done ? '<div class="small quest-go">➜ Нажмите, чтобы перейти к выполнению</div>' : ''}
                  </div>
                  <div style="margin-left:8px">${q.claimed
                    ? `<span class="badge green">✅</span>`
                    : q.done
                      ? `<button class="btn btn-orange btn-inline" data-quest="${q.id}">Получить награду</button>`
                      : q.accepted
                        ? `<span class="muted small">в работе</span>`
                        : `<button class="btn btn-green btn-inline" data-accept="${q.id}">Принять</button>
                           ${(App.me && App.me.vip && !isWeekly) ? `<button class="btn btn-inline q-reroll" data-reroll="${q.id}" title="Заменить поручение (VIP)">🔄</button>` : ''}`}
                        ${(App.me.vip && !isWeekly && !q.claimed) ? `<button class="btn btn-inline" data-reroll="${q.id}" title="Заменить поручение">🔄</button>` : ''}</div>
                </div>
              </div>`).join('')}
          </div>`;
      }).join('');
    })()}`;

  // Принятие поручения: прогресс считается только с этого момента
  // VIP: массовые действия и замена
  const bulkAccept = document.getElementById('q-accept-all');
  if (bulkAccept) bulkAccept.onclick = async () => {
    bulkAccept.disabled = true;
    try { await API.post('/api/daily/accept-all', {}); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); bulkAccept.disabled = false; }
  };
  const bulkClaim = document.getElementById('q-claim-all');
  if (bulkClaim) bulkClaim.onclick = async () => {
    bulkClaim.disabled = true;
    try { await API.post('/api/daily/claim-all', {}); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); bulkClaim.disabled = false; }
  };
  c.querySelectorAll('[data-reroll]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      try { await API.post('/api/daily/reroll', { questId: btn.dataset.reroll }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  c.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      try {
        await API.post(acceptUrl, { questId: btn.dataset.accept });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  c.querySelectorAll('[data-quest]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation(); // не перехватывать переходом по заданию
      try {
        await API.post(claimUrl, { questId: btn.dataset.quest });
        await App.refreshMe();
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  // Клик по самому поручению — переход туда, где оно выполняется
  c.querySelectorAll('[data-goto]').forEach((row) => {
    row.onclick = () => { location.hash = '#' + row.dataset.goto; };
  });
  // Переключение разделов «Ежедневные» / «Недельные»
  // VIP: массовые действия одной кнопкой
  const aAll = document.getElementById('q-accept-all');
  if (aAll) aAll.onclick = async () => {
    try { await API.post('/api/daily/accept-all', {}); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  const cAll = document.getElementById('q-claim-all');
  if (cAll) cAll.onclick = async () => {
    try { await API.post('/api/daily/claim-all', {}); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  // VIP: замена поручения на другое
  c.querySelectorAll('[data-reroll]').forEach((b) => {
    b.onclick = async () => {
      if (!await UI.confirm('Заменить это поручение на другое?<br><span class="muted small">Прогресс по нему сбросится.</span>',
          { title: 'Замена поручения', icon: '🔄', html: true, okText: 'Заменить' })) return;
      try { await API.post('/api/daily/reroll', { questId: b.dataset.reroll }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });

  c.querySelectorAll('[data-qtab]').forEach((btn) => {
    btn.onclick = () => { App._questTab = btn.dataset.qtab; App.rerender(); };
  });
  const bonusBtn = document.getElementById('daily-bonus');
  if (bonusBtn) bonusBtn.onclick = async () => {
    try {
      await API.post(bonusUrl);
      await App.refreshMe();
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- СЛУЖБА ПОДДЕРЖКИ (обращения игрока) ----------
App.screens.support = async (c, param) => {
  await App.refreshMe();
  const tab = param || 'open'; // open | closed | new
  const data = await API.get('/api/support');

  const statusBadge = (s) => {
    if (s === 'open') return '<span class="badge" style="background:var(--orange-1)">ожидает ответа</span>';
    if (s === 'answered') return '<span class="badge" style="background:var(--green)">есть ответ</span>';
    return '<span class="badge">закрыто</span>';
  };

  const ticketCard = (t) => `
    <div class="card">
      <div class="name" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${UI.esc(t.subject)}</span> ${statusBadge(t.status)}
      </div>
      ${t.categoryLabel ? `<div class="muted small" style="margin-top:2px">Тема: ${UI.esc(t.categoryLabel)}</div>` : ''}
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
        ${t.messages.map((m) => `
          <div style="padding:8px 10px;border-radius:8px;background:${m.from === 'admin' ? 'rgba(60,180,90,.1)' : 'rgba(255,255,255,.03)'};border:1px solid ${m.from === 'admin' ? 'var(--green)' : 'var(--border)'}">
            <div class="muted small">${m.from === 'admin' ? '🛟 Поддержка' : '👤 ' + UI.esc(m.authorName)} · ${new Date(m.at).toLocaleString('ru-RU')}</div>
            <div style="margin-top:3px;white-space:pre-wrap">${UI.esc(m.text)}</div>
          </div>`).join('')}
      </div>
      ${t.status !== 'closed' ? `
        <div class="field-row mt">
          <input type="text" id="reply-${t.id}" placeholder="Добавить сообщение...">
          <button class="btn btn-orange btn-inline" data-reply="${t.id}">Отправить</button>
        </div>` : ''}
    </div>`;

  let body;
  if (tab === 'new') {
    const catOptions = (data.categories || []).map((cat) =>
      `<option value="${cat.id}">${cat.icon} ${UI.esc(cat.label)}</option>`).join('');
    body = `
      <div class="card">
        <div class="name">📝 Новое обращение</div>
        <p class="muted small">Выберите тему и опишите вопрос — администрация ответит здесь же.</p>
        <label class="small muted mt" style="display:block">Тема</label>
        <select id="sup-category" class="mt" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)">${catOptions}</select>
        <input type="text" id="sup-subject" maxlength="80" placeholder="Кратко: суть обращения" class="mt" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)">
        <textarea id="sup-text" maxlength="2000" rows="5" placeholder="Опишите ситуацию и проблему подробно..." class="mt" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);resize:vertical"></textarea>
        <button class="btn btn-orange mt" id="sup-send" style="width:100%">Отправить обращение</button>
      </div>`;
  } else {
    const list = tab === 'open' ? data.open : data.closed;
    body = list.length
      ? list.map(ticketCard).join('')
      : `<div class="card center muted">${tab === 'open' ? 'Нет открытых обращений' : 'Нет закрытых обращений'}</div>`;
  }

  c.innerHTML = `
    <div class="title">🛟 Служба поддержки</div>
    <div class="tabs">
      <div class="tab ${tab === 'open' ? 'active' : ''}" onclick="App.go('support/open')">Открытые (${data.open.length})</div>
      <div class="tab ${tab === 'closed' ? 'active' : ''}" onclick="App.go('support/closed')">Закрытые (${data.closed.length})</div>
      <div class="tab ${tab === 'new' ? 'active' : ''}" onclick="App.go('support/new')">➕ Новое</div>
    </div>
    ${body}`;

  const R = (id) => document.getElementById(id);
  if (R('sup-send')) R('sup-send').onclick = async () => {
    try {
      await API.post('/api/support/create', { category: R('sup-category') ? R('sup-category').value : 'other', subject: R('sup-subject').value, text: R('sup-text').value });
      UI.toast('✅ Обращение отправлено');
      App.go('support/open');
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-reply]').forEach((btn) => {
    btn.onclick = async () => {
      const inp = R('reply-' + btn.dataset.reply);
      if (!inp || !inp.value.trim()) return;
      try {
        await API.post('/api/support/reply', { ticketId: btn.dataset.reply, text: inp.value });
        App.rerender();
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
};

// ---------- МАГАЗИН ЗОЛОТА (заготовка платёжной системы) ----------
App.screens.shop = async (c) => {
  // «Магазин золота» переехал в Банк → Купить золото
  App.go('bank/gold');
};

// ========== НОВЫЕ СИСТЕМЫ ==========

// ---------- Ежедневный вход ----------
// ---------- Титулы ----------
App.screens.titles = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/titles');
  // Группируем титулы по достижению (achName)
  const groups = {};
  for (const t of d.list) {
    if (!groups[t.achName]) groups[t.achName] = [];
    groups[t.achName].push(t);
  }
  const unlockedCount = d.list.filter((t) => t.unlocked).length;
  c.innerHTML = `
    <div class="title">🏅 Титулы</div>
    <p class="muted small" style="margin:-4px 4px 10px">Титулы открываются за ступени достижений. Разблокировано: <b class="gold">${unlockedCount}</b> из ${d.list.length}. Выбранный отображается в профиле.</p>
    <div class="card">
      <button class="btn ${!d.active ? 'btn-orange' : ''}" data-title="" style="width:100%">Без титула</button>
    </div>
    ${Object.entries(groups).map(([achName, titles]) => `
      <div class="card">
        <div class="name">🎖 ${UI.esc(achName)}</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${titles.map((t) => `
            <div style="display:flex;align-items:center;gap:8px;${!t.unlocked ? 'opacity:.5' : ''}">
              <span style="flex:0 0 22px;text-align:center">${t.unlocked ? '🏅' : '🔒'}</span>
              <div style="flex:1">
                <div style="font-weight:bold;font-size:14px">${UI.esc(t.name)} ${d.active === t.id ? '<span class="badge">надет</span>' : ''}</div>
                <div class="muted small">Ступень ${t.step}/5 · нужно ${UI.fmtNum(t.target)}</div>
              </div>
              ${t.unlocked
                ? `<button class="btn btn-inline ${d.active === t.id ? 'btn-orange' : ''}" data-title="${t.id}">${d.active === t.id ? '✓' : 'Надеть'}</button>`
                : ''}
            </div>`).join('')}
        </div>
      </div>`).join('')}`;
  c.querySelectorAll('[data-title]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/titles/set', { titleId: b.dataset.title }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
};

// ---------- Рейтинговый сезон ----------
App.screens.season = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/season');
  App._seasonData = d;
  if (!App._seasonCat || !d.categories.some((x) => x.id === App._seasonCat)) {
    App._seasonCat = d.categories[0].id;
  }

  const fmtLeft = (ms) => {
    if (ms <= 0) return 'подведение итогов…';
    const dd = Math.floor(ms / 86400000);
    const hh = Math.floor((ms % 86400000) / 3600000);
    const mm = Math.floor((ms % 3600000) / 60000);
    return `${dd}д ${hh}ч ${mm}м`;
  };
  const val = (cat, v) => cat.money ? ('<span class="ic-dollar"></span>' + UI.fmtNum(v)) : UI.fmtNum(v);

  const renderCat = () => {
    const cat = d.categories.find((x) => x.id === App._seasonCat) || d.categories[0];
    const rw = d.rewards || [];
    const box = document.getElementById('season-body');
    if (!box) return;

    // Блок победителей — это ЗАВЕРШЁННАЯ неделя, отдельная от текущего топа.
    // Один и тот же игрок закономерно попадает в оба блока с разными
    // цифрами; подписываем неделю датами, чтобы это не читалось как дубль.
    const weekLabel = d.lastWeekId ? ` <span class="muted small">(${UI.esc(App._weekRange(d.lastWeekId))})</span>` : '';
    const winnersHtml = (cat.winners && cat.winners.length) ? `
      <div class="card" style="border-color:var(--gold)">
        <div class="name">🏆 Итоги прошлой недели${weekLabel}</div>
        <div class="muted small" style="margin:-2px 0 6px">Завершённый зачёт. Текущая неделя считается заново — ниже.</div>
        ${cat.winners.map((w, i) => `
          <div class="list-row">
            <div class="grow"><span class="rank-num">${i + 1}.</span>${['🥇','🥈','🥉'][i] ? ' ' + ['🥇','🥈','🥉'][i] : ''} <span class="name" onclick="App.go('profile/${w.id}')" style="cursor:pointer">${App._flagImg(w.flag)} ${UI.esc(w.name)}</span></div>
            <span class="gold">${val(cat, w.value)} ${cat.unit}</span>
          </div>`).join('')}
      </div>` : '';

    box.innerHTML = `
      <div class="card">
        <div class="kv"><span class="k">⏳ До конца недели</span><span class="v gold" id="season-timer">${fmtLeft(d.endsAt - Date.now())}</span></div>
        <div class="kv"><span class="k">${cat.icon} Ваш результат</span><span class="v">${val(cat, cat.myValue)} ${cat.unit}</span></div>
        <div class="kv"><span class="k">📍 Ваше место</span><span class="v">${cat.myRank ? '#' + cat.myRank : '—'}</span></div>
        <p class="muted small mt">Топ-3 в конце недели (вс 23:59 МСК) получают: 🥇 <span class="ic-gold"></span>${rw[0]?.gold}/<span class="ic-token"></span>${rw[0]?.tokens} · 🥈 <span class="ic-gold"></span>${rw[1]?.gold}/<span class="ic-token"></span>${rw[1]?.tokens} · 🥉 <span class="ic-gold"></span>${rw[2]?.gold}/<span class="ic-token"></span>${rw[2]?.tokens}. Затем метрики обнуляются.</p>
      </div>
      ${winnersHtml}
      <div class="card">
        <div class="title" style="margin-top:0">${cat.icon} Топ-20 · ${UI.esc(cat.name)}</div>
        ${cat.top.length ? cat.top.map((p, i) => `
          <div class="list-row" ${p.id === App.me.id ? 'style="background:rgba(255,180,0,.10);border-radius:8px;padding:4px 6px"' : ''}>
            <div class="grow"><span class="rank-num">${i + 1}.</span>${i < 3 ? ' ' + ['🥇','🥈','🥉'][i] : ''} <span class="name" onclick="App.go('profile/${p.id}')" style="cursor:pointer">${App._flagImg(p.flag)} ${UI.esc(p.name)}</span>${p.id === App.me.id ? ' <span class="gold small">(вы)</span>' : ''}</div>
            <span class="gold">${val(cat, p.value)}</span>
          </div>`).join('') : '<p class="muted center">Пока пусто — заработайте очки на этой неделе!</p>'}
      </div>`;

    // Активная кнопка подкатегории
    d.categories.forEach((x) => {
      const b = document.getElementById('scat-' + x.id);
      if (b) b.className = `btn btn-inline ${x.id === App._seasonCat ? 'btn-orange' : ''}`;
    });
  };

  c.innerHTML = `
    <div class="title">🏆 Рейтинговый сезон</div>
    <p class="muted small" style="margin:-4px 4px 10px">Еженедельные рейтинги (пн 00:00 — вс 23:59 МСК). В каждой категории свой топ-20; топ-3 получают награды, затем обнуление.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      ${d.categories.map((x) => `<button class="btn btn-inline ${x.id === App._seasonCat ? 'btn-orange' : ''}" id="scat-${x.id}">${x.icon} ${UI.esc(x.name)}</button>`).join('')}
    </div>
    <div id="season-body"></div>`;

  d.categories.forEach((x) => {
    document.getElementById('scat-' + x.id).onclick = () => { App._seasonCat = x.id; renderCat(); };
  });
  renderCat();

  // Живой таймер (самоочищается, когда экран сменился)
  if (App._seasonTimer) clearInterval(App._seasonTimer);
  App._seasonTimer = setInterval(() => {
    const el = document.getElementById('season-timer');
    if (!el) { clearInterval(App._seasonTimer); App._seasonTimer = null; return; }
    el.textContent = fmtLeft(d.endsAt - Date.now());
  }, 30000);
};

// ---------- Мировое событие (босс) ----------
App.screens.event = async (c) => {
  // Останавливаем прошлый поллинг события (если был)
  if (App._eventTimer) { clearInterval(App._eventTimer); App._eventTimer = null; }
  await App.refreshMe();
  const d = await API.get('/api/event');
  if (d.scheduled) {
    c.innerHTML = `
      <div class="title">🐉 Скоро событие</div>
      <div class="card center">
        <p style="font-size:40px">⏳</p>
        <p class="mt"><b class="gold" style="font-size:18px">${UI.esc(d.name)}</b></p>
        <p class="muted">Событие начнётся через:</p>
        <p style="font-size:28px;font-weight:bold;color:var(--orange)" id="event-countdown">${UI.fmtTimer(d.startsInSec)}</p>
        <p class="muted small">Значение обновится при следующем открытии экрана</p>
      </div>`;
    // Таймер СТАТИЧНЫЙ: значение считается один раз при открытии экрана.
    // Посекундное тиканье заставляло браузер перерисовывать страницу
    // каждую секунду и разряжало телефон, а точность до секунды здесь
    // не нужна. Экран сам обновится, когда событие начнётся.
    if (d.startsInSec > 0) {
      setTimeout(() => {
        if ((location.hash || '').replace(/^#/, '') === 'event') App.rerender();
      }, Math.min(d.startsInSec + 2, 3600) * 1000);
    }
    return;
  }
  if (!d.active) {
    // Нет активного события — показываем итоги прошлого, если они есть
    if (d.lastResult) {
      const lr = d.lastResult;
      const medal = (i) => ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
      c.innerHTML = `
        <div class="title">🏁 Итоги события</div>
        <div class="card center">
          <p style="font-size:34px">${lr.stopped ? '🛑' : '🏆'}</p>
          <p><b class="gold" style="font-size:17px">${UI.esc(lr.name)}</b></p>
          <p class="muted small">${lr.stopped ? 'Событие остановлено администратором' : 'Босс повержен!'}</p>
          ${lr.killerName ? `<p class="small">⚔️ Последний удар: <b>${UI.esc(lr.killerName)}</b></p>` : ''}
        </div>
        <div class="card">
          <div class="name">📊 Рейтинг участников</div>
          <p class="muted small">Урон по боссу и число атак каждого бойца.</p>
          <div style="margin-top:8px">
            ${lr.ranking.length ? lr.ranking.map((r, i) => `
              <div class="list-row">
                <div class="grow">${medal(i)} <span class="name">${UI.esc(r.name)}</span>
                  ${i < 3 && lr.rewards[i] > 0 ? `<span class="gold small"> +<span class="ic-gold"></span>${lr.rewards[i]}</span>` : ''}
                </div>
                <div style="text-align:right">
                  <div class="gold small">${UI.fmtNum(r.damage)} урона</div>
                  <div class="muted small">${r.attacks} ${r.attacks === 1 ? 'атака' : 'атак'}</div>
                </div>
              </div>`).join('') : '<p class="muted center">Никто не успел атаковать.</p>'}
          </div>
        </div>
        <p class="muted small center">Следующее событие запустит администратор.</p>`;
      return;
    }
    c.innerHTML = `
      <div class="title">🐉 Мировое событие</div>
      <div class="card center"><p style="font-size:40px">😴</p><p class="muted">Сейчас нет активного события. Следите за объявлениями!</p></div>`;
    return;
  }
  // Активное событие
  const dropInfo = (d.dropMax > 0 && d.goldPoolLeft > 0)
    ? `<span class="ic-gold"></span> ${d.dropMin}–${d.dropMax} с шансом ${d.dropChance}%`
    : 'пул исчерпан';
  const canAttack = App.me.res.am.cur > 0 && App.me.res.hp.cur >= 25;

  // Персональный лог атак (клиентский, у каждого игрока свой). Сбрасываем
  // при смене события, чтобы не смешивать лог разных боссов.
  if (App._eventLogKey !== d.name) { App._eventLogKey = d.name; App._eventLog = []; }
  const logHtml = (App._eventLog && App._eventLog.length)
    ? App._eventLog.map((l) => `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span class="muted small">${l.time}</span> <span class="small">${l.text}</span></div>`).join('')
    : '<p class="muted small center" style="padding:8px 0">Пока нет атак — ударьте по боссу!</p>';

  c.innerHTML = `
    <div class="title">🐉 ${UI.esc(d.name)}</div>
    <div class="card">
      ${d.image ? `<img class="boss-photo" src="${UI.esc(d.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="boss-say" id="boss-say">${(() => {
        // Сброс запомненной реплики при смене босса
        if (App._bossTauntFor !== d.name) { App._bossTaunt = null; App._bossTauntFor = d.name; }
        const say = App._bossTaunt || d.taunt;
        return say ? '«' + UI.esc(say) + '»' : '<span class="muted">Босс молчит… пока.</span>';
      })()}</div>
      <p class="muted small">Общий враг! Атакуйте босса — тратится боеприпас, как в обычном бою. Бейте сколько хватит патронов и здоровья. За атаки капает золото, а лучшие по урону и добивший получат награду.</p>
      <p class="muted small">⚠️ Босс бьёт в ответ: ${d.counterMin ?? 3}–${d.counterMax ?? 15} <span class="ic-health"></span> за каждую вашу атаку.</p>
      <div style="margin:10px 0">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
          <span class="muted"><span class="ic-health"></span> Здоровье босса</span><span id="boss-hp-text" style="font-weight:bold;color:var(--${d.hpPct > 50 ? 'green' : d.hpPct > 20 ? 'orange' : 'red'})">${UI.fmtNum(d.hp)} / ${UI.fmtNum(d.maxHp)} (${d.hpPct}%)</span>
        </div>
        <div style="height:14px;background:rgba(255,255,255,.08);border-radius:7px;overflow:hidden">
          <div id="boss-hp-bar" style="height:100%;width:${d.hpPct}%;background:linear-gradient(90deg,var(--red),var(--orange));transition:width .4s"></div>
        </div>
      </div>
      <div class="kv"><span class="k"><span class="ic-gold"></span> Золото за атаку</span><span class="v gold">${dropInfo}</span></div>
      <div class="kv"><span class="k">💰 Осталось в пуле</span><span class="v gold"><span class="ic-gold"></span> ${UI.fmtNum(d.goldPoolLeft)}</span></div>
      <div class="kv"><span class="k">🏆 Награда за добивание</span><span class="v gold"><span class="ic-gold"></span> ${UI.fmtNum(d.killReward)}</span></div>
      <div class="kv"><span class="k">🥇🥈🥉 Топ-3 по урону</span><span class="v gold"><span class="ic-gold"></span> ${d.top3.map((x) => UI.fmtNum(x)).join(' / ')}</span></div>
      <div class="kv"><span class="k">💥 Ваш урон / атак</span><span class="v">${UI.fmtNum(d.myDamage)} / ${d.myAttacks}</span></div>
      <div class="kv"><span class="k">👥 Участников</span><span class="v">${d.contributorsCount}</span></div>
      <button class="btn btn-orange mt" id="event-attack" style="width:100%">
        ${canAttack ? '⚔️ Атаковать босса (−1 🎯)' : (App.me.res.am.cur <= 0 ? 'Нет боеприпасов — купить?' : 'Здоровье ниже 25 — купить аптечку?')}
      </button>
    </div>
    <div class="card">
      <div class="name">🏆 Рейтинг по урону</div>
      <p class="muted small">Обновляется по мере атак. Топ-3 получат награду, добивший — бонус за килл.</p>
      <div style="margin-top:8px" id="boss-ranking">
        ${(d.ranking && d.ranking.length) ? d.ranking.map((r, i) => {
          const me = r.id === App.me.id;
          const place = i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.';
          return `<div class="list-row" style="${me ? 'background:rgba(255,180,0,.10);border-radius:8px;padding:4px 6px' : ''}">
            <div class="grow">${place} <span class="name" onclick="App.go('profile/${r.id}')" style="cursor:pointer">${UI.esc(r.name)}</span>${me ? ' <span class="gold small">(вы)</span>' : ''}</div>
            <div style="text-align:right">
              <div class="gold small">${UI.fmtNum(r.damage)} урона</div>
              <div class="muted small">${r.attacks} ${r.attacks === 1 ? 'атака' : 'атак'}</div>
            </div>
          </div>`;
        }).join('') : '<p class="muted center small" style="padding:8px 0">Пока никто не атаковал — станьте первым!</p>'}
      </div>
      ${d.myRank > 20 ? `<hr class="hr"><p class="muted small center">Вы вне топ-20 · место ${d.myRank}: <b class="gold">${UI.fmtNum(d.myDamage)}</b> урона</p>` : ''}
    </div>
    <div class="card">
      <div class="name">📜 Лог ваших атак</div>
      <div id="event-log" style="margin-top:6px;max-height:240px;overflow-y:auto">${logHtml}</div>
    </div>`;
  const btn = document.getElementById('event-attack');
  const doEventAttack = async () => {
    try {
      const r = await API.post('/api/event/attack');
      // Ответный удар босса — дописываем к строке лога
      const back = r.counterDamage > 0
        ? ` · <span style="color:var(--red)">−${r.counterDamage} <span class="ic-health"></span></span>` : '';
      // Запись в персональный лог атак (у каждого игрока свой)
      const text = r.finished
        ? `🏆 <b>Добивание!</b> Урон ${UI.fmtNum(r.dealtDamage)}${r.crit ? ' <span class="gold">🔥КРИТ</span>' : ''} — босс повержен${r.killReward > 0 ? `, награда <span class="ic-gold"></span>${r.killReward}` : ''}`
        : `💥 Урон <b>${UI.fmtNum(r.dealtDamage)}</b>${r.crit ? ' <span class="gold">🔥КРИТ</span>' : ''}${back}${r.goldDrop > 0 ? ` · выпало <span class="ic-gold"></span>${r.goldDrop}` : ''}`;
      // Босс огрызается новой фразой сразу после удара. Запоминаем её в
      // App._bossTaunt, иначе следующий rerender() запросит /api/event и
      // подставит ДРУГУЮ случайную фразу — визуально это выглядело как
      // «две фразы подряд перебивают друг друга».
      if (r.taunt) {
        App._bossTaunt = r.taunt;
        const sayEl = document.getElementById('boss-say');
        if (sayEl) sayEl.innerHTML = '«' + UI.esc(r.taunt) + '»';
      }
      const entry = { time: new Date().toLocaleTimeString('ru-RU'), text };
      if (!App._eventLog) App._eventLog = [];
      App._eventLog.unshift(entry);
      if (App._eventLog.length > 50) App._eventLog.length = 50;
      // Мгновенно показываем строку в логе (ещё до перерисовки экрана)
      const logEl = document.getElementById('event-log');
      if (logEl) {
        const row = `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span class="muted small">${entry.time}</span> <span class="small">${entry.text}</span></div>`;
        if (App._eventLog.length === 1) logEl.innerHTML = row;       // убрать плейсхолдер
        else logEl.insertAdjacentHTML('afterbegin', row);
      }
      // Сверху — ТОЛЬКО уведомление о выпавшем золоте
      if (r.finished) {
        // Я нанёс последний удар — событие завершено на сервере. Сразу
        // показываем итоговый экран, не дожидаясь поллинга.
        if (App._eventTimer) { clearInterval(App._eventTimer); App._eventTimer = null; }
        UI.toast('🏆 Босс повержен! Последний удар — ваш!');
        await App.refreshMe(); App.rerender();
        return;
      }
      if (r.goldDrop > 0) UI.toast(`🪙 Выпало золото: ${UI.fmtNum(r.goldDrop)}!`);
      await App.refreshMe(); App.rerender();
    } catch (e) {
      // Нет боеприпасов/здоровья — предложить покупку с рынка и повторить атаку
      if (/боеприпас/i.test(e.message)) {
        if (await _offerRestore('ammo')) return doEventAttack();
        return;
      }
      if (/подлечитесь|здоровье/i.test(e.message)) {
        if (await _offerRestore('health')) return doEventAttack();
        return;
      }
      UI.toast('⛔ ' + e.message);
    }
  };
  if (btn) btn.onclick = doEventAttack;

  // Живой поллинг активного события: обновляем HP/рейтинг, а если босс повержен
  // (кем угодно) или событие остановлено админом — сразу показываем итог, не
  // заставляя игрока обновлять страницу (раньше окно «зависало»).
  App._eventTimer = setInterval(async () => {
    if (location.hash.replace(/^#/, '') !== 'event') { clearInterval(App._eventTimer); App._eventTimer = null; return; }
    let dd;
    try { dd = await API.get('/api/event'); } catch (e) { return; }
    if (!dd.active) { clearInterval(App._eventTimer); App._eventTimer = null; App.rerender(); return; }
    // Частичное обновление (не сбивая фокус с кнопки атаки)
    const hpText = document.getElementById('boss-hp-text');
    const hpBar = document.getElementById('boss-hp-bar');
    if (hpText) { hpText.textContent = `${UI.fmtNum(dd.hp)} / ${UI.fmtNum(dd.maxHp)} (${dd.hpPct}%)`; hpText.style.color = `var(--${dd.hpPct > 50 ? 'green' : dd.hpPct > 20 ? 'orange' : 'red'})`; }
    if (hpBar) hpBar.style.width = dd.hpPct + '%';
    const rankEl = document.getElementById('boss-ranking');
    if (rankEl && dd.ranking) {
      rankEl.innerHTML = dd.ranking.length ? dd.ranking.map((r, i) => {
        const me = r.id === App.me.id;
        const place = i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.';
        return `<div class="list-row" style="${me ? 'background:rgba(255,180,0,.10);border-radius:8px;padding:4px 6px' : ''}"><div class="grow">${place} <span class="name" onclick="App.go('profile/${r.id}')" style="cursor:pointer">${UI.esc(r.name)}</span>${me ? ' <span class="gold small">(вы)</span>' : ''}</div><div style="text-align:right"><div class="gold small">${UI.fmtNum(r.damage)} урона</div><div class="muted small">${r.attacks} ${r.attacks === 1 ? 'атака' : 'атак'}</div></div></div>`;
      }).join('') : '<p class="muted center small" style="padding:8px 0">Пока никто не атаковал — станьте первым!</p>';
    }
  }, 3000);
};

// ---------- Реферальная система ----------
App.screens.referral = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/referral');
  c.innerHTML = `
    <div class="title">🎁 Пригласить друга</div>
    <div class="card center">
      <p class="muted small">Поделитесь кодом. Когда друг введёт его — он сразу получит <span class="ic-gold"></span> ${d.inviteeGold}, а вы получите награду, когда он достигнет 50 уровня, и 10% золотом от всех его покупок золота!</p>
      <p style="font-size:26px;letter-spacing:3px;font-weight:bold;margin:10px 0" class="gold">${d.code}</p>
      <button class="btn btn-orange" id="ref-copy" style="width:100%">📋 Скопировать код</button>
    </div>
    <div class="card">
      <div class="kv"><span class="k">Приглашено друзей</span><span class="v gold">${d.refCount}</span></div>
      <div class="kv"><span class="k">Заработано с покупок друзей</span><span class="v gold"><span class="ic-gold"></span> ${UI.fmtNum(d.refEarnings)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">🎁 Другу за ввод кода</span><span class="v"><span class="ic-gold"></span> ${d.inviteeGold}</span></div>
      <div class="kv"><span class="k">🏅 Вам за 50 уровень друга</span><span class="v"><span class="ic-gold"></span> ${d.level50Reward} + <span class="ic-token"></span> ${d.level50Tokens}</span></div>
      <div class="kv"><span class="k">💰 Вам с покупок друга</span><span class="v">${d.purchaseSharePct}% золотом</span></div>
    </div>
    ${d.canApply ? `
      <div class="card">
        <div class="name">Ввести чужой код</div>
        <p class="muted small">Если вас пригласили — введите код приглашающего (один раз, до 50 уровня).</p>
        <div class="field-row mt">
          <input type="text" id="ref-input" placeholder="Код друга" style="text-transform:uppercase">
          <button class="btn btn-orange btn-inline" id="ref-apply">Применить</button>
        </div>
      </div>` : (d.referredBy ? '<div class="card center muted">Вы уже использовали реферальный код.</div>' : '<div class="card center muted">Ввод кода доступен только до 50 уровня.</div>')}`;
  document.getElementById('ref-copy').onclick = () => {
    navigator.clipboard?.writeText(d.code).then(() => UI.toast('📋 Код скопирован')).catch(() => UI.toast('Код: ' + d.code));
  };
  const apply = document.getElementById('ref-apply');
  if (apply) apply.onclick = async () => {
    const code = document.getElementById('ref-input').value.trim();
    if (!code) { UI.toast('Введите код'); return; }
    try { await API.post('/api/referral/apply', { code }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- Косметика профиля ----------
App.screens.cosmetics = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/cosmetics');
  const frames = d.items.filter((x) => x.type === 'frame');
  const bgs = d.items.filter((x) => x.type === 'bg');
  const renderItem = (x) => `
    <div class="card">
      <div class="name">${UI.esc(x.name)} ${(x.type === 'frame' ? d.activeFrame : d.activeBg) === x.id ? '<span class="badge">надето</span>' : ''}</div>
      ${x.owned
        ? `<button class="btn ${(x.type === 'frame' ? d.activeFrame : d.activeBg) === x.id ? 'btn-orange' : ''} mt" data-equip="${x.id}" style="width:100%">${(x.type === 'frame' ? d.activeFrame : d.activeBg) === x.id ? 'Снять' : 'Надеть'}</button>`
        : `<button class="btn btn-orange mt" data-buy-cos="${x.id}" style="width:100%">Купить за <span class="ic-gold"></span> ${x.priceGold}</button>`}
    </div>`;
  c.innerHTML = `
    <div class="title">🎨 Внешний вид</div>
    <p class="muted small" style="margin:-4px 4px 10px">Рамки и фоны для вашего профиля. Чистая косметика — на силу не влияет.</p>
    <div class="card"><div class="name">🖼 Рамки профиля</div></div>
    ${frames.map(renderItem).join('')}
    <div class="card"><div class="name">🌆 Фоны профиля</div></div>
    ${bgs.map(renderItem).join('')}`;
  c.querySelectorAll('[data-buy-cos]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/cosmetics/buy', { id: b.dataset.buyCos }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  c.querySelectorAll('[data-equip]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.equip;
    const item = d.items.find((x) => x.id === id);
    const isActive = (item.type === 'frame' ? d.activeFrame : d.activeBg) === id;
    try {
      if (isActive) await API.post('/api/cosmetics/unequip', { type: item.type });
      else await API.post('/api/cosmetics/equip', { id });
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  });
};
