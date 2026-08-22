// ═══════════════════════════════════════════════════════════════════
// tools/check-dns.js — проверка почтовых записей домена
//
// Отвечает на один вопрос: дошли ли до интернета записи, которые ты
// добавил в панели DNS, и готов ли домен к отправке писем.
//
// Ничего не меняет — только спрашивает. Записи расходятся не мгновенно,
// поэтому нормально запустить, увидеть «нет», подождать полчаса и
// запустить снова.
//
// Запуск:  node tools/check-dns.js aliance-general.ru
// (домен можно не указывать — возьмётся из APP_URL в .env)
// ═══════════════════════════════════════════════════════════════════
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');

function domainFromEnv() {
  try {
    const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    const m = /^APP_URL\s*=\s*(.+)$/m.exec(env);
    if (m) return String(m[1]).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  } catch (e) {}
  return '';
}

const domain = (process.argv[2] || domainFromEnv() || '').trim().toLowerCase();
if (!domain) {
  console.error('Укажите домен: node tools/check-dns.js ваш-домен.ru');
  process.exit(2);
}

const OK = '  ✅';
const NO = '  ⛔';
const HM = '  ⚠️ ';

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map((a) => a.join('')); }
  catch (e) { return []; }
}

(async () => {
  console.log(`\nПроверяю почтовые записи домена ${domain}\n`);

  // ── Кто вообще управляет зоной ──────────────────────────────────
  // Первое, что нужно знать: в чьей панели править записи.
  let ns = [];
  try { ns = await dns.resolveNs(domain); } catch (e) {}
  if (!ns.length) {
    console.log(`${NO} Домен не отвечает вообще. Проверьте, что он оплачен и делегирован.`);
    process.exit(1);
  }
  console.log('DNS-серверы домена:');
  ns.forEach((x) => console.log('   ' + x));
  const hint = ns.join(' ');
  const where = /selectel/i.test(hint) ? 'Selectel (my.selectel.ru → DNS-хостинг)'
    : /reg\.ru/i.test(hint) ? 'reg.ru'
    : /timeweb/i.test(hint) ? 'Timeweb'
    : /beget/i.test(hint) ? 'Beget'
    : /cloudflare/i.test(hint) ? 'Cloudflare'
    : /yandex/i.test(hint) ? 'Яндекс'
    : '';
  console.log(where ? `   → записи правятся здесь: ${where}\n` : '\n');

  // ── SPF ─────────────────────────────────────────────────────────
  // Кому разрешено слать письма от имени домена.
  const root = await txt(domain);
  const spf = root.filter((r) => /^v=spf1/i.test(r));
  console.log('SPF (кому разрешено слать от вашего имени):');
  if (!spf.length) console.log(`${NO} нет — добавьте TXT на @ со значением из Unisender`);
  else if (spf.length > 1) {
    // Две SPF-записи — это не «двойная защита», а ошибка стандарта:
    // почтовики считают такой домен ненастроенным и не проходят проверку
    // ВООБЩЕ никакие письма.
    console.log(`${NO} их ДВЕ — так нельзя, проверку не пройдёт ни одно письмо:`);
    spf.forEach((s) => console.log('     ' + s));
    console.log('     Объедините в одну строку, оставив include: обоих сервисов.');
  } else {
    const has = /include:spf\.unisender\.ru/i.test(spf[0]);
    console.log(`${has ? OK : HM} ${spf[0]}`);
    if (!has) console.log('     Unisender в списке нет — допишите include:spf.unisender.ru');
  }

  // ── Подтверждение владения доменом ──────────────────────────────
  const validate = root.find((r) => /unisender-go-validate-hash=/i.test(r));
  console.log('\nПодтверждение владения (unisender-go-validate-hash):');
  console.log(validate ? `${OK} на месте` : `${NO} нет — добавьте TXT на @`);

  // ── DKIM ────────────────────────────────────────────────────────
  // Подпись письма. Без неё письмо считается неподтверждённым.
  console.log('\nDKIM (подпись писем):');
  let dkimFound = '';
  for (const sel of ['gokey', 'um', 'mail', 'default']) {
    const rec = await txt(`${sel}._domainkey.${domain}`);
    const v = rec.find((r) => /v=DKIM1/i.test(r));
    if (v) { dkimFound = sel; console.log(`${OK} ${sel}._domainkey — ключ найден (${v.length} символов)`); break; }
  }
  if (!dkimFound) console.log(`${NO} нет — добавьте TXT gokey._domainkey со значением из Unisender`);

  // ── DMARC ───────────────────────────────────────────────────────
  console.log('\nDMARC (правило для непрошедших проверку):');
  const dmarcTxt = await txt('_dmarc.' + domain);
  let dmarcCname = [];
  try { dmarcCname = await dns.resolveCname('_dmarc.' + domain); } catch (e) {}
  if (dmarcTxt.some((r) => /^v=DMARC1/i.test(r))) console.log(`${OK} запись есть`);
  else if (dmarcCname.length) console.log(`${OK} ссылка на ${dmarcCname[0]}`);
  else console.log(`${HM} нет. Письма уйдут и без неё, но в спам будут попадать чаще.`);

  // ── Делегирование поддомена для обратного адреса ────────────────
  console.log('\nПоддомен для обратного адреса (NS на unisender):');
  let sub = [];
  try { sub = await dns.resolveNs('noreply.' + domain); } catch (e) {}
  if (sub.length) { console.log(`${OK} noreply.${domain} →`); sub.forEach((x) => console.log('     ' + x)); }
  else console.log(`${HM} нет — добавьте три NS-записи на noreply.${domain}`);

  // ── Итог ────────────────────────────────────────────────────────
  const ready = spf.length === 1 && /include:spf\.unisender\.ru/i.test(spf[0]) && !!dkimFound && !!validate;
  console.log('\n' + '─'.repeat(52));
  if (ready) {
    console.log('Главное на месте: SPF, DKIM и подтверждение владения.');
    console.log('Возвращайтесь в Unisender Go и нажимайте «Проверить».');
  } else {
    console.log('Ещё не всё. Добавьте недостающее и запустите проверку снова');
    console.log('через 15–30 минут: записи расходятся по интернету не сразу.');
  }
  console.log('─'.repeat(52) + '\n');
  process.exit(ready ? 0 : 1);
})().catch((e) => { console.error('Ошибка проверки:', e.message); process.exit(2); });
