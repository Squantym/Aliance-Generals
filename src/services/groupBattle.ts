// ═══════════════════════════════════════════════════════════════════
// src/services/groupBattle.ts — Групповые бои 5 на 5
//
// Устроены как бои легиона, но проще: нет направлений, построек и
// арсенала — только роли и выбор цели. И главное: характеристики у
// всех одинаковые, как на арене. Уровень и техника не значат ничего.
//
// Ресурсы (1500 HP, 1000 энергии, 30 боеприпасов) живут ТОЛЬКО внутри
// боя и не пересекаются с обычными: иначе групповой бой обнулял бы
// игроку здоровье в основной игре.
//
// Если участников не набралось, за 15 секунд до старта места добирают
// боты. Они играют сами: атакуют, лечат и прикрывают союзников — иначе
// бой на двоих был бы вырожденным.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

// ---------- Правила ----------
const TEAM_SIZE = 5;                    // сколько в команде
// Отсчёт начинается с ПЕРВОЙ записи, а не по расписанию: иначе игрок,
// зашедший сразу после старта круга, ждал бы почти четверть часа.
const LOBBY_MS = 5 * 60 * 1000;         // сколько ждём остальных
const BOT_FILL_BEFORE_MS = 20 * 1000;   // за сколько до старта начинаем добор
const TOTAL_SLOTS = 10;                 // сколько мест в бою всего
// Тридцать секунд на нажатие «В бой». Но боец УЖЕ на поле с первой
// секунды: его можно бить, пока он не зашёл. Не успел — может погибнуть,
// так и не сделав ни одного удара. Это осознанно: бой начинается сразу
// для всех, иначе вошедшие первыми стояли бы и ждали.
const ENTER_WINDOW_MS = 30 * 1000;
const BATTLE_MAX_MS = 20 * 60 * 1000;   // предел длительности

// Базовые ресурсы боя. Живут в groupUpgrades, чтобы база и прибавки
// не разъехались: там же считаются итоговые характеристики бойца.
const UP = require('./groupUpgrades');
const HP = UP.BASE.hp;
const ENERGY = UP.BASE.energy;
const AMMO = UP.BASE.ammo;

const ACTION_CD_MS = 1500;              // откат между действиями
const BOT_THINK_MS = 3000;              // как часто ходят боты

// Стоимость действий
const COST = {
  attack: { ammo: 1, energy: 0 },
  heal:   { ammo: 0, energy: 120 },
  guard:  { ammo: 0, energy: 80 },
};

const BASE_DMG = 60;                    // базовый урон бойца
const HEAL_AMOUNT = 220;                // сколько лечит медик
const GUARD_REDUCE = 0.5;               // насколько прикрытие режет урон
const GUARD_MS = 6000;                  // сколько держится прикрытие

const ROLES: Record<string, any> = {
  fighter: { id: 'fighter', label: 'Боец',     icon: '⚔', atkMul: 1.25, dmgReduce: 0.00,
             desc: 'Бьёт сильнее всех. Основной урон команды.' },
  guardian:{ id: 'guardian', label: 'Защитник', icon: '🛡', atkMul: 0.80, dmgReduce: 0.25,
             desc: 'Держит удар и прикрывает союзника: урон по нему режется вдвое.' },
  medic:   { id: 'medic',   label: 'Медик',    icon: '💉', atkMul: 0.70, dmgReduce: 0.00,
             desc: 'Лечит союзников. Бьёт слабо, но без него команда быстро тает.' },
};
const ROLE_IDS = Object.keys(ROLES);

type Fighter = {
  id: string; name: string; flag: string;
  team: 0 | 1;
  role: string;
  hp: number; maxHp: number;
  energy: number; maxEnergy: number;
  ammo: number; maxAmmo: number;
  alive: boolean;
  entered: boolean;
  isBot: boolean;
  targetId: string | null;
  lastActionAt: number;
  guardedUntil: number;       // до какого времени прикрыт
  guardedBy: string;
  st: any;                    // характеристики с учётом улучшений
  damageDealt: number;
  healed: number;
  absorbed: number;         // сколько урона снял с союзников прикрытием
  kills: number;
  killedBy: string;         // кто добил — павший должен это видеть
  killedById: string;
};

type Battle = {
  id: string;
  slot: number;
  startedAt: number;
  finishedAt: number;
  state: 'waiting' | 'running' | 'done' | 'cancelled';
  fighters: Record<string, Fighter>;
  log: Array<{ at: number; text: string; kind: string; a?: string; t?: string }>;
  winnerTeam: -1 | 0 | 1;
  lastBotAt: number;
};

type Store = {
  registered: Record<string, { id: string; name: string; flag: string; level: number; role: string; at: number }>;
  slot: number;
  battle: Battle | null;
  history: Array<{ id: string; at: number; winnerTeam: number; players: number }>;
};

function store(): Store {
  const s = db.load<Store>('groupBattle', { registered: {}, slot: 0, battle: null, history: [] });
  if (!s.registered) s.registered = {};
  if (!s.history) s.history = [];
  return s;
}

