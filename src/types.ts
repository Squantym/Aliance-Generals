// ===================================================================
// src/types.ts — центральные типы игровых моделей
//
// Здесь зафиксированы все поля сущностей. Именно отсюда TypeScript
// будет ловить опечатки в полях — те самые баги, на которых мы теряли
// время: ears vs earsCurrent, legionId vs legion, battleId и т.д.
//
// По мере перевода сервисов на .ts импортируйте эти типы:
//   import type { User, Legion, Battle } from './types';
// ===================================================================

// ---------- Ресурс с регенерацией (HP / энергия / боеприпасы) ----------
export interface Resource {
  cur: number;   // текущее значение
  t: number;     // timestamp последнего пересчёта регенерации
}

export interface PlayerResources {
  hp: Resource;
  en: Resource;
  am: Resource;
}

// ---------- Навыки игрока ----------
export interface PlayerSkills {
  energy: number;
  health: number;
  ammo: number;
  cruelty: number;
  agility: number;
}

// ---------- Боевая статистика (PvP) ----------
export interface BattleStats {
  attacks: number;
  wins: number;
  losses: number;
  defWins: number;
  defLosses: number;
  fatalities: number;
}

// ---------- Счётчики достижений / зала славы ----------
export interface PlayerCounters {
  wins: number;
  attacks: number;
  fatalities: number;
  unitsBought: number;
  buildingsBuilt: number;
  missionStages: number;
  earsCut: number;
  moneyEarned: number;
  battleLoot: number;   // заработок именно с боёв (для зала славы)
  level: number;
}

// ---------- Временный эффект (допинг, команданте, и т.п.) ----------
export interface Effect {
  id: string;
  name: string;
  type: string;
  value: number;
  expiresAt: number;
  byId?: string;      // кто наложил эффект (для подлянок)
  byName?: string;    // имя наложившего (видно жертве)
  hostile?: boolean;  // true = вражеский эффект (подлянка)
}

// ---------- Поведенческий профиль (антибот) ----------
export interface BehaviorProfile {
  lastActionAt: number;
  intervals: number[];
  suspicion: number;
  lastDecayAt: number;
  verifyRequired: boolean;
  flagged: number;
}

// ---------- Ожидающее решение фаталити ----------
export interface PendingFatality {
  name: string;
  victimId?: string;
  [k: string]: unknown;
}

// ---------- Подарок от администратора ----------
export interface Gift {
  id: string;
  items?: string[];
  note?: string;
  [k: string]: unknown;
}

// ---------- ИГРОК ----------
// Главная сущность. ВНИМАНИЕ к двум разным «ушам»:
//   ears        — ТРОФЕЙНЫЕ уши (нарезанные у врагов): ресурс для трат
//                 и для зала славы. Растёт при фаталити.
//   earsCurrent — СВОИ уши игрока (лимит EARS.MAX): их отрезают враги,
//                 они регенерируют. Это НЕ ресурс для трат.
// Принадлежность к группам — через ID (allianceId / legionId), не объект.
export interface User {
  id: string;
  name: string;
  email: string;
  passHash: string;
  salt: string;
  isAdmin: boolean;
  banned?: boolean;          // забанен администратором
  banReason?: string;        // причина бана (видна игроку)
  bannedAt?: number;         // когда забанен
  resetToken?: string | null;     // токен сброса пароля
  resetTokenExp?: number;         // срок действия токена сброса
  emailVerified: boolean;
  emailVerifyToken: string | null;
  emailVerifySentAt: number;
  country: string;
  status: string;
  createdAt: number;
  lastSeen: number;

  level: number;
  xp: number;
  dollars: number;
  gold: number;
  bank: number;

  skillPoints: number;
  skills: PlayerSkills;
  res: PlayerResources;

  units: Record<string, any>; // unitId -> { 0, 1, 2 } по слотам модернизации
  workshops: number;
  modernQueue: any[];
  modernization?: any;
  buildings: Record<string, number>;
  secretDevs: Record<string, number>;
  superSecret: number;

  ears: number;          // трофейные (тратятся, идут в зал славы)
  tokens: number;        // жетоны помилования
  earsLost: number;
  earsCurrent: number;   // собственные уши (лимит), регенерируют
  earsLostAt: number[];
  // Кто отрезал уши: earCutters[0] = левое (первое отрезанное),
  // earCutters[1] = правое (второе). Каждый элемент: { id, name } или null.
  earCutters?: ({ id: string; name: string } | null)[];
  // Послание от того, кто отрезал оба уха (видно всем в профиле)
  earMessage?: { byId: string; byName: string; text: string } | null;
  earPenaltyUntil: number;
  lastAttackAt?: number;      // время последней атаки (кулдаун 1 сек)
  lastHospitalHeal?: number;  // время последнего лечения в госпитале (кулдаун 5 мин)
  adminEars?: number;    // выданные админом (не учитываются в статистике)
  adminTokens?: number;

  battle: BattleStats;
  counters: PlayerCounters;
  achStages: Record<string, number>;
  missions: Record<string, unknown>;
  tutorial: { step: number; done: boolean; quest?: unknown };
  effects: Effect[];
  trophies: Record<string, number>;
  club: Record<string, unknown>;

