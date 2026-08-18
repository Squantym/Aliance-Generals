// ═══════════════════════════════════════════════════════════════════
// src/services/antiCheat.ts — поиск накрутки, эксплойтов и багов экономики
//
// ЧТО ЭТО НЕ ЕСТЬ: это не блокировщик. Ничего не банится автоматически —
// система только НАХОДИТ и ПОКАЗЫВАЕТ владельцу подозрительное, с
// доказательствами. Решение всегда за человеком. Автобан по эвристике
// рано или поздно выкосит честного игрока, а доверие вернуть нельзя.
//
// ОТКУДА ДАННЫЕ: журнал действий, где у КАЖДОЙ записи лежит срез счёта
// (deньги, золото, уровень, опыт, техника, здания). Значит по журналу
// видно не только «что игрок нажал», но и «как после этого изменился
// его счёт» — а это и есть то, на чём ловится и накрутка, и баг.
//
// ЧТО ИЩЕМ:
//   1. ЗОЛОТО ИЗ НИОТКУДА. Золото не капает само: его дают клуб,
//      покупка, награды и администрация. Прирост золота на действии,
//      которое золота не даёт, — либо эксплойт, либо ошибка в коде.
//   2. ДЕНЬГИ СВЕРХ НОРМЫ. Считаем, сколько игрок МОГ получить за
//      промежуток: пассивный доход построек + потолок разовой добычи.
//      Превышение в разы — сигнал.
//   3. ПРЫЖОК УРОВНЯ/ОПЫТА. Опыт за одно действие ограничен сверху.
//   4. НЕВОЗМОЖНЫЕ ЗНАЧЕНИЯ. Отрицательные ресурсы, уровень выше
//      потолка, NaN — это уже не накрутка, а сломанная формула. Такое
//      надо видеть немедленно, даже если игрок ни при чём.
//   5. СКОРОСТЬ ДЕЙСТВИЙ. Дополняет antibot: тот смотрит равномерность
//      интервалов, а здесь — просто плотность за минуту.
//
// Каждая находка несёт с собой доказательство: время, действие, было и
// стало. Без этого владелец не сможет ни принять решение, ни объясниться
// с игроком.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import config = require('../../config/gameConfig');
import player = require('./player');
import type { User } from '../types';

// ── Пороги ────────────────────────────────────────────────────────
// Намеренно мягкие: лучше пропустить сомнительное, чем завалить
// владельца ложными срабатываниями и приучить его их игнорировать.
const T = {
  // Во сколько раз прирост денег должен превысить расчётный максимум
  MONEY_OVER: 3,
  // Прирост денег ниже этого не смотрим вообще — мелочь не интересна
  MONEY_MIN_ABS: 1_000_000,
  // Золото: прирост на «немонетарном» действии
  GOLD_MIN: 1,
  // Опыт за одно действие
  EXP_JUMP: 100_000,
  // Действий в минуту (пик). Живой игрок в бою — до ~30
  ACTIONS_PER_MIN: 60,
  // Сколько записей журнала берём на игрока при разборе
  SCAN_PER_USER: 400,
};

// Действия, которые МОГУТ приносить золото. Всё остальное — не могут,
// и прирост золота там означает ошибку или эксплойт.
const GOLD_SOURCES: RegExp[] = [
  /^\/api\/club\//,                 // клуб офицеров: загадки, кости, ставки
  /^\/api\/bank\/buy-gold/,         // покупка
  /^\/api\/admin\//,                // выдача администрацией
  /^\/api\/daily\//, /^\/api\/weekly\//,   // поручения
  /^\/api\/missions\//,             // спецоперации
  /^\/api\/market\/container/,      // контейнеры
  /^\/api\/lots\//,                 // лоты дня
  /^\/api\/rewards\//,              // награды-письма
  /^\/api\/login-reward\//,         // вход
  /^\/api\/achievements\//,         // достижения
  /^\/api\/trophies\//,             // трофеи
  /^\/api\/group\//, /^\/api\/arena\//,    // бои с наградой
  /^\/api\/legion\//, /^\/api\/war\//,
  /^\/api\/mines\//,                // шахты
  /^\/api\/tutorial\//,             // обучение
  /^\/api\/event\//, /^\/api\/boss\//,
];

