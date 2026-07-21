// Тест ребаланса: ежедневные задания и контракты усложняются и растут в
// награде с уровнем игрока. После build.
const assert=require('assert');
const c=require('../dist/config/gameConfig');
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

console.log('\n[1] Ежедневные поручения: цель растёт с уровнем (~8x к 300)');
const base=100, diff=1;
eq('ур.1 = база', c.dailyQuestTarget(base,diff,1), base);
ok('ур.150 > базы', c.dailyQuestTarget(base,diff,150) > base*2);
const at300=c.dailyQuestTarget(base,diff,300);
ok('ур.300 ≈ 8x базы', at300 >= base*7.9 && at300 <= base*8.1);
console.log('     цель базы 100 (diff1): ур.1='+c.dailyQuestTarget(100,1,1)+' ур.150='+c.dailyQuestTarget(100,1,150)+' ур.300='+c.dailyQuestTarget(100,1,300));

console.log('\n[2] 20 поручений от 6 заказчиков, выбирается 9 в день');
eq('всего 20 поручений', c.DAILY_QUESTS.length, 20);
eq('6 заказчиков', Object.keys(c.DAILY_CHARS).length, 6);
ok('у каждого поручения есть заказчик и описание', c.DAILY_QUESTS.every(q=>q.char && q.flavor && c.DAILY_CHARS[q.char]));
const pick=c.pickDailyQuests('2026-01-01');
eq('выбирается ровно 9', pick.length, 9);
ok('выбор детерминирован в пределах дня', JSON.stringify(pick)===JSON.stringify(c.pickDailyQuests('2026-01-01')));
ok('другой день — другой набор', JSON.stringify(pick)!==JSON.stringify(c.pickDailyQuests('2026-06-15')));

console.log('\n[3] Сложность влияет на цель и награду');
ok('hard-цель больше easy при том же base/level', c.dailyQuestTarget(100,2.4,100) > c.dailyQuestTarget(100,1.0,100));
const rEasy=c.dailyQuestReward(1.0,100), rHard=c.dailyQuestReward(2.4,100);
ok('награда hard больше easy', rHard.dollars > rEasy.dollars);
const r1=c.dailyQuestReward(1,1), r300=c.dailyQuestReward(1,300);
ok('доллары растут с уровнем', r300.dollars > r1.dollars);
console.log('     награда diff1: ур.1 $'+r1.dollars+'/'+r1.xp+'xp · ур.300 $'+r300.dollars+'/'+r300.xp+'xp');

console.log('\n[4] Бонус за все поручения растёт с уровнем');
eq('ур.1 бонус = 150', c.dailyAllBonusGold(1), 150);
eq('ур.300 бонус = 300', c.dailyAllBonusGold(300), 300);

console.log('\n[5] Контракты: пул расширен (8 типов) и цель/награда от уровня');
eq('в пуле 8 контрактов', c.CONTRACTS_POOL.length, 8);
ok('добавлен контракт на спецоперации', c.CONTRACTS_POOL.some(x=>x.id==='c_mission'));
ok('добавлен контракт на фаталити', c.CONTRACTS_POOL.some(x=>x.id==='c_fatal'));
eq('цель контракта ур.1 = база', c.contractTarget(10,1), 10);
ok('цель контракта ур.300 ≈ 5x', c.contractTarget(10,300) >= 49 && c.contractTarget(10,300) <= 51);
eq('награда контракта ур.1 = база', c.contractReward(20,1), 20);
ok('награда контракта ур.300 ≈ 3x (умереннее)', c.contractReward(20,300) >= 59 && c.contractReward(20,300) <= 61);
console.log('     контракт база(цель10/зол20): ур.1='+c.contractTarget(10,1)+'/'+c.contractReward(20,1)+' ур.300='+c.contractTarget(10,300)+'/'+c.contractReward(20,300));

console.log('\n[6] Интеграция: features применяет масштаб к контрактам');
process.env.MONGODB_URI='';
const fs=require('fs'),path=require('path');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
(async()=>{
 const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),features=require('../dist/src/services/features');
 await db.init();
 await auth.register('Новичок','password1','n@a.com','ru','1.1.1.1');
 const usr=Object.values(player.users()).find(x=>x.name==='Новичок');
 usr.level=1; const vLow=features.contractsView(usr);
 // тот же набор контрактов, но поднимем уровень и заставим пересчитать view (view не рероллит в тот же день)
 usr.level=300; const vHigh=features.contractsView(usr);
 ok('контракты выданы', vLow.contracts.length>0 && vHigh.contracts.length===vLow.contracts.length);
 // сравним по одному и тому же контракту (id совпадает — реролла не было)
 const lowById=Object.fromEntries(vLow.contracts.map(x=>[x.id,x]));
 let scaledUp=false;
 for(const h of vHigh.contracts){ const l=lowById[h.id]; if(l && h.target>l.target && h.reward>=l.reward) scaledUp=true; }
 ok('на ур.300 цель контракта выросла vs ур.1', scaledUp);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
