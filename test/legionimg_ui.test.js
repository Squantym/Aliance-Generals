// jsdom: картинки ролей/предметов/построек реально попадают в разметку.
const assert=require('assert'); const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div><div id="toasts"></div></body>',{url:'http://localhost/'});
Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,location:dom.window.location});
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(f,n){let c=fs.readFileSync(__dirname+'/../'+f,'utf8');c+=`\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`;eval(c);return globalThis.__x;}
global.UI=load('public/js/ui.js','UI');global.API=load('public/js/api.js','API');UI.toast=()=>{};UI.confirm=async()=>true;
global.App=load('public/js/app.js','App');App.refreshMe=async()=>{};App.rerender=()=>{};App.go=()=>{};
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};

(async()=>{
 console.log('\n[1] Хелперы картинок');
 ok('roleImg отдаёт путь роли', /\/img\/legion\/roles\/guardian\.webp/.test(App.roleImg('guardian')));
 ok('itemImg отдаёт путь предмета', /\/img\/legion\/arsenal\/medkit\.webp/.test(App.itemImg('medkit')));
 ok('размер настраивается', /width="20"/.test(App.roleImg('medic',20)));
 ok('пустой id → пусто', App.roleImg(null)==='' && App.itemImg(null)==='');

 const win=document.createElement('div'); win.id='battle-window'; document.body.appendChild(win);
 const prep={ phase:'prep', mySide:'A', prepSecsLeft:300, intelActive:true, intelLevel:2,
   dirNames:['Гъадакьи','Улабахе','Бекъдахе','Асали','Кӏаречӏ'],
   allCombatants:[{userId:'e1',name:'Враг',side:'B',role:'medic',roleIcon:'➕',direction:2,alive:true}],
   me:{ userId:'x', role:'guardian', roleName:'Защитник', ready:true, hp:50, maxHp:100, ammo:10, energy:20, direction:null, gear:['medkit'], stats:{} },
   myStats:{ atk:100, def:100, critPct:5, dodgePct:10, critHealPct:5, hp:50, maxHp:100, energy:20, maxEnergy:40, ammo:10, maxAmmo:30, costs:{hp:22,energy:20,ammo:25} },
   directions:[{dir:1,name:'Гъадакьи',allies:[],enemies:[]}], arsenal:[{itemId:'napalm',name:'Напалм',qty:2,desc:''}],
   myGear:['medkit'], maxSlots:3, log:[] };

 console.log('\n[2] Подготовка: иконки ролей и предметов в разметке');
 App._renderBattleContent(win, prep);
 ok('иконка роли в блоке бойца', /img\/legion\/roles\/guardian\.webp/.test(win.innerHTML));
 ok('предмет в слоте арсенала показан картинкой', /img\/legion\/arsenal\/medkit\.webp/.test(win.innerHTML));
 ok('разведка: роль врага картинкой', /img\/legion\/roles\/medic\.webp/.test(win.innerHTML));
 // Блок смены роли виден только когда боец НЕ готов
 App._renderBattleContent(win, Object.assign({}, prep, { me: Object.assign({}, prep.me, { ready: false }) }));
 ok('в кнопках выбора роли — картинки, а не эмодзи', /img\/legion\/roles\/assault\.webp/.test(win.innerHTML));
 ok('эмодзи ролей в кнопках больше нет', !/🎯 <b>Штурмовик/.test(win.innerHTML));

 console.log('\n[3] Магазин и постройки легиона');
 load('public/js/screens/social.js','App');
 const groupFx=JSON.parse(fs.readFileSync(__dirname+'/fixtures/group_view_legion.json','utf8'));
 const legFx=JSON.parse(fs.readFileSync(__dirname+'/fixtures/legion_view_challenger.json','utf8'));
 App.me=JSON.parse(fs.readFileSync(__dirname+'/fixtures/me_payload.json','utf8'));
 API.get=async(url)=>{ if(url==='/api/group/legion') return groupFx; if(url==='/api/legion') return {mine:legFx}; return {}; };
 const c2=document.getElementById('content');

 App._legionTab='shop';
 let err=null; try{ await App.screens.legion(c2); }catch(e){ err=e; }
 if(err) console.log('    ОШИБКА: '+String(err.stack||err).split('\n')[0]);
 ok('магазин отрисовался', !err);
 ok('в магазине картинки предметов', /img\/legion\/arsenal\/.*\.webp/.test(c2.innerHTML));

 App._legionTab='buildings';
 err=null; try{ await App.screens.legion(c2); }catch(e){ err=e; }
 ok('вкладка построек отрисовалась', !err);
 const imgs=[...c2.querySelectorAll('img.bb-img')];
 ok('картинки построек есть', imgs.length>0);
 ok('пути ведут в /img/legion/buildings/', imgs.every(i=>/\/img\/legion\/buildings\/\w+\.webp/.test(i.getAttribute('src'))));
 ok('картинки грузятся лениво', imgs.every(i=>i.getAttribute('loading')==='lazy'));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
