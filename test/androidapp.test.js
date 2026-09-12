// ═══════════════════════════════════════════════════════════════════
// test/androidapp.test.js — установщик игры для Android
//
// APK — оболочка (TWA) вокруг сайта. Живая часть здесь одна: сервер
// должен отдать сам файл и привязку к домену, а игрок — найти страницу
// установки. Всё это ломается молча:
//
//  • нет /.well-known/assetlinks.json — приложение откроется, но сверху
//    будет адресная строка браузера (Android не поверит, что APK наш);
//  • отпечаток в assetlinks не совпадает с ключом подписи — то же самое;
//  • нет своего типа у .apk — часть телефонов не открывает скачанное;
//  • нет страницы установки — игроку некуда идти за файлом.
//
// Запуск: node test/androidapp.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

const PORT = 3497;
process.env.PORT = String(PORT);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = require('os').tmpdir() + '/androidapp-' + Date.now();
process.env.DISABLE_RATE_LIMIT = '1';
process.env.ALLOW_UNVERIFIED_EMAIL = '1';

const get = (p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

(async () => {
  console.log('\n[1] Файлы на месте');
  const apkPath = path.join(ROOT, 'public/app/aliance-generals.apk');
  ok(fs.existsSync(apkPath), 'установщик лежит в public/app/');
  const apk = fs.readFileSync(apkPath);
  ok(apk.length > 500000 && apk.length < 30 * 1024 * 1024, `размер разумный: ${(apk.length / 1048576).toFixed(2)} МБ`);
  ok(apk.slice(0, 2).toString() === 'PK', 'это настоящий пакет (zip-контейнер)');
  // Подпись v2 лежит прямо в файле — по ней Android и проверяет APK
  ok(apk.includes(Buffer.from('APK Sig Block 42')), 'пакет подписан (блок подписи внутри)');

  const links = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/.well-known/assetlinks.json'), 'utf8'));
  const target = links[0] && links[0].target;
  ok(links[0].relation.includes('delegate_permission/common.handle_all_urls'), 'assetlinks разрешает открывать адреса домена');
  const twa = JSON.parse(fs.readFileSync(path.join(ROOT, 'android/twa-manifest.json'), 'utf8'));
  ok(target.package_name === twa.packageId, `имя пакета совпадает со сборкой: ${target.package_name}`);
  const fp = target.sha256_cert_fingerprints[0];
  ok(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp), 'отпечаток записан как 32 байта через двоеточие');
  // Отпечаток обязан совпадать с ключом, которым подписан лежащий рядом файл:
  // иначе Android откроет приложение с адресной строкой, и это заметит только игрок
  const crypto = require('crypto');
  const AdmZipLess = () => {
    // Сертификат лежит в META-INF/*.RSA. Без сторонних библиотек достаём
    // его через встроенный zlib по центральному каталогу zip.
    const buf = apk;
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cdOff = buf.readUInt32LE(eocd + 16);
    let p = cdOff, found = null;
    while (buf.readUInt32LE(p) === 0x02014b50) {
      const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
      const name = buf.slice(p + 46, p + 46 + nameLen).toString();
      const localOff = buf.readUInt32LE(p + 42);
      const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
      if (/^META-INF\/.*\.(RSA|EC|DSA)$/i.test(name)) { found = { localOff, method, csize }; break; }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    if (!found) return null;
    const lnameLen = buf.readUInt16LE(found.localOff + 26), lextraLen = buf.readUInt16LE(found.localOff + 28);
    const start = found.localOff + 30 + lnameLen + lextraLen;
    const raw = buf.slice(start, start + found.csize);
    return found.method === 0 ? raw : require('zlib').inflateRawSync(raw);
  };
  const pkcs7 = AdmZipLess();
  ok(!!pkcs7, 'в пакете есть файл подписи');
  // Сертификат внутри PKCS#7: ищем DER-последовательность и считаем её отпечаток
  const certStart = pkcs7.indexOf(Buffer.from([0x30, 0x82]), 20);
  let certFp = '';
  for (let i = certStart; i < pkcs7.length - 4 && !certFp; i++) {
    if (pkcs7[i] === 0x30 && pkcs7[i + 1] === 0x82) {
      const len = pkcs7.readUInt16BE(i + 2) + 4;
      const cand = pkcs7.slice(i, i + len);
      try {
        const x = new crypto.X509Certificate(cand);
        certFp = crypto.createHash('sha256').update(x.raw).digest('hex').toUpperCase().match(/../g).join(':');
      } catch (e) { /* не сертификат — идём дальше */ }
    }
  }
  ok(certFp === fp, `отпечаток в assetlinks совпадает с ключом подписи файла (${certFp.slice(0, 11)}…)`);

  console.log('\n[2] Сервер отдаёт установщик и привязку');
  require(ROOT + '/dist/server.js');
  for (let i = 0; i < 60; i++) {
    try { await get('/manifest.json'); break; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  const al = await get('/.well-known/assetlinks.json');
  ok(al.status === 200, 'assetlinks.json отдаётся');
  ok(/application\/json/.test(al.headers['content-type'] || ''), 'и как JSON');
  ok(JSON.parse(al.body.toString())[0].target.package_name === twa.packageId, 'с тем же именем пакета');
  const dl = await get('/app/aliance-generals.apk');
  ok(dl.status === 200 && dl.body.length === apk.length, `файл скачивается целиком: ${(dl.body.length / 1048576).toFixed(2)} МБ`);
  ok(dl.headers['content-type'] === 'application/vnd.android.package-archive', `свой тип у .apk: ${dl.headers['content-type']}`);
  const page = await get('/app.html');
  ok(page.status === 200 && /Скачать приложение/.test(page.body.toString()), 'страница установки открывается');
  const short = await get('/app');
  ok(short.status === 200 && /Как установить/.test(short.body.toString()), 'и по короткому адресу /app');

  console.log('\n[3] Игроку есть куда нажать');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/href="\/app\.html"/.test(core), 'в настройках есть ссылка на приложение');
  ok(/Приложение для Android/.test(core), 'и объяснено, что это');
  const html = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
  ok(/\/app\/aliance-generals\.apk/.test(html), 'страница ведёт на сам файл');
  ok(/разрешение/.test(html) && /Настройки/.test(html), 'с инструкцией про разрешение установки');
  ok(/iPhone|iOS/.test(html), 'и с ответом владельцам iPhone');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
