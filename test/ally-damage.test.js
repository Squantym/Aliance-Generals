// ═══════════════════════════════════════════════════════════════════
// test/ally-damage.test.js — два обращения в поддержку (18.09.2026)
//
// ОБРАЩЕНИЕ 1. «Игрок у меня в альянсе, но в профиле кнопка «пригласить
// в альянс», и в войне он не помечен союзником». Причина: союз мог стать
// ОДНОСТОРОННИМ. Исключение убирало запись только у того, кто исключал,
// а приём заявки при заполненном альянсе добавлял только второму. Игра
// считает союзниками только по ВЗАИМНОМУ ростеру (areAllies).
//
// ОБРАЩЕНИЕ 2. «Защита 21 млн, атака противника 3 млн — а он меня
// пробивает и убивает». Причина: урон шёл ступенями от соотношения сил,
// и «почти бессильный» бил на 3–5 за удар. Числа владельца (18.09.2026):
// доля атаки в защите < 40% → 1–5; 40–70% → 5–10; 70–85% → 10–15;
// от 85% → полный 30–36 и ВЫШЕ НЕ РАСТЁТ. Крит — множителем поверх.
//
// Что стережётся:
//  1. Исключение разрывает союз у обоих.
//  2. Приём заявки при полном альянсе — отказ, а не половинчатый союз.
//  3. Разовая починка делает старые односторонние связи взаимными.
//  4. Профиль и список целей после починки видят союзника.
//  5. Ступени урона и потолок 36; крит ×2 (с трофеем до ×6) — до 216.
//
// Запуск: node test/ally-damage.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const pa = require('../dist/src/services/personalAlliance');
const battle = require('../dist/src/services/battle');
const config = require('../dist/config/gameConfig');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, name) => {
  let err = '';
  try { fn(); } catch (e) { err = e.message; }
  ok(err.indexOf(part) >= 0, `${name}: «${err || 'ошибки не было'}»`);
};

(async () => {
  await db.init();
  let n = 0;
  const reg = async (name, level) => {
    await auth.register(name, 'пароль123', `ad_${++n}@t.ru`, 'ru', '10.0.6.' + n);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = level || 30;
    pa.ensure(p);
    return p;
  };
  const ally = (a, b) => {
    const N = [];
    pa.invitePlayer(a, b.name, N);
    pa.acceptInvite(b, a.id, N);
  };

  console.log('\n[1] Исключение разрывает союз у обоих');
  const A = await reg('Первый');
  const B = await reg('Второй');
  ally(A, B);
  ok(pa.areAllies(A, B), 'союз заключён');
  pa.removeMember(A, B.id, []);
  ok(!pa.areAllies(A, B), 'после исключения союзников нет');
  ok(!(B.allianceRoster || []).some((m) => m.id === A.id), 'у исключённого тоже пусто');
  ok(B.allianceMembers === 0, `счётчик у исключённого честный: ${B.allianceMembers}`);

  console.log('\n[2] Полный альянс — отказ, а не половина союза');
  const C = await reg('Третий', 1);     // лимит = уровень × 10
  const D = await reg('Четвёртый', 30);
  C.allianceMembers = pa.maxMembers(C); // альянс забит под завязку
  const N2 = [];
  pa.invitePlayer(D, C.name, N2);
  fails(() => pa.acceptInvite(C, D.id, N2), 'заполнен', 'принять заявку нельзя');
  ok(!(D.allianceRoster || []).some((m) => m.id === C.id) && !(C.allianceRoster || []).some((m) => m.id === D.id),
     'односторонней записи не появилось');

  console.log('\n[3] Починка старых односторонних союзов');
  const E = await reg('Пятый');
  const F = await reg('Шестой');
  // Так выглядели пары после старого исключения: запись осталась у одного
  E.allianceRoster = [{ id: F.id, name: F.name }];
  E.allianceMembers = 1;
  F.allianceRoster = [];
  F.allianceMembers = 0;
  ok(!pa.areAllies(E, F), 'до починки игра союзниками их не считает');
  const rep = pa.repairOneSided();
  ok(rep.pairs >= 1, `починено связей: ${rep.pairs}`);
  ok(pa.areAllies(E, F), 'после починки союз взаимный');
  ok(F.allianceMembers === 1, `счётчик второго игрока поправлен: ${F.allianceMembers}`);
  const again = pa.repairOneSided();
  ok(again.pairs === 0, 'повторный прогон ничего не меняет');

  console.log('\n[4] Профиль и список целей видят союзника');
  const prof = player.publicProfile(F, E);
  ok(prof.myAlly === true, 'в профиле он союзник — кнопки «пригласить» не будет');
  E.level = F.level;
  const opp = battle.opponents(E).opponents.find((o) => o.id === F.id);
  ok(!opp || opp.inMyAlliance === true, 'в списке целей помечен союзником');

  console.log('\n[5] Урон: ступени по доле атаки в защите');
  const roll = (atk, def, times) => {
    const out = [];
    for (let i = 0; i < (times || 400); i++) out.push(battle.resolveDamage(atk, def).dealt);
    return { min: Math.min(...out), max: Math.max(...out) };
  };
  let r = roll(3e6, 21e6);      // обращение игрока: 14% от защиты
  ok(r.min === 1 && r.max === 5, `атака 3 млн против защиты 21 млн: ${r.min}–${r.max}`);
  r = roll(3e6, 10e6);          // 30%
  ok(r.min === 1 && r.max === 5, `3 млн против 10 млн: ${r.min}–${r.max}`);
  r = roll(5e6, 10e6);          // 50%
  ok(r.min === 5 && r.max === 10, `5 млн против 10 млн: ${r.min}–${r.max}`);
  r = roll(7.5e6, 10e6);        // 75%
  ok(r.min === 10 && r.max === 15, `7,5 млн против 10 млн: ${r.min}–${r.max}`);
  r = roll(9.5e6, 10e6);        // 95%
  ok(r.min === 30 && r.max === 36, `9,5 млн против 10 млн — полный удар: ${r.min}–${r.max}`);
  r = roll(10e6, 10e6);         // равные силы
  ok(r.min === 30 && r.max === 36, `равные силы: ${r.min}–${r.max}`);
  r = roll(40e6, 10e6);         // четырёхкратное превосходство
  ok(r.max <= 36, `выше 100% урон не растёт: ${r.min}–${r.max}`);

  console.log('\n[6] Потолки');
  ok(config.BATTLE.MAX_HIT === 36, `обычный удар не выше 36 (${config.BATTLE.MAX_HIT})`);
  const maxCrit = Math.round(config.BATTLE.MAX_HIT * config.BATTLE.CRIT_MULT * (1 + 2.0));
  ok(maxCrit === 216, `крит с полным трофеем — до ${maxCrit}`);
  ok(config.BATTLE.UNIT_LOSS_DAMAGE_CAP === 36, 'потери техники считаются от того же потолка');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
