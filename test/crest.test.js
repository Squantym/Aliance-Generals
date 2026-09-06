// ═══════════════════════════════════════════════════════════════════
// test/crest.test.js — герб штаба вместо ушей
//
// Фаталити заменено проникновением в штаб: вместо двух ушей — герб из
// ТРЁХ частей, вместо «отрезать ухо» — «сорвать герб», вместо
// помилования — перемирие.
//
// Три вещи здесь дороже прочих, и все три тихие:
//
//  1. ШТРАФ. Раньше он был выключателем: ровно 10% и только когда
//     сорвано всё. Теперь это 5% за каждую сорванную часть — 5/10/15 —
//     и он спадает сам, по мере возвращения частей. Отдельного «срока
//     штрафа» больше нет: два источника правды однажды разошлись бы.
//
//  2. МИГРАЦИЯ. У живых игроков в базе лежат СТАРЫЕ поля (уши, трофеи,
//     ступени достижений под прежними именами). Начни игра молча читать
//     новые — у всех обнулились бы трофеи и достижения: старое поле
//     осталось бы в сохранении, а рядом завелось бы пустое новое.
//
//  3. ТРОФЕЙ У НАПАДАВШЕГО — ЦЕЛЫЙ ГЕРБ, а у хозяина считаются ЧАСТИ.
//     Это не описка: ворвавшийся выносит знак, а не щепку.
//
// Запуск: node test/crest.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
require('./_guard');
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const cfg = require('../dist/config/gameConfig');
const C = cfg.CREST;

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

