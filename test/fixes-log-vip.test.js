// ═══════════════════════════════════════════════════════════════════
// Читаемый журнал действий, картинки форума с сохранением пропорций,
// и проверка, что преимущества VIP действуют в самих экранах игры.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-flv-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const vip = require(ROOT + '/dist/src/services/vip');
const reinf = require(ROOT + '/dist/src/services/reinforcements');
const feat = require(ROOT + '/dist/src/services/features');
const troph = require(ROOT + '/dist/src/services/trophies');
const daily = require(ROOT + '/dist/src/services/dailyQuests');
const tr = require(ROOT + '/dist/src/services/logTranslate');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');

async function main() {
console.log('\n── 1. Журнал действий читаемый ──');
ok(/function humanizeLogs/.test(routes), 'записи переводятся на сервере — один раз для всех экранов');
ok(/logs: humanizeLogs\(/.test(routes), 'журнал сотрудников переводится');
ok(/myActions = humanizeLogs\(/.test(routes), '«мои действия» тоже');
ok(/recent = humanizeLogs\(/.test(routes), 'и карточка игрока');
for (const [p, body, expect] of [
  ['/api/war/attack', { targetName: 'Боец' }, 'Атаковал'],
  ['/api/missions/start', { confId: 'x' }, 'спецоперации'],
  ['/api/club/dice/start', {}, 'кости'],
  ['/api/club/pref/hit', {}, 'преферанс'],
  ['/api/club/bids/play', {}, 'аукцион'],
]) {
  const text = tr.describe(p, body);
  ok(!!text && text.includes(expect), `«${p}» → «${(text || '—').slice(0, 46)}»`);
}
ok(!/undefined/.test(tr.describe('/api/missions/start', {}) || ''),
   'пустой конфликт не превращается в «undefined»');

console.log('\n── 2. Картинки форума ──');
const soc = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/_resizeImage = \(file, maxW, maxH\)/.test(soc), 'ограничивается и ширина, и высота');
ok(/Math\.min\(1, maxW \/ img\.width, \(maxH \|\| 1400\) \/ img\.height\)/.test(soc),
   'масштаб единый для обеих сторон — пропорции сохраняются');
ok(/_resizeImage\(f, 900, 1400\)/.test(soc), 'заданы оба предела');
// Проверяем расчёт на вертикальном скриншоте телефона
const calc = (w, h) => { const s = Math.min(1, 900 / w, 1400 / h); return [Math.round(w * s), Math.round(h * s)]; };
const [w1, h1] = calc(1080, 2400);
ok(h1 <= 1400 && Math.abs((w1 / h1) - (1080 / 2400)) < 0.01,
   `вертикальный скриншот 1080×2400 → ${w1}×${h1}, пропорция сохранена`);
const [w2, h2] = calc(4000, 3000);
ok(w2 <= 900 && Math.abs((w2 / h2) - (4000 / 3000)) < 0.01,
   `широкое фото 4000×3000 → ${w2}×${h2}, пропорция сохранена`);
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(/\.forum-img-preview \{[\s\S]{0,160}max-height: 150px/.test(css),
   'предпросмотр ограничен по высоте — кнопка «Создать» не уезжает');
ok(/\.forum-new \{ max-height: 62vh; overflow-y: auto/.test(css),
   'окно создания темы прокручивается, а не растёт бесконечно');

console.log('\n── 3. Преимущества VIP действуют в игре ──');
for (const [n, e] of [['ВИП','a'],['Обычный','b']]) {
  await auth.register(n, 'пароль123', e + '@t.ru', 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const v = by('ВИП'), p = by('Обычный');
vip.grant(null, v, 30, 'тест', []);
for (const x of [v, p]) x.level = 50;

const rv = reinf.view(v), rp = reinf.view(p);
ok(rv.perDay === 15 && rp.perDay === 10,
   `подкрепления на экране: ВИП ${rv.perDay}, обычный ${rp.perDay}`);
ok(rv.sentLeft > rp.sentLeft, 'остаток отправок тоже больше');
const rsrc = fs.readFileSync(ROOT + '/src/services/reinforcements.ts', 'utf8');
ok(/function perDayFor/.test(rsrc), 'лимит считается одной функцией');
ok((rsrc.match(/R\.PER_DAY/g) || []).length <= 1,
   'прямых обращений к конфигу не осталось — из-за них подписка не действовала');

const cv = feat.contractsView(v).contracts.length, cp = feat.contractsView(p).contracts.length;
ok(cv === 5 && cp === 3, `контракты: ВИП ${cv}, обычный ${cp}`);
const tv = troph.list(v).trophies[0].trainMinutes, tp = troph.list(p).trophies[0].trainMinutes;
ok(tv < tp, `улучшение трофеев: ВИП ${tv} мин, обычный ${tp} мин`);
ok(player.totalUpkeep(v) <= player.totalUpkeep(p), 'содержание техники дешевле');
const before = daily.list(v).quests.filter((q) => q.accepted).length;
daily.acceptAll(v, []);
ok(daily.list(v).quests.filter((q) => q.accepted).length > before, 'массовый приём поручений работает');
ok(vip.spyFreePerDay(v) === 7 && vip.spyFreePerDay(p) === 3, 'лимит разведки различается');
const fsrc = fs.readFileSync(ROOT + '/src/services/features.ts', 'utf8');
ok(/require\('\.\/vip'\)\.spyFreePerDay\(user\)/.test(fsrc), 'разведка берёт лимит из сервиса подписки');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
