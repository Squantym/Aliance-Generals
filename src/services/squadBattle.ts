// ═══════════════════════════════════════════════════════════════════
// src/services/squadBattle.ts — Групповые бои 5 на 5 (новые)
//
// Решение владельца (17.09.2026): прежние групповые бои стали
// «рейтинговыми» (groupBattle.ts), а групповые — этот режим. Устройство
// то же — запись, комната подготовки, роли, боты, — но:
//   • характеристики РЕАЛЬНЫЕ, «всё как в игре» (realStats.ts):
//     здоровье, энергия и боеприпасы — максимумы игрока, удар — по
//     формуле войны от мощи армий, крит и уворот — от навыков;
//   • нет магазина, снабжения, улучшений и рангов — просто бои и один
//     общий рейтинг;
//   • взнос 1 000 000 000 $, каждый живой из победившей команды получает
//     2 000 000 000 $; ничья — взнос возвращается; не вышедший на бой и
//     покинувший его взнос теряют;
//   • свободные места за 10 секунд до старта занимают боты с силой
//     50–80% от средних характеристик живых игроков боя.
//
// Ресурсы боя — копия максимумов: бой не трогает здоровье и боеприпасы
// игрока в основной игре.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import RS = require('./realStats');
import type { User, Notices } from '../types';

const COLL = 'squadBattle';
const BOT_PREFIX = 'sbot_';

// ---------- Правила ----------
const TEAM_SIZE = 5;
const TOTAL_SLOTS = 10;
const LOBBY_MS = 5 * 60 * 1000;         // сбор с первой записи
const BOT_FILL_BEFORE_MS = 10 * 1000;   // боты — за 10 секунд до старта
const PREPARE_MS = 30 * 1000;           // комната подготовки
const BATTLE_MAX_MS = 20 * 60 * 1000;
const ACTION_CD_MS = 1500;

// Деньги — решение владельца
const ENTRY = 1e9;                      // взнос
const PRIZE = 2e9;                      // каждому живому победителю

// Боты
const BOT_THINK_MS = 5000;
const BOT_STRENGTH_MIN = 0.5;           // доля от средних у живых
const BOT_STRENGTH_MAX = 0.8;
const BOT_SMART_MIN = 0.6;              // «тупит» на 20–40%
const BOT_SMART_MAX = 0.8;

const COST = {
  attack: { ammo: 1, energy: 0 },
  heal:   { ammo: 0, energy: 50 },
  guard:  { ammo: 0, energy: 50 },
};

// Лечение в новых боях меньше, чем в рейтинговых: там удар около 60, а
// здесь удар по формуле войны — 12–16 при равных силах. Соотношение
// «лечение к удару» сохранено (×0.25): иначе медик перелечивал бы
// любой урон, и бой не кончался бы.
const HEAL_MIN = 6, HEAL_MAX = 11;
const HEAL_CRIT_MIN = 22, HEAL_CRIT_MAX = 55;
const HEAL_CRIT_CHANCE = 0.2;
const GUARD_REDUCE = 0.5;
const GUARD_MS = 20000;

const ROLES: Record<string, any> = {
  fighter: { id: 'fighter', label: 'Штурмовик', icon: '🎯',
             atkMul: 1.25, dmgReduce: 0.00, hpMul: 1.00, energyMul: 1.00,
             desc: 'Универсальный боец: урон выше на 25%, слабых мест нет.' },
  guardian:{ id: 'guardian', label: 'Защитник', icon: '🛡️',
             atkMul: 0.75, dmgReduce: 0.25, hpMul: 1.25, energyMul: 1.00,
             desc: 'Здоровья на 25% больше, входящий урон меньше на 25%, но и бьёт на 25% слабее.' },
  medic:   { id: 'medic',   label: 'Медик',    icon: '➕',
             atkMul: 0.75, dmgReduce: 0.00, hpMul: 1.00, energyMul: 1.25,
             desc: 'Лечит союзников. Энергии на 25% больше, урон на 25% ниже.' },
};
const ROLE_IDS = Object.keys(ROLES);
const ROLE_SHARE: Record<string, number> = { fighter: 0.5, guardian: 0.25, medic: 0.25 };

type Fighter = {
  id: string; name: string; flag: string;
  team: 0 | 1;
  role: string;
  hp: number; maxHp: number;
  energy: number; maxEnergy: number;
  ammo: number; maxAmmo: number;
  alive: boolean;
  seen: boolean;
  isBot: boolean;
  botSmart?: number;
  replaced?: boolean;
  forfeited?: boolean;
  left?: boolean;             // сам покинул бой — взнос потерян
  paid: number;               // сколько внёс (у ботов 0)
  stats: any;                 // реальные характеристики на старте
  targetId: string | null;
  lastActionAt: number;
  guardedUntil: number;
  guardedBy: string;
  rating: number;
  damageDealt: number;
  healed: number;
  absorbed: number;
  kills: number;
  killedBy: string;
  killedById: string;
};

type Battle = {
  id: string;
  startedAt: number;
  finishedAt: number;
  state: 'preparing' | 'running' | 'done' | 'cancelled';
  prepareUntil: number;
  fighters: Record<string, Fighter>;
  log: Array<{ at: number; text: string; kind: string; a?: string; t?: string }>;
  winnerTeam: -1 | 0 | 1;
  lastBotAt: number;
  result?: any[];
};

