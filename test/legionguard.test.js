// Прикрытие: лог перенаправления урона, корректная статистика и гибель
// защитника. Трофей крит-лечения. Вклады в казну (история + рейтинг).
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const legion=require('../dist/src/services/legion'),lb=require('../dist/src/services/legionBattle');
const trophies=require('../dist/src/services/trophies'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Враг','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Жертва','password1','b@b.com','ru','1.1.1.2');
 await auth.register('Защитник','password1','c@c.com','ru','1.1.1.3');
 const us=player.users();
 const E=Object.values(us).find(x=>x.name==='Враг');
 const V=Object.values(us).find(x=>x.name==='Жертва');
 const G=Object.values(us).find(x=>x.name==='Защитник');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'Альфа',leaderId:E.id,members:[E.id],arsenal:{},battleBuildings:{},requests:[]};
 legs['LB']={id:'LB',name:'Браво',leaderId:V.id,members:[V.id,G.id],arsenal:{},battleBuildings:{},requests:[]};
 E.legionId='LA'; V.legionId='LB'; G.legionId='LB';
 const unit=c.UNITS[10];
 for(const p of [E,V,G]){ p.units={[unit.id]:{0:200,1:0,2:0}}; p.level=300; p.skills.agility=0; p.effects=[]; }
 db.save('legions'); db.save('users');
 legion.systemStartBattle('LA','LB');
 lb.joinBattle(E,'assault',N()); lb.joinBattle(V,'assault',N()); lb.joinBattle(G,'guardian',N());
 const bid=db.load('legions',{}).LA.activeBattle.battleId;
 const battle=db.load('battles',{})[bid];
 const cE=battle.combatants[E.id], cV=battle.combatants[V.id], cG=battle.combatants[G.id];
 battle.phase='active'; cE.direction=1; cV.direction=1; cG.direction=1;
 cV.hp=9e8; cV.maxHp=9e8; cG.hp=9e8; cG.maxHp=9e8;
 // Защитник прикрывает Жертву
 battle.guardLinks={[V.id]:G.id}; battle.guardExpiry={[G.id]:Date.now()+9e6};
 db.save('battles');

 console.log('\n[1] Урон уходит защитнику, а не прикрываемому');
 const vBefore=cV.hp, gBefore=cG.hp;
 E.res.am.cur=999; cE.lastActionAt=0;
 lb.attack(E,V.id,N());
 eq('у прикрываемого HP не изменилось', cV.hp, vBefore);
 ok('защитник получил урон', cG.hp < gBefore);

 console.log('\n[2] В логе видно, что урон перенаправлен на защитника');
 const last=battle.log[battle.log.length-1].text;
 console.log('     лог: '+last);
 ok('в логе есть имя защитника', last.includes('Защитник'));
 ok('в логе сказано, что он принял урон на себя', /принял урон на себя|прикрыл/.test(last));

 console.log('\n[3] Статистика урона идёт защитнику, а не прикрываемому');
 eq('у прикрываемого dmgTaken = 0', cV.stats.dmgTaken, 0);
 ok('у защитника dmgTaken > 0', cG.stats.dmgTaken > 0);

 console.log('\n[4] Погибший защитник корректно выбывает (а не «зомби» с 0 HP)');
 cG.hp=1; cV.hp=9e8; E.res.am.cur=999; cE.lastActionAt=0;
 lb.attack(E,V.id,N());
 eq('у защитника HP = 0', cG.hp, 0);
 eq('защитник помечен выбывшим', cG.alive, false);
 ok('атакующему засчитано убийство', cE.stats.kills >= 1);
 const killLog=battle.log[battle.log.length-1].text;
 ok('в логе объявлено о выбытии защитника', /Защитник ВЫБЫЛ/.test(killLog));
 ok('прикрываемый остался жив', cV.alive === true);

 console.log('\n[5] Трофей крит-лечения: отдельный, не зависит от ловкости');
 const M=V;  // используем как медика
 M.trophies={}; M.skills.agility=0;
 const base=trophies.critHealChance(M);
 eq('без трофея — базовые 5%', Math.round(base*100), 5);
 M.skills.agility=200;
 eq('ловкость больше НЕ влияет на крит-лечение', trophies.critHealChance(M), base);
 M.trophies={red_cross:5};
 eq('трофей ур.5 → 5% + 22.5% = 27.5%', Math.round(trophies.critHealChance(M)*1000)/10, 27.5);
 M.trophies={red_cross:10};
 eq('трофей ур.10 (макс) → 50%', Math.round(trophies.critHealChance(M)*100), 50);
 const def=c.TROPHIES.find(t=>t.id==='red_cross');
 ok('трофей есть в списке', !!def);
 eq('привязка apply=crit_heal', def.apply, 'crit_heal');

 console.log('\n[6] Вклады в казну: история и рейтинг');
 V.ears=5000; V.tokens=10; G.ears=1052; V.adminEars=999; db.save('users');
 legion.depositResources(V,3000,10,false,N());
 legion.depositResources(G,1052,0,false,N());
 const L=legion.view(V).mine;
 ok('рейтинг заполнен', L.contributions.length===2);
 eq('первый в рейтинге — кто внёс больше ушей', L.contributions[0].name, 'Жертва');
 eq('его уши', L.contributions[0].ears, 3000);
 eq('его жетоны', L.contributions[0].tokens, 10);
 eq('второй — Защитник', L.contributions[1].name, 'Защитник');
 eq('его уши', L.contributions[1].ears, 1052);
 ok('история заполнена', L.treasuryHistory.length===2);
 eq('в истории свежая запись первой', L.treasuryHistory[0].name, 'Защитник');
 eq('в записи 1052 уха', L.treasuryHistory[0].ears, 1052);

 console.log('\n[7] Админские ресурсы в рейтинг не идут (иначе рейтинг надувается)');
 legion.depositResources(V,999,0,true,N());
 const L2=legion.view(V).mine;
 eq('уши в рейтинге не выросли', L2.contributions.find(x=>x.name==='Жертва').ears, 3000);
 ok('но в истории запись есть', L2.treasuryHistory[0].ears===999);

 console.log('\n[8] Обмен долларов в РЕЗ тоже попадает в рейтинг');
 V.dollars=5*c.LEGION.RESERVE_EXCHANGE_RATE; db.save('users');
 legion.exchangeToReserves(V, 5*c.LEGION.RESERVE_EXCHANGE_RATE, N());
 const L3=legion.view(V).mine;
 eq('РЕЗ засчитаны в рейтинг', L3.contributions.find(x=>x.name==='Жертва').reserves, 5);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
