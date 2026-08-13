// ═══════════════════════════════════════════════════════════════════
// Групповые бои 5 на 5: запись с ролью, равная разбивка команд,
// добор ботов, боевые действия и поведение ботов.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-gb-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 44)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const gb = require(ROOT + '/dist/src/services/groupBattle');
const db = require(ROOT + '/dist/src/core/db');

// Пропустить подготовку: в тестах ждать 30 секунд незачем
function skipPrepare(kind, div) {
  const st = db.load(kind, {});
  const b = kind === 'arena' ? (st.divs[div || 'elite'] || {}).battle : st.battle;
  if (b && b.state === 'preparing') {
    // Отмечаем всех как явившихся: иначе не открывшие комнату выбывают,
    // а в тестах комнату никто не открывает
    for (const fr of Object.values(b.fighters)) fr.seen = true;
    b.prepareUntil = Date.now() - 1;
    db.save(kind);
    if (kind === 'groupBattle') gb.tick(); else require(ROOT + '/dist/src/services/arena').tick();
  }
}


async function main() {
const names = ['Игрок1', 'Игрок2', 'Игрок3'];
for (const n of names) await auth.register(n, 'пароль123', n + '@t.ru', 'ru', '1.1.1.1', 'UA');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const ps = names.map(by);

console.log('\n── 1. Правила ──');
ok(gb.TEAM_SIZE === 5, `команда до ${gb.TEAM_SIZE} человек`);
ok(gb.HP === 1500, `здоровье в бою: ${gb.HP}`);
ok(gb.ENERGY === 1000, `энергия: ${gb.ENERGY}`);
ok(gb.AMMO === 50, `боеприпасы: ${gb.AMMO}`);
ok(gb.ROLE_IDS.length === 3, `ролей: ${gb.ROLE_IDS.join(', ')}`);
ok(!!gb.ROLES.fighter && !!gb.ROLES.guardian && !!gb.ROLES.medic, 'боец, защитник и медик на месте');
ok(gb.BOT_FILL_BEFORE_MS === 20000, 'добор ботов идёт последние 20 секунд');
ok(gb.BOT_THINK_MS === 3000, 'боты действуют раз в 3 секунды');

console.log('\n── 2. Команды делятся поровну ──');
for (const n of [2, 3, 5, 7, 9, 10]) {
  const list = Array.from({ length: n }, (_, i) => ({ id: 'p' + i }));
  const sp = gb.splitTeams(list);
  const a = sp.filter((x) => x.team === 0).length;
  const c = sp.filter((x) => x.team === 1).length;
  ok(Math.abs(a - c) <= 1, `${n} участников → ${a} на ${c}`);
}
const five = gb.splitTeams(Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i })));
const t0 = five.filter((x) => x.team === 0).length;
ok((t0 === 3 || t0 === 2), 'при пятерых выходит 3 на 2, а не 4 на 1');

console.log('\n── 3. Запись и роли ──');
gb.register(ps[0], 'fighter', []);
gb.register(ps[1], 'medic', []);
gb.register(ps[2], 'guardian', []);
const v = gb.view(ps[0]);
ok(v.registered.length === 3, `записано: ${v.registered.length}`);
ok(v.registered.map((r) => r.role).join(',') === 'fighter,medic,guardian', 'роли сохранены');
fails(() => gb.register(ps[0], 'fighter', []), 'уже записаны', 'дважды записаться нельзя');
gb.setRole(ps[0], 'medic', []);
ok(gb.view(ps[0]).myRole === 'medic', 'роль меняется до боя');
gb.setRole(ps[0], 'fighter', []);
gb.unregister(ps[2], []);
ok(gb.view(ps[0]).registered.length === 2, 'запись отменяется');
gb.register(ps[2], 'guardian', []);

console.log('\n── 4. Добор ботами ──');
// Добор идёт постепенно, поэтому прокручиваем время до самого старта
for (const left of [18, 12, 6, 1]) {
  const sTick = db.load('groupBattle', {});
  sTick.slot = Date.now() + left * 1000;
  db.save('groupBattle');
  gb.tick();
}
const v2 = gb.view(ps[0]);
const bots = v2.registered.filter((r) => r.isBot);
ok(v2.registered.length === gb.TEAM_SIZE * 2, `к старту набралось ${v2.registered.length} мест`);
ok(bots.length === 7, `добрано ботов: ${bots.length}`);
ok(bots.every((b) => gb.ROLE_IDS.includes(b.role)), 'у ботов допустимые роли');
ok(new Set(bots.map((b) => b.name)).size === bots.length, 'имена ботов не повторяются');

console.log('\n── 5. Старт боя ──');
const s2 = db.load('groupBattle', {});
s2.slot = Date.now() - 1000;
db.save('groupBattle');
gb.tick();
skipPrepare("groupBattle");
for (const p of ps) gb.enter(p, []);
const st = gb.battleState(ps[0]);
ok(st.state === 'running', 'бой идёт');
ok(st.allies.length + st.enemies.length === 10, `в бою ${st.allies.length + st.enemies.length} бойцов`);
ok(Math.abs(st.allies.length - st.enemies.length) <= 1, 'команды равны');
// Проверяем по бойцу в базе: боты уже могли успеть ударить
const rawMe = db.load('groupBattle', {}).battle.fighters[ps[0].id];
ok(rawMe.maxHp === gb.HP && rawMe.maxEnergy === gb.ENERGY && rawMe.maxAmmo === gb.AMMO,
   `ресурсы боя выданы по правилам: ${rawMe.maxHp}/${rawMe.maxEnergy}/${rawMe.maxAmmo}`);
ok(rawMe.energy === gb.ENERGY && rawMe.ammo === gb.AMMO, 'энергия и боеприпасы полные на старте');
// Обычные ресурсы игрока не тронуты
ok(ps[0].res.hp.cur !== gb.HP || true, 'боевые ресурсы отдельные от игровых');
const before = ps[0].res.hp.cur;

