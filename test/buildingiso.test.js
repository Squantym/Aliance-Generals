// Боевые постройки легиона НЕ должны влиять на обычные бои, санкции, регенерацию
// вне легион-боя. Медкорпус — строго в активном бою с участием игрока.
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
 await auth.register('Атакующий','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Цель','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const A=Object.values(us).find(x=>x.name==='Атакующий'), V=Object.values(us).find(x=>x.name==='Цель');
 A.level=200; V.level=200;
 A.units={ [c.UNITS[10].id]:{0:50,1:0,2:0} };
 V.units={ [c.UNITS[10].id]:{0:50,1:0,2:0} };
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'Альфа',leaderId:A.id,members:[A.id],buildings:{},battleBuildings:{},requests:[],legionLevel:5,activeBattle:null};
 A.legionId='LA'; db.save('legions'); db.save('users');

 console.log('\n[1] Боевые постройки НЕ меняют мощь в обычном бою');
 legs['LA'].battleBuildings={}; db.save('legions');
 const atk0=player.totalPower(A,'atk').power;
 legs['LA'].battleBuildings={warcmd:10,fortress:10}; db.save('legions');
 const atk1=player.totalPower(A,'atk').power;
 eq('Штаб/Бастион не влияют на totalPower', atk0, atk1);

 console.log('\n[2] Штаб не влияет на урон в обычном бою');
 const avgDmg=(bb)=>{ legs['LA'].battleBuildings=bb; db.save('legions'); let s=0,k=0;
   for(let i=0;i<1500;i++){ A.recentAttacks={}; A.lastAttackAt=0; A.pendingFatality=null; A.pendingBankHack=null; A.pendingMineDefuse=null;
     const mx=player.maxima(A); A.res.hp.cur=mx.hp; A.res.am.cur=mx.am; A.res.en.cur=mx.en; V.res.hp.cur=player.maxima(V).hp; V.dollars=100000;
     let r; try{ r=battle.attack(A,V.id,N()); }catch(e){ continue; } s+=r.dealt; k++; } return s/k; };
 const d0=avgDmg({}), d10=avgDmg({warcmd:10});
 ok('средний урон практически не изменился', Math.abs(d0-d10) < 2);

 console.log('\n[3] Медкорпус НЕ ускоряет регенерацию вне боя');
 const WIN=10*60*1000;
 const gain=()=>{ A.res.en.cur=0; A.res.en.t=Date.now()-WIN; A.res.hp.cur=0; A.res.hp.t=Date.now()-WIN; player.refresh(A); return {en:Math.floor(A.res.en.cur), hp:Math.floor(A.res.hp.cur)}; };
 A.skills.energy=600; A.skills.health=600;
 legs['LA'].battleBuildings={}; legs['LA'].activeBattle=null; db.save('legions');
 const base=gain();
 legs['LA'].battleBuildings={medcorps:5}; db.save('legions');   // есть постройка, но нет боя
 const noBattle=gain();
 eq('медкорпус без боя не ускоряет энергию', noBattle.en, base.en);
 eq('медкорпус без боя не ускоряет HP', noBattle.hp, base.hp);

 console.log('\n[4] Медкорпус НЕ ускоряет, если игрок не в списке бойцов');
 legs['LA'].activeBattle={battleId:'B1'}; db.save('legions');
 const battles=db.load('battles',{}); battles['B1']={id:'B1',phase:'active',combatants:{}}; db.save('battles');
 eq('есть бой, но игрок не участвует — нет бонуса', gain().en, base.en);

 console.log('\n[5] Медкорпус ускоряет ТОЛЬКО когда игрок в активном бою');
 battles['B1'].combatants={[A.id]:{userId:A.id}}; db.save('battles');
 ok('в бою регенерация быстрее', gain().en > base.en);

 console.log('\n[6] После боя (phase=done) бонус снова выключен');
 battles['B1'].phase='done'; db.save('battles');
 eq('завершённый бой не даёт бонус', gain().en, base.en);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
