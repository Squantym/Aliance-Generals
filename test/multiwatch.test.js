// ═══════════════════════════════════════════════════════════════════
// test/multiwatch.test.js — поиск мультоводов
//
// Раздел отвечает на вопрос «кого проверять», поэтому здесь важнее
// всего две вещи:
//   • сильные улики (общее устройство) стоят ВЫШЕ слабых (общий адрес);
//   • законные совпадения не попадают в список: персонажи одного
//     аккаунта разрешены правилами, а оператор связи с сотней игроков
//     на адресе — не улика.
// Отдельно проверяется связь «пригласил → сидит на моём устройстве»:
// именно за неё платят золотом, и именно там заводят твинков.
//
// Запуск: node test/multiwatch.test.js   (после npm run build)
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
const access = require('../dist/src/services/access');
const features = require('../dist/src/services/features');
const mw = require('../dist/src/services/multiWatch');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const pairOf = (d, a, b) => d.pairs.find((p) => (p.a.name === a && p.b.name === b) || (p.a.name === b && p.b.name === a));

// Один и тот же браузер на одной машине: строка, подсказки и отпечаток
const DEV_A = { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', hints: { platform: 'Windows' }, fp: 'fp-aaa-111' };
const DEV_B = { ua: 'Mozilla/5.0 (Linux; Android 13; SM-A536B) Chrome/119', hints: { platform: 'Android' }, fp: 'fp-bbb-222' };

(async () => {
  await db.init();
  const nx = [];
  let n = 0;
  const reg = async (name, ip, dev) => {
    await auth.register(name, 'пароль123', `mw${++n}@t.ru`, 'ru', ip, dev.ua, dev.hints, dev.fp);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 20;
    access.recordLogin(p, ip, dev.ua, 'login', dev.hints, dev.fp);
    return p;
  };

  console.log('\n[1] Общее устройство весит больше общего адреса');
  const twinA = await reg('Двойник1', '5.5.5.1', DEV_A);
  const twinB = await reg('Двойник2', '5.5.5.1', DEV_A);       // то же устройство и адрес
  const neighbour = await reg('Сосед', '5.5.5.1', DEV_B);       // только адрес
  let d = mw.suspects({ minScore: 0, limit: 50 });
  const strong = pairOf(d, 'Двойник1', 'Двойник2');
  const weak = pairOf(d, 'Двойник1', 'Сосед');
  ok(!!strong && !!weak, 'обе пары найдены');
  ok(strong.score > weak.score, `устройство ${strong.score} баллов против адреса ${weak.score}`);
  // Пара с ОДНИМ общим устройством (адреса разные) обязана весить
  // заметно больше пары с одним общим адресом: иначе список возглавят
  // соседи по мобильному оператору
  const devOnlyA = await reg('Мобильник1', '11.1.1.1', { ua: 'UA-same', hints: {}, fp: 'fp-same-dev' });
  const devOnlyB = await reg('Мобильник2', '22.2.2.2', { ua: 'UA-same', hints: {}, fp: 'fp-same-dev' });
  const dd = mw.suspects({ minScore: 0, limit: 100 });
  const devOnly = pairOf(dd, 'Мобильник1', 'Мобильник2');
  const ipOnly = pairOf(dd, 'Двойник1', 'Сосед');
  ok(devOnly.score >= ipOnly.score + 40,
     `только устройство — ${devOnly.score}, только адрес — ${ipOnly.score}`);
  ok(strong.reasons.join(' ').includes('устройство'), `причины названы: ${strong.reasons.join(', ')}`);
  ok(d.pairs[0] === strong || d.pairs.indexOf(strong) < d.pairs.indexOf(weak), 'сильная пара стоит выше слабой');
  ok(mw.suspects({ minScore: 60 }).pairs.every((p) => p.score >= 60), 'порог отсекает слабые пары');

  console.log('\n[2] Законные совпадения в список не идут');
  // Персонажи одного аккаунта — разрешены игрой
  const acc = require('../dist/src/services/account');
  twinB.accountId = twinA.accountId = 'acc-1';
  d = mw.suspects({ minScore: 0 });
  ok(!pairOf(d, 'Двойник1', 'Двойник2'), 'персонажи одного аккаунта исключены');
  twinA.accountId = 'acc-1'; twinB.accountId = 'acc-2';
  // Переполненный адрес: оператор связи, а не улика. Регистрируем с
  // разных адресов (иначе сработает защита от массовой регистрации), а
  // общий адрес добавляем входом — как это и бывает у мобильных
  for (let i = 0; i < 14; i++) {
    const p = await reg('Абонент' + i, '88.8.8.' + i, { ua: 'UA-' + i, hints: {}, fp: 'fp-crowd-' + i });
    access.recordLogin(p, '77.7.7.7', 'UA-' + i, 'login', {}, 'fp-crowd-' + i);
  }
  d = mw.suspects({ minScore: 0 });
  ok(!pairOf(d, 'Абонент0', 'Абонент1'), 'из переполненного адреса пары не строятся');
  ok(d.crowded.some((c) => c.key === '77.7.7.7' && c.count >= 14), 'но сам адрес показан отдельной справкой');

  console.log('\n[3] Приглашения: связь и уплаченное золото');
  const boss = await reg('Вербовщик', '9.9.9.9', DEV_A);
  const mate = await reg('Твинк', '9.9.9.9', DEV_A);
  features.applyReferral(mate, features.ensureRefCode(boss), nx);
  d = mw.suspects({ minScore: 0 });
  const refPair = pairOf(d, 'Вербовщик', 'Твинк');
  ok(!!refPair && !!refPair.referral, 'пара помечена как «пригласил — приглашённый»');
  ok(refPair.reasons.some((r) => /пригласил/.test(r)), 'причина названа словами');
  // Та же улика без приглашения весит меньше ровно на вес связи:
  // накрутка приглашений — отдельный повод присмотреться
  const control = pairOf(d, 'Двойник1', 'Двойник2');
  ok(refPair.score === control.score + 25,
     `связь по приглашению добавила 25 баллов: ${control.score} → ${refPair.score}`);
  const scoreBefore = refPair.score;
  mate.refGoldGiven = 500;
  const after = pairOf(mw.suspects({ minScore: 0 }), 'Вербовщик', 'Твинк');
  ok(after.score > scoreBefore, `ушедшее золото подняло счёт: ${scoreBefore} → ${after.score}`);
  ok(after.referral.goldPaid === 500, 'в строке видно, сколько золота ушло по связи');

  console.log('\n[4] Сводка по приглашающим');
  const risk = mw.referralRisk(30).rows;
  const row = risk.find((r) => r.name === 'Вербовщик');
  ok(!!row && row.shared === 1 && row.invited === 1, 'видно, сколько приглашённых сидят с ним на одном устройстве');
  ok(row.goldPaid === 500, 'и сколько золота он с них получил');
  const clean = await reg('Честный', '3.3.3.3', DEV_B);
  const far = await reg('ЧестныйДруг', '4.4.4.4', { ua: 'UA-other', hints: {}, fp: 'fp-far' });
  features.applyReferral(far, features.ensureRefCode(clean), nx);
  ok(!mw.referralRisk(30).rows.some((r) => r.name === 'Честный'),
     'приглашения с разных устройств в сводку не попадают');

  console.log('\n[5] Раздел собран');
  const view = mw.view({ minScore: 0 });
  ok(Array.isArray(view.pairs) && Array.isArray(view.referral), 'ответ несёт и пары, и сводку по приглашениям');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/admin2/multiwatch.js'), 'utf8');
  ok(/api\/admin\/multi-watch/.test(js), 'экран запрашивает раздел');
  ok(/A2\.screens\.multi = render/.test(js), 'экран зарегистрирован');
  const shell = fs.readFileSync(path.join(ROOT, 'public/js/admin2/shell.js'), 'utf8');
  ok(/id: 'multi'/.test(shell), 'пункт есть в меню панели');
  const html = fs.readFileSync(path.join(ROOT, 'public/admin2.html'), 'utf8');
  ok(/multiwatch\.js/.test(html), 'файл подключён к странице панели');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
