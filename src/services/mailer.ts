// ═══════════════════════════════════════════════════════════════════
// src/services/mailer.ts — шаблоны писем и рассылка
//
// Зачем отдельный модуль: раньше текст письма был вшит в код (email.ts),
// и любая правка «Привет, боец» требовала правки исходников, сборки и
// перезапуска сервера. Теперь текст живёт в базе и меняется из панели,
// а код только подставляет значения.
//
// Четыре шаблона:
//   verify  — код подтверждения почты при регистрации;
//   welcome — приветственное письмо после подтверждения;
//   reset   — восстановление пароля;
//   news    — новостная рассылка (шлётся вручную из панели).
//
// Подстановки в тексте пишутся фигурными скобками: {{имя}}, {{ссылка}},
// {{игра}}, {{сайт}}. Именно по-русски: шаблон правит владелец игры, а
// не программист, и {{name}} рядом с русским текстом читается хуже.
//
// Что НЕ настраивается из панели: адрес отправителя и ключ сервиса —
// они в переменных окружения. Это граница безопасности: тот, кто получил
// доступ к панели, не должен уметь слать письма от чужого имени.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import email = require('./email');
import brand = require('../core/brand');
import type { Notices } from '../types';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const GAME_NAME = brand.GAME_NAME;

// ── Заводские шаблоны ──────────────────────────────────────────────
// Они же — то, что уходит игрокам, пока владелец ничего не менял.
// Кнопка «Вернуть заводской» возвращает ровно этот текст.
const DEFAULTS: Record<string, { name: string; subject: string; html: string; vars: string[]; about: string }> = {
  verify: {
    name: 'Подтверждение почты',
    about: 'Уходит сразу после регистрации. Пока почта не подтверждена, игрок в игру не попадёт.',
    vars: ['{{имя}}', '{{код}}', '{{ссылка}}', '{{игра}}', '{{сайт}}'],
    subject: 'Код подтверждения {{код}} — {{игра}}',
    // Код стоит первым и крупно: игрок регистрируется на одном
    // устройстве, а почту часто открывает на другом, и ссылка тогда
    // приводит его в чужой браузер, где он не зарегистрирован. Код
    // переносится глазами и работает в любом случае.
    html: `<h2 style="margin:0 0 14px;color:#2e5b1f;font-size:22px">Привет, {{имя}}!</h2>
<p style="margin:0 0 18px">Вот код подтверждения для входа в игру «{{игра}}». Впишите его в окно регистрации:</p>
<p style="margin:0 0 22px;padding:14px 10px;background:#efe6d2;border:1px dashed #b8892f;border-radius:8px;text-align:center;font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:#26221c">{{код}}</p>
<p style="margin:0 0 10px;font-size:14px;color:#5c564c">Код действует 30 минут. Если окно регистрации закрылось — откройте игру и нажмите «Ввести код с почты».</p>
<p style="margin:22px 0 0;font-size:14px;color:#5c564c">Можно и просто перейти по ссылке:<br>
  <a href="{{ссылка}}" style="color:#a8761f">{{ссылка}}</a></p>
<p style="margin:22px 0 0;font-size:13px;color:#8b8578">Если вы не регистрировались — просто не отвечайте на это письмо, аккаунт не активируется.</p>`,
  },

  welcome: {
    name: 'Приветственное письмо',
    about: 'Уходит само, сразу после успешного подтверждения почты. Это первое впечатление об игре.',
    vars: ['{{имя}}', '{{игра}}', '{{сайт}}'],
    subject: 'Добро пожаловать в «{{игра}}», {{имя}}!',
    html: `<h2 style="margin:0 0 14px;color:#2e5b1f;font-size:22px">В строю, {{имя}}!</h2>
<p style="margin:0 0 18px">Аккаунт активирован. Ниже — коротко о том, что вас ждёт.</p>

<p style="margin:0 0 16px"><b style="color:#a8761f">⚔ Армия и бои</b><br>
Нанимайте технику, качайте характеристики и деритесь с другими игроками. Победа приносит трофеи, поражение — опыт и повод пересобрать состав.</p>

<p style="margin:0 0 16px"><b style="color:#a8761f">🏭 Хозяйство</b><br>
Стройте базу, добывайте ресурсы в шахтах, торгуйте на рынке. Экономика кормит армию — без неё воевать не на что.</p>

<p style="margin:0 0 16px"><b style="color:#a8761f">🛡 Легион</b><br>
Вступайте в легион или соберите свой. Групповые сражения, общая казна, совместные постройки — в одиночку столько не вытянуть.</p>

<p style="margin:0 0 4px"><b style="color:#a8761f">🎖 Задания и сезоны</b><br>
Ежедневные задания, турниры и сезонный рейтинг. Награды в конце сезона получают те, кто играл, а не те, кто больше заплатил.</p>

<p style="margin:26px 0 8px;text-align:center">
  <a href="{{сайт}}" style="display:inline-block;padding:14px 34px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:8px;font-weight:bold;font-size:17px">В игру</a>
</p>
<p style="margin:18px 0 0;font-size:13px;color:#8b8578">Совет напоследок: не сливайте весь стартовый капитал в технику. Первые постройки окупаются быстрее, чем кажется.</p>`,
  },
  reset: {
    name: 'Восстановление пароля',
    about: 'Уходит по кнопке «Забыли пароль». Ссылка действует ограниченное время.',
    vars: ['{{имя}}', '{{ссылка}}', '{{игра}}', '{{сайт}}'],
    subject: 'Восстановление пароля — {{игра}}',
    html: `<h2 style="margin:0 0 14px;color:#2e5b1f;font-size:22px">Привет, {{имя}}!</h2>
<p style="margin:0 0 18px">Вы запросили смену пароля в игре «{{игра}}». Нажмите кнопку, чтобы задать новый:</p>
<p style="margin:26px 0;text-align:center">
  <a href="{{ссылка}}" style="display:inline-block;padding:14px 30px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px">Задать новый пароль</a>
</p>
<p style="margin:0 0 6px;font-size:14px;color:#5c564c">Если кнопка не работает, откройте ссылку:<br>
  <a href="{{ссылка}}" style="color:#a8761f">{{ссылка}}</a></p>
<p style="margin:22px 0 0;font-size:13px;color:#8b8578">Если вы не запрашивали смену — просто не отвечайте: пароль останется прежним, а все открытые входы в аккаунт закроются только после реальной смены.</p>`,
  },
  news: {
    name: 'Новостная рассылка',
    about: 'Ничего не отправляет сама по себе — только когда вы нажмёте «Разослать».',
    vars: ['{{имя}}', '{{игра}}', '{{сайт}}'],
    subject: 'Новости игры {{игра}}',
    html: `<h2 style="margin:0 0 14px;color:#2e5b1f;font-size:22px">Привет, {{имя}}!</h2>
<p style="margin:0 0 18px">Здесь текст новости. Замените его своим — оформление письма подставится само.</p>
<p style="margin:26px 0 0;text-align:center">
  <a href="{{сайт}}" style="display:inline-block;padding:14px 34px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:8px;font-weight:bold;font-size:17px">Играть</a>
</p>`,
  },
};

