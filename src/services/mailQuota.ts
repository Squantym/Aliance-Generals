// ═══════════════════════════════════════════════════════════════════
// src/services/mailQuota.ts — сколько писем уже отправлено и сколько можно
//
// Зачем это вообще. Бесплатный тариф почтового сервиса — это жёсткий
// потолок: кончился, и письма перестают уходить. Не «медленнее», не
// «дороже», а просто перестают. И первым сломается не то, что не жалко,
// а регистрация и восстановление пароля: игрок не сможет ни войти, ни
// вернуть доступ, а владелец узнает об этом из жалоб.
//
// Значит считать письма должна сама игра, а не сервис. Три правила:
//
//  1. Считаем и за сутки, и за месяц — у тарифов обычно оба потолка.
//  2. Держим НЕПРИКОСНОВЕННЫЙ ЗАПАС на служебные письма. Рассылка на
//     всех игроков не имеет права съесть остаток так, чтобы назавтра
//     новичок не получил код подтверждения. Служебное письмо важнее
//     любой новости.
//  3. Останавливаемся ЗАРАНЕЕ и говорим об этом, а не упираемся в отказ
//     сервиса. Отказ сервиса выглядит как поломка игры.
//
// Счётчики живут в базе: перезапуск сервера не должен обнулять расход,
// иначе лимит обходится простым рестартом.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');

// Потолки тарифа. По умолчанию — бесплатный тариф SMTP.BZ: 15 000 в
// месяц и 500 в сутки. Меняются в .env, если тариф другой.
const LIMIT_MONTH = Math.max(0, Number(process.env.MAIL_LIMIT_MONTH || 15000));
const LIMIT_DAY = Math.max(0, Number(process.env.MAIL_LIMIT_DAY || 500));

// Запас под служебные письма. Рассылка его не трогает.
// 300 писем — это примерно две недели спокойных регистраций и сбросов
// пароля даже при заметном притоке новичков.
const RESERVE = Math.max(0, Number(process.env.MAIL_RESERVE || 300));

// Служебные письма — те, без которых игрок не может пользоваться
// аккаунтом. Их шлём до последнего письма месяца.
const ESSENTIAL = new Set(['verify', 'reset', 'welcome', 'test']);

type Counters = {
  day: string;        // YYYY-MM-DD
  dayCount: number;
  month: string;      // YYYY-MM
  monthCount: number;
  // Раздельный учёт: по нему в панели видно, кто съел лимит —
  // регистрации или рассылка.
  byKind: Record<string, number>;
  lastAt: number;
};

// Сутки — общие для всей игры, от московской полуночи (u.dayKey).
// Раньше здесь стоял new Date() без сдвига, и суточный лимит писем
// сбрасывался в 03:00 по Москве: три часа после полуночи расход считался
// вчерашним, а рассылка в это время могла съесть чужой день.
function today(): string { return u.dayKey(); }
function thisMonth(): string { return u.monthKey(); }

function state(): Counters {
  const s = db.load<Counters>('mailQuota', {} as Counters);
  if (!s.day) { s.day = today(); s.dayCount = 0; }
  if (!s.month) { s.month = thisMonth(); s.monthCount = 0; }
  if (!s.byKind) s.byKind = {};
  return s;
}

// Смена суток и месяца. Проверяем при каждом обращении, а не по
// таймеру: сервер может простоять выключенным сутки, и таймер бы
// пропустил переход.
function roll(s: Counters): Counters {
  const d = today(), m = thisMonth();
  if (s.day !== d) { s.day = d; s.dayCount = 0; }
  if (s.month !== m) { s.month = m; s.monthCount = 0; s.byKind = {}; }
  return s;
}

// Сколько писем ещё можно отправить письму данного вида.
// Для рассылки остаток меньше на величину запаса.
function left(kind: string): { day: number; month: number; total: number } {
  const s = roll(state());
  const essential = ESSENTIAL.has(kind);
  const reserve = essential ? 0 : RESERVE;
  const day = Math.max(0, LIMIT_DAY - s.dayCount - (essential ? 0 : 0));
  const month = Math.max(0, LIMIT_MONTH - s.monthCount - reserve);
  return { day, month, total: Math.min(day, month) };
}

// Можно ли отправить прямо сейчас. Возвращает причину отказа текстом —
// её видно и в панели, и в журнале: «письмо не ушло» без объяснения
// заставляет владельца искать поломку там, где её нет.
function check(kind: string): { ok: boolean; reason: string } {
  const s = roll(state());
  const essential = ESSENTIAL.has(kind);

  if (LIMIT_DAY && s.dayCount >= LIMIT_DAY) {
    return { ok: false, reason: `Суточный лимит писем исчерпан (${LIMIT_DAY}). Отправка продолжится завтра.` };
  }
  if (LIMIT_MONTH && s.monthCount >= LIMIT_MONTH) {
    return { ok: false, reason: `Месячный лимит писем исчерпан (${LIMIT_MONTH}).` };
  }
  if (!essential && LIMIT_MONTH && s.monthCount >= LIMIT_MONTH - RESERVE) {
    return {
      ok: false,
      reason: `До конца месяца осталось ${Math.max(0, LIMIT_MONTH - s.monthCount)} писем — `
        + `это неприкосновенный запас на подтверждения почты и восстановление паролей. `
        + `Рассылки возобновятся ${nextMonthLabel()}.`,
    };
  }
  return { ok: true, reason: '' };
}

function nextMonthLabel(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Засчитываем УШЕДШЕЕ письмо. Отказы не считаем: сервисы обычно не
// списывают их с тарифа, а если списывают — счётчик будет чуть
// оптимистичнее реального, что безопаснее обратного.
function count(kind: string): void {
  const s = roll(state());
  s.dayCount += 1;
  s.monthCount += 1;
  s.byKind[kind] = (s.byKind[kind] || 0) + 1;
  s.lastAt = Date.now();
  db.save('mailQuota');
}

// Полная картина для панели
function view() {
  const s = roll(state());
  return {
    limits: { day: LIMIT_DAY, month: LIMIT_MONTH, reserve: RESERVE },
    used: { day: s.dayCount, month: s.monthCount },
    left: {
      day: Math.max(0, LIMIT_DAY - s.dayCount),
      month: Math.max(0, LIMIT_MONTH - s.monthCount),
      // Сколько доступно именно рассылке — с учётом запаса
      broadcast: Math.min(
        Math.max(0, LIMIT_DAY - s.dayCount),
        Math.max(0, LIMIT_MONTH - s.monthCount - RESERVE),
      ),
    },
    byKind: s.byKind,
    lastAt: s.lastAt || 0,
    resetsAt: nextMonthLabel(),
  };
}

export = { check, count, left, view, LIMIT_MONTH, LIMIT_DAY, RESERVE, ESSENTIAL };
