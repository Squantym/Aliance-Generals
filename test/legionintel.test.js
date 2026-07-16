// Медкорпус (регенерация строго в бою) и Разведцентр (5 уровней данных).
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const legion=require('../dist/src/services/legion'),lb=require('../dist/src/services/legionBattle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Ата','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Враг1','password1','b@b.com','ru','1.1.1.2');
 await auth.register('Враг2','password1','c@c.com','ru','1.1.1.3');
 const us=player.users();
 const A=Object.values(us).find(x=>x.name==='Ата');
 const E1=Object.values(us).find(x=>x.name==='Враг1');
 const E2=Object.values(us).find(x=>x.name==='Враг2');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'Альфа',leaderId:A.id,members:[A.id],arsenal:{},battleBuildings:{},requests:[],legionLevel:5};
 legs['LB']={id:'LB',name:'Браво',leaderId:E1.id,members:[E1.id,E2.id],arsenal:{},battleBuildings:{fortress:4,warcmd:2},requests:[],legionLevel:5};
 A.legionId='LA'; E1.legionId='LB'; E2.legionId='LB';
 const unit=c.UNITS[10];
 for(const p of [A,E1,E2]){ p.units={[unit.id]:{0:200,1:0,2:0}}; p.level=300; p.skills.energy=50; p.skills.ammo=50; p.skills.health=50; }
 db.save('legions'); db.save('users');

 console.log('\n[1] Медкорпус ускоряет регенерацию ТОЛЬКО в бою легиона');
 const WIN=10*60*1000;
 const gain=()=>{ const mx=player.maxima(A);
   A.res.en.cur=0; A.res.en.t=Date.now()-WIN;
   A.res.am.cur=0; A.res.am.t=Date.now()-WIN;
   A.res.hp.cur=0; A.res.hp.t=Date.now()-WIN;
   player.refresh(A);
   return {en:Math.floor(A.res.en.cur), am:Math.floor(A.res.am.cur), hp:Math.floor(A.res.hp.cur)}; };
 legs['LA'].battleBuildings={medcorps:5}; db.save('legions');
 const outOfBattle=gain();
 console.log(`     вне боя (медкорпус ур.5): энергия ${outOfBattle.en}, патроны ${outOfBattle.am}, HP ${outOfBattle.hp}`);
 legion.systemStartBattle('LA','LB');
 lb.joinBattle(A,'assault',N()); lb.joinBattle(E1,'assault',N()); lb.joinBattle(E2,'medic',N());
 const inBattle=gain();
 console.log(`     в бою   (медкорпус ур.5): энергия ${inBattle.en}, патроны ${inBattle.am}, HP ${inBattle.hp}`);
 ok('в бою энергии восстановилось больше', inBattle.en > outOfBattle.en);
 ok('в бою HP восстановилось больше', inBattle.hp > outOfBattle.hp);
 // без постройки — в бою как вне боя
 legs['LA'].battleBuildings={}; db.save('legions');
 const noMed=gain();
 eq('без медкорпуса бонуса нет', noMed.en, outOfBattle.en);

 const bid=db.load('legions',{}).LA.activeBattle.battleId;
 const battle=db.load('battles',{})[bid];
 const state=()=>legion.battleState(A).battle;

 console.log('\n[2] Разведка ур.0 — врага не видно вообще');
 legs['LA'].battleBuildings={}; db.save('legions');
 let st=state();
 eq('фаза подготовки', st.phase, 'prep');
 eq('уровень разведки 0', st.intelLevel, 0);
 eq('врагов в общем списке нет', st.allCombatants.filter(x=>x.side!==st.mySide).length, 0);
 eq('на направлениях врагов нет', st.directions.reduce((s,d)=>s+d.enemies.length,0), 0);

 console.log('\n[3] Ур.1 — виден список зашедших в бой');
 legs['LA'].battleBuildings={intel:1}; db.save('legions');
 st=state();
 const foes=()=>st.allCombatants.filter(x=>x.side!==st.mySide);
 eq('врагов видно 2', foes().length, 2);
 ok('имена видны', foes().every(f=>!!f.name));
 ok('направления ещё скрыты', foes().every(f=>f.direction===undefined));
 eq('на направлениях врагов ещё нет', st.directions.reduce((s,d)=>s+d.enemies.length,0), 0);

 console.log('\n[4] Ур.2 — направления и роли (иконками)');
 lb.setReady(E1,true,N()); lb.chooseDirection(E1,2,N());
 legs['LA'].battleBuildings={intel:2}; db.save('legions');
 st=state();
 const dir2=st.directions.find(d=>d.dir===2);
 eq('враг виден на своём направлении', dir2.enemies.length, 1);
 ok('есть иконка роли', !!dir2.enemies[0].roleIcon);
 ok('характеристики ещё скрыты', dir2.enemies[0].stats===undefined);

 console.log('\n[5] Ур.3 — примерные характеристики');
 legs['LA'].battleBuildings={intel:3}; db.save('legions');
 st=state();
 const f3=st.allCombatants.filter(x=>x.side!==st.mySide).find(f=>f.stats);
 ok('характеристики появились', !!f3 && f3.stats.atk>0);
 ok('уворот и крит показаны', typeof f3.stats.critPct==='number' && typeof f3.stats.dodgePct==='number');
 ok('предметы арсенала ещё скрыты', f3.gear===undefined);

 console.log('\n[6] Ур.4 — видно предметы арсенала врага');
 legs['LB'].arsenal={}; 
 battle.gear=battle.gear||{}; battle.gear[E1.id]=[c.LEGION_SHOP_ITEMS[0].id]; db.save('battles');
 legs['LA'].battleBuildings={intel:4}; db.save('legions');
 st=state();
 const f4=st.allCombatants.filter(x=>x.side!==st.mySide).find(f=>f.userId===E1.id);
 ok('арсенал врага виден', Array.isArray(f4.gear) && f4.gear.length===1);
 eq('название предмета', f4.gear[0].name, c.LEGION_SHOP_ITEMS[0].name);
 ok('постройки врага ещё скрыты', state().enemyBuildings===null);

 console.log('\n[7] Ур.5 — видны постройки вражеского легиона');
 legs['LA'].battleBuildings={intel:5}; db.save('legions');
 st=state();
 ok('список построек врага пришёл', Array.isArray(st.enemyBuildings));
 eq('имя вражеского легиона', st.enemyLegionName, 'Браво');
 const fort=st.enemyBuildings.find(x=>x.id==='fortress');
 eq('уровень Бастиона врага виден', fort.level, 4);

 console.log('\n[8] После начала боя разведка не нужна — все видят всех');
 legs['LA'].battleBuildings={}; db.save('legions');
 battle.phase='active'; battle.activeEndsAt=Date.now()+3600000; db.save('battles');
 st=state();
 eq('в активном бою разведка отключена', st.intelActive, false);
 eq('враги видны без построек', st.allCombatants.filter(x=>x.side!==st.mySide).length, 2);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
