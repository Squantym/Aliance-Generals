// ===================================================================
// test/test-update65.js — окно «Пока вас не было»:
// кто нападал и сколько раз, полный ущерб (деньги, техника, диверсанты,
// постройки), ракетные удары.
// ===================================================================
const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-65';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const warReport = require('../dist/src/services/warReport');

async function main() {
await auth.register('Жертва', 'пароль123', 'v@t.ru', 'ru', '1.1.1.1');
await auth.register('Волков', 'пароль123', 'a@t.ru', 'ru', '2.2.2.2');
await auth.register('Гадюка', 'пароль123', 'b@t.ru', 'ua', '3.3.3.3');
const users = player.users();
const by = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const victim = by('Жертва'), a1 = by('Волков'), a2 = by('Гадюка');
a1.level = 40; a2.level = 25;

console.log('\n── 1. Сводка копится только для оффлайн-игрока ──');
victim.lastSeen = Date.now();                    // онлайн
warReport.onAttack(victim, { defeat: true, moneyLost: 1000, by: { id: a1.id, name: a1.name } });
ok(warReport.view(victim) === null, 'пока игрок онлайн, сводка не копится — он видит живые уведомления');
victim.lastSeen = Date.now() - 40 * 60 * 1000;   // ушёл 40 минут назад

console.log('\n── 2. Кто нападал и сколько раз ──');
// Волков бьёт 3 раза: дважды побеждает, один раз отбит
warReport.onAttack(victim, { defeat: true, moneyLost: 500000, losses: [{ id: 'ground_3', name: 'Т-72', count: 4 }], by: { id: a1.id, name: a1.name, flag: 'ru', level: 40 } });
warReport.onAttack(victim, { defeat: true, moneyLost: 300000, losses: [{ id: 'ground_3', name: 'Т-72', count: 2 }], by: { id: a1.id, name: a1.name, flag: 'ru', level: 40 } });
warReport.onAttack(victim, { defeat: false, losses: [{ id: 'air_2', name: 'МиГ-21', count: 1 }], by: { id: a1.id, name: a1.name, flag: 'ru', level: 40 } });
// Гадюка бьёт один раз
warReport.onAttack(victim, { defeat: true, moneyLost: 120000, losses: [{ id: 'sea_1', name: 'Катер', count: 3 }], by: { id: a2.id, name: a2.name, flag: 'ua', level: 25 } });

let v = warReport.view(victim);
ok(v.attacks === 4, `всего атак: ${v.attacks}`);
ok(v.attackers.length === 2, `нападавших: ${v.attackers.length} — теперь видно, КТО именно`);
const volkov = v.attackers.find((x) => x.name === 'Волков');
const gad = v.attackers.find((x) => x.name === 'Гадюка');
ok(v.attackers[0].name === 'Волков', 'список отсортирован: чаще всех нападал Волков — он первый');
ok(volkov.attacks === 3, `Волков напал ${volkov.attacks} раза`);
ok(volkov.won === 2 && volkov.lost === 1, `из них разбил вас ${volkov.won}, отбито ${volkov.lost}`);
ok(volkov.moneyTaken === 800000, `Волков унёс $${volkov.moneyTaken}`);
ok(volkov.unitsKilled === 7, `Волков уничтожил техники: ${volkov.unitsKilled} ед.`);
ok(volkov.flag === 'ru' && volkov.level === 40, 'у нападавшего есть флаг и уровень для карточки');
ok(gad.attacks === 1 && gad.moneyTaken === 120000, `Гадюка: ${gad.attacks} атака, унёс $${gad.moneyTaken}`);

console.log('\n── 3. Общий ущерб ──');
ok(v.moneyLost === 920000, `всего похищено: $${v.moneyLost}`);
ok(v.unitsLost === 10, `всего потеряно техники: ${v.unitsLost} ед.`);
ok(v.losses.length === 3, `видов техники в потерях: ${v.losses.length}`);
ok(v.losses[0].count >= v.losses[1].count, 'техника отсортирована по убыванию потерь');

console.log('\n── 4. Ракетный удар: весь ущерб в той же сводке ──');
warReport.onRocket(victim, {
  attackerName: 'Гадюка', moneyLost: 2000000,
  destroyedBuildings: 2, destroyedBuildingsText: 'Казарма, Склад',
  techLost: 15, techLostText: 'Т-72 ×10, МиГ-21 ×5',
  lostSaboteurs: { ground: 12, secret: 3 },
  at: Date.now(),
});
v = warReport.view(victim);
ok(v.rockets.length === 1, 'ракетный удар попал в сводку');
const rk = v.rockets[0];
ok(rk.by === 'Гадюка', `указано, кто ударил: ${rk.by}`);
ok(rk.buildings === 2 && rk.buildingsText.includes('Казарма'), `разрушено построек: ${rk.buildings} (${rk.buildingsText})`);
ok(rk.techLost === 15 && !!rk.techLostText, `уничтожено техники: ${rk.techLost} (${rk.techLostText})`);
ok(rk.saboteurs.ground === 12 && rk.saboteurs.secret === 3, 'потери диверсантов по типам сохранены');
ok(v.saboteursLostTotal === 15, `всего погибло диверсантов: ${v.saboteursLostTotal}`);
ok(v.buildingsLost === 2, `всего разрушено построек: ${v.buildingsLost}`);
ok(v.moneyLost === 2920000, `деньги от ракеты добавились к общему ущербу: $${v.moneyLost}`);

console.log('\n── 5. Санкции ──');
warReport.onSanction(victim, { byId: a1.id, byName: 'Волков', byFlag: 'ru', amount: 50000 });
warReport.onSanction(victim, { byId: a1.id, byName: 'Волков', byFlag: 'ru', amount: 30000 });
v = warReport.view(victim);
ok(v.sanctions.length === 1 && v.sanctions[0].count === 2, 'повторные санкции одного заказчика объединены');
ok(v.sanctions[0].amount === 80000, `суммарная награда за вашу голову: $${v.sanctions[0].amount}`);

console.log('\n── 6. Закрытие окна очищает сводку ──');
warReport.ack(victim);
ok(warReport.view(victim) === null, 'после просмотра сводка очищена — второй раз не покажется');

console.log('\n── 7. Совместимость со старой копилкой ──');
// У игроков на проде уже могла накопиться сводка в старом формате
victim.offlineWar = { since: Date.now() - 1000, attacks: 2, defended: 0, defeats: 2, moneyLost: 500, losses: {}, sanctions: {} };
warReport.onAttack(victim, { defeat: true, moneyLost: 100, by: { id: a1.id, name: 'Волков' } });
v = warReport.view(victim);
ok(v && v.attacks === 3, 'старая копилка дополняется без ошибок');
ok(v.attackers.length === 1, 'новые поля появляются на лету');
ok(Array.isArray(v.rockets) && v.rockets.length === 0, 'ракеты в старой копилке — пустой список, а не падение');

console.log('\n── 8. Фронт ──');
const app = fs.readFileSync(__dirname + '/../public/js/app.js', 'utf8');
ok(app.includes('Пока вас не было'), 'окно переименовано понятнее');
ok(app.includes('wr-attacker'), 'есть блок «Кто нападал»');
ok(app.includes('Ракетные удары'), 'есть блок ракетных ударов');
ok(app.includes('Погибло диверсантов'), 'показываются потери диверсантов');
ok(app.includes('Разрушено построек'), 'показываются разрушенные постройки');
ok(app.includes('sabName'), 'типы диверсантов переводятся на русский');
ok(app.includes('App.go(\'profile/'), 'по имени нападавшего можно перейти в его профиль');
const css = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
ok(css.includes('.wr-stats') && css.includes('.wr-rocket'), 'стили окна добавлены');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
