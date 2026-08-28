// ===================================================================
// src/services/consent.ts — согласия игрока и версии документов
//
// Зачем отдельный модуль. Закон требует, чтобы согласие было
// КОНКРЕТНЫМ, ИНФОРМИРОВАННЫМ и СОЗНАТЕЛЬНЫМ, а согласие на
// распространение данных — ещё и отдельным действием. Прежняя модель
// «зарегистрировался — значит согласился» этому не отвечает: игрок не
// совершал отдельного волеизъявления, и доказать, ЧТО именно он принял
// и КАКОЙ РЕДАКЦИИ, было нечем.
//
// Здесь три вещи, которые обязаны жить в одном месте:
//
//  1. РЕЕСТР ДОКУМЕНТОВ с версиями. Версия — не украшение: если текст
//     изменился существенно, старое согласие его не покрывает, и игрока
//     надо спросить заново. Без номера версии в записи согласия
//     определить это невозможно.
//  2. ЗАПИСЬ СОГЛАСИЯ: что, какой редакции, когда, с какого адреса и
//     каким действием. Это и есть доказательство.
//  3. ОТЗЫВ. Отозванное согласие НЕ удаляется, а помечается временем
//     отзыва: сам факт, что согласие когда-то было, — тоже
//     доказательство законности прошлой обработки.
//
// Отдельно про свободу выбора: обязательными могут быть только те
// согласия, без которых игра физически не работает. Реклама и
// распространение данных к ним не относятся и на регистрацию не влияют.
// ===================================================================
import u = require('../core/utils');

// ── Реестр документов ──────────────────────────────────────────────
// v — версия текста. Поднимается ТОЛЬКО при существенном изменении
// смысла: новая цель обработки, новый получатель, ухудшение условий.
// Правка опечатки версию не меняет — иначе игроки будут пересогласовывать
// документ каждую неделю и перестанут читать.
type DocInfo = { name: string; v: string; at: string; url: string; kind: 'doc' | 'consent' };

const DOCS: Record<string, DocInfo> = {
  terms:    { name: 'Пользовательское соглашение',        v: '1.0', at: '2026-08-26', url: '/terms.html',          kind: 'doc' },
  rules:    { name: 'Правила игры и модерации',           v: '1.0', at: '2026-08-26', url: '/rules.html',          kind: 'doc' },
  payments: { name: 'Правила платежей и возвратов',       v: '1.0', at: '2026-08-26', url: '/payments.html',       kind: 'doc' },
  privacy:  { name: 'Политика обработки персональных данных', v: '1.0', at: '2026-08-26', url: '/privacy.html',    kind: 'doc' },
  cookies:  { name: 'Политика cookie и технических данных', v: '1.0', at: '2026-08-26', url: '/cookies.html',      kind: 'doc' },
  pdn:      { name: 'Согласие на обработку персональных данных', v: '1.0', at: '2026-08-26', url: '/consent-pdn.html',    kind: 'consent' },
  public:   { name: 'Согласие на распространение персональных данных', v: '1.0', at: '2026-08-26', url: '/consent-public.html', kind: 'consent' },
  ads:      { name: 'Согласие на рекламные сообщения',    v: '1.0', at: '2026-08-26', url: '/consent-ads.html',    kind: 'consent' },
};

// ── Что игрок подтверждает ─────────────────────────────────────────
// age18 — не документ, а заявление о возрасте. Проверить его технически
// нельзя, но зафиксировать заявление можно и нужно: сервис рассчитан на
// совершеннолетних, и отсутствие вопроса выглядит хуже, чем ответ на него.
type ConsentDef = {
  id: string;
  doc: string | null;      // какой документ покрывает
  required: boolean;       // без него регистрация невозможна
  title: string;
  about: string;
};

