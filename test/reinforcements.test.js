// ═══════════════════════════════════════════════════════════════════
// test/reinforcements.test.js — подкрепления союзникам, путь целиком
//
// Повод: жалоба «подкрепления не работают». Механика оказалась цела,
// но проверить её целиком было нечем: отдельные куски проверял
// fixes5, а путь «пригласил → принял → отправил → бонус виден» — нет.
//
// Что стережётся:
//  1. Отправить можно только ВЗАИМНОМУ союзнику; себе, чужому и своему
//     же второму персонажу — нельзя.
//  2. Бонус реально повышает мощь и в атаке, и в обороне.
//  3. Бонус ВИДЕН игроку: отдельной строкой в профиле, иначе он решает,
//     что подкрепления не работают — числа мощи те же самые.
//  4. Истёкшее подкрепление перестаёт давать бонус.
//  5. В журнале действий видно, КОМУ отправили: раньше стояло «—».
//
// Запуск: node test/reinforcements.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const pa = require('../dist/src/services/personalAlliance');
const rein = require('../dist/src/services/reinforcements');
const lt = require('../dist/src/services/logTranslate');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `rf${++ip}@t.ru`, 'ru', '10.0.14.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 20;
    const unit = config.UNITS.find((x) => x.unlock <= 20 && x.type === 'ground');
    player.ensureUnit(p, unit.id)[0] = 100;
    return p;
  };
  // Взаимный личный альянс — тем же путём, каким его проходит игрок
  const makeAllies = (a, b) => {
    pa.invitePlayer(a, b.name, nx);
    pa.acceptInvite(b, a.id, nx);
  };

  const A = await reg('Союзник');
  const B = await reg('Получатель');
  const C = await reg('Посторонний');

  console.log('\n[1] Кому можно отправить');
  ok(!pa.areAllies(A, B), 'до приглашения игроки не союзники');
  fails(() => rein.send(A, B.id, nx), 'только союзникам', 'без альянса отправить нельзя');
  makeAllies(A, B);
  ok(pa.areAllies(A, B) && pa.areAllies(B, A), 'после принятия приглашения альянс взаимный');
  fails(() => rein.send(A, A.id, nx), 'самому себе', 'себе отправить нельзя');
  fails(() => rein.send(A, C.id, nx), 'только союзникам', 'постороннему нельзя');

  console.log('\n[2] Отправка и бонус к мощи');
  const atkBefore = player.buildArmy(B, 'atk').power;
  const defBefore = player.buildArmy(B, 'def').power;
  const res = rein.send(A, B.id, nx);
  ok(rein.view(B).activeCount === 1, 'у получателя одно активное подкрепление');
  const each = config.REINFORCE.BONUS_PCT;
  ok(rein.bonusPct(B) === each, `бонус получателя: +${rein.bonusPct(B)}% (по конфигу +${each}%)`);
  const atkAfter = player.buildArmy(B, 'atk').power;
  const defAfter = player.buildArmy(B, 'def').power;
  ok(atkAfter === Math.round(atkBefore * (1 + each / 100)), `мощь атаки выросла: ${atkBefore} → ${atkAfter}`);
  ok(defAfter === Math.round(defBefore * (1 + each / 100)), `мощь обороны выросла: ${defBefore} → ${defAfter}`);
  ok(player.buildArmy(A, 'atk').power === atkBefore, 'у отправителя мощь не меняется — бонус получателю');
  fails(() => rein.send(A, B.id, nx), 'уже отправляли', 'второе подкрепление тому же союзнику за сутки не уходит');

  console.log('\n[3] Игрок видит, что подкрепления работают');
  const me = player.mePayload(B);
  ok(me.reinforce && me.reinforce.active === 1 && me.reinforce.bonusPct === each,
     `в профиле: ${me.reinforce.active} подкрепление, +${me.reinforce.bonusPct}%`);
  const meA = player.mePayload(A);
  ok(meA.reinforce.active === 0 && meA.reinforce.bonusPct === 0, 'у отправителя строки бонуса нет');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/Подкрепления союзников \(\$\{m\.reinforce\.active\}\)/.test(core), 'в профиле есть строка с числом подкреплений');
  ok(/\+\$\{m\.reinforce\.bonusPct\}% · уже в мощи/.test(core), 'и сказано, что бонус уже учтён в мощи');

  console.log('\n[4] Срок действия');
  B.reinforcements[0].expiresAt = Date.now() - 1000;
  ok(rein.bonusPct(B) === 0 && rein.view(B).activeCount === 0, 'истёкшее подкрепление бонуса не даёт');
  ok(player.buildArmy(B, 'atk').power === atkBefore, 'и мощь возвращается к прежней');

  console.log('\n[5] Журнал действий');
  ok(res.sentTo && res.sentTo.name === 'Получатель', 'сервис возвращает, кому отправлено');
  const line = lt.describe('/api/reinforcements/send', { toId: B.id }, res);
  ok(line.includes('Получатель'), `в журнале видно имя: «${line}»`);
  const blind = lt.describe('/api/reinforcements/send', { toId: B.id }, {});
  ok(!blind.includes('«—»'), `без имени в журнале стоит идентификатор, а не прочерк: «${blind}»`);

  console.log('\n[6] Лимиты на день и слоты получателя');
  const D = await reg('Донор');
  makeAllies(D, B);
  B.reinforcements = [];
  rein.send(D, B.id, nx);
  const perDay = config.REINFORCE.PER_DAY;
  D.reinforceSent = Array.from({ length: perDay }, (_, i) => ({ toId: 'x' + i, toName: 'x', at: Date.now() }));
  const E = await reg('Ещё один');
  makeAllies(D, E);
  fails(() => rein.send(D, E.id, nx), 'Лимит', `дневной лимит в ${perDay} отправок соблюдается`);
  B.reinforcements = Array.from({ length: config.REINFORCE.MAX_ACTIVE }, (_, i) => ({
    fromId: 'f' + i, fromName: 'кто-то', at: Date.now(), expiresAt: Date.now() + 3600000,
  }));
  const F = await reg('Опоздавший');
  makeAllies(F, B);
  fails(() => rein.send(F, B.id, nx), 'максимум подкреплений', 'сверх слотов получателя не отправить');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
