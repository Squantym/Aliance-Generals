// Тест: валюта клана строго РЕЗ. Доллары казны убраны, постройки за резервы,
// доллары казны мигрируют в РЕЗ. После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),legion=require('../dist/src/services/legion'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Вождь','password1','v@a.com','ru','1.1.1.1');
 const usr=Object.values(player.users()).find(x=>x.name==='Вождь');
 const legs=db.load('legions',{});
 legs['LR']={id:'LR',name:'Резервисты',leaderId:usr.id,members:[usr.id],buildings:{},battleBuildings:{},techs:{},arsenal:{},
   treasury:5000000,reserves:0,requests:[]}; // 5 млн $ старой казны
 usr.legionId='LR'; db.save('legions'); db.save('users');

 console.log('\n[1] Миграция: доллары казны → РЕЗ, вкладка долларов исчезла из DTO');
 const v=legion.view(usr).mine;
 eq('доллары казны мигрированы (5 000 000 / 1000 = 5000 РЕЗ)', v.reserves, 5000);
 ok('в DTO нет поля treasury (долларов)', v.treasury===undefined);
 eq('treasury легиона обнулён', db.load('legions',{})['LR'].treasury, 0);

 console.log('\n[2] Цены построек в DTO — в РЕЗ');
 const b0=v.buildings[0];
 const expected=Math.max(1,Math.ceil(c.LEGION_BUILDINGS[0].price/c.LEGION.RESERVE_EXCHANGE_RATE));
 eq('цена первой постройки = цена$/курс', b0.nextPrice, expected);

 console.log('\n[3] Улучшение постройки списывает РЕЗ (не доллары)');
 const L=db.load('legions',{})['LR']; L.reserves=b0.nextPrice+100; db.save('legions');
 const before=L.reserves;
 legion.build(usr, b0.id, N());
 eq('РЕЗ списаны на цену постройки', db.load('legions',{})['LR'].reserves, before-b0.nextPrice);
 eq('уровень постройки вырос', db.load('legions',{})['LR'].buildings[b0.id], 1);

 console.log('\n[4] Нехватка РЕЗ — постройка не проходит');
 const L2=db.load('legions',{})['LR']; L2.reserves=0; db.save('legions');
 let err=''; try{ legion.build(usr, b0.id, N()); }catch(e){ err=e.message; }
 ok('ошибка про РЕЗ', /РЕЗ/.test(err) && /не хватает/i.test(err));

 console.log('\n[5] Боевая постройка стоит РЕЗ');
 const bb=v.battleBuildings[0];
 ok('стоимость боевой постройки в РЕЗ (reserves), без dollars', bb.nextCost && bb.nextCost.reserves>0 && bb.nextCost.dollars===undefined);

 console.log('\n[6] Внести доллары в казну больше нельзя (функция удалена)');
 ok('legion.deposit отсутствует', typeof legion.deposit==='undefined');

 console.log('\n[7] Обмен $→РЕЗ (пополнение резервов) сохранён');
 ok('exchangeToReserves на месте', typeof legion.exchangeToReserves==='function' || typeof legion.exchangeReserves==='function');

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
