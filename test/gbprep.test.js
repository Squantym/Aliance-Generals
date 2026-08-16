// ═══════════════════════════════════════════════════════════════════
// Групповой бой: комната подготовки → авто-старт через 30 секунд.
// Отдельного «вступить в бой» больше нет: бой начинается сам, и все
// в нём с первой секунды.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-gbprep-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const gb = require(ROOT + '/dist/src/services/groupBattle');
const db = require(ROOT + '/dist/src/core/db');

const S = () => db.load('groupBattle', {});

async function main() {
// Четверо живых, остальных доберут боты
const names = ['Первый', 'Второй', 'Третий', 'Четвёртый'];
for (const n of names) await auth.register(n, 'пароль123', n + '@t.ru', 'ru', '1.1.1.1');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const P = names.map(by);
for (const p of P) { p.level = 50; p.dollars = 10_000_000; p.gold = 100000; }

console.log('\n── 1. Запись и сбор состава ──');
for (const p of P) gb.register(p, 'assault', []);
const s = S();
ok(Object.keys(s.registered || {}).length === 4, `записалось: ${Object.keys(s.registered || {}).length}`);

// Двигаем слот в прошлое — состав должен собраться и открыться комната
s.slot = Date.now() - 1000;
db.save('groupBattle');
gb.tick();

const b = S().battle;
ok(!!b, 'бой создан');
ok(b.state === 'preparing', `состояние: «${b.state}» — это комната подготовки, а не бой`);
ok(Object.keys(b.fighters).length === 10, `бойцов в составе: ${Object.keys(b.fighters).length}`);

console.log('\n── 2. Комната показывает ОБЕ команды поимённо ──');
const st = gb.battleState(P[0]);
ok(st.preparing === true, 'клиент видит признак подготовки');
ok(st.prepareLeftSec > 0 && st.prepareLeftSec <= 30, `до боя секунд: ${st.prepareLeftSec}`);
ok(Array.isArray(st.allies) && Array.isArray(st.enemies), 'списки союзников и противников отдаются');
ok(st.allies.length === 5, `в своей команде: ${st.allies.length}`);
ok(st.enemies.length === 5, `в команде противника: ${st.enemies.length}`);
ok(st.allies.some((f) => f.isMe), 'игрок видит себя в своей команде');
ok(st.allies.every((f) => f.name) && st.enemies.every((f) => f.name), 'у всех есть позывной');
ok(st.allies.every((f) => f.roleIcon) && st.enemies.every((f) => f.roleIcon), 'у всех показана роль');
ok(st.enemies.every((f) => typeof f.rating === 'number'), 'у противников виден рейтинг');
const allIds = st.allies.concat(st.enemies).map((f) => f.id);
ok(new Set(allIds).size === 10, 'все десять участников различны — никто не продублирован');

console.log('\n── 3. Кнопки «В бой» больше нет ──');
ok(st.canEnter === undefined, 'признак canEnter убран из ответа');
ok(st.entered === undefined, 'признак entered убран из ответа');
ok(st.enterLeftSec === undefined, 'отсчёт окна входа убран из ответа');
ok(typeof gb.enter !== 'function', 'функция enter() удалена из сервиса');
ok(gb.ENTER_WINDOW_MS === undefined, 'константа окна входа удалена');

console.log('\n── 4. Пока идёт подготовка — бить нельзя ──');
const foe = st.enemies[0];
let blocked = false, msg = '';
try { gb.act(P[0], 'attack', foe.id, []); } catch (e) { blocked = true; msg = e.message; }
ok(blocked, `атака в комнате отклонена: «${msg}»`);

console.log('\n── 5. Открытие комнаты = явка ──');
const b2 = S().battle;
ok(b2.fighters[P[0].id].seen === true, 'тот, кто запросил состояние, отмечен как пришедший');
ok(b2.fighters[P[3].id].seen === false, 'тот, кто не открывал, пока не отмечен');
gb.battleState(P[1]); gb.battleState(P[2]);
ok(S().battle.fighters[P[1].id].seen === true, 'второй тоже отмечен');

console.log('\n── 6. Через 30 секунд бой стартует САМ ──');
const b3 = S().battle;
b3.prepareUntil = Date.now() - 1;      // время вышло
db.save('groupBattle');
gb.tick();
const b4 = S().battle;
ok(b4.state === 'running', `состояние стало «${b4.state}» без единого нажатия`);
ok(b4.log.some((l) => /Бой начался/.test(l.text)), 'в логе отмечен старт боя');

console.log('\n── 7. Все дерутся сразу, никого не надо «вводить» ──');
const st2 = gb.battleState(P[0]);
ok(st2.preparing === false || st2.preparing === undefined, 'подготовка окончена');
const foe2 = st2.enemies.find((f) => f.alive);
let hit = null;
try { hit = gb.act(P[0], 'attack', foe2.id, []); } catch (e) { hit = { error: e.message }; }
ok(hit && !hit.error, hit && hit.error ? `атака не прошла: ${hit.error}` : 'атака проходит сразу после старта');

console.log('\n── 8. И тот, кто в комнату не заходил, тоже уязвим ──');
const b5 = S().battle;
const absent = b5.fighters[P[3].id];
ok(absent.replaced === true, 'не открывший комнату заменён ботом');
ok(absent.forfeited === true, 'ему засчитано поражение — награды не будет');
ok(absent.alive === true, 'но боец на поле и его можно бить');

console.log('\n── 9. Явившиеся ботами не подменены ──');
ok(b5.fighters[P[0].id].replaced !== true, 'пришедший играет сам');
ok(b5.fighters[P[0].id].forfeited !== true, 'и наград не лишён');

console.log('\n── 10. Маршрут /api/group/enter не падает (старые вкладки) ──');
const routesSrc = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(/api\/group\/enter/.test(routesSrc), 'маршрут сохранён для совместимости');
ok(!/gb\.enter\(/.test(routesSrc), 'но на удалённую функцию больше не ссылается');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main();