// Действия, которые МОГУТ приносить много денег разом
const MONEY_BURST: RegExp[] = [
  /^\/api\/war\/attack/, /^\/api\/war\/bank-hack/,
  /^\/api\/missions\//, /^\/api\/club\//,
  /^\/api\/bank/, /^\/api\/units\/sell/,
  /^\/api\/admin\//, /^\/api\/rewards\//,
  /^\/api\/mines\//, /^\/api\/legion\//,
  /^\/api\/group\//, /^\/api\/arena\//,
  /^\/api\/daily\//, /^\/api\/weekly\//,
  /^\/api\/lots\//, /^\/api\/market\//,
];

function matches(list: RegExp[], path: string): boolean {
  return list.some((re) => re.test(path || ''));
}

type Finding = {
  kind: string;
  severity: 'high' | 'mid' | 'low';
  title: string;
  detail: string;
  at: number;
};

// ── Проверка целостности: значения, которых быть не может ─────────
// Это ловит не игрока, а СЛОМАННУЮ ФОРМУЛУ. Отрицательные деньги или
// NaN означают, что где-то вычитание ушло в минус — и такое стоит
// увидеть в первый же день, а не когда игроки начнут жаловаться.
function integrityIssues(p: any): Finding[] {
  const out: Finding[] = [];
  const bad = (v: any) => typeof v !== 'number' || !Number.isFinite(v);
  const at = Date.now();

  for (const [field, label] of [['dollars', 'Деньги'], ['gold', 'Золото'],
                                ['exp', 'Опыт'], ['level', 'Уровень'], ['bank', 'Банк']] as const) {
    const v = (p as any)[field];
    if (v === undefined) continue;
    if (bad(v)) {
      out.push({ kind: 'broken', severity: 'high', at,
        title: `${label}: недопустимое значение`,
        detail: `${field} = ${String(v)} — это не число. Скорее всего ошибка в формуле, а не игрок.` });
    } else if (v < 0) {
      out.push({ kind: 'negative', severity: 'high', at,
        title: `${label}: отрицательное значение`,
        detail: `${field} = ${v}. Где-то вычитание ушло в минус.` });
    }
  }
  const maxLv = (config.PLAYER && config.PLAYER.MAX_LEVEL) || 300;
  if (typeof p.level === 'number' && p.level > maxLv) {
    out.push({ kind: 'overlevel', severity: 'high', at,
      title: 'Уровень выше потолка',
      detail: `Уровень ${p.level} при потолке ${maxLv}.` });
  }
  return out;
}

