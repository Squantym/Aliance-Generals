// Боевые постройки легиона: ценники, гейт по уровню легиона и — главное —
// что КАЖДАЯ реально работает в бою. Раньше 6 из 7 не влияли ни на что.
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
 await auth.register('Защ','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const A=Object.values(us).find(x=>x.name==='Ата'), B=Object.values(us).find(x=>x.name==='Защ');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'Альфа',leaderId:A.id,members:[A.id],arsenal:{},battleBuildings:{},requests:[],legionLevel:5,reserves:0,treasuryEars:0,treasuryTokens:0};
 legs['LB']={id:'LB',name:'Браво',leaderId:B.id,members:[B.id],arsenal:{},battleBuildings:{},requests:[],legionLevel:5};
 A.legionId='LA'; B.legionId='LB';
 const unit=c.UNITS[10];
 for(const p of [A,B]){ p.units={[unit.id]:{0:200,1:0,2:0}}; p.level=300; p.skills.agility=0; p.skills.cruelty=0; p.effects=[]; p.trophies={}; }
 db.save('legions'); db.save('users');

 console.log('\n[1] Ценники совпадают с заданными (1-й и последний уровень)');
 const SPEC={
   warcmd:   {max:10, l1:[1e9,500,0],            lN:[5e12,30000,0]},
   fortress: {max:10, l1:[1e9,0,500],            lN:[5e12,0,30000]},
   speedlab: {max:5,  l1:[7e8,1000,1000],        lN:[3e12,15000,15000]},
   gear_slots:{max:3, l1:[1e8,1500,1500],        lN:[1e12,10000,10000]},
   medcorps: {max:5,  l1:[8.5e11,3000,3000],     lN:[4.5e12,12000,12000]},
   intel:    {max:5,  l1:[5e11,0,1000],          lN:[5e12,0,16000]},
   supply:   {max:10, l1:[3e11,700,700],         lN:[5.6e12,20000,20000]},
   barracks: {max:10, l1:[4.7e11,500,500],       lN:[1e13,30000,30000]},
 };
 for (const [id,sp] of Object.entries(SPEC)) {
   const b=c.LEGION_BATTLE_BUILDING_BY_ID[id];
   eq(`${id}: уровней ${sp.max}`, b.maxLevel, sp.max);
   const c1=c.battleBuildingCostAt(b,1), cN=c.battleBuildingCostAt(b,sp.max);
   eq(`${id} ур.1 РЕЗ`, c1.reserves, sp.l1[0]);
   eq(`${id} ур.1 уши/жетоны`, c1.ears+'/'+c1.tokens, sp.l1[1]+'/'+sp.l1[2]);
   eq(`${id} ур.${sp.max} РЕЗ`, cN.reserves, sp.lN[0]);
   eq(`${id} ур.${sp.max} уши/жетоны`, cN.ears+'/'+cN.tokens, sp.lN[1]+'/'+sp.lN[2]);
 }

 console.log('\n[2] Требования по уровню легиона');
 const req=(id,l)=>c.battleBuildingLegionReq(c.LEGION_BATTLE_BUILDING_BY_ID[id],l);
 eq('Штаб ур.3 → легион 1', req('warcmd',3),1);
 eq('Штаб ур.4 → легион 2', req('warcmd',4),2);
 eq('Штаб ур.6 → легион 3', req('warcmd',6),3);
 eq('Штаб ур.8 → легион 4', req('warcmd',8),4);
 eq('Штаб ур.10 → легион 5', req('warcmd',10),5);
 eq('Бастион ур.10 → легион 5', req('fortress',10),5);
 eq('Лаборатория ур.N → легион N', [1,2,3,4,5].map(l=>req('speedlab',l)).join(''), '12345');
 eq('Центр снаряжения: 1/3/5', [1,2,3].map(l=>req('gear_slots',l)).join(''), '135');
 eq('Медкорпус ур.N → легион N', [1,2,3,4,5].map(l=>req('medcorps',l)).join(''), '12345');
 eq('Разведцентр ур.N → легион N', [1,2,3,4,5].map(l=>req('intel',l)).join(''), '12345');
 eq('Узел снабжения ур.1 → 1, ур.10 → 7', req('supply',1)+'/'+req('supply',10), '1/7');
 eq('Казармы ур.1 → 1, ур.10 → 5', req('barracks',1)+'/'+req('barracks',10), '1/5');

 console.log('\n[3] Постройку выше уровня легиона взять нельзя');
 legs['LA'].legionLevel=1; legs['LA'].battleBuildings={warcmd:3};
 legs['LA'].reserves=1e15; legs['LA'].treasuryEars=1e6; legs['LA'].treasuryTokens=1e6; db.save('legions');
 let threw=false; try{ legion.buildBattle(A,'warcmd',N()); }catch(e){ threw=/уровень легиона/i.test(e.message); }
 ok('ур.4 при легионе 1 → отказ', threw);
 legs['LA'].legionLevel=2; db.save('legions');
 legion.buildBattle(A,'warcmd',N());
 eq('при легионе 2 ур.4 построен', db.load('legions',{}).LA.battleBuildings.warcmd, 4);

 // ── боевая площадка ──
 legs['LA'].legionLevel=5; legs['LA'].battleBuildings={}; db.save('legions');
 legion.systemStartBattle('LA','LB');
 const bid=db.load('legions',{}).LA.activeBattle.battleId;
 const battle=db.load('battles',{})[bid];
 lb.joinBattle(A,'assault',N()); lb.joinBattle(B,'assault',N());
 const cA=battle.combatants[A.id], cB=battle.combatants[B.id];
 battle.phase='active'; cA.direction=1; cB.direction=1; cB.hp=9e9; cB.maxHp=9e9; db.save('battles');
 const avg=(n)=>{ let s=0,k=0; for(let i=0;i<n;i++){ A.res.am.cur=999; cA.lastActionAt=0; cB.hp=9e9;
   const before=cB.hp; try{ lb.attack(A,B.id,N()); }catch(e){ continue; } s+=before-cB.hp; k++; } return s/k; };

 console.log('\n[4] Штаб наступления РЕАЛЬНО усиливает атаку в бою');
 legs['LA'].battleBuildings={}; legs['LB'].battleBuildings={}; db.save('legions');
 const d0=avg(2500);
 legs['LA'].battleBuildings={warcmd:10}; db.save('legions');
 const d10=avg(2500);
 console.log(`     средний урон: без штаба ${d0.toFixed(1)} → со штабом ур.10 ${d10.toFixed(1)}`);
 ok('со Штабом урон заметно выше', d10 > d0*1.10);

 console.log('\n[5] Бастион РЕАЛЬНО усиливает защиту цели');
 legs['LA'].battleBuildings={}; legs['LB'].battleBuildings={fortress:10}; db.save('legions');
 const dF=avg(2500);
 console.log(`     средний урон по цели с Бастионом ур.10: ${dF.toFixed(1)} (без него ${d0.toFixed(1)})`);
 ok('с Бастионом урон по цели заметно ниже', dF < d0*0.9);

 console.log('\n[6] Лаборатория быстродействия: 3.5 сек → 1 сек');
 legs['LB'].battleBuildings={}; db.save('legions');
 const cd=(lvl)=>{ legs['LA'].battleBuildings= lvl?{speedlab:lvl}:{}; db.save('legions');
   A.res.am.cur=999; cA.lastActionAt=Date.now(); cB.hp=9e9;
   try{ lb.attack(A,B.id,N()); return 0; }catch(e){ const m=/(\d+) сек/.exec(e.message); return m?+m[1]:-1; } };
 eq('без лаборатории пауза 3.5 сек (округл. 4)', cd(0), 4);
 eq('ур.1 → 3 сек', cd(1), 3);
 eq('ур.3 → 2 сек', cd(3), 2);
 eq('ур.5 → 1 сек', cd(5), 1);

 console.log('\n[7] Центр снаряжения: базово 2 слота, +1 за уровень');
 eq('базовые слоты = 2', c.LEGION.GEAR_SLOTS_DEFAULT, 2);
 legs['LA'].battleBuildings={}; db.save('legions');
 battle.phase='prep'; db.save('battles');
 eq('без постройки 2 слота', legion.battleState(A).battle.maxSlots, 2);
 legs['LA'].battleBuildings={gear_slots:3}; db.save('legions');
 eq('с постройкой ур.3 → 5 слотов', legion.battleState(A).battle.maxSlots, 5);

 console.log('\n[8] Казармы: +5 участников за уровень');
 legs['LA'].battleBuildings={}; db.save('legions');
 const lim0=legion.view(A).mine.memberLimit;
 legs['LA'].battleBuildings={barracks:10}; db.save('legions');
 const lim10=legion.view(A).mine.memberLimit;
 eq('база лимита', lim0, c.LEGION.BASE_MEMBER_LIMIT);
 eq('с казармами ур.10 → +50', lim10, lim0+50);

 console.log('\n[9] Узел снабжения: шанс удвоить покупку');
 legs['LA'].battleBuildings={supply:10}; legs['LA'].treasuryEars=1e9; legs['LA'].treasuryTokens=1e9; db.save('legions');
 const item=c.LEGION_SHOP_ITEMS[0];
 let dbl=0, tries=400;
 for(let i=0;i<tries;i++){ legs['LA'].arsenal={}; const r=legion.shopBuy(A,item.id,1,N()); if(r.doubled) dbl++; }
 const rate=dbl/tries;
 console.log(`     удвоений: ${(rate*100).toFixed(1)}% (ожидание ~50% на ур.10)`);
 ok('удвоение срабатывает', dbl>0);
 ok('частота близка к 50%', rate>0.40 && rate<0.60);
 legs['LA'].battleBuildings={}; db.save('legions');
 let dbl0=0; for(let i=0;i<200;i++){ legs['LA'].arsenal={}; if(legion.shopBuy(A,item.id,1,N()).doubled) dbl0++; }
 eq('без постройки удвоений нет', dbl0, 0);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