type Tpl = { subject: string; html: string; changedAt?: number; changedBy?: string };

function store(): Record<string, Tpl> {
  return db.load<Record<string, Tpl>>('mailTemplates', {});
}

// Шаблон с подстановкой заводского, если владелец его не менял
function tplOf(id: string): Tpl {
  const d = DEFAULTS[id];
  if (!d) throw new u.ApiError('Неизвестный шаблон письма');
  const saved = store()[id];
  return {
    subject: (saved && saved.subject) || d.subject,
    html: (saved && saved.html) || d.html,
    changedAt: (saved && saved.changedAt) || 0,
    changedBy: (saved && saved.changedBy) || '',
  };
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]));
}

// ── Чистка разметки письма ─────────────────────────────────────────
// Тексты правит владелец — человек доверенный, так что это не защита от
// него, а защита письма. Причины две:
//
//  1. Визуальный редактор в панели строит разметку сам, и браузеры любят
//     подсовывать своё: <font>, <meta>, style-теги из буфера обмена при
//     вставке текста из Word. Почтовые клиенты такое режут по-своему, и
//     письмо у половины игроков выглядит иначе, чем в панели.
//  2. Если текст письма когда-нибудь начнёт править не только владелец,
//     граница уже будет на месте, а не «добавим потом».
//
// Разрешаем ровно то, что переживает почтовые клиенты.
const ALLOWED_TAGS: Record<string, string[]> = {
  p: ['style'], div: ['style'], span: ['style'], br: [], hr: ['style'],
  b: ['style'], strong: ['style'], i: ['style'], em: ['style'], u: ['style'], s: ['style'],
  h1: ['style'], h2: ['style'], h3: ['style'],
  a: ['href', 'style', 'target', 'rel'],
  ul: ['style'], ol: ['style'], li: ['style'],
  blockquote: ['style'],
  img: ['src', 'alt', 'width', 'height', 'style'],
  table: ['style', 'width', 'cellpadding', 'cellspacing', 'border'],
  thead: ['style'], tbody: ['style'], tr: ['style'], td: ['style'], th: ['style'],
};

