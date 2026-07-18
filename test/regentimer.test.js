// Таймер восстановления, показываемый игроку, должен учитывать трофеи:
// раньше DTO отдавал базовые интервалы, и игрок думал, что трофей не работает.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),c=require('../dist/config/gameConfig');
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};
const near=(n,a,b,d)=>{assert.ok(Math.abs(a-b)<=d,`❌ ${n}: ${a} не ≈ ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Тест','password1','a@a.com','ru','1.1.1.1');
 const U=Object.values(player.users()).find(x=>x.name==='Тест');
 U.skills.energy=600; U.skills.health=600; U.skills.ammo=600; db.save('users');

 const toNext = (res, tr) => {
   U.trophies = tr || {}; U.effects = [];
   U.res[res].cur = 1; U.res[res].t = Date.now();   // только что был тик
   return player.mePayload(U).res[res].toNextSec;
 };

 console.log('\n[1] Таймер энергии учитывает «Логистику»');
 const en0 = toNext('en', null);
 const en5 = toNext('en', { logistics: 5 });
 const en10 = toNext('en', { logistics: 10 });
 console.log(`     энергия: без ${en0}с → ур.5 ${en5}с → ур.10 ${en10}с`);
 eq('база = 180 сек', en0, 180);
 near('ур.5 ≈ −37.5% (≈113с)', en5, 113, 2);
 near('ур.10 ≈ −75% (≈45с)', en10, 45, 2);

 console.log('\n[2] Таймер HP учитывает «Полевую реанимацию»');
 const hp0 = toNext('hp', null), hp10 = toNext('hp', { medunit: 10 });
 console.log(`     HP: без ${hp0}с → ур.10 ${hp10}с`);
 eq('база HP = 180', hp0, 180);
 near('HP ур.10 ≈ 45с', hp10, 45, 2);

 console.log('\n[3] Таймер боеприпасов учитывает «Боевую логистику»');
 const am0 = toNext('am', null), am10 = toNext('am', { ammo_logi: 10 });
 console.log(`     патроны: без ${am0}с → ур.10 ${am10}с`);
 near('патроны ур.10 ≈ 45с', am10, 45, 2);

 console.log('\n[4] Таймер согласован с реальным накоплением');
 // за (базовый интервал) с трофеем ур.10 должно накопиться в 4 раза больше тиков
 U.trophies = { logistics: 10 }; U.effects = [];
 U.res.en.cur = 0; U.res.en.t = Date.now() - 180000; // ровно базовый интервал
 player.refresh(U);
 const withTrophy = Math.floor(U.res.en.cur);
 U.trophies = {}; U.res.en.cur = 0; U.res.en.t = Date.now() - 180000;
 player.refresh(U);
 const without = Math.floor(U.res.en.cur);
 console.log(`     за 3 мин: без трофея ${without}, с трофеем ${withTrophy}`);
 ok('с трофеем накопилось заметно больше', withTrophy > without * 3);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
