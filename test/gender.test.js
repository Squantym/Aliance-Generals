// ═══════════════════════════════════════════════════════════════════
// test/gender.test.js — пол командующего
//
// Пол появился не ради строчки в профиле: сцены проникновения в штаб
// сняты отдельно для мужчин и женщин, и показать женщине мужскую сцену —
// то же самое, что показать ей чужого персонажа.
//
// Про обращение. У звания «генерал» женской формы в русском языке нет:
// «генеральша» исторически означает ЖЕНУ генерала, а не звание. Поэтому
// звание одно на всех, а различает обращение — «Господин генерал» и
// «Госпожа генерал», ровно как принято в армии.
//
// Что здесь стережётся:
//   1. Пол доезжает от формы регистрации до объекта игрока.
//   2. Мусор вместо пола не ломает аккаунт.
//   3. Смена на рынке дорожает ровным шагом и списывает золото один раз.
//   4. Обращение считает СЕРВЕР — иначе экран и сцены разойдутся в том,
//      кем игрок себя видит.
//
// Запуск: node test/gender.test.js  (после npm run build)
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
const passport = require('../dist/src/services/passport');
const cfg = require('../dist/config/gameConfig');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

(async () => {
  await db.init();

  console.log('\n── 1. Настройки ──');
  ok('вариантов два', Array.isArray(cfg.GENDERS) && cfg.GENDERS.length === 2);
  ok('у каждого есть обращение', cfg.GENDERS.every((g) => g.title && g.name && g.icon));
  ok('обращения разные', cfg.GENDERS[0].title !== cfg.GENDERS[1].title);
  ok('«генеральши» нет — это жена генерала, а не звание',
     !cfg.GENDERS.some((g) => /генеральш/i.test(g.title + g.name)));
  ok('первая смена стоит 50', cfg.GENDER_CHANGE_BASE_GOLD === 50);
  ok('шаг — тоже 50', cfg.GENDER_CHANGE_STEP_GOLD === 50);

  console.log('\n── 2. Пол доезжает от регистрации до игрока ──');
  await auth.register('Командирша', 'пароль123', 'f@t.ru', 'ru', '1.1.1.1', '', null, '', null, 'f');
  await auth.register('Командир', 'пароль123', 'm@t.ru', 'ru', '1.1.1.1', '', null, '', null, 'm');
  const F = Object.values(player.users()).find((x) => x.name === 'Командирша');
  const M = Object.values(player.users()).find((x) => x.name === 'Командир');
  ok('женский сохранён', F.gender === 'f');
  ok('мужской сохранён', M.gender === 'm');

  console.log('\n── 3. Мусор вместо пола не ломает аккаунт ──');
  // Поле приходит из формы, а форму можно обойти запросом напрямую.
  await auth.register('Мусорный', 'пароль123', 'x@t.ru', 'ru', '1.1.1.1', '', null, '', null, 'дракон');
  await auth.register('Пустой', 'пароль123', 'y@t.ru', 'ru', '1.1.1.1');
  const X = Object.values(player.users()).find((x) => x.name === 'Мусорный');
  const E = Object.values(player.users()).find((x) => x.name === 'Пустой');
  ok('неизвестное значение не сохраняется как есть', X.gender !== 'дракон');
  ok('вместо него подставлен допустимый вариант', !!cfg.GENDER_BY_ID[X.gender]);
  ok('без указания тоже допустимый вариант', !!cfg.GENDER_BY_ID[E.gender]);

  console.log('\n── 4. Обращение считает сервер ──');
  const meF = player.mePayload(F);
  const meM = player.mePayload(M);
  ok('в своём профиле есть пол', meF.gender === 'f' && meM.gender === 'm');
  ok('и обращение', meF.genderTitle === cfg.GENDER_BY_ID.f.title
     && meM.genderTitle === cfg.GENDER_BY_ID.m.title);
  ok('обращения действительно разные', meF.genderTitle !== meM.genderTitle);
  const pub = player.publicProfile(F, M);
  ok('чужой профиль тоже отдаёт пол и обращение',
     pub.gender === 'f' && pub.genderTitle === cfg.GENDER_BY_ID.f.title);

  console.log('\n── 5. Смена на рынке ──');
  M.gold = 10000;
  const v0 = passport.view(M);
  ok(`первая смена стоит ${cfg.GENDER_CHANGE_BASE_GOLD}`, v0.genderPrice === cfg.GENDER_CHANGE_BASE_GOLD);
  ok('текущий пол показан', v0.currentGender === 'm');
  ok('варианты отданы для экрана', Array.isArray(v0.genders) && v0.genders.length === 2);

  const before = M.gold;
  const r1 = passport.changeGender(M, 'f', nx);
  ok('пол сменился', M.gender === 'f' && r1.gender === 'f');
  ok('золото списано ровно раз', M.gold === before - cfg.GENDER_CHANGE_BASE_GOLD);
  ok('обращение сменилось вместе с ним',
     player.mePayload(M).genderTitle === cfg.GENDER_BY_ID.f.title);

  const expected2 = cfg.GENDER_CHANGE_BASE_GOLD + cfg.GENDER_CHANGE_STEP_GOLD;
  ok(`вторая смена дороже на шаг (${expected2})`, passport.view(M).genderPrice === expected2);
  const before2 = M.gold;
  passport.changeGender(M, 'm', nx);
  ok('вторая смена списала новую цену', M.gold === before2 - expected2);
  ok('третья дороже ещё на шаг',
     passport.view(M).genderPrice === cfg.GENDER_CHANGE_BASE_GOLD + cfg.GENDER_CHANGE_STEP_GOLD * 2);

  console.log('\n── 6. Отказы ──');
  const g0 = M.gold;
  let same = null;
  try { passport.changeGender(M, 'm', nx); } catch (e) { same = e; }
  ok('на тот же пол менять не дают', !!same);
  ok('и золото за это не берут', M.gold === g0);
  let bad = null;
  try { passport.changeGender(M, 'дракон', nx); } catch (e) { bad = e; }
  ok('несуществующий вариант отклонён', !!bad);
  ok('золото цело', M.gold === g0);
  M.gold = 1;
  let poor = null;
  try { passport.changeGender(M, 'f', nx); } catch (e) { poor = e; }
  ok('без золота не сменить', !!poor);
  ok('пол при отказе не поменялся', M.gender === 'm');

  console.log(String.fromCharCode(10) + '── 6б. Портрет — по полу ──');
  // Мужчине женский портрет и наоборот: окно выбора показывает только
  // свою половину, но окно обходится запросом — отказ обязан быть на
  // сервере, иначе ограничение существует только на картинке.
  const male = cfg.AVATARS.male[0], female = cfg.AVATARS.female[0];
  M.gender = 'm'; M.avatar = undefined;
  let wrongA = null;
  try { player.setAvatar(M, female); } catch (e) { wrongA = e; }
  ok('мужчине женский портрет не ставится', !!wrongA);
  ok('и портрет остался пустым', !M.avatar);
  player.setAvatar(M, male);
  ok('свой — ставится', M.avatar === male);
  F.gender = 'f'; F.avatar = undefined;
  let wrongB = null;
  try { player.setAvatar(F, male); } catch (e) { wrongB = e; }
  ok('женщине мужской портрет не ставится', !!wrongB);
  player.setAvatar(F, female);
  ok('и ей свой — ставится', F.avatar === female);
  ok('снять портрет можно всегда', player.setAvatar(F, '').avatar === null);
  // Смена пола делает прежний портрет чужим — снимаем его сами
  M.gold = 10000; M.gender = 'm'; player.setAvatar(M, male);
  const notes = [];
  passport.changeGender(M, 'f', notes);
  ok('после смены пола чужой портрет снят', !M.avatar);
  ok('и игроку про это сказано', notes.some((t) => /портрет/i.test(t)));
  // Окно выбора на клиенте показывает ровно свою половину
  const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok('окно выбора аватара смотрит на пол', /App.me && App.me.gender === 'f'/.test(appSrc));

  console.log(String.fromCharCode(10) + '── 6в. Служебный портрет — только штабу ──');
  // Портрет из набора staff доступен лишь тем, у кого есть роль в
  // проекте. Пол на него не смотрит: это служебный портрет, а не
  // мужской или женский набор.
  const staffPic = cfg.AVATARS.staff[0];
  ok('служебный портрет заведён', !!staffPic);
  M.role = null; M.isAdmin = false; M.gender = 'm'; M.avatar = undefined;
  let noRole = null;
  try { player.setAvatar(M, staffPic); } catch (e) { noRole = e; }
  ok('обычному игроку его не поставить', !!noRole);
  ok('и портрет остался пустым', !M.avatar);
  M.role = 'admin';
  player.setAvatar(M, staffPic);
  ok('администратору — ставится', M.avatar === staffPic);
  F.role = 'moderator'; F.gender = 'f'; F.avatar = undefined;
  player.setAvatar(F, staffPic);
  ok('и женщине из штаба тоже — он вне пола', F.avatar === staffPic);
  // Смена пола не должна его снимать: он не мужской и не женский
  F.gold = 10000;
  const noteS = [];
  passport.changeGender(F, 'm', noteS);
  ok('смена пола служебный портрет не трогает', F.avatar === staffPic);
  F.role = null; M.role = null;
  // Файлы всех портретов лежат на диске: битая ссылка — это пустой
  // прямоугольник у игрока и 404 в логах при внешне верной разметке.
  const missing = cfg.AVATAR_IDS.filter(
    (id) => !fs.existsSync(path.join(ROOT, 'public/img/avatars', id + '.webp')));
  ok(missing.length ? `нет файлов: ${missing.join(', ')}` : 'все портреты лежат на диске',
     missing.length === 0);
  // Клиент держит свой список — он обязан совпадать с конфигом, иначе
  // окно выбора покажет портрет, который сервер не примет.
  const appSrc2 = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const block = (appSrc2.match(/_AVATARS:[\s\S]*?\},/) || [''])[0];
  for (const group of ['male', 'female', 'staff']) {
    const inApp = (block.match(new RegExp(group + "\\s*:\\s*\\[([^\\]]*)\\]")) || ['', ''])[1]
      .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    ok(`список ${group} на клиенте совпадает с конфигом`,
       inApp.join() === cfg.AVATARS[group].join());
  }

  console.log('\n── 7. Сцены есть для обоих ──');
  // Ради этого всё и затевалось: у каждой сцены должна быть пара.
  const dir = path.join(ROOT, 'public/img/breach');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const scene of ['breach', 'crest', 'truce']) {
    ok(`${scene}: есть мужская и женская`,
       files.includes(scene + '-m.webp') && files.includes(scene + '-f.webp'));
  }
  const tiny = files.filter((n) => fs.statSync(path.join(dir, n)).size < 4096);
  ok(tiny.length ? `подозрительно пустые: ${tiny.join(', ')}` : 'ни одна не пустая', tiny.length === 0);

  console.log('\n── 8. Сама проверка умеет краснеть ──');
  ok('пол читался из живого объекта игрока', typeof F.gender === 'string');
  ok('цена считалась сервером, а не задана в тесте',
     passport.view(M).genderPrice !== cfg.GENDER_CHANGE_BASE_GOLD);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
