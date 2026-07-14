// Тест наёмника аукциона: эффект помечается как merc с cmd_-id (даже поверх
// допинга того же типа), показывается в профиле и в списке holders. После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player'),market=require('../dist/src/services/market'),c=require('../dist/config/gameConfig');
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Игрок1','password1','p@a.com','ru','1.1.1.1');
 const usr=Object.values(player.users()).find(x=>x.name==='Игрок1');
 const berserk=c.COMMANDERS.find(x=>x.id==='berserk'); // +100% атаке, type atk_pct
 const now=Date.now();

 console.log('\n[1] Наёмник поверх ДОПИНГА того же типа → эффект помечается как merc');
 // даём допинг того же типа (atk_pct), как у Беатрис
 usr.effects.push({ id:'stim', type:'atk_pct', value:20, name:'Боевой стимулятор', expiresAt: now+3600000 });
 market.applyCommanderEffect(usr, berserk, now);
 const eff = usr.effects.find(e=>e.type==='atk_pct');
 ok('id стал cmd_ (не остался stim)', eff.id.startsWith('cmd_berserk_'));
 eq('commanderId проставлен', eff.commanderId, 'berserk');
 eq('merc=true', eff.merc, true);
 eq('имя — имя наёмника', eff.name, berserk.name);
 eq('значение = 100', eff.value, 100);

 console.log('\n[2] Профиль показывает наёмника (merc/commanderId), не допинг');
 const pv = player.publicProfile(usr, usr);
 const me = pv.activeEffects.find(e=>e.merc);
 ok('в профиле есть эффект-наёмник', !!me);
 eq('commanderId в профиле', me.commanderId, 'berserk');

 console.log('\n[3] Аукцион показывает текущего владельца (holders)');
 const av = market.auctionView();
 const holder = (av.holders||[]).find(h=>h.holderId===usr.id);
 ok('владелец наёмника есть в holders', !!holder);
 eq('имя наёмника в holders', holder.commanderName, berserk.name);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