  // Ежедневный вход (streak)
  loginStreak?: number;
  lastLoginDay?: string;       // YYYY-MM-DD последнего награждённого входа
  // Титулы (выбранный отображается в профиле)
  titles?: string[];           // разблокированные id титулов
  activeTitle?: string | null; // выбранный титул
  // Шпионаж: бесплатные разведданные в день
  lastSpyDay?: string;
  spyCount?: number;
  spyReports?: Record<string, any>;  // кэш разведданных: targetId -> снапшот
  // Контракты от NPC
  contracts?: { id: string; progress: number; claimed?: boolean }[];
  contractsDay?: string;
  // Кастомизация профиля
  profileFrame?: string;       // id рамки
  profileBg?: string;          // id фона
  avatar?: string;             // id аватара (m1..m6 / f1..f6)
  ownedCosmetics?: string[];   // купленные косметические id
  // Реферальная система
  refCode?: string;            // личный код-приглашение
  referredBy?: string | null;  // кто пригласил
  refCount?: number;           // сколько привёл
  refRewarded?: boolean;       // получил ли реферал-бонус за вход по коду
  refLevel50Paid?: boolean;    // выплачена ли награда пригласившему за 50 ур.
  refEarnings?: number;        // сколько золота заработал на покупках рефералов
  // Рейтинговые сезоны
  seasonRating?: number;
  seasonId?: string;
  // Еженедельные метрики рейтингового сезона (пн–вс МСК)
  weekly?: {
    weekId: string;
    rating: number; wins: number; ears: number; mercy: number;
    loot: number; alliance: number; missions: number;
  };

  allianceId: string | null;
  // Личный альянс: каждый игрок растит СВОЙ счётч「члена альянса». Значения
  // не общие — у каждого своё. allianceMembers = размер личного альянса,
  // allianceRoster = список приглашённых (id/имя ботов или игроков).
  allianceMembers?: number;
  allianceRoster?: { id: string; name: string; isBot?: boolean }[];
  allianceDiplomats?: number;
  allianceInviteLog?: number[];   // метки времени отправленных заявок (для лимита/час)
  legionId: string | null;

  // Взлом банков (трофей «Медвежатник»): 1 попытка ВЗЛОМА в день —
  // счётчик увеличивается, когда игрок реально начал вскрывать сейф
  // (выбрал «Попытаться»), а не когда ему просто предложили окно.
  lastBankHackDay?: string;      // YYYY-MM-DD дня последней попытки
  bankHackCountToday?: number;   // сколько попыток взлома уже сделано сегодня (лимит 10)
  bankHackVictimsToday?: string[]; // id жертв, которых уже пытались взломать сегодня (1 раз на жертву)
  // Незавершённая попытка взлома (окно ещё открыто у игрока)
  pendingBankHack?: {
    targetId: string; targetName: string; bankAmount: number;
    code: string;                // загаданный 4-значный код (не отдаётся клиенту)
    digits: number; triesLeft: number; maxTries: number;
    history: { guess: string; bulls: number; cows: number }[];
  } | null;

  // Мины (черный рынок, трофей «Растяжка»): запас мин у игрока как
  // у ЖЕРТВЫ атаки (срабатывают автоматически при атаке на него).
  // Названо landmines (не mines!), т.к. user.mines уже занято золотыми
  // шахтами в разделе «Производство» (см. src/services/mines.ts).
  landmines?: number;            // сколько мин в запасе (макс. 10)
  // Незавершённая попытка разминирования (нападающий нарвался на мину
  // и должен выбрать провод, прежде чем бой продолжится/сорвётся)
  pendingMineDefuse?: {
    targetId: string; isBot: boolean;
    wires: string[];              // цвета проводов по порядку (для UI)
    correctIdx: number;           // индекс безопасного провода (не отдаётся клиенту)
    techLossPct: number;          // % техники к уничтожению при взрыве (по трофею жертвы)
    aArmyEntries: any[];          // «замороженная» армия атакующего на момент атаки
  } | null;

  lastIncomeAt: number;
  pendingFatality: PendingFatality | null;
  lastChatAt: number;

  // ── Диверсанты (см. src/services/saboteurs.ts) ──────────────────
  // Наличие каждого вида (может быть БОЛЬШЕ лимита — тогда излишек не
  // работает, лежит в запасе, пока не подняли лимит апгрейдом).
  saboteurs?: {
    ground: number; sea: number; air: number;
    secret: number; building: number; suicide: number;
  };
  // Личный лимит («сколько работает одновременно») по каждому виду,
  // КРОМЕ смертников — у них лимит фиксирован (SABOTEURS.suicide.fixedLimit).
  saboteurLimits?: { ground: number; sea: number; air: number; secret: number; building: number };
  // Накопительный счётчик уничтоженных ОБЫЧНЫХ диверсантов (наземных/
  // морских/воздушных) — при пересечении каждого кратного 5 гибнет
  // 1 секретный и 1 построечный (правило 5:1, см. config.SABOTEURS).
  saboteurRareLossAccum?: number;