const CONSENTS: ConsentDef[] = [
  {
    id: 'age18', doc: null, required: true,
    title: 'Мне исполнилось 18 лет',
    about: 'Игра рассчитана на совершеннолетних. Регистрация несовершеннолетних не допускается.',
  },
  {
    id: 'terms', doc: 'terms', required: true,
    title: 'Принимаю Пользовательское соглашение, Правила игры и Правила платежей',
    about: 'Договор между вами и Оператором: условия доступа, санкции и порядок оплаты.',
  },
  {
    id: 'pdn', doc: 'pdn', required: true,
    title: 'Согласен(на) на обработку персональных данных',
    about: 'Регистрация, вход, восстановление доступа, поддержка и защита от злоупотреблений.',
  },
  {
    id: 'public', doc: 'public', required: false,
    title: 'Разрешаю показывать мой профиль другим игрокам',
    about: 'Позывной, флаг, уровень и статистика в рейтингах, альянсах и на форуме. '
      + 'Без разрешения публичные функции ограничиваются.',
  },
  {
    id: 'ads', doc: 'ads', required: false,
    title: 'Хочу получать новости, акции и предложения',
    about: 'Необязательно. Отказ не влияет на регистрацию и игру. '
      + 'Служебные письма — код подтверждения, восстановление пароля, санкции — приходят всегда.',
  },
];

const BY_ID: Record<string, ConsentDef> = Object.fromEntries(CONSENTS.map((c) => [c.id, c]));
const REQUIRED = CONSENTS.filter((c) => c.required).map((c) => c.id);

// Категории для согласия на распространение. Закон требует выбора ПО
// КАЖДОЙ категории, а не одной галки на всё.
const PUBLIC_PARTS = [
  { id: 'nick',  name: 'Позывной',            where: 'Профиль, рейтинг, чат, форум' },
  { id: 'flag',  name: 'Страна и флаг',       where: 'Профиль, рейтинг' },
  { id: 'stats', name: 'Уровень и статистика', where: 'Профиль, таблицы' },
  { id: 'ally',  name: 'Альянс и роль',       where: 'Состав альянса, события' },
];

type Record1 = {
  v: string;              // версия документа на момент согласия
  at: number;             // когда дано
  ip?: string;            // с какого адреса
  src?: string;           // каким действием: registration / settings / reconsent
  scope?: Record<string, boolean>;  // для распространения — по категориям
  off?: number;           // когда отозвано (запись не удаляется)
  offSrc?: string;
};

function bag(p: any): Record<string, Record1> {
  if (!p.consents || typeof p.consents !== 'object') p.consents = {};
  return p.consents;
}

// ── Запись согласия ────────────────────────────────────────────────
function record(p: any, id: string, opts: { ip?: string; src?: string; scope?: Record<string, boolean> } = {}) {
  const def = BY_ID[id];
  if (!def) throw new u.ApiError('Неизвестное согласие: ' + id);
  const doc = def.doc ? DOCS[def.doc] : null;
  const rec: Record1 = {
    v: doc ? doc.v : '1.0',
    at: Date.now(),
    ip: String(opts.ip || '').slice(0, 45),
    src: opts.src || 'registration',
  };
  if (id === 'public') {
    // Пустой выбор категорий — это не согласие. Либо есть хоть одна
    // разрешённая категория, либо согласия нет вовсе.
    const scope: Record<string, boolean> = {};
    for (const part of PUBLIC_PARTS) scope[part.id] = !!(opts.scope && opts.scope[part.id]);
    if (!Object.values(scope).some(Boolean)) { withdraw(p, id, opts.ip, opts.src); return; }
    rec.scope = scope;
  }
  bag(p)[id] = rec;
}

// ── Отзыв ──────────────────────────────────────────────────────────
// Запись остаётся: она доказывает законность обработки ДО отзыва.
function withdraw(p: any, id: string, ip?: string, src?: string) {
  const b = bag(p);
  const prev = b[id];
  if (!prev) {
    // Отзывать нечего — но отметку ставим, чтобы «не давал» и «отозвал»
    // не путались между собой при разборе обращения.
    b[id] = { v: BY_ID[id] && BY_ID[id].doc ? DOCS[BY_ID[id].doc as string].v : '1.0',
      at: 0, off: Date.now(), offSrc: src || 'settings', ip: String(ip || '').slice(0, 45) };
    return;
  }
  prev.off = Date.now();
  prev.offSrc = src || 'settings';
}

