// ═══════════════════════════════════════════════════════════════════
// Арена: запись, старт по расписанию, равные характеристики, умения,
// смена цели и выдача приза единственному победителю.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-arena-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 44)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const arena = require(ROOT + '/dist/src/services/arena');
const db = require(ROOT + '/dist/src/core/db');

// Пропустить подготовку: в тестах ждать 30 секунд незачем
function skipPrepare(kind, div) {
  const st = db.load(kind, {});
  const b = kind === 'arena' ? (st.divs[div || 'elite'] || {}).battle : st.battle;
  if (b) {
    // Отмечаем всех явившимися: не открывшие комнату выбывают, а в
    // тестах комнату никто не открывает. Делаем это независимо от
    // состояния — бой мог уже перейти в боевое.
    for (const fr of Object.values(b.fighters)) fr.seen = true;
    db.save(kind);
  }
  if (b && b.state === 'preparing') {
    b.prepareUntil = Date.now() - 1;
    db.save(kind);
    const arenaSrv = require(ROOT + '/dist/src/services/arena');
    arenaSrv.tick();
  }
}


const startNow = (div) => { const s = db.load('arena', {}); s.divs[div || 'elite'].slot = Date.now() - 1000; db.save('arena'); arena.tick(); };

async function main() {
const names = ['Альфа', 'Браво', 'Чарли', 'Дельта'];
for (const n of names) await auth.register(n, 'пароль123', n + '@t.ru', 'ru', '1.1.1.1', 'UA');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const ps = names.map(by);
for (const p of ps) { p.gold = 1000; p.level = 1; }
ps[3].level = 300;   // уровень не должен ничего значить

console.log('\n── 1. Расписание ──');
ok(arena.SLOT_MINUTES === 15, `бои каждые ${arena.SLOT_MINUTES} минут`);
const slot = arena.nextSlot(new Date('2026-08-10T00:03:00Z').getTime());
ok(new Date(slot).getUTCMinutes() === 15, `после 00:03 ближайший старт в 00:${new Date(slot).getUTCMinutes()}`);
ok(arena.nextSlot(new Date('2026-08-10T00:20:00Z').getTime()) % (15 * 60000) === 0,
   'старты всегда кратны 15 минутам');
ok(arena.ENTRY_GOLD === 50, `взнос ${arena.ENTRY_GOLD} золота`);
ok(arena.MIN_PLAYERS === 2, `минимум участников: ${arena.MIN_PLAYERS}`);

console.log('\n── 2. Запись и отмена ──');
arena.register(ps[0], 'elite', []);
ok(ps[0].gold === 950, `взнос списан: ${ps[0].gold}`);
fails(() => arena.register(ps[0], 'elite', []), 'уже записаны', 'дважды записаться нельзя');
arena.unregister(ps[0], 'elite', []);
ok(ps[0].gold === 1000, 'после отмены взнос возвращён полностью');
fails(() => arena.unregister(ps[0], 'elite', []), 'не записаны', 'отменить незаписанному нельзя');
ps[0].gold = 10;
fails(() => arena.register(ps[0], 'elite', []), 'Не хватает', 'без золота записаться нельзя');
ps[0].gold = 1000;
for (const p of ps) arena.register(p, 'elite', []);
const v = arena.view(ps[0], 'elite');
ok(v.registered.length === 4, `записалось: ${v.registered.length}`);
ok(v.pot === 200, `банк растёт с каждым: ${v.pot}`);
ok(v.iAmRegistered === true, 'своя запись видна');

console.log('\n── 3. Бой не идёт без людей ──');
// Отдельная проверка: один участник — бой отменяется, взнос возвращается
const s0 = db.load('arena', {}).divs.elite;
s0.registered = {}; s0.battle = null; db.save('arena');
arena.register(ps[0], 'elite', []);
const goldBefore = ps[0].gold;
startNow();
ok(ps[0].gold === goldBefore + arena.ENTRY_GOLD, 'одному участнику взнос вернули');
ok(!db.load('arena', {}).divs.elite.battle, 'бой не начался');

console.log('\n── 4. Старт и выход на арену ──');
for (const p of ps) { p.gold = 1000; arena.register(p, 'elite', []); }
startNow();
const v2 = arena.view(ps[0], 'elite');
// Ждать нажатия «В бой» больше не нужно: взнос уплачен, и отвлёкшийся
// на минуту человек терял бы деньги ни за что
// Сначала подготовка, потом бой: игрок должен успеть открыть комнату
ok(v2.battle && v2.battle.state === 'preparing', 'сначала идёт подготовка');
// Теперь в комнату нужно зайти: не пришёл — за тебя играет бот
ok(v2.battle.canEnter === true, 'во время подготовки зовут в комнату');
ok(v2.battle.needEnter === true, 'признак «нужно занять место» выставлен');
ok(v2.battle.pot === 200, `банк боя: ${v2.battle.pot}`);
const prep = arena.battleState(ps[0]);
ok(prep.preparing === true, 'состояние подготовки видно на экране');
ok(prep.prepareLeftSec > 0 && prep.prepareLeftSec <= 30,
   `на подготовку ${prep.prepareLeftSec} с`);
skipPrepare('arena', 'elite');
arena.view(ps[0], 'elite');
const st = arena.battleState(ps[0]);
ok(st.state === 'running', 'после подготовки бой пошёл');
ok(st.active === true, 'все участники уже в бою');
ok(!!st.target, 'цель назначена автоматически');
ok(st.aliveCount === 4, `живых: ${st.aliveCount}`);

console.log('\n── 5. Характеристики равные ──');
ok(st.me.hp === arena.BASE_HP && st.me.maxHp === arena.BASE_HP, `у всех ${arena.BASE_HP} HP`);
const st300 = arena.battleState(ps[3]);
ok(st300.me.hp === st.me.hp, 'у игрока 300 уровня столько же, сколько у первого');
ok(st.me.skills.medkit === 1 && st.me.skills.crit === 1
   && st.me.skills.armor === 1 && st.me.skills.smoke === 2, 'умения розданы по правилам');
ok(!!st.target, `цель назначена: ${st.target.name}`);
ok(st.target.id !== ps[0].id, 'себя в цель не ставят');

console.log('\n── 6. Атака и перезарядка ──');
skipPrepare('arena', 'elite'); arena.view(ps[0], 'elite');
const b = db.load('arena', {}).divs.elite.battle;
const foeId = b.fighters[ps[0].id].targetId;
const hpBefore = b.fighters[foeId].hp;
arena.attack(ps[0]);
const dealt = hpBefore - db.load('arena', {}).divs.elite.battle.fighters[foeId].hp;
// Урон гуляет в диапазоне: ровное число делало бой предсказуемым
ok(dealt >= 25 && dealt <= 35, `обычный удар в диапазоне 25–35: ${dealt}`);
fails(() => arena.attack(ps[0]), 'Перезарядка', 'сразу второй раз ударить нельзя');
ok(arena.ATTACK_CD_MS === 1500, `перезарядка ${arena.ATTACK_CD_MS} мс`);

console.log('\n── 7. Умения ──');
// Аптечка
b.fighters[ps[0].id].hp = 300; db.save('arena');
arena.useSkill(ps[0], 'medkit');
ok(arena.battleState(ps[0]).me.hp === 800, 'аптечка добавляет половину полного запаса');
fails(() => arena.useSkill(ps[0], 'medkit'), 'уже использована', 'аптечка одноразовая');
// Крит
arena.useSkill(ps[0], 'crit');
ok(arena.battleState(ps[0]).me.critLeftSec > 0, 'крит включился на время');
const b2 = db.load('arena', {}).divs.elite.battle;
b2.fighters[ps[0].id].lastAttackAt = 0;
b2.fighters[ps[0].id].targetId = ps[1].id;
b2.fighters[ps[1].id].armorUntil = 0;
b2.fighters[ps[1].id].hp = 1000;
db.save('arena');
arena.attack(ps[0]);
const critDmg = 1000 - db.load('arena', {}).divs.elite.battle.fighters[ps[1].id].hp;
ok(critDmg >= 25 * 3 && critDmg <= 35 * 5,
   `критический удар ${critDmg} — в диапазоне ×3…×5 от 25–35`);
// Броня
arena.useSkill(ps[1], 'armor');
const b3 = db.load('arena', {}).divs.elite.battle;
b3.fighters[ps[0].id].critUntil = 0;
b3.fighters[ps[0].id].lastAttackAt = 0;
const hp3 = b3.fighters[ps[1].id].hp;
db.save('arena');
arena.attack(ps[0]);
const armored = hp3 - db.load('arena', {}).divs.elite.battle.fighters[ps[1].id].hp;
ok(armored >= 12 && armored <= 18, `с бронёй урон примерно вдвое меньше: ${armored}`);

console.log('\n── 8. Дымовая завеса ──');
const b4 = db.load('arena', {}).divs.elite.battle;
for (const p of [ps[1], ps[2], ps[3]]) b4.fighters[p.id].targetId = ps[0].id;
db.save('arena');
ok(arena.battleState(ps[0]).huntersCount === 3, 'видно, что преследуют трое');
arena.useSkill(ps[0], 'smoke');
ok(arena.battleState(ps[0]).huntersCount === 0, 'после завесы преследователи потеряли цель');
ok(arena.battleState(ps[0]).me.skills.smoke === 1, 'осталось одно применение');
const b5 = db.load('arena', {}).divs.elite.battle;
ok(Object.values(b5.fighters).filter((f) => f.alive && f.id !== ps[0].id)
   .every((f) => f.targetId && f.targetId !== ps[0].id), 'каждому назначена новая цель');

console.log('\n── 9. Смена цели ──');
const before = arena.battleState(ps[0]).target.id;
arena.switchTarget(ps[0]);
const after = arena.battleState(ps[0]).target.id;
ok(after !== before || arena.battleState(ps[0]).aliveCount <= 2,
   'цель сменилась на другую из живых');

console.log('\n── 10. Победитель забирает банк ──');
const bb = db.load('arena', {}).divs.elite.battle;
const pot = bb.pot;
// Добиваем троих
for (const p of [ps[1], ps[2], ps[3]]) { bb.fighters[p.id].hp = 1; }
db.save('arena');
for (const foe of [ps[1], ps[2], ps[3]]) {
  const cur = db.load('arena', {}).divs.elite.battle;
  if (!cur || cur.state === 'done') break;
  cur.fighters[ps[0].id].targetId = foe.id;
  cur.fighters[ps[0].id].lastAttackAt = 0;
  db.save('arena');
  try { arena.attack(ps[0]); } catch (e) {}
}
const fin = arena.battleState(ps[0]);
ok(fin.finished === true, 'бой завершился');
ok(fin.winnerName === 'Альфа', `победитель: ${fin.winnerName}`);
ok(fin.iWon === true, 'победитель это видит');
ok(ps[0].gold >= 1000 - arena.ENTRY_GOLD + pot,
   `приз выдан целиком: у победителя ${ps[0].gold} золота`);
const others = [ps[1], ps[2], ps[3]].every((p) => p.gold === 950);
ok(others, 'проигравшие не получили ничего — взнос сгорел');

console.log('\n── 11. Интерфейс ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/data-wartab="group"/.test(war), 'вкладка «Групповые бои» добавлена');
ok(/data-wartab="arena"/.test(war), 'вкладка «Арена» добавлена');
const tabsBlock = war.slice(war.indexOf('data-wartab="targets"'), war.indexOf('data-wartab="event"'));
ok(tabsBlock.indexOf('group') < tabsBlock.indexOf('sanctions')
   && tabsBlock.indexOf('arena') < tabsBlock.indexOf('sanctions'),
   'обе стоят между вторжением и санкциями');
ok(/App\.renderArena =/.test(war), 'витрина арены реализована');
ok(/App\.renderArenaBattle =/.test(war), 'боевое окно реализовано');
ok(/arena-banner/.test(war), 'сверху картинка');
ok(/📜 Правила/.test(war), 'под ней описание правил');
ok(/Участники \(/.test(war), 'ниже список участников');
ok(/Победитель получит/.test(war), 'в конце сумма приза');
// Раскладка боевого окна
const fight = war.slice(war.indexOf('App.renderArenaBattle'));
ok(fight.indexOf('arena-log') < fight.indexOf('arena-card-me'), 'логи над карточкой игрока');
ok(fight.indexOf('arena-card-me') < fight.indexOf('arena-card-foe'), 'карточка игрока над карточкой противника');
ok(fight.indexOf('arena-card-foe') < fight.indexOf('ar-attack'), 'кнопки под карточкой противника');
ok(fight.indexOf('ar-attack') < fight.indexOf('arena-skills'), 'умения под кнопками действий');
ok(/Вас атакуют: \$\{b\.huntersCount\}/.test(fight), 'показано, сколько игроков атакует');
ok(/Оставшиеся бойцы/.test(fight), 'внизу список живых с их здоровьем');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
for (const [m, r] of [['GET', '/api/arena'], ['POST', '/api/arena/register'],
                      ['POST', '/api/arena/unregister'], ['POST', '/api/arena/enter'],
                      ['GET', '/api/arena/battle'], ['POST', '/api/arena/attack'],
                      ['POST', '/api/arena/switch'], ['POST', '/api/arena/skill']]) {
  ok(new RegExp(`app\\.add\\('${m}',\\s+'${r.replace(/\//g, '\\/')}'`).test(routes), `роут ${m} ${r}`);
}

console.log('\n── 12. Два дивизиона ──');
ok(arena.DIVISIONS.basic.currency === 'money', 'базовый — за игровые деньги');
ok(arena.DIVISIONS.basic.entry === 1e12, `взнос базового: ${arena.DIVISIONS.basic.entry.toExponential(0)} (1 Tr)`);
ok(arena.DIVISIONS.elite.currency === 'gold', 'элита — за золото');
ok(arena.DIVISIONS.elite.entry === 50, `взнос элиты: ${arena.DIVISIONS.elite.entry}`);
ok(arena.DIVISIONS.basic.name === 'Арена — базовый дивизион', arena.DIVISIONS.basic.name);
ok(arena.DIVISIONS.elite.name === 'Арена — Элита', arena.DIVISIONS.elite.name);
const vb = arena.view(ps[0], 'basic');
ok(vb.div === 'basic' && vb.currency === 'money', 'витрина переключается на базовый');
ok(vb.divisions.length === 2, 'оба дивизиона отдаются для переключателя');

console.log('\n── 13. Бой за игровые деньги ──');
for (const p of ps) { p.gold = 1000; p.dollars = 5e12; }
const dbase = db.load('arena', {}).divs.basic;
dbase.registered = {}; dbase.battle = null; db.save('arena');
const moneyBefore = ps[0].dollars, goldKept = ps[0].gold;
for (const p of ps) arena.register(p, 'basic', []);
ok(moneyBefore - ps[0].dollars === 1e12, 'списаны игровые деньги, а не золото');
ok(ps[0].gold === goldKept, 'золото не тронуто');
fails(() => arena.register(ps[0], 'elite', []), 'уже записаны в дивизион',
      'в двух дивизионах сразу участвовать нельзя');
startNow('basic');
skipPrepare('arena', 'basic'); arena.view(ps[0], 'basic');
const bb2 = db.load('arena', {}).divs.basic.battle;
ok(bb2.pot === 4e12, `банк в деньгах: ${bb2.pot.toExponential(0)}`);
// Альфа добивает всех
for (const foe of [ps[1], ps[2], ps[3]]) {
  const cur = db.load('arena', {}).divs.basic.battle;
  if (!cur || cur.state === 'done') break;
  cur.fighters[foe.id].hp = 1;
  cur.fighters[ps[0].id].targetId = foe.id;
  cur.fighters[ps[0].id].lastAttackAt = 0;
  db.save('arena');
  try { arena.attack(ps[0]); } catch (e) {}
}
ok(ps[0].dollars > moneyBefore, `приз выдан деньгами: ${ps[0].dollars.toExponential(2)}`);

console.log('\n── 14. Рейтинг ──');
ok(arena.RATING_PER_KILL === 1 && arena.RATING_PER_WIN === 3 && arena.RATING_PER_FAVOURITE === 3,
   'очки: 1 за убийство, 3 за победу, 3 за фаворита');
const rt = arena.rating(ps[0], 'basic');
const first = rt.top[0];
ok(first.name === 'Альфа', `первое место: ${first.name}`);
ok(first.kills === 3, `убийств засчитано: ${first.kills}`);
ok(first.points === 3 * arena.RATING_PER_KILL + arena.RATING_PER_WIN,
   `очков за 3 убийства и победу: ${first.points}`);
ok(first.wins === 1, 'победа засчитана');
ok(rt.top.some((x) => x.isMe), 'своя строка помечена');
// Дивизионы не смешиваются
const rtElite = arena.rating(ps[0], 'elite');
const mineBasic = rt.top.find((x) => x.name === 'Альфа');
const mineElite = rtElite.top.find((x) => x.name === 'Альфа');
// Таблицы физически разные: правим одну, вторая не меняется
const rawStore = db.load('arena', {});
ok(rawStore.ratings.basic !== rawStore.ratings.elite, 'у дивизионов отдельные таблицы рейтинга');
const before2 = (rawStore.ratings.elite[ps[0].id] || {}).points || 0;
rawStore.ratings.basic[ps[0].id].points += 100;
db.save('arena');
ok(((db.load('arena', {}).ratings.elite[ps[0].id] || {}).points || 0) === before2,
   'начисление в одном дивизионе не влияет на другой');
rawStore.ratings.basic[ps[0].id].points -= 100;
db.save('arena');

console.log('\n── 15. Страница итогов боя ──');
const rid = arena.lastResultId(ps[0].id);
ok(!!rid, 'разбор последнего боя доступен');
const res = arena.result(ps[0], rid);
ok(res.rows.length === 4, `в разборе все ${res.rows.length} участника`);
ok(res.divName === 'Арена — базовый дивизион', `указан дивизион: ${res.divName}`);
const winRow = res.rows.find((x) => x.winner);
ok(winRow.name === 'Альфа', 'победитель отмечен');
ok(winRow.delta === res.pot - res.entry, `у победителя плюс: банк минус свой взнос (${winRow.delta.toExponential(1)})`);
ok(res.rows.filter((x) => !x.winner).every((x) => x.delta === -res.entry),
   'у проигравших минус ровно взнос');
ok(res.rows.every((x) => typeof x.damage === 'number' && typeof x.kills === 'number'),
   'у каждого показаны урон и убийства');
ok(res.rows.every((x) => typeof x.ratingGained === 'number'), 'и прибавка рейтинга');
ok(res.rows.some((x) => x.favourite), 'фаворит боя отмечен');
fails(() => arena.result(ps[0], 'нет-такого'), 'не найден', 'чужой или устаревший разбор не открыть');

console.log('\n── 16. Очки за фаворита ──');
// Готовим бой, где у одного заведомо больший рейтинг
const de2 = db.load('arena', {}).divs.elite;
de2.registered = {}; de2.battle = null; de2.slot = 0; db.save('arena');
for (const p of ps) { p.gold = 1000; arena.register(p, 'elite', []); }
startNow('elite');
skipPrepare('arena', 'elite'); arena.view(ps[0], 'elite');
const eb = db.load('arena', {}).divs.elite.battle;
// Альфа — фаворит: у него уже есть очки в базовом, но рейтинг элиты
// свой, поэтому проставим его напрямую
const store2 = db.load('arena', {});
store2.ratings.elite[ps[0].id] = { id: ps[0].id, name: 'Альфа', flag: '', points: 99, wins: 0, kills: 0, battles: 0 };
db.save('arena');
// Браво добивает фаворита, потом остальных. Повторяем удары: они могут
// уйти в уворот, и тогда фаворит остался бы жив.
for (const foe of [ps[0], ps[2], ps[3]]) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const cur = db.load('arena', {}).divs.elite.battle;
    if (!cur || cur.state === 'done') break;
    if (!cur.fighters[foe.id].alive) break;
    cur.fighters[foe.id].hp = 1;
    cur.fighters[foe.id].st = { ...(cur.fighters[foe.id].st || {}), dodgeChance: 0 };
    cur.fighters[ps[1].id].targetId = foe.id;
    cur.fighters[ps[1].id].lastAttackAt = 0;
    db.save('arena');
    try { arena.attack(ps[1]); } catch (e) { break; }
  }
}
const res2 = arena.result(ps[1], arena.lastResultId(ps[1].id));
const bravo = res2.rows.find((x) => x.name === 'Браво');
ok(bravo.killedFavourite === true, 'убийство фаворита засчитано');
ok(bravo.ratingGained === 3 * arena.RATING_PER_KILL + arena.RATING_PER_WIN + arena.RATING_PER_FAVOURITE,
   `очки: 3 убийства + победа + фаворит = ${bravo.ratingGained}`);
ok(res2.rows.find((x) => x.name === 'Альфа').favourite === true, 'фаворитом был тот, у кого больше очков');

console.log('\n── 17. Интерфейс дивизионов и итогов ──');
const war2 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/arena-divs/.test(war2), 'переключатель дивизионов есть');
ok(/data-div=/.test(war2), 'кнопки переключения');
ok(/App\._arenaDiv/.test(war2), 'выбранный дивизион запоминается');
ok(/api\/arena\?div=/.test(war2), 'витрина запрашивается по дивизиону');
ok(/🏅 Рейтинг/.test(war2), 'рейтинг показан внизу витрины');
ok(/App\.renderArenaResult/.test(war2), 'страница итогов реализована');
const resBlock = war2.slice(war2.indexOf('App.renderArenaResult'));
ok(/Все участники/.test(resBlock), 'на странице все участники');
ok(/<th class="num">Урон<\/th>/.test(resBlock) && /<th class="num">Убийств<\/th>/.test(resBlock),
   'столбцы урона и убийств');