// Адрес в ссылке или картинке. Пропускаем http(s), почту и нашу
// подстановку — она стоит прямо в href у кнопки подтверждения.
function safeUrl(raw: string): string | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^\{\{[^{}]+\}\}$/.test(v)) return v;
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  return null;
}

function safeStyle(raw: string): string {
  // В письме нет скриптов, но старые почтовые клиенты понимали
  // expression() и url(javascript:) — вырезаем на всякий случай.
  return String(raw || '')
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:/gi, 'url(')
    .replace(/["<>]/g, '')
    .trim();
}

function sanitizeHtml(html: string): string {
  let out = String(html || '');
  // Блоки, которые вырезаем вместе с содержимым — их текст в письме не нужен
  out = out.replace(/<(script|style|iframe|object|embed|noscript|form|input|button|svg)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|iframe|object|embed|noscript|form|input|button|svg)\b[^>]*\/?>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  return out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, slash, rawName, rawAttrs) => {
    const name = String(rawName).toLowerCase();
    const allowed = ALLOWED_TAGS[name];
    // Незнакомый тег убираем, а текст внутри оставляем: письмо потеряет
    // оформление, но не содержание.
    if (!allowed) return '';
    if (slash) return `</${name}>`;

    const attrs: string[] = [];
    const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(rawAttrs || '')))) {
      const attr = m[1].toLowerCase();
      const val = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5] || '');
      if (!allowed.includes(attr)) continue;      // сюда же уходят все on*=
      if (attr === 'href' || attr === 'src') {
        const url = safeUrl(val);
        if (!url) continue;
        attrs.push(`${attr}="${url.replace(/"/g, '&quot;')}"`);
      } else if (attr === 'style') {
        const st = safeStyle(val);
        if (st) attrs.push(`style="${st}"`);
      } else {
        attrs.push(`${attr}="${escapeHtml(val)}"`);
      }
    }
    return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  });
}

// Подстановка значений. Имя игрока экранируем: позывной проверяется при
// регистрации, но письмо — не то место, где стоит на это полагаться.
// Ссылку не экранируем: её собирает сервер, и внутри неё есть /#, которое
// экранирование сломает.
function fill(text: string, vars: Record<string, string>): string {
  let out = String(text || '');
  for (const [k, v] of Object.entries(vars)) {
    const safe = k === 'ссылка' ? String(v) : escapeHtml(String(v));
    out = out.split('{{' + k + '}}').join(safe);
  }
  return out;
}

// Что осталось в фигурных скобках после подстановки — то есть опечатка
// или выдуманная подстановка вроде {{Альянс Генералов}}.
function leftovers(text: string): string[] {
  const found = String(text || '').match(/\{\{[^{}]*\}\}/g) || [];
  return Array.from(new Set(found));
}