// Согласие действует: дано и не отозвано.
function has(p: any, id: string): boolean {
  const r = p && p.consents && p.consents[id];
  return !!(r && r.at && !r.off);
}

// Разрешена ли публикация конкретной категории.
// Важный момент про старых игроков: у них поля consents нет вовсе. Резать
// им профиль задним числом нельзя — они регистрировались по прежним
// правилам, и внезапно исчезнувший позывной в рейтинге выглядел бы
// поломкой игры. Поэтому «нет записи» = прежний порядок, а ограничение
// включается только тем, кто ЯВНО отказался.
function canShow(p: any, part: string): boolean {
  const r = p && p.consents && p.consents.public;
  if (!r) return true;
  if (r.off || !r.at) return false;
  return !!(r.scope && r.scope[part]);
}

// ── Проверка при регистрации ───────────────────────────────────────
function checkRequired(given: any) {
  const g = given && typeof given === 'object' ? given : {};
  for (const id of REQUIRED) {
    if (g[id]) continue;
    const def = BY_ID[id];
    throw new u.ApiError(
      id === 'age18'
        ? 'Регистрация доступна с 18 лет — подтвердите возраст'
        : `Отметьте: «${def.title}»`);
  }
}

// Записать всё, что пришло из формы регистрации.
function applyRegistration(p: any, given: any, ip?: string) {
  const g = given && typeof given === 'object' ? given : {};
  for (const def of CONSENTS) {
    if (g[def.id]) record(p, def.id, { ip, src: 'registration', scope: g.publicScope });
    else if (!def.required) withdraw(p, def.id, ip, 'registration');
  }
}

// ── Устаревшие согласия ────────────────────────────────────────────
// Документ переписали существенно — старое согласие его не покрывает.
// Спрашиваем заново, но НЕ выкидываем игрока из игры: молчаливое
// «продолжение использования» согласием не считается, а вот запирать
// дверь из-за правки документа несоразмерно.
type Stale = { id: string; title: string; doc: DocInfo | null; was: string; now: string };

function outdated(p: any): Stale[] {
  const out: Stale[] = [];
  for (const def of CONSENTS) {
    if (!def.required) continue;               // необязательные не навязываем
    const r = p && p.consents && p.consents[def.id];
    const doc = def.doc ? DOCS[def.doc] : null;
    const now = doc ? doc.v : '1.0';
    if (!r || !r.at || r.off) { out.push({ id: def.id, title: def.title, doc, was: '', now }); continue; }
    if (String(r.v) !== now) out.push({ id: def.id, title: def.title, doc, was: String(r.v), now });
  }
  return out;
}

// ── Для интерфейса и панели ────────────────────────────────────────
function view(p: any) {
  const b = (p && p.consents) || {};
  return {
    docs: DOCS,
    parts: PUBLIC_PARTS,
    // Чего не хватает или что устарело. Сюда попадают и старые игроки,
    // зарегистрировавшиеся до появления отметок: у них согласий нет
    // вовсе. Резать им игру задним числом нельзя — они пришли по
    // прежним правилам, — но и делать вид, что согласие есть, тоже.
    needed: outdated(p),
    items: CONSENTS.map((def) => {
      const r = b[def.id] || null;
      return {
        id: def.id,
        title: def.title,
        about: def.about,
        required: def.required,
        doc: def.doc ? { ...DOCS[def.doc], id: def.doc } : null,
        given: !!(r && r.at && !r.off),
        at: r ? r.at : 0,
        version: r ? r.v : '',
        withdrawnAt: r && r.off ? r.off : 0,
        scope: r && r.scope ? r.scope : null,
        stale: !!(r && r.at && !r.off && def.doc && String(r.v) !== DOCS[def.doc].v),
      };
    }),
  };
}

export = {
  DOCS, CONSENTS, PUBLIC_PARTS, REQUIRED,
  record, withdraw, has, canShow,
  checkRequired, applyRegistration, outdated, view,
};