type Reg = { id: string; name: string; flag: string; level: number; role: string; at: number; paid: number };

type Store = {
  registered: Record<string, Reg>;
  slot: number;
  battle: Battle | null;
  others: Battle[];
  history: Array<{ id: string; at: number; winnerTeam: number; players: number }>;
  ratings: Record<string, any>;
  results: Record<string, any>;
  lastBattle: Record<string, string>;
  playerHistory: Record<string, any[]>;
};

function store(): Store {
  const s = db.load<Store>(COLL, {
    registered: {}, slot: 0, battle: null, others: [], history: [],
    ratings: {}, results: {}, lastBattle: {}, playerHistory: {},
  });
  if (!s.registered) s.registered = {};
  if (!Array.isArray(s.others)) s.others = [];
  if (!s.history) s.history = [];
  if (!s.ratings) s.ratings = {};
  if (!s.results) s.results = {};
  if (!s.lastBattle) s.lastBattle = {};
  if (!s.playerHistory) s.playerHistory = {};
  return s;
}

const isBotId = (id: string) => String(id).startsWith(BOT_PREFIX);
const isLive = (b: Battle | null | undefined) => !!b && (b.state === 'preparing' || b.state === 'running');
function battles(s: Store): Battle[] { return [s.battle, ...s.others].filter(Boolean) as Battle[]; }
function battleOf(s: Store, userId: string): Battle | null {
  const all = battles(s).filter((b) => b.fighters[userId]);
  return all.find(isLive) || all[0] || null;
}
function roll(lo: number, hi: number): number { return Math.round((lo + Math.random() * (hi - lo)) * 100) / 100; }
function smart(p: number, f: { botSmart?: number }): number { return p * (f.botSmart || BOT_SMART_MAX); }

function addLog(b: Battle, text: string, kind?: string, actorId?: string, targetId?: string): void {
  b.log.push({ at: Date.now(), text, kind: kind || 'info', a: actorId || '', t: targetId || '' });
  if (b.log.length > 200) b.log = b.log.slice(-200);
}

// ---------- Деньги ----------
function refund(userId: string, amount: number, why: string): void {
  const p: any = player.users()[userId];
  const v = Math.max(0, Math.round(Number(amount) || 0));
  if (!p || !v) return;
  player.addMoney(p, v, false);
  db.markUser(p.id);
  try { require('./notifications').push(p.id, 'squad_refund', `💵 ${why}. Взнос $${u.fmt(v)} возвращён.`, {}); } catch (e) {}
}

// ---------- Обслуживание ----------
function tick(): void {
  const s = store();
  const now = Date.now();
  const hasQueue = Object.keys(s.registered).length > 0;

  if (!hasQueue && s.slot) { s.slot = 0; db.save(COLL); }
  if (!hasQueue && !battles(s).length) return;

  if (!s.slot && hasQueue) {
    const earliest = Math.min(...Object.values(s.registered).map((r) => r.at || now));
    s.slot = Math.max(now + 5000, earliest + LOBBY_MS);
  }

  if (hasQueue && s.slot && s.slot - now <= BOT_FILL_BEFORE_MS && s.slot - now > 0) {
    fillWithBotsGradually(s, now);
  }

  if (hasQueue && s.slot && now >= s.slot) {
    fillWithBots(s);
    const list = Object.values(s.registered);
    if (list.length < 2) {
      for (const r of list) if (!isBotId(r.id)) refund(r.id, r.paid, 'Групповой бой не состоялся');
      s.registered = {};
      s.slot = 0;
      db.save(COLL);
      db.save('users');
      return;
    }
    if (isLive(s.battle)) s.others.push(s.battle!);
    startBattle(s, list, now);
  }

  if (s.battle && !isLive(s.battle) && now - (s.battle.finishedAt || 0) > 60000) s.battle = null;
  s.others = s.others.filter((x) => isLive(x) || now - (x.finishedAt || 0) <= 60000);

  for (const b of battles(s)) runBattle(s, b, now);
  db.save(COLL);
}

function runBattle(s: Store, b: Battle, now: number): void {
  if (!isLive(b)) return;
  if (b.state === 'preparing' && now >= b.prepareUntil) {
    b.state = 'running';
    b.startedAt = now;
    for (const f of Object.values(b.fighters)) {
      if (f.isBot || f.seen) continue;
      f.isBot = true;
      f.replaced = true;
      f.forfeited = true;
      addLog(b, `⏰ ${f.name} не вышел на бой — его заменил боец из резерва`, 'system', f.id);
    }
    addLog(b, '🔔 Бой начался!', 'system');
    checkEnd(s, b);
  }
  if (b.state === 'running') {
    botTurn(b, now);
    checkEnd(s, b);
    if (b.state === 'running' && now - b.startedAt > BATTLE_MAX_MS) finishByHp(s, b, 'Время боя вышло');
    else if (b.state === 'running' && outOfAmmo(b)) finishByHp(s, b, 'Боеприпасы кончились у всех');
  }
}

function teamHp(b: Battle, team: 0 | 1): number {
  return Object.values(b.fighters).filter((f) => f.team === team && f.alive).reduce((n, f) => n + f.hp, 0);
}
function finishByHp(s: Store, b: Battle, reason: string): void {
  const hp0 = teamHp(b, 0), hp1 = teamHp(b, 1);
  finish(s, b, hp0 === hp1 ? -1 : (hp0 > hp1 ? 0 : 1), reason);
}
function outOfAmmo(b: Battle): boolean {
  return Object.values(b.fighters).every((f) => !f.alive || f.ammo < COST.attack.ammo);
}

