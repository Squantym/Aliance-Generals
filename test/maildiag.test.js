// ═══════════════════════════════════════════════════════════════════
// test/maildiag.test.js — кнопка «Проверить домен» в панели
//
// Когда письма «не доходят», подозреваемых трое: ключ, сервис и домен.
// Первые двое отвечают сами — их отказ виден дословно при тестовой
// отправке. Домен молчит громче всех: записи не прописаны, сервис
// письмо принял и отчитался успехом, а почтовик получателя выбросил его
// без единого слова. Владелец при этом видит «письмо отправлено» и ищет
// поломку где угодно, кроме DNS.
//
// Поэтому проверяем не текст на кнопке, а поведение: спрашивает ли игра
// у DNS, что реально прописано, и подсказывает ли ровно ту строку,
// которая чинит. Главная подсказка — SPF: её нельзя добавлять второй
// записью, только исправлять существующую.
//
// Запуск: node test/maildiag.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Модуль читает окружение при загрузке — для каждого случая берём заново
function freshEmail(env) {
  for (const k of Object.keys(require.cache)) {
    if (/dist[\\/]src[\\/]services[\\/](email|mailQuota|maildns)\.js$/.test(k)) delete require.cache[k];
  }
  for (const k of Object.keys(process.env)) {
    if (/^(SMTPBZ|MAIL_LIMIT|MAIL_RESERVE|EMAIL_FROM)/.test(k)) delete process.env[k];
  }
  Object.assign(process.env, env);
  return require(path.join(ROOT, 'dist/src/services/email.js'));
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'maildiag-'));
fs.mkdirSync(path.join(work, 'data'), { recursive: true });
process.chdir(work);

