// Прогресс шагов миссий: запуск, засчитывание по времени (checkCompleted),
// продвижение stepsDone и полное прохождение конфликта.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('path')&&require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),missions=require('../dist/src/services/missions'),c=require('../dist/config/gameConfig');
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Боец','password1','a@a.com','ru','1.1.1.1');
 const U=Object.values(player.users()).find(x=>x.name==='Боец');
 U.level=50;
 U.units={ [c.UNITS[0].id]:{0:20,1:0,2:0} };  // техника для требований
 U.skills.energy=400; const mx=player.maxima(U); U.res.en.cur=mx.en;
 db.save('users');
 const confId='border';

 console.log('\n[1] Старт шага создаёт активный процесс');
 let det=missions.detail(U, confId);
 eq('до старта шагов пройдено 0', det.operations[0].stepsDone, 0);
 eq('активного шага нет', det.activeStep, null);
 missions.startStep(U, confId, 0, 0, []);
 det=missions.detail(U, confId);
 ok('активный шаг появился', !!det.activeStep);
 eq('в очереди 1 процесс', U.missionQueue.length, 1);

 console.log('\n[2] Пока время не вышло — шаг НЕ засчитывается');
 player.refresh(U);
 det=missions.detail(U, confId);
 eq('шаг ещё не пройден', det.operations[0].stepsDone, 0);
 ok('процесс всё ещё активен', U.missionQueue.length===1);

 console.log('\n[3] Время вышло → checkCompleted засчитывает шаг');
 U.missionQueue[0].finishesAt = Date.now() - 1000;
 const xpBefore = U.xp;
 player.refresh(U);   // внутри — missions.checkCompleted
 det=missions.detail(U, confId);
 eq('шаг засчитан (stepsDone=1)', det.operations[0].stepsDone, 1);
 eq('очередь очистилась', U.missionQueue.length, 0);
 eq('активного шага снова нет', det.activeStep, null);
 ok('игрок получил опыт за шаг', U.xp > xpBefore);

 console.log('\n[4] Три шага → спецоперация завершена');
 for (let stepN=1; stepN<3; stepN++) {
   const nx=missions.detail(U, confId).operations[0];
   // условия шагов растут — если не проходим по требованиям, добьём армию/уровень
   U.level=300; U.units={ [c.UNITS[5].id]:{0:40,1:0,2:0} };
   const mx2=player.maxima(U); U.res.en.cur=mx2.en;
   try { missions.startStep(U, confId, 0, stepN, []); }
   catch(e){ console.log('     (шаг '+stepN+' требует больше — усилили и повторяем: '+e.message.slice(0,40)+')');
     U.units={ [c.UNITS[8].id]:{0:60,1:0,2:0} }; missions.startStep(U, confId, 0, stepN, []); }
   U.missionQueue[0].finishesAt = Date.now()-1000;
   player.refresh(U);
 }
 det=missions.detail(U, confId);
 eq('все 3 шага опы[0] пройдены', det.operations[0].stepsDone, 3);

 console.log('\n[5] Список миссий отдаёт активный шаг с таймером');
 const mx3=player.maxima(U); U.res.en.cur=mx3.en;
 missions.startStep(U, confId, 1, 0, []);
 const list=missions.list(U);
 ok('в списке есть active', !!list.active);
 ok('active несёт secondsLeft', typeof list.active.secondsLeft==='number' && list.active.secondsLeft>0);
 ok('active несёт totalSec', typeof list.active.totalSec==='number' && list.active.totalSec>0);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