// Снимаем скобки с того, что подставить не удалось.
//
// Зачем вообще: двойные фигурные скобки — это ЕЩЁ И синтаксис самого
// Unisender. Нераспознанное {{…}} уезжает к нему, он видит свою
// подстановку с кириллицей внутри и отклоняет письмо целиком:
//   Invalid substitution format 'Альянс Генералов'
// То есть опечатка в шаблоне превращалась в наглухо несработавшую
// регистрацию, а причина была написана на языке чужого сервиса.
//
// Текст оставляем, скобки убираем: владелец, написавший
// «Подтверждение почты — {{Альянс Генералов}}», хотел увидеть в теме
// название игры. Он его и увидит, а письмо уйдёт.
function stripUnknownVars(text: string): string {
  return String(text || '').replace(/\{\{([^{}]*)\}\}/g, (_m, inner) => escapeHtml(String(inner).trim()));
}

// ── Оформление письма ──────────────────────────────────────────────
// Владелец правит только содержание, вёрстку конверта берём на себя.
//
// Почему таблицами, а не div с flex: почтовые клиенты — не браузеры.
// Outlook рисует письмо движком Word, Gmail вырезает <style> из <head>,
// у половины клиентов нет ни flex, ни grid, ни медиазапросов. Таблица с
// шириной 100% и внутренней колонкой фиксированной ширины — это то, что
// одинаково понимают все с девяностых: на широком экране письмо стоит
// по центру, на телефоне занимает ширину экрана целиком.
//
// Все стили — прямо на тегах. Общий CSS почта выбрасывает.
const MAIL_BG = '#141210';        // тёмный фон-подложка, как в игре
const MAIL_CARD = '#f7f3ea';      // светлая «бумага» письма: читать легче
const MAIL_GOLD = '#d9a546';      // акцент игры
const MAIL_INK = '#26221c';

function envelope(inner: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(GAME_NAME)}</title></head>
<body style="margin:0;padding:0;background:${MAIL_BG};">
<!-- Строка-подсказка в списке писем: без неё почтовик показывает
     первые слова разметки. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">
