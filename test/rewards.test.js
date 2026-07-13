// Тест системы наград-писем: выдача, список, забор (начисление), удаление,
// а также сезонные награды через письмо. После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),rewards=require('../dist/src/services/rewards'),player=require('../dist/src/services/player');
const N=()=>[];
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Наградной','password1','r@a.com','ru','1.1.1.1');
 const usr=Object.values(player.users()).find(x=>x.name==='Наградной');
 const gold0=usr.gold, tok0=usr.tokens||0, dol0=usr.dollars;

 console.log('\n[1] Выдача награды-письма');
 rewards.grant(usr.id,{title:'🥇 Итоги недели',reason:'1 место в категории «Победы»',reward:{gold:500,tokens:3}});
 let list=rewards.listFor(usr);
 eq('одно письмо-награда', list.length,1);
 eq('не забрано', list[0].claimed,false);
 eq('pending=1', rewards.pendingCount(usr),1);
 ok('есть человекочитаемое описание', Array.isArray(list[0].rewardText)&&list[0].rewardText.length===2);
 ok('золото ЕЩЁ не начислено (награда ждёт получения)', usr.gold===gold0);

 console.log('\n[2] Забрать → начисляется');
 rewards.claim(usr,list[0].id,N());
 eq('золото начислено (+500)', usr.gold, gold0+500);
 eq('жетоны начислены (+3)', (usr.tokens||0), tok0+3);
 eq('pending=0 после забора', rewards.pendingCount(usr),0);
 list=rewards.listFor(usr);
 eq('письмо помечено забранным', list[0].claimed,true);

 console.log('\n[3] Повторный забор запрещён');
 let threw=false; try{ rewards.claim(usr,list[0].id,N()); }catch(e){ threw=true; }
 ok('повторный claim бросает ошибку', threw);
 eq('золото не удвоилось', usr.gold, gold0+500);

 console.log('\n[4] Удаление: незабранную нельзя, забранную можно');
 rewards.grant(usr.id,{title:'Тест',reason:'ещё одна',reward:{dollars:1000}});
 const pending=rewards.listFor(usr).find(r=>!r.claimed);
 let threw2=false; try{ rewards.remove(usr,pending.id); }catch(e){ threw2=true; }
 ok('удаление незабранной запрещено', threw2);
 const claimed=rewards.listFor(usr).find(r=>r.claimed);
 rewards.remove(usr,claimed.id);
 ok('забранная удалена', !rewards.listFor(usr).some(r=>r.id===claimed.id));

 console.log('\n[5] Забор доллара начисляет деньги');
 rewards.claim(usr,pending.id,N());
 eq('доллары начислены (+1000)', usr.dollars, dol0+1000);

 console.log('\n[6] Сезонный ролловер выдаёт награды письмом (не мгновенно)');
 // Дадим игроку метрику и форсируем завершение недели
 const seasons=require('../dist/src/services/seasons');
 seasons.onWin(usr); seasons.onWin(usr);  // 2 победы → попадёт в топ
 const beforeGold=usr.gold;
 seasons.adminForceRollover(usr, N());
 ok('после ролловера золото НЕ начислено сразу', usr.gold===beforeGold);
 const seasonLetters=rewards.listFor(usr).filter(r=>!r.claimed);
 ok('появились награды-письма за сезон', seasonLetters.length>0);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