// Время старта считается от первой записи. Ноль означает «лобби пусто,
// отсчёт не идёт».
function nextSlot(from?: number): number {
  return (from || Date.now()) + LOBBY_MS;
}

// Каждая запись помечается участниками: кто действовал и по кому.
// Это позволяет показать бой глазами любого бойца, а не только общий
// поток — павший игрок может следить за союзниками.
function addLog(b: Battle, text: string, kind?: string, actorId?: string, targetId?: string): void {
  b.log.push({ at: Date.now(), text, kind: kind || 'info', a: actorId || '', t: targetId || '' });
  if (b.log.length > 200) b.log = b.log.slice(-200);
}

// ---------- Обслуживание ----------
function tick(): void {
  const s = store();
  const now = Date.now();

  // Лобби пусто — отсчёт не идёт
  if (!s.battle && !Object.keys(s.registered).length) {
    s.slot = 0;
    db.save('groupBattle');
    return;
  }

  // Последние секунды: добираем ботов ПОСТЕПЕННО, а не разом. Так у
  // опоздавших остаётся шанс занять место живым человеком, и лобби не
  // выглядит внезапно забитым.
  if (!s.battle && s.slot && s.slot - now <= BOT_FILL_BEFORE_MS && s.slot - now > 0) {
    fillWithBotsGradually(s, now);
  }

  // Старт
  if (!s.battle && s.slot && now >= s.slot) {
    const list = Object.values(s.registered);
    if (list.length < 2) {
      // Совсем пусто — сбрасываем лобби, отсчёт начнётся с новой записи
      s.registered = {};
      s.slot = 0;
      db.save('groupBattle');
      return;
    }
    startBattle(s, list, now);
  }

  const b = s.battle;
  if (b && (b.state === 'waiting' || b.state === 'running')) {
    if (b.state === 'running') {
      botTurn(b, now);
      checkEnd(s, b);
      if (b.state === 'running' && now - b.startedAt > BATTLE_MAX_MS) {
        // Ничья по времени: побеждает команда с большим суммарным здоровьем
        const hp0 = teamHp(b, 0), hp1 = teamHp(b, 1);
        finish(s, b, hp0 === hp1 ? -1 : (hp0 > hp1 ? 0 : 1), 'Время боя вышло');
      }
    }
  }
  db.save('groupBattle');
}

function teamHp(b: Battle, team: 0 | 1): number {
  return Object.values(b.fighters).filter((f) => f.team === team && f.alive)
    .reduce((n, f) => n + f.hp, 0);
}

// Добор ботов до полных команд
const BOT_NAMES = ['Вихрь', 'Кремень', 'Сокол', 'Гранит', 'Барс', 'Ястреб',
                  'Тайфун', 'Клык', 'Разряд', 'Обух'];

function addBot(s: Store, index: number): void {
  const id = 'gbot_' + u.uid(8);
  s.registered[id] = {
    id, name: BOT_NAMES[index % BOT_NAMES.length] + '-' + (index + 1), flag: '🤖',
    level: 0, role: ROLE_IDS[Math.floor(Math.random() * ROLE_IDS.length)],
    at: Date.now(),
  };
}

// Добор ботами растянут на последние секунды: считаем, сколько мест
// должно быть занято к текущему моменту, и добираем только до этого
// числа. К старту мест не остаётся.
function fillWithBotsGradually(s: Store, now: number): void {
  const have = Object.keys(s.registered).length;
  const free = TOTAL_SLOTS - have;
  if (free <= 0) return;

  const elapsed = BOT_FILL_BEFORE_MS - (s.slot - now);          // сколько прошло с начала добора
  const share = Math.min(1, Math.max(0, elapsed / BOT_FILL_BEFORE_MS));
  const botsNow = Object.values(s.registered).filter((r) => String(r.id).startsWith('gbot_')).length;
  const humans = have - botsNow;
  const totalBotsNeeded = TOTAL_SLOTS - humans;
  const shouldHave = Math.ceil(totalBotsNeeded * share);
  for (let i = botsNow; i < shouldHave; i++) addBot(s, i);
}

// Разом — на случай, если время добора уже вышло
function fillWithBots(s: Store): void {
  const have = Object.keys(s.registered).length;
  for (let i = 0; i < TOTAL_SLOTS - have; i++) addBot(s, i);
}

// Разбивка по командам. Делим поровну: при пяти участниках выходит 3 и 2,
// а не 4 и 1 — иначе меньшая сторона обречена и бой бессмыслен.
function splitTeams(list: any[]): Array<{ rec: any; team: 0 | 1 }> {
  // Сначала раскидываем ЖИВЫХ людей: разница между командами должна быть
  // не больше одного человека. Если сначала мешать всех подряд, могло бы
  // выйти четверо людей против одного с четырьмя ботами — формально
  // поровну, а по сути нечестно.
  const humans = u.shuffle(list.filter((r) => !String(r.id).startsWith('gbot_')));
  const bots = u.shuffle(list.filter((r) => String(r.id).startsWith('gbot_')));
  const out: Array<{ rec: any; team: 0 | 1 }> = [];
  const count = [0, 0];

  humans.forEach((rec, i) => {
    const team = (i % 2) as 0 | 1;
    out.push({ rec, team });
    count[team]++;
  });
  // Ботами добираем до равного размера команд
  for (const rec of bots) {
    const team = (count[0] <= count[1] ? 0 : 1) as 0 | 1;
    out.push({ rec, team });
    count[team]++;
  }
  return out;
}

