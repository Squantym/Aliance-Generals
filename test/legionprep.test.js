// Тест переработки окна боя: характеристики в подготовке, восстановление за
// стоимость допинга, переименование направлений. После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),legion=require('../dist/src/services/legion'),lb=require('../dist/src/services/legionBattle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Боец1','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Боец2','password1','b@b.com','ru','1.1.1.2');
 const users=player.users();
 const u1=Object.values(users).find(x=>x.name==='Боец1'), u2=Object.values(users).find(x=>x.name==='Боец2');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'Альфа',leaderId:u1.id,members:[u1.id],arsenal:{},battleBuildings:{},requests:[]};
 legs['LB']={id:'LB',name:'Браво',leaderId:u2.id,members:[u2.id],arsenal:{},battleBuildings:{},requests:[]};
 u1.legionId='LA'; u2.legionId='LB'; db.save('legions'); db.save('users');

 console.log('\n[1] Направления переименованы');

 const r=legion.systemStartBattle('LA','LB');
 ok('бой создан в подготовке', r.ok);
 lb.joinBattle(u1,'assault',N());

 console.log('\n[2] В подготовке отдаются характеристики (с бонусами легиона)');
 const st=legion.battleState(u1);
 const mine = st.battle;
 const ms = mine.myStats;
 ok('myStats присутствует', !!ms);
 ok('есть атака/защита', typeof ms.atk==='number' && typeof ms.def==='number');
 ok('есть крит% и уворот%', typeof ms.critPct==='number' && typeof ms.dodgePct==='number');
 ok('есть HP/энергия/боеприпасы с максимумами', ms.maxHp>0 && ms.maxEnergy>0 && ms.maxAmmo>0);
 ok('есть цены восстановления по каждому ресурсу', ms.costs && ms.costs.hp>0 && ms.costs.energy>0 && ms.costs.ammo>0);
 // Проверим направления в DTO
 ok('направление Гъадакьи в DTO', JSON.stringify(mine).includes('Гъадакьи'));
 ok('направление Кӏаречӏ в DTO', JSON.stringify(mine).includes('Кӏаречӏ'));

 console.log('\n[3] Стоимость восстановления = сумме допинг-восстановителей');
 eq('цена HP = аптечка', ms.costs.hp, c.MARKET_ITEM_BY_ID.medkit.gold);
 eq('цена энергии = энергетик', ms.costs.energy, c.MARKET_ITEM_BY_ID.energy.gold);
 eq('цена патронов = цинк', ms.costs.ammo, c.MARKET_ITEM_BY_ID.ammo.gold);

 console.log('\n[4] Восстановление тратит золото и наполняет ресурсы');
 // Потратим ресурсы и золото дадим
 const mx=player.maxima(u1); u1.res.hp.cur=1; u1.res.en.cur=1; u1.res.am.cur=1;
 const total=ms.costs.hp+ms.costs.energy+ms.costs.ammo;
 u1.gold=total+100; db.save('users');
 legion.restoreForBattle(u1,'hp',N());
 legion.restoreForBattle(u1,'energy',N());
 legion.restoreForBattle(u1,'ammo',N());
 eq('списано золото за три ресурса по отдельности', u1.gold, 100);
 eq('HP восстановлено', Math.floor(u1.res.hp.cur), Math.floor(mx.hp));
 eq('энергия восстановлена', Math.floor(u1.res.en.cur), Math.floor(mx.en));
 eq('боеприпасы восстановлены', Math.floor(u1.res.am.cur), Math.floor(mx.am));

 console.log('\n[5] Без золота восстановление отклонено');
 u1.res.hp.cur=1; u1.gold=0; db.save('users');
 let threw=false; try{ legion.restoreForBattle(u1,'hp',N()); }catch(e){ threw=true; }
 ok('нет золота → ошибка', threw);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
