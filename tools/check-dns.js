// ═══════════════════════════════════════════════════════════════════
// tools/check-dns.js — проверка почтовых записей домена
//
// Отвечает на один вопрос: дошли ли до интернета записи, которые ты
// добавил в панели DNS, и готов ли домен к отправке писем.
//
// Сама проверка живёт в src/services/maildns.ts — там же, откуда её
// берёт панель («Письма» → «Проверить домен»). Здесь только вывод в
// терминал. Разводить два списка записей нельзя: они разъедутся, и
// панель с инструментом начнут говорить разное.
//
// Ничего не меняет и не отправляет — только спрашивает DNS. Записи
// расходятся не мгновенно, поэтому нормально запустить, увидеть «нет»,
// подождать полчаса и запустить снова.
//
// Запуск:  node tools/check-dns.js aliance-general.ru
// (домен можно не указывать — возьмётся из APP_URL в .env)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let maildns = null;
try {
  maildns = require(path.join(ROOT, 'dist/src/services/maildns.js'));
} catch (e) {
  console.error('Сначала соберите проект:  npm run build');
  console.error('(проверка домена лежит в src/services/maildns.ts)');
  process.exit(2);
}

function domainFromEnv() {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = /^APP_URL\s*=\s*(.+)$/m.exec(env);
    if (m) return String(m[1]).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  } catch (e) {}
  return '';
}

(async () => {
  const domain = (process.argv[2] || domainFromEnv() || '').trim().toLowerCase();
  if (!domain) {
    console.error('Укажите домен: node tools/check-dns.js ваш-домен.ru');
    process.exit(2);
  }

  console.log(`\nПроверяю почтовые записи домена ${domain}\n`);
  const r = await maildns.checkDomain(domain);

  if (!r.ns.length) {
    console.log('  ⛔ ' + r.verdict);
    process.exit(1);
  }
  console.log('DNS-серверы домена:');
  r.ns.forEach((x) => console.log('   ' + x));
  console.log(r.panel ? `   → записи правятся здесь: ${r.panel}\n` : '\n');

  for (const c of r.checks) {
    console.log(`${c.ok ? '  ✅' : '  ⛔'} ${c.title}: ${c.value}`);
    if (c.hint) console.log('     ' + c.hint);
  }

  if (r.spfFix) {
    console.log('\nГотовая строка SPF (ИСПРАВИТЬ существующую запись, не добавлять вторую):');
    console.log('   ' + r.spfFix);
  }

  console.log('\n' + '─'.repeat(52));
  console.log(r.verdict);
  console.log('─'.repeat(52) + '\n');
  process.exit(r.ok ? 0 : 1);
})().catch((e) => { console.error('Ошибка проверки:', e.message); process.exit(2); });
