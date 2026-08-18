// ===================================================================
// src/services/twoFactor.ts — второй фактор входа для сотрудников
//
// Кому нужен. Сотруднику: у него доступ к выдаче ресурсов, банам,
// обнулению аккаунтов и базе. Обычному игроку — нет: там нечего
// красть сверх его же прогресса, а потерянный телефон превратился бы
// в поток обращений в поддержку.
//
// Как устроен вход. Пароль — первый шаг, он же и раньше. Если у
// сотрудника включён второй фактор, сессия НЕ выдаётся: возвращается
// одноразовый «пропуск на второй шаг» (challenge) со сроком 5 минут.
// Только после верного кода из приложения выдаётся настоящий токен.
//
// Почему пропуск, а не «выдадим токен и потом спросим код»: токен,
// выданный до второго шага, — это уже доступ. Один кривой обработчик
// на фронте, и второй фактор превращается в украшение.
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import totp = require('./totp');

type Notices = string[];

const CHALLENGE_TTL_MS = 5 * 60 * 1000;      // пропуск живёт 5 минут
const MAX_CODE_TRIES = 5;                    // попыток на один пропуск

// Пропуска держим В ПАМЯТИ процесса: они живут минуты, и переживать
// перезапуск им незачем — после рестарта человек просто войдёт заново.
// В базе они были бы лишними строками с чувствительным смыслом.
const challenges = new Map<string, { userId: string; at: number; tries: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [id, c] of challenges) {
    if (now - c.at > CHALLENGE_TTL_MS) challenges.delete(id);
  }
}

function stateOf(user: any): any {
  return (user && user.totp) || null;
}
function isEnabled(user: any): boolean {
  const s = stateOf(user);
  return !!(s && s.enabledAt && s.secret);
}

// Требуется ли второй фактор этому человеку прямо сейчас.
// Включённый второй фактор требуется всегда — даже если сотрудника
// разжаловали: это его защита, а не только наша.
function required(user: any): boolean {
  return isEnabled(user);
}

// ── Шаг 1: выдать пропуск вместо сессии ───────────────────────────
function startChallenge(user: any): string {
  sweep();
  const id = u.uid(32);
  challenges.set(id, { userId: user.id, at: Date.now(), tries: 0 });
  return id;
}

// ── Шаг 2: проверить код и вернуть id игрока ──────────────────────
// Возвращает userId при успехе; бросает понятную ошибку при неудаче.
// Принимает и код из приложения, и код восстановления — сотрудник не
// обязан помнить, что из этого он вводит.
function completeChallenge(challengeId: string, code: string, users: Record<string, any>): string {
  sweep();
  const c = challenges.get(String(challengeId || ''));
  if (!c) throw new u.ApiError('Время на ввод кода истекло. Войдите заново.');
  c.tries++;
  if (c.tries > MAX_CODE_TRIES) {
    challenges.delete(challengeId);
    throw new u.ApiError('Слишком много попыток. Войдите заново.');
  }
  const user = users[c.userId];
  if (!user || !isEnabled(user)) {
    challenges.delete(challengeId);
    throw new u.ApiError('Второй фактор отключён. Войдите заново.');
  }
  const given = String(code || '').trim();

  if (totp.verify(user.totp.secret, given)) {
    challenges.delete(challengeId);
    // Запоминаем использованный шаг: тот же код второй раз не пройдёт,
    // даже если его подсмотрели через плечо в те же 30 секунд.
    user.totp.lastStep = Math.floor(Date.now() / 1000 / totp.STEP_SEC);
    db.markUser(user.id);
    return user.id;
  }

  const rec = totp.useRecovery(user.totp.recovery || [], given);
  if (rec.ok) {
    challenges.delete(challengeId);
    user.totp.recovery = rec.left;
    user.totp.recoveryUsedAt = Date.now();
    db.markUser(user.id);
    return user.id;
  }

  throw new u.ApiError(`Код не подошёл. Осталось попыток: ${Math.max(0, MAX_CODE_TRIES - c.tries)}`);
}