function startBattle(s: Store, list: any[], now: number): void {
  const split = splitTeams(list);
  const fighters: Record<string, Fighter> = {};
  for (const { rec, team } of split) {
    const role = ROLES[rec.role] ? rec.role : 'fighter';
    // Боты играют на базовых характеристиках, игроки — со своими
    // улучшениями. Иначе прокачка не давала бы ничего.
    const owner = String(rec.id).startsWith('gbot_') ? null : player.users()[rec.id];
    const st = owner ? UP.statsFor(owner) : {
      hp: HP, energy: ENERGY, ammo: AMMO,
      critChance: UP.BASE.critChance, dodgeChance: UP.BASE.dodgeChance,
      healCritChance: 0, damageReduce: 0, rewardBonus: 0,
    };
    fighters[rec.id] = {
      id: rec.id, name: rec.name, flag: rec.flag, team, role, st,
      hp: st.hp, maxHp: st.hp,
      energy: st.energy, maxEnergy: st.energy,
      ammo: st.ammo, maxAmmo: st.ammo,
      alive: true, entered: String(rec.id).startsWith('gbot_'),
      isBot: String(rec.id).startsWith('gbot_'),
      targetId: null, lastActionAt: 0,
      guardedUntil: 0, guardedBy: '',
      damageDealt: 0, healed: 0, absorbed: 0, kills: 0, killedBy: '', killedById: '',
    };
  }
  s.battle = {
    id: u.uid(10), slot: s.slot, startedAt: now, finishedAt: 0,
    state: 'running', fighters, log: [], winnerTeam: -1, lastBotAt: 0,
  };
  addLog(s.battle, `🔔 Бой ${split.filter((x) => x.team === 0).length} на ${split.filter((x) => x.team === 1).length} начался!`, 'system');
  s.registered = {};
  s.slot = nextSlot(now);

  for (const f of Object.values(s.battle.fighters)) {
    if (f.isBot) continue;
    try {
      require('./notifications').push(f.id, 'gb_start',
        `⚔ Групповой бой начался! Вы уже на поле — вас могут бить. Заходите скорее: ${Math.round(ENTER_WINDOW_MS / 1000)} секунд на выход.`, {});
    } catch (e) {}
  }
}

function checkEnd(s: Store, b: Battle): void {
  const a0 = Object.values(b.fighters).filter((f) => f.team === 0 && f.alive).length;
  const a1 = Object.values(b.fighters).filter((f) => f.team === 1 && f.alive).length;
  if (a0 === 0 && a1 === 0) return finish(s, b, -1, 'Обе стороны полегли');
  if (a0 === 0) return finish(s, b, 1, 'Первая команда уничтожена');
  if (a1 === 0) return finish(s, b, 0, 'Вторая команда уничтожена');
}

// ---------- Рейтинг ----------
// Очки за команду и за личные заслуги. Отдельные награды бойцу,
// защитнику и медику нужны, чтобы ценились все три роли: без этого
// в рейтинг лезли бы только те, кто бьёт.
const RATING_WIN = 3;
const RATING_LOSS = -3;
const RATING_KILL = 1;
const RATING_BEST = 3;      // лучшему бойцу, защитнику и медику

// Ранги: до какого очка какой. Порог — накопленный рейтинг.
const RANKS = [
  { id: 'green',   name: 'Салаги',      need: 0,    icon: '🔰' },
  { id: 'rookie',  name: 'Новички',     need: 1000, icon: '🎖' },
  { id: 'skilled', name: 'Опытные',     need: 2000, icon: '🏅' },
  { id: 'advanced',name: 'Продвинутые', need: 3000, icon: '⭐' },
  { id: 'special', name: 'Спецотряд',   need: 4000, icon: '🗡' },
  { id: 'elite',   name: 'Элита',       need: 5000, icon: '👑' },
];

function ratings(): Record<string, any> {
  const s = store() as any;
  if (!s.ratings) s.ratings = {};
  return s.ratings;
}

// ---------- Награда: боевые очки ----------
// Валюта групповых боёв, тратится на улучшения. Формула складывает вклад по всем трём
// направлениям — урон, лечение и принятый на себя удар, — чтобы медик
// и защитник получали сопоставимо с бойцом. Иначе играть в поддержку
// было бы невыгодно, и все шли бы в бойцы.
//
// Ориентиры: победа без заслуг ≈ 50–100, с максимальными ≈ 250;
// поражение ≈ 5–20, с заслугами до 100.
const TOKEN_BASE_WIN = 50;        // за победу просто так
const TOKEN_BASE_LOSS = 5;        // за поражение просто так
const TOKEN_CONTRIB_WIN = 120;    // сколько добавляет полный вклад победителю
const TOKEN_CONTRIB_LOSS = 55;    // и проигравшему
const TOKEN_KILL = 8;             // за убийство
const TOKEN_BEST_WIN = 20;        // за звание лучшего у победителя
const TOKEN_BEST_LOSS = 12;       // и у проигравшего
const TOKEN_SURVIVE = 15;         // победителю за то, что дожил