// ---------- Боты ----------
const BOT_NAMES = ['Штиль', 'Гром', 'Кондор', 'Базальт', 'Рысь', 'Беркут',
                   'Смерч', 'Бивень', 'Импульс', 'Молот'];

function pickBotRole(s: Store): string {
  const all = Object.values(s.registered);
  const total = all.length + 1;
  const have: Record<string, number> = { fighter: 0, guardian: 0, medic: 0 };
  for (const r of all) if (have[r.role] !== undefined) have[r.role]++;
  let best = 'fighter', gap = -Infinity;
  for (const id of ROLE_IDS) {
    const d = ROLE_SHARE[id] * total - have[id];
    if (d > gap) { gap = d; best = id; }
  }
  return best;
}

function addBot(s: Store, index: number): void {
  const id = BOT_PREFIX + u.uid(8);
  s.registered[id] = {
    id, name: BOT_NAMES[index % BOT_NAMES.length] + '-' + (index + 1), flag: '🤖',
    level: 0, role: pickBotRole(s), at: Date.now(), paid: 0,
  };
}

function fillWithBotsGradually(s: Store, now: number): void {
  const have = Object.keys(s.registered).length;
  if (have >= TOTAL_SLOTS) return;
  const elapsed = BOT_FILL_BEFORE_MS - (s.slot - now);
  const share = Math.min(1, Math.max(0, elapsed / BOT_FILL_BEFORE_MS));
  const botsNow = Object.values(s.registered).filter((r) => isBotId(r.id)).length;
  const humans = have - botsNow;
  const shouldHave = Math.ceil((TOTAL_SLOTS - humans) * share);
  for (let i = botsNow; i < shouldHave; i++) addBot(s, i);
}

function fillWithBots(s: Store): void {
  const have = Object.keys(s.registered).length;
  for (let i = 0; i < TOTAL_SLOTS - have; i++) addBot(s, i);
}

function splitTeams(list: Reg[]): Array<{ rec: Reg; team: 0 | 1 }> {
  const humans = u.shuffle(list.filter((r) => !isBotId(r.id)));
  const bots = u.shuffle(list.filter((r) => isBotId(r.id)));
  const out: Array<{ rec: Reg; team: 0 | 1 }> = [];
  const count = [0, 0];
  humans.forEach((rec, i) => { const team = (i % 2) as 0 | 1; out.push({ rec, team }); count[team]++; });
  for (const rec of bots) {
    const team = (count[0] <= count[1] ? 0 : 1) as 0 | 1;
    out.push({ rec, team });
    count[team]++;
  }
  return out;
}

function startBattle(s: Store, list: Reg[], now: number): void {
  const split = splitTeams(list);
  const users = player.users();
  // Реальные характеристики живых — снимок на момент старта
  const snaps: Record<string, any> = {};
  for (const r of list) if (!isBotId(r.id) && users[r.id]) snaps[r.id] = RS.snapshot(users[r.id]);
  const avg = RS.average(Object.values(snaps));

  const table = s.ratings;
  const humanPts = list.filter((r) => !isBotId(r.id)).map((r) => (table[r.id] ? table[r.id].points : 0));
  const avgPts = humanPts.length ? Math.round(humanPts.reduce((a, c) => a + c, 0) / humanPts.length) : 0;
  const spread = Math.max(50, Math.round(avgPts * 0.3));

  const fighters: Record<string, Fighter> = {};
  for (const { rec, team } of split) {
    const bot = isBotId(rec.id);
    const role = ROLES[rec.role] ? rec.role : 'fighter';
    const roleDef = ROLES[role];
    const stats = bot ? RS.botStats(avg, roll(BOT_STRENGTH_MIN, BOT_STRENGTH_MAX))
      : (snaps[rec.id] || RS.average([]));
    const hp = Math.max(1, Math.round(stats.hp * roleDef.hpMul));
    const energy = Math.round(stats.energy * roleDef.energyMul);
    fighters[rec.id] = {
      id: rec.id, name: rec.name, flag: rec.flag, team, role,
      hp, maxHp: hp, energy, maxEnergy: energy,
      ammo: stats.ammo, maxAmmo: stats.ammo,
      alive: true, seen: bot, isBot: bot,
      ...(bot ? { botSmart: roll(BOT_SMART_MIN, BOT_SMART_MAX) } : {}),
      paid: bot ? 0 : rec.paid,
      stats,
      targetId: null, lastActionAt: 0, guardedUntil: 0, guardedBy: '',
      rating: bot ? Math.max(0, avgPts + Math.round((Math.random() * 2 - 1) * spread))
        : ((table[rec.id] && table[rec.id].points) || 0),
      damageDealt: 0, healed: 0, absorbed: 0, kills: 0, killedBy: '', killedById: '',
    };
  }
  s.battle = {
    id: u.uid(10), startedAt: now, finishedAt: 0, state: 'preparing',
    prepareUntil: now + PREPARE_MS, fighters, log: [], winnerTeam: -1, lastBotAt: 0,
  };
  addLog(s.battle, `⏳ Подготовка к бою ${split.filter((x) => x.team === 0).length} на ${split.filter((x) => x.team === 1).length}. Займите места!`, 'system');
  s.registered = {};
  s.slot = 0;      // очередь пуста — отсчёта нет до новой записи
  for (const f of Object.values(fighters)) {
    if (f.isBot) continue;
    try {
      require('./notifications').push(f.id, 'squad_start',
        `⚔ Групповой бой: состав собран! Комната подготовки открыта — бой начнётся через ${Math.round(PREPARE_MS / 1000)} секунд.`, {});
    } catch (e) {}
  }
}

