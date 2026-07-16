// jsdom: окно подготовки (компактные ресурсы, кнопки восстановления только
// под НЕполными) и окно результатов (топы отдельными карточками).
const assert=require('assert'); const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>',{url:'http://localhost/'});
Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,location:dom.window.location});
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(f,n){let c=fs.readFileSync(__dirname+'/../'+f,'utf8');c+=`\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`;eval(c);return globalThis.__x;}
global.UI=load('public/js/ui.js','UI');global.API=load('public/js/api.js','API');UI.toast=()=>{};UI.confirm=async()=>true;
global.App=load('public/js/app.js','App');App.refreshMe=async()=>{};App.rerender=()=>{};App.go=()=>{};
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};

const prep=(hp,maxHp,en,maxEn,am,maxAm)=>({
  phase:'prep', mySide:'A', prepSecsLeft:300, allCombatants:[],
  me:{ userId:'x', role:'assault', roleName:'Штурмовик', ready:true, hp, maxHp, ammo:am, energy:en, direction:null, gear:[], stats:{} },
  myStats:{ atk:12345, def:9876, critPct:15.5, dodgePct:70, hp, maxHp, energy:en, maxEnergy:maxEn, ammo:am, maxAmmo:maxAm,
            costs:{hp:22,energy:20,ammo:25} },
  directions:[{dir:1,name:'Гъадакьи',allies:[]}], arsenal:[], myGear:[], maxSlots:3, log:[] });

(async()=>{
 const win=document.createElement('div'); win.id='battle-window'; document.body.appendChild(win);

 console.log('\n[1] Все ресурсы неполные → кнопка восстановления под каждым');
 App._renderBattleContent(win, prep(50,100, 20,40, 10,30));
 ok('три плитки ресурсов', win.querySelectorAll('.bw-res').length===3);
 ok('три кнопки восстановления', win.querySelectorAll('[data-restore]').length===3);
 ok('кнопка HP с ценой 22', /data-restore="hp"[\s\S]{0,120}?22/.test(win.innerHTML));
 ok('кнопка энергии с ценой 20', /data-restore="energy"[\s\S]{0,120}?20/.test(win.innerHTML));
 ok('кнопка патронов с ценой 25', /data-restore="ammo"[\s\S]{0,120}?25/.test(win.innerHTML));
 ok('общей кнопки «Восстановить всё» больше нет', !/Восстановить всё/.test(win.innerHTML) && !/id="bw-restore"/.test(win.innerHTML));

 console.log('\n[2] Полные ресурсы → кнопки под ними НЕТ');
 App._renderBattleContent(win, prep(100,100, 40,40, 10,30));
 const kinds=[...win.querySelectorAll('[data-restore]')].map(b=>b.dataset.restore);
 ok('кнопки только у неполного ресурса (патроны)', kinds.length===1 && kinds[0]==='ammo');
 ok('у полных написано «полный»', (win.innerHTML.match(/полный/g)||[]).length===2);

 console.log('\n[3] Всё полное → кнопок восстановления нет вообще');
 App._renderBattleContent(win, prep(100,100, 40,40, 30,30));
 ok('ни одной кнопки восстановления', win.querySelectorAll('[data-restore]').length===0);

 console.log('\n[4] Компактность: характеристики и роли через компактные классы');
 App._renderBattleContent(win, prep(50,100, 20,40, 10,30));
 ok('блок характеристик компактный', /bw-stats-grid/.test(win.innerHTML));
 ok('блоки подготовки используют компактный класс', /bw-prep-box/.test(win.innerHTML));
 ok('уворот показан (70%)', /70%/.test(win.innerHTML));

 console.log('\n[5] Результаты боя: топы отдельными карточками');
 const done={ phase:'done', mySide:'A', winningSide:'B', me:{userId:'x',stats:{dmgDealt:18492,healed:0,guards:9,kills:0}},
   finalReport:{ activityScores:{A:649,B:1537},
     playerDetails:{ x:{stats:{dmgDealt:18492,healed:0,guards:9,kills:0}} },
     top3:{ damage:[{name:'Сармат',side:'A',value:18492},{name:'Melvin',side:'B',value:4880},{name:'DagMed',side:'B',value:2658}],
            healing:[{name:'DagMed',side:'B',value:14842},{name:'Melvin',side:'B',value:860}],
            defense:[{name:'Combat',side:'B',value:254},{name:'Сармат',side:'A',value:9}],
            kills:[{name:'Combat',side:'B',value:1}] },
     clanResults:{} } };
 App._renderBattleDone(win, done);
 ok('карточек топов — 4 (урон/лечение/прикрытия/убийства)', win.querySelectorAll('.bw-top-card').length===4);
 ok('заголовок «Топ-3 боя» есть', /Топ-3 боя/.test(win.innerHTML));
 ok('первое место выделено', win.querySelectorAll('.bw-top-row.first').length===4);
 ok('союзник зелёный', /#2ecc40[^>]*>Сармат/.test(win.innerHTML));
 ok('враг красный', /#ff4d4d[^>]*>Melvin/.test(win.innerHTML));
 ok('свои результаты плитками', win.querySelectorAll('.bw-tile').length===4);
 ok('баннер поражения', /ПОРАЖЕНИЕ/.test(win.innerHTML));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