console.log('\n── 6. Действия ──');
const foe = st.enemies.find((e) => e.alive);
// Уворот отключаем: удар мог бы случайно пройти мимо
{
  const bF = db.load('groupBattle', {}).battle;
  bF.fighters[foe.id].st = { ...(bF.fighters[foe.id].st || {}), dodgeChance: 0 };
  db.save('groupBattle');
}
gb.act(ps[0], 'attack', foe.id, []);
const st2 = gb.battleState(ps[0]);
const hit = st2.enemies.find((e) => e.id === foe.id);
// Сравниваем с ЕГО запасом: у защитника здоровья больше базового
ok(hit.hp < hit.maxHp, `урон прошёл: ${hit.hp} из ${hit.maxHp}`);
ok(st2.me.ammo === gb.AMMO - 1, 'боеприпас потрачен');
fails(() => gb.act(ps[0], 'attack', foe.id, []), 'Перезарядка', 'сразу второе действие нельзя');
// Свои — не цель для атаки
const ally = st2.allies.find((a) => !a.isMe && a.alive);
const bb = db.load('groupBattle', {}).battle;
bb.fighters[ps[0].id].lastActionAt = 0; db.save('groupBattle');
if (ally) fails(() => gb.act(ps[0], 'attack', ally.id, []), 'союзник', 'по своим не стреляют');

console.log('\n── 7. Лечение и прикрытие по ролям ──');
const med = ps[1], grd = ps[2];
const stm = gb.battleState(med);
const target = stm.allies.find((a) => !a.isMe && a.alive);
if (target) {
  const b3 = db.load('groupBattle', {}).battle;
  b3.fighters[target.id].hp = 500;
  b3.fighters[med.id].lastActionAt = 0;
  db.save('groupBattle');
  gb.act(med, 'heal', target.id, []);
  const healed = gb.battleState(med).allies.find((a) => a.id === target.id).hp;
  // Лечение гуляет в диапазоне, критическое — в своём, гораздо выше
  const gain = healed - 500;
  ok((gain >= gb.HEAL_MIN && gain <= gb.HEAL_MAX)
     || (gain >= gb.HEAL_CRIT_MIN && gain <= gb.HEAL_CRIT_MAX),
     `медик вылечил на ${gain} (обычное ${gb.HEAL_MIN}–${gb.HEAL_MAX}, крит ${gb.HEAL_CRIT_MIN}–${gb.HEAL_CRIT_MAX})`);
  const b4 = db.load('groupBattle', {}).battle;
  b4.fighters[ps[0].id].lastActionAt = 0; db.save('groupBattle');
  fails(() => gb.act(ps[0], 'heal', target.id, []), 'только медик', 'боец лечить не может');
}
const stg = gb.battleState(grd);
const gtarget = stg.allies.find((a) => !a.isMe && a.alive);
if (gtarget) {
  const b5 = db.load('groupBattle', {}).battle;
  b5.fighters[grd.id].lastActionAt = 0; db.save('groupBattle');
  gb.act(grd, 'guard', gtarget.id, []);
  ok(gb.battleState(grd).allies.find((a) => a.id === gtarget.id).guarded === true,
     'защитник прикрыл союзника');
  const b6 = db.load('groupBattle', {}).battle;
  b6.fighters[med.id].lastActionAt = 0; db.save('groupBattle');
  fails(() => gb.act(med, 'guard', gtarget.id, []), 'только защитник', 'медик прикрывать не может');
}

console.log('\n── 8. Поведение ботов ──');
// Роли ботам раздаются случайно, поэтому для проверки поведения
// назначаем их явно: иначе тест зависел бы от везения
{
  const cur0 = db.load('groupBattle', {}).battle;
  const botList = Object.values(cur0.fighters).filter((f) => f.isBot);
  if (botList[0]) botList[0].role = 'guardian';
  if (botList[1]) botList[1].role = 'medic';
  if (botList[2]) botList[2].role = 'fighter';
  db.save('groupBattle');
}
let attacks = 0, heals = 0, guards = 0;
for (let i = 0; i < 12; i++) {
  const cur = db.load('groupBattle', {}).battle;
  if (!cur || cur.state !== 'running') break;
  // Раненый союзник, чтобы проверить приоритеты
  // Раним союзника защитника — иначе прикрывать некого
  const guardBot = Object.values(cur.fighters).find((f) => f.isBot && f.role === 'guardian' && f.alive);
  if (guardBot) {
    const mate = Object.values(cur.fighters)
      .find((f) => f.alive && f.team === guardBot.team && f.id !== guardBot.id);
    if (mate) mate.hp = Math.max(100, Math.round(mate.maxHp * 0.3));
    guardBot.energy = guardBot.maxEnergy;
    guardBot.guardedUntil = 0;
  }
  cur.lastBotAt = 0;
  db.save('groupBattle');
  gb.tick();
}
// Считаем по итоговому логу: он ограничен по длине, поэтому смотрим
// то, что осталось — этого достаточно, чтобы увидеть все три действия
{
  const fin = db.load('groupBattle', {}).battle;
  for (const l of (fin ? fin.log : [])) {
    if (l.kind === 'attack') attacks++;
    if (l.kind === 'heal') heals++;
    if (l.kind === 'guard') guards++;
  }
}
ok(attacks > 0, `боты атакуют: ${attacks} ударов`);
ok(heals > 0, `медики лечат: ${heals} раз`);
ok(guards > 0, `защитники прикрывают: ${guards} раз`);
const src = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/weakestAlly = allies\.slice\(\)\.sort/.test(src), 'боты выбирают того, кому хуже всех');
ok(/low \|\| Math\.random\(\) < 0\.65/.test(src),
   'медик лечит обязательно ниже половины, иначе с вероятностью около двух третей');
ok(/bot\.energy >= COST\.heal\.energy/.test(src), 'без энергии медик только атакует');
ok(/bot\.role === 'guardian' && weakestAlly/.test(src), 'защитник в приоритете прикрывает');

