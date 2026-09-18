// ═══════════════════════════════════════════════════════════════════
// test/update290.test.js — пакет правок владельца 19.09.2026
//
// Что стережётся:
//  1. Чат: «Набор в альянс» (бывший «Позывной»), новые разделы «Набор
//     в легион» и «Вопросы новичков» — сообщения не смешиваются.
//  2. Санкции: охота на цель под санкцией не даёт жертве права объявить
//     санкцию в ответ; право дают только обычные бои в ±10 уровней.
//  3. Поверженную цель под санкцией не добивают бесконечно.
//     Кто поверг цель (даже проиграв бой) — забирает банк, санкция снята
//     до новой; повержённой иначе цели в списке нет, пока не восстановится.
//  4. Сейф — только за победу и не в охоте по санкции.
//  5. Уведомление защитника: «урон по вам» — это урон по нему, а не его
//     ответный удар (жалоба «пишет 30 урона, а пробили на 2–3»).
//  6. Заказчик санкции не бьёт свою же цель.
//  7. Бот всегда проигрывает игроку и бьёт не больше 16.
//  8. Неявка в групповой бой: поражение сразу, 🤖 у имени, в бой не
//     пускает (живые проверки — в team-battles.test.js).
//  9. Комната подготовки не мигает и не зависает на нуле.
//
// Запуск: node test/update290.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const sanctions = require('../dist/src/services/sanctions');
const social = require('../dist/src/services/social');
const notifications = require('../dist/src/services/notifications');
const bankHack = require('../dist/src/services/bankHack');
const config = require('../dist/config/gameConfig');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, name) => {
  let err = '';
  try { fn(); } catch (e) { err = e.message; }
  ok(err.indexOf(part) >= 0, `${name}: «${err || 'ошибки не было'}»`);
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

(async () => {
  await db.init();
  let n = 0;
  const reg = async (name, level) => {
    await auth.register(name, 'пароль123', `u290_${++n}@t.ru`, 'ru', '10.0.29.' + n);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = level || 30;
    p.dollars = 1e9;
    return p;
  };
  // Атака без паузы между ударами и с полными запасами
  const hit = (u, id) => {
    u.lastAttackAt = 0;
    u.pendingBankHack = null; u.pendingBreach = null; u.pendingMineDefuse = null;
    u.res.am.cur = 50;
    u.res.hp.cur = player.maxima(u).hp;
    return battle.attack(u, id, [], { allyOk: true });
  };
  const heal = (u) => { player.refresh(u); u.res.hp.cur = player.maxima(u).hp; };

  console.log('\n[1] Разделы чата');
  const Ch = await reg('Болтун', 30);
  social.chatPost(Ch, 'ищу легион', 'legion');
  Ch.lastChatAt = 0;
  social.chatPost(Ch, 'как качаться?', 'newbie');
  const inLegion = social.chatGet(Ch, 0, 'legion');
  const inNewbie = social.chatGet(Ch, 0, 'newbie');
  const inGlobal = social.chatGet(Ch, 0, 'global');
  const texts = (r) => JSON.stringify(r);
  ok(texts(inLegion).includes('ищу легион') && !texts(inLegion).includes('как качаться'), 'раздел «Набор в легион» свой');
  ok(texts(inNewbie).includes('как качаться') && !texts(inNewbie).includes('ищу легион'), 'раздел «Вопросы новичков» свой');
  ok(!texts(inGlobal).includes('ищу легион') && !texts(inGlobal).includes('как качаться'), 'в общий чат не протекает');
  const soc = read('public/js/screens/social.js');
  ok(soc.includes('data-croom="recruit">📣 Набор в альянс<') && !soc.includes('📣 Позывные'), 'вкладка называется «Набор в альянс»');
  ok(soc.includes('Набор в легион') && soc.includes('Вопросы новичков'), 'новые вкладки есть на экране');

  console.log('\n[2] Санкции: охота не даёт права на ответную санкцию');
  const Hunter = await reg('Охотник', 30);
  const Victim = await reg('Жертва', 30);
  const Orderer = await reg('Заказчик', 30);
  Orderer.crestTakers = [{ id: Victim.id, name: Victim.name, at: Date.now() }];
  sanctions.declare(Orderer, Victim.id, sanctions.MIN_BOUNTY, []);
  ok(sanctions.isUnderSanction(Victim.id), 'санкция объявлена');
  heal(Victim);
  hit(Hunter, Victim.id);
  ok(!(Victim.attackedBy || {})[Hunter.id], 'охотник по санкции не записан в нападавшие');
  fails(() => sanctions.declare(Victim, Hunter.id, sanctions.MIN_BOUNTY, []), '', 'жертва не может объявить санкцию охотнику');
  let refused = '';
  try { sanctions.declare(Victim, Hunter.id, sanctions.MIN_BOUNTY, []); } catch (e) { refused = e.message; }
  ok(refused.length > 0 && !sanctions.isUnderSanction(Hunter.id), 'на охотника санкции нет');

  // Обычный бой в ±10 уровней — право даётся, как и раньше
  const Plain = await reg('Обычный', 30);
  const Bully = await reg('Задира', 35);
  heal(Plain);
  hit(Bully, Plain.id);
  ok(!!(Plain.attackedBy || {})[Bully.id], 'обычный бой в ±10 уровней — нападавший записан');
  sanctions.declare(Plain, Bully.id, sanctions.MIN_BOUNTY, []);
  ok(sanctions.isUnderSanction(Bully.id), 'после обычного боя санкция объявляется');

  // Цель под санкцией вне ±10 уровней — тоже не даёт права
  const Far = await reg('Дальний', 60);
  heal(Victim);
  hit(Far, Victim.id);
  ok(!(Victim.attackedBy || {})[Far.id], 'бой вне ±10 уровней не даёт права на санкцию');

  console.log('\n[3] Заказчик не бьёт свою цель');
  heal(Victim);
  fails(() => hit(Orderer, Victim.id), 'сами объявили', 'атака своей цели отклонена');

  console.log('\n[4] Поверженную цель не добивают');
  Victim.res.hp.cur = 1;
  fails(() => hit(Hunter, Victim.id), 'уже повержен', 'цель на 1 HP под санкцией недоступна');
  Victim.res.hp.t = Date.now();   // регенерация ещё не набежала
  const lst = sanctions.list(Hunter).sanctions.find((s) => s.targetId === Victim.id);
  ok(!lst, 'повержённой цели в списке санкций нет');
  ok(sanctions.isUnderSanction(Victim.id), 'санкция и банк при этом сохранились');
  // Восстановление без захода в игру: прошло много времени
  Victim.res.hp.t = Date.now() - 24 * 3600 * 1000;
  const lst2 = sanctions.list(Hunter).sanctions.find((s) => s.targetId === Victim.id);
  ok(!!lst2, 'восстановилась (даже не заходя в игру) — снова в списке');

  console.log('\n[4б] Повергнул цель — банк охотнику, санкция снята (даже при проигранном бое)');
  // Нужен именно ПРОИГРАННЫЙ бой с добивающим ударом: победа платила и раньше
  // Охотник без армии проигрывает наверняка, но 1–5 урона наносит
  const huntUnits = Hunter.units;
  Hunter.units = {};
  let lostKill = null;
  for (let i = 0; i < 50 && !lostKill; i++) {
    if (!sanctions.isUnderSanction(Victim.id)) sanctions.declare(Orderer, Victim.id, sanctions.MIN_BOUNTY, []);
    heal(Victim);
    const mx = player.maxima(Victim).hp;
    Victim.res.hp.cur = Math.floor(mx * sanctions.HP_THRESHOLD_PCT) + 1;   // один удар до порога
    const bank = sanctions.list(Hunter).sanctions.find((x) => x.targetId === Victim.id);
    Hunter.lastAttackAt = 0; Hunter.res.am.cur = 50; Hunter.res.hp.cur = player.maxima(Hunter).hp;
    const notes = [];
    const r = battle.attack(Hunter, Victim.id, notes, { allyOk: true });
    if (!r.win && r.dealt > 0) lostKill = { r, notes, bank: bank && bank.bounty };
  }
  Hunter.units = huntUnits;
  ok(!!lostKill, 'найден проигранный бой с добивающим ударом');
  if (lostKill) {
    ok(lostKill.notes.some((t) => String(t).includes('САНКЦИЯ ВЫПОЛНЕНА')) && lostKill.bank > 0,
       `охотник получил банк ${lostKill.bank}`);
    ok(!sanctions.isUnderSanction(Victim.id), 'санкция снята');
    ok(!sanctions.list(Hunter).sanctions.some((x) => x.targetId === Victim.id), 'цели нет в списке');
    heal(Victim);
    ok(!sanctions.list(Hunter).sanctions.some((x) => x.targetId === Victim.id),
       'и после восстановления она не возвращается сама');
    sanctions.declare(Orderer, Victim.id, sanctions.MIN_BOUNTY, []);
    ok(sanctions.list(Hunter).sanctions.some((x) => x.targetId === Victim.id), 'вернётся только новой санкцией');
  }

  console.log('\n[5] Сейф — только за победу и не по санкции');
  const orig = bankHack.tryOffer;
  const calls = [];
  bankHack.tryOffer = (u, t) => { calls.push(t.id); return null; };
  const Safer = await reg('Взломщик', 30);
  const Rich = await reg('Богач', 30);
  let wins = 0, losses = 0;
  for (let i = 0; i < 40; i++) {
    calls.length = 0;
    heal(Rich);
    const r = hit(Safer, Rich.id);
    if (r.win) { wins++; ok(calls.length === 1, `победа ${i}: шанс сейфа проверен`); }
    else { losses++; if (calls.length) ok(false, `поражение ${i}: сейф предложен`); }
  }
  // Проигрыши нужны, иначе проверка пустая: даём защитнику армию сильнее
  if (!losses) {
    Rich.skills.defense = 5000; Safer.skills.attack = 0;
    for (let i = 0; i < 10; i++) {
      calls.length = 0; heal(Rich);
      const r = hit(Safer, Rich.id);
      if (!r.win) { losses++; ok(calls.length === 0, `поражение ${i}: сейфа нет`); }
    }
  }
  ok(wins > 0 && losses > 0, `проверены и победы (${wins}), и поражения (${losses})`);
  // Именно ПОБЕДА охотника: при поражении сейфа нет и без правила
  let huntWins = 0, huntCalls = 0;
  for (let i = 0; i < 30 && huntWins < 5; i++) {
    calls.length = 0;
    heal(Victim);
    const rs = hit(Hunter, Victim.id);
    if (rs.win) { huntWins++; huntCalls += calls.length; }
  }
  ok(huntWins > 0 && huntCalls === 0, `охота по санкции: побед ${huntWins}, сейф предложен ${huntCalls} раз`);
  bankHack.tryOffer = orig;

  console.log('\n[6] Уведомление защитника: урон по нему, а не его ответ');
  const Atk = await reg('Атакующий', 30);
  const Def = await reg('Защитник', 30);
  // Обе ветки: защитник проиграл (attack_lost) и отбился (attack_defended).
  // Берём только бои, где урон в обе стороны разный — иначе подмену
  // одного числа другим не видно.
  const seen = {};
  for (let i = 0; i < 80 && !(seen.attack_lost && seen.attack_defended); i++) {
    heal(Def);
    const r6 = hit(Atk, Def.id);
    if (r6.dealt === r6.received) continue;
    const note = notifications.list(Def).notifications[0];
    if (!note || seen[note.kind]) continue;
    seen[note.kind] = true;
    const pl = note.payload || {};
    ok(pl.dealt === r6.dealt, `${note.kind}: «урон по вам» = урон по защитнику (${pl.dealt} = ${r6.dealt})`);
    ok(pl.youDealt === r6.received, `${note.kind}: «ваш ответный удар» (${pl.youDealt} = ${r6.received})`);
  }
  ok(seen.attack_lost && seen.attack_defended, 'проверены обе ветки уведомления');
  for (const f of ['public/js/screens/social.js', 'public/js/app.js']) {
    const s = read(f);
    ok(s.includes('Ваш ответный удар') && s.includes('p.youDealt'), `${f}: отдельная строка ответного удара`);
  }

  console.log('\n[7] Бот всегда проигрывает и бьёт до 16');
  ok(config.BATTLE.BOT_MAX_HIT === 16, 'потолок удара бота — 16');
  const Farmer = await reg('Фермер', 30);
  Farmer.skills.attack = 0; Farmer.skills.defense = 0;
  let botRuns = 0, botMax = 0, botLost = 0;
  for (let i = 0; i < 60 && botRuns < 30; i++) {
    Farmer.lastAttackAt = 0;
    const opp = battle.opponents(Farmer).opponents.filter((o) => o.isBot);
    if (!opp.length) break;
    let r;
    try { r = hit(Farmer, opp[0].id); } catch (e) { continue; }
    botRuns++;
    botMax = Math.max(botMax, r.received);
    if (!r.win) botLost++;
  }
  ok(botRuns >= 10, `боёв с ботами проведено: ${botRuns}`);
  ok(botLost === 0, `бот ни разу не победил (поражений игрока: ${botLost})`);
  ok(botMax <= 16, `наибольший удар бота: ${botMax}`);

  console.log('\n[8] Неявка в бой — сервер и экран');
  for (const f of ['src/services/squadBattle.ts', 'src/services/groupBattle.ts', 'src/services/arena.ts']) {
    const s = read(f);
    ok(s.includes('function forfeitNow') && s.includes('forfeited: true'), `${f}: поражение сразу и итог вместо поля боя`);
    ok(/botPlayed: !!\w+\.replaced/.test(s), `${f}: отметка «за игрока играет бот»`);
  }
  const war = read('public/js/screens/war.js');
  ok((war.match(/bot-played/g) || []).length >= 5, 'у имени рисуется 🤖');

  console.log('\n[9] Комната подготовки не мигает и не зависает');
  ok(war.includes('App._armPrepTimer = (leftSec)') && /left <= 0 \|\| n % 3 === 0/.test(war),
     'после нуля отсчёт спрашивает сервер каждую секунду');
  ok(war.includes('const sameGb = App._sameAsBefore(SIG, App._gbSig(b));'),
     'отпечаток запоминается и при первом показе');
  ok(/&& sameGb\) \{[\s\S]{0,300}App\._armPrepTimer\(b\.prepareLeftSec\)/.test(war),
     'ветка «ничего не изменилось» тоже взводит таймер');
  const rg = war.slice(war.indexOf('App.renderGroup = async'), war.indexOf('App.renderGroup = async') + 600);
  ok(!/^\s*document\.body\.classList\.remove\('combat-fullscreen'\);\n\s*const box/m.test(rg),
     'витрина не снимает полноэкранный режим, пока игрок в комнате');

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