function checkEnd(s: Store, b: Battle): void {
  if (!isLive(b)) return;
  const a0 = Object.values(b.fighters).filter((f) => f.team === 0 && f.alive).length;
  const a1 = Object.values(b.fighters).filter((f) => f.team === 1 && f.alive).length;
  if (a0 === 0 && a1 === 0) return finish(s, b, -1, 'Обе стороны полегли');
  if (a0 === 0) return finish(s, b, 1, 'Первая команда уничтожена');
  if (a1 === 0) return finish(s, b, 0, 'Вторая команда уничтожена');
}

// ---------- Рейтинг и деньги ----------
const RATING_WIN = 3;
const RATING_LOSS = -3;
const RATING_KILL = 1;
const RATING_BEST = 3;

function settle(s: Store, b: Battle, winnerTeam: -1 | 0 | 1): any[] {
  const all = Object.values(b.fighters);
  const bestBy = (key: 'damageDealt' | 'absorbed' | 'healed') => {
    let top: Fighter | null = null;
    for (const f of all) if ((f as any)[key] > 0 && (!top || (f as any)[key] > (top as any)[key])) top = f;
    return top ? top.id : '';
  };
  const bestF = bestBy('damageDealt'), bestG = bestBy('absorbed'), bestM = bestBy('healed');
  const rows: any[] = [];
  for (const f of all) {
    const human = !f.isBot || !!f.replaced;
    const won = winnerTeam === f.team && !f.forfeited && !f.left;
    const teamPts = winnerTeam === -1 ? 0 : (f.team === winnerTeam ? RATING_WIN : RATING_LOSS);
    const bests = (f.id === bestF ? 1 : 0) + (f.id === bestG ? 1 : 0) + (f.id === bestM ? 1 : 0);
    const total = teamPts + f.kills * RATING_KILL + bests * RATING_BEST;
    let ratingReal = 0, ratingTotal = 0, money = 0;
    if (human && (f.forfeited || f.left)) {
      money = -f.paid;          // взнос потерян
      const rec = s.ratings[f.id] || (s.ratings[f.id] = { id: f.id, name: f.name, flag: f.flag, points: 0, wins: 0, losses: 0, kills: 0, battles: 0 });
      rec.battles += 1;
      rec.losses += 1;
      ratingTotal = rec.points;
    } else if (human) {
      const rec = s.ratings[f.id] || (s.ratings[f.id] = { id: f.id, name: f.name, flag: f.flag, points: 0, wins: 0, losses: 0, kills: 0, battles: 0 });
      rec.name = f.name; rec.flag = f.flag;
      rec.battles += 1;
      rec.kills += f.kills;
      if (won) rec.wins += 1; else if (winnerTeam !== -1) rec.losses += 1;
      const before = rec.points;
      rec.points = Math.max(0, rec.points + total);
      ratingReal = rec.points - before;
      ratingTotal = rec.points;
      if (winnerTeam === -1) {
        refund(f.id, f.paid, 'Групповой бой окончен вничью');
        money = 0;
      } else if (won) {
        const p: any = player.users()[f.id];
        if (p) { player.addMoney(p, PRIZE, false); db.markUser(p.id); }
        money = PRIZE - f.paid;
      } else {
        money = -f.paid;
      }
    } else {
      ratingTotal = Math.max(0, (f.rating || 0) + total);
      f.rating = ratingTotal;
    }
    rows.push({
      id: f.id, name: f.name, flag: f.flag, team: f.team,
      role: f.role, roleLabel: ROLES[f.role].label, isBot: !human,
      kills: f.kills, damage: f.damageDealt, absorbed: f.absorbed, healed: f.healed,
      alive: f.alive, killedBy: f.killedBy || '',
      forfeited: !!f.forfeited, left: !!f.left,
      ratingGained: human && !(f.forfeited || f.left) ? total : 0, ratingReal, ratingTotal,
      prize: won ? PRIZE : 0, money,
      bestFighter: f.id === bestF, bestGuard: f.id === bestG, bestMedic: f.id === bestM,
      won,
    });
    if (human) {
      const list = s.playerHistory[f.id] || (s.playerHistory[f.id] = []);
      list.unshift({
        at: Date.now(),
        result: f.forfeited ? 'forfeit' : (f.left ? 'left' : (winnerTeam === -1 ? 'draw' : (won ? 'win' : 'lose'))),
        role: ROLES[f.role].label, kills: f.kills, damage: f.damageDealt,
        rating: ratingReal, money, players: all.length,
      });
      if (list.length > 15) list.length = 15;
    }
  }
  rows.sort((a, c) => (c.won ? 1 : 0) - (a.won ? 1 : 0) || c.damage - a.damage);
  db.save('users');
  return rows;
}

