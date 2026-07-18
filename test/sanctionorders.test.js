// Детализация заказчиков санкции: разбивка полной суммы по заказчикам,
// свёртка нескольких доплат одного игрока, проценты, сортировка.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),sanctions=require('../dist/src/services/sanctions');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Заказчик1','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Заказчик2','password1','b@b.com','ru','1.1.1.2');
 await auth.register('Цель','password1','t@t.com','ru','1.1.1.3');
 const us=player.users();
 const O1=Object.values(us).find(x=>x.name==='Заказчик1');
 const O2=Object.values(us).find(x=>x.name==='Заказчик2');
 const T=Object.values(us).find(x=>x.name==='Цель');
 O1.dollars=1e6; O2.dollars=1e6;
 O1.earCutters=[{id:T.id,name:'Цель',at:Date.now()}];
 O2.earCutters=[{id:T.id,name:'Цель',at:Date.now()}];
 db.save('users');

 console.log('\n[1] Несколько заказчиков — банк суммируется');
 sanctions.declare(O1, T.id, 50000, N());
 sanctions.declare(O2, T.id, 30000, N());
 sanctions.declare(O1, T.id, 20000, N());   // доплата
 const det=sanctions.orders(O1, T.id);
 eq('полный банк = 100 000', det.bounty, 100000);
 eq('уникальных заказчиков — 2', det.ordererCount, 2);

 console.log('\n[2] Доплаты одного заказчика свёрнуты');
 const o1=det.orders.find(o=>o.byName==='Заказчик1');
 eq('вклад Заказчик1 = 70 000', o1.amount, 70000);
 eq('у него 2 доплаты', o1.count, 2);
 eq('его доля 70%', o1.pct, 70);
 ok('он помечен как «вы» для себя', o1.isMe === true);

 console.log('\n[3] Сумма частей равна банку');
 const sum=det.orders.reduce((s,o)=>s+o.amount,0);
 eq('сумма вкладов = банк', sum, det.bounty);

 console.log('\n[4] Сортировка по убыванию вклада');
 ok('первый вклад ≥ второго', det.orders[0].amount >= det.orders[1].amount);

 console.log('\n[5] Список отдаёт число заказчиков');
 const list=sanctions.list(O2);
 const entry=list.sanctions.find(s=>s.targetId===T.id);
 eq('в списке orderCount = 3 (все ставки)', entry.orderCount, 3);
 eq('мой вклад (Заказчик2) = 30 000', entry.myOrder, 30000);

 console.log('\n[6] Для чужого игрока его вклад не помечается «вы»');
 const detForO2=sanctions.orders(O2, T.id);
 const o1FromO2=detForO2.orders.find(o=>o.byName==='Заказчик1');
 ok('Заказчик1 не «вы» с точки зрения Заказчика2', o1FromO2.isMe === false);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
