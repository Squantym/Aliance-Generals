// Тест PWA: манифест, иконки, service worker и — главное — ЗАГОЛОВКИ КЕША.
// Поднимаем настоящий сервер и проверяем ответы по HTTP.
const assert=require('assert');
const http=require('http');
const fs=require('fs');
const path=require('path');
const { spawn }=require('child_process');

let passed=0;
const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);passed++;console.log('  ✅ '+n);};

const PORT=34567;
function get(p){
  return new Promise((res,rej)=>{
    const r=http.get({host:'127.0.0.1',port:PORT,path:p,headers:{'accept-encoding':'identity'}},(resp)=>{
      let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>res({status:resp.statusCode,headers:resp.headers,body:d}));
    }); r.on('error',rej); r.setTimeout(5000,()=>{r.destroy(new Error('timeout'));});
  });
}
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
 console.log('\n[1] Файлы PWA на месте');
 for (const f of ['public/manifest.json','public/sw.js','public/offline.html','public/sw-config.json',
                  'public/img/pwa/icon-192.png','public/img/pwa/icon-512.png',
                  'public/img/pwa/icon-maskable-512.png','public/img/pwa/apple-touch-icon-180.png']) {
   ok(f+' существует', fs.existsSync(path.join(__dirname,'..',f)));
 }

 console.log('\n[2] Манифест корректен');
 const m=JSON.parse(fs.readFileSync(__dirname+'/../public/manifest.json','utf8'));
 eq('display=standalone (запуск без адресной строки)', m.display,'standalone');
 eq('start_url', m.start_url,'/');
 eq('scope', m.scope,'/');
 ok('name задан', m.name==='Альянс Генералов');
 ok('есть иконка 192', m.icons.some(i=>i.sizes==='192x192'));
 ok('есть иконка 512', m.icons.some(i=>i.sizes==='512x512'));
 ok('есть maskable-иконка (для Android)', m.icons.some(i=>i.purpose==='maskable'));
 ok('все файлы иконок реально существуют', m.icons.every(i=>fs.existsSync(__dirname+'/../public'+i.src)));
 ok('ярлыки ведут на существующие экраны', m.shortcuts.every(s=>['/#war','/#legion','/#mail'].includes(s.url)));

 console.log('\n[3] Логика service worker');
 const sw=fs.readFileSync(__dirname+'/../public/sw.js','utf8');
 ok('/api/* исключён из кеша (живая игра)', /p\.startsWith\('\/api\/'\)/.test(sw));
 ok('навигация — network-first', /navigationHandler/.test(sw) && /await fetch\(req\)/.test(sw));
 ok('есть офлайн-заглушка', sw.includes('/offline.html'));
 ok('есть kill switch (аварийное самоудаление)', /selfDestruct/.test(sw) && /unregister\(\)/.test(sw));
 ok('кеширует только успешные ответы своего origin', /res\.status === 200 && res\.type === 'basic'/.test(sw));
 ok('не перехватывает POST', /req\.method !== 'GET'/.test(sw));

 console.log('\n[4] Сервер: заголовки кеша (запуск настоящего сервера)');
 const env=Object.assign({},process.env,{PORT:String(PORT),MONGODB_URI:''});
 const srv=spawn('node',['dist/server.js'],{cwd:path.join(__dirname,'..'),env,stdio:'ignore'});
 try {
   let up=false;
   for(let i=0;i<40;i++){ try{ await get('/manifest.json'); up=true; break; }catch(e){ await wait(250); } }
   ok('сервер поднялся', up);

   const swRes=await get('/sw.js');
   eq('/sw.js отдаётся (200)', swRes.status,200);
   eq('/sw.js — no-cache (иначе воркер залипнет на сутки)', swRes.headers['cache-control'],'no-cache');

   const cfg=await get('/sw-config.json');
   eq('/sw-config.json — no-cache (kill switch долетает сразу)', cfg.headers['cache-control'],'no-cache');
   eq('kill по умолчанию выключен', JSON.parse(cfg.body).kill, false);

   const man=await get('/manifest.json');
   eq('/manifest.json — no-cache', man.headers['cache-control'],'no-cache');
   ok('/manifest.json отдаётся как JSON', /application\/json/.test(man.headers['content-type']));

   const off=await get('/offline.html');
   eq('/offline.html отдаётся', off.status,200);
   ok('офлайн-экран на русском и в стиле игры', /Связь со штабом потеряна/.test(off.body));

   const idx=await get('/');
   ok('index.html подключает манифест', /rel="manifest"/.test(idx.body));
   ok('index.html содержит theme-color', /name="theme-color"/.test(idx.body));
   ok('index.html содержит apple-touch-icon (iOS)', /apple-touch-icon/.test(idx.body));
   ok('хэши ?v= в ссылках на JS по-прежнему подставляются', /\/js\/app\.js\?v=[0-9a-f]{8}/.test(idx.body));
   eq('index.html — no-cache', idx.headers['cache-control'],'no-cache');

   const js=await get('/js/app.js?v=12345678');
   ok('JS с хэшем — immutable на год (SW кеширует безопасно)', /immutable/.test(js.headers['cache-control']));

   const icon=await get('/img/pwa/icon-512.png');
   eq('иконка отдаётся', icon.status,200);

   // Путь с точкой — многие статик-сервера его режут. Без этого файла
   // в APK сверху будет видна адресная строка браузера.
   const al=await get('/.well-known/assetlinks.json');
   eq('/.well-known/assetlinks.json отдаётся (нужен для APK)', al.status,200);
   ok('assetlinks — валидный JSON нужного формата', (()=>{ try{ const j=JSON.parse(al.body); return Array.isArray(j) && j[0].target.namespace==='android_app'; }catch(e){ return false; } })());

   const trav=await get('/../package.json');
   ok('обход каталога вверх не работает (безопасность)', trav.status===403 || trav.status===404);
 } finally { srv.kill('SIGKILL'); }

 console.log('\n[5] Android: файлы для сборки APK');
 ok('скрипт сборки на месте', fs.existsSync(__dirname+'/../android/make-apk.sh'));
 ok('скрипт исполняемый', (fs.statSync(__dirname+'/../android/make-apk.sh').mode & 0o111) !== 0);
 ok('шаблон конфига TWA на месте', fs.existsSync(__dirname+'/../android/twa-manifest.template.json'));
 ok('инструкция на месте', fs.existsSync(__dirname+'/../android/README.md'));
 const twa=JSON.parse(fs.readFileSync(__dirname+'/../android/twa-manifest.template.json','utf8'));
 const al2=JSON.parse(fs.readFileSync(__dirname+'/../public/.well-known/assetlinks.json','utf8'));
 eq('пуши в APK включены', twa.enableNotifications, true);
 eq('packageId APK совпадает с assetlinks (иначе будет адресная строка)', twa.packageId, al2[0].target.package_name);
 eq('цвет темы APK совпадает с манифестом', twa.themeColor, m.theme_color);
 eq('ярлыки APK совпадают с манифестом', twa.shortcuts.map(x=>x.url).join(), m.shortcuts.map(x=>x.url).join());
 ok('в шаблоне остались плейсхолдеры домена (подставляются при сборке)', /ЗАМЕНИ_НА_ДОМЕН/.test(fs.readFileSync(__dirname+'/../android/twa-manifest.template.json','utf8')));

 console.log('\n[6] Секреты не утекут в git');
 const gi=fs.readFileSync(__dirname+'/../.gitignore','utf8');
 ok('.env в .gitignore (утёкший пароль MongoDB)', /^\.env$/m.test(gi));
 ok('ключ подписи APK в .gitignore', /android\.keystore/.test(gi));
 ok('APK не коммитим', /android\/\*\.apk/.test(gi));
 ok('.env.example остаётся в репозитории', /!\.env\.example/.test(gi));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