// Отсечки «полного вклада»: выше них прибавка не растёт. Взяты с запасом
// от типичных значений боя, чтобы потолок был достижим, но не даром.
const CONTRIB_CAP = { damage: 4000, healed: 3000, absorbed: 2000 };

function tokensFor(f: Fighter, won: boolean, bestCount: number, teamAvgDamage: number): number {
  // Доля вклада по каждому направлению, каждая от 0 до 1
  const dmgShare = Math.min(1, f.damageDealt / CONTRIB_CAP.damage);
  const healShare = Math.min(1, f.healed / CONTRIB_CAP.healed);
  const absShare = Math.min(1, f.absorbed / CONTRIB_CAP.absorbed);
  // Берём лучшее направление плюс половину остальных: боец не должен
  // проигрывать медику из-за того, что не лечил, и наоборот
  const parts = [dmgShare, healShare, absShare].sort((a, c) => c - a);
  const contrib = Math.min(1, parts[0] + (parts[1] + parts[2]) * 0.5);

  const base = won ? TOKEN_BASE_WIN : TOKEN_BASE_LOSS;
  const contribPts = Math.round(contrib * (won ? TOKEN_CONTRIB_WIN : TOKEN_CONTRIB_LOSS));
  const killPts = f.kills * TOKEN_KILL;
  const bestPts = bestCount * (won ? TOKEN_BEST_WIN : TOKEN_BEST_LOSS);
  const survivePts = (won && f.alive) ? TOKEN_SURVIVE : 0;

  let total = base + contribPts + killPts + bestPts + survivePts;
  // Держим в объявленных рамках, чтобы награда была предсказуемой
  total = Math.round(u.clamp(total, won ? TOKEN_BASE_WIN : TOKEN_BASE_LOSS, won ? 250 : 100));
  return total;
}

function awardRating(b: Battle, winnerTeam: -1 | 0 | 1): any[] {
  const table = ratings();
  const fighters = Object.values(b.fighters).filter((f) => !f.isBot);
  const all = Object.values(b.fighters);

  // Лучшие в бою считаются среди ВСЕХ, включая ботов: иначе игрок
  // получал бы награду за первое место, обойдя только людей
  const bestBy = (key: 'damageDealt' | 'absorbed' | 'healed') => {
    let top: Fighter | null = null;
    for (const f of all) {
      if ((f as any)[key] <= 0) continue;
      if (!top || (f as any)[key] > (top as any)[key]) top = f;
    }
    return top ? top.id : '';
  };
  const bestFighterId = bestBy('damageDealt');
  const bestGuardId = bestBy('absorbed');
  const bestMedicId = bestBy('healed');

  const rows: any[] = [];
  for (const f of all) {
    const teamPts = winnerTeam === -1 ? 0 : (f.team === winnerTeam ? RATING_WIN : RATING_LOSS);
    const killPts = f.kills * RATING_KILL;
    const bestFighter = f.id === bestFighterId;
    const bestGuard = f.id === bestGuardId;
    const bestMedic = f.id === bestMedicId;
    const bestPts = (bestFighter ? RATING_BEST : 0) + (bestGuard ? RATING_BEST : 0)
                  + (bestMedic ? RATING_BEST : 0);
    const total = teamPts + killPts + bestPts;

    let ratingTotal = 0;
    if (!f.isBot) {
      const rec = table[f.id] || (table[f.id] = {
        id: f.id, name: f.name, flag: f.flag, points: 0,
        wins: 0, losses: 0, kills: 0, battles: 0,
        damage: 0, absorbed: 0, healed: 0,
      });
      rec.name = f.name; rec.flag = f.flag;
      rec.battles += 1;
      rec.kills += f.kills;
      rec.damage += f.damageDealt;
      rec.absorbed += f.absorbed;
      rec.healed += f.healed;
      if (winnerTeam === f.team) rec.wins += 1;
      else if (winnerTeam !== -1) rec.losses += 1;
      rec.points = Math.max(0, rec.points + total);   // ниже нуля не уходим
      ratingTotal = rec.points;
    }

    // Жетоны отряда
    const won = winnerTeam === f.team;
    const bestCount = (bestFighter ? 1 : 0) + (bestGuard ? 1 : 0) + (bestMedic ? 1 : 0);
    let tokens = winnerTeam === -1 ? Math.round(TOKEN_BASE_LOSS * 2) : tokensFor(f, won, bestCount, 0);
    // Прибавка от навыка «Увеличение награды»
    const rewardBonus = (f.st && f.st.rewardBonus) || 0;
    if (rewardBonus > 0) tokens = Math.round(tokens * (1 + rewardBonus));
    if (!f.isBot) {
      const uu = player.users()[f.id];
      if (uu) {
        (uu as any).battlePoints = ((uu as any).battlePoints || 0) + tokens;
        db.markUser(uu.id);
      }
    }

    rows.push({
      id: f.id, name: f.name, flag: f.flag, team: f.team,
      role: f.role, roleLabel: ROLES[f.role].label, isBot: f.isBot,
      kills: f.kills, damage: f.damageDealt, absorbed: f.absorbed, healed: f.healed,
      alive: f.alive, killedBy: f.killedBy || '',
      teamPts, killPts, bestPts, ratingGained: total, ratingTotal,
      tokens,
      bestFighter, bestGuard, bestMedic,
      won,
    });
  }
  rows.sort((a, c) => (c.won ? 1 : 0) - (a.won ? 1 : 0) || c.tokens - a.tokens);
  db.save('users');
  return rows;
}

