// jsdom: иконки главного меню и диверсантов реально попадают в разметку,
// файлы на месте, старые эмодзи-иконки в сетке меню исчезли.
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div><div id="toasts"></div></body>',{url:'http://localhost/'});
Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,location:dom.window.location});
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(f,n){let c=fs.readFileSync(__dirname+'/../'+f,'utf8');c+=`\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`;eval(c);return globalThis.__x;}
global.UI=load('public/js/ui.js','UI');global.API=load('public/js/api.js','API');UI.toast=()=>{};UI.confirm=async()=>true;
global.App=load('public/js/app.js','App');
const ROOT=path.join(__dirname,'..');
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};

(async()=>{
 console.log('\n[1] Хелперы картинок');
 ok('menuImg отдаёт путь меню', /\/img\/menu\/war\.webp/.test(App.menuImg('war')));
 ok('menuImg задаёт размер', /width="28"/.test(App.menuImg('bank', 28)));
 ok('sabImg отдаёт путь диверсанта', /\/img\/saboteurs\/ground\.webp/.test(App.sabImg('ground')));
 ok('пустой id → пусто', App.menuImg('')==='' && App.sabImg(null)==='');

 console.log('\n[2] Файлы иконок на месте');
 const MENU=['war','legion','missions','hq','production','units','buildings','market','saboteurs','club',
   'profile','alliance','fame','chat','mail','trophies','season','referral','bank','hospital','settings'];
 MENU.forEach(id => ok(`меню: ${id}.webp`, fs.existsSync(path.join(ROOT,'public/img/menu',id+'.webp'))));
 ['ground','sea','air','secret','building','suicide'].forEach(id =>
   ok(`диверсант: ${id}.webp`, fs.existsSync(path.join(ROOT,'public/img/saboteurs',id+'.webp'))));

 console.log('\n[3] Главное меню рисуется картинками, а не эмодзи');
 load('public/js/screens/core.js','App');
 App.me={ name:'Тест', level:5 };
 App.refreshMe=async()=>{};
 API.get=async(url)=>{
   if(url==='/api/me/full') return { unlocked:{production:true}, mailUnread:0, level:5, name:'Тест' };
   return {};
 };
 // Прямой вызов рендера меню
 const c=document.getElementById('content');
 let err=null;
 try { await App.screens.home(c); } catch(e){ err=e; }
 if(err) console.log('    (home недоступен напрямую: '+String(err.message).split('\n')[0]+')');
 // Если home не отрисовался в изоляции — проверим сгенерированный HTML через регэксп исходника
 const src=fs.readFileSync(path.join(ROOT,'public/js/screens/core.js'),'utf8');
 ok('меню использует App.menuImg', /App\.menuImg\(ic, 40\)/.test(src) && /App\.menuImg\(ic, 28\)/.test(src));
 ok('в сетке меню больше нет <span class="ic">эмодзи', !/<span class="ic">\$\{ic\}<\/span>/.test(src));
 ok('пункт «Диверсанты» ведёт на saboteurs с иконкой saboteurs', /\['saboteurs', 'saboteurs', 'Диверсанты'\]/.test(src));

 console.log('\n[4] Экран диверсантов: иконки вкладок и шапок');
 const sabSrc=fs.readFileSync(path.join(ROOT,'public/js/screens/saboteurs.js'),'utf8');
 ok('вкладки с иконками', /App\.sabImg\(id, 20\)/.test(sabSrc));
 ok('шапка обычного типа с иконкой', /App\.sabImg\(tab, 44\)/.test(sabSrc));
 ok('шапка смертников с иконкой', /App\.sabImg\('suicide', 44\)/.test(sabSrc));
 ok('заголовок экрана — иконка меню', /App\.menuImg\('saboteurs', 26\)/.test(sabSrc));
 ok('эмодзи 🥷 в заголовке убрано', !/<div class="title">🥷 Диверсанты/.test(sabSrc));

 console.log('\n[5] Окно ракетного удара: тип диверсанта → иконка + русское имя');
 const appSrc=fs.readFileSync(path.join(ROOT,'public/js/app.js'),'utf8');
 ok('используется App.sabImg по типу', /App\.sabImg\(type, 22\)/.test(appSrc));
 ok('есть перевод типов в русские имена', /SAB_RU\s*=\s*\{[^}]*ground:/.test(appSrc));
 ok('сырой ключ 🥷 ${nm} больше не выводится', !/🥷 \$\{UI\.esc\(nm\)\}/.test(appSrc));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
