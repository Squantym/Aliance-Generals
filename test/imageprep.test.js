// ═══════════════════════════════════════════════════════════════════
// test/imageprep.test.js — подготовка картинок перед загрузкой
//
// Фото с телефона весит мегабайты, а иконка показывается в 64 пикселя.
// Браузер готовит файл сам: уменьшает, сохраняет прозрачность, подбирает
// вес. Три вещи, на которых обжигались и которые здесь стерегутся:
//
//  1. JPEG не умеет прозрачность — иконка получала чёрную подложку.
//     Прозрачная картинка обязана уехать в webp или png, но не в jpeg.
//  2. Увеличивать нельзя: из иконки 64 px «баннер» не получится,
//     получится размытый квадрат.
//  3. Вес: сначала снижаем качество, и только если не помогло —
//     уменьшаем размер. Иначе картинка уезжает мылом там, где хватило
//     бы качества 0.7.
//
// Canvas в jsdom нет, поэтому холст подменён заглушкой: она считает
// «вес» из размера и качества — этого достаточно, чтобы проверить сами
// решения, а не рисование.
//
// Запуск: node test/imageprep.test.js
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

// ── Холст-заглушка ────────────────────────────────────────────────
// «Вес» файла: площадь × качество. Проверяем решения, не картинку.
let alphaInSource = false;      // есть ли прозрачность у исходника
let webpSupported = true;       // умеет ли браузер webp
const drawCalls = [];           // сколько шагов уменьшения сделали

function makeCanvas(document) {
  const orig = document.createElement.bind(document);
  document.createElement = (tag) => {
    if (tag !== 'canvas') return orig(tag);
    const cv = { width: 0, height: 0 };
    cv.getContext = () => ({
      drawImage: (src, x, y, w, h) => drawCalls.push([w, h]),
      getImageData: (x, y, w, h) => ({
        // 4 байта на точку; прозрачной делаем первую точку
        data: (() => { const d = new Uint8ClampedArray(w * h * 4).fill(255); if (alphaInSource) d[3] = 0; return d; })(),
      }),
    });
    cv.toDataURL = (type, q) => {
      if (type === 'image/webp' && !webpSupported) return 'data:image/png;base64,AAAA';
      const quality = q === undefined ? 1 : q;
      const bytes = Math.max(64, Math.round(cv.width * cv.height * quality * 0.5));
      return `data:${type || 'image/png'};base64,` + 'A'.repeat(bytes);
    };
    return cv;
  };
}

