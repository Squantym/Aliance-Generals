// ===================================================================
// public/js/screens/social.js — социальные разделы
// Альянс и легион работают через универсальный /api/group/:kind, а
// клановая логика легиона (казна, постройки, войны) — через /api/legion.
// ===================================================================

// ---------- УНИВЕРСАЛЬНЫЙ ЭКРАН ГРУППЫ ----------
async function renderGroupScreen(c, kind) {
  await App.refreshMe();
  const data = await API.get('/api/group/' + kind);
  const label = kind === 'legion' ? 'Легион' : 'Альянс';
  const me = App.me;

  // Игрок состоит в группе — показываем штаб
  if (data.mine) {
    const g = data.mine;

    const bonusHint = kind === 'alliance'
      ? `Каждый новый боец альянса даёт +10 единиц техники в бой КАЖДОМУ участнику. Сейчас в бой берёте: <b class="gold">${UI.fmtNum(me.capacity)}</b>.`
      : `Легион — это клан. Бойцы получают пассивные бонусы от клановых построек и сражаются вместе в кланвойнах.`;

    // Клановая панель только у легиона
    let legionPanel = '';
    if (kind === 'legion') {
      const lg = await API.get('/api/legion');
      const L = lg.mine;
      if (L) {
        const bnHtml = L.buildings.map((b) => `
          <div class="card">
            <div class="name">🏛 ${UI.esc(b.name)} <span class="muted">ур. ${b.level}/${b.maxLevel}</span></div>
            <div class="muted small">${UI.esc(b.desc)}</div>
            <div class="kv mt"><span class="k">Бонус сейчас</span><span class="v">+${b.bonusNow}%</span></div>
            ${b.nextPrice !== null
              ? `<div class="kv"><span class="k">След. уровень: +${b.bonusNext}%</span><span class="v money">$ ${UI.fmtMoney(b.nextPrice)}</span></div>
                 ${L.isLeader ? `<button class="btn btn-orange mt" data-build="${b.id}">Прокачать из казны</button>`
                              : '<p class="muted small mt center">Прокачать может только лидер</p>'}`
              : '<p class="gold center mt">Максимальный уровень ✔</p>'}
          </div>`).join('');

        let warHtml;
        if (L.war) {
          warHtml = `
            <div class="card">
              <div class="name">⚔ Текущая кланвойна</div>
              <p class="small mt">Противник: <b>${UI.esc(L.war.enemyName)}</b> · вы — ${L.war.role === 'attacker' ? 'атакующий' : 'обороняющийся'}</p>
              <div class="kv mt"><span class="k">Битва через</span><span class="v">${UI.fmtTimer(L.war.secondsLeft)}</span></div>
              <div class="kv"><span class="k">Наша мощь</span><span class="v">${UI.fmtNum(L.war.myPower)}</span></div>
              <div class="kv"><span class="k">Мощь врага</span><span class="v">${UI.fmtNum(L.war.enemyPower)}</span></div>
              <p class="muted small mt">Битва пройдёт автоматически. Сплотитесь и донатите в казну — это укрепит фортификации.</p>
            </div>`;
        } else if (L.canDeclareWar) {
          warHtml = `
            <div class="card">
              <div class="name">⚔ Кланвойны</div>
              <p class="muted small">Выберите вражеский легион — через час пройдёт битва. Победитель забирает 25% казны проигравшего.</p>
              ${L.targets.length ? L.targets.map((t) => `
                <div class="list-row">
                  <div class="grow"><span class="name">${UI.esc(t.name)}</span> <span class="muted small">${t.members} бойцов</span></div>
                  <button class="btn btn-red btn-inline" data-war="${t.id}">⚔ Объявить</button>
                </div>`).join('') : '<p class="muted center">Подходящих целей нет (все в перерыве или уже воюют).</p>'}
            </div>`;
        } else {
          warHtml = `<div class="card"><div class="name">⚔ Кланвойны</div><p class="muted small mt">Объявлять войну может только лидер легиона.</p></div>`;
        }

        legionPanel = `
          <div class="card">
            <div class="title" style="margin-top:0">Казна легиона</div>
            <div class="kv"><span class="k">В казне</span><span class="v money">$ ${UI.fmtMoney(L.treasury)}</span></div>
            <div class="field-row mt">
              <input type="number" id="lg-dep" min="1" placeholder="Сумма">
              <button class="btn btn-orange btn-inline" id="lg-dep-go">Внести</button>
            </div>
            <p class="muted small mt">Из казны лидер прокачивает клановые постройки, и она же страдает при поражении в кланвойне.</p>
          </div>
          <div class="title" style="font-size:14px">Клановые постройки</div>
          ${bnHtml}
          ${warHtml}`;
      }
    }

    c.innerHTML = `
      <div class="title">${label} «${UI.esc(g.name)}»</div>
      <div class="card">
        <div class="kv"><span class="k">Бойцов в строю</span><span class="v">${g.members.length}${g.maxMembers ? ' / ' + g.maxMembers : ''}</span></div>
        ${kind === 'alliance' ? `<div class="kv"><span class="k">Бонус техники в бой</span><span class="v gold">+${UI.fmtNum(g.bonusEach)}</span></div>` : ''}
        ${g.maxMembers ? `<p class="muted small mt">Макс. участников = ваш уровень × 10. Поднимите уровень — откроется +10 мест.</p>` : ''}
        <p class="muted small mt">${bonusHint}</p>
        <button class="btn btn-red mt" id="g-leave">${g.isLeader ? 'Покинуть (лидерство передастся)' : `Покинуть ${label.toLowerCase()}`}</button>
      </div>

      ${g.isLeader && kind === 'alliance' ? `
        <div class="card">
          <div class="name">🎩 Дипломаты и приглашения</div>
          <p class="muted small mt">Базовый лимит: 5 приглашений/час. Каждый дипломат добавляет +1 к лимиту.</p>
          <div class="kv"><span class="k">Дипломатов нанято</span><span class="v">${g.diplomats}</span></div>
          <div class="kv"><span class="k">Лимит приглашений</span><span class="v">${g.invitesUsed} / ${g.inviteLimit} в час</span></div>
          ${g.invitesUsed >= g.inviteLimit ? `<p class="small mt" style="color:var(--red)">⚠️ Слот восстановится через ~${g.inviteCooldownMin} мин</p>` : ''}
          <button class="btn btn-orange mt" id="g-hire-diplomat">Нанять дипломата за <span class="ic-gold"></span> ${UI.fmtNum(g.nextDiplomatCost)}</button>
        </div>` : ''}

      ${g.isLeader && g.requests.length ? `
        <div class="card">
          <div class="title" style="margin-top:0">Заявки на вступление</div>
          ${g.requests.map((r) => `
            <div class="list-row">
              <div class="grow"><span class="name" onclick="App.go('profile/${r.id}')" style="cursor:pointer">${r.flag} ${UI.esc(r.name)}</span> <span class="muted small">Ур. ${r.level}</span></div>
              <button class="btn btn-green btn-inline" data-acc="${r.id}">✔</button>
              <button class="btn btn-red btn-inline" data-rej="${r.id}">✖</button>
            </div>`).join('')}
        </div>` : ''}

      <div class="card">
        <div class="title" style="margin-top:0">Состав</div>
        ${g.members.map((mb) => `
          <div class="list-row">
            <div class="grow">
              <span class="name" onclick="App.go('profile/${mb.id}')" style="cursor:pointer">${mb.flag} ${UI.esc(mb.name)}</span>
              ${mb.id === g.leaderId ? '<span class="badge green">лидер</span>' : ''}
              <span class="muted small"> Ур. ${mb.level} · Рейтинг ${UI.fmtNum(mb.rating)}</span>
            </div>
            ${g.isLeader && mb.id !== g.leaderId ? `<button class="btn btn-inline" data-kick="${mb.id}">Исключить</button>` : ''}
          </div>`).join('')}
      </div>

      ${legionPanel}`;

    document.getElementById('g-leave').onclick = async () => {
      if (!confirm(`Точно покинуть ${label.toLowerCase()}?`)) return;
      try { await API.post(`/api/group/${kind}/leave`); await App.refreshMe(); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const diplomatBtn = document.getElementById('g-hire-diplomat');
    if (diplomatBtn) diplomatBtn.onclick = async () => {
      if (!confirm(`Нанять дипломата за ${g.nextDiplomatCost} золота?`)) return;
      try { await API.post(`/api/group/${kind}/diplomat`); await App.refreshMe(); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const decide = (userId, accept) => async () => {
      try { await API.post(`/api/group/${kind}/decide`, { userId, accept }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    c.querySelectorAll('[data-acc]').forEach((b) => b.onclick = decide(b.dataset.acc, true));
    c.querySelectorAll('[data-rej]').forEach((b) => b.onclick = decide(b.dataset.rej, false));
    c.querySelectorAll('[data-kick]').forEach((b) => {
      b.onclick = async () => {
        try { await API.post(`/api/group/${kind}/kick`, { userId: b.dataset.kick }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };
    });

    if (kind === 'legion') {
      const depBtn = document.getElementById('lg-dep-go');
      if (depBtn) depBtn.onclick = async () => {
        try {
          await API.post('/api/legion/deposit', { amount: document.getElementById('lg-dep').value });
          await App.refreshMe(); App.rerender();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };
      c.querySelectorAll('[data-build]').forEach((b) => {
        b.onclick = async () => {
          try { await API.post('/api/legion/build', { buildingId: b.dataset.build }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });
      c.querySelectorAll('[data-war]').forEach((b) => {
        b.onclick = async () => {
          if (!confirm('Объявить войну этому легиону?')) return;
          try { await API.post('/api/legion/war', { enemyId: b.dataset.war }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });
    }
    return;
  }

  // Игрок без группы: показываем приглашения, форму создания и топ
  let invites = [];
  try { invites = (await API.get(`/api/group/${kind}/invites`)).invites || []; }
  catch (e) {}

  const invitesHtml = invites.length ? `
    <div class="card">
      <div class="title" style="margin-top:0">Полученные приглашения</div>
      ${invites.map((i) => `
        <div class="list-row">
          <div class="grow"><span class="name">${UI.esc(i.name)}</span> <span class="muted small">от ${UI.esc(i.leaderName)} · ${i.members} чел.</span></div>
          <button class="btn btn-green btn-inline" data-acc-inv="${i.id}">✔</button>
          <button class="btn btn-red btn-inline" data-rej-inv="${i.id}">✖</button>
        </div>`).join('')}
    </div>` : '';

  const rulesHint = kind === 'alliance'
    ? `Альянс — мини-команда друзей. Каждый боец даёт +${data.rules.perMember} единиц техники в бой ВСЕМ участникам.`
    : `Легион — это клан: общая казна, клановые постройки с пассивными бонусами и сражения легион-на-легион.`;

  c.innerHTML = `
    <div class="title">${label}</div>
    <div class="card">
      <p class="muted small">${rulesHint}</p>
      ${data.pendingFor ? `<p class="mt gold">⏳ Ваша заявка в «${UI.esc(data.pendingFor.name)}» ждёт решения лидера.</p>` : ''}
    </div>
    ${invitesHtml}
    <div class="card">
      <div class="title" style="margin-top:0">Основать свой ${label.toLowerCase()}</div>
      <label>Название (3–20 символов)</label>
      <input type="text" id="g-name" maxlength="20">
      <button class="btn btn-orange mt" id="g-create">Основать за $ ${UI.fmtMoney(data.rules.createCost)} (с ${data.rules.minLevel} ур.)</button>
    </div>
    <div class="card">
      <div class="title" style="margin-top:0">Крупнейшие ${kind === 'legion' ? 'легионы' : 'альянсы'}</div>
      ${data.top.length ? data.top.map((a) => `
        <div class="list-row">
          <div class="grow"><span class="name">${UI.esc(a.name)}</span><br><span class="muted small">${a.members} бойцов · лидер: ${UI.esc(a.leaderName)}</span></div>
          <button class="btn btn-inline" data-apply="${a.id}">Заявка</button>
        </div>`).join('') : '<p class="muted center">Пока не основано ни одного. Станьте первым!</p>'}
    </div>`;

  document.getElementById('g-create').onclick = async () => {
    try {
      await API.post(`/api/group/${kind}/create`, { name: document.getElementById('g-name').value });
      await App.refreshMe(); App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-apply]').forEach((b) => {
    b.onclick = async () => {
      try { await API.post(`/api/group/${kind}/apply`, { groupId: b.dataset.apply }); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
  });
  const respond = (groupId, accept) => async () => {
    try { await API.post(`/api/group/${kind}/respond`, { groupId, accept }); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-acc-inv]').forEach((b) => b.onclick = respond(b.dataset.accInv, true));
  c.querySelectorAll('[data-rej-inv]').forEach((b) => b.onclick = respond(b.dataset.rejInv, false));
}

App.screens.alliance = (c) => renderGroupScreen(c, 'alliance');
App.screens.legion   = (c) => renderGroupScreen(c, 'legion');

// ---------- ОБЩЕНИЕ (общий чат) ----------
App.screens.chat = async (c) => {
  c.innerHTML = `
    <div class="title">Общение</div>
    <div class="card">
      <div class="chat-box" id="chat-box"><div class="loading">Подключение к рации…</div></div>
      <div class="field-row mt">
        <input type="text" id="chat-text" maxlength="300" placeholder="Сообщение в эфир…">
        <button class="btn btn-orange btn-inline" id="chat-send">➤</button>
      </div>
    </div>`;

  const box = document.getElementById('chat-box');

  async function loadChat() {
    try {
      const { messages } = await API.get('/api/chat');
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      box.innerHTML = messages.length ? messages.map((msg) => `
        <div class="chat-msg">
          <span class="who" onclick="App.go('profile/${msg.uid}')">${msg.flag} ${UI.esc(msg.name)}</span>
          <span class="muted small">[${msg.level}]</span>
          <span class="at">${UI.fmtDate(msg.at)}</span><br>${UI.esc(msg.text)}
        </div>`).join('')
        : '<p class="muted center">В эфире тишина. Скажите что-нибудь первым!</p>';
      if (atBottom) box.scrollTop = box.scrollHeight;
    } catch (e) {}
  }

  async function send() {
    const input = document.getElementById('chat-text');
    const text = input.value.trim();
    if (!text) return;
    try {
      await API.post('/api/chat', { text });
      input.value = '';
      await loadChat();
      box.scrollTop = box.scrollHeight;
    } catch (e) { UI.toast('⛔ ' + e.message); }
  }
  document.getElementById('chat-send').onclick = send;
  document.getElementById('chat-text').onkeydown = (e) => { if (e.key === 'Enter') send(); };

  await loadChat();
  box.scrollTop = box.scrollHeight;
  const timer = setInterval(loadChat, 5000);
  App._tear = () => clearInterval(timer);
};

// ---------- ПОЧТА ----------
App.screens.mail = async (c, param) => {
  if (param && param !== 'new') {
    const { mail } = await API.get('/api/mail/' + encodeURIComponent(param));
    await App.refreshMe();
    c.innerHTML = `
      <div class="title">Письмо</div>
      <div class="card">
        <div class="kv"><span class="k">От</span><span class="v name">${UI.esc(mail.fromName)}</span></div>
        <div class="kv"><span class="k">Тема</span><span class="v">${UI.esc(mail.subject)}</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${UI.fmtDate(mail.at)}</span></div>
        <hr class="hr">
        <p style="white-space:pre-wrap">${UI.esc(mail.text)}</p>
      </div>
      <div class="btn-row">
        <button class="btn" onclick="App.go('mail')">← К списку</button>
        ${mail.fromId ? `<button class="btn btn-orange" id="ml-reply">Ответить</button>` : ''}
      </div>`;
    const reply = document.getElementById('ml-reply');
    if (reply) reply.onclick = () => { App._mailTo = mail.fromName; App.go('mail/new'); };
    return;
  }

  if (param === 'new') {
    c.innerHTML = `
      <div class="title">Новое письмо</div>
      <div class="card">
        <label>Кому (позывной)</label>
        <input type="text" id="ml-to" value="${UI.esc(App._mailTo || '')}">
        <label>Тема</label>
        <input type="text" id="ml-subj" maxlength="80">
        <label>Текст</label>
        <textarea id="ml-text" maxlength="2000"></textarea>
        <div class="btn-row mt">
          <button class="btn" onclick="App.go('mail')">Отмена</button>
          <button class="btn btn-orange" id="ml-send">Отправить</button>
        </div>
      </div>`;
    App._mailTo = null;
    document.getElementById('ml-send').onclick = async () => {
      try {
        await API.post('/api/mail', {
          toName: document.getElementById('ml-to').value,
          subject: document.getElementById('ml-subj').value,
          text: document.getElementById('ml-text').value,
        });
        App.go('mail');
      } catch (e) { UI.toast('⛔ ' + e.message); }
    };
    return;
  }

  const { messages } = await API.get('/api/mail');
  c.innerHTML = `
    <div class="title">Почта</div>
    <button class="btn btn-orange" onclick="App.go('mail/new')" style="margin-bottom:10px">✍ Написать письмо</button>
    <div class="card">
      ${messages.length ? messages.map((msg) => `
        <div class="list-row" style="cursor:pointer" onclick="App.go('mail/${msg.id}')">
          <div class="grow">
            <span class="${msg.read ? 'muted' : 'name'}">${msg.read ? '📭' : '📬'} ${UI.esc(msg.fromName)}</span> — ${UI.esc(msg.subject)}
            <br><span class="muted small">${UI.fmtDate(msg.at)}</span>
          </div>
        </div>`).join('') : '<p class="muted center">Почтовый ящик пуст.</p>'}
    </div>`;
};

// ---------- ЗАЛ СЛАВЫ ----------
App.screens.fame = async (c, param) => {
  const { categories } = await API.get('/api/fame');
  const active = param || categories[0].id;
  const cat = categories.find((x) => x.id === active) || categories[0];

  // Категории, где значение — деньги (показываем с $), остальное — обычное число
  const moneyCats = new Set(['rich']);
  const fmtVal = (catId, v) => moneyCats.has(catId) ? `$ ${UI.fmtMoney(v)}` : UI.fmtNum(v);

  c.innerHTML = `
    <div class="title">Зал славы</div>
    <div class="tabs">${categories.map((x) =>
      `<div class="tab ${x.id === cat.id ? 'active' : ''}" onclick="location.hash='#fame/${x.id}'">${UI.esc(x.name)}</div>`).join('')}
    </div>
    <div class="card">
      ${cat.top.length ? cat.top.map((p, i) => `
        <div class="list-row">
          <div style="width:26px;text-align:center" class="${i < 3 ? 'gold' : 'muted'}">${i + 1}</div>
          <div class="grow"><span class="name" style="cursor:pointer" onclick="App.go('profile/${p.id}')">${p.flag} ${UI.esc(p.name)}</span> <span class="muted small">Ур. ${p.level}</span></div>
          <div class="v gold">${fmtVal(cat.id, p.value)}</div>
        </div>`).join('') : '<p class="muted center">Список пока пуст.</p>'}
    </div>`;
};

// ---------- ДОСТИЖЕНИЯ ----------
App.screens.ach = async (c) => {
  const { achievements } = await API.get('/api/achievements');
  c.innerHTML = `
    <div class="title">Достижения</div>
    <div class="card"><p class="muted small">У каждой цели 5 этапов. Награды (доллары, а с 3-го этапа и золото) приходят автоматически вместе с письмом из Генштаба.</p></div>
    ${achievements.map((a) => `
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div class="grow">
            <div class="name">${UI.esc(a.name)}</div>
            <div class="muted small">${UI.esc(a.desc)}</div>
          </div>
          ${UI.stars(a.stage, 5)}
        </div>
        <div class="mt">${a.next !== null
          ? UI.bar(a.value, a.next, 'xp', `${UI.fmtMoney(a.value)} / ${UI.fmtMoney(a.next)}`)
          : UI.bar(1, 1, 'gold', 'Все этапы пройдены ✔')}</div>
      </div>`).join('')}`;
};

// ---------- УВЕДОМЛЕНИЯ (колокольчик) ----------
// Подробное отображение системных событий: кто атаковал, когда, сколько
// потеряно. Отдельно от личной почты — туда падают только письма.
App.screens.notifications = async (c) => {
  const { notifications } = await API.get('/api/notifications');
  await App.refreshMe();

  // Рендер одного уведомления в зависимости от типа (kind)
  const renderOne = (n) => {
    const p = n.payload || {};
    const when = UI.fmtDate(n.at);
    let body = '';

    if (n.kind === 'attack_lost') {
      body = `
        <div class="kv"><span class="k">Противник</span><span class="v name" style="cursor:pointer" onclick="App.go('profile/${p.attackerId}')">${UI.esc(p.attackerName)} (ур. ${p.attackerLevel})</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${when}</span></div>
        <div class="kv"><span class="k">Урон по вам</span><span class="v dmg-take">${p.dealt} ед.</span></div>
        <div class="kv"><span class="k">Награблено</span><span class="v money">$ ${UI.fmtNum(p.loot)}</span></div>
        <div class="kv"><span class="k">Потеряно техники</span><span class="v">${p.lossesText ? UI.esc(p.lossesText) : 'без потерь'}</span></div>`;
    } else if (n.kind === 'attack_defended') {
      body = `
        <div class="kv"><span class="k">Противник</span><span class="v name" style="cursor:pointer" onclick="App.go('profile/${p.attackerId}')">${UI.esc(p.attackerName)} (ур. ${p.attackerLevel})</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${when}</span></div>
        <div class="kv"><span class="k">Урон по вам</span><span class="v dmg-take">${p.received} ед.</span></div>
        <div class="kv"><span class="k">Потеряно техники</span><span class="v">${p.lossesText ? UI.esc(p.lossesText) : 'без потерь'}</span></div>
        <p class="small mt" style="color:var(--money)">✅ Атака отбита — деньги и большая часть техники в безопасности.</p>`;
    } else if (n.kind === 'rocket_hit') {
      body = `
        <div class="kv"><span class="k">Противник</span><span class="v name" style="cursor:pointer" onclick="App.go('profile/${p.attackerId}')">${UI.esc(p.attackerName)} (ур. ${p.attackerLevel})</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${when}</span></div>
        <div class="kv"><span class="k">Урон ракеты</span><span class="v dmg-take">${UI.fmtNum(p.damage)} (мощность ${p.powerPct}%)</span></div>
        <div class="kv"><span class="k">Разрушено построек</span><span class="v">${p.destroyedBuildingsText ? UI.esc(p.destroyedBuildingsText) : 'постройки уцелели'}</span></div>
        <div class="kv"><span class="k">Уничтожено техники</span><span class="v">${p.techLostText ? UI.esc(p.techLostText) : 'техника уцелела'}</span></div>`;
    } else if (n.kind === 'fatality_ear') {
      body = `
        <div class="kv"><span class="k">Кто</span><span class="v name" style="cursor:pointer" onclick="App.go('profile/${p.attackerId}')">${UI.esc(p.attackerName)}</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${when}</span></div>
        <p class="small mt">✂️ Совершил фаталити и отрезал вам ухо.</p>`;
    } else if (n.kind === 'fatality_mercy') {
      body = `
        <div class="kv"><span class="k">Кто</span><span class="v name" style="cursor:pointer" onclick="App.go('profile/${p.attackerId}')">${UI.esc(p.attackerName)}</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${when}</span></div>
        <p class="small mt" style="color:var(--money)">🎖 Мог совершить фаталити, но помиловал вас.</p>`;
    } else {
      body = `<p class="muted small mt">${when}</p>`;
    }

    return `
      <div class="card" data-notif="${n.id}" style="${n.read ? 'opacity:.65' : ''}">
        <div class="name">${n.kind.includes('lost') || n.kind === 'rocket_hit' ? '⚠️' : n.kind.includes('defended') || n.kind === 'fatality_mercy' ? '✅' : '🔔'} ${UI.esc(n.title)}</div>
        ${body}
      </div>`;
  };

  c.innerHTML = `
    <div class="title">🔔 Уведомления</div>
    ${notifications.length > 0 ? `<button class="btn mt" id="notif-read-all" style="width:100%">Отметить все как прочитанные</button>` : ''}
    ${notifications.length === 0 ? '<div class="card center muted">Уведомлений пока нет.</div>' : ''}
    ${notifications.map(renderOne).join('')}`;

  const readAllBtn = document.getElementById('notif-read-all');
  if (readAllBtn) readAllBtn.onclick = async () => {
    await API.post('/api/notifications/read-all');
    await App.refreshMe();
    App.rerender();
  };

  // Отмечаем как прочитанные при открытии экрана (тихо, без перерисовки)
  notifications.filter((n) => !n.read).forEach((n) => {
    API.post(`/api/notifications/${n.id}/read`).catch(() => {});
  });
  if (notifications.some((n) => !n.read)) {
    setTimeout(() => App.refreshMe(), 500);
  }
};
