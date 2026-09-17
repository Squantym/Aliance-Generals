// ═══════════════════════════════════════════════════════════════════
// test/mailpacks.test.js — три правки владельца разом
//
//  1. Почта делится на «Личные» и «Системные». Главное условие: НИЧЕГО
//     не потерять — это раскладка экрана, а не правка данных.
//  2. Союзник из вашего альянса в списке целей (с 18.09.2026): ник чуть
//     другого цвета, без букв и «стай»; нападение на него сервер
//     отклоняет кодом ALLY_TARGET, пока игрок не подтвердит в окне с
//     кнопками «Выбрать другую цель» и «Атаковать союзника».
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

  console.log('\n[2] Союзник в списке целей');
  const a1 = await reg('Первый');
  const b1 = await reg('Второй');
  const nx = [];
  for (const p of [me, a1, b1]) pa.ensure(p);
  pa.invitePlayer(me, 'Первый', nx);
  pa.acceptInvite(a1, me.id, nx);
  pa.invitePlayer(a1, 'Второй', nx);
  pa.acceptInvite(b1, a1.id, nx);
  ok('Первый — наш союзник', pa.areAllies(me, a1));
  ok('Второй — союзник Первого, но не наш', pa.areAllies(a1, b1) && !pa.areAllies(me, b1));
  const res = battle.opponents(me);
  const byName = (n) => res.opponents.find((o) => o.name === n);
  const oa = byName('Первый'), ob = byName('Второй');
  ok('обе цели в списке', !!oa && !!ob);
  ok('Первый помечен союзником', oa.inMyAlliance === true);
  ok('Второй — нет: союзник союзника нам не союзник', ob.inMyAlliance === false);
  ok('«стай» с буквами больше нет', res.opponents.every((o) => !('packNo' in o) && !('packMates' in o)));

  console.log('\n[2б] Нападение на союзника — только с подтверждением');
  const t0 = Date.now();
  me.res.am.cur = 10; me.res.hp.cur = 1000;
  let err = null;
  try { battle.attack(me, a1.id, []); } catch (e) { err = e; }
  ok('без подтверждения — отказ', !!err);
  eq('код отказа — ALLY_TARGET', err && err.code, 'ALLY_TARGET');
  eq('статус 409', err && err.status, 409);
  ok(`в тексте — имя союзника: «${err && err.message}»`, /Первый/.test(err.message) && /союзник/.test(err.message));
  ok('боеприпас не потрачен и пауза не началась', me.res.am.cur === 10 && !(me.lastAttackAt >= t0));
  let err2 = null;
  try { battle.attack(me, a1.id, [], { allyOk: true }); } catch (e) { err2 = e; }
  ok(`с подтверждением — нападение идёт (${err2 ? err2.message : 'бой прошёл'})`, !err2 || err2.code !== 'ALLY_TARGET');
  let err3 = null;
  try { battle.attack(me, b1.id, []); } catch (e) { err3 = e; }
  ok('на чужого — без вопросов', !err3 || err3.code !== 'ALLY_TARGET');

  const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
  const api = fs.readFileSync(path.join(ROOT, 'public/js/api.js'), 'utf8');
  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok('букв и цветов стай в списке больше нет', !/const PACK = /.test(war) && !/pack-mark/.test(war) && !/\.pack-mark/.test(css));
  ok('звёздочки у союзника нет — только цвет ника', !/ally-star/.test(war));
  ok('ник союзника — своим цветом', /class="opp-ally"/.test(war) && /\.opp-ally \{ color:/.test(css));
  ok('окно: «Выбрать другую цель» и «Атаковать союзника»',
     /okText: 'Атаковать союзника', cancelText: 'Выбрать другую цель'/.test(core));
  ok('список целей повторяет удар с подтверждением', /e\.code === 'ALLY_TARGET'[\s\S]{0,120}attackTarget\(targetId, true\)/.test(war));
  ok('и из профиля — то же окно', /e\.code === 'ALLY_TARGET'[\s\S]{0,120}_confirmAllyAttack/.test(core));
  ok('код отказа доходит до экрана', /code: e\.code/.test(http) && /err\.code = data\.code/.test(api));
  ok('подтверждение передаётся только явным true', /allyOk: req\.body\.allyOk === true/.test(routes));

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