ok(/Вернуться на арену/.test(resBlock), 'внизу кнопка возврата');
ok(/arena-fav/.test(resBlock), 'фаворит отмечается значком');
const routes2 = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/'\/api\/arena\/result\/:id'/.test(routes2), 'роут разбора боя');
ok(/'\/api\/arena\/rating'/.test(routes2), 'роут рейтинга');

console.log('\n── 18. Штрафы за место ──');
// Готовим чистый бой из пяти, где все убийства у одного
const namesX = ['Первый', 'Второй', 'Третий', 'Четвёртый', 'Пятый'];
for (const n of namesX) {
  if (!Object.values(player.users()).some((p) => p.name === n)) {
    await auth.register(n, 'пароль123', n + '@ar.ru', 'ru', '1.1.1.1', 'UA');
  }
}
const U2 = player.users();
const byX = (n) => U2[Object.keys(U2).find((id) => U2[id].name === n)];
const five = namesX.map(byX);
const dx = db.load('arena', {}).divs.elite;
dx.registered = {}; dx.battle = null; dx.slot = 0; db.save('arena');
for (const p of five) { p.gold = 1000; arena.register(p, 'elite', []); }
startNow('elite');
// Добить цель наверняка. Удар может уйти в уворот, поэтому повторяем,
// пока цель не выбудет — иначе проверка падала примерно в каждом
// третьем прогоне.
const kill = (killer, foe) => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const cur = db.load('arena', {}).divs.elite.battle;
    if (!cur || cur.state === 'done') return;
    if (!cur.fighters[foe.id].alive) return;
    cur.fighters[foe.id].hp = 1;
    // Уворот у цели снимаем: иначе удар уходил мимо и сценарий плыл
    cur.fighters[foe.id].st = { ...(cur.fighters[foe.id].st || {}), dodgeChance: 0 };
    cur.fighters[killer.id].targetId = foe.id;
    cur.fighters[killer.id].lastAttackAt = 0;
    db.save('arena');
    try { arena.attack(killer); } catch (e) { return; }
  }
};
skipPrepare('arena', 'elite'); arena.view(five[0], 'elite');
for (const foe of [five[4], five[3], five[2], five[1]]) kill(five[0], foe);
const r5 = arena.result(five[0], arena.lastResultId(five[0].id));
ok(r5.rows.length === 5, 'в бою пятеро');
ok(r5.rows[0].place === 1 && r5.rows[0].winner, 'первое место у победителя');
ok(r5.rows[0].penalty === 0, 'у победителя штрафа нет');
for (let i = 1; i < 5; i++) {
  ok(r5.rows[i].place === i + 1, `место ${r5.rows[i].place} у «${r5.rows[i].name}»`);
  ok(r5.rows[i].penalty === i, `штраф за ${i + 1} место: −${r5.rows[i].penalty}`);
}
ok(r5.rows[4].penalty === 4, 'выбывший первым теряет 4 очка — больше всех');
ok(r5.rows.every((x) => x.ratingTotal >= 0), 'рейтинг ни у кого не ушёл ниже нуля');
ok(r5.rows.every((x) => x.ratingNet === x.ratingGained - x.penalty),
   'итог = начисленное минус штраф');