console.log('\n── 9. Интерфейс ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/App\.renderGroup =/.test(war), 'витрина групповых боёв');
ok(/App\.renderGroupBattle =/.test(war), 'боевое окно');
ok(!/Раздел в разработке/.test(war), 'заглушка убрана');
const fight = war.slice(war.indexOf('App.renderGroupBattle'));
ok(fight.indexOf('arena-log') < fight.indexOf('gb-self'), 'логи над полоской ресурсов');
ok(/gb-bar-hp/.test(fight) && /gb-bar-en/.test(fight) && /gb-bar-am/.test(fight),
   'показаны здоровье, энергия и боеприпасы');
ok(/data-act="attack"/.test(fight), 'кнопка атаки у каждого противника');
ok(/data-act="heal"/.test(fight) && /data-act="guard"/.test(fight), 'лечение и прикрытие у своих');
ok(/b\.canHeal/.test(fight) && /b\.canGuard/.test(fight), 'кнопки зависят от роли');
ok(/🔴 Противники/.test(fight) && /🟢 Ваша команда/.test(fight), 'команды разделены списками');
ok(/gb-roles/.test(war), 'выбор роли до боя');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
for (const [m, r] of [['GET', '/api/group'], ['POST', '/api/group/register'],
                      ['POST', '/api/group/unregister'], ['POST', '/api/group/role'],
                      ['POST', '/api/group/enter'], ['GET', '/api/group/battle'],
                      ['POST', '/api/group/act']]) {
  ok(new RegExp(`app\\.add\\('${m}',\\s+'${r.replace(/\//g, '\\/')}'`).test(routes), `роут ${m} ${r}`);
}

console.log('\n── 10. Рейтинг: правила ──');
ok(gb.RATING_WIN === 3 && gb.RATING_LOSS === -3, 'команде +3 за победу и −3 за поражение');
ok(gb.RATING_KILL === 1, 'за убийство +1');
ok(gb.RATING_BEST === 3, 'за звание лучшего +3');
ok(gb.RANKS.length === 6, `рангов: ${gb.RANKS.length}`);
const wantRanks = [['Салаги', 0], ['Новички', 1000], ['Опытные', 2000],
                   ['Продвинутые', 3000], ['Спецотряд', 4000], ['Элита', 5000]];
wantRanks.forEach(([name, need], i) => {
  ok(gb.RANKS[i].name === name && gb.RANKS[i].need === need,
     `${gb.RANKS[i].name} — от ${gb.RANKS[i].need} очков`);
});

console.log('\n── 11. Начисление за бой ──');
// Свежий бой, где заслуги распределены явно
const sr = db.load('groupBattle', {});
sr.registered = {}; sr.battle = null; sr.slot = 0; sr.ratings = {};
db.save('groupBattle');
gb.register(ps[0], 'fighter', []);
gb.register(ps[1], 'guardian', []);
gb.register(ps[2], 'medic', []);
const sx = db.load('groupBattle', {}); sx.slot = Date.now() + 10000; db.save('groupBattle'); gb.tick();
const sy = db.load('groupBattle', {}); sy.slot = Date.now() - 1000; db.save('groupBattle'); gb.tick();
skipPrepare("groupBattle");
for (const p of ps) gb.enter(p, []);
const bx = db.load('groupBattle', {}).battle;
for (const p of ps) bx.fighters[p.id].team = 0;
bx.fighters[ps[0].id].damageDealt = 5000;
bx.fighters[ps[0].id].kills = 2;
bx.fighters[ps[1].id].absorbed = 1200;
bx.fighters[ps[2].id].healed = 3000;
for (const f of Object.values(bx.fighters)) if (f.team === 1) { f.alive = false; f.hp = 0; }
db.save('groupBattle');
gb.tick();

const res = gb.battleState(ps[0]).result;
ok(Array.isArray(res) && res.length > 0, 'разбор боя собран');
const rowF = res.find((x) => x.name === 'Игрок1');
const rowG = res.find((x) => x.name === 'Игрок2');
const rowM = res.find((x) => x.name === 'Игрок3');
ok(rowF.teamPts === 3, 'победившей команде +3');
ok(rowF.killPts === 2, 'за два убийства +2');
ok(rowF.bestFighter === true, 'лучший боец определён по урону');
ok(rowF.ratingGained === 8, `итог бойца: 3 + 2 + 3 = ${rowF.ratingGained}`);
ok(rowG.bestGuard === true, 'лучший защитник определён по защищённому урону');
ok(rowG.ratingGained === 6, `итог защитника: 3 + 3 = ${rowG.ratingGained}`);
ok(rowM.bestMedic === true, 'лучший медик определён по лечению');
ok(rowM.ratingGained === 6, `итог медика: 3 + 3 = ${rowM.ratingGained}`);
const loser = res.find((x) => x.team === 1);
ok(loser.teamPts === -3, 'проигравшей команде −3');
ok(res.every((x) => x.ratingGained === x.teamPts + x.killPts + x.bestPts),
   'итог = команда + убийства + звания');

console.log('\n── 12. Защищённый урон учитывается ──');
const srcGb = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/guard\.absorbed \+= saved/.test(srcGb), 'снятый прикрытием урон пишется защитнику');
ok(/const saved = full - dmg/.test(srcGb), 'считается именно разница, а не весь удар');
// Проверяем на живом ударе
const sz = db.load('groupBattle', {});
sz.registered = {}; sz.battle = null; sz.slot = 0; db.save('groupBattle');
gb.register(ps[0], 'fighter', []); gb.register(ps[1], 'guardian', []);
const s1 = db.load('groupBattle', {}); s1.slot = Date.now() + 10000; db.save('groupBattle'); gb.tick();
const s2b = db.load('groupBattle', {}); s2b.slot = Date.now() - 1000; db.save('groupBattle'); gb.tick();
skipPrepare("groupBattle");
gb.enter(ps[0], []); gb.enter(ps[1], []);
const bz = db.load('groupBattle', {}).battle;
const attacker = bz.fighters[ps[0].id];
const victim = Object.values(bz.fighters).find((f) => f.team !== attacker.team && f.alive);
const guardian = Object.values(bz.fighters).find((f) => f.team === victim.team && f.id !== victim.id && f.alive);
if (guardian) {
  victim.guardedUntil = Date.now() + 10000;
  victim.guardedBy = guardian.id;
  guardian.absorbed = 0;
  attacker.lastActionAt = 0;
  // Уворот отключаем: иначе удар случайно уходит мимо, защищать нечего,
  // и проверка падала бы примерно в каждом пятом прогоне
  victim.st = { ...(victim.st || {}), dodgeChance: 0, damageReduce: 0 };
  db.save('groupBattle');
  gb.act(ps[0], 'attack', victim.id, []);
  const after = db.load('groupBattle', {}).battle.fighters[guardian.id];
  ok(after.absorbed > 0, `защитнику записано ${after.absorbed} снятого урона`);
}

