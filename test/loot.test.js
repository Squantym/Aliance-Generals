// Грабёж с РЕАЛЬНОГО игрока: 5% базово, трофей «Мародёр» удваивает до 10% на ур.10.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),battle=require('../dist/src/services/battle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};
const near=(n,a,b,d)=>{assert.ok(Math.abs(a-b)<=d,`❌ ${n}: ${a} не ≈ ${b} (±${d})`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Грабитель','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Жертва','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const A=Object.values(us).find(x=>x.name==='Грабитель'), V=Object.values(us).find(x=>x.name==='Жертва');
 A.level=200; V.level=200;
 A.units={ [c.UNITS[13].id]:{0:50,1:0,2:0} };   // сильный — стабильно побеждает
 V.units={ [c.UNITS[10].id]:{0:50,1:0,2:0} };
 db.save('users');

 console.log('\n[1] Конфиг: база 5%, Мародёр +10%/ур');
 eq('LOOT_PCT = 5%', c.BATTLE.LOOT_PCT, 0.05);
 const looter=c.TROPHIES.find(t=>t.id==='looter');
 eq('Мародёр +10% за уровень', looter.perLvl, 10);
 eq('Мародёр действует на грабёж', looter.apply, 'loot');

 // Средний процент грабежа за первую атаку (сброс decay каждый раз)
 const pct = (tr, n) => {
   let s=0, cnt=0;
   for(let i=0;i<n;i++){
     A.trophies=tr||{}; A.effects=[]; V.effects=[];
     A.recentAttacks={}; A.lastAttackAt=0;
     A.pendingFatality=null; A.pendingBankHack=null; A.pendingMineDefuse=null;
     const mx=player.maxima(A); A.res.hp.cur=mx.hp; A.res.am.cur=mx.am; A.res.en.cur=mx.en;
     V.res.hp.cur=player.maxima(V).hp; V.dollars=1000000;
     const r=battle.attack(A,V.id,N());
     if(r.win){ s += r.loot/1000000*100; cnt++; }
   }
   return s/cnt;
 };

 console.log('\n[2] Процент грабежа с игрока');
 const p0=pct(null,80), p5=pct({looter:5},80), p10=pct({looter:10},80);
 console.log(`     без Мародёра ${p0.toFixed(2)}% | ур.5 ${p5.toFixed(2)}% | ур.10 ${p10.toFixed(2)}%`);
 near('без трофея ≈ 5%', p0, 5, 0.3);
 near('ур.5 ≈ 7.5%', p5, 7.5, 0.3);
 near('ур.10 ≈ 10% (удвоение)', p10, 10, 0.3);

 console.log('\n[3] Грабёж не превышает наличных цели');
 A.trophies={looter:10}; A.recentAttacks={}; A.lastAttackAt=0;
 A.pendingFatality=null; A.pendingBankHack=null; A.pendingMineDefuse=null;
 const mx=player.maxima(A); A.res.hp.cur=mx.hp; A.res.am.cur=mx.am; A.res.en.cur=mx.en;
 V.res.hp.cur=player.maxima(V).hp; V.dollars=100;   // почти пусто
 let loot=0; for(let k=0;k<40;k++){ A.recentAttacks={}; A.lastAttackAt=0; V.dollars=100; const mxx=player.maxima(A); A.res.hp.cur=mxx.hp; A.res.am.cur=mxx.am; A.res.en.cur=mxx.en; const r=battle.attack(A,V.id,N()); if(r.win){loot=r.loot;break;} }
 ok('грабёж ≤ наличных цели', loot <= 100);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