// Повторное использование того же 30-секундного шага. Проверяется
// отдельно от verify, потому что verify ничего не знает о человеке.
function isReplay(user: any, atMs?: number): boolean {
  const s = stateOf(user);
  if (!s || !s.lastStep) return false;
  const step = Math.floor((atMs === undefined ? Date.now() : atMs) / 1000 / totp.STEP_SEC);
  return step <= s.lastStep;
}

// ── Подключение ───────────────────────────────────────────────────
// Секрет создаётся, но НЕ включается, пока человек не введёт код: иначе
// можно запереть себя, отсканировав QR с ошибкой.
function setup(user: any, issuer: string): any {
  const secret = totp.newSecret();
  user.totp = { secret, enabledAt: 0, recovery: [], pendingSince: Date.now() };
  db.markUser(user.id);
  return {
    secret,
    otpauth: totp.otpauthUrl(secret, user.name || user.id, issuer || 'Генералы'),
    step: totp.STEP_SEC,
    digits: totp.DIGITS,
  };
}

function enable(user: any, code: string, notices: Notices): any {
  const s = stateOf(user);
  if (!s || !s.secret) throw new u.ApiError('Сначала получите ключ — нажмите «Подключить»');
  if (s.enabledAt) throw new u.ApiError('Второй фактор уже включён');
  if (!totp.verify(s.secret, code)) {
    throw new u.ApiError('Код не подошёл. Проверьте время на телефоне — оно должно идти точно.');
  }
  const { plain, hashed } = totp.newRecoveryCodes(8);
  s.enabledAt = Date.now();
  s.recovery = hashed;
  s.pendingSince = 0;
  db.markUser(user.id);
  notices.push('🔐 Второй фактор включён. Сохраните коды восстановления — они показываются один раз.');
  // Сами коды отдаём ОДИН раз: в базе только их хеши, повторить показ
  // невозможно даже владельцу. Это не строгость ради строгости — база
  // уезжает в копиях наружу.
  return { enabled: true, recoveryCodes: plain };
}

function disable(user: any, code: string, notices: Notices): any {
  const s = stateOf(user);
  if (!s || !s.enabledAt) throw new u.ApiError('Второй фактор и так выключен');
  // Выключение требует кода: иначе достаточно увести открытую вкладку.
  const okCode = totp.verify(s.secret, code);
  const rec = okCode ? null : totp.useRecovery(s.recovery || [], code);
  if (!okCode && !(rec && rec.ok)) throw new u.ApiError('Нужен действующий код — из приложения или код восстановления');
  user.totp = null;
  db.markUser(user.id);
  notices.push('🔓 Второй фактор выключен.');
  return { enabled: false };
}

function regenerateRecovery(user: any, code: string, notices: Notices): any {
  const s = stateOf(user);
  if (!s || !s.enabledAt) throw new u.ApiError('Второй фактор не включён');
  if (!totp.verify(s.secret, code)) throw new u.ApiError('Нужен действующий код из приложения');
  const { plain, hashed } = totp.newRecoveryCodes(8);
  s.recovery = hashed;
  db.markUser(user.id);
  notices.push('🔐 Новые коды восстановления созданы, старые больше не действуют.');
  return { recoveryCodes: plain };
}

function status(user: any): any {
  const s = stateOf(user);
  return {
    enabled: isEnabled(user),
    // Ключ выдан, но подключение не завершено — покажем это, чтобы
    // человек не думал, что уже защищён.
    pending: !!(s && s.secret && !s.enabledAt),
    recoveryLeft: s && s.recovery ? s.recovery.length : 0,
    recoveryUsedAt: (s && s.recoveryUsedAt) || 0,
    enabledAt: (s && s.enabledAt) || 0,
  };
}

export = {
  isEnabled, required, startChallenge, completeChallenge, isReplay,
  setup, enable, disable, regenerateRecovery, status,
  CHALLENGE_TTL_MS, MAX_CODE_TRIES,
  // для тестов
  _challenges: challenges,
};