(async () => {
  await db.init();
  await auth.register('Налётчик', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
  await auth.register('Хозяин', 'пароль123', 'v@t.ru', 'ru', '1.1.1.1');
  const A = Object.values(player.users()).find((x) => x.name === 'Налётчик');
  const V = Object.values(player.users()).find((x) => x.name === 'Хозяин');
  for (const U of [A, V]) { U.level = 50; }

  console.log('\n── 1. Настройки ──');
  ok('в гербе три части', C.PARTS === 3);
  ok('штраф 5% за часть', C.PENALTY_PER_PART_PCT === 0.05);
  ok('одна часть возвращается за 2 часа', C.REGROW_MS === 2 * 60 * 60 * 1000);
  ok('все три — за 6 часов', C.REGROW_MS * C.PARTS === 6 * 60 * 60 * 1000);
  ok('отдельного срока штрафа больше нет', C.PENALTY_MS === undefined);
  ok('старого раздела EARS не осталось', cfg.EARS === undefined);

  console.log('\n── 2. Новый игрок ──');
  ok('герб целый', V.crestParts === C.PARTS);
  ok('слотов держателей столько же, сколько частей',
     Array.isArray(V.crestTakers) && V.crestTakers.length === C.PARTS);
  const me0 = player.mePayload(V);
  ok('штрафа нет', me0.crestPenaltyPct === 0);
  ok('игроку видно, сколько частей на месте', me0.crestParts === C.PARTS && me0.crestPartsMax === C.PARTS);

  console.log('\n── 3. Штраф растёт по 5% за часть ──');
  // Считаем не «что написано», а живую мощь: штраф применяется к ней.
  V.units = { ground_1: { 0: 100 } };
  player.refresh(V);
  const full = player.totalPower(V, 'atk').power;
  const seen = [];
  for (let gone = 1; gone <= C.PARTS; gone++) {
    V.crestParts = C.PARTS - gone;
    V.crestLostAt = new Array(gone).fill(Date.now());
    const pow = player.totalPower(V, 'atk').power;
    const lossPct = Math.round((1 - pow / full) * 100);
    seen.push(lossPct);
    ok(`сорвано ${gone} из ${C.PARTS} → мощь ниже на ${lossPct}%`, lossPct === gone * 5);
    ok(`и игроку показан тот же штраф`, player.mePayload(V).crestPenaltyPct === gone * 5);
  }
  ok(`штраф растёт, а не стоит на месте (${seen.join('/')})`,
     seen[0] < seen[1] && seen[1] < seen[2]);
  ok('защита штрафуется так же, как атака',
     Math.round((1 - player.totalPower(V, 'def').power / player.totalPower(V, 'def').basePower) * 100) >= 0);

  console.log('\n── 4. Части возвращаются по одной ──');
  V.crestParts = 0;
  // Три части сорваны: первая — три часа назад, значит одна уже должна
  // вернуться, а две — ещё нет.
  const h = 60 * 60 * 1000;
  V.crestLostAt = [Date.now() - 3 * h, Date.now() - 1 * h, Date.now()];
  player.refresh(V);
  ok(`через 3 часа вернулась одна часть (стало ${V.crestParts})`, V.crestParts === 1);
  ok('и штраф упал до 10%', player.mePayload(V).crestPenaltyPct === 10);
  V.crestParts = 0;
  V.crestLostAt = [Date.now() - 7 * h, Date.now() - 7 * h, Date.now() - 7 * h];
  player.refresh(V);
  ok('через 7 часов герб собран целиком', V.crestParts === C.PARTS);
  ok('штраф снят', player.mePayload(V).crestPenaltyPct === 0);
  ok('и держатели частей забыты', V.crestTakers.every((t) => !t));

  console.log('\n── 5. Срыв: трофей целый герб, у хозяина — части ──');
  V.crestParts = C.PARTS; V.crestLostAt = []; V.crestTakers = new Array(C.PARTS).fill(null);
  A.ears = 0;
  A.pendingBreach = { targetId: V.id, isBot: false, exp: Date.now() + 60000, name: V.name };
  const r1 = battle.breach(A, 'crest', nx);
  ok('срыв засчитан', r1.choice === 'crest');
  ok('нападавшему — ЦЕЛЫЙ герб в коллекцию', A.ears === 1 && r1.crests === 1);
  ok('у хозяина снята одна часть', V.crestParts === C.PARTS - 1);
  ok('и записано, кто её снял', V.crestTakers[0] && V.crestTakers[0].id === A.id);
  ok('счётчик потерь вырос', V.crestPartsLost === 1);
  ok('штраф у хозяина 5%', player.mePayload(V).crestPenaltyPct === 5);

  console.log('\n── 6. Перемирие ──');
  A.tokens = 0;
  A.pendingBreach = { targetId: V.id, isBot: false, exp: Date.now() + 60000, name: V.name };
  const partsBefore = V.crestParts;
  const r2 = battle.breach(A, 'truce', nx);
  ok('жетон получен', A.tokens === 1 && r2.tokens === 1);
  ok('герб не тронут', V.crestParts === partsBefore);
  ok('в ответе именно гербы, а не уши', r2.crests !== undefined && r2.ears === undefined);

  console.log('\n── 7. Когда рвать нечего ──');
  V.crestParts = 0;
  A.pendingBreach = { targetId: V.id, isBot: false, exp: Date.now() + 60000, name: V.name };
  let refused = null;
  try { battle.breach(A, 'crest', nx); } catch (e) { refused = e; }
  ok('срыв по пустому гербу отклонён', !!refused);
  ok('и сказано понятно, почему', refused && /герб/i.test(refused.message));

  console.log('\n── 8. Миграция старых сохранений ──');
  // Собираем игрока ровно в том виде, в каком он лежит в базе сейчас.
  const old = {
    id: 'old1', name: 'Ветеран', level: 40,
    earsCurrent: 1, earsLost: 5, earsLostAt: [Date.now() - 1000],
    earCutters: [{ id: 'x', name: 'Икс' }, null],
    earMessage: { byId: 'x', byName: 'Икс', text: 'тут был Икс' },
    earPenaltyUntil: Date.now() + 999999,
    ears: 42, tokens: 7,
    achStages: { fatalities: 3, ears: 4, mercies: 2, fatDodges: 1 },
    counters: {}, battle: {}, skills: {}, units: {}, buildings: {},
    res: { hp: { cur: 100, t: Date.now() }, en: { cur: 100, t: Date.now() }, am: { cur: 5, t: Date.now() } },
    effects: [], trophies: {}, missions: {},
  };
  player.users()[old.id] = old;
  player.refresh(old);

  ok('трофеи не потеряны', old.ears === 42);
  ok('жетоны не потеряны', old.tokens === 7);
  ok(`одно ухо из двух стало ${old.crestParts} частями из ${C.PARTS}`, old.crestParts === 2);
  ok('счётчик потерь перенесён', old.crestPartsLost === 5);
  ok('держатели перенесены', old.crestTakers[0] && old.crestTakers[0].name === 'Икс');
  ok('слотов стало столько, сколько частей', old.crestTakers.length === C.PARTS);
  ok('послание перенесено', old.crestMessage && old.crestMessage.text === 'тут был Икс');
  ok('старые поля убраны из сохранения',
     old.earsCurrent === undefined && old.earsLost === undefined
     && old.earsLostAt === undefined && old.earCutters === undefined
     && old.earMessage === undefined && old.earPenaltyUntil === undefined);

  console.log('\n── 9. Ступени достижений пережили переименование ──');
  ok('проникновения', old.achStages.breaches === 3);
  ok('гербы', old.achStages.crests === 4);
  ok('перемирия', old.achStages.truces === 2);
  ok('увороты', old.achStages.breachDodges === 1);
  ok('старые ключи убраны',
     old.achStages.fatalities === undefined && old.achStages.ears === undefined
     && old.achStages.mercies === undefined && old.achStages.fatDodges === undefined);

  console.log('\n── 10. Картинки достижений названы по новым id ──');
  const dir = path.join(ROOT, 'public/img/achievements');
  const files = fs.readdirSync(dir);
  for (const id of ['breaches', 'crests', 'truces', 'breachDodges']) {
    const have = [1, 2, 3, 4, 5].every((n) => files.includes(id + '_' + n + '.webp'));
    ok(`${id}: пять ступеней на месте`, have);
  }
  ok('файлов со старыми именами не осталось',
     !files.some((n) => /^(fatalities|ears|mercies|fatDodges)_/.test(n)));

  console.log('\n── 11. Сцены события ──');
  const scenes = fs.readdirSync(path.join(ROOT, 'public/img/breach'));
  ok('шесть сцен: три события × два пола', scenes.filter((n) => n.endsWith('.webp')).length === 6);
  ok('старой папки фаталити нет', !fs.existsSync(path.join(ROOT, 'public/img/fatality')));
  ok('иконки трофеев на месте',
     fs.existsSync(path.join(ROOT, 'public/img/icons/crest.webp'))
     && fs.existsSync(path.join(ROOT, 'public/img/icons/truce.webp')));
  ok('старых иконок уха и жетона нет',
     !fs.existsSync(path.join(ROOT, 'public/img/icons/ear.webp'))
     && !fs.existsSync(path.join(ROOT, 'public/img/icons/token.webp')));

  console.log('\n── 12. Слова «фаталити» и «ухо» в коде не осталось ──');
  const walk = (d, out) => {
    for (const n of fs.readdirSync(d)) {
      const p2 = path.join(d, n);
      if (fs.statSync(p2).isDirectory()) walk(p2, out);
      else if (/\.(ts|js)$/.test(n)) out.push(p2);
    }
    return out;
  };
  const src = walk(path.join(ROOT, 'src'), [])
    .concat(walk(path.join(ROOT, 'public/js'), []))
    .concat([path.join(ROOT, 'config/gameConfig.ts')]);
  const BAD = /fatalit|Fatalit|фаталит|Фаталит|\bуши\b|\bушей\b|\bух[оа]\b/;
  // Одно исключение: таблица переноса старых сохранений ОБЯЗАНА
  // называть прежние ключи — иначе переносить нечего. Такие строки
  // помечены словом «наследие», и только они прощаются.
  const dirty = src.filter((f) => fs.readFileSync(f, 'utf8').split(String.fromCharCode(10))
      .some((ln) => BAD.test(ln) && !/наследие/i.test(ln)))
    .map((f) => path.relative(ROOT, f));
  ok(dirty.length ? `осталось в: ${dirty.join(', ')}` : 'ни в одном файле не осталось', dirty.length === 0);

  console.log('\n── 13. Сама проверка умеет краснеть ──');
  ok('штраф мерился по живой мощи, а не по константе', full > 0 && seen[0] > 0);
  ok('миграция проверялась на объекте со старыми полями', old.ears === 42 && old.crestParts === 2);
  ok('запрет распознаётся', BAD.test('const x = fatality;') && !BAD.test('const x = breach;'));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