  // Необязательные поля, появляющиеся в рантайме
  recentAttacks?: Record<string, number[]>;
  // Личная история боёв против конкретного противника (по его id):
  // { wins, losses } — нужна для ограничения фаталити тем, кто часто
  // проигрывает данному противнику.
  vsRecord?: Record<string, { wins: number; losses: number }>;
  behavior?: BehaviorProfile;
  pendingGifts?: Gift[];
  isBot?: boolean;

  // Экономика (рантайм-поля, инициализируются в сервисах)
  mines?: any[];
  minesBuiltTotal?: number;
  silos?: any[];
  silosBuiltTotal?: number;
  lasers?: any[];                // лазеры ПВО (см. src/services/lasers.ts)
  lasersBuiltTotal?: number;
  pendingRocketHits?: any[];     // отчёты о долетевших ракетах (окно у цели)
  modernProcesses?: any[];
  passport?: { nameChanges: number; countryChanges: number };
  daily?: any;
  trophyQueue?: any[];
  missionProgress?: Record<string, any>;
  missionQueue?: any[];
  containerHistory?: any[];
}

// ---------- Группа (Альянс / Легион) — общие поля ----------
export interface GroupBase {
  id: string;
  name: string;
  leaderId: string;
  members: string[];
  requests: string[];
  invites: string[];
  createdAt: number;
}

// ---------- Альянс (личная сеть союзников, у каждого свой состав) ----------
export interface Alliance extends GroupBase {
  diplomats?: number;
  inviteLog?: number[];
}

// ---------- Легион (клан с казной, постройками, боями) ----------
export interface Legion extends GroupBase {
  treasury: number;
  reserves: number;
  ratingPoints: number;
  gloryPoints: number;
  gloryEarned: number;
  treasuryEars: number;
  treasuryTokens: number;
  buildings: Record<string, number>;
  battleBuildings: Record<string, number>;
  arsenal: Record<string, number>;
  techs: Record<string, number>;
  techQueue: unknown;
  memberRanks: Record<string, number>;
  battleStats: { wins: number; losses: number };
  battleHistory: BattleHistoryEntry[];
  pendingChallenge: PendingChallenge | null;
  // Ссылка на единый объект боя (НЕ копия!)
  activeBattle: { battleId: string; enemyId: string } | null;
  chat?: ChatMessage[];
}

export interface BattleHistoryEntry {
  at: number;
  enemyId: string;
  enemyName?: string;
  won: boolean;
  loot: number;
  gloryGain?: number;
  gloryLoss?: number;
  myDamage?: number;
  enemyDamage?: number;
  myParticipants?: number;
  enemyParticipants?: number;
}

export interface PendingChallenge {
  fromLegionId: string;
  fromName: string;
  expiresAt: number;
}

export interface ChatMessage {
  userId: string;
  name: string;
  rank: number;
  text: string;
  at: number;
}

// ---------- Боец в легионном бою ----------
export interface Combatant {
  userId: string;
  name: string;
  side: 'A' | 'B';
  role: 'assault' | 'guardian' | 'medic';
  roleMul: { atk: number; def: number; dmgReduce: number };
  hp: number;
  maxHp: number;

  direction: number | null;
  ready: boolean;
  readyAt: number;
  lastActionAt: number;
  lastMoveAt: number;
  lastItemAt: number;
  gear: string[];
  statusEffects: BattleStatusEffect[];
  alive: boolean;
  stats: CombatantStats;
}

export interface CombatantStats {
  dmgDealt: number;
  dmgTaken: number;
  healed: number;
  kills: number;
  guards: number;
  itemsUsed: number;
}

export interface BattleStatusEffect {
  type: string;
  expiresAt: number;
  [k: string]: unknown;
}

// ---------- ЕДИНЫЙ объект легионного боя (в коллекции battles) ----------
// Хранится один раз, оба легиона ссылаются по id. Combatants общие.
export interface Battle {
  id: string;
  legionA: string;
  legionB: string;
  legionAName: string;
  legionBName: string;
  startedAt: number;
  prepEndsAt: number;
  activeStartAt?: number;
  activeEndsAt?: number;
  finishedAt?: number;
  phase: 'prep' | 'active' | 'done';
  winningSide?: 'A' | 'B';
  finishReason?: string;
  combatants: Record<string, Combatant>;
  gear: Record<string, string[]>;
  guardLinks: Record<string, string>;
  guardExpiry: Record<string, number>;
  log: BattleLogEntry[];
  activity?: Record<string, any>;
  finalReport?: unknown;
  teamChat?: Record<string, any[]>;   // чат по сторонам: { A: [...], B: [...] }
  globalChat?: any[];                 // общий чат боя
}

export interface BattleLogEntry {
  t?: number;
  text: string;
  kind: string;
  at?: number;
}

// ---------- Санкция (заказ на игрока) ----------
export interface SanctionEntry {
  targetId: string;
  targetName: string;
  bounty: number;
  orders: SanctionOrder[];
  createdAt: number;
}

export interface SanctionOrder {
  byId: string;
  byName: string;
  amount: number;
  at: number;
}

// ---------- Тип результата API-обработчика ----------
export type Notices = string[];
