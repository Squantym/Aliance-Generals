// Тест ребаланса: ежедневные задания и контракты усложняются и растут в
// награде с уровнем игрока. После build.
const assert=require('assert');
const c=require('../dist/config/gameConfig');
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

console.log('\n[1] Ежедневные задания: цель растёт с уровнем (~5x к 300)');
const base=100;
eq('ур.1 = база', c.dailyQuestTarget(base,1), base);
ok('ур.150 > базы', c.dailyQuestTarget(base,150) > base*2);
const at300=c.dailyQuestTarget(base,300);
ok('ур.300 ≈ 5x базы', at300 >= base*4.9 && at300 <= base*5.1);
console.log('     цель для базы 100: ур.1='+c.dailyQuestTarget(100,1)+' ур.150='+c.dailyQuestTarget(100,150)+' ур.300='+c.dailyQuestTarget(100,300));

console.log('\n[2] Базы заданий подняты (сложнее)');
const byId=Object.fromEntries(c.DAILY_QUESTS.map(q=>[q.id,q.target]));
ok('атак стало 150', byId.attack===150);
ok('побед стало 80', byId.win===80);
ok('банк стало 1 000 000', byId.deposit===1000000);

console.log('\n[3] Награда за задание растёт с уровнем');
const r1=c.dailyQuestReward(1), r300=c.dailyQuestReward(300);
ok('доллары ур.300 больше ур.1', r300.dollars > r1.dollars);
eq('доллары = 8000*level (ур.300)', r300.dollars, 8000*300);
ok('опыт растёт с уровнем', r300.xp > r1.xp);
console.log('     награда: ур.1 $'+r1.dollars+'/'+r1.xp+'xp · ур.300 $'+r300.dollars+'/'+r300.xp+'xp');

console.log('\n[4] Бонус за все задания растёт с уровнем');
eq('ур.1 бонус = 100', c.dailyAllBonusGold(1), 100);
eq('ур.300 бонус = 250', c.dailyAllBonusGold(300), 250);

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
