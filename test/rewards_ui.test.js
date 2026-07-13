// jsdom-рендер: баннер наград на главном + раздел «Система» в почте.
const assert=require('assert'); const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>',{url:'http://localhost/'});
global.window=dom.window; global.document=dom.window.document; global.localStorage=dom.window.localStorage; global.location=dom.window.location;
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(file,name){ let c=fs.readFileSync(__dirname+'/../'+file,'utf8'); c+=`\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`; eval(c); return globalThis.__x; }
global.UI=load('public/js/ui.js','UI'); global.API=load('public/js/api.js','API');
UI.toast=()=>{}; UI.confirm=async()=>true;
global.App=load('public/js/app.js','App');
App.refreshMe=async()=>{}; App.rerender=()=>{}; App.go=()=>{};
load('public/js/screens/core.js','App'); load('public/js/screens/social.js','App');

const rewardsUnclaimed=[{id:'r1',from:'Система',title:'🥇 Итоги недели — 1 место',reason:'1 место в категории «Победы»',reward:{gold:500,tokens:3},rewardText:['🪙 500','🎖 3'],createdAt:Date.now(),claimed:false}];
const rewardsMixed=[rewardsUnclaimed[0],{id:'r2',from:'Система',title:'Старая награда',reason:'уже забрано',reward:{dollars:1000},rewardText:['💵 1 000'],createdAt:Date.now()-1000,claimed:true}];

let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};

(async()=>{
 const c=document.getElementById('content');

 console.log('\n[1] Главный экран: баннер наград с «Забрать»');
 App.me=JSON.parse(fs.readFileSync(__dirname+'/fixtures/me_payload.json','utf8'));
 API.get=async(url)=>{ if(url==='/api/rewards') return {rewards:rewardsUnclaimed,pending:1}; if(url==='/api/news') return {posts:[]}; return {}; };
 await App.screens.home(c);
 ok('баннер «Награды» показан', /🎁 Награды/.test(c.innerHTML));
 ok('видно название награды', /Итоги недели/.test(c.innerHTML));
 ok('есть кнопка «Забрать» с data-claim-reward', c.querySelectorAll('[data-claim-reward]').length===1);

 console.log('\n[2] Клик «Забрать» дёргает API claim');
 let claimed=null;
 API.post=async(url)=>{ claimed=url; return {rewardText:['🪙 500','🎖 3']}; };
 c.querySelector('[data-claim-reward]').click();
 await new Promise(r=>setTimeout(r,10));
 ok('вызван /api/rewards/r1/claim', claimed==='/api/rewards/r1/claim');

 console.log('\n[3] Почта: раздел «Система» с забрать/удалить');
 API.get=async(url)=>{ if(url==='/api/rewards') return {rewards:rewardsMixed,pending:1}; if(url==='/api/mail') return {threads:[]}; return {}; };
 await App.screens.mail(c);
 ok('раздел «Система» есть', /📨 Система/.test(c.innerHTML));
 ok('незабранная → кнопка «Забрать»', c.querySelectorAll('[data-claim-reward]').length===1);
 ok('забранная → кнопка «Удалить»', c.querySelectorAll('[data-del-reward]').length===1);
 ok('бейдж «к получению» показан', /к получению/.test(c.innerHTML));

 console.log('\n[4] Удаление письма-награды дёргает API delete');
 let deleted=null;
 API.post=async(url)=>{ deleted=url; return {ok:true}; };
 c.querySelector('[data-del-reward]').click();
 await new Promise(r=>setTimeout(r,10));
 ok('вызван /api/rewards/r2/delete', deleted==='/api/rewards/r2/delete');

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