function finish(s: Store, b: Battle, winnerTeam: -1 | 0 | 1, reason: string): void {
  if (!isLive(b)) return;
  b.state = 'done';
  b.finishedAt = Date.now();
  b.winnerTeam = winnerTeam;
  b.result = settle(s, b, winnerTeam);
  addLog(b, winnerTeam === -1 ? `🏁 Ничья. ${reason}` : `🏁 Победила команда ${winnerTeam + 1}. ${reason}`, 'system');
  for (const f of Object.values(b.fighters)) {
    if (f.isBot && !f.replaced) continue;
    const absent = !!(f.forfeited || f.left);
    try {
      require('./notifications').push(f.id, 'squad_end',
        absent ? '⚔ Групповой бой окончен. Вы в нём не участвовали — взнос не возвращается'
        : winnerTeam === -1 ? '⚔ Групповой бой окончен вничью — взнос возвращён'
          : (winnerTeam === f.team && !f.forfeited && !f.left
            ? `🏆 Ваша команда победила в групповом бою! +$${u.fmt(PRIZE)}`
            : '⚔ Ваша команда проиграла групповой бой'), {});
    } catch (e) {}
  }
  s.history.unshift({ id: b.id, at: b.finishedAt, winnerTeam, players: Object.keys(b.fighters).length });
  if (s.history.length > 20) s.history.length = 20;
  s.results[b.id] = { id: b.id, at: b.finishedAt, winnerTeam, rows: b.result };
  const ids = Object.keys(s.results).sort((x, y) => (s.results[y].at || 0) - (s.results[x].at || 0));
  for (const extra of ids.slice(30)) delete s.results[extra];
  for (const f of Object.values(b.fighters)) if (!f.isBot || f.replaced) s.lastBattle[f.id] = b.id;
  try {
    const real = Object.values(b.fighters).filter((f) => !f.isBot || f.replaced).map((f) => f.id);
    require('./referralQuests').onGroupBattle(real);
  } catch (e) {}
  try {
    auditLog.record({ userId: 'system', userName: 'system', path: '/system/squad-battle',
      body: { id: b.id, winnerTeam, players: Object.keys(b.fighters).length } });
  } catch (e) {}
}

function ratingTable(user: User, limit?: number) {
  const list = Object.values(store().ratings)
    .sort((a: any, b: any) => b.points - a.points || b.wins - a.wins || b.kills - a.kills);
  const myIndex = list.findIndex((r: any) => r.id === user.id);
  const mine: any = myIndex >= 0 ? list[myIndex] : null;
  return {
    top: list.slice(0, u.clamp(u.toInt(limit, 10), 1, 50)).map((r: any, i) => ({
      place: i + 1, id: r.id, name: r.name, flag: r.flag,
      points: r.points, wins: r.wins, losses: r.losses, kills: r.kills, battles: r.battles,
      isMe: r.id === user.id,
    })),
    me: mine ? { place: myIndex + 1, points: mine.points, wins: mine.wins, kills: mine.kills } : null,
    myPoints: mine ? mine.points : 0,
    rules: { win: RATING_WIN, loss: RATING_LOSS, kill: RATING_KILL, best: RATING_BEST },
  };
}

// ---------- Бой: расчёт ----------
function livingEnemies(b: Battle, f: Fighter): Fighter[] {
  return Object.values(b.fighters).filter((x) => x.alive && x.team !== f.team);
}
function livingAllies(b: Battle, f: Fighter): Fighter[] {
  return Object.values(b.fighters).filter((x) => x.alive && x.team === f.team && x.id !== f.id);
}

function doAttack(b: Battle, me: Fighter, target: Fighter): string {
  me.ammo = Math.max(0, me.ammo - COST.attack.ammo);
  const h = RS.hit(me.stats, target.stats);
  if (h.dodged) {
    addLog(b, `💨 ${target.name} уклонился от удара ${me.name}`, 'dodge', me.id, target.id);
    return `«${target.name}» уклонился`;
  }
  let dmg = Math.round(h.dmg * ROLES[me.role].atkMul);
  dmg = Math.round(dmg * (1 - (ROLES[target.role] ? ROLES[target.role].dmgReduce : 0)));
  if (target.guardedUntil > Date.now()) {
    const full = dmg;
    dmg = Math.round(dmg * (1 - GUARD_REDUCE));
    const guard = target.guardedBy ? b.fighters[target.guardedBy] : null;
    if (guard && full - dmg > 0) guard.absorbed += full - dmg;
  }
  dmg = Math.max(1, dmg);
  target.hp = Math.max(0, target.hp - dmg);
  me.damageDealt += dmg;
  addLog(b, `${h.crit ? '💥 Крит! ' : '⚔ '}${me.name} → ${target.name}: −${dmg} HP`, 'attack', me.id, target.id);
  if (target.hp <= 0) {
    target.alive = false;
    me.kills += 1;
    target.killedBy = me.name;
    target.killedById = me.id;
    addLog(b, `☠ ${target.name} выведен из боя. Добил: ${me.name}`, 'kill', me.id, target.id);
    for (const x of Object.values(b.fighters)) if (x.targetId === target.id) x.targetId = null;
  }
  return `Удар по «${target.name}»: −${dmg}`;
}