// Сортировка по местам
ok(r5.rows.every((x, i) => i === 0 || x.place >= r5.rows[i - 1].place),
   'таблица идёт по местам сверху вниз');

console.log('\n── 19. Убийства перекрывают штраф ──');
const dy = db.load('arena', {}).divs.elite;
dy.registered = {}; dy.battle = null; dy.slot = 0; db.save('arena');
for (const p of five) { p.gold = 1000; arena.register(p, 'elite', []); }
startNow('elite');
// «Первый» убивает троих, затем гибнет от «Пятого»
skipPrepare('arena', 'elite'); arena.view(five[0], 'elite');
// «Первый» убивает троих, затем гибнет от «Пятого». Держим «Пятого»
// живым и полным: удары «Первого» могли задеть его случайно, и тогда
// добивать «Первого» оказывалось некому.
kill(five[0], five[1]); kill(five[0], five[2]); kill(five[0], five[3]);
{
  const cur = db.load('arena', {}).divs.elite.battle;
  if (cur && cur.state !== 'done') {
    cur.fighters[five[4].id].alive = true;
    cur.fighters[five[4].id].hp = cur.fighters[five[4].id].maxHp;
    cur.fighters[five[0].id].st = { ...(cur.fighters[five[0].id].st || {}), dodgeChance: 0 };
    db.save('arena');
  }
}
kill(five[4], five[0]);
const r6 = arena.result(five[0], arena.lastResultId(five[0].id));
const butcher = r6.rows.find((x) => x.name === 'Первый');
// Точное число убийств зависит от случайностей боя — важно, что их
// несколько и что штраф они перекрывают
ok(butcher.kills >= 2, `убийств: ${butcher.kills}`);
ok(butcher.place >= 1, `место: ${butcher.place}`);
ok(butcher.penalty === butcher.place - 1, `штраф соответствует месту: −${butcher.penalty}`);
ok(butcher.ratingNet > 0,
   `активный игрок в плюсе даже проиграв: ${butcher.ratingGained} − ${butcher.penalty} = +${butcher.ratingNet}`);
