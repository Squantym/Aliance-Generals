// Тесты турниров легионов: расписание (автостарт/резолв/walkover) и
// автосетка (раунды с продвижением, бай, чемпион + приз-письмо). После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const tour=require('../dist/src/services/tournaments'),rewards=require('../dist/src/services/rewards');
const N=()=>[]; let passed=0;
const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);passed++;console.log('  ✅ '+n);};

// Победитель боя: форсим завершение конкретного live-матча
function finishBattle(battleId, side){ const b=db.load('battles',{})[battleId]; b.phase='done'; b.winningSide=side; b.finishReason='time';
  // очищаем activeBattle у легионов, как это делает finalizeBattle
  const legs=db.load('legions',{}); for(const l of Object.values(legs)){ if(l.activeBattle&&l.activeBattle.battleId===battleId) l.activeBattle=null; }
  db.save('battles'); db.save('legions'); }

(async()=>{
 await db.init();
 // 6 легионов, у каждого по бойцу
 const legs=db.load('legions',{}); const uid=[];
 for(let i=1;i<=6;i++){ await auth.register('Боец'+i,'password1',`p${i}@a.com`,'ru','1.1.1.'+i);
   const usr=Object.values(player.users()).find(x=>x.name==='Боец'+i); uid.push(usr.id);
   legs['L'+i]={id:'L'+i,name:'Легион'+i,leaderId:usr.id,members:[usr.id],activeBattle:null,pendingChallenge:null,arsenal:{},battleBuildings:{},requests:[]};
   usr.legionId='L'+i;
 }
 // пустой легион (без бойцов) для проверки walkover
 legs['LE']={id:'LE',name:'Пустой',leaderId:null,members:[],activeBattle:null,pendingChallenge:null,arsenal:{},battleBuildings:{},requests:[]};
 db.save('legions'); db.save('users');
 const admin=Object.values(player.users()).find(x=>x.name==='Боец1'); // первый = админ

 console.log('\n[1] РАСПИСАНИЕ: матч в прошлом автостартует по тику');
 const past=Date.now()-1000;
 const r1=tour.create(admin,{name:'Кубок',type:'scheduled',matches:[{legionAId:'L1',legionBId:'L2',startAt:past}]},N());
 tour.tick();
 let t=tour.view(r1.id).tournament;
 eq('матч перешёл в live', t.matches[0].status,'live');
 ok('назначен battleId', !!t.matches[0].battleId);

 console.log('\n[2] РАСПИСАНИЕ: завершение боя резолвит матч и турнир');
 finishBattle(t.matches[0].battleId,'B'); // победил легион B (L2)
 tour.tick();
 t=tour.view(r1.id).tournament;
 eq('матч done', t.matches[0].status,'done');
 eq('победитель — L2', t.matches[0].winnerId,'L2');
 eq('турнир завершён', t.status,'finished');

 console.log('\n[3] РАСПИСАНИЕ: walkover против пустого легиона');
 const r2=tour.create(admin,{name:'Вокабуляр',type:'scheduled',matches:[{legionAId:'L3',legionBId:'LE',startAt:past}]},N());
 tour.tick();
 t=tour.view(r2.id).tournament;
 eq('матч с пустым — сразу done', t.matches[0].status,'done');
 eq('walkover победитель L3', t.matches[0].winnerId,'L3');
 eq('пометка walkover', t.matches[0].note,'walkover');

 console.log('\n[4] СЕТКА: 4 легиона → раунд 1 (2 матча), автостарт');
 const b1=tour.create(admin,{name:'Гран-при',type:'bracket',legionIds:['L1','L2','L3','L4'],intervalMinutes:1,firstStartAt:past,prizeGold:1000},N());
 tour.tick();
 t=tour.view(b1.id).tournament;
 eq('создан 1 раунд', t.rounds.length,1);
 eq('в раунде 2 матча', t.rounds[0].matches.length,2);
 ok('оба матча live', t.rounds[0].matches.every(m=>m.status==='live'));

 console.log('\n[5] СЕТКА: завершаем раунд 1 → строится раунд 2 из победителей');
 for(const m of t.rounds[0].matches) finishBattle(m.battleId,'A'); // всегда побеждает A
 tour.tick();
 t=tour.view(b1.id).tournament;
 eq('появился раунд 2', t.rounds.length,2);
 eq('в раунде 2 один матч (финал)', t.rounds[1].matches.length,1);
 ok('раунд 2 ещё не стартовал (ждёт интервал)', t.rounds[1].startedAt===0);

 console.log('\n[6] СЕТКА: наступил интервал → финал стартует, победа → чемпион + приз');
 // приблизим старт финала
 { const tt=db.load('tournaments',{})[b1.id]; tt.rounds[1].startAt=Date.now()-1000; tt.rounds[1].matches.forEach(m=>m.startAt=Date.now()-1000); db.save('tournaments'); }
 tour.tick();
 t=tour.view(b1.id).tournament;
 eq('финал live', t.rounds[1].matches[0].status,'live');
 finishBattle(t.rounds[1].matches[0].battleId,'A');
 tour.tick();
 t=tour.view(b1.id).tournament;
 eq('турнир завершён', t.status,'finished');
 ok('чемпион определён', !!t.championId);
 // приз-письмо чемпиону
 const champLeader=Object.values(player.users()).find(x=>x.legionId===t.championId);
 const champLetters=rewards.listFor(champLeader).filter(r=>!r.claimed && r.reward.gold===1000);
 ok('чемпион получил приз-письмо 1000 золота', champLetters.length>=1);

 console.log('\n[7] СЕТКА: нечётное число (3) → бай в раунде 1');
 const b2=tour.create(admin,{name:'Триал',type:'bracket',legionIds:['L1','L2','L3'],intervalMinutes:1,firstStartAt:past},N());
 tour.tick();
 t=tour.view(b2.id).tournament;
 const byeMatch=t.rounds[0].matches.find(m=>!m.legionBId);
 ok('есть матч-бай (без соперника)', !!byeMatch);
 eq('бай сразу done', byeMatch.status,'done');
 eq('бай-победитель прошёл', byeMatch.note,'bye');

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
