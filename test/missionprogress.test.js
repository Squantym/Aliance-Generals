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
 // Техника ВСЕХ родов войск (требования спецопераций теперь по типам)
 U.units={};
 const step0=c.CONFLICT_BY_ID['border'].operations[0].steps[0];
 for (const t of ['ground','air','sea']) {
   const cu=c.UNITS.filter(x=>x.type===t && x.unlock>=step0.require.units.minLevel && x.unlock<=50)
                   .sort((a,b)=>a.unlock-b.unlock)[0] || c.UNITS.find(x=>x.type===t);
   if (cu) U.units[cu.id]={0:200,1:0,2:0};
 }
 U.skills.energy=4000; const mx=player.maxima(U); U.res.en.cur=Math.max(mx.en, 5000);
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
 // Выдать технику ПОД ТРЕБОВАНИЯ конкретного шага (они теперь по родам войск,
 // и профиль операции у разных шагов может отличаться).
 const armFor = (stepIdx) => {
   const st = c.CONFLICT_BY_ID[confId].operations[0].steps[stepIdx];
   const need = st.require.units;
   U.units = {};
   for (const [t, n] of Object.entries(need.byType || {})) {
     const cu = c.UNITS.filter(x => x.type === t && x.unlock >= need.minLevel)
                       .sort((a, b) => a.unlock - b.unlock)[0]
             || c.UNITS.filter(x => x.type === t).sort((a, b) => b.unlock - a.unlock)[0];
     if (cu) U.units[cu.id] = { 0: Number(n) + 50, 1: 0, 2: 0 };
   }
 };
 for (let stepN=1; stepN<3; stepN++) {
   U.level=300; armFor(stepN);
   const mx2=player.maxima(U); U.res.en.cur=Math.max(mx2.en, 5000);
   const r = missions.startStep(U, confId, 0, stepN, []);
   if (r && r.needUnits) throw new Error('шаг '+stepN+': не хватило техники — '+JSON.stringify(r.needUnits.items));
   U.missionQueue[0].finishesAt = Date.now()-1000;
   player.refresh(U);
 }
 det=missions.detail(U, confId);
 eq('все 3 шага опы[0] пройдены', det.operations[0].stepsDone, 3);

 console.log('\n[5] Список миссий отдаёт активный шаг с таймером');
 const mx3=player.maxima(U); U.res.en.cur=Math.max(mx3.en, 5000);
 missions.startStep(U, confId, 1, 0, []);
 const list=missions.list(U);
 ok('в списке есть active', !!list.active);
 ok('active несёт secondsLeft', typeof list.active.secondsLeft==='number' && list.active.secondsLeft>0);
 ok('active несёт totalSec', typeof list.active.totalSec==='number' && list.active.totalSec>0);

 console.log('\n[6] Ускорение: минута остатка — одно золото, и цена везде одна');
 // Раньше цена считалась один раз от полной длительности шага и лежала
 // в proc.boostGold, а клиент рисовал её из двух разных полей: на
 // карточке конфликта стояла константа 20, в списке — настоящая цена.
 // Число «падало с 20 до 2» при переходе между экранами, а платил
 // игрок третью величину.
 const proc6=U.missionQueue[0];
 const stepMin=c.CONFLICT_BY_ID[confId].operations[1].steps[0].timeMin;
 eq('цена только что запущенного шага = его минутам', missions.list(U).active.boostGold, stepMin);
 eq('на карточке конфликта цена та же',
    missions.detail(U, confId).activeStep.boostGold, missions.list(U).active.boostGold);

 proc6.finishesAt=Date.now()+3*60000;
 eq('осталось три минуты — цена три', missions.list(U).active.boostGold, 3);
 proc6.finishesAt=Date.now()+30*1000;
 eq('меньше минуты — но не бесплатно', missions.list(U).active.boostGold, 1);

 proc6.finishesAt=Date.now()+5*60000;
 U.gold=100;
 const shown6=missions.list(U).active.boostGold;
 const goldBefore6=U.gold;
 missions.boostStep(U, proc6.id, []);
 eq('списано ровно столько, сколько показано', goldBefore6-U.gold, shown6);
 eq('и это пять золота за пять минут', shown6, 5);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