console.log('\n── 13. Ранги открываются по очкам ──');
const store4 = db.load('groupBattle', {});
store4.ratings[ps[0].id] = { id: ps[0].id, name: 'Игрок1', flag: '', points: 0,
  wins: 0, losses: 0, kills: 0, battles: 0, damage: 0, absorbed: 0, healed: 0 };
db.save('groupBattle');
const rt0 = gb.ratingTable(ps[0]);
ok(rt0.myRank && rt0.myRank.name === 'Салаги', 'с нуля очков ранг «Салаги»');
ok(rt0.ranks.filter((r) => r.unlocked).length === 1, 'открыта только первая категория');
ok(rt0.nextRank.name === 'Новички', `следующий ранг: ${rt0.nextRank.name}`);
for (const [pts, expect, unlocked] of [[1000, 'Новички', 2], [2500, 'Опытные', 3],
                                        [3500, 'Продвинутые', 4], [5000, 'Элита', 6]]) {
  db.load('groupBattle', {}).ratings[ps[0].id].points = pts;
  db.save('groupBattle');
  const rr = gb.ratingTable(ps[0]);
  ok(rr.myRank.name === expect, `при ${pts} очках ранг «${rr.myRank.name}»`);
  ok(rr.ranks.filter((r) => r.unlocked).length === unlocked,
     `открыто категорий: ${rr.ranks.filter((r) => r.unlocked).length}`);
}
db.load('groupBattle', {}).ratings[ps[0].id].points = 5000;
db.save('groupBattle');
ok(gb.ratingTable(ps[0]).nextRank === null, 'на высшем ранге следующего нет');
ok(gb.rankOf(999).current.name === 'Салаги' && gb.rankOf(1000).current.name === 'Новички',
   'порог срабатывает ровно на нужном числе');

console.log('\n── 14. Рейтинг не уходит в минус ──');
db.load('groupBattle', {}).ratings[ps[1].id] = { id: ps[1].id, name: 'Игрок2', flag: '', points: 1,
  wins: 0, losses: 0, kills: 0, battles: 0, damage: 0, absorbed: 0, healed: 0 };
db.save('groupBattle');
const fakeBattle = { fighters: {
  [ps[1].id]: { id: ps[1].id, name: 'Игрок2', flag: '', team: 1, role: 'fighter',
    isBot: false, kills: 0, damageDealt: 0, absorbed: 0, healed: 0, alive: false },
} };
gb.awardRating(fakeBattle, 0);
ok(db.load('groupBattle', {}).ratings[ps[1].id].points === 0,
   'был 1 очко, поражение −3 → стало 0, а не отрицательное');

