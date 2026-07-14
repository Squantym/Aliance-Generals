// Тест: «авто-война» заменена интерактивным боем. По истечении срока
// resolveWars запускает systemStartBattle (подготовка 10 мин, участие),
// а НЕ авторешает по мощи. После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),legion=require('../dist/src/services/legion'),lb=require('../dist/src/services/legionBattle');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Лидер1','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Лидер2','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const u1=Object.values(us).find(x=>x.name==='Лидер1'), u2=Object.values(us).find(x=>x.name==='Лидер2');
 const legs=db.load('legions',{});
 legs['LA']={id:'LA',name:'Альфа',leaderId:u1.id,members:[u1.id],arsenal:{},battleBuildings:{},requests:[],treasury:0,warHistory:[]};
 legs['LB']={id:'LB',name:'Браво',leaderId:u2.id,members:[u2.id],arsenal:{},battleBuildings:{},requests:[],treasury:0,warHistory:[]};
 u1.legionId='LA'; u2.legionId='LB'; db.save('legions'); db.save('users');

 console.log('\n[1] Объявление боя ставит таймер (через 1 час)');
 const r=legion.declareWar(u1,'LB',N());
 ok('battleAt в будущем (~1 час)', r.battleAt > Date.now()+50*60000);
 const L=db.load('legions',{});
 ok('у атакующего роль attacker', L.LA.war && L.LA.war.role==='attacker');
 ok('у защитника роль defender', L.LB.war && L.LB.war.role==='defender');

 console.log('\n[2] До срока бой не начинается');
 legion.resolveWars();
 ok('activeBattle ещё нет', !db.load('legions',{}).LA.activeBattle);

 console.log('\n[3] По истечении срока — ИНТЕРАКТИВНЫЙ бой (не автобой)');
 // подводим время: ставим battleAt в прошлое
 { const g=db.load('legions',{}); g.LA.war.battleAt=Date.now()-1000; g.LB.war.battleAt=Date.now()-1000; db.save('legions'); }
 legion.resolveWars();
 const g=db.load('legions',{});
 ok('у Альфы появился активный бой (prep)', !!g.LA.activeBattle);
 ok('у Браво появился активный бой (prep)', !!g.LB.activeBattle);
 eq('оба ссылаются на один бой', g.LA.activeBattle.battleId, g.LB.activeBattle.battleId);
 const battle=db.load('battles',{})[g.LA.activeBattle.battleId];
 eq('бой в фазе подготовки', battle.phase, 'prep');
 ok('подготовка ~10 минут', battle.prepEndsAt - battle.startedAt >= 9*60000);
 ok('война очищена (заменена боем)', !g.LA.war && !g.LB.war);

 console.log('\n[4] Автобоя НЕТ: нет авто-итога по мощи');
 ok('нет записи авто-итога в warHistory', (g.LA.warHistory||[]).length===0);
 eq('казна не тронута авторешением', g.LB.treasury||0, 0);

 console.log('\n[5] Игроки могут участвовать: бой joinable, идёт подготовка');
 lb.joinBattle(u1,'assault',N());
 const st=legion.battleState(u1).battle;
 eq('фаза prep для игрока', st.phase, 'prep');
 ok('игрок стал бойцом (может участвовать)', !!st.me);
 ok('характеристики подготовки отдаются', !!st.myStats);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