function doHeal(b: Battle, me: Fighter, target: Fighter): string {
  const before = target.hp;
  const crit = Math.random() < HEAL_CRIT_CHANCE;
  const amount = crit ? u.rnd(HEAL_CRIT_MIN, HEAL_CRIT_MAX) : u.rnd(HEAL_MIN, HEAL_MAX);
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const healed = target.hp - before;
  me.energy = Math.max(0, me.energy - COST.heal.energy);
  me.healed += healed;
  addLog(b, `${crit ? '💚 Крит-лечение! ' : '💉 '}${me.name} лечит ${target.name}: +${healed} HP`, 'heal', me.id, target.id);
  return `Лечение «${target.name}»: +${healed}`;
}

function doGuard(b: Battle, me: Fighter, target: Fighter): string {
  target.guardedUntil = Date.now() + GUARD_MS;
  target.guardedBy = me.id;
  me.energy = Math.max(0, me.energy - COST.guard.energy);
  addLog(b, `🛡 ${me.name} прикрывает ${target.name}`, 'guard', me.id, target.id);
  return `Прикрытие «${target.name}»`;
}

function botTurn(b: Battle, now: number): void {
  if (now - b.lastBotAt < BOT_THINK_MS) return;
  b.lastBotAt = now;
  for (const bot of Object.values(b.fighters)) {
    if (!bot.isBot || !bot.alive) continue;
    const enemies = livingEnemies(b, bot);
    const allies = livingAllies(b, bot);
    if (!enemies.length) continue;
    const weakestAlly = allies.slice().sort((a, c) => (a.hp / a.maxHp) - (c.hp / c.maxHp))[0];
    // Цель чаще случайная: полный фокус выносил бы живого мгновенно
    const target = Math.random() < smart(0.5, bot)
      ? enemies.slice().sort((a, c) => a.hp - c.hp)[0]
      : enemies[Math.floor(Math.random() * enemies.length)];
    if (bot.role === 'guardian' && weakestAlly && bot.energy >= COST.guard.energy
        && weakestAlly.guardedUntil <= now && weakestAlly.hp / weakestAlly.maxHp < smart(0.7, bot)) {
      doGuard(b, bot, weakestAlly);
      continue;
    }
    if (bot.role === 'medic' && weakestAlly && bot.energy >= COST.heal.energy) {
      const low = weakestAlly.hp / weakestAlly.maxHp < smart(0.5, bot);
      if (low || Math.random() < smart(0.65, bot)) { doHeal(b, bot, weakestAlly); continue; }
    }
    if (bot.ammo >= COST.attack.ammo) doAttack(b, bot, target);
  }
}

// ---------- Запись ----------
function busyState(userId: string): string | null {
  const s = store();
  if (s.registered[userId]) return 'записаны на бой';
  if (battles(s).some((b) => isLive(b) && b.fighters[userId] && b.fighters[userId].alive)) return 'сейчас в бою';
  return null;
}

// Нельзя быть в двух командных режимах сразу: бои идут параллельно
function assertFree(user: User): void {
  const checks: Array<[string, string]> = [['./arena', 'на арене'], ['./groupBattle', 'в рейтинговых боях']];
  for (const [mod, where] of checks) {
    let st: string | null = null;
    try { st = require(mod).busyState(user.id); } catch (e) { st = null; }
    if (st) throw new u.ApiError(`Вы ${st} ${where}`);
  }
}

function register(user: User, roleId: string, notices: Notices) {
  tick();
  const s = store();
  if (s.registered[user.id]) throw new u.ApiError('Вы уже записаны на бой');
  assertFree(user);
  const b = battleOf(s, user.id);
  if (b && isLive(b) && b.fighters[user.id].alive) throw new u.ApiError('Вы уже в бою');
  const humans = Object.values(s.registered).filter((r) => !isBotId(r.id));
  if (humans.length >= TOTAL_SLOTS) throw new u.ApiError('Мест на ближайший бой не осталось');
  if ((user.dollars || 0) < ENTRY) throw new u.ApiError(`Взнос — $${u.fmt(ENTRY)}. Не хватает денег.`);
  // Места уже заняли боты — живой вытесняет одного из них
  if (Object.keys(s.registered).length >= TOTAL_SLOTS) {
    const botId = Object.keys(s.registered).find(isBotId);
    if (botId) delete s.registered[botId];
  }
  user.dollars = Math.max(0, Math.round(user.dollars - ENTRY));
  db.markUser(user.id);
  const role = ROLES[roleId] ? roleId : 'fighter';
  const first = !Object.keys(s.registered).length;
  s.registered[user.id] = {
    id: user.id, name: user.name, flag: player.flag(user),
    level: user.level, role, at: Date.now(), paid: ENTRY,
  };
  if (first || !s.slot) s.slot = Date.now() + LOBBY_MS;
  db.save(COLL);
  notices.push(`⚔ Вы записаны на групповой бой. Взнос $${u.fmt(ENTRY)} списан. Роль: ${ROLES[role].label}`);
  return view(user);
}

function unregister(user: User, notices: Notices) {
  tick();
  const s = store();
  const rec = s.registered[user.id];
  if (!rec) throw new u.ApiError('Вы не записаны на бой');
  delete s.registered[user.id];
  player.addMoney(user, rec.paid, false);
  db.markUser(user.id);
  if (!Object.values(s.registered).some((r) => !isBotId(r.id))) {
    // Живых не осталось — боты без людей не воюют
    s.registered = {};
    s.slot = 0;
  }
  db.save(COLL);
  notices.push(`Запись отменена, взнос $${u.fmt(rec.paid)} возвращён.`);
  return view(user);
}