// ── Разбор журнала одного игрока ──────────────────────────────────
// Идём по записям от старых к новым и смотрим, как менялся счёт.
async function scanPlayer(p: any, hours: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const since = Date.now() - hours * 3600 * 1000;
  let logs: any[] = [];
  try { logs = await db.tailLogs(T.SCAN_PER_USER, p.id); } catch (e) { return out; }
  const rows = logs
    .filter((l) => l && l.bal && (l.at || 0) >= since)
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  if (rows.length < 2) return out;

  // Пассивный доход: сколько игрок законно получает в час
  let incomePerHour = 0;
  try { incomePerHour = Number(player.totalIncome(p)) || 0; } catch (e) { incomePerHour = 0; }

  // Плотность действий: СКОЛЬЗЯЩЕЕ окно в 60 секунд, а не «календарная»
  // минута. Раньше события раскладывались по абсолютным минутам
  // (Math.floor(at / 60000)), и это давало две беды сразу:
  //   • всплеск, попавший на стык минут, делился на две половины и мог
  //     не превысить порог ни в одной — скрипт проходил незамеченным
  //     просто потому, что запустился в 12:00:40;
  //   • проверка становилась зависимой от того, куда попал старт, и
  //     тест на плотность вёл себя по-разному от прогона к прогону.
  // Скользящее окно от этого свободно: считаем, сколько событий уложилось
  // в любые 60 секунд подряд.
  const times: number[] = [];

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const dt = Math.max(1, (b.at || 0) - (a.at || 0));
    const path = String(b.path || '');
    times.push(b.at || 0);

    // 1. Золото из ниоткуда
    const dGold = (b.bal.g || 0) - (a.bal.g || 0);
    if (dGold >= T.GOLD_MIN && !matches(GOLD_SOURCES, path)) {
      out.push({ kind: 'gold', severity: 'high', at: b.at,
        title: `Золото прибавилось там, где не должно: +${dGold}`,
        detail: `Действие «${b.desc || path}» золота не даёт, но золото выросло ` +
                `с ${a.bal.g} до ${b.bal.g}. Это либо эксплойт, либо ошибка начисления.` });
    }

    // 2. Деньги сверх расчётного максимума
    const dMoney = (b.bal.d || 0) - (a.bal.d || 0);
    if (dMoney >= T.MONEY_MIN_ABS) {
      // Сколько МОГЛО прийти: пассивный доход за прошедшее время.
      // Если действие в принципе способно дать много — не придираемся.
      const passive = incomePerHour * (dt / 3600000);
      const allowed = matches(MONEY_BURST, path) ? Infinity : passive * T.MONEY_OVER + T.MONEY_MIN_ABS;
      if (dMoney > allowed) {
        out.push({ kind: 'money', severity: 'high', at: b.at,
          title: `Деньги выросли сверх нормы: +${Math.round(dMoney).toLocaleString('ru')}`,
          detail: `Действие «${b.desc || path}» за ${(dt / 1000).toFixed(1)} с. ` +
                  `Пассивный доход дал бы не больше ${Math.round(passive).toLocaleString('ru')}. ` +
                  `Такое действие крупных сумм приносить не должно.` });
      }
    }

    // 3. Прыжок опыта
    const dExp = (b.bal.xp || 0) - (a.bal.xp || 0);
    if (dExp > T.EXP_JUMP) {
      out.push({ kind: 'exp', severity: 'mid', at: b.at,
        title: `Резкий прирост опыта: +${Math.round(dExp).toLocaleString('ru')}`,
        detail: `За одно действие «${b.desc || path}».` });
    }
  }

  // 4. Плотность действий — пик по скользящему окну в 60 секунд.
  // Два указателя по отсортированным временам: правый идёт вперёд, левый
  // догоняет, пока окно шире минуты. Разница указателей и есть число
  // событий в окне.
  times.sort((x, y) => x - y);
  let peakCount = 0, peakAt = 0, left = 0;
  for (let right = 0; right < times.length; right++) {
    while (times[right] - times[left] > 60000) left++;
    const inWindow = right - left + 1;
    if (inWindow > peakCount) { peakCount = inWindow; peakAt = times[left]; }
  }
  if (peakCount > T.ACTIONS_PER_MIN) {
    out.push({ kind: 'rate', severity: 'mid', at: peakAt,
      title: `Слишком много действий в минуту: ${peakCount}`,
      detail: 'Живой игрок даже в бою редко превышает 30. Похоже на скрипт.' });
  }

  return out;
}

// ── Общая сводка для админки ──────────────────────────────────────
// Возвращает список игроков с находками, самые тяжёлые сверху.
async function scan(hours = 24, limit = 40): Promise<any> {
  const users: Record<string, any> = player.users();
  const list = Object.values(users).filter((p: any) => p && !p.isBot);
  const results: any[] = [];
  const startedAt = Date.now();

  for (const p of list) {
    const findings: Finding[] = integrityIssues(p);
    // Разбор журнала — только для тех, кто заходил за интересующий срок:
    // перебирать всю базу на каждом открытии экрана незачем
    if ((p.lastSeen || 0) >= Date.now() - hours * 3600 * 1000) {
      const scanned = await scanPlayer(p, hours);
      findings.push(...scanned);
    }
    if (!findings.length) continue;

    const behavior = p.behavior || {};
    results.push({
      id: p.id, name: p.name, level: p.level || 0,
      dollars: p.dollars || 0, gold: p.gold || 0,
      lastSeen: p.lastSeen || 0,
      suspicion: Math.round(behavior.suspicion || 0),   // от antibot
      findings: findings.sort((a, b) => b.at - a.at).slice(0, 12),
      score: findings.reduce((s, f) => s + (f.severity === 'high' ? 10 : f.severity === 'mid' ? 4 : 1), 0),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return {
    hours,
    scannedPlayers: list.length,
    flagged: results.length,
    tookMs: Date.now() - startedAt,
    players: results.slice(0, limit),
    thresholds: T,
  };
}

// Разбор по одному игроку — для карточки в админке
async function scanOne(userId: string, hours = 72): Promise<any> {
  const p = player.users()[userId];
  if (!p) return null;
  const findings = integrityIssues(p).concat(await scanPlayer(p, hours));
  return {
    id: p.id, name: p.name,
    suspicion: Math.round((p.behavior || {}).suspicion || 0),
    findings: findings.sort((a, b) => b.at - a.at),
  };
}

export = { scan, scanOne, integrityIssues, THRESHOLDS: T };