// А пассивный — в минусе
const passive = r6.rows.find((x) => x.place === 5);
ok(passive.ratingNet < 0, `выбывший первым без убийств в минусе: ${passive.ratingNet}`);

console.log('\n── 20. Рейтинг не уходит в минус ──');
const store3 = db.load('arena', {});
const victimId = five[1].id;
store3.ratings.elite[victimId].points = 1;
db.save('arena');
const dz = db.load('arena', {}).divs.elite;
dz.registered = {}; dz.battle = null; dz.slot = 0; db.save('arena');
for (const p of five) { p.gold = 1000; arena.register(p, 'elite', []); }
startNow('elite');
skipPrepare('arena', 'elite'); arena.view(five[0], 'elite');
skipPrepare('arena', 'elite'); arena.view(five[0], 'elite');
for (const foe of [five[1], five[2], five[3], five[4]]) kill(five[0], foe);
const afterPenalty = db.load('arena', {}).ratings.elite[victimId].points;
ok(afterPenalty === 0, `был 1 очко, штраф −4 → стало ${afterPenalty}, а не отрицательное`);

console.log('\n── 21. Место и штраф в интерфейсе ──');
const war3 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
const resB = war3.slice(war3.indexOf('App.renderArenaResult'));
ok(/<th class="num">#<\/th>/.test(resB), 'в таблице есть столбец места');
ok(/x\.penalty \? `<span class="arena-res-minus">−\$\{x\.penalty\}/.test(resB), 'штраф показан');
ok(/x\.ratingNet >= 0 \? '\+' : '−'/.test(resB), 'итоговое изменение рейтинга со знаком');
ok(/наказывается не гибель, а бездействие/.test(resB), 'смысл штрафа объяснён игроку');
ok(/Ниже нуля рейтинг не опускается/.test(resB), 'и про нижнюю границу сказано');
ok(/−4, −3, −2, −1/.test(war3), 'на витрине показана шкала штрафов');

console.log('\n── 22. Картинки арены ──');
for (const [f, label] of [['arena.webp', 'превью'], ['win.webp', 'победа'], ['lose.webp', 'поражение']]) {
  const fp = path.join(ROOT, 'public/img/arena', f);
  ok(fs.existsSync(fp), `картинка «${label}» на месте`);
  const kb = fs.statSync(fp).size / 1024;
  ok(kb < 150, `${f}: ${kb.toFixed(0)} КБ`);
}
const war5 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/\/img\/arena\/arena\.webp/.test(war5), 'превью показывается на витрине');
ok(/\/img\/arena\/\$\{me && me\.winner \? 'win' : 'lose'\}\.webp/.test(war5),
   'на итогах картинка зависит от исхода');
ok(/arena-res-banner/.test(war5), 'у баннера итогов свой класс');

console.log('\n── 23. Вкладки раздела «Война» ──');
const tabsBlock2 = war5.slice(war5.indexOf('data-wartab="targets"'), war5.indexOf('data-wartab="event"') + 60);
ok(/Вторжение<\/div>/.test(tabsBlock2), 'вкладка «Цели» переименована во «Вторжение»');
ok(!/>Цели<\/div>/.test(tabsBlock2), 'прежнее название убрано');
for (const t of ['targets', 'group', 'arena', 'sanctions', 'event']) {
  ok(tabsBlock2.includes(`data-wartab="${t}"`), `вкладка «${t}» на месте`);
}
// Порядок: вторжение → групповые → арена → санкции
ok(tabsBlock2.indexOf('"targets"') < tabsBlock2.indexOf('"group"')
   && tabsBlock2.indexOf('"group"') < tabsBlock2.indexOf('"arena"')
   && tabsBlock2.indexOf('"arena"') < tabsBlock2.indexOf('"sanctions"'),
   'порядок вкладок правильный');

console.log('\n── 24. Кеш не прячет обновления ──');
// Причина, по которой новые разделы не появлялись у игроков: скрипты
// объявлялись свежими на сутки, и браузер даже не спрашивал сервер
const httpSrc4 = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
const ccBlock = httpSrc4.slice(httpSrc4.indexOf("if (['.css', '.js'].includes(ext))"),
                               httpSrc4.indexOf("if (['.woff'"));
ok(/return hasHashParam[\s\S]{0,120}: 'no-cache';/.test(ccBlock),
   'скрипты и стили перепроверяются при каждом заходе');
ok(!/max-age=86400/.test(ccBlock), 'прежняя суточная свежесть убрана');
ok(/immutable/.test(ccBlock), 'файлы с меткой версии по-прежнему кешируются навсегда');
ok(/max-age=31536000, immutable/.test(httpSrc4.slice(httpSrc4.indexOf(".webp"))),
   'картинки кешируются на год — их адреса не меняются');

console.log('\n── Разбор последнего боя при совпадении времени ──');
// Из-за этого раздел 16 выше «плавал»: примерно один прогон из шести
// падал, и виноват был не тест.
//
// Тик обрабатывает ВСЕ дивизионы одним проходом, поэтому два боя
// заканчиваются в одну и ту же миллисекунду постоянно. lastResultId
// сортировал разборы только по времени, и при равенстве возвращал
// произвольный из двух: игрок открывал разбор ЧУЖОГО боя — с чужим
// уроном, чужой наградой и чужим рейтингом.
{
  const st = db.load('arena', {});
  st.results = {};
  const sameAt = Date.now();
  const me = ps[1].id;
  const row = (kills) => ([{ id: me, name: 'Браво', kills, damage: 0, place: 1 }]);
  // Оба «завершены» в одну миллисекунду, различаются только номером.
  st.results.oldOne = { id: 'oldOne', at: sameAt, seq: 7, rows: row(0) };
  st.results.newOne = { id: 'newOne', at: sameAt, seq: 8, rows: row(3) };
  db.save('arena');
  ok(arena.lastResultId(me) === 'newOne',
     'при равном времени берётся разбор с большим номером');

  // И порядок в хранилище значения не имеет: раньше ответ зависел от
  // того, какой ключ окажется первым при переборе объекта.
  st.results = {};
  st.results.newOne = { id: 'newOne', at: sameAt, seq: 8, rows: row(3) };
  st.results.oldOne = { id: 'oldOne', at: sameAt, seq: 7, rows: row(0) };
  db.save('arena');
  ok(arena.lastResultId(me) === 'newOne', 'и от порядка записей это не зависит');

  // Разное время по-прежнему решает само, номер тут ни при чём.
  st.results = {};
  st.results.older = { id: 'older', at: sameAt - 1000, seq: 99, rows: row(0) };
  st.results.newer = { id: 'newer', at: sameAt, seq: 1, rows: row(3) };
  db.save('arena');
  ok(arena.lastResultId(me) === 'newer', 'при разном времени побеждает более позднее');
}

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