${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${MAIL_BG};margin:0;padding:0">
  <tr><td align="center" style="padding:24px 12px">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;border-collapse:collapse">

      <!-- Шапка -->
      <tr><td align="center" style="padding:0 0 18px">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:3px;
                    color:${MAIL_GOLD};text-transform:uppercase;font-weight:bold">
          ★ ${escapeHtml(GAME_NAME)} ★
        </div>
      </td></tr>

      <!-- Само письмо -->
      <tr><td style="background:${MAIL_CARD};border-radius:10px;
                     border-top:3px solid ${MAIL_GOLD};padding:28px 26px;
                     font-family:Arial,Helvetica,sans-serif;font-size:16px;
                     line-height:1.55;color:${MAIL_INK}">
${inner}
      </td></tr>

      <!-- Подвал -->
      <tr><td align="center" style="padding:18px 10px 0;
                     font-family:Arial,Helvetica,sans-serif;font-size:12px;
                     line-height:1.5;color:#8b8578">
        <a href="${escapeHtml(APP_URL)}" style="color:${MAIL_GOLD};text-decoration:none">${escapeHtml(APP_URL.replace(/^https?:\/\//, ''))}</a><br>
        Это письмо пришло, потому что на этот адрес заводили аккаунт в игре.
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

// Первые слова письма — их почтовик показывает в списке рядом с темой.
// Берём из текста, сняв разметку: иначе игрок увидит «h2 style color».
function preheaderOf(html: string): string {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
}

// Готовое письмо: тема и разметка.
function render(id: string, vars: Record<string, string>): { subject: string; html: string } {
  const t = tplOf(id);
  const all = { игра: GAME_NAME, сайт: APP_URL, ...vars };
  // stripUnknownVars — последний рубеж: шаблон мог быть сохранён до того,
  // как появилась проверка при сохранении. Лучше отправить письмо с
  // текстом без скобок, чем не отправить совсем.
  let body = stripUnknownVars(fill(t.html, all));

  // Спасательный круг для устаревшего шаблона подтверждения.
  //
  // Шаблон, однажды сохранённый из панели, живёт в базе и больше не
  // обновляется вместе с заводским. Владелец нажал «Сохранить» ещё до
  // того, как появился код из шести цифр, — и с тех пор игрокам уходило
  // старое письмо с одной кнопкой. Форма регистрации при этом требовала
  // код, которого в письме нет: тупик, причём молчаливый.
  //
  // Чужой текст не переписываем — дописываем код в само письмо и громко
  // ругаемся в консоль. Владелец поправит шаблон, когда дойдут руки, а
  // игроки регистрируются уже сейчас.
  if (id === 'verify' && vars['код'] && !t.html.includes('{{код}}')) {
    console.warn('📧 Шаблон «Подтверждение почты» устарел: в нём нет {{код}}. '
      + 'Код дописан в письмо автоматически. Панель → «Письма» → «Вернуть заводской».');
    body += `\n<p style="margin:22px 0 0;padding:14px 10px;background:#efe6d2;border:1px dashed #b8892f;`
      + `border-radius:8px;text-align:center;font-family:'Courier New',Courier,monospace;`
      + `font-size:32px;font-weight:bold;letter-spacing:8px;color:#26221c">`
      + escapeHtml(String(vars['код'])) + `</p>`
      + `<p style="margin:8px 0 0;font-size:14px;color:#5c564c">Код для окна регистрации. Действует 30 минут.</p>`;
  }

  return {
    subject: stripUnknownVars(fill(t.subject, all)),
    html: envelope(body, preheaderOf(body)),
  };
}

// Обязательные подстановки: без них письмо бесполезно. Проверяем и при
// сохранении, и при показе — сохранённые раньше шаблоны про новые
// требования, разумеется, не знают.
function missingVars(id: string, html: string): string[] {
  const need: string[] = [];
  if (id === 'verify' && !html.includes('{{код}}')) need.push('{{код}}');
  if (id === 'reset' && !html.includes('{{ссылка}}')) need.push('{{ссылка}}');
  return need;
}

// ── Панель: список шаблонов ────────────────────────────────────────
function list() {
  return {
    templates: Object.keys(DEFAULTS).map((id) => {
      const saved = store()[id];
      const t = tplOf(id);
      return {
        id,
        name: DEFAULTS[id].name,
        about: DEFAULTS[id].about,
        vars: DEFAULTS[id].vars,
        subject: t.subject,
        html: t.html,
        isDefault: !saved,
        changedAt: t.changedAt || 0,
        changedBy: t.changedBy || '',
        // Чего не хватает сохранённому шаблону против заводского. Пустой
        // список — всё в порядке. Иначе письмо уходит неполным, а узнать
        // об этом можно было только по жалобам игроков.
        missing: saved ? missingVars(id, t.html) : [],
      };
    }),
    mail: email.status(),
  };
}

function save(actorName: string, id: string, subject: string, html: string, notices: Notices) {
  if (!DEFAULTS[id]) throw new u.ApiError('Неизвестный шаблон письма');
  const s = String(subject || '').trim();
  // Чистим ДО проверок: визуальный редактор и вставка из Word тащат
  // мусорные теги, и проверять надо то, что реально ляжет в базу.
  const h = sanitizeHtml(String(html || '')).trim();
  if (!s) throw new u.ApiError('Тема письма не может быть пустой');
  if (!h) throw new u.ApiError('Текст письма не может быть пустым');
  // Ссылка в письмах подтверждения и сброса — единственное, ради чего
  // письмо вообще отправляется. Шаблон без неё бесполезен, и молча
  // сохранять такой нельзя: игроки просто не смогут ни подтвердить
  // почту, ни сменить пароль, а узнаете вы об этом по жалобам.
  // Без этих подстановок письмо бесполезно, и молча сохранять такой
  // шаблон нельзя: игрок не сможет ни подтвердить почту, ни сменить
  // пароль, а узнаете вы об этом по жалобам через неделю.
  if (id === 'reset' && !h.includes('{{ссылка}}')) {
    throw new u.ApiError('В этом письме обязательна подстановка {{ссылка}} — без неё игроку некуда переходить');
  }
  if (id === 'verify' && !h.includes('{{код}}') && !h.includes('{{ссылка}}')) {
    throw new u.ApiError('В письме подтверждения нужна хотя бы одна подстановка — {{код}} или {{ссылка}}, иначе игроку нечем подтвердить почту');
  }
  // Выдуманная подстановка вроде {{Альянс Генералов}} — самая обидная
  // ошибка: сохранилась бы молча, а письмо отклонил бы уже почтовый
  // сервис, ответив про «invalid substitution format» — на своём языке
  // и про свои правила. Ловим здесь, пока владелец смотрит на поле.
  // Список разрешённого берём из САМОГО шаблона, а не переписываем
  // руками рядом. Написанный руками он уже разошёлся с настоящим: у
  // письма подтверждения появился {{код}}, а сюда его добавить забыли —
  // и новый заводской шаблон стало невозможно сохранить, панель ругалась
  // на подстановку, которую сама же и предлагает кнопкой.
  const allowed: Record<string, string> = {};
  for (const v of DEFAULTS[id].vars) allowed[v.replace(/[{}]/g, '')] = '';
  const bad = leftovers(fill(s + ' ' + h, allowed));
  if (bad.length) {
    throw new u.ApiError(
      `Неизвестная подстановка: ${bad.join(', ')}. `
      + `Доступны только ${DEFAULTS[id].vars.join(', ')} — остальное пишите обычным текстом, без фигурных скобок.`);
  }
  const all = store();

  // Сохранение текста, который слово в слово совпадает с заводским, —
  // это не правка, а нажатая кнопка. Раньше оно всё равно создавало
  // копию в базе, и шаблон навсегда отцеплялся от заводского: все
  // будущие улучшения проходили мимо. Именно так письмо подтверждения
  // осталось без кода. Ничего не сохраняем — остаёмся на заводской ветке.
  if (s === DEFAULTS[id].subject && h === DEFAULTS[id].html) {
    delete all[id];
    db.save('mailTemplates');
    notices.push(`✉️ Шаблон «${DEFAULTS[id].name}» совпадает с заводским — оставлен заводским.`);
    return { ok: true, id, isDefault: true };
  }

  all[id] = { subject: s, html: h, changedAt: Date.now(), changedBy: String(actorName || '') };
  db.save('mailTemplates');
  notices.push(`✉️ Шаблон «${DEFAULTS[id].name}» сохранён.`);
  return { ok: true, id };
}

function resetToDefault(id: string, notices: Notices) {
  if (!DEFAULTS[id]) throw new u.ApiError('Неизвестный шаблон письма');
  const all = store();
  delete all[id];
  db.save('mailTemplates');
  notices.push(`↩️ Шаблон «${DEFAULTS[id].name}» возвращён к заводскому.`);
  return { ok: true, id };
}

// Пробное письмо себе — единственный честный способ увидеть, как шаблон
// выглядит в почте. Предпросмотр в браузере врёт: почтовые клиенты режут
// разметку по-своему.
async function sendPreview(id: string, to: string, playerName: string) {
  if (!DEFAULTS[id]) throw new u.ApiError('Неизвестный шаблон письма');
  const addr = String(to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new u.ApiError('Укажите адрес, куда отправить образец');
  const r = render(id, { имя: playerName || 'Боец', код: '482913', ссылка: `${APP_URL}/#пример-ссылки` });
  const res = await email.sendMail(addr, '[образец] ' + r.subject, r.html);
  if (!res.sent) throw new u.ApiError('Письмо не ушло: ' + (res.error || 'причина неизвестна'));
  return { ok: true, to: addr };
}

// ═══ РАССЫЛКА ══════════════════════════════════════════════════════
// Идёт в фоне: 2000 писем в одном запросе — это несколько минут, за
// которые панель отвалится по таймауту, а половина адресов останется
// без письма и никто не узнает какая.
//
// Состояние храним в базе: перезапуск сервера посреди рассылки не должен
// оставлять после себя загадку «дошло или нет».
type Job = {
  startedAt: number; finishedAt: number;
  subject: string;
  total: number; sent: number; failed: number;
  queue: Array<{ id: string; email: string; name: string }>;
  errors: Array<{ email: string; error: string }>;
  by: string;
  stopped?: boolean;
};

function job(): Job | null {
  const s = db.load<any>('broadcast', {});
  return s && s.startedAt ? s as Job : null;
}

const SEND_GAP_MS = 400;   // пауза между письмами: бесплатные тарифы не любят залпы

function tickSend(): void {
  const j = job();
  if (!j || j.finishedAt || j.stopped) return;
  const next = j.queue.shift();
  if (!next) {
    j.finishedAt = Date.now();
    db.save('broadcast');
    console.log(`✉️  Рассылка закончена: отправлено ${j.sent}, не дошло ${j.failed}`);
    return;
  }
  const r = render('news', { имя: next.name });
  email.sendMail(next.email, r.subject, r.html)
    .then((res: any) => {
      const cur = job();
      if (!cur) return;
      if (res.sent) cur.sent++;
      else {
        cur.failed++;
        if (cur.errors.length < 50) cur.errors.push({ email: next.email, error: res.error || 'ошибка' });
      }
      db.save('broadcast');
    })
    .catch(() => {
      const cur = job();
      if (cur) { cur.failed++; db.save('broadcast'); }
    })
    .finally(() => {
      const t = setTimeout(tickSend, SEND_GAP_MS);
      if (t.unref) t.unref();
    });
}

function broadcastStatus() {
  const j = job();
  if (!j) return { running: false, last: null };
  return {
    running: !j.finishedAt && !j.stopped,
    last: {
      startedAt: j.startedAt, finishedAt: j.finishedAt,
      subject: j.subject, total: j.total, sent: j.sent, failed: j.failed,
      left: j.queue.length, by: j.by, stopped: !!j.stopped,
      errors: j.errors.slice(0, 20),
    },
  };
}

// Кому уйдёт рассылка. Только подтверждённая почта: неподтверждённый
// адрес — это чаще всего опечатка, и письма на него бьют по репутации
// отправителя, из-за которой потом в спам уходят ВСЕ письма, включая
// подтверждения регистрации.
function recipients(allUsers: Record<string, any>) {
  return Object.values(allUsers)
    .filter((p: any) => p && !p.isBot && p.emailVerified && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email || '')))
    .map((p: any) => ({ id: p.id, email: String(p.email), name: String(p.name || 'Генерал') }));
}

function broadcastStart(actorName: string, allUsers: Record<string, any>, notices: Notices) {
  if (!email.isConfigured) throw new u.ApiError('Почта не настроена — отправлять нечем');
  const cur = job();
  if (cur && !cur.finishedAt && !cur.stopped) throw new u.ApiError('Рассылка уже идёт — дождитесь конца или остановите её');

  const list = recipients(allUsers);
  if (!list.length) throw new u.ApiError('Некому отправлять: нет игроков с подтверждённой почтой');

  const r = render('news', { имя: 'Боец' });
  const s: any = db.load<any>('broadcast', {});
  s.startedAt = Date.now();
  s.finishedAt = 0;
  s.stopped = false;
  s.subject = r.subject;
  s.total = list.length;
  s.sent = 0; s.failed = 0;
  s.errors = [];
  s.queue = list;
  s.by = String(actorName || '');
  db.save('broadcast');

  const t = setTimeout(tickSend, 10);
  if (t.unref) t.unref();

  notices.push(`✉️ Рассылка запущена: получателей ${list.length}. Идёт в фоне, панель можно закрыть.`);
  return { total: list.length };
}

function broadcastStop(notices: Notices) {
  const j = job();
  if (!j || j.finishedAt) throw new u.ApiError('Рассылка не идёт');
  j.stopped = true;
  j.finishedAt = Date.now();
  const left = j.queue.length;
  j.queue = [];
  db.save('broadcast');
  notices.push(`⏹ Рассылка остановлена. Не отправлено: ${left}.`);
  return { stopped: true, left };
}

// Сколько получателей — нужно ДО запуска, чтобы владелец видел, во что
// обойдётся рассылка по лимитам почтового сервиса.
function audience(allUsers: Record<string, any>) {
  const all = Object.values(allUsers).filter((p: any) => p && !p.isBot);
  const list = recipients(allUsers);
  return {
    ready: list.length,
    total: all.length,
    unverified: all.filter((p: any) => !p.emailVerified).length,
    noEmail: all.filter((p: any) => !String(p.email || '').trim()).length,
  };
}

export = {
  DEFAULTS, render, list, save, resetToDefault, sendPreview,
  broadcastStart, broadcastStop, broadcastStatus, audience, recipients,
  leftovers, stripUnknownVars, sanitizeHtml, missingVars,
};