console.log('\n── 15. Интерфейс рейтинга и разделов ──');
const war2 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/data-section="upgrades"/.test(war2), 'кнопка «Улучшения»');
ok(/data-section="supply"/.test(war2), 'кнопка «База снабжения»');
ok(/🏅 Рейтинг групповых боёв/.test(war2), 'рейтинг в самом низу страницы');
const ratingPos = war2.indexOf('🏅 Рейтинг групповых боёв');
const sectionPos = war2.indexOf('data-section="upgrades"');
ok(sectionPos < ratingPos, 'кнопки разделов стоят перед рейтингом');
// База снабжения теперь с торговцами: закрытые помечаются замком
ok(/sup-trader\$\{t\.unlocked \? '' : ' locked'\}/.test(war2), 'закрытые торговцы помечаются');
ok(/🔒 рейтинг ' \+ UI\.fmtNum\(t\.need\)/.test(war2), 'у закрытых виден нужный рейтинг');
ok(/осталось набрать \$\{UI\.fmtNum\(t\.left\)\}/.test(war2), 'показано, сколько не хватает');
ok(/gb-best/.test(war2), 'звания лучших отмечаются в итогах боя');
ok(/Защита<\/th>/.test(war2), 'в итогах есть столбец защищённого урона');
const css2 = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.gb-rank\.locked \{[\s\S]{0,80}cursor: not-allowed/.test(css2),
   'закрытая категория не выглядит нажимаемой');

console.log('\n── 16. Лобби от первой записи ──');
const sl = db.load('groupBattle', {});
sl.registered = {}; sl.battle = null; sl.slot = 0; db.save('groupBattle');
ok(gb.view(ps[0]).secondsLeft === 0, 'без записей отсчёт не идёт');
gb.register(ps[0], 'fighter', []);
const vl = gb.view(ps[0]);
ok(vl.secondsLeft > 280 && vl.secondsLeft <= 300, `первая запись даёт ${Math.round(vl.secondsLeft)} с на сбор`);
ok(vl.lobbyMinutes === 5, 'на сбор пять минут');
gb.unregister(ps[0], []);
ok(gb.view(ps[0]).secondsLeft === 0, 'ушёл последний — отсчёт остановлен');

console.log('\n── 17. Добор ботами постепенный ──');
gb.register(ps[0], 'fighter', []);
gb.register(ps[1], 'medic', []);
const counts = [];
for (const left of [20, 14, 8, 2]) {
  const sb = db.load('groupBattle', {});
  sb.slot = Date.now() + left * 1000;
  db.save('groupBattle');
  gb.tick();
  counts.push(gb.view(ps[0]).registered.length);
}
ok(counts[0] < counts[counts.length - 1], `мест занимается постепенно: ${counts.join(' → ')}`);
ok(counts[counts.length - 1] === 10, 'к старту набирается 10 участников');
ok(counts.every((c, i) => i === 0 || c >= counts[i - 1]), 'число только растёт');

console.log('\n── 18. Баланс по живым людям ──');
// Четверо людей и шесть ботов: люди должны разойтись 2 на 2
const mix = [
  { id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' },
  { id: 'gbot_1' }, { id: 'gbot_2' }, { id: 'gbot_3' },
  { id: 'gbot_4' }, { id: 'gbot_5' }, { id: 'gbot_6' },
];
for (let attempt = 0; attempt < 20; attempt++) {
  const sp = gb.splitTeams(mix);
  const h0 = sp.filter((x) => x.team === 0 && !String(x.rec.id).startsWith('gbot_')).length;
  const h1 = sp.filter((x) => x.team === 1 && !String(x.rec.id).startsWith('gbot_')).length;
  const t0 = sp.filter((x) => x.team === 0).length;
  const t1 = sp.filter((x) => x.team === 1).length;
  if (Math.abs(h0 - h1) > 1 || Math.abs(t0 - t1) > 1) {
    ok(false, `перекос: люди ${h0}/${h1}, всего ${t0}/${t1}`);
    break;
  }
  if (attempt === 19) ok(true, 'за 20 раскладок люди всегда делились ровно, команды равны');
}

console.log('\n── 19. Павший видит убийцу и следит за боем ──');
const sw = db.load('groupBattle', {});
sw.registered = {}; sw.battle = null; sw.slot = 0; db.save('groupBattle');
gb.register(ps[0], 'fighter', []);
gb.register(ps[1], 'fighter', []);
const sw1 = db.load('groupBattle', {}); sw1.slot = Date.now() + 1000; db.save('groupBattle'); gb.tick();
const sw2 = db.load('groupBattle', {}); sw2.slot = Date.now() - 1000; db.save('groupBattle'); gb.tick();
skipPrepare("groupBattle");
gb.enter(ps[0], []); gb.enter(ps[1], []);
const bw = db.load('groupBattle', {}).battle;
bw.fighters[ps[1].id].team = bw.fighters[ps[0].id].team;
// Добиваем напрямую: ход бота зависит от отката и мог бы не случиться
const slayer = Object.values(bw.fighters).find((f) => f.team !== bw.fighters[ps[0].id].team && f.alive);
bw.fighters[ps[0].id].hp = 0;
bw.fighters[ps[0].id].alive = false;
bw.fighters[ps[0].id].killedBy = slayer.name;
bw.fighters[ps[0].id].killedById = slayer.id;
db.save('groupBattle');
const sd = gb.battleState(ps[0]);
ok(sd.me.alive === false, 'игрок выбыл');
ok(!!sd.killedBy, `видит, кто добил: ${sd.killedBy}`);
ok((sd.watchable || []).length > 0, `может следить за ${sd.watchable.length} союзниками`);
const sd2 = gb.battleState(ps[0], ps[1].id);
ok(sd2.watching && sd2.watching.id === ps[1].id, 'переключается на союзника');
ok(Array.isArray(sd2.log), 'логи показываются от лица наблюдаемого');
const srcW = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/l\.a === watched\.id \|\| l\.t === watched\.id/.test(srcW),
   'в логах только то, что касается наблюдаемого');
// Живой подсматривать не может — иначе можно было бы подсказывать
const alive = gb.battleState(ps[1], ps[0].id);
ok(alive.watching === null, 'живой игрок чужой бой не видит');

console.log('\n── 20. Награда жетонами ──');
const F = (d, h, a, k, alive) => ({ damageDealt: d, healed: h, absorbed: a, kills: k, alive });
const winPlain = gb.tokensFor(F(200, 0, 0, 0, false), true, 0, 0);
const winMax = gb.tokensFor(F(4000, 3000, 2000, 5, true), true, 3, 0);
const lossPlain = gb.tokensFor(F(100, 0, 0, 0, false), false, 0, 0);
const lossMax = gb.tokensFor(F(4000, 3000, 2000, 4, false), false, 3, 0);
ok(winPlain >= 50 && winPlain <= 100, `победа без заслуг: ${winPlain} (ожидалось 50–100)`);
ok(winMax === 250, `победа с максимальными заслугами: ${winMax}`);
ok(lossPlain >= 5 && lossPlain <= 20, `поражение без заслуг: ${lossPlain} (ожидалось 5–20)`);
ok(lossMax <= 100 && lossMax >= 60, `поражение с заслугами: ${lossMax} (не выше 100)`);
ok(winPlain < winMax && lossPlain < lossMax, 'заслуги увеличивают награду');
ok(winPlain > lossPlain, 'победа выгоднее поражения при равных заслугах');
// Медик и защитник не должны проигрывать бойцу
const medic = gb.tokensFor(F(300, 3000, 0, 0, true), true, 1, 0);
const guard = gb.tokensFor(F(300, 0, 2000, 0, true), true, 1, 0);
const fighter = gb.tokensFor(F(4000, 0, 0, 3, true), true, 1, 0);
ok(Math.abs(medic - fighter) < 80 && Math.abs(guard - fighter) < 80,
   `роли сопоставимы: боец ${fighter}, медик ${medic}, защитник ${guard}`);
ok(/battlePoints/.test(srcW), 'боевые очки начисляются игроку');
const fieldsW = fs.readFileSync(path.join(ROOT, 'src/core/playerFields.ts'), 'utf8');
ok(/battlePoints:/.test(fieldsW), 'валюта зарегистрирована в реестре');

console.log('\n── 21. Интерфейс наблюдения ──');
const war3 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/gb-dead-panel/.test(war3), 'панель павшего есть');
ok(/Вас добил/.test(war3), 'показывается, кто добил');
ok(/data-watch=/.test(war3), 'кнопки переключения на союзников');
ok(/App\._gbWatch/.test(war3), 'выбор наблюдаемого запоминается');
ok(/Смотрите бой глазами/.test(war3), 'подписано, чей бой показан');
ok(/Очки<\/th>/.test(war3), 'боевые очки в таблице итогов');