// Ранг по накопленным очкам
function rankOf(points: number) {
  let current: any = null;
  for (const r of RANKS) if (points >= r.need) current = r;
  const next = RANKS.find((r) => points < r.need) || null;
  return { current, next };
}

function ratingTable(user: User, limit?: number) {
  const table = ratings();
  const list = Object.values(table)
    .sort((a: any, b: any) => b.points - a.points || b.wins - a.wins || b.kills - a.kills);
  const myIndex = list.findIndex((r: any) => r.id === user.id);
  const mine: any = myIndex >= 0 ? list[myIndex] : null;
  const myPoints = mine ? mine.points : 0;
  const { current, next } = rankOf(myPoints);
  return {
    top: list.slice(0, u.clamp(u.toInt(limit, 10), 1, 50)).map((r: any, i) => ({
      place: i + 1, id: r.id, name: r.name, flag: r.flag,
      points: r.points, wins: r.wins, losses: r.losses, kills: r.kills,
      damage: r.damage, absorbed: r.absorbed, healed: r.healed,
      rank: (rankOf(r.points).current || {}).name || '—',
      isMe: r.id === user.id,
    })),
    me: mine ? { place: myIndex + 1, points: mine.points, wins: mine.wins, kills: mine.kills } : null,
    myPoints,
    myRank: current,
    nextRank: next,
    ranks: RANKS.map((r) => ({
      ...r, unlocked: myPoints >= r.need,
      left: Math.max(0, r.need - myPoints),
    })),
    rules: { win: RATING_WIN, loss: RATING_LOSS, kill: RATING_KILL, best: RATING_BEST },
  };
}

function finish(s: Store, b: Battle, winnerTeam: -1 | 0 | 1, reason: string): void {
  if (b.state === 'done') return;
  b.state = 'done';
  b.finishedAt = Date.now();
  b.winnerTeam = winnerTeam;
  (b as any).result = awardRating(b, winnerTeam);
  addLog(b, winnerTeam === -1 ? `🏁 Ничья. ${reason}`
    : `🏁 Победила команда ${winnerTeam + 1}. ${reason}`, 'system');
  for (const f of Object.values(b.fighters)) {
    if (f.isBot) continue;
    try {
      require('./notifications').push(f.id, 'gb_end',
        winnerTeam === f.team ? '🏆 Ваша команда победила в групповом бою!'
          : (winnerTeam === -1 ? '⚔ Групповой бой окончен вничью' : '⚔ Ваша команда проиграла групповой бой'), {});
    } catch (e) {}
  }
  s.history.unshift({ id: b.id, at: b.finishedAt, winnerTeam, players: Object.keys(b.fighters).length });
  if (s.history.length > 20) s.history.length = 20;
  try {
    auditLog.record({ userId: 'system', userName: 'system', path: '/system/group-battle',
      body: { id: b.id, winnerTeam, players: Object.keys(b.fighters).length } });
  } catch (e) {}
}

// ---------- Бой: расчёт ----------
function livingEnemies(b: Battle, f: Fighter): Fighter[] {
  return Object.values(b.fighters).filter((x) => x.alive && x.team !== f.team);
}
function livingAllies(b: Battle, f: Fighter): Fighter[] {
  return Object.values(b.fighters).filter((x) => x.alive && x.team === f.team && x.id !== f.id);
}