(async () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.location = dom.window.location;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  global.FileReader = dom.window.FileReader;
  makeCanvas(document);

  let code = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  code += '\n;globalThis.__app = App;';
  eval(code);
  const App = globalThis.__app;

  // Картинку «расшифровываем» заглушкой: берём размеры из имени файла
  App._decodeImage = async (file) => ({ width: file.w, height: file.h });
  const file = (w, h) => ({ w, h, type: 'image/png' });
  // Поддержку webp игра выясняет один раз за сессию и запоминает — в тесте
  // сбрасываем эту память, иначе второй случай проверял бы первый ответ.
  const prep = async (f, opts) => { drawCalls.length = 0; App.__webp = undefined; return App._prepareImage(f, opts); };

  console.log('\n[1] Размер: уменьшаем, но не увеличиваем');
  const big = await prep(file(3000, 2000), { maxW: 1600, maxH: 1600, maxBytes: 10 * 1024 * 1024 });
  ok(big.width === 1600 && big.height === 1067, `3000×2000 → ${big.width}×${big.height}, пропорции целы`);
  const tall = await prep(file(1080, 2400), { maxW: 1600, maxH: 1600, maxBytes: 10 * 1024 * 1024 });
  ok(tall.height === 1600 && tall.width === 720, `вертикальный 1080×2400 → ${tall.width}×${tall.height}: по высоте тоже есть предел`);
  const small = await prep(file(48, 48), { maxW: 256, maxH: 256, maxBytes: 10 * 1024 * 1024 });
  ok(small.width === 48 && small.height === 48, 'маленькую иконку не растягиваем — было бы мыло');

  console.log('\n[2] Уменьшение идёт ступенями');
  await prep(file(2048, 2048), { maxW: 128, maxH: 128, maxBytes: 10 * 1024 * 1024 });
  const steps = drawCalls.length;
  ok(steps >= 4, `2048 → 128 прошло ${steps} шагов, а не один: так браузер усредняет соседние точки`);
  ok(drawCalls[drawCalls.length - 1][0] === 128, 'последний шаг — ровно нужный размер');
  await prep(file(200, 200), { maxW: 128, maxH: 128, maxBytes: 10 * 1024 * 1024 });
  ok(drawCalls.length === 1, 'при небольшом уменьшении лишних шагов нет');

  console.log('\n[3] Прозрачность не теряется');
  alphaInSource = true; webpSupported = true;
  const a1 = await prep(file(512, 512), { maxW: 256, maxH: 256, maxBytes: 10 * 1024 * 1024 });
  ok(a1.type === 'image/webp', `с прозрачностью и webp → ${a1.type}`);
  webpSupported = false;
  const a2 = await prep(file(512, 512), { maxW: 256, maxH: 256, maxBytes: 10 * 1024 * 1024 });
  ok(a2.type === 'image/png', `с прозрачностью без webp → ${a2.type}, а не jpeg с чёрным фоном`);
  alphaInSource = false;
  const a3 = await prep(file(512, 512), { maxW: 256, maxH: 256, maxBytes: 10 * 1024 * 1024 });
  ok(a3.type === 'image/jpeg', `без прозрачности и без webp → ${a3.type}`);
  webpSupported = true;
  const a4 = await prep(file(512, 512), { maxW: 256, maxH: 256, maxBytes: 10 * 1024 * 1024 });
  ok(a4.type === 'image/webp', 'где webp есть — он и выбирается: тот же вид, меньший вес');

  console.log('\n[4] Вес: сперва качество, потом размер');
  alphaInSource = false; webpSupported = true;
  const heavy = await prep(file(1600, 1600), { maxW: 1600, maxH: 1600, maxBytes: 700 * 1024 });
  ok(heavy.bytes <= 700 * 1024 * 1.05, `уложились в предел: ${Math.round(heavy.bytes / 1024)} КБ`);
  ok(heavy.width === 1600, 'размер при этом не тронут — хватило качества');
  const veryHeavy = await prep(file(1600, 1600), { maxW: 1600, maxH: 1600, maxBytes: 20 * 1024 });
  ok(veryHeavy.width < 1600, `когда качества не хватило, уменьшился и размер: ${veryHeavy.width}×${veryHeavy.height}`);
  ok(veryHeavy.width >= 64, 'но не до неразличимого: ниже 64 px не опускаемся');

  console.log('\n[5] Редактор просит свои пределы для иконки и баннера');
  const news = fs.readFileSync(path.join(ROOT, 'public/js/screens/news.js'), 'utf8');
  ok(/maxW: 256, maxH: 256, maxBytes: 90 \* 1024/.test(news), 'иконка — 256 px и не больше 90 КБ');
  ok(/maxW: 1600, maxH: 1600, maxBytes: 500 \* 1024/.test(news), 'баннер — 1600 px и не больше 500 КБ');
  ok(/dr\.blocks\[i\]\.type === 'iconrow'/.test(news), 'пределы выбираются по виду блока');
  ok(!/_resizeImage/.test(news), 'старая подготовка из новостей убрана');
  const social = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok(/_prepareImage/.test(social) && !/_resizeImage/.test(social), 'форум переведён на ту же подготовку');
  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok(/png\|jpeg\|jpg\|webp/.test(routes), 'сервер принимает webp — иначе подготовка упёрлась бы в него');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