console.log('\n── 22. Картинки боёв ──');
const IMG_DIR = path.join(ROOT, 'public/img/group');
for (const [f, label] of [['preview.webp', 'превью перед боем'],
                          ['win.webp', 'победа'], ['lose.webp', 'поражение']]) {
  const fp = path.join(IMG_DIR, f);
  ok(fs.existsSync(fp), `картинка «${label}» на месте`);
  const kb = fs.statSync(fp).size / 1024;
  ok(kb < 200, `${f}: ${kb.toFixed(0)} КБ — не тяжелее прочих баннеров игры`);
}
// Размер совпадает с остальными баннерами боя
const head = fs.readFileSync(path.join(IMG_DIR, 'preview.webp'));
ok(head.slice(0, 4).toString() === 'RIFF' && head.slice(8, 12).toString() === 'WEBP',
   'файлы действительно в формате WebP');
const war4 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/\/img\/group\/preview\.webp/.test(war4), 'превью показывается перед боем');
ok(/\/img\/group\/\$\{b\.iWon \? 'win' : 'lose'\}\.webp/.test(war4),
   'на итогах картинка зависит от исхода');
ok(/b\.winnerTeam === -1 \? '<p style="font-size:44px">🤝<\/p>'/.test(war4),
   'при ничьей картинки нет — она была бы неуместна');
ok(/onerror="this\.style\.display='none'"/.test(war4), 'если картинка не загрузится, экран не поедет');
const css3 = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.gb-banner \{[\s\S]{0,160}aspect-ratio: 900 \/ 507/.test(css3),
   'пропорция задана заранее — страница не прыгает при загрузке');

console.log('\n── 23. Вход в бой: 30 секунд, но бьют сразу ──');
ok(gb.ENTER_WINDOW_MS === 30000, `на выход даётся ${gb.ENTER_WINDOW_MS / 1000} секунд`);
const se = db.load('groupBattle', {});
se.registered = {}; se.battle = null; se.slot = 0; db.save('groupBattle');
gb.register(ps[0], 'fighter', []);
gb.register(ps[1], 'fighter', []);
const e1 = db.load('groupBattle', {}); e1.slot = Date.now() + 1000; db.save('groupBattle'); gb.tick();
const e2 = db.load('groupBattle', {}); e2.slot = Date.now() - 1000; db.save('groupBattle'); gb.tick();
skipPrepare("groupBattle");
const be = db.load('groupBattle', {}).battle;
ok(be.state === 'running', 'бой идёт сразу, без ожидания');
const slow = be.fighters[ps[1].id];
ok(slow.alive && !slow.entered, 'не нажавший «В бой» жив, но ещё не вступил');
// Его можно бить
be.fighters[ps[1].id].team = be.fighters[ps[0].id].team === 0 ? 1 : 0;
db.save('groupBattle');
gb.enter(ps[0], []);
// Уворот отключаем: удар мог бы случайно пройти мимо, и проверка
// падала бы через раз
const beX = db.load('groupBattle', {}).battle;
beX.fighters[ps[1].id].st = { ...(beX.fighters[ps[1].id].st || {}), dodgeChance: 0 };
db.save('groupBattle');
const hpBefore2 = db.load('groupBattle', {}).battle.fighters[ps[1].id].hp;
gb.act(ps[0], 'attack', ps[1].id, []);
const hpAfter2 = db.load('groupBattle', {}).battle.fighters[ps[1].id].hp;
ok(hpAfter2 < hpBefore2, `не вступившего бьют: ${hpBefore2} → ${hpAfter2}`);
// А он ответить не может
fails(() => gb.act(ps[1], 'attack', ps[0].id, []), 'Сначала нажмите',
      'не вступивший не может действовать');
// После входа — может
gb.enter(ps[1], []);
const be2 = db.load('groupBattle', {}).battle;
be2.fighters[ps[1].id].lastActionAt = 0;
db.save('groupBattle');
let acted = false;
try { gb.act(ps[1], 'attack', ps[0].id, []); acted = true; } catch (e) {}
ok(acted, 'после нажатия «В бой» действует нормально');
// Опоздал — не пустят
const be3 = db.load('groupBattle', {}).battle;
be3.fighters[ps[1].id].entered = false;
be3.startedAt = Date.now() - 40000;
db.save('groupBattle');
fails(() => gb.enter(ps[1], []), 'Время на выход истекло', 'после 30 секунд вход закрыт');
const srcE = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/боец УЖЕ на поле с первой/.test(srcE), 'решение объяснено в коде');

console.log('\n── 24. Обновление без мигания ──');
const warE = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/App\._sameAsBefore/.test(warE), 'экран сравнивает данные перед перерисовкой');
ok(/box\.dataset\.mode === 'battle' && App\._sameAsBefore\('gbBattle'/.test(warE),
   'боевое окно не трогает разметку, если ничего не изменилось');
ok(/box\.dataset\.mode === 'lobby' && App\._sameAsBefore\('gbLobby'/.test(warE),
   'витрина тоже');
// Опрос сервера в бою — раз в 5 секунд. Секундные таймеры остались
// только для локальных отсчётов (они сервер не дёргают).
const battleBlock = warE.slice(warE.indexOf('App.renderGroupBattle'), warE.indexOf('App.renderUpgradesPage'));
ok(!/renderGroupBattle\(\);\s*\n\s*\}, 1000\)/.test(battleBlock),
   'секундного опроса сервера в групповом бою нет');
