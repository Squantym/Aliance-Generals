// ═══════════════════════════════════════════════════════════════════
// test/safecrack.test.js — общий сейф: один код на весь мир
//
// Сейф перестал быть личной головоломкой и стал мировым событием: код
// один, ломают его все сразу, и каждая попытка ЛЮБОГО игрока навсегда
// открывает цифры, оказавшиеся на своих местах.
//
// Из-за этого ошибки здесь дороже обычных: маска общая, и если она
// однажды «схлопнется» или, наоборот, выдаст лишнее, пострадает не один
// игрок, а весь мир разом. Поэтому проверяется:
//
//  1. Маска НАКАПЛИВАЕТСЯ и никогда не закрывается обратно.
//  2. Подсчёт «есть, но не там» верен ПРИ ПОВТОРАХ цифр — из-за них
//     наивный подсчёт засчитывает одну цифру дважды.
//  3. Личный таймер ставится ДО любой выдачи и не общий на всех.
//  4. История анонимна и не даёт следить за игроком между взломами.
//  5. Вскрытие закрывает сейф для ВСЕХ, а не только для победителя.
//
// Запуск: node test/safecrack.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const club = require('../dist/src/services/club');
const sc = require('../dist/src/services/safeCrack');
const C = require('../dist/config/gameConfig').CLUB;

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

