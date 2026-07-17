// Трофеи скорости восстановления: −75% времени на макс. уровне, для всех
// трёх ресурсов (энергия / боеприпасы / HP). Плюс наличие картинок легиона.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const trophies=require('../dist/src/services/trophies'),c=require('../dist/config/gameConfig');
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Тест','password1','a@a.com','ru','1.1.1.1');
 const U=Object.values(player.users()).find(x=>x.name==='Тест');
 // Большие максимумы, чтобы ресурсы не упирались в потолок за время замера
 U.skills.energy=200; U.skills.ammo=200; U.skills.health=200; db.save('users');

 console.log('\n[1] Трофеи заданы на −7.5% за уровень → 75% на максимуме');
 for (const [id,key,res] of [['logistics','regen_en','энергии'],['ammo_logi','regen_am','боеприпасов'],['medunit','regen_hp','HP']]) {
   const def=c.TROPHIES.find(t=>t.id===id);
   ok(`трофей «${id}» (${res}) существует`, !!def);
   eq(`${id}: −7.5% за уровень`, def.perLvl, 7.5);
   eq(`${id}: apply=${key}`, def.apply, key);
   U.trophies={[id]:c.TROPHY_MAX_LEVEL};
   eq(`${id}: на макс. уровне −75% времени`, trophies.discountPct(U,key), 75);
 }
 U.trophies={};
 for (const key of ['regen_en','regen_am','regen_hp']) eq(`без трофея скидки нет (${key})`, trophies.discountPct(U,key), 0);

 console.log('\n[2] Замер: ресурс восстанавливается в 4 раза быстрее (−75% времени)');
 const WIN=10*60*1000;
 const gain=(tr)=>{ U.trophies=tr||{}; U.effects=[];
   U.res.en.cur=0; U.res.en.t=Date.now()-WIN;
   U.res.am.cur=0; U.res.am.t=Date.now()-WIN;
   U.res.hp.cur=0; U.res.hp.t=Date.now()-WIN;
   player.refresh(U);
   return {en:Math.floor(U.res.en.cur), am:Math.floor(U.res.am.cur), hp:Math.floor(U.res.hp.cur)}; };
 const base=gain(null);
 ok('база: что-то восстановилось', base.en>0 && base.am>0 && base.hp>0);
 const M=c.TROPHY_MAX_LEVEL;
 const e=gain({logistics:M}), a=gain({ammo_logi:M}), h=gain({medunit:M});
 const near4=(x)=>x>=3.5 && x<=4.6;
 console.log(`     энергия ×${(e.en/base.en).toFixed(2)}, патроны ×${(a.am/base.am).toFixed(2)}, HP ×${(h.hp/base.hp).toFixed(2)}`);
 ok('энергия ≈ в 4 раза быстрее', near4(e.en/base.en));
 ok('боеприпасы ≈ в 4 раза быстрее', near4(a.am/base.am));
 ok('HP ≈ в 4 раза быстрее (новый трофей работает)', near4(h.hp/base.hp));

 console.log('\n[3] Трофеи независимы: свой ресурс, чужой не трогают');
 const onlyEn=gain({logistics:M});
 eq('«Логистика» не ускоряет HP', onlyEn.hp, base.hp);
 eq('«Логистика» не ускоряет боеприпасы', onlyEn.am, base.am);
 const onlyHp=gain({medunit:M});
 eq('«Полевая реанимация» не ускоряет энергию', onlyHp.en, base.en);

 console.log('\n[4] Картинки легиона на месте');
 const IMG=path.join(__dirname,'..','public','img','legion');
 for (const r of ['assault','guardian','medic']) ok(`иконка роли ${r}`, fs.existsSync(`${IMG}/roles/${r}.webp`));
 for (const b of c.LEGION_BATTLE_BUILDINGS) ok(`картинка постройки ${b.id}`, fs.existsSync(`${IMG}/buildings/${b.id}.webp`));
 for (const i of c.LEGION_SHOP_ITEMS) ok(`картинка предмета ${i.id}`, fs.existsSync(`${IMG}/arsenal/${i.id}.webp`));
 // Вес: картинки не должны раздувать загрузку
 const total=['roles','buildings','arsenal'].reduce((s,d)=>
   s+fs.readdirSync(`${IMG}/${d}`).reduce((x,f)=>x+fs.statSync(`${IMG}/${d}/${f}`).size,0),0);
 console.log(`     суммарный вес картинок: ${Math.round(total/1024)} KB`);
 ok('картинки лёгкие (< 400 KB суммарно)', total < 400*1024);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
