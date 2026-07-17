// jsdom: профиль показывает наёмника (портрет+⭐, класс pf-effect-img), а окно
// боя в подготовке показывает панель восстановления и характеристики.
const assert=require('assert'); const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>',{url:'http://localhost/'});
Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,location:dom.window.location});
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(f,n){let c=fs.readFileSync(__dirname+'/../'+f,'utf8');c+=`\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`;eval(c);return globalThis.__x;}
global.UI=load('public/js/ui.js','UI');global.API=load('public/js/api.js','API');UI.toast=()=>{};UI.confirm=async()=>true;
global.App=load('public/js/app.js','App');App.refreshMe=async()=>{};App.rerender=()=>{};App.go=()=>{};
load('public/js/screens/core.js','App'); App.me=JSON.parse(fs.readFileSync(__dirname+'/fixtures/me_payload.json','utf8')); App.me.id='x';
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};

(async()=>{
 const c=document.getElementById('content');

 console.log('\n[1] Профиль: эффект-наёмник показывается портретом (⭐), не шприцем');
 const prof=JSON.parse(fs.readFileSync(__dirname+'/fixtures/profile_mercenary.json','utf8'));
 App.me.id=prof.id;
 API.get=async()=>({profile:prof});
 await App.screens.profile(c,'x');
 ok('портрет наёмника (pf-effect-img)', /pf-effect-img/.test(c.innerHTML));
 ok('источник — папка mercenaries', /\/img\/mercenaries\/berserk\.webp/.test(c.innerHTML));
 ok('метка ⭐ наёмника (не 💉 допинг)', c.innerHTML.includes('⭐') && !/💉[^<]*Беатрис/.test(c.innerHTML));
 ok('имя наёмника показано', /Беатрис Вэйл/.test(c.innerHTML));

 console.log('\n[2] Окно боя (подготовка): панель восстановления + характеристики');
 const b={ phase:'prep', mySide:'A', prepSecsLeft:300, allCombatants:[],
   me:{ userId:'x', role:'assault', roleName:'Штурмовик', ready:true, hp:50, maxHp:100, ammo:10, energy:20, direction:null, gear:[], stats:{} },
   myStats:{ atk:12345, def:9876, critPct:15.5, dodgePct:8.0, hp:50, maxHp:100, energy:20, maxEnergy:40, ammo:10, maxAmmo:30, costs:{hp:22,energy:20,ammo:25} },
   directions:[{dir:1,name:'Гъадакьи',allies:[]},{dir:5,name:'Кӏаречӏ',allies:[]}],
   arsenal:[], myGear:[], maxSlots:3, log:[] };
 const win=document.createElement('div'); win.id='battle-window'; document.body.appendChild(win);
 let err=null; try{ App._renderBattleContent(win,b); }catch(e){ err=e; }
 ok('render без ошибок', !err); if(err) console.log('   '+(err.stack||err).split('\n').slice(0,2).join(' | '));
 ok('панель ресурсов есть', /bw-res-row/.test(win.innerHTML));
 ok('кнопки восстановления под каждым неполным ресурсом', win.querySelectorAll('[data-restore]').length===3);
 ok('блок характеристик есть', /bw-stats/.test(win.innerHTML));
 ok('показаны характеристики (атака/крит/уворот)', /Атака/.test(win.innerHTML) && /15\.5/.test(win.innerHTML) && /Уворот/.test(win.innerHTML));
 ok('направления переименованы', /Гъадакьи/.test(win.innerHTML) && /Кӏаречӏ/.test(win.innerHTML));

 console.log('\n[3] Раскраска лога: союзник зелёный, враг/урон красный');
 const b2={ mySide:'A', allCombatants:[{name:'Друг',side:'A'},{name:'Враг',side:'B'}] };
 const colored=App._colorizeLog('Друг → Враг: 45 урона 💥 КРИТ!', b2);
 ok('имя союзника зелёное', /#2ecc40[^>]*>Друг/.test(colored));
 ok('имя врага красное', /#ff4d4d[^>]*>Враг/.test(colored));
 ok('урон жёлтый', /#e9c75c[^>]*>\d+ урона/.test(colored));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
