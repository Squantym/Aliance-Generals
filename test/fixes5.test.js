// Доработки:
// (1) отчёт о попадании ракеты получают ОБА — атакующий и жертва;
// (2) взлом сейфа: 10 попыток;
// (3) значок ⭐ у союзника в списке целей «Войны»;
// (4) подкрепления союзникам (лимиты 10/5/по одному в день на человека);
// (5) спецоперации: энергия 10…1400 и требования по родам войск.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const silos = require('../dist/src/services/silos');
const battle = require('../dist/src/services/battle');
const reinf = require('../dist/src/services/reinforcements');
const notifications = require('../dist/src/services/notifications');
const c = require('../dist/config/gameConfig');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

// Сделать двух игроков взаимными союзниками
const ally = (a, b) => {
  a.allianceRoster = (a.allianceRoster || []).concat({ id: b.id, name: b.name });
  b.allianceRoster = (b.allianceRoster || []).concat({ id: a.id, name: a.name });
  a.allianceMembers = (a.allianceMembers || 0) + 1;
  b.allianceMembers = (b.allianceMembers || 0) + 1;
};

(async () => {
  await db.init();

  console.log('\n[1] Взлом сейфа: 10 попыток');
  eq('maxTries = 10', c.BANK_HACK.maxTries, 10);

  console.log('\n[2] Спецоперации: энергия 10…150 (старт) и до 1400 (финал)');
  const first = c.CONFLICTS[0], last = c.CONFLICTS[c.CONFLICTS.length - 1];
  const stepsOf = (cf) => cf.operations.flatMap(o => o.steps);
  const f = stepsOf(first), l = stepsOf(last);
  eq('первый шаг первой операции = 10', f[0].energy, 10);
  eq('последний шаг первого конфликта = 150', f[f.length - 1].energy, 150);
  eq('последний шаг финального конфликта = 1400', l[l.length - 1].energy, 1400);
  ok('энергия монотонно растёт внутри конфликта', f.every((s, i) => i === 0 || s.energy >= f[i - 1].energy));
  ok('финальный конфликт стартует заметно выше первого', l[0].energy > f[f.length - 1].energy);

  console.log('\n[3] Спецоперации: требования по КОНКРЕТНЫМ родам войск');
  const allSteps = c.CONFLICTS.flatMap(cf => stepsOf(cf));
  ok('у каждого шага есть разбивка byType', allSteps.every(s => s.require.units && s.require.units.byType));
  ok('у каждого шага указан профиль операции', allSteps.every(s => s.require.units.profile));
  ok('типы только ground/air/sea', allSteps.every(s =>
    Object.keys(s.require.units.byType).every(t => ['ground', 'air', 'sea'].includes(t))));
  ok('количества положительные', allSteps.every(s =>
    Object.values(s.require.units.byType).every(n => n > 0)));
  const profiles = new Set(allSteps.map(s => s.require.units.profile));
  ok(`профили разнообразны (${profiles.size} видов)`, profiles.size >= 5);
  // Пример разнообразия: есть операции с упором на разные рода
  const mixes = allSteps.map(s => s.require.units.byType);
  ok('есть операции с упором на воздух', mixes.some(m => m.air && m.air > (m.ground || 0) && m.air > (m.sea || 0)));
  ok('есть операции с упором на море', mixes.some(m => m.sea && m.sea > (m.ground || 0) && m.sea > (m.air || 0)));
  ok('есть операции с упором на землю', mixes.some(m => m.ground && m.ground > (m.air || 0) && m.ground > (m.sea || 0)));

  console.log('\n[4] Ракета: отчёт получают ОБА участника');
  await auth.register('Ракетчик', 'password1', 'r@a.com', 'ru', '1.1.1.1');
  await auth.register('Мишень', 'password1', 'm@a.com', 'ru', '1.1.1.2');
  const atk = Object.values(player.users()).find(x => x.name === 'Ракетчик');
  const vic = Object.values(player.users()).find(x => x.name === 'Мишень');
  vic.units = { [c.UNITS[3].id]: { 0: 500, 1: 0, 2: 0 } };
  // Кладём долетевшую ракету и прогоняем тик
  const rockets = db.load('rockets', {});
  rockets['rk1'] = { id: 'rk1', attackerId: atk.id, attackerName: atk.name,
    targetId: vic.id, targetName: vic.name, launchedAt: Date.now() - 1000,
    impactAt: Date.now() - 1, powerFrac: 1, intercepted: false, resolved: false };
  db.save('rockets');
  silos.resolveInFlight();
  ok('у жертвы появился отчёт', (vic.pendingRocketHits || []).length > 0);
  ok('у АТАКУЮЩЕГО тоже появился отчёт', (atk.pendingRocketHits || []).length > 0);
  const myRep = atk.pendingRocketHits[atk.pendingRocketHits.length - 1];
  eq('отчёт атакующего помечен asAttacker', myRep.asAttacker, true);
  eq('в отчёте атакующего указана цель', myRep.targetName, 'Мишень');
  const atkNotifs = notifications.list(atk).notifications;
  ok('атакующему пришло уведомление rocket_result', atkNotifs.some(n => n.kind === 'rocket_result'));
  ok('жертве пришло уведомление rocket_hit', notifications.list(vic).notifications.some(n => n.kind === 'rocket_hit'));
  eq('ракета помечена разрешённой', db.load('rockets', {})['rk1'].resolved, true);

  console.log('\n[5] Значок союзника в списке целей');
  ally(atk, vic);
  const pa = require('../dist/src/services/personalAlliance');
  ok('areAllies видит взаимный альянс', pa.areAllies(atk, vic));
  ok('в одну сторону — не союзники', !pa.areAllies(atk, { id: 'x', allianceRoster: [] }));
  const warSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
  ok('во фронте есть звезда союзника', /ally-star/.test(warSrc) && /o\.inMyAlliance/.test(warSrc));

  console.log('\n[6] Подкрепления: только союзникам, с лимитами');
  await auth.register('Чужак', 'password1', 'ch@a.com', 'ru', '1.1.1.3');
  const stranger = Object.values(player.users()).find(x => x.name === 'Чужак');
  throws('несоюзнику отправить нельзя', () => reinf.send(atk, stranger.id, []));
  throws('самому себе нельзя', () => reinf.send(atk, atk.id, []));
  reinf.send(atk, vic.id, []);
  eq('у союзника 1 подкрепление', reinf.view(vic).activeCount, 1);
  ok('бонус к мощи появился', reinf.view(vic).totalBonusPct > 0);
  throws('второй раз тому же в тот же день нельзя', () => reinf.send(atk, vic.id, []));

  console.log('\n[7] Лимит 5 отправок в сутки');
  const mates = [];
  for (let i = 0; i < 6; i++) {
    await auth.register('Союзник' + i, 'password1', `s${i}@a.com`, 'ru', '1.1.2.' + i);
    const m = Object.values(player.users()).find(x => x.name === 'Союзник' + i);
    ally(atk, m); mates.push(m);
  }
  let sent = 1; // уже одно отправлено «Мишени»
  for (const m of mates) {
    try { reinf.send(atk, m.id, []); sent++; } catch (e) { break; }
  }
  eq('всего отправлено за сутки = 5', sent, c.REINFORCE.PER_DAY);
  eq('счётчик отправок совпадает', reinf.view(atk).sentToday, 5);
  eq('осталось отправок 0', reinf.view(atk).sentLeft, 0);

  console.log('\n[8] Максимум 10 подкреплений, все от РАЗНЫХ игроков');
  const target = vic;
  target.reinforcements = [];
  for (let i = 0; i < 12; i++) {
    await auth.register('Донор' + i, 'password1', `d${i}@a.com`, 'ru', '1.1.3.' + i);
    const d = Object.values(player.users()).find(x => x.name === 'Донор' + i);
    ally(d, target);
    try { reinf.send(d, target.id, []); } catch (e) { /* слоты кончились */ }
  }
  eq('активных ровно 10 (не больше)', reinf.view(target).activeCount, c.REINFORCE.MAX_ACTIVE);
  const froms = target.reinforcements.map(r => r.fromId);
  eq('все от разных игроков', new Set(froms).size, froms.length);

  console.log('\n[9] Подкрепления реально усиливают армию');
  target.units = { [c.UNITS[5].id]: { 0: 100, 1: 0, 2: 0 } };
  const powerWith = player.buildArmy(target, 'atk').power;
  const saved = target.reinforcements;
  target.reinforcements = [];
  const powerWithout = player.buildArmy(target, 'atk').power;
  target.reinforcements = saved;
  ok(`с подкреплениями мощь выше (${powerWithout} → ${powerWith})`, powerWith > powerWithout);

  console.log('\n[10] Трофей «Знамя победы» привязан к подкреплениям');
  const banner = c.TROPHIES.find(t => t.id === 'banner');
  eq('apply = reinforce', banner.apply, 'reinforce');
  ok('описание больше не заглушка', !/заглушка/i.test(banner.desc));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
