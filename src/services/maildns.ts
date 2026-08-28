// ===================================================================
// src/services/maildns.ts — проверка почтовых записей домена
//
// Одно место, где записано, ЧТО должно стоять в DNS, чтобы письма
// уходили. Пользуются двое: панель («Письма» → «Проверить домен») и
// tools/check-dns.js. Раньше это знание было только в инструменте, и
// владелец узнавал о непрописанной записи, лишь когда игроки переставали
// получать коды.
//
// Ничего не отправляет и не меняет — только спрашивает DNS. Лимит писем
// проверка не тратит: это принципиально, иначе диагностика съедала бы
// то, ради чего её запускают.
// ===================================================================
import dnsMod = require('dns');
const dns = dnsMod.promises;

// ── Что требует почтовый сервис ────────────────────────────────────
// Список, а не набор разрозненных проверок: появится второй сервис —
// добавится строка, и панель с инструментом узнают о нём сами.
type Provider = {
  id: string;
  name: string;
  role: string;
  spf: string;                                   // что должно быть внутри SPF
  dkim: string[];                                // селекторы, любой подойдёт
  cname: { name: string; value: string } | null; // поддомен статистики
};

const PROVIDERS: Provider[] = [
  {
    id: 'smtpbz',
    name: 'SMTP.BZ',
    role: 'основной',
    spf: 'include:spf.smtp.bz',
    dkim: ['smtpbz'],
    cname: { name: 'stats', value: 'smtp.bz' },
  },
];

// ── Сборка единственной SPF-записи ─────────────────────────────────
// SPF в домене может быть ТОЛЬКО ОДНА. Две записи — не «двойная
// защита», а ошибка стандарта: почтовики считают домен ненастроенным и
// перестают проходить проверку по ВСЕМ письмам, включая те, что уходили
// раньше. Ровно сюда попадают, когда новый сервис просит «добавьте
// SPF», а старая запись уже лежит рядом.
//
// Поэтому проверка не просто ругается на дубль, а собирает готовую
// строку: то, что владелец вписал руками (a, mx, ip4:, чужие include),
// плюс то, чего не хватает сервисам.
function mergedSpf(current: string, needed: string[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); parts.push(p); }
  };
  for (const tok of String(current || '').split(/\s+/)) {
    if (!tok || /^v=spf1$/i.test(tok) || /^[~\-+?]all$/i.test(tok)) continue;
    add(tok);
  }
  for (const inc of needed) add(inc);
  return 'v=spf1 ' + parts.join(' ') + ' ~all';
}

// ── Разбор DMARC ───────────────────────────────────────────────────
// Вынесено отдельной функцией не ради красоты, а чтобы это можно было
// проверить вызовом, а не чтением кода: порядок проверок здесь
// неочевиден и ошибиться легко.
//
// Тонкость. Сервисы предлагают «DMARC в один клик»: вместо своей
// TXT-записи в зоне появляется CNAME на их поддомен. Работает — пока
// жив аккаунт у этого сервиса. Закрыли аккаунт, сменили сервис — ссылка
// перестаёт отвечать, и DMARC у домена исчезает молча.
//
// И главное: если на имени стоит CNAME, запрос TXT ПРОЙДЁТ ПО ССЫЛКЕ и
// вернёт чужую запись, на вид неотличимую от своей. Проверишь TXT
// первым — делегирование покажется собственной записью, то есть
// проверка сама спрячет ту зависимость, ради которой написана. Поэтому
// CNAME смотрим раньше: по стандарту у имени с CNAME своих записей быть
// не может.
type DmarcVerdict = { ok: boolean; own: boolean; borrowed: boolean; value: string };

function dmarcVerdict(txtRecords: string[], cnameRecords: string[], dom: string): DmarcVerdict {
  const delegated = !!(cnameRecords && cnameRecords.length);
  const target = delegated ? String(cnameRecords[0]).toLowerCase().replace(/\.$/, '') : '';
  const own = !delegated && (txtRecords || []).some((r) => /^v=DMARC1/i.test(r));
  const domain = String(dom || '').toLowerCase();
  // Ссылка внутри своего же домена чужой зависимостью не является.
  const borrowed = delegated && !!domain && !target.endsWith(domain);
  return {
    ok: own || delegated,
    own,
    borrowed,
    value: own ? 'своя запись' : (delegated ? `ссылка на ${target}` : 'записи нет'),
  };
}

async function txt(name: string): Promise<string[]> {
  try { return (await dns.resolveTxt(name)).map((a) => a.join('')); }
  catch (e) { return []; }
}
async function cname(name: string): Promise<string[]> {
  try { return await dns.resolveCname(name); }
  catch (e) { return []; }
}

type Check = { ok: boolean; title: string; value: string; hint: string };
type DomainReport = {
  domain: string;
  ok: boolean;                 // домен готов отправлять
  ns: string[];
  panel: string;               // где править записи
  checks: Check[];
  spfFix: string;              // готовая строка SPF, если нужна правка
  verdict: string;
};

