// Регрессия «чёрный экран боя легиона» — клиентская часть (jsdom).
// Самодостаточный: DTO собран прямо тут. Требует devDependency jsdom.
// Гарантии:
//  1) при сбое запроса окно НЕ остаётся пустым/чёрным → «Переподключение»;
//  2) при battle:null на свежем окне → «бой не найден», а не чёрный экран;
//  3) валидный бой отрисовывается, dataset.rendered=1;
//  4) ошибка привязки событий НЕ затирает уже отрисованный бой.
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url:'http://localhost/' });
global.window=dom.window; global.document=dom.window.document;
global.localStorage=dom.window.localStorage; global.location=dom.window.location;
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function loadGlobal(file,name){ let c=fs.readFileSync(__dirname+'/../'+file,'utf8'); c+=`\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`; eval(c); return globalThis.__x; }
global.UI=loadGlobal('public/js/ui.js','UI'); global.API=loadGlobal('public/js/api.js','API');
UI.toast=()=>{}; UI.confirm=async()=>true;
const App=loadGlobal('public/js/app.js','App');
App.me={ legion:{ id:'lA' } };

// Минимальный валидный prep-DTO (боец «готов», одно направление занято)
const me = { userId:'v', name:'Вы', role:'assault', roleName:'Штурмовик', hp:100, maxHp:100,
  shield:0, ammo:7, energy:50, online:true, alive:true, ready:true, direction:1, dirName:'Северный фронт',
  stunned:0, noHeal:0, onFire:false, dmgBoost:0, immune:0, reflecting:false, gear:['gas_grenade'], stats:{} };
const prep = {
  id:'B1', phase:'prep', prepEndsAt:Date.now()+300000, prepSecsLeft:300, timeLeft:null,
  finishReason:null, winningSide:null, me, mySide:'A', cooldowns:{action:0,move:0,item:0},
  directions:[1,2,3,4,5].map(d=>({dir:d,name:'Напр.'+d,allies:d===1?[me]:[],enemies:[],allySlots:5})),
  allCombatants:[{userId:'v',name:'Вы',side:'A',role:'assault',ready:true,hp:100,maxHp:100,direction:1,alive:true,dirName:'Северный фронт',online:true}],
  dirNames:['Северный фронт','Восточный рубеж','Западный плацдарм','Южный редут','Центральная высота'],
  log:[], liveScores:null, finalReport:null, myGear:['gas_grenade'], maxSlots:4,
  arsenal:[{itemId:'gas_grenade',name:'💨 Газовая шашка',qty:2,desc:''}], teamChat:[], globalChat:[],
};

let passed=0;
const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
function mkWin(){ const w=document.createElement('div'); w.id='battle-window'; w.style.background='#0a0f1a'; document.body.appendChild(w); return w; }
function clear(){ const w=document.getElementById('battle-window'); if(w) w.remove(); }

(async()=>{
  console.log('\n[1] Сбой запроса на свежем окне → «Переподключение», не чёрный экран');
  clear(); let w=mkWin();
  API.get=async()=>{ throw new Error('network fail'); };
  await App._renderBattleWindow();
  ok('окно НЕ пустое', w.innerHTML.trim().length>0);
  ok('показан статус переподключения', /Переподключение/.test(w.innerHTML));
  ok('есть кнопка Обновить', /Обновить/.test(w.innerHTML));
  ok('есть кнопка Закрыть', /Закрыть/.test(w.innerHTML));

  console.log('\n[2] battle:null на свежем окне → «бой не найден», не чёрный экран');
  clear(); w=mkWin();
  API.get=async()=>({battle:null});
  await App._renderBattleWindow();
  ok('окно НЕ пустое', w.innerHTML.trim().length>0);
  ok('показано «не найден»', /не найден/i.test(w.innerHTML));

  console.log('\n[3] Валидный prep-бой отрисовывается');
  clear(); w=mkWin();
  API.get=async()=>({battle:prep});
  await App._renderBattleWindow();
  ok('окно отрисовано (много контента)', w.innerHTML.length>2000);
  ok('dataset.rendered=1', w.dataset.rendered==='1');
  ok('нет плейсхолдера переподключения', !/Переподключение/.test(w.innerHTML));

  console.log('\n[4] Ошибка в привязке событий НЕ затирает готовый бой');
  clear(); w=mkWin();
  API.get=async()=>({battle:prep});
  const origBind=App._bindBattleWindowEvents;
  App._bindBattleWindowEvents=()=>{ throw new Error('bind boom'); };
  await App._renderBattleWindow();
  ok('бой всё равно отрисован (bind-ошибка изолирована)', w.innerHTML.length>2000);
  ok('dataset.rendered=1 несмотря на ошибку bind', w.dataset.rendered==='1');
  ok('НЕ подменён заглушкой', !/Переподключение|Не удалось открыть/.test(w.innerHTML));
  App._bindBattleWindowEvents=origBind;

  console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
  process.exit(0);
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