function setRole(user: User, roleId: string, notices: Notices) {
  tick();
  const s = store();
  const rec = s.registered[user.id];
  if (!rec) throw new u.ApiError('Сначала запишитесь на бой');
  if (!ROLES[roleId]) throw new u.ApiError('Неизвестная роль');
  rec.role = roleId;
  db.save(COLL);
  notices.push(`Роль изменена: ${ROLES[roleId].label}`);
  return view(user);
}

// Свои характеристики для карточки — только владельцу
function myStatsOf(f: Fighter) {
  const st = f.stats || {};
  const pct = (v: number) => Math.round((v || 0) * 1000) / 10;
  const role = ROLES[f.role];
  return {
    real: true,
    role: { id: f.role, label: role.label, icon: role.icon, hpMul: role.hpMul, energyMul: role.energyMul,
            atkMul: role.atkMul, dmgReducePct: pct(role.dmgReduce) },
    hp: f.maxHp, energy: f.maxEnergy, ammo: f.maxAmmo,
    atk: st.atk || 0, def: st.def || 0,
    critPct: pct(st.critChance), dodgePct: pct(st.dodgeChance),
  };
}

// ---------- Витрина ----------
function view(user: User) {
  tick();
  const s = store();
  const now = Date.now();
  const b = battleOf(s, user.id) || s.battle;
  const list = Object.values(s.registered).sort((a, c) => a.at - c.at);
  let mine: any = null;
  try { mine = RS.snapshot(user); } catch (e) { mine = null; }
  return {
    mode: 'squad',
    teamSize: TEAM_SIZE,
    lobbyMinutes: Math.round(LOBBY_MS / 60000),
    nextStartAt: s.slot,
    secondsLeft: s.slot ? Math.max(0, Math.round((s.slot - now) / 1000)) : 0,
    botFillSec: Math.round(BOT_FILL_BEFORE_MS / 1000),
    entry: ENTRY, prize: PRIZE, myMoney: user.dollars || 0,
    roles: ROLE_IDS.map((id) => ({ ...ROLES[id] })),
    myRole: (s.registered[user.id] && s.registered[user.id].role) || 'fighter',
    iAmRegistered: !!s.registered[user.id],
    registered: list.map((r) => ({
      id: r.id, name: r.name, flag: r.flag, level: r.level,
      role: r.role, roleLabel: ROLES[r.role] ? ROLES[r.role].label : '—',
      isBot: isBotId(r.id),
    })),
    myStats: mine ? { hp: mine.hp, energy: mine.energy, ammo: mine.ammo, atk: mine.atk, def: mine.def,
      critPct: Math.round(mine.critChance * 1000) / 10, dodgePct: Math.round(mine.dodgeChance * 1000) / 10 } : null,
    rules: {
      real: true, botMinPct: BOT_STRENGTH_MIN * 100, botMaxPct: BOT_STRENGTH_MAX * 100,
      healMin: HEAL_MIN, healMax: HEAL_MAX, healCritMin: HEAL_CRIT_MIN, healCritMax: HEAL_CRIT_MAX,
      guardPct: Math.round(GUARD_REDUCE * 100), guardSec: GUARD_MS / 1000,
      cooldownMs: ACTION_CD_MS, costHeal: COST.heal.energy, costGuard: COST.guard.energy,
    },
    battle: b && b.state !== 'cancelled' ? {
      state: b.state,
      needEnter: b.state === 'preparing' && !!b.fighters[user.id] && !b.fighters[user.id].seen,
      prepareLeftSec: b.state === 'preparing' ? Math.max(0, Math.round((b.prepareUntil - now) / 1000)) : 0,
      iAmIn: !!b.fighters[user.id],
      id: b.id,
    } : null,
    history: s.history.slice(0, 5),
    myHistory: (s.playerHistory[user.id] || []).slice(0, 10),
    rating: ratingTable(user, 10),
  };
}

function markSeen(b: Battle, userId: string): void {
  const me = b.fighters[userId];
  if (!me || me.isBot || me.seen) return;
  me.seen = true;
  addLog(b, `➕ ${me.name} в строю (${ROLES[me.role].label})`, 'system');
  db.save(COLL);
}