function doAttack(b: Battle, me: Fighter, target: Fighter): string {
  const role = ROLES[me.role];
  const mySt = me.st || {};
  const tSt = target.st || {};

  // Уворот проверяется ПЕРВЫМ: увернувшийся не получает ничего, и
  // боеприпас всё равно тратится — иначе промах ничего не стоил бы
  if (Math.random() < (tSt.dodgeChance || 0)) {
    me.ammo = Math.max(0, me.ammo - COST.attack.ammo);
    addLog(b, `💨 ${target.name} уклонился от удара ${me.name}`, 'dodge', me.id, target.id);
    return `«${target.name}» уклонился`;
  }

  let dmg = Math.round(BASE_DMG * role.atkMul * (0.85 + Math.random() * 0.3));
  // Критический удар: сила случайная в диапазоне, как на арене
  const crit = Math.random() < (mySt.critChance || 0);
  if (crit) dmg = Math.round(dmg * UP.critMult());

  const tRole = ROLES[target.role];
  dmg = Math.round(dmg * (1 - (tRole ? tRole.dmgReduce : 0)));
  // Снижение урона от улучшения
  dmg = Math.round(dmg * (1 - (tSt.damageReduce || 0)));
  // Прикрытие срезает урон, и снятое записывается защитнику: без этого
  // его вклад невидим, а он бывает решающим
  if (target.guardedUntil > Date.now()) {
    const full = dmg;
    dmg = Math.round(dmg * (1 - GUARD_REDUCE));
    const saved = full - dmg;
    const guard = target.guardedBy ? b.fighters[target.guardedBy] : null;
    if (guard && saved > 0) guard.absorbed += saved;
  }
  dmg = Math.max(1, dmg);

  target.hp = Math.max(0, target.hp - dmg);
  me.ammo = Math.max(0, me.ammo - COST.attack.ammo);
  me.damageDealt += dmg;
  addLog(b, `${crit ? '💥 Крит! ' : '⚔ '}${me.name} → ${target.name}: −${dmg} HP`, 'attack', me.id, target.id);

  if (target.hp <= 0) {
    target.alive = false;
    me.kills += 1;
    addLog(b, `☠ ${target.name} выведен из боя. Добил: ${me.name}`, 'kill', me.id, target.id);
    target.killedBy = me.name;
    target.killedById = me.id;
    for (const x of Object.values(b.fighters)) if (x.targetId === target.id) x.targetId = null;
  }
  return `Удар по «${target.name}»: −${dmg}`;
}

function doHeal(b: Battle, me: Fighter, target: Fighter): string {
  const before = target.hp;
  const mySt = me.st || {};
  const critHeal = Math.random() < (mySt.healCritChance || 0);
  const amount = critHeal ? Math.round(HEAL_AMOUNT * UP.critMult()) : HEAL_AMOUNT;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const healed = target.hp - before;
  me.energy = Math.max(0, me.energy - COST.heal.energy);
  me.healed += healed;
  addLog(b, `${critHeal ? '💚 Крит-лечение! ' : '💉 '}${me.name} лечит ${target.name}: +${healed} HP`, 'heal', me.id, target.id);
  return `Лечение «${target.name}»: +${healed}`;
}

function doGuard(b: Battle, me: Fighter, target: Fighter): string {
  target.guardedUntil = Date.now() + GUARD_MS;
  target.guardedBy = me.id;
  me.energy = Math.max(0, me.energy - COST.guard.energy);
  addLog(b, `🛡 ${me.name} прикрывает ${target.name}`, 'guard', me.id, target.id);
  return `Прикрытие «${target.name}»`;
}

// ---------- Поведение ботов ----------
// Ходят раз в две секунды. Правила простые и предсказуемые: боты должны
// вести себя осмысленно, но не переигрывать людей.
function botTurn(b: Battle, now: number): void {
  if (now - b.lastBotAt < BOT_THINK_MS) return;
  b.lastBotAt = now;

  for (const bot of Object.values(b.fighters)) {
    if (!bot.isBot || !bot.alive) continue;
    const enemies = livingEnemies(b, bot);
    const allies = livingAllies(b, bot);
    if (!enemies.length) continue;

    const weakestAlly = allies.slice().sort((a, c) => (a.hp / a.maxHp) - (c.hp / c.maxHp))[0];
    const weakestEnemy = enemies.slice().sort((a, c) => a.hp - c.hp)[0];

    if (bot.role === 'guardian' && weakestAlly && bot.energy >= COST.guard.energy
        && weakestAlly.guardedUntil <= now) {
      // Защитник прикрывает того, кому хуже всех
      doGuard(b, bot, weakestAlly);
      continue;
    }
    if (bot.role === 'medic' && weakestAlly && bot.energy >= COST.heal.energy) {
      const low = weakestAlly.hp / weakestAlly.maxHp < 0.5;
      // Ниже половины — лечим обязательно, иначе решаем по вероятности
      if (low || Math.random() < 0.7) { doHeal(b, bot, weakestAlly); continue; }
    }
    if (bot.ammo > 0) doAttack(b, bot, weakestEnemy);
  }
}

// ---------- Запись ----------
function register(user: User, roleId: string, notices: Notices) {
  tick();
  const s = store();
  if (s.registered[user.id]) throw new u.ApiError('Вы уже записаны на бой');
  const b = s.battle;
  if (b && b.fighters[user.id] && (b.state === 'waiting' || b.state === 'running')) {
    throw new u.ApiError('Вы уже в бою');
  }
  const role = ROLES[roleId] ? roleId : 'fighter';
  const humans = Object.values(s.registered).filter((r) => !String(r.id).startsWith('gbot_'));
  if (humans.length >= TEAM_SIZE * 2) throw new u.ApiError('Мест на ближайший бой не осталось');

  const first = !Object.keys(s.registered).length;
  s.registered[user.id] = {
    id: user.id, name: user.name, flag: player.flag(user),
    level: user.level, role, at: Date.now(),
  };
  // Первая запись запускает отсчёт: остальным даётся пять минут, чтобы
  // присоединиться. Ждать общего расписания было бы дольше и обиднее.
  if (first || !s.slot) s.slot = nextSlot(Date.now());
  db.save('groupBattle');
  notices.push(first
    ? `⚔ Вы записаны первым. Сбор ${Math.round(LOBBY_MS / 60000)} минут, роль: ${ROLES[role].label}`
    : `⚔ Вы записаны на групповой бой. Роль: ${ROLES[role].label}`);
  return view(user);
}