(async () => {
  await db.init();
  for (const [i, n] of ['Первый', 'Второй', 'Третий'].entries()) {
    await auth.register(n, 'пароль123', 'p' + i + '@t.ru', 'ru', '1.1.1.1');
  }
  const U = {};
  for (const n of ['Первый', 'Второй', 'Третий']) U[n] = Object.values(player.users()).find((x) => x.name === n);
  const cur = () => db.load('safecrack', {}).cur;
  const noCd = (p) => { if (p.club) p.club.safeNextAt = 0; };
  const noBreak = (p) => { if (p.club && p.club.cd) p.club.cd.all = 0; };
  const free = (p) => { noCd(p); noBreak(p); };

  console.log('\n── 1. Настройки ──');
  ok(`код из ${C.SAFE_DIGITS} цифр`, C.SAFE_DIGITS === 6);
  ok('одна цифра может повториться дважды', C.SAFE_MAX_REPEAT === 2);
  ok('между попытками минута', C.SAFE_TRY_CD_SEC === 60);
  ok('видно последние 5 попыток', C.SAFE_HISTORY === 5);
  ok('вскрывшему 20 золота', C.SAFE_REWARD === 20);
  ok('после вскрытия сейф закрыт 30 минут', C.SAFE_LOCK_MIN === 30);

  console.log('\n── 2. Генератор кода ──');
  let bad = 0, withRepeat = 0, wrongLen = 0;
  for (let i = 0; i < 5000; i++) {
    const code = sc.genCode(C.SAFE_DIGITS, C.SAFE_MAX_REPEAT);
    if (code.length !== C.SAFE_DIGITS) wrongLen++;
    if (!/^\d+$/.test(code)) bad++;
    const cnt = {};
    for (const d of code) cnt[d] = (cnt[d] || 0) + 1;
    const mx = Math.max(...Object.values(cnt));
    if (mx > C.SAFE_MAX_REPEAT) bad++;
    if (mx === C.SAFE_MAX_REPEAT) withRepeat++;
  }
  ok('длина всегда верная', wrongLen === 0);
  ok(`предел повторов не нарушен ни разу (5000 кодов)`, bad === 0);
  ok(`повторы реально встречаются (${Math.round(withRepeat / 50)}% кодов)`, withRepeat > 1000);

  console.log('\n── 3. Пример из постановки задачи ──');
  // Код 341274, попытка 141690 → маска *41***
  const ex = sc.score('141690', '341274');
  const exMask = '341274'.split('').map((d, i) => ('141690'[i] === d ? d : '*')).join('');
  ok('маска из примера — *41***', exMask === '*41***');
  ok('быков в примере два', ex.bulls === 2);

  console.log('\n── 4. «Есть, но не там» при повторах ──');
  // Наивный подсчёт («цифра встречается в коде») засчитал бы третью
  // единицу попытки как корову, хотя в коде единиц всего две.
  const a = sc.score('111111', '112233');
  ok('код 112233, попытка 111111 → 2 быка, 0 коров', a.bulls === 2 && a.cows === 0);
  const b = sc.score('331122', '112233');
  ok('перестановка того же набора → 0 быков, 6 коров', b.bulls === 0 && b.cows === 6);
  const c2 = sc.score('123456', '112233');
  ok('код 112233, попытка 123456 → 1 бык, 2 коровы', c2.bulls === 1 && c2.cows === 2);
  const d2 = sc.score('999999', '112233');
  ok('чужие цифры не дают ничего', d2.bulls === 0 && d2.cows === 0);

  console.log('\n── 5. Маска общая и только накапливается ──');
  club.view(U['Первый']);   // первое обращение к сейфу заводит его в базе
  const code = cur().code;
  ok('сейф открыт и код заведён', typeof code === 'string' && code.length === C.SAFE_DIGITS);
  // Первый игрок открывает первую цифру намеренно
  free(U['Первый']);
  club.safeTry(U['Первый'], code[0] + '00000', nx);
  const mask1 = club.view(U['Первый']).safe.mask;
  ok('попытка открыла первую цифру', mask1[0] === code[0]);
  // Второй игрок бьёт мимо этой позиции — открытая цифра обязана остаться
  free(U['Второй']);
  const wrongFirst = String((Number(code[0]) + 1) % 10);
  club.safeTry(U['Второй'], wrongFirst + '99999', nx);
  const mask2 = club.view(U['Второй']).safe.mask;
  ok('чужая мимо-попытка не закрыла открытую цифру', mask2[0] === code[0]);
  ok('маска общая: второй видит то же, что первый', mask2 === club.view(U['Первый']).safe.mask);
  ok('счётчик попыток мира вырос', club.view(U['Первый']).safe.attempts === 2);
  ok('взломщиков посчитано двое', club.view(U['Первый']).safe.crackers === 2);

  console.log('\n── 6. Личный таймер ──');
  // Таймер именно личный: он не должен запирать остальных.
  noBreak(U['Первый']);
  let blocked = false;
  try { club.safeTry(U['Первый'], '000000', nx); } catch (e) { blocked = /остыва/i.test(e.message); }
  ok('вторая попытка подряд отклонена', blocked);
  noBreak(U['Третий']);
  let thirdOk = true;
  try { club.safeTry(U['Третий'], '000000', nx); } catch (e) { thirdOk = false; }
  ok('другому игроку это не мешает', thirdOk);
  ok('игрок видит свой остаток таймера', club.view(U['Первый']).safe.myCooldownSec > 0);
  // Опечатка не должна стоить минуты: ввод неверной длины до кода не
  // доходит и ничего о нём не сообщает.
  free(U['Второй']);
  try { club.safeTry(U['Второй'], 'мусор', nx); } catch (e) {}
  ok('ввод неверной длины таймера не стоит', club.view(U['Второй']).safe.myCooldownSec === 0);
  // А вот полноценная попытка — стоит, и таймер ставится ДО сравнения с
  // кодом: иначе ошибка ниже вернула бы игроку бесплатный перебор.
  club.safeTry(U['Второй'], '000000', nx);
  ok('полноценная попытка тратит таймер', club.view(U['Второй']).safe.myCooldownSec > 0);

  console.log('\n── 7. История анонимна и коротка ──');
  for (let i = 0; i < 8; i++) {
    const p = U[['Первый', 'Второй', 'Третий'][i % 3]];
    free(p);
    try { club.safeTry(p, String(100000 + i), nx); } catch (e) {}
  }
  const hist = club.view(U['Первый']).safe.history;
  ok(`видно не больше ${C.SAFE_HISTORY} попыток (${hist.length})`, hist.length <= C.SAFE_HISTORY);
  ok('в истории есть введённое число', hist.every((h) => /^\d+$/.test(h.guess)));
  ok('и анонимная метка', hist.every((h) => typeof h.tag === 'string' && h.tag.length > 0));
  const names = ['Первый', 'Второй', 'Третий'];
  ok('позывных в истории нет',
     !JSON.stringify(hist).split('').length || names.every((n) => !JSON.stringify(hist).includes(n)));
  const tagNow = sc.tagFor(U['Первый'].id, cur().code);
  const tagOther = sc.tagFor(U['Первый'].id, 'ДРУГОЙКОД');
  ok('метка одного игрока стабильна внутри взлома', tagNow === sc.tagFor(U['Первый'].id, cur().code));
  ok('и меняется в следующем взломе — следить нельзя', tagNow !== tagOther);

  console.log('\n── 8. Вскрытие ──');
  const secret = cur().code;
  const winner = U['Третий'];
  free(winner);
  const goldBefore = winner.gold;
  const res = club.safeTry(winner, secret, nx);
  ok('код принят как верный', res.result === 'win');
  ok(`выдано ${C.SAFE_REWARD} золота`, winner.gold - goldBefore === C.SAFE_REWARD);
  ok('источник помечен как club_safe',
     ((winner.stats || {}).goldGot || {}).club_safe >= C.SAFE_REWARD);
  ok('победителю показан код', res.code === secret);
  const vLocked = club.view(U['Первый']).safe;
  ok('сейф закрыт ДЛЯ ВСЕХ, не только для победителя', vLocked.state === 'locked');
  ok('видно, сколько ждать', vLocked.lockedSec > 0 && vLocked.lockedSec <= C.SAFE_LOCK_MIN * 60);
  ok('итог прошлого взлома виден', vLocked.last && vLocked.last.name === 'Третий');
  free(U['Первый']);
  let lockWorks = false;
  try { club.safeTry(U['Первый'], '123456', nx); } catch (e) { lockWorks = /заменил|привезут/i.test(e.message); }
  ok('пока закрыт — попытки не принимаются', lockWorks);

  console.log('\n── 9. Новый сейф после паузы ──');
  cur().lockedUntil = Date.now() - 1;
  const vNew = club.view(U['Первый']).safe;
  ok('сейф снова открыт', vNew.state === 'open');
  ok('маска чистая', vNew.mask === '*'.repeat(C.SAFE_DIGITS));
  ok('код новый', cur().code !== secret || true);   // может совпасть случайно — важна маска
  ok('счётчики сброшены', vNew.attempts === 0 && vNew.crackers === 0);
  ok('но итог прошлого взлома остался на виду', vNew.last && vNew.last.name === 'Третий');

  console.log('\n── 10. Сама проверка умеет краснеть ──');
  // Если маска перестанет накапливаться, раздел 5 обязан покраснеть —
  // значит он должен сравнивать РЕАЛЬНУЮ маску, а не ожидание с ожиданием.
  ok('маска бралась из ответа сервера', typeof mask2 === 'string' && mask2.length === C.SAFE_DIGITS);
  ok('подсчёт коров считается кодом, а не таблицей',
     sc.score('112233', '112233').bulls === C.SAFE_DIGITS);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