// ---------- Состояние боя ----------
function battleState(user: User, watchId?: string) {
  tick();
  const s = store();
  const b = battleOf(s, user.id);
  if (b && b.state === 'preparing') markSeen(b, user.id);
  if (!b) {
    const saved = s.lastBattle[user.id] && s.results[s.lastBattle[user.id]];
    if (saved) {
      const row = (saved.rows || []).find((r: any) => r.id === user.id);
      return {
        active: false, state: 'done', finished: true, mode: 'squad',
        winnerTeam: saved.winnerTeam, iWon: row ? !!row.won : false,
        forfeited: row ? !!row.forfeited : false,
        myTeam: row ? row.team : 0, result: saved.rows || [],
        me: row ? { id: user.id, name: row.name, flag: row.flag, team: row.team, role: row.role,
          roleLabel: row.roleLabel, roleIcon: ROLES[row.role].icon, hp: 0, maxHp: 0, alive: row.alive,
          isBot: false, damageDealt: row.damage, healed: row.healed, kills: row.kills,
          energy: 0, maxEnergy: 0, ammo: 0, maxAmmo: 0, cooldownLeftMs: 0, targetId: null,
          rating: row.ratingTotal || 0 } : null,
        allies: [], enemies: [], log: [], watchable: [],
      };
    }
    return { active: false };
  }
  const me = b.fighters[user.id];
  const now = Date.now();
  const watched = (!me.alive && watchId && b.fighters[watchId] && b.fighters[watchId].team === me.team)
    ? b.fighters[watchId] : me;
  const card = (f: Fighter) => ({
    id: f.id, name: f.name, flag: f.flag, team: f.team,
    role: f.role, roleLabel: ROLES[f.role].label, roleIcon: ROLES[f.role].icon,
    hp: f.hp, maxHp: f.maxHp, alive: f.alive, isBot: f.isBot && !f.replaced,
    guarded: f.guardedUntil > now, rating: f.rating || 0, isMe: f.id === me.id,
  });
  return {
    mode: 'squad',
    active: isLive(b),
    state: b.state,
    preparing: b.state === 'preparing',
    prepareLeftSec: b.state === 'preparing' ? Math.max(0, Math.round((b.prepareUntil - now) / 1000)) : 0,
    forfeited: !!me.forfeited,
    finished: b.state === 'done',
    winnerTeam: b.winnerTeam,
    result: b.result || null,
    iWon: b.state === 'done' && b.winnerTeam === me.team && !me.forfeited && !me.left,
    myTeam: me.team,
    prize: PRIZE, entry: ENTRY,
    me: {
      ...card(me),
      energy: me.energy, maxEnergy: me.maxEnergy, ammo: me.ammo, maxAmmo: me.maxAmmo,
      cooldownLeftMs: Math.max(0, me.lastActionAt + ACTION_CD_MS - now),
      damageDealt: me.damageDealt, healed: me.healed, kills: me.kills, targetId: me.targetId,
    },
    myStats: myStatsOf(me),
    allies: Object.values(b.fighters).filter((f) => f.team === me.team).map(card),
    enemies: Object.values(b.fighters).filter((f) => f.team !== me.team).map(card),
    log: b.log.filter((l) => l.kind === 'system' || l.a === watched.id || l.t === watched.id).slice(-40).reverse(),
    watching: watched.id === me.id ? null : {
      id: watched.id, name: watched.name, role: watched.role, roleLabel: ROLES[watched.role].label,
      hp: watched.hp, maxHp: watched.maxHp, alive: watched.alive, damageDealt: watched.damageDealt,
      healed: watched.healed, absorbed: watched.absorbed, kills: watched.kills,
    },
    watchable: (me.alive || me.forfeited) ? [] : Object.values(b.fighters)
      .filter((f) => f.team === me.team)
      .map((f) => ({ id: f.id, name: f.name, alive: f.alive, isMe: f.id === me.id,
                     roleLabel: ROLES[f.role].label, hp: f.hp, maxHp: f.maxHp })),
    killedBy: me.killedBy || '',
    canHeal: me.role === 'medic',
    canGuard: me.role === 'guardian',
    costHeal: COST.heal.energy, costGuard: COST.guard.energy,
  };
}

// ---------- Действия ----------
function requireFight(user: User): { s: Store; b: Battle; me: Fighter } {
  tick();
  const s = store();
  const b = battleOf(s, user.id);
  if (!b || b.state !== 'running') throw new u.ApiError('Бой не идёт');
  const me = b.fighters[user.id];
  if (!me.alive) throw new u.ApiError('Вы выведены из боя');
  if (me.forfeited) throw new u.ApiError('Вы не вышли на бой — за вас играет резерв');
  const now = Date.now();
  if (now - me.lastActionAt < ACTION_CD_MS) {
    throw new u.ApiError(`Перезарядка ${((ACTION_CD_MS - (now - me.lastActionAt)) / 1000).toFixed(1)} с`);
  }
  return { s, b, me };
}

function leave(user: User, notices: Notices) {
  tick();
  const s = store();
  const b = battleOf(s, user.id);
  if (!b || !isLive(b)) throw new u.ApiError('Вы не в бою');
  const me = b.fighters[user.id];
  if (!me.alive) throw new u.ApiError('Вы уже выбыли');
  me.alive = false;
  me.hp = 0;
  me.left = true;
  addLog(b, `🚪 ${me.name} покинул бой`, 'system', me.id);
  checkEnd(s, b);
  db.save(COLL);
  notices.push('Вы покинули бой. Взнос не возвращается, награды нет.');
  return { left: true };
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
  db.save(COLL);
  return battleState(user);
}

export = {
  view, register, unregister, setRole, battleState, act, tick, busyState, leave, ratingTable,
  doAttack, doHeal, botTurn, outOfAmmo, battleOf, battles, isLive, splitTeams,
  ROLES, ROLE_IDS, TEAM_SIZE, TOTAL_SLOTS, ENTRY, PRIZE, COST, ACTION_CD_MS,
  BOT_FILL_BEFORE_MS, BOT_STRENGTH_MIN, BOT_STRENGTH_MAX, BOT_SMART_MIN, BOT_SMART_MAX, BOT_THINK_MS,
  HEAL_MIN, HEAL_MAX, HEAL_CRIT_MIN, HEAL_CRIT_MAX, PREPARE_MS, LOBBY_MS, BOT_PREFIX,
};
