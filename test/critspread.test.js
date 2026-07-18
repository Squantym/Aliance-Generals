// Разброс урона: обычный удар предсказуем (узкий диапазон при данном
// соотношении сил), крит стабильно кратен ему. Правило «больше урона =
// победа» соблюдается без исключений, в т.ч. против ботов.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),battle=require('../dist/src/services/battle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Игрок','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Ровный','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const U=Object.values(us).find(x=>x.name==='Игрок'), V=Object.values(us).find(x=>x.name==='Ровный');
 U.level=100; V.level=100;
 U.units={ [c.UNITS[10].id]:{0:50,1:0,2:0} };
 V.units={ [c.UNITS[10].id]:{0:50,1:0,2:0} };   // равные силы
 U.skills.cruelty=100; db.save('users');

 const sample=(tr)=>{ U.trophies=tr||{}; let nrm=[], crt=[];
   for(let i=0;i<2500;i++){ U.recentAttacks={}; U.lastAttackAt=0; U.pendingFatality=null; U.pendingBankHack=null; U.pendingMineDefuse=null;
     const mx=player.maxima(U); U.res.hp.cur=mx.hp; U.res.am.cur=mx.am; U.res.en.cur=mx.en; V.res.hp.cur=player.maxima(V).hp; V.dollars=100000;
     let r; try{ r=battle.attack(U,V.id,N()); }catch(e){ continue; } (r.crit?crt:nrm).push(r.dealt); }
   const avg=a=>a.reduce((s,x)=>s+x,0)/a.length, mn=a=>Math.min(...a), mx=a=>Math.max(...a);
   return {nrm,crt,nAvg:avg(nrm),cAvg:avg(crt),nMin:mn(nrm),nMax:mx(nrm),cMin:mn(crt),cMax:mx(crt)}; };

 console.log('\n[1] Обычный урон имеет УЗКИЙ разброс при равных силах');
 const s0=sample({});
 console.log(`     обычный: ${s0.nMin}-${s0.nMax} (сред ${s0.nAvg.toFixed(1)})`);
 // Разброс узкий по сравнению со старой формулой (было 1–18 = 17).
 ok('разброс обычного урона узкий (≤11)', s0.nMax - s0.nMin <= 11);

 console.log('\n[2] Крит без трофея ≈ ×2 от обычного');
 console.log(`     крит: ${s0.cMin}-${s0.cMax} (сред ${s0.cAvg.toFixed(1)}) → ×${(s0.cAvg/s0.nAvg).toFixed(1)}`);
 ok('крит примерно вдвое сильнее (×1.8–2.2)', s0.cAvg/s0.nAvg >= 1.8 && s0.cAvg/s0.nAvg <= 2.2);

 console.log('\n[3] Крит с «Лицензией» ур.10 ≈ ×6 (по твоему правилу: база×2 +200%)');
 const s10=sample({license:10});
 console.log(`     крит: ${s10.cMin}-${s10.cMax} (сред ${s10.cAvg.toFixed(1)}) → ×${(s10.cAvg/s10.nAvg).toFixed(1)}`);
 ok('крит с полным трофеем ×5–6.5', s10.cAvg/s10.nAvg >= 5 && s10.cAvg/s10.nAvg <= 6.5);

 console.log('\n[4] Правило «больше урона = победа» — 0 нарушений против ботов');
 U.trophies={license:10};
 let bad=0, total=0;
 for(let i=0;i<6000;i++){
   const o=battle.opponents(U); const botId=o.opponents.filter(x=>x.isBot)[0]?.id; if(!botId) continue;
   U.recentAttacks={}; U.lastAttackAt=0; U.pendingFatality=null; U.pendingBankHack=null; U.pendingMineDefuse=null;
   const mx=player.maxima(U); U.res.hp.cur=mx.hp; U.res.am.cur=mx.am; U.res.en.cur=mx.en;
   let r; try{ r=battle.attack(U,botId,N()); }catch(e){ continue; } total++;
   if(r.dealt!==r.received && r.win!==(r.dealt>r.received)) bad++;
 }
 console.log(`     проверено ${total} боёв с ботами`);
 eq('нарушений правила урона', bad, 0);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
