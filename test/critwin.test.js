// Правило исхода: побеждает тот, кто нанёс БОЛЬШЕ урона.
//  • крит слабого игрока переворачивает бой;
//  • апсет 5–10% топит сильнейшего;
//  • ситуации «нанёс больше, но проиграл» не существует.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const battle=require('../dist/src/services/battle'),c=require('../dist/config/gameConfig');
const N=()=>[]; let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Слабый','password1','a@a.com','ru','1.1.1.1');
 await auth.register('Сильный','password1','b@b.com','ru','1.1.1.2');
 const us=player.users();
 const W=Object.values(us).find(x=>x.name==='Слабый'), S=Object.values(us).find(x=>x.name==='Сильный');
 W.level=200; S.level=200;
 W.units={ [c.UNITS[10].id]:{0:50,1:0,2:0} };
 S.units={ [c.UNITS[13].id]:{0:50,1:0,2:0} };
 db.save('users');
 ok('расстановка верна: слабый действительно слабее',
    player.totalPower(W,'atk').power < player.totalPower(S,'def').power);

 function run(n, A, T, opts){
   let wins=0, moreLost=0, lessWon=0, critWins=0, crits=0;
   A.skills.cruelty=opts.cruelty||0; A.skills.agility=opts.agility||0; A.trophies=opts.tr||{}; A.effects=[];
   T.skills.cruelty=0; T.skills.agility=opts.tgtAgility||0; T.trophies={}; T.effects=[];
   for(let i=0;i<n;i++){
     A.lastAttackAt=0; A.pendingFatality=null; A.pendingBankHack=null; A.pendingMineDefuse=null;
     const mx=player.maxima(A); A.res.hp.cur=mx.hp; A.res.am.cur=mx.am; A.res.en.cur=mx.en;
     T.res.hp.cur=player.maxima(T).hp;
     const r=battle.attack(A,T.id,N());
     if(r.win) wins++;
     if(r.crit){ crits++; if(r.win) critWins++; }
     if(r.dealt>r.received && !r.win) moreLost++;
     if(r.dealt<r.received && r.win) lessWon++;
   }
   return {wins,moreLost,lessWon,critWins,crits,n};
 }

 console.log('\n[1] Главное правило: кто нанёс больше урона — тот и выиграл');
 const a=run(2500,W,S,{cruelty:100,tr:{license:10}});
 eq('НИ ОДНОГО случая «нанёс больше, но проиграл»', a.moreLost, 0);
 eq('НИ ОДНОГО случая «нанёс меньше, но выиграл»', a.lessWon, 0);

 console.log('\n[2] Крит слабого игрока переворачивает бой');
 const noCrit=run(2500,W,S,{cruelty:0});
 const maxCrit=run(2500,W,S,{cruelty:100,tr:{license:10}});
 console.log(`     побед слабого: без крита ${(noCrit.wins/noCrit.n*100).toFixed(1)}% → с макс. критом ${(maxCrit.wins/maxCrit.n*100).toFixed(1)}%`);
 ok('без крита слабый почти всегда проигрывает', noCrit.wins < noCrit.n*0.15);
 ok('с максимальным критом слабый выигрывает намного чаще', maxCrit.wins > noCrit.wins*3);
 ok('криты случались', maxCrit.crits > 0);
 ok('крит приводил к победе', maxCrit.critWins > 0);

 console.log('\n[3] Сильный без помех побеждает, кроме апсета 5–10%');
 const strong=run(3000,S,W,{cruelty:0});
 const lossRate=1-strong.wins/strong.n;
 console.log(`     сильный побеждает в ${(strong.wins/strong.n*100).toFixed(1)}% боёв (поражений ${(lossRate*100).toFixed(1)}%)`);
 ok('сильный побеждает в подавляющем большинстве', strong.wins > strong.n*0.85);
 ok('его поражения — это апсет, ~5–10% (допуск 3–14%)', lossRate>=0.03 && lossRate<=0.14);
 eq('и у сильного нет «нанёс больше, но проиграл»', strong.moreLost, 0);

 console.log('\n[4] Апсет сохранён в конфиге');
 eq('минимум 5%', c.BATTLE.DAMAGE_UPSET_MIN, 0.05);
 eq('максимум 10%', c.BATTLE.DAMAGE_UPSET_MAX, 0.10);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
