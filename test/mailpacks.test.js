// ═══════════════════════════════════════════════════════════════════
// test/mailpacks.test.js — три правки владельца разом
//
//  1. Почта делится на «Личные» и «Системные». Главное условие: НИЧЕГО
//     не потерять — это раскладка экрана, а не правка данных.
//  2. В списке целей видно, кто из противников состоит во взаимном
//     альянсе ДРУГ С ДРУГОМ: такие шлют друг другу подкрепления, и
//     «одинокая» цель может оказаться частью стаи.
//  3. Уровни выше сотого дороже вдвое, выше двухсотого — втрое.
//
// Запуск: node test/mailpacks.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const social = require('../dist/src/services/social');
const rewards = require('../dist/src/services/rewards');
const battle = require('../dist/src/services/battle');
const pa = require('../dist/src/services/personalAlliance');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const near = (n, a, b, tol) => { assert.ok(Math.abs(a - b) <= tol, `❌ ${n}: ${a} vs ${b} (±${tol})`); passed++; console.log(`  ✅ ${n} (${a})`); };

(async () => {
  await db.init();
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', name + '@t.ru', 'ru', '10.0.0.' + (++ip));
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 40;
    return p;
  };

  console.log('\n[1] Почта: разделение не трогает данные');
  const me = await reg('Хозяин');
  const friend = await reg('Товарищ');
  social.sendMail(friend, 'Хозяин', '', 'Личное письмо от игрока');
  rewards.grant(me.id, { title: 'Награда сезона', reason: 'третье место', reward: { gold: 50 } });
  const inbox = social.inbox(me);
  const letters = rewards.listFor(me);
  eq('переписка на месте', inbox.threads.length, 1);
  eq('письмо от игры на месте', letters.length, 1);
  ok('личное письмо — от живого игрока', inbox.threads[0].otherName === 'Товарищ');
  // Экран делит их по подвкладкам, но берёт из тех же двух источников
  const js = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok('подвкладка «Личные» есть', /✉ Личные/.test(js));
  ok('подвкладка «Системные» есть', /📨 Системные/.test(js));
  ok('личные берутся из переписок', /const threads = mailData\.threads \|\| \[\]/.test(js));
  ok('системные — из писем игры', /const rewardLetters = rewardsData\.rewards \|\| \[\]/.test(js));
  ok('ничего не удаляется при переключении',
     !/clear|remove|delete/i.test(js.slice(js.indexOf('const mailTab ='), js.indexOf('const tabsHtml'))));
  ok('подвкладка не путается с перепиской', /MAIL_VIEWS = \['new', 'personal', 'system'\]/.test(js));
  ok('и открытие переписки её пропускает', /MAIL_VIEWS\.indexOf\(param\) === -1/.test(js));
  ok('оба списка запрашиваются разом', /Promise\.all\(\[\s*API\.get\('\/api\/mail'\)/.test(js));

  console.log('\n[2] Стаи в списке целей');
  // Трое: двое в союзе, третий сам по себе
  const a = await reg('Первый');
  const b = await reg('Второй');
  const c = await reg('Третий');
  const nx = [];
  for (const p of [a, b, c]) { p.level = 40; pa.ensure(p); }
  pa.invitePlayer(a, 'Второй', nx);
  pa.acceptInvite(b, a.id, nx);
  ok('союз установлен', pa.areAllies(a, b));
  const res = battle.opponents(me);
  const byName = (n) => res.opponents.find((o) => o.name === n);
  const oa = byName('Первый'), ob = byName('Второй'), oc = byName('Третий');
  ok('обе цели в списке', !!oa && !!ob);
  ok('у союзников стая одна и та же', oa.packNo > 0 && oa.packNo === ob.packNo);
  ok('в подсказке назван напарник', (oa.packMates || []).includes('Второй'));
  ok('и наоборот', (ob.packMates || []).includes('Первый'));
  if (oc) {
    eq('одиночка без стаи', oc.packNo, 0);
    eq('и без списка напарников', (oc.packMates || []).length, 0);
  }
  ok('боты в стаи не сбиваются',
     res.opponents.filter((o) => o.isBot).every((o) => !o.packNo));

  // Третий вступает во ВЗАИМНЫЙ союз со вторым — стая должна вырасти,
  // а не завестись вторая: связь через общего союзника
  pa.invitePlayer(b, 'Третий', nx);
  pa.acceptInvite(c, b.id, nx);
  const res2 = battle.opponents(me);
  const g = ['Первый', 'Второй', 'Третий']
    .map((n) => (res2.opponents.find((o) => o.name === n) || {}).packNo)
    .filter((x) => x);
  ok(`цепочка A–B–C собралась в одну стаю: ${g.join(',')}`,
     g.length === 3 && new Set(g).size === 1);

  const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
  ok('в списке целей стая помечается буквой', /const PACK = \['А', 'Б', 'В', 'Г', 'Д'\]/.test(war));
  ok('и цветом имени', /const packName = \(o\) =>/.test(war));
  ok('в подсказке — с кем именно заодно', /Заодно с: \$\{mates\}/.test(war));
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok('значок стаи оформлен', /\.pack-mark \{/.test(css));

  console.log('\n[3] Уровни выше сотого дороже');
  const sum = (from, to) => { let s = 0; for (let l = from; l <= to; l++) s += config.xpToNext(l); return s; };
  eq('99-й уровень не подорожал', config.xpToNext(99), 4777);
  // 100-й уровень — конец зоны 51–100, по таблице там 4821
  eq('со 100-го — ровно вдвое от таблицы', config.xpToNext(100), 4821 * 2);
  near('удвоение видно на всей сотне', sum(100, 199) / 2, 991488, 2000);
  near('с двухсотого — втрое', config.xpToNext(200) / 3, 13333, 2);
  ok(`сумма 100–199 выросла до ${sum(100, 199).toLocaleString('ru')}`, sum(100, 199) > 1900000);
  ok(`сумма 200–300 выросла до ${sum(200, 300).toLocaleString('ru')}`, sum(200, 300) > 23000000);
  // Кривая обязана оставаться монотонной: каждый следующий дороже
  let monotonic = true;
  for (let l = 1; l < 300; l++) if (config.xpToNext(l + 1) < config.xpToNext(l)) monotonic = false;
  ok('кривая монотонна — скачков вниз нет', monotonic);
  eq('до сотого ничего не изменилось: 50-й', config.xpToNext(50), 2656);
  eq('и 30-й', config.xpToNext(30), 1000);
  ok('надбавка вынесена отдельной функцией',
     /function levelHardMul/.test(fs.readFileSync(path.join(ROOT, 'config/gameConfig.ts'), 'utf8')));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
