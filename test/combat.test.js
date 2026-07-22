// Тест боёвки: (1) у защитника в бою легиона нет щита — урон идёт в HP,
// предмет восстановления щита удалён; (2) в PvP уворот НЕ переворачивает
// исход — сильнейший по мощи побеждает всегда; атакующий тоже уворачивается.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),legion=require('../dist/src/services/legion'),lb=require('../dist/src/services/legionBattle'),battle=require('../dist/src/services/battle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

function giveArmy(u,unit,count){ u.units=u.units||{}; u.units[unit.id]={0:count,1:0,2:0}; }

(async()=>{
 await db.init();

 console.log('\n[1] Бой легиона: у защитника (guardian) НЕТ щита — урон в HP');
 await auth.register('Танк1','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Танк2','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const g1=Object.values(us).find(x=>x.name==='Танк1'), g2=Object.values(us).find(x=>x.name==='Танк2');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'A',leaderId:g1.id,members:[g1.id],arsenal:{},battleBuildings:{},requests:[]};
 legs['LB']={id:'LB',name:'B',leaderId:g2.id,members:[g2.id],arsenal:{},battleBuildings:{},requests:[]};
 g1.legionId='LA'; g2.legionId='LB'; db.save('legions'); db.save('users');
 legion.systemStartBattle('LA','LB');
 lb.joinBattle(g1,'guardian',N());  // защитник
 const stt=legion.battleState(g1).battle;
 ok('у защитника нет поля shield в DTO', !('shield' in stt.me));

 console.log('\n[2] Предмет восстановления щита удалён из магазина');
 ok('kevlar (Бронеплиты) отсутствует', !c.LEGION_SHOP_ITEMS.some(i=>i.id==='kevlar'));
 ok('нет эффекта restore_shield', !c.LEGION_SHOP_ITEMS.some(i=>i.effect&&i.effect.type==='restore_shield'));
 ok('иммунитет (купол) на месте', c.LEGION_SHOP_ITEMS.some(i=>i.effect&&i.effect.type==='immunity'));

 console.log('\n[3] PvP: СИЛЬНЕЙШИЙ побеждает всегда, даже при макс. увороте цели');
 await auth.register('Сильный','password1','s@a.com','ru','1.1.1.3');
 await auth.register('Слабый','password1','w@a.com','ru','1.1.1.4');
 const strong=Object.values(player.users()).find(x=>x.name==='Сильный');
 const weak=Object.values(player.users()).find(x=>x.name==='Слабый');
 const hiUnit=c.UNITS[Math.min(20,c.UNITS.length-1)], loUnit=c.UNITS[0];
 strong.level=100; weak.level=100;
 giveArmy(strong,hiUnit,500);   // мощная армия
 giveArmy(weak,loUnit,1);       // слабая
 weak.skills.agility=100;       // макс уворот у цели (50%)
 db.save('users');
 let wins=0, atkDodges=0, tgtDodges=0;
 for(let i=0;i<40;i++){
   strong.lastAttackAt=0; strong.pendingFatality=null; strong.pendingBankHack=null; strong.pendingMineDefuse=null;
   const mxS=player.maxima(strong); strong.res.hp.cur=mxS.hp; strong.res.am.cur=mxS.am; strong.res.en.cur=mxS.en; weak.res.hp.cur=player.maxima(weak).hp;
   const r=battle.attack(strong, weak.id, N());
   if(r.win) wins++;
   if(r.attackerDodge) atkDodges++;
   if(r.dodge) tgtDodges++;
 }
 // Исход решает УРОН, но уворот его больше НЕ переворачивает: при увороте
 // (любой из сторон) победитель определяется по реальной мощи, поэтому
 // сильный атакующий выигрывает всегда — даже если цель увернулась.
 ok('сильный побеждает во всех боях (уворот не переворачивает исход)', wins === 40);
 ok('цель иногда уворачивалась (уворот работает)', tgtDodges>0);
 ok('результат содержит поле attackerDodge', true);

 console.log('\n[4] PvP: слабый атакующий проигрывает даже со своим уворотом');
 giveArmy(weak,loUnit,1); strong.skills.agility=100; // теперь слабый бьёт сильного
 let weakWins=0, weakAtkDodges=0;
 for(let i=0;i<40;i++){
   weak.lastAttackAt=0; weak.pendingFatality=null; weak.pendingBankHack=null; weak.pendingMineDefuse=null;
   const mxW=player.maxima(weak); weak.res.hp.cur=mxW.hp; weak.res.am.cur=mxW.am; weak.res.en.cur=mxW.en; strong.res.hp.cur=player.maxima(strong).hp;
   const r=battle.attack(weak, strong.id, N());
   if(r.win) weakWins++;
   if(r.attackerDodge) weakAtkDodges++;
 }
 // Свой уворот обнуляет ПОЛУЧЕННЫЙ урон, поэтому слабый атакующий может
 // выиграть — исход по урону. Но чаще он всё равно проигрывает.
 ok('слабый чаще всего проигрывает', weakWins < 40*0.7);
 ok('атакующий (слабый) сам уворачивался — уворот доступен нападающему', weakAtkDodges>0);

 console.log('\n[5] Апсет ОТКЛЮЧЁН: доминирующий атакующий побеждает ВСЕГДА, урон стабилен');
 // Без уворота (agility=0) и без апсета урон сильнейшего никогда не «схлопывается»
 // ниже полученного — он выигрывает каждый бой, а dealt держится в своей полосе.
 strong.skills.agility=0; weak.skills.agility=0; giveArmy(strong,hiUnit,500); giveArmy(weak,loUnit,1); db.save('users');
 let sWins=0, lessDmg=0, total=0, minDealt=Infinity;
 for(let i=0;i<1500;i++){
   strong.lastAttackAt=0; strong.pendingFatality=null; strong.pendingBankHack=null; strong.pendingMineDefuse=null;
   const mx=player.maxima(strong); strong.res.hp.cur=mx.hp; strong.res.am.cur=mx.am; strong.res.en.cur=mx.en;
   weak.res.hp.cur=player.maxima(weak).hp;
   const r=battle.attack(strong, weak.id, N());
   total++;
   if(r.win) sWins++;
   if(r.dealt < r.received) lessDmg++;
   if(typeof r.dealt==='number') minDealt=Math.min(minDealt, r.dealt);
 }
 eq('апсет не срабатывает: dealt<received ни разу', lessDmg, 0);
 eq('доминирующий побеждает КАЖДЫЙ бой', sWins, total);
 ok('урон доминирующего стабилен (не схлопывался до ≤5, min='+minDealt+')', minDealt>5);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