function unregister(user: User, notices: Notices) {
  tick();
  const s = store();
  if (!s.registered[user.id]) throw new u.ApiError('Вы не записаны на бой');
  delete s.registered[user.id];
  // Ушёл последний — отсчёт останавливаем, иначе бой стартовал бы
  // с одними ботами
  if (!Object.keys(s.registered).length) s.slot = 0;
  db.save('groupBattle');
  notices.push('Запись на групповой бой отменена');
  return view(user);
}

function setRole(user: User, roleId: string, notices: Notices) {
  tick();
  const s = store();
  const rec = s.registered[user.id];
  if (!rec) throw new u.ApiError('Сначала запишитесь на бой');
  if (!ROLES[roleId]) throw new u.ApiError('Неизвестная роль');
  rec.role = roleId;
  db.save('groupBattle');
  notices.push(`Роль изменена: ${ROLES[roleId].label}`);
  return view(user);
}

// ---------- Витрина ----------
function view(user: User) {
  tick();
  const s = store();
  const now = Date.now();
  const b = s.battle;
  const list = Object.values(s.registered).sort((a, c) => a.at - c.at);

  return {
    teamSize: TEAM_SIZE,
    lobbyMinutes: Math.round(LOBBY_MS / 60000),
    nextStartAt: s.slot,
    secondsLeft: Math.max(0, Math.round((s.slot - now) / 1000)),
    botFillSec: Math.round(BOT_FILL_BEFORE_MS / 1000),
    roles: ROLE_IDS.map((id) => ({ ...ROLES[id] })),
    myRole: (s.registered[user.id] && s.registered[user.id].role) || 'fighter',
    iAmRegistered: !!s.registered[user.id],
    registered: list.map((r) => ({
      id: r.id, name: r.name, flag: r.flag, level: r.level,
      role: r.role, roleLabel: ROLES[r.role] ? ROLES[r.role].label : '—',
      isBot: String(r.id).startsWith('gbot_'),
    })),
    rules: { hp: HP, energy: ENERGY, ammo: AMMO, dmg: BASE_DMG, heal: HEAL_AMOUNT,
             guardPct: Math.round(GUARD_REDUCE * 100), guardSec: GUARD_MS / 1000,
             cooldownMs: ACTION_CD_MS, costHeal: COST.heal.energy, costGuard: COST.guard.energy },
    battle: b && b.state !== 'cancelled' ? {
      state: b.state,
      iAmIn: !!b.fighters[user.id],
      entered: !!(b.fighters[user.id] && b.fighters[user.id].entered),
      canEnter: !!(b.fighters[user.id] && !b.fighters[user.id].entered
        && b.state === 'running' && b.fighters[user.id].alive
        && now - b.startedAt <= ENTER_WINDOW_MS),
      enterLeftSec: Math.max(0, Math.round((b.startedAt + ENTER_WINDOW_MS - now) / 1000)),
      id: b.id,
    } : null,
    history: (s.history || []).slice(0, 5),
    rating: ratingTable(user, 10),
  };
}

// ---------- Вход в бой ----------
function enter(user: User, notices: Notices) {
  tick();
  const s = store();
  const b = s.battle;
  if (!b || b.state !== 'running') throw new u.ApiError('Бой не идёт');
  const me = b.fighters[user.id];
  if (!me) throw new u.ApiError('Вы не записаны на этот бой');
  if (!me.alive) throw new u.ApiError('Вы уже выведены из боя');
  if (Date.now() - b.startedAt > ENTER_WINDOW_MS) {
    throw new u.ApiError('Время на выход истекло');
  }
  if (!me.entered) {
    me.entered = true;
    addLog(b, `➕ ${me.name} вступил в бой (${ROLES[me.role].label})`, 'system');
    db.save('groupBattle');
  }
  return battleState(user);
}