async function checkDomain(domain: string): Promise<DomainReport> {
  const dom = String(domain || '').trim().toLowerCase();
  const out: DomainReport = { domain: dom, ok: false, ns: [], panel: '', checks: [], spfFix: '', verdict: '' };
  if (!dom) { out.verdict = 'Домен не задан: проверьте APP_URL или EMAIL_FROM.'; return out; }

  // Первое, что нужно знать владельцу, — в чьей панели править записи.
  try { out.ns = await dns.resolveNs(dom); } catch (e) { out.ns = []; }
  if (!out.ns.length) {
    out.verdict = `Домен ${dom} не отвечает вообще. Проверьте, что он оплачен и делегирован.`;
    return out;
  }
  const hint = out.ns.join(' ');
  out.panel = /selectel/i.test(hint) ? 'Selectel (my.selectel.ru → DNS-хостинг)'
    : /reg\.ru/i.test(hint) ? 'reg.ru'
      : /timeweb/i.test(hint) ? 'Timeweb'
        : /beget/i.test(hint) ? 'Beget'
          : /cloudflare/i.test(hint) ? 'Cloudflare'
            : /yandex/i.test(hint) ? 'Яндекс'
              : '';

  const needSpf = PROVIDERS.map((p) => p.spf);

  // ── SPF ──────────────────────────────────────────────────────────
  const root = await txt(dom);
  const spf = root.filter((r) => /^v=spf1/i.test(r));
  let spfOk = false;
  if (!spf.length) {
    out.spfFix = mergedSpf('', needSpf);
    out.checks.push({
      ok: false, title: 'SPF', value: 'записи нет',
      hint: 'Добавьте TXT на @ (в Selectel имя оставить ПУСТЫМ) со значением ниже.',
    });
  } else if (spf.length > 1) {
    out.spfFix = mergedSpf(spf.join(' '), needSpf);
    out.checks.push({
      ok: false, title: 'SPF', value: spf.join('  ||  '),
      hint: 'Записей ДВЕ — так нельзя: проверку не пройдёт ни одно письмо домена. '
        + 'Удалите лишнюю и оставьте одну строку (ниже).',
    });
  } else {
    const missing = PROVIDERS.filter((p) => !spf[0].toLowerCase().includes(p.spf.toLowerCase()));
    spfOk = missing.length === 0;
    if (!spfOk) out.spfFix = mergedSpf(spf[0], needSpf);
    out.checks.push({
      ok: spfOk, title: 'SPF', value: spf[0],
      hint: spfOk ? '' : 'Не хватает: ' + missing.map((p) => `${p.name} (${p.spf})`).join(', ')
        + '. Не добавляйте вторую запись — исправьте эту на строку ниже.',
    });
  }

  // ── DKIM и поддомены у каждого сервиса ───────────────────────────
  let allDkim = true;
  for (const p of PROVIDERS) {
    let found = '';
    let len = 0;
    for (const sel of p.dkim) {
      const rec = await txt(`${sel}._domainkey.${dom}`);
      const v = rec.find((r) => /v=DKIM1/i.test(r));
      if (v) { found = sel; len = v.length; break; }
    }
    if (!found) allDkim = false;
    out.checks.push({
      ok: !!found,
      title: `DKIM ${p.name}`,
      value: found ? `${found}._domainkey — ключ найден (${len} символов)` : 'записи нет',
      hint: found ? '' : `Добавьте TXT ${p.dkim[0]}._domainkey со значением из кабинета `
        + `${p.name}. В Selectel имя пишется без домена.`,
    });

    if (p.cname) {
      const got = await cname(`${p.cname.name}.${dom}`);
      out.checks.push({
        ok: !!got.length,
        title: `CNAME ${p.cname.name}`,
        value: got.length ? `${p.cname.name}.${dom} → ${got[0]}` : 'записи нет',
        // Без него письма всё равно уходят — не пугаем владельца зря.
        hint: got.length ? '' : `Добавьте CNAME ${p.cname.name} → ${p.cname.value}. `
          + 'Письма уйдут и без него, но статистика открытий считаться не будет.',
      });
    }
  }

  // ── DMARC ────────────────────────────────────────────────────────
  const dm = dmarcVerdict(await txt('_dmarc.' + dom), await cname('_dmarc.' + dom), dom);
  out.checks.push({
    ok: dm.ok, title: 'DMARC', value: dm.value,
    hint: !dm.ok ? 'Письма уйдут и без неё, но в спам будут попадать чаще.'
      : (dm.borrowed
        ? 'Запись не своя — это ссылка на чужой сервис. Закроется аккаунт там — DMARC '
          + 'у домена пропадёт молча. Надёжнее своя TXT на _dmarc, например: '
          + `v=DMARC1; p=none; rua=mailto:postmaster@${dom}`
        : ''),
  });

  // Готовность считаем по обязательному: SPF и DKIM. CNAME и DMARC —
  // качество доставки, а не пропуск. Смешать их значило бы пугать
  // владельца красным там, где всё работает.
  out.ok = spfOk && allDkim;
  out.verdict = out.ok
    ? 'Обязательные записи на месте. Возвращайтесь в кабинет сервиса и нажимайте «Проверить».'
    : 'Не хватает записей. Добавьте недостающее и проверьте снова через 15–30 минут: '
      + 'записи расходятся по интернету не сразу.';
  return out;
}

export = { PROVIDERS, mergedSpf, dmarcVerdict, checkDomain };