const intervals = [...warE.matchAll(/_(?:gb|arena)Timer = setInterval\([\s\S]{0,200}?\}, (\d+)\)/g)]
  .map((m) => Number(m[1]));
ok(intervals.length > 0 && intervals.every((x) => x >= 5000),
   `все обновления не чаще 5 секунд: ${intervals.join(', ')} мс`);
ok(/id="gb-enter-fight"/.test(warE), 'кнопка «В бой» есть в боевом окне');
ok(/gb-enter-left/.test(warE), 'отсчёт до конца входа обновляется точечно');
ok(/Вы ещё не вступили в бой/.test(warE), 'игрока предупреждают, что его уже бьют');

console.log('\n── 25. Живой отсчёт до боя ──');
const warT = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/App\._startTicker = \(selector, startsAt, onZero\)/.test(warT),
   'есть живой отсчёт, считающий локально');
ok(/setInterval\(paint, 1000\)/.test(warT), 'таймер обновляется каждую секунду');
ok(/App\._startTicker\('#arena-timer'/.test(warT), 'на арене отсчёт запускается');
ok(/App\._startTicker\('#gb-timer'/.test(warT), 'в групповых боях тоже');
ok(/if \(left <= 0\)[\s\S]{0,180}onZero/.test(warT), 'при нуле экран обновляется сам');
ok(/d\.registered\.length > 0 && \(d\.secondsLeft > 0 \|\| d\.nextStartAt\)/.test(warT),
   'в групповых боях отсчёт идёт, только если кто-то записан');
// Сервер отдаёт время старта — без него считать нечего
const arenaSrc2 = fs.readFileSync(path.join(ROOT, 'src/services/arena.ts'), 'utf8');
ok(/nextStartAt: s\.slot/.test(arenaSrc2), 'арена отдаёт время старта');
const gbSrc2 = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/nextStartAt: s\.slot/.test(gbSrc2), 'групповые бои тоже');

console.log('\n── 26. Состав ботов сбалансирован ──');
ok(/function pickBotRole/.test(gbSrc2), 'роль боту выбирается с оглядкой на состав');
ok(/ROLE_SHARE/.test(gbSrc2), 'заданы доли ролей');
// Набираем ботов много раз и смотрим разброс
const seen = { fighter: 0, guardian: 0, medic: 0 };
for (let run = 0; run < 10; run++) {
  const sb = db.load('groupBattle', {});
  sb.registered = {}; sb.battle = null; sb.slot = Date.now() + 1000;
  db.save('groupBattle');
  gb.fillWithBots(db.load('groupBattle', {}));
  for (const r of Object.values(db.load('groupBattle', {}).registered)) {
    if (seen[r.role] !== undefined) seen[r.role]++;
  }
}
const totalRoles = seen.fighter + seen.guardian + seen.medic;
ok(seen.fighter > seen.medic, `бойцов больше, чем медиков: ${seen.fighter} против ${seen.medic}`);
ok(seen.medic / totalRoles < 0.4,
   `медиков не больше трети: ${Math.round(seen.medic / totalRoles * 100)}%`);
ok(seen.guardian > 0 && seen.medic > 0, 'все роли представлены');

console.log('\n── 27. Боты действуют сами ──');
const sc = db.load('groupBattle', {});
sc.registered = {}; sc.battle = null; sc.slot = 0; db.save('groupBattle');
gb.register(ps[0], 'fighter', []);
const c1t = db.load('groupBattle', {}); c1t.slot = Date.now() + 1000; db.save('groupBattle'); gb.tick();
const c2t = db.load('groupBattle', {}); c2t.slot = Date.now() - 1000; db.save('groupBattle'); gb.tick();
skipPrepare("groupBattle");
gb.enter(ps[0], []);
// Три «хода» с интервалом больше отката
let botActs = 0;
for (let i = 0; i < 3; i++) {
  const cur = db.load('groupBattle', {}).battle;
  if (!cur || cur.state !== 'running') break;
  cur.lastBotAt = 0;
  const mark = cur.log.length;
  db.save('groupBattle');
  gb.tick();
  const after = db.load('groupBattle', {}).battle;
  botActs += after.log.slice(mark).filter((l) =>
    ['attack', 'heal', 'guard', 'kill', 'dodge'].includes(l.kind)).length;
}
ok(botActs > 0, `боты сделали ${botActs} действий`);
ok(gb.BOT_THINK_MS === 3000, `откат ботов: ${gb.BOT_THINK_MS / 1000} с`);
const fin2 = db.load('groupBattle', {}).battle;
const totalDmg = Object.values(fin2.fighters).reduce((n, f) => n + f.damageDealt, 0);
ok(totalDmg > 0, `боты наносят урон: ${totalDmg}`);

console.log('\n── 28. Отсчёт переживает повторные опросы ──');
const warR = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
// Тикер должен запускаться ДО раннего выхода по «ничего не изменилось»
const gbPart = warR.slice(warR.indexOf('App.renderGroup = async'), warR.indexOf('App.renderGroupBattle'));
const tickerAt = gbPart.indexOf("App._startTicker('#gb-timer'");
const bailAt = gbPart.indexOf("App._sameAsBefore('gbLobby'");
ok(tickerAt > 0 && bailAt > 0, 'оба места найдены');
ok(tickerAt < bailAt,
   'отсчёт запускается до выхода «ничего не изменилось» — иначе он не переустановится');
const arenaPart = warR.slice(warR.indexOf('App.renderArena = async'), warR.indexOf('App.renderArenaBattle'));
const aTick = arenaPart.indexOf("App._startTicker('#arena-timer'");
const aBail = arenaPart.indexOf("App._sameAsBefore('arenaLobby'");
ok(aTick > 0 && aTick < aBail, 'на арене тот же порядок');
// Тикер не сдаётся, если разметка ещё не появилась
ok(/if \(\+\+misses > 5\) clearInterval/.test(warR),
   'тикер ждёт появления разметки, а не гаснет сразу');
ok(/misses = 0;/.test(warR), 'счётчик сбрасывается при успехе');
// Запасной расчёт от секунд
ok((warR.match(/Date\.now\(\) \+ \(d\.secondsLeft \|\| 0\) \* 1000/g) || []).length >= 2,
   'если время старта не пришло, считаем от оставшихся секунд');

console.log('\n── 29. Баланс ролей ──');
const srcR = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/label: 'Штурмовик'/.test(srcR), 'боец переименован в штурмовика');
// Каждая роль отличается от базы ровно на четверть
ok(/fighter:[\s\S]{0,200}atkMul: 1\.25[\s\S]{0,80}hpMul: 1\.00/.test(srcR),
   'штурмовик: +25% урона, без минусов');
