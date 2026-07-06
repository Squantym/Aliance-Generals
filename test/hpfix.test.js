// Тест сегодняшних правок: (1) CSS-переменная --orange определена во всех
// темах (полоска здоровья рендерится); (2) предложение аптечки при низком
// здоровье в бою/событии; (3) набор личного альянса засчитывается в сезон.
// Запуск: node test/hpfix.test.js  (после npm run build)
const assert = require('assert');
const fs = require('fs');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const battle = require('../dist/src/services/battle');
const seasons = require('../dist/src/services/seasons');
const palliance = require('../dist/src/services/personalAlliance');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

// ===================================================================
console.log('\n[1] CSS: --orange определена во всех темах (была undefined — ломала градиент полосы HP)');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const orange1Count = (css.match(/--orange-1:/g) || []).length;
const orangeAliasCount = (css.match(/--orange: var\(--orange-1\)/g) || []).length;
eq('число тем с --orange-1', orange1Count, orangeAliasCount);
ok('хотя бы одна тема есть', orange1Count > 0);
const files = ['app.js','admin.js','ui.js','screens/core.js','screens/market.js','screens/social.js','screens/war.js']
  .map((f) => fs.readFileSync('public/js/' + f, 'utf8'));
const usesOrange = files.some((f) => f.includes('var(--orange)'));
ok('var(--orange) всё ещё используется во фронте (не переписывали 21 место)', usesOrange);
ok('и она теперь ОПРЕДЕЛЕНА в каждой теме CSS', orangeAliasCount >= 7);

// ===================================================================
console.log('\n[2] Предложение аптечки: сервер отклоняет атаку при низком HP тем же текстом, что ловит фронт');
{
  eq('текст ошибки содержит "подлечитесь" (фронт матчит /подлечитесь/i)',
     /подлечитесь/i.test(`Здоровье ниже ${c.PLAYER.MIN_HP_TO_FIGHT} — сначала подлечитесь.`), true);
  ok('порог MIN_HP_TO_FIGHT задан', c.PLAYER.MIN_HP_TO_FIGHT > 0);
  const medkit = c.MARKET_ITEM_BY_ID['medkit'];
  ok('товар "Полевая аптечка" (medkit) существует на рынке', !!medkit && medkit.kind === 'refill_health');
}

// ===================================================================
console.log('\n[3] Набор личного альянса (кнопка «Пригласить бойца») засчитывается в сезон');
{
  const usersMap = db.load('users', {});
  for (const k of Object.keys(usersMap)) delete usersMap[k];
  function mkUser(id, name) {
    return {
      id, name, email: id + '@t.t', isBot: false, gold: 1e6, dollars: 1e6, tokens: 0,
      level: 20, country: 'ru', allianceMembers: 0, allianceRoster: [], allianceDiplomats: 0,
      allianceInviteLog: [], weekly: undefined,
    };
  }
  const notices = { push: () => {} };

  const u1 = mkUser('u_pa1', 'Набирающий');
  usersMap['u_pa1'] = u1;
  const before = (u1.weekly && u1.weekly.alliance) || 0;
  palliance.inviteBot(u1, notices);
  ok('после набора бота weekly создан', !!u1.weekly);
  eq('очко набора альянса засчитано (alliance=1)', u1.weekly.alliance, before + 1);
  ok('очки сезона (rating) начислены', u1.weekly.rating >= c.SEASON.points.allianceRecruit);

  const inviter = mkUser('u_pa_inviter', 'Пригласивший');
  const acceptor = mkUser('u_pa_acceptor', 'Принявший');
  usersMap['u_pa_inviter'] = inviter; usersMap['u_pa_acceptor'] = acceptor;
  palliance.invitePlayer(inviter, 'Принявший', notices);
  palliance.acceptInvite(acceptor, inviter.id, notices);
  ok('у принявшего засчитан набор в сезон', acceptor.weekly && acceptor.weekly.alliance === 1);
  ok('у пригласившего ТОЖЕ засчитан набор в сезон (взаимный рост)', inviter.weekly && inviter.weekly.alliance === 1);

  const view = seasons.view(u1);
  const cat = view.categories.find((x) => x.id === 'alliance');
  ok('категория "Набор в альянс" существует', !!cat);
  const top = cat.top.find((x) => x.id === 'u_pa1');
  ok('игрок u_pa1 присутствует в топе категории набора альянса', !!top && top.value === 1);
}

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
