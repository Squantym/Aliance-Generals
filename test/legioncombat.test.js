// Тесты боя легиона: уворот (как в обычном бою, максимум 70%), крит с
// трофеем «Лицензия на убийство», восстановление ресурсов по отдельности.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const legion=require('../dist/src/services/legion'),lb=require('../dist/src/services/legionBattle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};
const near=(n,a,b,tol)=>{assert.ok(Math.abs(a-b)<=tol,`❌ ${n}: ${a} vs ${b} (±${tol})`);passed++;console.log(`  ✅ ${n} (${a})`);};

(async()=>{
 await db.init();
 await auth.register('Ата','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Защ','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const A=Object.values(us).find(x=>x.name==='Ата'), B=Object.values(us).find(x=>x.name==='Защ');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'A',leaderId:A.id,members:[A.id],arsenal:{},battleBuildings:{},requests:[]};
 legs['LB']={id:'LB',name:'B',leaderId:B.id,members:[B.id],arsenal:{},battleBuildings:{},requests:[]};
 A.legionId='LA'; B.legionId='LB';
 const unit=c.UNITS[10];
 A.units={[unit.id]:{0:200,1:0,2:0}}; B.units={[unit.id]:{0:200,1:0,2:0}};
 A.level=300; B.level=300;
 db.save('legions'); db.save('users');
 legion.systemStartBattle('LA','LB');
 lb.joinBattle(A,'assault',N()); lb.joinBattle(B,'assault',N());
 const bid=db.load('legions',{}).LA.activeBattle.battleId;
 const battle=db.load('battles',{})[bid];
 const cA=battle.combatants[A.id], cB=battle.combatants[B.id];

 console.log('\n[1] Подготовка: цены восстановления по каждому ресурсу отдельно');
 const st=legion.battleState(A).battle;
 ok('есть costs по ресурсам', st.myStats && st.myStats.costs);
 eq('цена HP = аптечка', st.myStats.costs.hp, c.MARKET_ITEM_BY_ID.medkit.gold);
 eq('цена энергии = энергетик', st.myStats.costs.energy, c.MARKET_ITEM_BY_ID.energy.gold);
 eq('цена патронов = цинк', st.myStats.costs.ammo, c.MARKET_ITEM_BY_ID.ammo.gold);

 console.log('\n[2] Восстановление ОДНОГО ресурса тратит только его цену');
 const mx=player.maxima(A);
 A.res.hp.cur=1; A.res.en.cur=1; A.res.am.cur=1; A.gold=1000; db.save('users');
 legion.restoreForBattle(A,'hp',N());
 eq('HP восстановлено', Math.floor(A.res.hp.cur), Math.floor(mx.hp));
 eq('списана только цена аптечки', A.gold, 1000-c.MARKET_ITEM_BY_ID.medkit.gold);
 ok('энергия НЕ тронута', Math.floor(A.res.en.cur)===1);
 ok('патроны НЕ тронуты', Math.floor(A.res.am.cur)===1);

 console.log('\n[3] Полный ресурс восстановить нельзя (кнопки не будет)');
 let threw=false; try{ legion.restoreForBattle(A,'hp',N()); }catch(e){ threw=/полн/i.test(e.message); }
 ok('повторное восстановление полного HP отклонено', threw);
 legion.restoreForBattle(A,'ammo',N());
 eq('патроны восстановлены', Math.floor(A.res.am.cur), Math.floor(mx.am));

 console.log('\n[4] Без золота — отказ');
 A.res.en.cur=1; A.gold=0; db.save('users');
 let threw2=false; try{ legion.restoreForBattle(A,'energy',N()); }catch(e){ threw2=true; }
 ok('нет золота → ошибка', threw2);

 // ── Переводим бой в активную фазу для проверки урона ──
 battle.phase='active'; cA.direction=1; cB.direction=1; cB.hp=9e9; cB.maxHp=9e9; db.save('battles');
 const hit=()=>{ A.res.am.cur=999; cA.lastActionAt=0; cB.hp=9e9;
   const before=cB.hp; try{ lb.attack(A,B.id,N()); }catch(e){ return null; } return before-cB.hp; };

 console.log('\n[5] Уворот работает и совпадает с обычным боем (максимум 70%)');
 A.skills.cruelty=0; A.trophies={};
 const rate=(agility,ghost,n)=>{ B.skills.agility=agility;
   B.effects = ghost?[{id:'dodge_boost',type:'dodge_bonus',value:20,name:'Призрак',expiresAt:Date.now()+9e6}]:[];
   let d=0; for(let i=0;i<n;i++){ if(hit()===0) d++; } return d/n; };
 near('ловкость 0 → уворота нет (0%)', Math.round(rate(0,false,600)*100), 0, 1);
 near('ловкость 100 → 50% (потолок базы)', Math.round(rate(100,false,3000)*100), 50, 4);
 near('ловкость 100 + «Призрак» → 70%', Math.round(rate(100,true,3000)*100), 70, 4);
 const dmax=c.BATTLE.DODGE_MAX*100 + c.MARKET_ITEM_BY_ID.dodge_boost.effect.value;
 eq('формула совпадает с обычным боем: 50 + 20 = 70', dmax, 70);

 console.log('\n[6] Крит: трофей «Лицензия на убийство» ТЕПЕРЬ применяется');
 B.skills.agility=0; B.effects=[];
 A.skills.cruelty=100;   // максимальный шанс крита
 const maxDmg=(lic,n)=>{ A.trophies={license:lic}; let m=0; for(let i=0;i<n;i++){ const d=hit(); if(d>m) m=d; } return m; };
 const m0=maxDmg(0,3000), m5=maxDmg(5,3000), m10=maxDmg(10,3000);
 console.log(`     максимальный крит: без трофея ${m0}, ур.5 ${m5}, ур.10 ${m10}`);
 ok('без трофея крит как раньше (было 90 у игрока)', m0>0);
 ok('трофей ур.5 усиливает крит', m5 > m0*1.5);
 ok('трофей ур.10 усиливает ещё сильнее', m10 > m5);
 ok('с максимальным трофеем крит достигает ~180+', m10 >= 170);

 console.log('\n[7] Граната уворотом не обнуляется (иначе предмет бесполезен)');
 const src=fs.readFileSync(__dirname+'/../src/services/legionBattle.ts','utf8');
 ok('граната вызывает расчёт с allowDodge:false', /allowDodge: false/.test(src));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