(async () => {
  const db = require(path.join(ROOT, 'dist/src/core/db.js'));
  await db.init();
  const maildns = require(path.join(ROOT, 'dist/src/services/maildns.js'));

  console.log('\n── 1. Что вообще требуется от домена ──');
  const need = maildns.PROVIDERS;
  ok('сервис в списке один', need.length === 1 && need[0].id === 'smtpbz');
  ok('SPF сервиса известен', need[0].spf === 'include:spf.smtp.bz');
  ok('селектор DKIM известен', need[0].dkim[0] === 'smtpbz');
  ok('поддомен статистики известен',
     !!need[0].cname && need[0].cname.name === 'stats' && need[0].cname.value === 'smtp.bz');
  ok('Unisender из требований вычищен', !/unisender/i.test(JSON.stringify(need)));

  console.log('\n── 2. Готовая строка SPF ──');
  // SPF в домене может быть ТОЛЬКО ОДНА. Две записи — не «двойная
  // защита», а ошибка стандарта: проверку перестают проходить ВСЕ
  // письма домена, включая те, что уходили годами. Ровно сюда попадают,
  // когда новый сервис просит «добавьте SPF», а старая уже лежит рядом.
  const INC = need.map((p) => p.spf);
  const fresh = maildns.mergedSpf('', INC);
  ok(`с нуля собирается корректно: ${fresh}`,
     /^v=spf1 /.test(fresh) && fresh.includes('include:spf.smtp.bz') && / ~all$/.test(fresh));
  const wasOther = maildns.mergedSpf('v=spf1 a mx include:_spf.yandex.net -all', INC);
  ok('чужие механизмы не выброшены',
     wasOther.includes(' a ') && wasOther.includes(' mx ') && wasOther.includes('include:_spf.yandex.net'));
  ok('нового сервиса добавили', wasOther.includes('include:spf.smtp.bz'));
  ok('v=spf1 остался один', (wasOther.match(/v=spf1/gi) || []).length === 1);
  ok('all остался один и последним',
     (wasOther.match(/all/gi) || []).length === 1 && wasOther.trim().endsWith('~all'));
  ok('повторный прогон ничего не портит', maildns.mergedSpf(wasOther, INC) === wasOther);

  console.log('\n── 3. Домена нет — так и сказано ──');
  // Несуществующая зона .invalid: DNS не ответит ни при каких настройках
  // сети, поэтому случай воспроизводится одинаково и в сети, и без неё.
  const dead = await maildns.checkDomain('нет-такого-' + 'x'.repeat(20) + '.invalid');
  ok('домен не признан готовым', dead.ok === false);
  ok('и объяснено, что он вообще не отвечает', /не отвечает/i.test(dead.verdict));
  ok('лишних проверок не печатается', dead.checks.length === 0);

  console.log('\n── 4. Пустой домен не роняет проверку ──');
  const none = await maildns.checkDomain('');
  ok('вернулся ответ, а не исключение', !!none && none.ok === false);
  ok('сказано, где искать причину', /APP_URL|EMAIL_FROM/.test(none.verdict));

  console.log('\n── 5. Диагностика без ключа ничего не делает ──');
  // Проверять домен, когда отправка выключена, — сбивать с толку:
  // владелец увидит зелёные записи и не поймёт, почему тишина.
  let email = freshEmail({ EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>' });
  let d = await email.diagnose();
  ok('проверка пропущена', d.skipped === true);
  ok('названа настоящая причина — нет ключа', /SMTPBZ_API_KEY/.test(d.verdict));

  console.log('\n── 6. Чужой отправитель ловится до всякого DNS ──');
  // С адресом на localhost письма не дойдут ни при каких записях —
  // проверять домен бессмысленно, надо чинить EMAIL_FROM.
  email = freshEmail({ SMTPBZ_API_KEY: 'ключ', EMAIL_FROM: 'Aliance Generals <noreply@localhost>' });
  d = await email.diagnose();
  ok('проверка пропущена', d.skipped === true);
  ok('сказано про EMAIL_FROM', /EMAIL_FROM/.test(d.verdict));

  console.log('\n── 7. Мусор в ключе виден без сети ──');
  // Лишний пробел или кавычка ломают заголовок Authorization, а глазом
  // в редакторе это не заметно. Сервис при этом отвечает про доступ, и
  // владелец идёт менять ключ вместо того, чтобы убрать пробел.
  const dom = 'нет-такого-' + 'y'.repeat(20) + '.invalid';
  email = freshEmail({
    SMTPBZ_API_KEY: 'ключ с пробелом',
    EMAIL_FROM: `Aliance Generals <noreply@${dom}>`,
  });
  d = await email.diagnose();
  ok('проверка не пропущена — домен свой', d.skipped === false);
  ok('мусор в ключе замечен', d.keyDirty === true);
  ok('и вынесен в вердикт первым', /пробел или кавычк/i.test(d.verdict));
  ok('ключ показан замаскированным', /…/.test(String(d.keyMasked)));
  ok('целиком ключ наружу не отдаётся', !JSON.stringify(d).includes('ключ с пробелом'));

  console.log('\n── 8. DMARC по ссылке не выдаётся за свою запись ──');
  // Ловушка, на которую эта проверка сама чуть не попалась. Сервисы
  // предлагают «DMARC в один клик»: в зоне появляется не своя
  // TXT-запись, а CNAME на их поддомен. Запрос TXT при этом ПРОЙДЁТ ПО
  // ССЫЛКЕ и вернёт чужую запись — на вид неотличимую от собственной.
  // Проверишь TXT первым, и делегирование покажется своей записью:
  // домен зависит от чужого аккаунта, а проверка про это молчит.
  const V = maildns.dmarcVerdict;
  const POLICY = ['v=DMARC1; p=none; rua=mailto:x@example.ru'];

  const ownRec = V(POLICY, [], 'aliance-general.ru');
  ok('своя TXT-запись признана своей', ownRec.own === true && ownRec.ok === true);
  ok('и чужой зависимостью не считается', ownRec.borrowed === false);
  ok(`показана как своя: «${ownRec.value}»`, /своя запись/.test(ownRec.value));

  // Ровно живой случай: CNAME на чужой сервис, а TXT по ссылке вернул
  // его политику. Именно здесь проверка и обманывалась.
  const viaCname = V(POLICY, ['aliance-general.ru.dmarc.postmarker.ru'], 'aliance-general.ru');
  ok('запись есть — DMARC работает', viaCname.ok === true);
  ok('но своей НЕ считается, хотя TXT вернулся', viaCname.own === false);
  ok('и помечена как чужая зависимость', viaCname.borrowed === true);
  ok(`видно, куда ведёт ссылка: «${viaCname.value}»`, /postmarker\.ru/.test(viaCname.value));

  const inside = V([], ['dmarc.aliance-general.ru.'], 'aliance-general.ru');
  ok('ссылка внутри своего домена чужой не считается', inside.borrowed === false);
  ok('и точка в конце имени не мешает', /dmarc\.aliance-general\.ru$/.test(inside.value));

  const missing = V([], [], 'aliance-general.ru');
  ok('без записи — не ok', missing.ok === false);
  ok('и сказано, что записи нет', /записи нет/.test(missing.value));
  const junk = V(['v=spf1 ~all'], [], 'aliance-general.ru');
  ok('чужая TXT на _dmarc за DMARC не сходит', junk.ok === false);

  console.log('\n── 9. Панель получает всё, что ей нужно нарисовать ──');
  const panel = fs.readFileSync(path.join(ROOT, 'public/js/admin2/mail.js'), 'utf8');
  ok('кнопка проверки домена есть', /id="mail-diag"/.test(panel));
  ok('показывается при любой настроенной отправке', /mail\.configured \?/.test(panel));
  ok('рисует список проверок', /r\.checks \|\| \[\]/.test(panel));
  ok('и готовую строку SPF', /r\.spfFix/.test(panel));
  ok('с предупреждением, что запись правится, а не добавляется',
     /может быть только ОДНА/.test(panel));
  ok('Unisender из панели убран', !/unisender/i.test(panel));

  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
