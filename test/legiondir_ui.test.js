// jsdom: таймер отсчёта перехода на плитках направлений + рейтинг/история казны.
const assert=require('assert'); const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div><div id="toasts"></div></body>',{url:'http://localhost/'});
Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,location:dom.window.location});
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(f,n){let c=fs.readFileSync(__dirname+'/../'+f,'utf8');c+=`\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`;eval(c);return globalThis.__x;}
global.UI=load('public/js/ui.js','UI');global.API=load('public/js/api.js','API');
let toasts=[]; UI.toast=(m)=>toasts.push(m); UI.confirm=async()=>true;
global.App=load('public/js/app.js','App');App.refreshMe=async()=>{};App.rerender=()=>{};App.go=()=>{};
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

const active=(moveCd)=>({
  phase:'active', mySide:'A', mySideName:'Альфа', enemyName:'Браво', secsLeft:600,
  me:{ userId:'x', role:'assault', roleName:'Штурмовик', hp:100, maxHp:100, ammo:10, energy:20,
       direction:1, gear:[], alive:true, stats:{dmgDealt:0} },
  cooldowns:{ action:0, move:moveCd, item:0 },
  allCombatants:[], log:[], arsenal:[], myGear:[], maxSlots:3,
  directions:[1,2,3,4,5].map(d=>({dir:d,name:['Гъадакьи','Улабахе','Бекъдахе','Асали','Кӏаречӏ'][d-1],allies:[],enemies:[]})),
  scores:{A:0,B:0} });

