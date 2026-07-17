// Вклады: недельный срез сбрасывается, общий — нет; вклад сохраняется после
// выхода из легиона. Плюс: уведомление о нападении несёт деньги и технику.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const legion=require('../dist/src/services/legion'),battle=require('../dist/src/services/battle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Лидер','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Боец','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const L1=Object.values(us).find(x=>x.name==='Лидер'), M=Object.values(us).find(x=>x.name==='Боец');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'Альфа',leaderId:L1.id,members:[L1.id,M.id],arsenal:{},battleBuildings:{},requests:[],legionLevel:1};
 L1.legionId='LA'; M.legionId='LA';
 L1.ears=10000; L1.tokens=100; M.ears=5000; M.tokens=50;
 db.save('legions'); db.save('users');

 console.log('\n[1] Вклад пишется и в общий, и в недельный');
 legion.depositResources(L1,3000,10,false,N());
 legion.depositResources(M,1000,0,false,N());
 let d=legion.contributions(L1);
 eq('в общем 2 вкладчика', d.all.length, 2);
 eq('в недельном тоже 2', d.week.length, 2);
 eq('общий: лидер 3000 ушей', d.all[0].ears, 3000);
 eq('недельный: лидер 3000 ушей', d.week[0].ears, 3000);

 console.log('\n[2] Новая неделя: недельный обнуляется, общий сохраняется');
 legs['LA'].contribWeekStart = Date.now() - 14*24*3600*1000;  // «прошлая неделя»
 db.save('legions');
 d=legion.contributions(L1);
 eq('недельный обнулился', d.week.length, 0);
 eq('общий на месте', d.all.length, 2);
 eq('общий не пострадал', d.all[0].ears, 3000);

 console.log('\n[3] После сброса новый вклад копится заново');
 legion.depositResources(L1,500,0,false,N());
 d=legion.contributions(L1);
 eq('в недельном только новый вклад', d.week[0].ears, 500);
 eq('в общем сумма за всё время', d.all[0].ears, 3500);

 console.log('\n[4] Игрок вышел из легиона — вклад сохраняется');
 legs['LA'].members = legs['LA'].members.filter(id => id !== M.id);
 M.legionId = null; db.save('legions'); db.save('users');
 d=legion.contributions(L1);
 const gone=d.all.find(x=>x.name==='Боец');
 ok('вклад ушедшего остался в рейтинге', !!gone && gone.ears===1000);
 eq('он помечен как вышедший', gone.left, true);
 const stayed=d.all.find(x=>x.name==='Лидер');
 eq('оставшийся не помечен', stayed.left, false);

 console.log('\n[5] Уведомление о нападении: видно деньги и технику');
 const notifications=require('../dist/src/services/notifications');
 const A=L1, D=M;
 A.level=200; D.level=200;
 A.units={ [c.UNITS[13].id]:{0:50,1:0,2:0} };   // сильнее
 D.units={ [c.UNITS[10].id]:{0:50,1:0,2:0} };   // слабее
 D.dollars=500000; A.lastAttackAt=0;
 const mx=player.maxima(A); A.res.hp.cur=mx.hp; A.res.am.cur=mx.am; A.res.en.cur=mx.en;
 D.res.hp.cur=player.maxima(D).hp;
 db.save('users');
 const r=battle.attack(A,D.id,N());
 ok('атакующий победил', r.win);
 const arr=notifications.list(D).notifications;
 const n=arr.find(x=>x.kind==='attack_lost');
 ok('защитнику пришло уведомление о нападении', !!n);
 ok('в нём указаны отобранные деньги', n.payload && typeof n.payload.loot==='number' && n.payload.loot>0);
 ok('в нём указана потерянная техника', n.payload && 'lossesText' in n.payload);
 ok('в нём указан полученный урон', typeof n.payload.dealt==='number');
 console.log(`     уведомление: отобрано $${n.payload.loot}, техника: ${n.payload.lossesText || 'без потерь'}`);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
