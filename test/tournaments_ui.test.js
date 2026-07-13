// jsdom-тест админ-панели турниров: режимы, формы создания, список.
const assert=require('assert'); const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>',{url:'http://localhost/'});
global.window=dom.window; global.document=dom.window.document; global.localStorage=dom.window.localStorage; global.location=dom.window.location;
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(file,name){ let c=fs.readFileSync(__dirname+'/../'+file,'utf8'); c+=`\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`; eval(c); return globalThis.__x; }
global.UI=load('public/js/ui.js','UI'); global.API=load('public/js/api.js','API');
UI.toast=()=>{}; UI.confirm=async()=>true;
global.Admin=load('public/js/admin.js','Admin');

const legions=[{id:'L1',name:'Альфа',members:3},{id:'L2',name:'Браво',members:2},{id:'L3',name:'Чарли',members:1},{id:'L4',name:'Дельта',members:4}];
const tournaments=[{id:'T1',name:'Кубок',type:'bracket',status:'running',createdAt:Date.now(),championName:null,roundCount:2,participantCount:4},
                   {id:'T2',name:'Спринт',type:'scheduled',status:'finished',createdAt:Date.now(),championName:'Альфа',matchCount:1}];
let posted=[];
API.get=async(url)=>{ if(url==='/api/admin/tournaments/legions') return {legions}; if(url==='/api/admin/tournaments') return {tournaments}; if(url.startsWith('/api/admin/tournaments/')) return {tournament:{id:'T1',name:'Кубок',type:'bracket',rounds:[{n:1,startedAt:Date.now(),matches:[{legionAName:'Альфа',legionBName:'Браво',status:'done',winnerName:'Альфа'}]}],championName:null}}; return {}; };
API.post=async(url,body)=>{ posted.push({url,body}); return {}; };

let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const wait=()=>new Promise(r=>setTimeout(r,15));

(async()=>{
 const c=document.getElementById('content');

 console.log('\n[1] Панель турниров: 3 режима + список');
 Admin._trnMode='quick';
 await Admin.renderTournament(c);
 ok('есть переключатели режимов', c.querySelectorAll('[data-trn-mode]').length===3);
 ok('список турниров показан', /Кубок/.test(c.innerHTML) && /Спринт/.test(c.innerHTML));
 ok('чемпион завершённого показан', /🏆 Альфа/.test(c.innerHTML));
 ok('быстрый бой: 2 селекта + старт', !!document.getElementById('q-a')&&!!document.getElementById('q-b')&&!!document.getElementById('q-go'));

 console.log('\n[2] Быстрый бой отправляет /api/admin/legion/battle');
 posted=[]; document.getElementById('q-b').selectedIndex=1;
 document.getElementById('q-go').click(); await wait();
 ok('вызван legion/battle', posted.some(p=>p.url==='/api/admin/legion/battle'));

 console.log('\n[3] Режим «Расписание»: добавление матча и создание');
 Admin._trnMode='sched'; await Admin.renderTournament(c);
 ok('форма расписания есть', !!document.getElementById('s-name'));
 ok('первый матч-ряд добавлен', c.querySelectorAll('.trn-match-row').length===1);
 document.getElementById('s-add').click();
 ok('после «Добавить» два ряда', c.querySelectorAll('.trn-match-row').length===2);
 // выставим у обоих рядов разные легионы
 c.querySelectorAll('.trn-match-row').forEach(r=>{ r.querySelector('.tm-a').selectedIndex=0; r.querySelector('.tm-b').selectedIndex=1; });
 posted=[]; document.getElementById('s-name').value='Мой турнир';
 document.getElementById('s-go').click(); await wait();
 const sched=posted.find(p=>p.url==='/api/admin/tournaments/create');
 ok('создание отправлено', !!sched);
 ok('тип scheduled', sched.body.type==='scheduled');
 ok('передано 2 матча', sched.body.matches.length===2);

 console.log('\n[4] Режим «Автосетка»: выбор легионов и создание');
 Admin._trnMode='bracket'; await Admin.renderTournament(c);
 ok('чекбоксы легионов есть', c.querySelectorAll('.b-leg').length===4);
 const boxes=c.querySelectorAll('.b-leg'); boxes[0].checked=true; boxes[1].checked=true; boxes[2].checked=true;
 document.getElementById('b-interval').value='15'; document.getElementById('b-name').value='Гран-при';
 posted=[]; document.getElementById('b-go').click(); await wait();
 const br=posted.find(p=>p.url==='/api/admin/tournaments/create');
 ok('создание автосетки отправлено', !!br);
 ok('тип bracket', br.body.type==='bracket');
 ok('3 легиона выбрано', br.body.legionIds.length===3);
 ok('интервал 15', String(br.body.intervalMinutes)==='15');

 console.log('\n[5] Отмена и подробности турнира');
 Admin._trnMode='quick'; await Admin.renderTournament(c);
 ok('кнопка отмены у идущего турнира', c.querySelectorAll('[data-trn-cancel]').length===1);
 posted=[]; c.querySelector('[data-trn-cancel]').click(); await wait();
 ok('вызвана отмена', posted.some(p=>/\/cancel$/.test(p.url)));
 c.querySelector('[data-trn-view]').click(); await wait();
 ok('подробности раскрылись', /Раунд 1/.test(c.innerHTML));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