// ---------- Состояние боя ----------
function battleState(user: User, watchId?: string) {
  tick();
  const s = store();
  const b = s.battle;
  if (!b || !b.fighters[user.id]) return { active: false };
  const me = b.fighters[user.id];
  const now = Date.now();

  // Павший игрок может следить за союзниками: выбирает, чьими глазами
  // смотреть. Живой всегда видит свой бой — иначе можно было бы читать
  // чужие логи и подсказывать.
  const watched = (!me.alive && watchId && b.fighters[watchId]
    && b.fighters[watchId].team === me.team) ? b.fighters[watchId] : me;

  const card = (f: Fighter) => ({
    id: f.id, name: f.name, flag: f.flag, team: f.team,
    role: f.role, roleLabel: ROLES[f.role].label, roleIcon: ROLES[f.role].icon,
    hp: f.hp, maxHp: f.maxHp, alive: f.alive, isBot: f.isBot,
    guarded: f.guardedUntil > now,
    isMe: f.id === me.id,
  });

  return {
    active: b.state === 'waiting' || b.state === 'running',
    state: b.state,
    finished: b.state === 'done',
    winnerTeam: b.winnerTeam,
    result: (b as any).result || null,
    iWon: b.state === 'done' && b.winnerTeam === me.team,
    myTeam: me.team,
    entered: me.entered,
    enterLeftSec: Math.max(0, Math.round((b.startedAt + ENTER_WINDOW_MS - now) / 1000)),
    me: {
      ...card(me),
      energy: me.energy, maxEnergy: me.maxEnergy,
      ammo: me.ammo, maxAmmo: me.maxAmmo,
      cooldownLeftMs: Math.max(0, me.lastActionAt + ACTION_CD_MS - now),
      damageDealt: me.damageDealt, healed: me.healed, kills: me.kills,
      targetId: me.targetId,
    },
    allies: Object.values(b.fighters).filter((f) => f.team === me.team).map(card),
    enemies: Object.values(b.fighters).filter((f) => f.team !== me.team).map(card),
    // Логи от лица наблюдаемого: только то, что касается лично его
    log: b.log
      .filter((l) => l.kind === 'system' || l.a === watched.id || l.t === watched.id)
      .slice(-40).reverse(),
    watching: watched.id === me.id ? null : {
      id: watched.id, name: watched.name, role: watched.role,
      roleLabel: ROLES[watched.role].label, hp: watched.hp, maxHp: watched.maxHp,
      alive: watched.alive, damageDealt: watched.damageDealt,
      healed: watched.healed, absorbed: watched.absorbed, kills: watched.kills,
    },
    // Кого можно смотреть — свои, пока идёт бой
    watchable: me.alive ? [] : Object.values(b.fighters)
      .filter((f) => f.team === me.team)
      .map((f) => ({ id: f.id, name: f.name, alive: f.alive, isMe: f.id === me.id,
                     roleLabel: ROLES[f.role].label, hp: f.hp, maxHp: f.maxHp })),
    killedBy: me.killedBy || '',
    canHeal: me.role === 'medic',
    canGuard: me.role === 'guardian',
  };
}

// ---------- Действия ----------
function requireFight(user: User): { s: Store; b: Battle; me: Fighter } {
  tick();
  const s = store();
  const b = s.battle;
  if (!b || b.state !== 'running') throw new u.ApiError('Бой не идёт');
  const me = b.fighters[user.id];
  if (!me) throw new u.ApiError('Вы не участвуете в бою');
  if (!me.alive) throw new u.ApiError('Вы выведены из боя');
  if (!me.entered) throw new u.ApiError('Сначала нажмите «В бой»');
  const now = Date.now();
  if (now - me.lastActionAt < ACTION_CD_MS) {
    throw new u.ApiError(`Перезарядка ${((ACTION_CD_MS - (now - me.lastActionAt)) / 1000).toFixed(1)} с`);
  }
  return { s, b, me };
}

function act(user: User, action: string, targetId: string, notices: Notices) {
  const { s, b, me } = requireFight(user);
  const target = b.fighters[String(targetId || '')];
  if (!target || !target.alive) throw new u.ApiError('Цель недоступна');

  if (action === 'attack') {
    if (target.team === me.team) throw new u.ApiError('Это союзник');
    if (me.ammo < COST.attack.ammo) throw new u.ApiError('Боеприпасы кончились');
    notices.push(doAttack(b, me, target));
  } else if (action === 'heal') {
    if (me.role !== 'medic') throw new u.ApiError('Лечить может только медик');
    if (target.team !== me.team) throw new u.ApiError('Лечить можно только своих');
    if (me.energy < COST.heal.energy) throw new u.ApiError('Не хватает энергии');
    notices.push(doHeal(b, me, target));
  } else if (action === 'guard') {
    if (me.role !== 'guardian') throw new u.ApiError('Прикрывать может только защитник');
    if (target.team !== me.team) throw new u.ApiError('Прикрывать можно только своих');
    if (me.energy < COST.guard.energy) throw new u.ApiError('Не хватает энергии');
    notices.push(doGuard(b, me, target));
  } else {
    throw new u.ApiError('Неизвестное действие');
  }

  me.lastActionAt = Date.now();
  me.targetId = target.id;
  checkEnd(s, b);
  db.save('groupBattle');
  return battleState(user);
}

export = {
  view, register, unregister, setRole, enter, battleState, act, tick, nextSlot,
  ratingTable, rankOf, awardRating, tokensFor, RANKS, CONTRIB_CAP,
  RATING_WIN, RATING_LOSS, RATING_KILL, RATING_BEST,
  ROLES, ROLE_IDS, TEAM_SIZE, HP, ENERGY, AMMO, BASE_DMG, HEAL_AMOUNT,
  GUARD_REDUCE, GUARD_MS, ACTION_CD_MS, BOT_THINK_MS, BOT_FILL_BEFORE_MS, ENTER_WINDOW_MS,
  splitTeams, fillWithBots, botTurn,
};
