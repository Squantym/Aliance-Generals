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
        const tab = App._legionTab || 'buildings';

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
          activeBattleHtml = `
            <div class="card" style="border:2px solid var(--green)">
              <div class="name" style="color:var(--green)">⚔️ БОЙ ЛЕГИОНА ИДЁТ</div>
              <p class="small mt">Снарядите боевой пояс в разделе <b>Арсенал</b>.</p>
            </div>`;
        }

        // ── Вкладка: Постройки ─────────────────────────────────────────
        const bnHtml = L.buildings.map((b) => `
          <div class="card">
            <div class="name">🏛 ${UI.esc(b.name)} <span class="muted">ур. ${b.level}/${b.maxLevel}</span></div>
            <div class="muted small">${UI.esc(b.desc)}</div>
            <div class="kv mt"><span class="k">Бонус</span><span class="v">+${b.bonusNow}%</span></div>
            ${b.nextPrice !== null
              ? `<div class="kv"><span class="k">След. ур. +${b.bonusNext}%</span><span class="v money">$${UI.fmtMoney(b.nextPrice)}</span></div>
                 ${L.isLeader ? `<button class="btn btn-orange mt" data-build="${b.id}">Улучшить из казны</button>`
                              : '<p class="muted small mt center">Только лидер</p>'}`
              : '<p class="gold center mt small">Макс. уровень ✔</p>'}
          </div>`).join('');

        const btBldHtml = L.battleBuildings.map((b) => {
          const c = b.nextCost;
          let resStr = '';
          if (c) {
            resStr = `${UI.fmtNum(c.kmarks)} КМ`;
            if (c.ears)   resStr += ` + ${c.ears} 👂`;
            if (c.tokens) resStr += ` + ${c.tokens} 🎖`;
          }
          return `
            <div class="card">
              <div class="name">${UI.esc(b.name)} <span class="muted">ур. ${b.level}/${b.maxLevel}</span></div>
              <div class="muted small">${UI.esc(b.desc)}</div>
              <div class="kv mt"><span class="k">Бонус</span><span class="v">${b.bonusNow}${b.apply === 'gear_slots' ? ' слот.' : '%'}</span></div>
              ${c ? `<div class="kv"><span class="k">Цена</span><span class="v">${resStr}</span></div>
                     ${L.isLeader ? `<button class="btn btn-orange mt" data-btbld="${b.id}">Улучшить</button>`
                                  : '<p class="muted small mt center">Только лидер</p>'}`
                : '<p class="gold center mt small">Макс. уровень ✔</p>'}
            </div>`;
        }).join('');

        const buildingsTab = `
          <div class="card">
            <div class="title" style="margin-top:0">Казна легиона</div>
            <div class="kv"><span class="k">Доллары</span><span class="v money">$${UI.fmtMoney(L.treasury)}</span></div>
            <div class="kv"><span class="k">Стальные марки</span><span class="v gold">${UI.fmtNum(L.kmarks)} КМ</span></div>
            <div class="kv"><span class="k">Рейтинг клана</span><span class="v">${UI.fmtNum(L.ratingPoints)} очк.</span></div>
            <div class="field-row mt">
              <input type="number" id="lg-dep" min="1" placeholder="Внести $">
              <button class="btn btn-orange btn-inline" id="lg-dep-go">Внести</button>
            </div>
            <hr class="hr">
            <p class="muted small">Обмен $ → Стальные марки (1 000 $ = 1 КМ)</p>
            <div class="field-row mt">
              <input type="number" id="lg-exch" min="1000" step="1000" placeholder="Сумма $">
              <button class="btn btn-orange btn-inline" id="lg-exch-go">Обменять</button>
            </div>
          </div>
          <div class="name mt" style="padding:0 16px">🏛 Общие постройки</div>
          ${bnHtml}
          <div class="name mt" style="padding:0 16px">⚔️ Боевые постройки</div>
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
                let reqStr = `${UI.fmtNum(nd.priceKmarks)} КМ + ${nd.earReq} 👂`;
                if (nd.ratingReq > 0) reqStr += ` · Рейтинг: ${UI.fmtNum(nd.ratingReq)}`;
                statusHtml = `
                  <div class="kv mt"><span class="k">Цена ур.${t.level+1}</span><span class="v">${reqStr}</span></div>
                  <div class="kv"><span class="k">Время</span><span class="v">${nd.daysBase} дн.</span></div>
                  ${t.canLearn
                    ? `<button class="btn btn-orange mt" data-tech="${t.id}">🔬 Изучить</button>`
                    : `<p class="muted small mt">${nd.ratingReq > L.ratingPoints
                        ? `Нужно рейтинга: ${UI.fmtNum(nd.ratingReq)}`
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

          // ── РЕЖИМ БОЯ ─────────────────────────────────────────────
          if (battleData) {
            const b = battleData;

            // Шапка боя
            const phaseLabel = b.phase === 'prep'
              ? `⏳ Подготовка — осталось <b id="prep-timer">${UI.fmtTimer(b.prepSecsLeft)}</b>`
              : b.phase === 'active'
                ? `⚔️ БОЙ ИДЁТ — осталось <b id="battle-timer">${UI.fmtTimer(b.timeLeft || 0)}</b>`
                : '🏁 БОЙ ЗАВЕРШЁН';

            html += `<div class="card" style="border:2px solid var(--${b.phase==='active'?'green':b.phase==='prep'?'orange':'red'})">
              <div class="name">${phaseLabel}</div>
              ${b.phase === 'active' && b.liveScores ? `
                <div class="kv mt">
                  <span class="k" style="color:var(--green)">Ваш легион</span>
                  <span class="v" style="color:var(--red)">Противник</span>
                </div>
                <div class="kv">
                  <span class="k gold">${UI.fmtNum(b.liveScores[b.mySide] || 0)} очк.</span>
                  <span class="v">${UI.fmtNum(b.liveScores[b.mySide === 'A' ? 'B' : 'A'] || 0)} очк.</span>
                </div>
                <p class="muted small mt">По очкам активности определяется победитель если время выйдет</p>` : ''}
            </div>`;

            // Фаза ПОДГОТОВКИ
            if (b.phase === 'prep') {
              if (!b.me) {
                // Не зарегистрирован — показываем форму выбора роли
                html += `<p class="small mt">Выберите роль и нажмите «Готов»:</p>
                  <div class="btn-row mt">
                    <button class="btn btn-orange" data-join="assault">⚔️ Штурмовик<br><span class="muted small">+20% атаки, только атака</span></button>
                    <button class="btn btn-orange" data-join="guardian">🛡️ Защитник<br><span class="muted small">+20% защиты, прикрытие</span></button>
                    <button class="btn btn-orange" data-join="medic">💊 Медик<br><span class="muted small">Лечение союзников</span></button>
                  </div>`;
              } else {
                html += `<p class="small mt">Вы готовы как <b>${b.me.roleName}</b>. Выберите направление:</p>
                  <div class="btn-row mt">
                    ${[1,2,3,4,5].map(d => {
                      const dirData = b.directions.find(x=>x.dir===d);
                      const allies = dirData ? dirData.allies.length : 0;
                      const sel = b.me.direction === d;
                      return `<button class="btn ${sel?'btn-green':'btn-inline'}" data-dir="${d}">Нап. ${d}<br><span class="muted small">${allies}/5 союзн.</span></button>`;
                    }).join('')}
                  </div>`;
              }
            }

            html += `</div>`;

            // Список участников в подготовке
            if (b.phase === 'prep') {
              const sides = { A: [], B: [] };
              for (const c of b.allCombatants) sides[c.side].push(c);
              html += `<div class="card">
                <div class="name">👥 Участники подготовки</div>
                <div class="kv mt"><span class="k" style="color:var(--green)">Ваш легион</span><span class="k" style="color:var(--red)">Противник</span></div>`;
              const maxLen = Math.max(sides.A.length, sides.B.length);
              for (let i = 0; i < maxLen; i++) {
                const a = sides[b.mySide][i];
                const en = sides[b.mySide==='A'?'B':'A'][i];
                html += `<div class="kv">
                  <span class="k">${a ? `<span style="color:${a.ready?'var(--green)':'var(--red)'}">●</span> ${UI.esc(a.name)} (${a.role?a.role[0].toUpperCase():'?'}) нап.${a.direction||'?'}` : ''}</span>
                  <span class="v">${en ? `нап.${en.direction||'?'} (${en.role?en.role[0].toUpperCase():'?'}) ${UI.esc(en.name)} <span style="color:var(--red)">●</span>` : ''}</span>
                </div>`;
              }
              html += `</div>`;
            }

            // Карта направлений в активном бою
            if (b.phase === 'active' && b.me) {
              const myCDs = b.cooldowns || {};

              // Мой статус
              html += `<div class="card">
                <div class="name">👤 Вы — ${b.me.roleName}</div>
                <div class="kv mt"><span class="k">HP</span><span class="v">${b.me.hp} / ${b.me.maxHp}</span></div>
                ${b.me.shield > 0 ? `<div class="kv"><span class="k">Щит</span><span class="v">${b.me.shield}</span></div>` : ''}
                ${b.me.stunned ? `<div class="kv"><span class="k" style="color:var(--red)">Оглушён</span><span class="v">${b.me.stunned} сек</span></div>` : ''}
                ${b.me.noHeal  ? `<div class="kv"><span class="k" style="color:var(--orange)">Лечение заблок.</span><span class="v">${b.me.noHeal} сек</span></div>` : ''}
                ${b.me.onFire  ? `<div class="kv"><span class="k" style="color:var(--orange)">🔥 Горит</span><span class="v"></span></div>` : ''}
                ${b.me.immune  ? `<div class="kv"><span class="k" style="color:var(--green)">🔵 Купол</span><span class="v">${b.me.immune} сек</span></div>` : ''}
                ${b.me.reflecting ? `<div class="kv"><span class="k" style="color:var(--green)">🪞 Отражение</span><span class="v">активно</span></div>` : ''}
                <div class="kv mt"><span class="k">Кд действия</span><span class="v" id="cd-action">${myCDs.action || 0} сек</span></div>
                <div class="kv"><span class="k">Кд перемещения</span><span class="v" id="cd-move">${myCDs.move || 0} сек</span></div>
                ${b.me.gear && b.me.gear.length ? `<div class="kv mt"><span class="k">Пояс</span><span class="v">${b.me.gear.join(', ')}</span></div>` : ''}
              </div>`;

              // Смена направления
              html += `<div class="card">
                <div class="name">📍 Направление: ${b.me.direction !== null ? b.me.direction : 'не выбрано'}</div>
                <div class="btn-row mt">
                  ${[1,2,3,4,5].map(d => {
                    const dd = b.directions.find(x=>x.dir===d);
                    const en = dd ? dd.enemies.length : 0;
                    const al = dd ? dd.allies.length : 0;
                    const sel = b.me.direction === d;
                    return `<button class="btn btn-inline ${sel?'btn-green':''}" data-dir="${d}">Нап.${d} (${al}🟢${en}🔴)</button>`;
                  }).join('')}
                </div>
              </div>`;

              // Направление игрока: список врагов и союзников
              if (b.me.direction !== null) {
                const dirData = b.directions.find(x => x.dir === b.me.direction);
                if (dirData) {
                  // Союзники
                  if (dirData.allies.length > 0) {
                    html += `<div class="card"><div class="name" style="color:var(--green)">🟢 Союзники нап.${b.me.direction}</div>`;
                    for (const a of dirData.allies) {
                      if (a.userId === App.me.id) continue;
                      html += `<div class="list-row">
                        <div class="grow">
                          <b>${UI.esc(a.name)}</b> [${a.roleName}]
                          <span class="small muted"> HP: ${a.hp}/${a.maxHp}</span>
                          ${a.shield > 0 ? ` 🛡${a.shield}` : ''}
                        </div>
                        ${b.me.role === 'guardian' ? `<button class="btn btn-inline btn-orange" data-guard="${a.userId}">🛡️ Прикрыть</button>` : ''}
                        ${b.me.role === 'medic'    ? `<button class="btn btn-inline btn-green"  data-heal="${a.userId}">💊 Лечить</button>` : ''}
                      </div>`;
                    }
                    html += `</div>`;
                  }

                  // Враги
                  if (dirData.enemies.length > 0) {
                    html += `<div class="card"><div class="name" style="color:var(--red)">🔴 Враги нап.${b.me.direction}</div>`;
                    for (const en of dirData.enemies) {
                      const hpPct = Math.round(en.hp / en.maxHp * 100);
                      html += `<div class="list-row">
                        <div class="grow">
                          <b>${UI.esc(en.name)}</b> [${en.roleName}]
                          <span class="small"> HP: ${en.hp}/${en.maxHp} (${hpPct}%)</span>
                          ${en.stunned ? ` 💫${en.stunned}с` : ''}
                          ${en.onFire  ? ' 🔥' : ''}
                          ${en.shield > 0 ? ` 🛡${en.shield}` : ''}
                        </div>
                        ${b.me.role !== 'medic' ? `<button class="btn btn-red btn-inline" data-attack="${en.userId}">⚔️ Атаковать</button>` : ''}
                        ${b.me.gear && b.me.gear.length ? `<button class="btn btn-orange btn-inline" data-item-target="${en.userId}" onclick="App._itemTarget='${en.userId}'">🎒 Предмет</button>` : ''}
                      </div>`;
                    }
                    html += `</div>`;
                  }

                  if (dirData.allies.length <= 1 && dirData.enemies.length === 0) {
                    html += `<div class="card"><p class="muted center small">На этом направлении никого нет</p></div>`;
                  }
                }
              }

              // Предметы в поясе
              if (b.me.gear && b.me.gear.length > 0) {
                html += `<div class="card"><div class="name">🎒 Боевой пояс</div>`;
                const usedItems = new Set();
                for (const itemId of b.me.gear) {
                  if (usedItems.has(itemId)) continue;
                  usedItems.add(itemId);
                  const cnt = b.me.gear.filter(x=>x===itemId).length;
                  const itemNames = {
                    gas_grenade:'💨 Газовая шашка', flashbang:'💥 Светошумовая',
                    assault_grenade:'🔴 Граната', napalm:'🔥 Напалм',
                    uranium_ammo:'☢️ Урановые боеприпасы', hydrogen_bomb:'💣 Водородная бомба',
                    medkit:'🩹 Аптечка', dome:'🔵 Купол',
                    kevlar:'🦺 Бронеплиты', reflect_shield:'🪞 Отраж. щит',
                  };
                  html += `<div class="kv mt"><span class="k">${itemNames[itemId]||itemId} ×${cnt}</span>
                    <span class="v"><button class="btn btn-orange btn-inline" data-use-item="${itemId}">Применить</button></span></div>`;
                }
                html += `</div>`;
              }
            }

            // Лог боя
            if (b.log && b.log.length) {
              html += `<div class="card"><div class="name">📋 Лог боя</div>
                <div style="max-height:200px;overflow-y:auto;font-size:12px">
                  ${b.log.slice().reverse().map(e => {
                    const col = e.kind==='crit'?'var(--red)':e.kind==='heal'?'var(--green)':e.kind==='item'?'var(--orange)':'inherit';
                    return `<div style="color:${col};padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05)">${UI.esc(e.text)}</div>`;
                  }).join('')}
                </div>
              </div>`;
            }

            // Итог
            if (b.phase === 'done') {
              const won = b.winningSide === b.mySide;
              const r = b.finalReport;
              const reasonText = { elimination: 'Все противники уничтожены', time: 'Время истекло — победа по очкам активности', no_show: 'Противник не явился' };

              html += `<div class="card" style="border:2px solid var(--${won?'green':'red'})">
                <div class="name" style="color:var(--${won?'green':'red'})">${won ? '🏆 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ'}</div>
                <p class="muted small mt">${reasonText[b.finishReason] || ''}</p>
                ${r ? `
                  <hr class="hr">
                  <div class="kv mt"><span class="k" style="color:var(--green)">Очки вашего легиона</span><span class="v gold">${UI.fmtNum(r.activityScores[b.mySide] || 0)}</span></div>
                  <div class="kv"><span class="k" style="color:var(--red)">Очки противника</span><span class="v">${UI.fmtNum(r.activityScores[b.mySide==='A'?'B':'A'] || 0)}</span></div>
                  <hr class="hr">
                  <div class="name" style="font-size:13px">🏅 Лучшие бойцы боя</div>
                  ${r.topAssault  ? `<div class="kv mt"><span class="k">⚔️ Топ штурмовик</span><span class="v">${UI.esc(r.topAssault.name)} — ${UI.fmtNum(r.topAssault.stats.dmgDealt)} урона</span></div>` : ''}
                  ${r.topGuardian ? `<div class="kv"><span class="k">🛡️ Топ защитник</span><span class="v">${UI.esc(r.topGuardian.name)} — ${r.topGuardian.stats.guards} прикрытий</span></div>` : ''}
                  ${r.topMedic    ? `<div class="kv"><span class="k">💊 Топ медик</span><span class="v">${UI.esc(r.topMedic.name)} — ${UI.fmtNum(r.topMedic.stats.healed)} вылечено</span></div>` : ''}
                  <hr class="hr">
                  <div class="name" style="font-size:13px">📊 Ваша статистика</div>
                  ${b.me ? (() => {
                    const myReport = r.playerDetails[b.me.userId];
                    return myReport ? `
                      <div class="kv mt"><span class="k">Роль</span><span class="v">${ROLES && ROLES[myReport.role] ? ROLES[myReport.role].label : myReport.role}</span></div>
                      <div class="kv"><span class="k">Урон нанесён</span><span class="v">${UI.fmtNum(myReport.stats.dmgDealt)}</span></div>
                      <div class="kv"><span class="k">Урон получен</span><span class="v">${UI.fmtNum(myReport.stats.dmgTaken)}</span></div>
                      <div class="kv"><span class="k">Убийств</span><span class="v">${myReport.stats.kills}</span></div>
                      ${myReport.role === 'medic'    ? `<div class="kv"><span class="k">Вылечено HP</span><span class="v">${UI.fmtNum(myReport.stats.healed)}</span></div>` : ''}
                      ${myReport.role === 'guardian' ? `<div class="kv"><span class="k">Прикрытий</span><span class="v">${myReport.stats.guards}</span></div>` : ''}
                      <div class="kv"><span class="k">Предметов исп.</span><span class="v">${myReport.stats.itemsUsed}</span></div>
                      <div class="kv"><span class="k">Очков активности</span><span class="v gold">${myReport.score}</span></div>` : '';
                  })() : ''}
                  <hr class="hr">
                  <div class="name" style="font-size:13px">📋 Все участники</div>
                  ${Object.values(r.playerDetails).sort((a,b2)=>b2.score-a.score).map(p => `
                    <div class="kv" style="opacity:${p.side===b.mySide?1:0.65}">
                      <span class="k">${p.side===b.mySide?'🟢':'🔴'} ${UI.esc(p.name)}</span>
                      <span class="v">${UI.fmtNum(p.score)} очк. · ${UI.fmtNum(p.stats.dmgDealt)} урона · ${p.stats.kills} убийств</span>
                    </div>`).join('')}
                ` : ''}
                <button class="btn btn-orange mt" onclick="App._legionTab='war';App.rerender()">← К легиону</button>
              </div>`;
            }

            return html;
          }

          // ── РЕЖИМ ОЖИДАНИЯ (нет активного боя) ───────────────────
          if (L.canChallenge) {
            html += `<div class="card">
              <div class="name">⚔️ Вызвать на бой</div>
              <p class="muted small mt">Победитель получает КМ из казны врага + рейтинговые очки.</p>
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
            html += `<div class="card"><div class="name">📜 История боёв</div>
              ${L.battleHistory.map(h => `
                <div class="kv"><span class="k">${h.won?'🏆':'💀'} ${h.won?'Победа':'Поражение'}</span>
                <span class="v ${h.loot>=0?'green':'red'}">${h.loot>=0?'+':''}${UI.fmtNum(h.loot)} КМ</span></div>`).join('')}
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
            <div class="name">💰 Финансы</div>
            <div class="kv mt"><span class="k">Доллары в казне</span><span class="v money">$${UI.fmtMoney(L.treasury)}</span></div>
            <div class="kv"><span class="k">Стальные марки</span><span class="v gold">${UI.fmtNum(L.kmarks)} КМ</span></div>
            <div class="kv"><span class="k">Рейтинг клана</span><span class="v">${UI.fmtNum(L.ratingPoints)} очк.</span></div>
            <p class="muted small mt">Курс: 1 000 $ = 1 КМ</p>
            <div class="field-row mt">
              <input type="number" id="lg-exch2" min="1000" step="1000" placeholder="$ → КМ">
              <button class="btn btn-orange btn-inline" id="lg-exch2-go">Обменять</button>
            </div>
          </div>
          <div class="card">
            <div class="name">🗄 Казначейство ресурсов</div>
            <p class="muted small">Уши и жетоны клана. Из казначейства лидер закупает предметы в магазине.</p>
            <div class="kv mt"><span class="k">Уши 👂</span><span class="v">${UI.fmtNum(L.treasuryEars || 0)}</span></div>
            <div class="kv"><span class="k">Жетоны 🎖</span><span class="v">${UI.fmtNum(L.treasuryTokens || 0)}</span></div>
            <p class="muted small mt">Внести в казначейство (из вашего инвентаря):</p>
            <div class="field-row mt">
              <input type="number" min="1" placeholder="Ушей 👂" id="dep-ears">
              <input type="number" min="1" placeholder="Жетонов 🎖" id="dep-tokens">
              <button class="btn btn-orange btn-inline" id="dep-res-go">Внести</button>
            </div>
          </div>`;

        // ── Навигация по вкладкам ─────────────────────────────────────
        const tabs = [
          { id: 'buildings',   label: '🏗 Постройки' },
          { id: 'techs',       label: '🔬 Технологии' },
          { id: 'arsenal',     label: '🎒 Арсенал' },
          { id: 'shop',        label: '🛒 Магазин' },
          { id: 'war',         label: '⚔️ Война' },
          { id: 'treasury',    label: '💰 Казначейство' },
        ];
        const tabNav = `<div class="tab-nav" style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0">
          ${tabs.map(t => `<button class="btn btn-inline ${tab === t.id ? 'btn-orange' : ''}" data-legtab="${t.id}">${t.label}</button>`).join('')}
        </div>`;

        const tabContent = {
          buildings: buildingsTab, techs: techsTab, arsenal: arsenalTab,
          shop: shopTab, war: warTab, treasury: treasuryTab,
        }[tab] || buildingsTab;

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

      // Таймер подготовки (обратный отсчёт без перезагрузки страницы)
      const prepTimerEl = document.getElementById('prep-timer');
      if (prepTimerEl) {
        let secs = parseInt(prepTimerEl.textContent) || 0;
        const pt = setInterval(() => {
          secs--;
          if (secs <= 0) { clearInterval(pt); App.rerender(); return; }
          prepTimerEl.textContent = UI.fmtTimer(secs);
        }, 1000);
      }

      // Таймер активного боя (1 час)
      const battleTimerEl = document.getElementById('battle-timer');
      if (battleTimerEl) {
        let secs = parseInt(battleTimerEl.textContent) || 0;
        const bt = setInterval(() => {
          secs--;
          if (secs <= 0) { clearInterval(bt); App.rerender(); return; }
          battleTimerEl.textContent = UI.fmtTimer(secs);
        }, 1000);
      }

      // Кулдауны: визуальный обратный отсчёт
      const cdAction = document.getElementById('cd-action');
      const cdMove   = document.getElementById('cd-move');
      if (cdAction || cdMove) {
        const cdTick = setInterval(() => {
          if (cdAction) {
            let v = Math.max(0, parseInt(cdAction.textContent) - 1);
            cdAction.textContent = v + ' сек';
          }
          if (cdMove) {
            let v = Math.max(0, parseInt(cdMove.textContent) - 1);
            cdMove.textContent = v + ' сек';
          }
        }, 1000);
      }

      // Вкладки, вызов, постройки, магазин — уже обработаны ниже
      c.querySelectorAll('[data-legtab]').forEach(btn => {
        btn.onclick = () => { App._legionTab = btn.dataset.legtab; App.rerender(); };
      });

      // Внести в казну
      const depBtn = document.getElementById('lg-dep-go');
      if (depBtn) depBtn.onclick = async () => {
        try { await API.post('/api/legion/deposit', { amount: document.getElementById('lg-dep').value }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Обмен $ → КМ (из вкладки Постройки)
      const exchBtn = document.getElementById('lg-exch-go');
      if (exchBtn) exchBtn.onclick = async () => {
        try { await API.post('/api/legion/exchange', { dollars: document.getElementById('lg-exch').value }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Обмен $ → КМ (из Казначейства)
      const exchBtn2 = document.getElementById('lg-exch2-go');
      if (exchBtn2) exchBtn2.onclick = async () => {
        try { await API.post('/api/legion/exchange', { dollars: document.getElementById('lg-exch2').value }); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Внести уши/жетоны в казначейство
      const depResBtn = document.getElementById('dep-res-go');
      if (depResBtn) depResBtn.onclick = async () => {
        try {
          await API.post('/api/legion/deposit-resources', {
            ears:   document.getElementById('dep-ears')?.value   || 0,
            tokens: document.getElementById('dep-tokens')?.value || 0,
          });
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
          if (!confirm('Начать изучение этой технологии? Потребуются КМ и уши.')) return;
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
          if (!confirm('Вызвать этот легион на бой?')) return;
          try { await API.post('/api/legion/challenge', { enemyId: b.dataset.challenge }); App.rerender(); }
          catch (e) { UI.toast('⛔ ' + e.message); }
        };
      });

      // Принять вызов
      const acceptBtn = document.getElementById('lg-accept-challenge');
      if (acceptBtn) acceptBtn.onclick = async () => {
        if (!confirm('Принять вызов на бой?')) return;
        try { await API.post('/api/legion/challenge/accept'); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Отклонить вызов
      const declineBtn = document.getElementById('lg-decline-challenge');
      if (declineBtn) declineBtn.onclick = async () => {
        try { await API.post('/api/legion/challenge/decline'); App.rerender(); }
        catch (e) { UI.toast('⛔ ' + e.message); }
      };

      // Старая война
      c.querySelectorAll('[data-war]').forEach(b => {
        b.onclick = async () => {
          if (!confirm('Объявить автоматическую войну этому легиону?')) return;
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
          if (secs <= 0) { clearInterval(t); App.rerender(); return; }
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
