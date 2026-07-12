// Регрессия «чёрный экран боя легиона» — серверная часть.
// Гарантия: battleState НИКОГДА не бросает исключение (не отдаёт 500) даже при
// битых данных боя. Вместо этого возвращает безопасный degraded-DTO, чтобы
// клиент показал подготовку, а не завис на чёрном экране. Запуск после build.
const assert = require('assert');
const db = require('../dist/src/core/db');
const lb = require('../dist/src/services/legionBattle');
let passed = 0;
const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n}`); };

const um = db.load('users', {}), lm = db.load('legions', {}), bm = db.load('battles', {});
const now = Date.now();
function reset(){ for (const m of [um,lm,bm]) for (const k of Object.keys(m)) delete m[k]; }
function mkUser(id){ return { id, name:id, res:{hp:{cur:100,max:100,t:now},en:{cur:50,max:100,t:now},am:{cur:7,max:100,t:now}}, lastSeen:now, legionId:'lA' }; }
function mkC(id,side){ um[id]=mkUser(id); return { userId:id, name:id, side, role:'assault', roleMul:{atk:1,def:1,dmgReduce:0}, hp:100, maxHp:100, shield:0, direction:1, ready:true, readyAt:now, lastActionAt:0, lastMoveAt:0, lastItemAt:0, gear:[], statusEffects:[], alive:true, stats:{dmgDealt:0,dmgTaken:0,healed:0,kills:0,guards:0,itemsUsed:0} }; }

console.log('\n[1] Нормальный prep-DTO собирается штатно');
reset();
lm['lA']={id:'lA',name:'A',activeBattle:{battleId:'B1'},arsenal:{},battleBuildings:{}};
lm['lB']={id:'lB',name:'B',activeBattle:{battleId:'B1'},arsenal:{},battleBuildings:{}};
bm['B1']={id:'B1',legionA:'lA',legionB:'lB',legionAName:'A',legionBName:'B',phase:'prep',prepEndsAt:now+300000,startedAt:now,combatants:{v:mkC('v','A'),e:mkC('e','B')},gear:{},log:[]};
let st = lb.battleState(um['v']);
eq('фаза prep', st.battle.phase, 'prep');
ok('degraded не выставлен на нормальных данных', !st.battle.degraded);
ok('directions собраны', Array.isArray(st.battle.directions) && st.battle.directions.length === 5);

console.log('\n[2] Битый combatant (null в списке) — DTO не падает, отдаётся degraded');
bm['B1'].combatants.broken = null;   // ломаем данные: Object.values → null.side упадёт
let threw = false, st2;
try { st2 = lb.battleState(um['v']); } catch (e) { threw = true; }
ok('battleState НЕ бросил исключение', !threw);
ok('вернулся battle-объект', st2 && st2.battle);
eq('degraded-DTO помечен', st2.battle.degraded, true);
eq('фаза сохранена', st2.battle.phase, 'prep');
ok('prepSecsLeft > 0 (таймер жив)', st2.battle.prepSecsLeft > 0);
ok('мой боец присутствует в degraded-DTO', !!st2.battle.me && st2.battle.me.userId === 'v');

console.log('\n[3] Битые данные в active-фазе — тоже degraded, а не 500');
bm['B1'].phase='active'; bm['B1'].activeEndsAt=now+600000;
let threw3=false, st3;
try { st3 = lb.battleState(um['v']); } catch(e){ threw3=true; }
ok('battleState НЕ бросил в active', !threw3);
eq('degraded в active', st3.battle.degraded, true);
ok('timeLeft посчитан', st3.battle.timeLeft > 0);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
