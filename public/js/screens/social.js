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
            resStr = `$${UI.fmtMoney(c.dollars)} из казны`;
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
            <p class="muted small">Постройки — эндгейм контент. Цена высокая: $500 млрд и выше из казны легиона. Для улучшений потребуются уши 👂 и жетоны 🎖 из казначейства.</p>
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

          // ── РЕЖИМ БОЯ ─────────────────────────────────────────────
          if (battleData) {
            const b = battleData;
            const ROLE_ICON = { assault: '🎯', guardian: '🛡️', medic: '➕' };

            // В фазе подготовки — скрываем все вкладки кроме "Война"
            // (tab уже === 'war' так как мы здесь)

            // ── ФАЗА ПОДГОТОВКИ ────────────────────────────────────
            if (b.phase === 'prep') {
              html += `
                <div style="background:rgba(255,150,0,.1);border:2px solid var(--orange);border-radius:8px;padding:12px;margin-bottom:12px">
                  <div style="font-size:16px;font-weight:bold">⏳ Подготовка к бою — осталось <span id="prep-timer">${UI.fmtTimer(b.prepSecsLeft)}</span></div>
                  <p class="muted small mt">Нажмите «Готов», выберите роль и направление. Те кто не успеет — не попадут в бой.</p>
                </div>`;

              if (!b.me) {
                html += `
                  <div class="card">
                    <div class="name">Выберите роль и нажмите «Готов»</div>
                    <p class="muted small mt">Все роли могут атаковать. Дополнительные возможности — ниже.</p>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
                      <button class="btn btn-orange" style="width:100%;padding:14px" data-join="assault">
                        🎯 <b>Штурмовик</b> — +20% атаки
                      </button>
                      <button class="btn btn-orange" style="width:100%;padding:14px" data-join="guardian">
                        🛡️ <b>Защитник</b> — +20% защиты, −20% входящего урона, щит, прикрытие союзников
                      </button>
                      <button class="btn btn-orange" style="width:100%;padding:14px" data-join="medic">
                        ➕ <b>Медик</b> — лечение союзников, может атаковать со штрафом
                      </button>
                    </div>
                  </div>`;
              } else {
                html += `
                  <div class="card" style="border:2px solid var(--green)">
                    <div class="name" style="color:var(--green)">✅ Вы готовы — ${ROLE_ICON[b.me.role] || ''} ${b.me.roleName}</div>
                    <p class="muted small mt">Выберите направление:</p>
                    <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
                      ${b.directions.map(d => {
                        const sel = b.me.direction === d.dir;
                        const allyCount = d.allies ? d.allies.length : 0;
                        return `<button class="btn ${sel ? 'btn-green' : 'btn-inline'}" style="width:100%;padding:12px;text-align:left" data-dir="${d.dir}">
                          ${sel ? '📍' : '○'} <b>${d.name}</b>
                          <span class="muted small" style="float:right">${allyCount}/5 союзников</span>
                        </button>`;
                      }).join('')}
                    </div>
                  </div>`;
              }

              // Список готовых участников
              const sides = { A: [], B: [] };
              for (const c of b.allCombatants) sides[c.side].push(c);
              const mySideList  = sides[b.mySide]  || [];
              const enSideList  = sides[b.mySide === 'A' ? 'B' : 'A'] || [];

              html += `<div class="card">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
                  <div style="border-right:1px solid var(--border);padding-right:8px">
                    <div class="name" style="color:var(--green);margin-bottom:8px">🟢 Ваш легион (${mySideList.length})</div>
                    ${mySideList.map(c => `
                      <div style="padding:6px 0;border-bottom:1px solid var(--border-dim)">
                        ${ROLE_ICON[c.role] || '?'} <b>${UI.esc(c.name)}</b>
                        ${c.direction ? `<span class="muted small"> → ${c.dirName || 'Нап.'+c.direction}</span>` : '<span class="muted small"> ожидает...</span>'}
                      </div>`).join('')}
                    ${mySideList.length === 0 ? '<p class="muted small">Никого ещё</p>' : ''}
                  </div>
                  <div style="padding-left:8px">
                    <div class="name" style="color:var(--red);margin-bottom:8px">🔴 Противник (${enSideList.length})</div>
                    ${enSideList.map(c => `
                      <div style="padding:6px 0;border-bottom:1px solid var(--border-dim)">
                        ${ROLE_ICON[c.role] || '?'} <b>${UI.esc(c.name)}</b>
                      </div>`).join('')}
                    ${enSideList.length === 0 ? '<p class="muted small">Никого ещё</p>' : ''}
                  </div>
                </div>
              </div>`;
            }

            // ── АКТИВНЫЙ БОЙ ───────────────────────────────────────
            if (b.phase === 'active' && b.me) {
              const myCDs = b.cooldowns || {};

              // Полноэкранный режим — шапка с таймером и счётом
              html += `
                <div style="background:rgba(0,200,0,.08);border:2px solid var(--green);border-radius:8px;padding:10px;margin-bottom:10px">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="color:var(--green);font-weight:bold">⚔️ БОЙ ИДЁТ</span>
                    <span>⏱ <b id="battle-timer">${UI.fmtTimer(b.timeLeft || 0)}</b></span>
                  </div>
                  ${b.liveScores ? `
                  <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:13px">
                    <span style="color:var(--green)">🟢 Ваши: ${UI.fmtNum(b.liveScores[b.mySide] || 0)} очк.</span>
                    <span style="color:var(--red)">🔴 Врagi: ${UI.fmtNum(b.liveScores[b.mySide==='A'?'B':'A'] || 0)} очк.</span>
                  </div>` : ''}
                </div>`;

              // Мой статус — полная строка
              const hpPct = Math.round(b.me.hp / b.me.maxHp * 100);
              html += `
                <div class="card" style="margin-bottom:8px">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <span style="font-size:20px">${ROLE_ICON[b.me.role] || '?'}</span>
                    <b>Вы — ${b.me.roleName}</b>
                    ${b.me.stunned ? `<span style="color:var(--red);font-size:12px">💫 Оглушён ${b.me.stunned}с</span>` : ''}
                    ${b.me.noHeal  ? `<span style="color:var(--orange);font-size:12px">🚫 Лечение заблок. ${b.me.noHeal}с</span>` : ''}
                    ${b.me.immune  ? `<span style="color:var(--green);font-size:12px">🔵 Купол ${b.me.immune}с</span>` : ''}
                    ${b.me.reflecting ? `<span style="color:var(--green);font-size:12px">🪞 Отражение</span>` : ''}
                    ${b.me.onFire  ? `<span style="color:var(--orange);font-size:12px">🔥 Горит</span>` : ''}
                  </div>
                  <div style="background:rgba(255,80,80,.15);border-radius:4px;height:8px;margin-bottom:4px;overflow:hidden">
                    <div style="background:var(--red);height:100%;width:${hpPct}%;transition:width .3s"></div>
                  </div>
                  <div style="font-size:12px;color:var(--dim)">HP ${b.me.hp} / ${b.me.maxHp} (${hpPct}%)
                  ${b.me.shield > 0 ? ` · 🛡 Щит: ${b.me.shield}` : ''}
                  </div>
                  <div style="font-size:12px;margin-top:4px">
                    Кд действия: <span id="cd-action">${myCDs.action || 0}</span>с &nbsp;|&nbsp;
                    Кд перемещения: <span id="cd-move">${myCDs.move || 0}</span>с
                  </div>
                </div>`;

              // Направления — каждое на всю ширину
              html += `<div class="name" style="padding:0;margin-bottom:6px">📍 Направление: ${b.me.direction !== null ? (b.directions.find(x=>x.dir===b.me.direction)||{}).name || 'Нап.'+b.me.direction : 'не выбрано'}</div>`;

              html += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
                ${b.directions.map(d => {
                  const sel = b.me.direction === d.dir;
                  const cdMove = myCDs.move || 0;
                  return `<button class="btn btn-inline ${sel?'btn-green':''}" style="width:100%;padding:10px;text-align:left;${sel?'border:2px solid var(--green)':''}"
                    data-dir="${d.dir}">
                    ${sel ? '📍' : '○'} <b>${d.name}</b>
                    <span style="float:right;font-size:12px">
                      🟢 ${d.allies.filter(a=>a.alive).length} союзн. &nbsp; 🔴 ${d.enemies.filter(e=>e.alive).length} врагов
                    </span>
                  </button>`;
                }).join('')}
              </div>`;

              // Текущее направление — союзники и враги
              if (b.me.direction !== null) {
                const dirData = b.directions.find(x => x.dir === b.me.direction);
                if (dirData) {
                  // Союзники
                  const aliveAllies = dirData.allies.filter(a => a.userId !== (b.me && b.me.userId) && a.alive);
                  if (aliveAllies.length > 0) {
                    html += `<div class="card" style="margin-bottom:8px">
                      <div style="color:var(--green);font-weight:bold;margin-bottom:8px">🟢 Союзники на «${dirData.name}»</div>
                      ${aliveAllies.map(a => {
                        const ahp = Math.round(a.hp / a.maxHp * 100);
                        return `<div style="padding:8px 0;border-bottom:1px solid var(--border-dim)">
                          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                            <span style="font-size:16px">${ROLE_ICON[a.role] || '?'}</span>
                            <b>${UI.esc(a.name)}</b>
                            <span class="muted small">${a.roleName}</span>
                            ${a.shield > 0 ? `<span style="font-size:11px">🛡${a.shield}</span>` : ''}
                          </div>
                          <div style="background:rgba(0,200,0,.15);border-radius:4px;height:6px;margin-bottom:2px;overflow:hidden">
                            <div style="background:var(--green);height:100%;width:${ahp}%"></div>
                          </div>
                          <div style="font-size:11px;color:var(--dim)">HP ${a.hp}/${a.maxHp}</div>
                          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                            ${b.me.role === 'guardian' ? `<button class="btn btn-orange btn-inline" style="flex:1" data-guard="${a.userId}">🛡️ Прикрыть (15с)</button>` : ''}
                            ${b.me.role === 'medic'    ? `<button class="btn btn-green btn-inline" style="flex:1" data-heal="${a.userId}">➕ Лечить</button>` : ''}
                          </div>
                        </div>`;
                      }).join('')}
                    </div>`;
                  }

                  // Враги
                  const aliveEnemies = dirData.enemies.filter(e => e.alive);
                  if (aliveEnemies.length > 0) {
                    html += `<div class="card" style="margin-bottom:8px">
                      <div style="color:var(--red);font-weight:bold;margin-bottom:8px">🔴 Враги на «${dirData.name}»</div>
                      ${aliveEnemies.map(en => {
                        const ehp = Math.round(en.hp / en.maxHp * 100);
                        return `<div style="padding:8px 0;border-bottom:1px solid var(--border-dim)">
                          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                            <span style="font-size:16px">${ROLE_ICON[en.role] || '?'}</span>
                            <b>${UI.esc(en.name)}</b>
                            <span class="muted small">${en.roleName}</span>
                            ${en.stunned ? `<span style="color:var(--orange);font-size:11px">💫${en.stunned}с</span>` : ''}
                            ${en.onFire  ? `<span style="color:var(--orange);font-size:11px">🔥</span>` : ''}
                            ${en.shield > 0 ? `<span style="font-size:11px">🛡${en.shield}</span>` : ''}
                          </div>
                          <div style="background:rgba(255,50,50,.2);border-radius:4px;height:6px;margin-bottom:2px;overflow:hidden">
                            <div style="background:var(--red);height:100%;width:${ehp}%"></div>
                          </div>
                          <div style="font-size:11px;color:var(--dim)">HP ${en.hp}/${en.maxHp} (${ehp}%)</div>
                          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                            <button class="btn btn-red btn-inline" style="flex:1" data-attack="${en.userId}">🎯 Атаковать</button>
                            ${b.me.gear && b.me.gear.length ? `<button class="btn btn-orange btn-inline" style="flex:1" onclick="App._itemTarget='${en.userId}';App._itemTargetName='${en.name.replace(/'/g,'').slice(0,20)}'">🎒 Предмет</button>` : ''}
                          </div>
                        </div>`;
                      }).join('')}
                    </div>`;
                  }

                  if (aliveAllies.length === 0 && aliveEnemies.length === 0) {
                    html += `<div class="card"><p class="muted center small">На «${dirData.name}» пусто — перейдите на другое направление</p></div>`;
                  }
                }
              }

              // Боевой пояс
              if (b.me.gear && b.me.gear.length > 0) {
                const itemNames = {
                  gas_grenade:'💨 Газовая шашка', flashbang:'💥 Светошумовая',
                  assault_grenade:'🔴 Граната', napalm:'🔥 Напалм',
                  uranium_ammo:'☢️ Урановые боеприпасы', hydrogen_bomb:'💣 Водородная бомба',
                  medkit:'🩹 Аптечка', dome:'🔵 Купол',
                  kevlar:'🦺 Бронеплиты', reflect_shield:'🪞 Отраж. щит',
                };
                const usedItems = new Set();
                html += `<div class="card" style="margin-bottom:8px"><div class="name">🎒 Боевой пояс</div>`;
                for (const itemId of b.me.gear) {
                  if (usedItems.has(itemId)) continue;
                  usedItems.add(itemId);
                  const cnt = b.me.gear.filter(x=>x===itemId).length;
                  html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-dim)">
                    <span>${itemNames[itemId]||itemId} ×${cnt}</span>
                    <button class="btn btn-orange btn-inline" data-use-item="${itemId}">Применить${App._itemTarget ? ' → ' + (App._itemTargetName||'цель') : ''}</button>
                  </div>`;
                }
                html += `</div>`;
              }

              // Лог боя
              if (b.log && b.log.length) {
                html += `<div class="card" style="margin-bottom:8px">
                  <div class="name">📋 Лог боя</div>
                  <div style="max-height:160px;overflow-y:auto;font-size:11px">
                    ${b.log.slice().reverse().map(e => {
                      const col = e.kind==='crit'?'var(--red)':e.kind==='heal'?'var(--green)':e.kind==='item'?'var(--orange)':'var(--dim)';
                      return `<div style="color:${col};padding:2px 0">${UI.esc(e.text)}</div>`;
                    }).join('')}
                  </div>
                </div>`;
              }

              // Кнопка покинуть бой — внизу
              html += `
                <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
                  <button class="btn btn-red" style="width:100%;opacity:.7" id="leave-battle-btn">
                    🚪 Покинуть бой
                  </button>
                  <p class="muted small mt center">При выходе ваша статистика не будет учтена</p>
                </div>`;
            }

            // ── БОЙ ЗАВЕРШЁН ──────────────────────────────────────

          } // end if (battleData)

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
            <div class="name">💰 Казна легиона</div>
            <div class="kv mt"><span class="k">Доллары в казне</span><span class="v money">$${UI.fmtMoney(L.treasury)}</span></div>
            <div class="kv"><span class="k">Резервы</span><span class="v gold">${UI.fmtNum(L.reserves || 0)} РЕЗ</span></div>
            <div class="kv"><span class="k">Рейтинг клана</span><span class="v">${UI.fmtNum(L.ratingPoints)} очк.</span></div>
            <p class="muted small mt">Обмен $ → Резервы находится в разделе <b>Банк → Резерв</b>.</p>
            <hr class="hr">
            <label class="small">Внести деньги в казну ($):</label>
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
            <p class="muted small mt">Внести из инвентаря:</p>
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
              <div class="kv"><span class="k">Казна</span><span class="v money">$${UI.fmtMoney(L2.treasury)}</span></div>
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

      // Кнопка «Покинуть бой»
      const leaveBattleBtn = document.getElementById('leave-battle-btn');
      if (leaveBattleBtn) {
        leaveBattleBtn.onclick = async () => {
          if (!confirm('⚠️ Покинуть бой?\n\nВаша статистика не будет учтена. Вы вернётесь на главную.')) return;
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
  const data = await API.get('/api/fame');

  // param: 'daily/level', 'alltime/ears' etc.
  const parts = (param || 'alltime/level').split('/');
  const section  = parts[0] === 'daily' ? 'daily' : 'alltime';
  const catId    = parts[1] || 'level';

  const cats = section === 'daily' ? data.daily : data.allTime;
  const cat  = cats.find(x => x.id === catId) || cats[0];

  const medals = ['🥇', '🥈', '🥉'];
  const fmtVal = (fmt, v) => {
    if (fmt === 'money') return `$${UI.fmtMoney(v)}`;
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
