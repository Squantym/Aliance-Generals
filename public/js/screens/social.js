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
        // ── Вкладки легиона ──────────────────────────────────────────
        const tab = App._legionTab || 'base';
        const myRank = L.myRank || 0;
        const isLeaderOrVice = myRank >= 3;

        // ── Баннер вызова на бой (виден лидеру при входящем вызове) ──
        let challengeBanner = '';
        if (L.challenge && L.challenge.role === 'challenged') {
          challengeBanner = `
            <div class="card" style="border:2px solid var(--red);background:rgba(220,50,50,.08)">
              <div class="name" style="color:var(--red)">⚔️ ВХОДЯЩИЙ ВЫЗОВ НА БОЙ</div>
              <p class="mt small">Легион <b>${UI.esc(L.challenge.enemyName)}</b> вызывает вас на бой!</p>
              <div class="kv"><span class="k">Время на решение</span><span class="v" id="challenge-timer">${UI.fmtTimer(L.challenge.secondsLeft)}</span></div>
              ${L.challenge.canAccept ? `
                <div class="btn-row mt">
                  <button class="btn btn-green" id="lg-accept-challenge">✅ Принять</button>
                  <button class="btn btn-red" id="lg-decline-challenge">❌ Отклонить</button>
                </div>` : '<p class="muted small mt">Принять может только лидер</p>'}
            </div>`;
        } else if (L.challenge && L.challenge.role === 'challenger') {
          challengeBanner = `
            <div class="card" style="border:2px solid var(--orange)">
              <div class="name">⏳ Ожидаем ответа</div>
              <p class="small mt">Вызов отправлен легиону <b>${UI.esc(L.challenge.enemyName)}</b>.</p>
              <div class="kv"><span class="k">Истекает через</span><span class="v" id="challenge-timer">${UI.fmtTimer(L.challenge.secondsLeft)}</span></div>
            </div>`;
        }

        // ── Активный бой легиона ──────────────────────────────────────
        let activeBattleHtml = '';
        if (L.activeBattle) {
          const phaseLabel = L.activeBattle.phase === 'active' ? '⚔️ БОЙ ИДЁТ' : '⏳ ПОДГОТОВКА К БОЮ';
          activeBattleHtml = `
            <div class="card" style="border:2px solid var(--green)">
              <div class="name" style="color:var(--green)">${phaseLabel}</div>
              <p class="small mt">Ваш легион сражается с <b>${UI.esc(L.activeBattle.enemyName || 'врагом')}</b>.</p>
              <p class="muted small">Нажмите кнопку, чтобы войти в окно боя, выбрать роль и снарядить пояс. В бою участвуют только те, кто подготовился.</p>
              <button class="btn btn-green mt" id="lg-prepare-battle" style="width:100%">⚔️ Подготовиться к бою</button>
            </div>`;
        }

        // ── Вкладка: Постройки ─────────────────────────────────────────
        const bnHtml = L.buildings.map((b) => `
          <div class="card">
            <div class="name">🏛 ${UI.esc(b.name)} <span class="muted">ур. ${b.level}/${b.maxLevel}</span></div>
            <div class="muted small">${UI.esc(b.desc)}</div>
            <div class="kv mt"><span class="k">Бонус</span><span class="v">+${b.bonusNow}%</span></div>
            ${b.nextPrice !== null
              ? `<div class="kv"><span class="k">След. ур. +${b.bonusNext}%</span><span class="v money"><span class="ic-dollar"></span>${UI.fmtMoney(b.nextPrice)}</span></div>
                 ${L.isLeader ? `<button class="btn btn-orange mt" data-build="${b.id}">Улучшить из казны</button>`
                              : '<p class="muted small mt center">Только лидер</p>'}`
              : '<p class="gold center mt small">Макс. уровень ✔</p>'}
          </div>`).join('');

        const btBldHtml = L.battleBuildings.map((b) => {
          const c = b.nextCost;
          let resStr = '';
          if (c) {
            resStr = `<span class="ic-dollar"></span>${UI.fmtMoney(c.dollars)} из казны`;
            if (c.ears)   resStr += ` + ${c.ears} 👂`;
            if (c.tokens) resStr += ` + ${c.tokens} 🎖`;
          }
          const isBuilt = b.level > 0;
          const btnLabel = !isBuilt ? '🏗 Построить' : `⬆️ Улучшить до ур.${b.level + 1}`;
          return `
            <div class="card">
              <div class="name">${UI.esc(b.name)} <span class="muted">ур. ${b.level}/${b.maxLevel}</span></div>
              <div class="muted small">${UI.esc(b.desc)}</div>
              <div class="kv mt"><span class="k">Бонус</span><span class="v">${b.bonusNow}${b.apply === 'gear_slots' || b.apply === 'member_limit' ? (b.apply === 'member_limit' ? ' чел.' : ' слот.') : '%'}</span></div>
              ${c ? `<div class="kv"><span class="k">Цена</span><span class="v">${resStr}</span></div>
                     ${L.isLeader ? `<button class="btn btn-orange mt" data-btbld="${b.id}">${btnLabel}</button>`
                                  : '<p class="muted small mt center">Только лидер</p>'}`
                : '<p class="gold center mt small">Макс. уровень ✔</p>'}
            </div>`;
        }).join('');

        const buildingsTab = `
          <div class="card">
            <p class="muted small">Постройки — эндгейм контент. Цена высокая: <span class="ic-dollar"></span>500 млрд и выше из казны легиона. Для улучшений потребуются уши 👂 и жетоны 🎖 из казначейства.</p>
          </div>
          <div class="name mt" style="padding:0 16px">⚔️ Боевые постройки и казармы</div>
          ${btBldHtml}`;

        // ── Вкладка: Технологии ────────────────────────────────────────
        const techsTab = (() => {
          const branches = { economic: '💰 Экономические', combat: '🎯 Боевые' };
          const grouped = {};
          for (const t of L.techs) {
            if (!grouped[t.branch]) grouped[t.branch] = [];
            grouped[t.branch].push(t);
          }
          let html = '';
          for (const [branch, label] of Object.entries(branches)) {
            const list = grouped[branch] || [];
            html += `<div class="name mt" style="padding:0 16px">${label}</div>`;
            html += list.map((t) => {
              const nd = t.nextLevelData;
              let statusHtml = '';
              if (t.inQueue) {
                const secsLeft = Math.max(0, Math.floor((t.queueFinishAt - Date.now()) / 1000));
                statusHtml = `<p class="small mt" style="color:var(--orange)">🔬 Изучается... ${UI.fmtTimer(secsLeft)}</p>`;
              } else if (t.level >= t.maxLevel) {
                statusHtml = '<p class="gold small mt center">Макс. уровень ✔</p>';
              } else if (nd) {
                let reqStr = `${UI.fmtNum(nd.priceReserves)} РЕЗ + ${nd.earReq} 👂`;
                if (nd.gloryReq > 0) reqStr += ` · Слава: ${nd.gloryReq} ⭐`;
                statusHtml = `
                  <div class="kv mt"><span class="k">Цена ур.${t.level+1}</span><span class="v">${reqStr}</span></div>
                  <div class="kv"><span class="k">Время</span><span class="v">${nd.daysBase} дн.</span></div>
                  ${t.canLearn
                    ? `<button class="btn btn-orange mt" data-tech="${t.id}">🔬 Изучить</button>`
                    : `<p class="muted small mt">${nd.gloryReq > (L.gloryEarned || 0)
                        ? `Нужно славы: ${nd.gloryReq} ⭐ (есть ${L.gloryEarned || 0})`
                        : 'Только лидер / идёт другое изучение'}</p>`}`;
              }
              return `
                <div class="card">
                  <div class="name">${UI.esc(t.name)} <span class="muted">ур. ${t.level}/${t.maxLevel}</span></div>
                  <div class="muted small">${UI.esc(t.desc)}</div>
                  <div class="kv mt"><span class="k">Бонус</span><span class="v">+${t.bonusNow}${t.bonusUnit}</span></div>
                  ${statusHtml}
                </div>`;
            }).join('');
          }
          if (L.techQueue) {
            const qt = L.techs.find(t => t.id === L.techQueue.techId);
            const secsLeft = Math.max(0, Math.floor((L.techQueue.finishAt - Date.now()) / 1000));
            html = `<div class="card" style="border:2px solid var(--orange)">
              <div class="name">🔬 Идёт изучение</div>
              <p class="small mt">${qt ? UI.esc(qt.name) : L.techQueue.techId} → ур. ${L.techQueue.targetLevel}</p>
              <div class="kv mt"><span class="k">Завершится через</span><span class="v">${UI.fmtTimer(secsLeft)}</span></div>
            </div>` + html;
          }
          return html;
        })();

        // ── Вкладка: Арсенал ──────────────────────────────────────────
        const arsenalTab = (() => {
          const gearSlots = 2 + (L.battleBuildings.find(b => b.id === 'gear_slots')?.level || 0);
          let html = `<div class="card"><p class="small">Слотов в боевом поясе: <b>${gearSlots}</b>. Берите предметы перед боем.</p></div>`;
          if (!L.arsenal.length || L.arsenal.every(i => i.count === 0)) {
            html += `<div class="card"><p class="muted center small">Арсенал пуст. Лидер клана закупает предметы в Магазине.</p></div>`;
          } else {
            html += L.arsenal.filter(i => i.count > 0).map(i => `
              <div class="card">
                <div class="name">${UI.esc(i.name)} <span class="muted small">×${i.count}</span></div>
                <div class="muted small">${UI.esc(i.desc)}</div>
                ${L.activeBattle ? `<button class="btn btn-orange mt" data-gear="${i.id}">🎒 Взять в пояс</button>`
                                 : '<p class="muted small mt">Доступно во время боя легиона</p>'}
              </div>`).join('');
          }
          return html;
        })();

        // ── Вкладка: Магазин ──────────────────────────────────────────
        const shopItems = [
          // Боевые (за уши)
          { id:'gas_grenade',     name:'💨 Газовая шашка',         desc:'Запрещает лечение противнику 30 сек.',               earCost:1 },
          { id:'flashbang',       name:'💥 Светошумовая граната',   desc:'Обездвиживает противника на 20 сек.',                earCost:1 },
          { id:'assault_grenade', name:'🔴 Наступательная граната', desc:'Наносит 1000% урона от обычной атаки.',              earCost:1 },
          { id:'napalm',          name:'🔥 Напалм',                 desc:'АОЕ: каждые 3 сек снимает 5% HP в течение 15 сек.', earCost:2 },
          { id:'uranium_ammo',    name:'☢️ Боеприпасы с ураном',   desc:'+100% урона на 30 сек.',                             earCost:2 },
          { id:'hydrogen_bomb',   name:'💣 Водородная бомба',       desc:'АОЕ: −20…50% HP всем, игнорируя броню.',            earCost:5 },
          // Вспомогательные (за жетоны)
          { id:'medkit',          name:'🩹 Аптечка',                desc:'Лечит 20–50% макс. HP. Можно применять на союзника.', tokenCost:3 },
          { id:'dome',            name:'🔵 Защитный купол',         desc:'Полный иммунитет к урону на 30 сек.',                tokenCost:2 },
          { id:'kevlar',          name:'🦺 Кевларовые бронеплиты',  desc:'Восстанавливает 50–100% щита. Только Защитник.',     tokenCost:2 },
          { id:'reflect_shield',  name:'🪞 Отражающий щит',         desc:'Следующий удар по вам отражается на врага.',         tokenCost:3 },
        ];
        const shopTab = `
          <div class="card">
            <p class="muted small">Боевые предметы покупаются за 👂 уши, вспомогательные — за 🎖 жетоны. Покупает лидер, используют все.</p>
            <p class="muted small mt">Боевые: <b>👂 уши</b> &nbsp;·&nbsp; Вспомогательные: <b>🎖 жетоны</b></p>
          </div>
          ${shopItems.map(i => {
            const costIcon = i.earCost ? `${i.earCost} 👂` : `${i.tokenCost} 🎖`;
            const category = i.earCost ? 'Боевой' : 'Вспомог.';
            return `
            <div class="card">
              <div class="name">${UI.esc(i.name)} <span class="muted small">${category}</span></div>
              <div class="muted small">${UI.esc(i.desc)}</div>
              <div class="kv mt"><span class="k">Цена</span><span class="v">${costIcon}</span></div>
              ${L.isLeader ? `
                <div class="field-row mt">
                  <input type="number" min="1" value="1" id="shop-qty-${i.id}">
                  <button class="btn btn-orange btn-inline" data-shop="${i.id}">Купить</button>
                </div>` : '<p class="muted small mt center">Покупает только лидер</p>'}
            </div>`;
          }).join('')}`;

        // ── Вкладка: Война ────────────────────────────────────────────
        // Получаем состояние боя отдельным запросом если бой есть
        let battleData = null;
        if (L.activeBattle) {
          try { battleData = (await API.get('/api/legion/battle')).battle; } catch(e) {}
        }

        const warTab = (() => {
          let html = '';

          // ── БОЙ АКТИВЕН — открываем отдельное окно ─────────────
          if (battleData) {
            const b = battleData;
            const phaseLabel = b.phase === 'prep' ? '⏳ Подготовка к бою' : '⚔️ БОЙ ИДЁТ';
            const phaseColor = b.phase === 'prep' ? 'orange' : 'green';
            html += `
              <div style="background:rgba(0,200,0,.08);border:2px solid var(--${phaseColor});border-radius:10px;padding:16px;text-align:center">
                <div style="font-size:20px;font-weight:bold;color:var(--${phaseColor});margin-bottom:8px">
                  ${phaseLabel}
                </div>
                ${b.phase === 'prep' ? `<p class="muted small">Идёт подготовка. Осталось: <b id="prep-timer">${UI.fmtTimer(b.prepSecsLeft||0)}</b></p>` : ''}
                ${b.me ? `<p class="small mt">Вы участвуете как <b>${b.me.roleName}</b></p>` : '<p class="muted small mt">Нажмите «Готов» чтобы войти в бой</p>'}
                <button class="btn btn-green" style="width:100%;padding:14px;margin-top:12px;font-size:16px" onclick="App._openBattleWindow()">
                  ⚔️ Открыть боевое окно
                </button>
              </div>`;
          } // end if (battleData)

          // ── РЕЖИМ ОЖИДАНИЯ (нет активного боя) ───────────────────
          if (L.canChallenge) {
            html += `<div class="card">
              <div class="name">⚔️ Вызвать на бой</div>
              <p class="muted small mt">Победитель получает Резервы из казны врага + рейтинговые очки.</p>
              ${L.targets.length ? L.targets.map(t => `
                <div class="list-row">
                  <div class="grow"><span class="name">${UI.esc(t.name)}</span> <span class="muted small">${t.members} бойцов</span></div>
                  <button class="btn btn-red btn-inline" data-challenge="${t.id}">⚔️ Вызов</button>
                </div>`).join('')
              : '<p class="muted center small mt">Нет доступных целей</p>'}
            </div>`;
          } else if (!L.isLeader) {
            html += `<div class="card"><p class="muted small">Вызывать на бой может только лидер легиона.</p></div>`;
          } else {
            html += `<div class="card"><p class="muted small">${L.pendingChallenge
              ? 'Ожидаем ответа противника...'
              : 'Боевое окно закрыто. Дождитесь следующего.'}</p></div>`;
          }

          if (L.war) {
            html += `<div class="card">
              <div class="name">🔴 Кланвойна (авто)</div>
              <p class="small mt">Противник: <b>${UI.esc(L.war.enemyName)}</b></p>
              <div class="kv mt"><span class="k">Битва через</span><span class="v">${UI.fmtTimer(L.war.secondsLeft)}</span></div>
            </div>`;
          } else if (L.canDeclareWar) {
            html += `<div class="card">
              <div class="name">🔴 Авто-война (через 1 час)</div>
              ${L.targets.map(t => `
                <div class="list-row">
                  <div class="grow">${UI.esc(t.name)} <span class="muted small">${t.members} чел.</span></div>
                  <button class="btn btn-red btn-inline" data-war="${t.id}">Война</button>
                </div>`).join('')}
            </div>`;
          }

          if (L.battleHistory && L.battleHistory.length) {
            html += `<div class="card"><div class="name">📜 История боёв легиона</div>
              ${L.battleHistory.map(h => {
                const d = new Date(h.at);
                const dateStr = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
                return `
                <div style="border:1px solid var(--${h.won?'green':'red'});border-radius:8px;padding:10px;margin-top:8px">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b style="color:var(--${h.won?'green':'red'})">${h.won?'🏆 Победа':'💀 Поражение'}</b>
                    <span class="muted small">${dateStr}</span>
                  </div>
                  <div class="kv mt"><span class="k">Противник</span><span class="v">${UI.esc(h.enemyName||'легион')}</span></div>
                  <div class="kv"><span class="k">${h.loot>=0?'Получено':'Потеряно'} ресурсов</span><span class="v ${h.loot>=0?'green':'red'}">${h.loot>=0?'+':''}${UI.fmtNum(h.loot)}</span></div>
                  ${h.gloryGain!=null||h.gloryLoss!=null?`<div class="kv"><span class="k">Слава</span><span class="v ${h.won?'green':'red'}">${h.won?'+'+(h.gloryGain||0):'−'+(h.gloryLoss||0)} ⭐</span></div>`:''}
                  ${h.myDamage!=null?`<div class="kv"><span class="k">Урон сторон</span><span class="v">🟢 ${UI.fmtNum(h.myDamage||0)} vs 🔴 ${UI.fmtNum(h.enemyDamage||0)}</span></div>`:''}
                  ${h.myParticipants!=null?`<div class="kv"><span class="k">Участников</span><span class="v">🟢 ${h.myParticipants||0} vs 🔴 ${h.enemyParticipants||0}</span></div>`:''}
                </div>`;
              }).join('')}
            </div>`;
          }
          return html;
        })();

        // ── Казначейство ──────────────────────────────────────────────
        const gloryNext = L.gloryNextLevel;
        const treasuryTab = `
          <div class="card">
            <div class="name">⭐ Уровень легиона</div>
            <div class="kv mt"><span class="k">Уровень</span><span class="v gold">${L.legionLevel || 1}</span></div>
            <div class="kv"><span class="k">Слава (баланс)</span><span class="v">${UI.fmtNum(L.gloryPoints || 0)} ⭐</span></div>
            <div class="kv"><span class="k">Слава (заработано)</span><span class="v">${UI.fmtNum(L.gloryEarned || 0)} ⭐</span></div>
            ${gloryNext ? `<div class="kv"><span class="k">До след. уровня</span><span class="v">${UI.fmtNum(Math.max(0, gloryNext - (L.gloryEarned||0)))} ⭐</span></div>` : '<p class="gold small mt center">Максимальный уровень ✔</p>'}
            <p class="muted small mt">Победа: +1–2 ⭐ · Поражение: −1–2 ⭐ · Уровень зависит только от заработанной славы</p>
          </div>
          <div class="card">
            <div class="name">💰 Казна легиона</div>
            <div class="kv mt"><span class="k">Доллары в казне</span><span class="v money"><span class="ic-dollar"></span>${UI.fmtMoney(L.treasury)}</span></div>
            <div class="kv"><span class="k">Резервы</span><span class="v gold">${UI.fmtNum(L.reserves || 0)} РЕЗ</span></div>
            <div class="kv"><span class="k">Рейтинг клана</span><span class="v">${UI.fmtNum(L.ratingPoints)} очк.</span></div>
            <p class="muted small mt">Обмен <span class="ic-dollar"></span> → Резервы находится в разделе <b>Банк → Резерв</b>.</p>
            <hr class="hr">
            <label class="small">Внести деньги в казну (<span class="ic-dollar"></span>):</label>
            <div class="field-row mt">
              <input type="number" id="lg-dep" min="1" placeholder="Сумма $">
              <button class="btn btn-orange btn-inline" id="lg-dep-go">Внести</button>
            </div>
          </div>
          <div class="card">
            <div class="name">🗄 Казначейство ресурсов</div>
            <p class="muted small">Уши и жетоны используются для улучшения построек легиона.</p>
            <div class="kv mt"><span class="k">Уши 👂</span><span class="v">${UI.fmtNum(L.treasuryEars || 0)}</span></div>
            <div class="kv"><span class="k">Жетоны 🎖</span><span class="v">${UI.fmtNum(L.treasuryTokens || 0)}</span></div>
            <p class="muted small mt">Внести из инвентаря (у вас: ${UI.fmtNum(App.me.ears || 0)} 👂, ${UI.fmtNum(App.me.tokens || 0)} 🎖):</p>
            <div class="field-row mt">
              <input type="number" min="1" placeholder="Ушей 👂" id="dep-ears">
              <input type="number" min="1" placeholder="Жетонов 🎖" id="dep-tokens">
              <button class="btn btn-orange btn-inline" id="dep-res-go">Внести</button>
            </div>
            ${(App.me.adminEars || 0) > 0 || (App.me.adminTokens || 0) > 0 ? `
            <hr class="hr">
            <p class="muted small">Ресурсы от администратора (не учитываются в статистике, но можно внести в казну):</p>
            <div class="kv mt"><span class="k">Адм. Уши 👂</span><span class="v">${UI.fmtNum(App.me.adminEars || 0)}</span></div>
            <div class="kv"><span class="k">Адм. Жетоны 🎖</span><span class="v">${UI.fmtNum(App.me.adminTokens || 0)}</span></div>
            <div class="field-row mt">
              <input type="number" min="1" placeholder="Адм. ушей 👂" id="dep-adm-ears">
              <input type="number" min="1" placeholder="Адм. жетонов 🎖" id="dep-adm-tokens">
              <button class="btn btn-orange btn-inline" id="dep-adm-res-go">Внести в казну</button>
            </div>` : ''}
          </div>`;

        // ── Навигация по вкладкам ─────────────────────────────────────
        const tabs = [
          { id: 'base',        label: '🏰 База' },
          { id: 'buildings',   label: '🏗 Постройки' },
          { id: 'techs',       label: '🔬 Технологии' },
          { id: 'arsenal',     label: '🎒 Арсенал' },
          { id: 'shop',        label: '🛒 Магазин' },
          { id: 'war',         label: '⚔️ Война' },
          { id: 'treasury',    label: '💰 Казначейство' },
          { id: 'chat',        label: '💬 Общение' },
          ...(isLeaderOrVice ? [{ id: 'manage', label: '⚙️ Управление' }] : []),
        ];
        const tabNav = `<div class="tab-nav" style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0">
          ${tabs.map(t => `<button class="btn btn-inline ${tab === t.id ? 'btn-orange' : ''}" data-legtab="${t.id}">${t.label}</button>`).join('')}
        </div>`;

        // ── Вкладка: База ──────────────────────────────────────────────
        const RANKS = ['Новобранец', 'Боец', 'Лидер отряда', 'Зам. Генерала', 'Генерал'];
        function buildBaseTab(L2) {
          const membersSorted = (L2.membersWithRanks || []).slice().sort((a, b) => b.rank - a.rank || b.level - a.level);
          return `
            <div class="card">
              <div class="name" style="font-size:18px;text-align:center">${UI.esc(L2.name)}</div>
              <div class="kv mt"><span class="k">Уровень легиона</span><span class="v gold">${L2.legionLevel || 1} ⭐</span></div>
              <div class="kv"><span class="k">Слава</span><span class="v">${UI.fmtNum(L2.gloryPoints || 0)} ⭐</span></div>
              <div class="kv"><span class="k">Бойцов</span><span class="v">${L2.members} / ${L2.memberLimit || '?'}</span></div>
              <div class="kv"><span class="k">Победы</span><span class="v" style="color:var(--green)">${(L2.battleStats || {}).wins || 0}</span></div>
              <div class="kv"><span class="k">Поражения</span><span class="v" style="color:var(--red)">${(L2.battleStats || {}).losses || 0}</span></div>
              <div class="kv"><span class="k">Казна</span><span class="v money"><span class="ic-dollar"></span>${UI.fmtMoney(L2.treasury)}</span></div>
              <div class="kv"><span class="k">Резервы</span><span class="v gold">${UI.fmtNum(L2.reserves || 0)} РЕЗ</span></div>
              <div class="kv"><span class="k">Уши 👂</span><span class="v">${UI.fmtNum(L2.treasuryEars || 0)}</span></div>
              <div class="kv"><span class="k">Жетоны 🎖</span><span class="v">${UI.fmtNum(L2.treasuryTokens || 0)}</span></div>
              <div class="kv mt"><span class="k">Ваше звание</span><span class="v gold">${L2.myRankName || 'Новобранец'}</span></div>
            </div>
            <div class="card">
              <div class="name">👥 Состав легиона</div>
              ${membersSorted.map(m => `
                <div class="list-row" style="cursor:pointer" onclick="App.go('profile/${m.id}')">
                  <div class="grow">
                    <span class="name">${m.flag || ''} ${UI.esc(m.name)}</span>
                    <span class="muted small"> Ур. ${m.level}</span>
                  </div>
                  <span class="badge ${m.rank >= 4 ? 'green' : m.rank >= 3 ? 'orange' : ''}">${RANKS[m.rank] || 'Новобранец'}</span>
                </div>`).join('')}
            </div>`;
        }

        // ── Вкладка: Управление (только Генерал и Зам.) ─────────────────
        const manageTab = (() => {
          if (!isLeaderOrVice) return '<div class="card"><p class="muted center">Нет доступа</p></div>';
          const membersSorted2 = (L.membersWithRanks || []).slice().sort((a, b) => b.rank - a.rank);
          return `<div class="card">
            <div class="name">⚙️ Управление составом</div>
            <p class="muted small mt">${L.myRank === 4 ? 'Генерал: можно назначать любые звания, включая передачу лидерства.' : 'Зам. Генерала: можно назначать до «Лидер отряда».'}</p>
            ${membersSorted2.map(m => {
              if (m.id === L.leaderId) return `<div class="list-row"><div class="grow"><b>${UI.esc(m.name)}</b></div><span class="badge green">Генерал</span></div>`;
              const availableRanks = L.myRank === 4
                ? RANKS.map((r, i) => `<option value="${i}" ${m.rank === i ? 'selected' : ''}>${r}</option>`).join('')
                : RANKS.slice(0, 3).map((r, i) => `<option value="${i}" ${m.rank === i ? 'selected' : ''}>${r}</option>`).join('');
              return `<div class="list-row">
                <div class="grow"><span class="name">${UI.esc(m.name)}</span> <span class="muted small">Ур. ${m.level}</span></div>
                <select data-rank-user="${m.id}" class="btn-inline" style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px">${availableRanks}</select>
                <button class="btn btn-orange btn-inline" data-set-rank="${m.id}">✅</button>
              </div>`;
            }).join('')}
          </div>`;
        })();

        const tabContent = {
          base: buildBaseTab(L),
          buildings: buildingsTab, techs: techsTab, arsenal: arsenalTab,
          shop: shopTab, war: warTab, treasury: treasuryTab,
          chat: `<div class="card" id="legion-chat-box"><div class="loading">Загрузка чата…</div></div>
            <div class="card"><div class="field-row">
              <input type="text" id="lg-chat-input" placeholder="Сообщение…" maxlength="300" style="flex:1">
              <button class="btn btn-orange btn-inline" id="lg-chat-send">Отправить</button>
            </div></div>`,
          manage: manageTab,
        }[tab] || buildBaseTab(L);

        legionPanel = challengeBanner + activeBattleHtml + tabNav + tabContent;
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
      if (!await UI.confirm(`Точно покинуть ${label.toLowerCase()}?`, {title:'Выход', icon:'🚪', okText:'Покинуть', danger:true})) return;
      try { await API.post(`/api/group/${kind}/leave`); await App.refreshMe(); App.rerender(); }
      catch (e) { UI.toast('⛔ ' + e.message); }
    };
    const diplomatBtn = document.getElementById('g-hire-diplomat');
    if (diplomatBtn) diplomatBtn.onclick = async () => {
      if (!await UI.confirm(`Нанять дипломата за ${g.nextDiplomatCost} золота?`, {title:'Дипломат', icon:'🤝', okText:'Нанять'})) return;
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
      // Выбор роли (кнопка "Готов")
      c.querySelectorAll('[data-join]').forEach(btn => {
        btn.onclick = async () => {
          try { await API.post('/api/legion/battle/join', { role: btn.dataset.join }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Выбор / смена направления
      c.querySelectorAll('[data-dir]').forEach(btn => {
        btn.onclick = async () => {
          try { await API.post('/api/legion/battle/direction', { direction: btn.dataset.dir }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Атака
      c.querySelectorAll('[data-attack]').forEach(btn => {
        btn.onclick = async () => {
          try {
            const r = await API.post('/api/legion/battle/attack', { targetId: btn.dataset.attack });
            UI.toast(`⚔️ ${r.dmg} урона${r.crit?' 💥 КРИТ!':''}`);
            App.rerender();
          } catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Лечение
      c.querySelectorAll('[data-heal]').forEach(btn => {
        btn.onclick = async () => {
          try {
            const r = await API.post('/api/legion/battle/heal', { targetId: btn.dataset.heal });
            UI.toast(`💊 +${r.healed} HP${r.critHeal?' ✨ КРИТ!':''}`);
            App.rerender();
          } catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Прикрытие
      c.querySelectorAll('[data-guard]').forEach(btn => {
        btn.onclick = async () => {
          try { await API.post('/api/legion/battle/guard', { targetId: btn.dataset.guard }); UI.toast('🛡️ Прикрытие активировано!'); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Применение предмета — сначала выбрать цель, потом применить
      c.querySelectorAll('[data-use-item]').forEach(btn => {
        btn.onclick = async () => {
          const target = App._itemTarget || null;
          if (!target) { UI.toast('⛔ Сначала выберите цель (нажмите «Предмет» рядом с врагом)'); return; }
          try {
            await API.post('/api/legion/battle/item', { itemId: btn.dataset.useItem, targetId: target });
            App._itemTarget = null;
            App.rerender();
          } catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Кнопка «Покинуть бой»
      const leaveBattleBtn = document.getElementById('leave-battle-btn');
      if (leaveBattleBtn) {
        leaveBattleBtn.onclick = async () => {
          if (!await UI.confirm('Ваша статистика не будет учтена. Вы вернётесь на главную.', {title:'Покинуть бой?', icon:'🚪', okText:'Покинуть', danger:true})) return;
          try {
            await API.post('/api/legion/battle/leave');
            App._legionTab = 'base';
            App.rerender();
          } catch (e) { UI.toast('⛔ ' + e.message); }
        };
      }

      // Таймер подготовки (обратный отсчёт без перезагрузки страницы)
      const prepTimerEl = document.getElementById('prep-timer');
      if (prepTimerEl) {
        let secs = parseInt(prepTimerEl.textContent) || 0;
        const pt = setInterval(() => {
          secs--;
          if (secs <= 0) { clearInterval(pt); prepTimerEl.textContent = '00:00'; return; }
          prepTimerEl.textContent = UI.fmtTimer(secs);
        }, 1000);
      }

      // Таймер активного боя (1 час)
      const battleTimerEl = document.getElementById('battle-timer');
      if (battleTimerEl) {
        let secs = parseInt(battleTimerEl.textContent) || 0;
        const bt = setInterval(() => {
          secs--;
          if (secs <= 0) { clearInterval(bt); battleTimerEl.textContent = '⏱ 00:00'; return; }
          battleTimerEl.textContent = UI.fmtTimer(secs);
        }, 1000);
      }

      // Кулдауны: визуальный обратный отсчёт
      // Кулдауны отображаются как статичный текст при загрузке вкладки
      // (обновляются при следующем действии игрока)

      // Вкладки
      c.querySelectorAll('[data-legtab]').forEach(btn => {
        btn.onclick = () => {
          App._legionTab = btn.dataset.legtab;
          App.rerender();
          // Загружаем чат после рендера
          if (btn.dataset.legtab === 'chat') setTimeout(() => App._loadLegionChat(), 50);
        };
      });

      // Загрузка чата при открытии вкладки chat
      if ((App._legionTab || 'base') === 'chat') {
        setTimeout(() => App._loadLegionChat(), 50);
      }

      // Чат: отправка сообщения
      const chatSend = document.getElementById('lg-chat-send');
      if (chatSend) {
        chatSend.onclick = async () => {
          const input = document.getElementById('lg-chat-input');
          if (!input || !input.value.trim()) return;
          try {
            await API.post('/api/legion/chat', { text: input.value });
            input.value = '';
            App._loadLegionChat();
          } catch(e) { UI.toast('⛔ ' + e.message); }
        };
        const chatInput = document.getElementById('lg-chat-input');
        if (chatInput) chatInput.onkeydown = e => { if (e.key === 'Enter') chatSend.click(); };
      }

      // Управление: назначение звания
      c.querySelectorAll('[data-set-rank]').forEach(btn => {
        btn.onclick = async () => {
          const userId = btn.dataset.setRank;
          const sel = c.querySelector(`[data-rank-user="${userId}"]`);
          if (!sel) return;
          try {
            await API.post('/api/legion/rank', { targetId: userId, rank: sel.value });
            App.rerender();
          } catch(e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Внести в казну
      const depBtn = document.getElementById('lg-dep-go');
      if (depBtn) depBtn.onclick = async () => {
        try { await API.post('/api/legion/deposit', { amount: document.getElementById('lg-dep').value }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Обмен $ → Резервы (из вкладки Постройки)
      const exchBtn = document.getElementById('lg-exch-go');
      if (exchBtn) exchBtn.onclick = async () => {
        try { await API.post('/api/legion/exchange', { dollars: document.getElementById('lg-exch').value }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Обмен $ → Резервы (из Казначейства)
      const exchBtn2 = document.getElementById('lg-exch2-go');
      if (exchBtn2) exchBtn2.onclick = async () => {
        try { await API.post('/api/legion/exchange', { dollars: document.getElementById('lg-exch2').value }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Внести уши/жетоны в казначейство (обычные)
      const depResBtn = document.getElementById('dep-res-go');
      if (depResBtn) depResBtn.onclick = async () => {
        try {
          await API.post('/api/legion/deposit-resources', {
            ears:   document.getElementById('dep-ears')?.value   || 0,
            tokens: document.getElementById('dep-tokens')?.value || 0,
            useAdmin: false,
          });
          App.rerender();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Внести ресурсы от администратора в казначейство
      const depAdmBtn = document.getElementById('dep-adm-res-go');
      if (depAdmBtn) depAdmBtn.onclick = async () => {
        try {
          await API.post('/api/legion/deposit-resources', {
            ears:   document.getElementById('dep-adm-ears')?.value   || 0,
            tokens: document.getElementById('dep-adm-tokens')?.value || 0,
            useAdmin: true,
          });
          await App.refreshMe();
          App.rerender();
        } catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Старые постройки
      c.querySelectorAll('[data-build]').forEach(b => {
        b.onclick = async () => {
          try { await API.post('/api/legion/build', { buildingId: b.dataset.build }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Боевые постройки
      c.querySelectorAll('[data-btbld]').forEach(b => {
        b.onclick = async () => {
          try { await API.post('/api/legion/build-battle', { buildingId: b.dataset.btbld }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Технологии
      c.querySelectorAll('[data-tech]').forEach(b => {
        b.onclick = async () => {
          if (!await UI.confirm('Потребуются Резервы и уши.', {title:'Изучить технологию?', icon:'🔬', okText:'Изучить'})) return;
          try { await API.post('/api/legion/tech/start', { techId: b.dataset.tech }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Магазин
      c.querySelectorAll('[data-shop]').forEach(b => {
        b.onclick = async () => {
          const qty = document.getElementById('shop-qty-' + b.dataset.shop)?.value || 1;
          try { await API.post('/api/legion/shop/buy', { itemId: b.dataset.shop, qty }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Арсенал: взять предмет в пояс
      c.querySelectorAll('[data-gear]').forEach(b => {
        b.onclick = async () => {
          try { await API.post('/api/legion/gear/pick', { itemId: b.dataset.gear }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Вызов на бой
      c.querySelectorAll('[data-challenge]').forEach(b => {
        b.onclick = async () => {
          if (!await UI.confirm('Вызвать этот легион на бой?', {title:'Кланвойна', icon:'⚔️', okText:'Вызвать'})) return;
          try { await API.post('/api/legion/challenge', { enemyId: b.dataset.challenge }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Принять вызов
      const acceptBtn = document.getElementById('lg-accept-challenge');
      if (acceptBtn) acceptBtn.onclick = async () => {
        if (!await UI.confirm('Принять вызов на бой?', {title:'Кланвойна', icon:'⚔️', okText:'Принять'})) return;
        try { await API.post('/api/legion/challenge/accept'); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Отклонить вызов
      const declineBtn = document.getElementById('lg-decline-challenge');
      if (declineBtn) declineBtn.onclick = async () => {
        try { await API.post('/api/legion/challenge/decline'); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Подготовиться к бою — открывает боевое окно (вступление через него)
      const prepBtn = document.getElementById('lg-prepare-battle');
      if (prepBtn) prepBtn.onclick = () => App._openBattleWindow();

      // Старая война
      c.querySelectorAll('[data-war]').forEach(b => {
        b.onclick = async () => {
          if (!await UI.confirm('Объявить автоматическую войну этому легиону?', {title:'Автовойна', icon:'⚔️', okText:'Объявить', danger:true})) return;
          try { await API.post('/api/legion/war', { enemyId: b.dataset.war }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Обратный отсчёт таймера вызова
      const timerEl = document.getElementById('challenge-timer');
      if (timerEl) {
        let secs = parseInt(timerEl.textContent) || 0;
        const t = setInterval(() => {
          secs--;
          if (secs <= 0) { clearInterval(t); timerEl.textContent = '00:00'; return; }
          timerEl.textContent = UI.fmtTimer(secs);
        }, 1000);
      }
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
      <button class="btn btn-orange mt" id="g-create">Основать за <span class="ic-dollar"></span> ${UI.fmtMoney(data.rules.createCost)} (с ${data.rules.minLevel} ур.)</button>
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

App.screens.alliance = (c) => renderPersonalAlliance(c);
App.screens.legion   = (c) => renderGroupScreen(c, 'legion');

// ---------- ЛИЧНЫЙ АЛЬЯНС (у каждого игрока свой) ----------
async function renderPersonalAlliance(c) {
  await App.refreshMe();
  const data = await API.get('/api/alliance');
  const { invites } = await API.get('/api/alliance/invites');

  c.innerHTML = `
    <div class="title">🤝 Мой альянс</div>
    <div class="card">
      <p class="muted small">Альянс — ваша личная команда. Каждый боец в строю даёт <b>+${data.perMember}</b> единиц техники в бой. Приглашайте бойцов и игроков по заявкам.</p>
      <div class="kv mt"><span class="k">Бойцов в альянсе</span><span class="v gold" style="font-size:18px">${data.members} / ${data.maxMembers}</span></div>
      <div class="kv"><span class="k">Бонус техники в бой</span><span class="v gold">+${UI.fmtNum(data.bonusCapacity)}</span></div>
      <div class="kv"><span class="k">Заявок осталось (в час)</span><span class="v">${data.invitesLeft} / ${data.inviteLimit}</span></div>
      <p class="muted small mt">Лимит альянса = ваш уровень × 10. Лимит заявок в час = 5 + дипломаты.</p>
    </div>

    <div class="card">
      <div class="name">🪖 Пригласить бойца</div>
      <p class="muted small">Пригласите бойца в свой альянс. Расходует одну заявку из часового лимита.</p>
      <button class="btn btn-orange mt" id="al-invite-bot" ${data.members >= data.maxMembers || data.invitesLeft <= 0 ? 'disabled' : ''} style="width:100%">
        ${data.members >= data.maxMembers ? 'Лимит альянса достигнут' : data.invitesLeft <= 0 ? 'Заявки на час исчерпаны' : 'Пригласить бойца (заявка)'}
      </button>
    </div>

    <div class="card">
      <div class="name">🎩 Дипломаты</div>
      <p class="muted small">Каждый дипломат добавляет +1 к лимиту заявок в час. Сейчас дипломатов: <b>${data.diplomats}</b>.</p>
      <button class="btn btn-orange mt" id="al-diplomat" style="width:100%">
        Нанять дипломата за <span class="ic-gold"></span> ${UI.fmtNum(data.nextDiplomatCost)}
      </button>
    </div>

    <div class="card">
      <div class="name"><span class="ic-mail"></span> Пригласить игрока</div>
      <p class="muted small">Пригласите реального игрока. Если он примет — вам обоим +1 в личный альянс. Расходует заявку.</p>
      <div class="field-row mt">
        <input type="text" id="al-invite-name" placeholder="Позывной игрока">
        <button class="btn btn-orange btn-inline" id="al-invite-go">Пригласить</button>
      </div>
    </div>

    ${invites.length ? `
      <div class="card">
        <div class="name">📨 Приглашения вам (${invites.length})</div>
        ${invites.map((iv) => `
          <div class="list-row">
            <div class="grow"><span class="name" onclick="App.go('profile/${iv.fromId}')" style="cursor:pointer">${UI.esc(iv.fromName)}</span> зовёт в альянс</div>
            <button class="btn btn-green btn-inline" data-acc-inv="${iv.fromId}">✔</button>
            <button class="btn btn-red btn-inline" data-dec-inv="${iv.fromId}">✖</button>
          </div>`).join('')}
      </div>` : ''}

    ${data.roster && data.roster.length ? `
      <div class="card">
        <div class="title" style="margin-top:0">Состав альянса</div>
        ${data.roster.map((m) => `
          <div class="list-row">
            <div class="grow">${m.isBot ? '🪖' : '👤'} ${m.isBot ? UI.esc(m.name) : `<span class="name" onclick="App.go('profile/${m.id}')" style="cursor:pointer">${UI.esc(m.name)}</span>`}</div>
            <button class="btn btn-red btn-inline" data-remove="${m.id}">Исключить</button>
          </div>`).join('')}
      </div>` : '<div class="card center muted">В альянсе пока никого. Пригласите бойца или игрока.</div>'}`;

  const R = (id) => document.getElementById(id);
  if (R('al-invite-bot')) R('al-invite-bot').onclick = async () => {
    try { await API.post('/api/alliance/invite-bot'); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  if (R('al-diplomat')) R('al-diplomat').onclick = async () => {
    try { await API.post('/api/alliance/diplomat'); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  if (R('al-invite-go')) R('al-invite-go').onclick = async () => {
    const name = R('al-invite-name').value.trim();
    if (!name) { UI.toast('Введите позывной'); return; }
    try { await API.post('/api/alliance/invite', { name }); UI.toast('✉️ Приглашение отправлено'); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
  c.querySelectorAll('[data-acc-inv]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/alliance/accept', { fromId: b.dataset.accInv }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  c.querySelectorAll('[data-dec-inv]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/alliance/decline', { fromId: b.dataset.decInv }); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
  c.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => {
    try { await API.post('/api/alliance/remove', { memberId: b.dataset.remove }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  });
}

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
  // Чат обновляется только при отправке сообщения
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
  const unreadCount = messages.filter((msg) => !msg.read).length;
  c.innerHTML = `
    <div class="title">Почта</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn btn-orange" onclick="App.go('mail/new')" style="flex:1">✍ Написать письмо</button>
      ${unreadCount > 0 ? `<button class="btn btn-inline" id="mail-read-all">✓ Прочитать все (${unreadCount})</button>` : ''}
    </div>
    <div class="card">
      ${messages.length ? messages.map((msg) => `
        <div class="list-row" style="cursor:pointer" onclick="App.go('mail/${msg.id}')">
          <div class="grow">
            <span class="${msg.read ? 'muted' : 'name'}">${msg.read ? '📭' : '📬'} ${UI.esc(msg.fromName)}</span> — ${UI.esc(msg.subject)}
            <br><span class="muted small">${UI.fmtDate(msg.at)}</span>
          </div>
        </div>`).join('') : '<p class="muted center">Почтовый ящик пуст.</p>'}
    </div>`;
  const readAllBtn = document.getElementById('mail-read-all');
  if (readAllBtn) readAllBtn.onclick = async () => {
    try {
      await API.post('/api/mail/read-all');
      await App.refreshMe();   // обновит счётчик непрочитанных на иконке
      App.rerender();
    } catch (e) { UI.toast('⛔ ' + e.message); }
  };
};

// ---------- ЗАЛ СЛАВЫ ----------
App.screens.fame = async (c, param) => {
  const data = await API.get('/api/fame');

  // param: 'daily/level', 'alltime/ears' etc.
  const parts = (param || 'alltime/level').split('/');
  const section  = parts[0] === 'daily' ? 'daily' : 'alltime';
  const catId    = parts[1] || 'level';

  const cats = section === 'daily' ? data.daily : data.allTime;
  const cat  = cats.find(x => x.id === catId) || cats[0];

  const medals = ['🥇', '🥈', '🥉'];
  const fmtVal = (fmt, v) => {
    if (fmt === 'money') return `<span class="ic-dollar"></span>${UI.fmtMoney(v)}`;
    return UI.fmtNum(v);
  };

  // Section tabs
  const sectionTabs = `
    <div style="display:flex;gap:8px;padding:0 0 12px">
      <button class="btn ${section==='alltime'?'btn-orange':'btn-inline'}" onclick="location.hash='#fame/alltime/${cat.id}'">
        🏆 За всё время
      </button>
      <button class="btn ${section==='daily'?'btn-orange':'btn-inline'}" onclick="location.hash='#fame/daily/${cat.id}'">
        📅 Сегодня
      </button>
    </div>`;

  // Category tabs
  const catTabs = `<div class="tabs" style="flex-wrap:wrap">
    ${cats.map(x => `<div class="tab ${x.id === cat.id ? 'active' : ''}" onclick="location.hash='#fame/${section}/${x.id}'">${x.name}</div>`).join('')}
  </div>`;

  // Daily reset info
  const dailyInfo = section === 'daily' ? `
    <div class="card">
      <p class="muted small">📅 Показывает только то, что сделано <b>с начала текущего дня (МСК)</b>.</p>
      <p class="muted small mt">Данные обнуляются каждую ночь в <b>23:59 по МСК</b>.</p>
      ${data.snapshotDate ? `<p class="muted small mt">Отсчёт ведётся с: <b>${data.snapshotDate}</b></p>` : '<p class="muted small mt" style="color:var(--orange)">⚠️ Снапшот ещё не создан — появится при следующем запросе</p>'}
    </div>` : `
    <div class="card">
      <p class="muted small">🏆 Статистика за всё время — учитываются только действия самих игроков.</p>
    </div>`;

  // Top list
  const topHtml = cat.top.length
    ? cat.top.map((p, i) => `
        <div class="list-row" style="${i < 3 ? 'background:rgba(255,215,0,.04)' : ''}">
          <div style="width:32px;text-align:center;font-size:${i < 3 ? '20px' : '14px'}">${i < 3 ? medals[i] : `<span class="muted">${i+1}</span>`}</div>
          <div class="grow">
            <span class="name" style="cursor:pointer" onclick="App.go('profile/${p.id}')">${p.flag} ${UI.esc(p.name)}</span>
            <span class="muted small"> Ур. ${p.level}</span>
          </div>
          <div class="v ${cat.fmt === 'money' ? 'money' : 'gold'}">${fmtVal(cat.fmt, p.value)}</div>
        </div>`).join('')
    : '<p class="muted center" style="padding:20px">Пока никто не попал в топ</p>';

  c.innerHTML = `
    <div class="title">🎖️ Зал славы</div>
    ${sectionTabs}
    ${catTabs}
    ${dailyInfo}
    <div class="card" style="padding:0">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div class="name">${cat.name}</div>
        <div class="muted small mt">${cat.desc}</div>
      </div>
      ${topHtml}
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
        <div class="kv"><span class="k">Награблено</span><span class="v money"><span class="ic-dollar"></span> ${UI.fmtNum(p.loot)}</span></div>
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
        <div class="kv"><span class="k">Мощность удара</span><span class="v dmg-take">${p.powerPct}%</span></div>
        <div class="kv"><span class="k">Уничтожено техники</span><span class="v dmg-take">${UI.fmtNum(p.techDestroyedCount||0)} ед.${p.techLostText ? ' ('+UI.esc(p.techLostText)+')' : ''}</span></div>
        <div class="kv"><span class="k">Разрушено зданий</span><span class="v dmg-take">${UI.fmtNum(p.buildingsDestroyedCount||0)} ед.${p.destroyedBuildingsText ? ' ('+UI.esc(p.destroyedBuildingsText)+')' : ''}</span></div>`;
    } else if (n.kind === 'fatality_ear') {
      body = `
        <div class="kv"><span class="k">Кто</span><span class="v name" style="cursor:pointer" onclick="App.go('profile/${p.attackerId}')">${UI.esc(p.attackerName)}</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${when}</span></div>
        <p class="small mt">✂️ Совершил фаталити и отрезал вам ${p.doubleCut ? '<b style="color:var(--red)">оба уха одним ударом</b>' : 'ухо'}.${p.restored ? ' <span style="color:var(--green)">Но вы мгновенно восстановили ухо полевым хирургом! 🩹</span>' : ''}</p>`;
    } else if (n.kind === 'fatality_escape') {
      body = `
        <div class="kv"><span class="k">Кто пытался</span><span class="v name" style="cursor:pointer" onclick="App.go('profile/${p.attackerId}')">${UI.esc(p.attackerName)}</span></div>
        <div class="kv"><span class="k">Когда</span><span class="v">${when}</span></div>
        <p class="small mt" style="color:var(--green)">💨 Вы ускользнули от фаталити благодаря ловкости!</p>`;
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
        <div class="name">${n.kind.includes('lost') || n.kind === 'rocket_hit' ? '⚠️' : n.kind.includes('defended') || n.kind === 'fatality_mercy' ? '✅' : '<span class="ic-bell"></span>'} ${UI.esc(n.title)}</div>
        ${body}
      </div>`;
  };

  c.innerHTML = `
    <div class="title"><span class="ic-bell"></span> Уведомления</div>
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