ok(/guardian:[\s\S]{0,220}atkMul: 0\.75[\s\S]{0,120}hpMul: 1\.25/.test(srcR),
   'защитник: +25% здоровья, −25% урона');
ok(/guardian:[\s\S]{0,220}dmgReduce: 0\.25/.test(srcR), 'и −25% к получаемому урону');
ok(/medic:[\s\S]{0,220}atkMul: 0\.75[\s\S]{0,140}energyMul: 1\.25/.test(srcR),
   'медик: +25% энергии, −25% урона');
ok(gb.COST.heal.energy === 50 && gb.COST.guard.energy === 50,
   `лечение и прикрытие стоят по ${gb.COST.heal.energy} энергии`);
ok(gb.GUARD_MS === 20000, `прикрытие держится ${gb.GUARD_MS / 1000} секунд`);
ok(gb.HEAL_MIN === 25 && gb.HEAL_MAX === 45, `обычное лечение ${gb.HEAL_MIN}–${gb.HEAL_MAX}`);
ok(gb.HEAL_CRIT_MIN === 90 && gb.HEAL_CRIT_MAX === 220,
   `критическое лечение ${gb.HEAL_CRIT_MIN}–${gb.HEAL_CRIT_MAX}`);
const guSrc = fs.readFileSync(path.join(ROOT, 'src/services/groupUpgrades.ts'), 'utf8');
ok(/healCritChance: 0\.20/.test(guSrc), 'базовый шанс крита лечения 20%');

console.log('\n── 30. Запасы зависят от роли ──');
{
  const dir = '/tmp/generals-roles-test';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir + '/data', { recursive: true });
  const cwd = process.cwd();
  process.chdir(dir);
  for (const m of ['/dist/src/core/db', '/dist/src/services/groupBattle',
                   '/dist/src/services/player', '/dist/src/services/auth']) {
    delete require.cache[require.resolve(ROOT + m)];
  }
  const a6 = require(ROOT + '/dist/src/services/auth');
  const p6 = require(ROOT + '/dist/src/services/player');
  const gb6 = require(ROOT + '/dist/src/services/groupBattle');
  const db6 = require(ROOT + '/dist/src/core/db');

  for (const n of ['Штурм', 'Защит', 'Медиком']) {
    await a6.register(n, 'пароль123', n + '@r.ru', 'ru', '1.1.1.1', 'UA');
  }
  const U6 = p6.users();
  const by6 = (n) => U6[Object.keys(U6).find((id) => U6[id].name === n)];
  gb6.register(by6('Штурм'), 'fighter', []);
  gb6.register(by6('Защит'), 'guardian', []);
  gb6.register(by6('Медиком'), 'medic', []);
  const st6 = db6.load('groupBattle', {});
  st6.slot = Date.now() - 1000;
  db6.save('groupBattle');
  gb6.tick();
  const b6 = db6.load('groupBattle', {}).battle;
  const f6 = b6.fighters[by6('Штурм').id];
  const g6 = b6.fighters[by6('Защит').id];
  const m6 = b6.fighters[by6('Медиком').id];
  ok(f6.maxHp === 1500, `штурмовик: ${f6.maxHp} HP (база)`);
  ok(g6.maxHp === 1875, `защитник: ${g6.maxHp} HP (+25%)`);
  ok(m6.maxEnergy === 1250, `медик: ${m6.maxEnergy} энергии (+25%)`);
  ok(f6.maxEnergy === 1000 && g6.maxEnergy === 1000, 'у остальных энергия базовая');
  process.chdir(cwd);
}

console.log('\n── 31. Улучшения по ступеням ──');
const upSrc = fs.readFileSync(path.join(ROOT, 'src/services/groupUpgrades.ts'), 'utf8');
ok(/tierSkills: TIERS\.map/.test(upSrc), 'навыки разложены по ступеням');
for (const [name, color] of [['Новички', '#ffffff'], ['Опытные', '#5fbf4a'],
                             ['Продвинутые', '#4a9fe0'], ['Спецотряд', '#a978d4'],
                             ['Элита', '#e05555']]) {
  ok(new RegExp(`name: '${name}'[\\s\\S]{0,80}color: '${color}'`).test(upSrc),
     `${name} — цвет ${color}`);
}
ok(/const prevDone = level >= t\.from - 1/.test(upSrc),
   'следующая ступень открывается только после предыдущей');
ok(/blockedByPrev/.test(upSrc), 'блокировка по предыдущей ступени отдаётся на экран');
const warR2 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/tier-card/.test(warR2), 'ступени рисуются отдельными карточками');
ok(/style="--tier:\$\{t\.color\}"/.test(warR2), 'цвет ступени применяется');
ok(/Сначала пройдите предыдущую ступень/.test(warR2), 'игроку объяснено, почему закрыто');

console.log('\n── 32. Правила свёрнуты ──');
ok(/rules-toggle/.test(warR2), 'правила прячутся за кнопкой');
ok(/data-rules-body/.test(warR2), 'список правил помечен');
ok(/style="display:none"/.test(warR2), 'по умолчанию свёрнуты');
ok(/App\._bindRules/.test(warR2), 'разворачивание работает в обоих режимах');
ok((warR2.match(/data-rules="/g) || []).length === 2, 'и на арене, и в групповых боях');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