(async()=>{
 const win=document.createElement('div'); win.id='battle-window'; document.body.appendChild(win);

 console.log('\n[1] Идёт кулдаун → на плитках виден отсчёт');
 App._renderBattleContent(win, active(23));
 App._startActionCdTicker(active(23));
 const cds=[...win.querySelectorAll('[data-dir-cd]')];
 ok('плитки чужих направлений имеют элемент отсчёта', cds.length===4); // 5 минус текущее
 ok('отсчёт показывает секунды', cds.some(el=>/⏳ 23с/.test(el.textContent)));
 ok('плитки помечены как заблокированные', win.querySelectorAll('.bw-dir.cd').length===4);
 ok('в панели бойца тоже виден переход', /bw-cd-move/.test(win.innerHTML));

 console.log('\n[2] Клик по заблокированному направлению не шлёт запрос');
 let posted=null; API.post=async(u,b)=>{ posted={u,b}; return {}; };
 toasts=[];
 App._bindBattleWindowEvents(win, active(23));
 App._startActionCdTicker(active(23));
 win.querySelector('#bw-dir-3').onclick();
 await new Promise(r=>setTimeout(r,20));
 eq('запрос на сервер НЕ ушёл', posted, null);
 ok('игроку показано, сколько осталось', toasts.some(t=>/Переход недоступен/.test(t)));

 console.log('\n[3] Кулдаун истёк → переход работает');
 App._renderBattleContent(win, active(0));
 App._startActionCdTicker(active(0));
 ok('отсчёт скрыт', [...win.querySelectorAll('[data-dir-cd]')].every(el=>el.hidden));
 ok('плитки не заблокированы', win.querySelectorAll('.bw-dir.cd').length===0);
 App._bindBattleWindowEvents(win, active(0));
 posted=null;
 win.querySelector('#bw-dir-3').onclick();
 await new Promise(r=>setTimeout(r,20));
 ok('запрос ушёл на сервер', posted && posted.u==='/api/legion/battle/direction');
 eq('с верным направлением', posted.b.direction, 3);
 if (App._bwCdTimer) clearInterval(App._bwCdTimer);

 console.log('\n[4] Казна: рейтинг вкладов и история');
 load('public/js/screens/social.js','App');
 // Экран легиона берёт данные из ДВУХ эндпоинтов: /api/group/legion (состав)
 // и /api/legion (клановая панель с казной). Используем реальные фикстуры.
 const groupFx=JSON.parse(fs.readFileSync(__dirname+'/fixtures/group_view_legion.json','utf8'));
 const legFx=JSON.parse(fs.readFileSync(__dirname+'/fixtures/legion_view_challenger.json','utf8'));
 legFx.contributions=[ {userId:'x',name:'Жертва',ears:3000,tokens:10,reserves:5},
                       {userId:'g',name:'Защитник',ears:1052,tokens:0,reserves:0} ];
 legFx.treasuryHistory=[ {at:Date.now()-120000,name:'Защитник',ears:1052,tokens:0,reserves:0},
                         {at:Date.now()-3600000,name:'Жертва',ears:3000,tokens:10,reserves:0} ];
 App.me=JSON.parse(fs.readFileSync(__dirname+'/fixtures/me_payload.json','utf8'));
 API.get=async(url)=>{
   if(url==='/api/group/legion') return groupFx;
   if(url==='/api/legion') return { mine: legFx };
   return {};
 };
 // Рейтинг вкладов теперь на ОТДЕЛЬНОЙ странице (вкладка contrib) и
 // тянется своим запросом /api/legion/contributions
 API.get=async(url)=>{
   if(url==='/api/group/legion') return groupFx;
   if(url==='/api/legion') return { mine: legFx };
   if(url==='/api/legion/contributions') return {
     legionName:'Браво', weekStart:Date.now(),
     all:[ {userId:'x',name:'Жертва',ears:3000,tokens:10,reserves:5,left:false},
           {userId:'g',name:'Ушедший',ears:1052,tokens:0,reserves:0,left:true} ],
     week:[ {userId:'x',name:'Жертва',ears:500,tokens:0,reserves:0,left:false} ],
     history:[] };
   return {};
 };
 const c2=document.getElementById('content');
 App._legionTab='treasury';
 let err=null; try{ await App.screens.legion(c2); }catch(e){ err=e; }
 if(err) console.log('    ОШИБКА: '+String(err.stack||err).split('\n')[0]);
 ok('казна отрисовалась', !err);
 ok('рейтинг вынесен в отдельную кнопку', !!c2.querySelector('[data-legtab="contrib"]'));
 ok('таблицы рейтинга в казне больше нет', c2.querySelectorAll('.contrib-row').length===0);

 console.log('\n[5] Страница рейтинга вкладов: общий / недельный');
 App._legionTab='contrib'; App._contribPeriod='all';
 err=null; try{ await App.screens.legion(c2); }catch(e){ err=e; }
 ok('страница рейтинга отрисовалась', !err);
 await App._loadContrib();
 ok('строк рейтинга — 2', c2.querySelectorAll('.contrib-row').length===2);
 ok('лидер выделен', c2.querySelectorAll('.contrib-row.first').length===1);
 ok('вклад ушедшего сохранён и помечен', /Ушедший[\s\S]{0,60}\(вышел\)/.test(c2.innerHTML));
 ok('иконки валют в шапке', !!c2.querySelector('.contrib-head .ic-ear') && !!c2.querySelector('.contrib-head .ic-token') && !!c2.querySelector('.contrib-head .ic-reserve'));
 ok('есть переключатели общий/недельный', c2.querySelectorAll('[data-contrib]').length===2);

 App._contribPeriod='week';
 err=null; try{ await App.screens.legion(c2); }catch(e){ err=e; }
 await App._loadContrib();
 ok('в недельном — только вносивший на этой неделе', c2.querySelectorAll('.contrib-row').length===1);
 ok('сказано про обнуление недели', /обнуляется каждый понедельник/.test(c2.innerHTML));

 console.log('\n[5] UI.fmtAgo');
 eq('минуты', UI.fmtAgo(Date.now()-5*60000), '5 мин назад');
 eq('часы', UI.fmtAgo(Date.now()-3*3600000), '3 ч назад');
 eq('только что', UI.fmtAgo(Date.now()-5000), 'только что');

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
