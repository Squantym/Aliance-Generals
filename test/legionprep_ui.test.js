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

 console.log('\n[5] Результаты боя: «лучшие» одной колонкой, данные врага скрыты');
 const done={ phase:'done', mySide:'A', winningSide:'B',
   me:{userId:'x',stats:{dmgDealt:18492,healed:0,guards:9,kills:0}},
   finalReport:{ activityScores:{A:649,B:1537},
     playerDetails:{ x:{stats:{dmgDealt:18492,healed:0,guards:9,kills:0}} },
     bestPerRole:[
       {role:'assault', label:'Лучший боец', unit:'урона', name:'Сармат', value:18492},
       {role:'guardian',label:'Лучший защитник', unit:'урона принял', name:'Стена', value:254},
       {role:'medic',   label:'Лучший медик', unit:'HP вылечил', name:'ДагМед', value:14842},
     ],
     clanResults:{
       A:{ side:'A', name:'Альфа', memberCount:3, totalDamage:18492, totalHealed:14842, totalKills:1,
           members:[{name:'Сармат',role:'assault',dmgDealt:18492,healed:0,guards:0,guardedDmg:0,kills:1}] },
       B:{ side:'B', name:'Браво', memberCount:2, hidden:true } } } };
 App._renderBattleDone(win, done);
 ok('«лучшие» одной колонкой', win.querySelectorAll('.bw-best-col').length===1);
 ok('ровно 3 строки — по одной на роль', win.querySelectorAll('.bw-best-row').length===3);
 ok('старых карточек топ-3 больше нет', win.querySelectorAll('.bw-top-card').length===0);
 ok('лучший боец подписан', /Лучший боец[\s\S]{0,120}Сармат/.test(win.innerHTML));
 ok('у защитника метрика «принял»', /Лучший защитник[\s\S]{0,160}принял/.test(win.innerHTML));
 ok('у медика метрика «HP вылечил»', /Лучший медик[\s\S]{0,160}HP вылечил/.test(win.innerHTML));
 ok('иконки ролей картинками', /img\/legion\/roles\/guardian\.webp/.test(win.innerHTML));
 ok('свой легион показан целиком', /Альфа[\s\S]{0,400}Суммарный урон/.test(win.innerHTML));
 ok('данные врага скрыты', /Данные вражеского легиона недоступны/.test(win.innerHTML));
 ok('у врага нет суммарного урона', !/Браво[\s\S]{0,200}Суммарный урон/.test(win.innerHTML));
 ok('баннер поражения', /ПОРАЖЕНИЕ/.test(win.innerHTML));

 console.log('\n[6] История боёв: компактные карточки');
 const h={ at:Date.now()-3600000, myName:'Альфа', enemyName:'Браво', won:true, loot:1250,
   gloryGain:12, gloryLoss:0, myDamage:18492, myParticipants:3,
   best:[{role:'medic',label:'Лучший медик',unit:'HP вылечил',name:'ДагМед',value:14842}] };
 const box=document.createElement('div'); box.innerHTML=App._battleHistRow(h,0);
 ok('строка помечена победой', box.querySelector('.bh-row.win'));
 ok('свой легион зелёный', box.querySelector('.bh-side.ally').textContent.includes('Альфа'));
 ok('вражеский легион красный', box.querySelector('.bh-side.foe').textContent.includes('Браво'));
 ok('надпись «Победа»', box.querySelector('.bh-res').textContent.trim()==='Победа');
 ok('резервы с иконкой', box.querySelector('.bh-loot .ic-reserve'));
 ok('кнопка «Подробнее» есть', box.querySelector('[data-bh]').textContent.includes('Подробнее'));
 ok('детали скрыты по умолчанию', box.querySelector('.bh-det').hidden===true);
 ok('в деталях есть лучшие', /Лучший медик/.test(box.innerHTML));
 const loss=document.createElement('div');
 loss.innerHTML=App._battleHistRow(Object.assign({},h,{won:false,loot:-800}),1);
 ok('поражение красным', loss.querySelector('.bh-res.loss').textContent.trim()==='Поражение');
 ok('потеря резервов со знаком минус', /−\s?800|−800/.test(loss.querySelector('.bh-loot').textContent));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
