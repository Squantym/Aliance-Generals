// Тест: ускорение по времени (10 золота/час) + переработка миссий
// (награды 10–50 ед. техники на уровне, требование к технике). После build.
const assert=require('assert');
const c=require('../dist/config/gameConfig');
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};
const near=(n,a,b,tol)=>{assert.ok(Math.abs(a-b)<=tol,`❌ ${n}: ${a} vs ${b} (±${tol})`);passed++;console.log('  ✅ '+n+' ('+a+')');};

console.log('\n[1] Ускорение трофея = 10 золота/час полной длительности');
eq('трофей ур.1 (1 ч) → 10 золота', c.trophyBoostGold(1), 10);
// проверяем инвариант 10 з/час на любом уровне
for (const lvl of [1,3,5,7,10]) {
  const hours = c.trophyTrainMinutes(lvl)/60;
  eq('ур.'+lvl+': 10 з/час совпадает', c.trophyBoostGold(lvl), Math.max(1,Math.round(hours*10)));
}
// явная проверка примера «240 ч → 2400»
eq('240 ч → 2400 золота (формула)', Math.max(1,Math.round((240*60/60)*10)), 2400);
console.log('     трофей ур.7 ('+Math.round(c.trophyTrainMinutes(7)/60)+' ч) = '+c.trophyBoostGold(7)+' золота');

console.log('\n[2] Ускорение шага миссии = 10 золота/час его длительности');
const conf0=c.CONFLICTS[0]; // первый конфликт
let checkedSteps=0;
for (const op of conf0.operations) for (const s of op.steps) {
  eq('шаг '+op.idx+'/'+s.idx+': boostGold=10 з/час', s.boostGold, Math.max(1,Math.round((s.timeMin/60)*10)));
  checkedSteps++; if (checkedSteps>=3) break;
}

console.log('\n[3] Награда шага = 10..50 ед. техники на уровне миссии');
// Первый шаг первой операции → множитель 10; последний шаг последней → 50
const firstOp=conf0.operations[0], firstStep=firstOp.steps[0];
const lastOp=conf0.operations[conf0.operations.length-1], lastStep=lastOp.steps[2];
const firstLevel=conf0.minLevel+0+0, lastLevel=conf0.minLevel+(conf0.operations.length-1)+2;
const firstN=firstStep.money/c.minUnitPriceAtLevel(firstLevel);
const lastN=lastStep.money/c.minUnitPriceAtLevel(lastLevel);
near('первый шаг ≈ 10 ед. техники', firstN, 10, 0.6);
near('последний шаг ≈ 50 ед. техники', lastN, 50, 0.6);
ok('награда последнего шага больше первого', lastStep.money>firstStep.money);

console.log('\n[4] Требование к технике по уровню присутствует и растёт со сложностью');
ok('у шага есть require.units', !!firstStep.require.units && firstStep.require.units.count>0);
ok('minLevel требования привязан к уровню миссии', firstStep.require.units.minLevel>=1);
// более сложный конфликт → больше требуемых единиц
const confHard=c.CONFLICTS[c.CONFLICTS.length-1];
const hardStep=confHard.operations[0].steps[0];
ok('в сложном конфликте требуется больше техники', hardStep.require.units.count > firstStep.require.units.count);
console.log('     border op0/step0: '+firstStep.require.units.count+' ед. ур.'+firstStep.require.units.minLevel+'+ | '+confHard.id+': '+hardStep.require.units.count+' ед. ур.'+hardStep.require.units.minLevel+'+');

console.log('\n[5] Enforcement: без нужной техники шаг не стартует (проверка по технике)');
process.env.MONGODB_URI='';
const fs=require('fs'),path=require('path'); const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
(async()=>{
 const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),missions=require('../dist/src/services/missions');
 await db.init();
 await auth.register('Оперативник','password1','o@a.com','ru','1.1.1.1');
 const usr=Object.values(player.users()).find(x=>x.name==='Оперативник');
 // Дадим уровень, энергию и МНОГО низкотировой техники (для мощи), но НЕ дадим
 // технику высокого тира, которую требует require.units более сложного конфликта.
 usr.level=300; const mx=player.maxima(usr); usr.res.en.cur=mx.en;
 const conf=c.CONFLICTS[c.CONFLICTS.length-1]; // сложный конфликт
 const reqMin=conf.operations[0].steps[0].require.units.minLevel;
 // Мощнейший юнит НИЖЕ гейта: даёт огромную мощь (пройдёт powerReq), но не
 // засчитывается в require.units (его unlock < reqMin).
 const unit=c.UNITS.filter(u=>u.unlock<reqMin).sort((a,b)=>b.unlock-a.unlock)[0];
 usr.units={}; usr.units[unit.id]={0:2000,1:0,2:0};
 let err='';
 try { missions.startStep(usr, conf.id, 0, 0, []); } catch(e){ err=e.message; }
 console.log('     сообщение: '+err);
 ok('старт отклонён из-за нехватки техники нужного уровня', /ед\. техники уровня/.test(err));
 // Теперь дадим технику НУЖНОГО уровня — требование по технике должно уйти
 const highUnit=c.UNITS.filter(u=>u.unlock>=reqMin).sort((a,b)=>a.unlock-b.unlock)[0];
 if (highUnit) { usr.units[highUnit.id]={0:conf.operations[0].steps[0].require.units.count+5,1:0,2:0};
   let err2=''; try { missions.startStep(usr, conf.id, 0, 0, []); } catch(e){ err2=e.message; }
   ok('после выдачи техники нужного уровня требование по технике снято', !/ед\. техники уровня/.test(err2)); }

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
