// ===================================================================
// src/routes.ts — карта всех API-маршрутов
// Здесь URL связываются с функциями сервисов. Хелпер act() собирает
// уведомления (notices) и после каждого действия перепроверяет
// достижения — так награды никогда не теряются.
// ===================================================================

import config = require('../config/gameConfig');
import u = require('./core/utils');
import player = require('./services/player');
import auth = require('./services/auth');
import battle = require('./services/battle');
import sanctions = require('./services/sanctions');
import missions = require('./services/missions');
import units = require('./services/units');
import buildings = require('./services/buildings');
import market = require('./services/market');
import production = require('./services/production');
import mines = require('./services/mines');
import silos = require('./services/silos');
import club = require('./services/club');
import groups = require('./services/groups');
import legion = require('./services/legion');
import social = require('./services/social');
import notifications = require('./services/notifications');
import ach = require('./services/achievements');
import trophies = require('./services/trophies');
import hospital = require('./services/hospital');
import passport = require('./services/passport');
import dailyQuests = require('./services/dailyQuests');
import tutorial = require('./services/tutorial');
import admin = require('./services/admin');
import support = require('./services/support');
import payments = require('./services/payments');
import palliance = require('./services/personalAlliance');
import features = require('./services/features');
import worldEvent = require('./services/worldEvent');

function registerRoutes(app: any) {
  // Перед каждым авторизованным запросом игрок «освежается»:
  // регенерация, почасовой доход, чистка эффектов.
  app.setUserRefresher(player.refresh);

  // Обёртка для действий: собирает notices и догоняет достижения
  const act = (handler: any) => (req: any) => {
    const notices: string[] = [];
    const result = handler(req, notices) || {};
    ach.check(req.user, notices);
    return { ...result, notices };
  };

  // ---------- Авторизация (открытые маршруты) ----------
  app.add('GET', '/api/countries', () => ({ countries: config.COUNTRIES }), { open: true });
  app.add('POST', '/api/register', (req) =>
    auth.register(req.body.login, req.body.password, req.body.email, req.body.country, req.ip), { open: true });
  app.add('POST', '/api/login', (req) =>
    auth.login(req.body.login, req.body.password, req.ip), { open: true });
  app.add('POST', '/api/logout', (req) => { auth.logout(req.body.token || ''); return { ok: true }; }, { open: true });
  app.add('POST', '/api/verify-email', (req) => auth.verifyEmail(req.body.token), { open: true });
  app.add('POST', '/api/resend-verification', (req) => auth.resendVerification(req.body.login), { open: true });
  app.add('POST', '/api/request-password-reset', (req) => auth.requestPasswordReset(req.body.loginOrEmail), { open: true });
  app.add('POST', '/api/reset-password', (req) => auth.resetPassword(req.body.token, req.body.password), { open: true });

  // ---------- Игрок ----------
  app.add('GET', '/api/me', (req) => {
    // Долёт летящих ракет — чтобы цель сразу увидела попадание при заходе
    try { require('./services/silos').resolveInFlight(); } catch (e) {}
    // Ежедневная награда выдаётся автоматически при первом заходе в новый
    // день (00:00 МСК) — без отдельного окна/кнопки.
    const daily = features.claimDailyIfDue(req.user);
    return {
      ...player.mePayload(req.user),
      mailUnread: social.unread(req.user),
      notifUnread: notifications.unreadCount(req.user),
      supportUnread: support.myTickets(req.user).open.filter((t: any) => t.status === 'answered' || t.lastFrom === 'admin').length,
      rewardsUnclaimed: require('./services/rewards').pendingCount(req.user),
      eventActive: worldEvent.view(req.user).active,
      activeTitle: features.activeTitleName(req.user),
      dailyReward: daily ? { streak: daily.streak, message: daily.message } : null,
      pendingRocketHits: (req.user.pendingRocketHits && req.user.pendingRocketHits.length) ? req.user.pendingRocketHits : null,
    };
  });
  app.add('POST', '/api/status', (req) => { player.setStatus(req.user, req.body.text); return { status: req.user.status }; });
  app.add('POST', '/api/avatar', (req) => player.setAvatar(req.user, req.body.avatar));
  app.add('POST', '/api/verify-human', (req) => require('./services/antibot').passVerification(req.user));
  app.add('POST', '/api/ears/restore', act((req, n) => player.restoreEar(req.user, n)));
  app.add('POST', '/api/skill', act((req, notices) => {
    player.spendSkill(req.user, req.body.stat);
    // Сюжетное задание «Школа бойца» — единственный хук, который
    // вызывается из роутов (player не может зависеть от tutorial)
    tutorial.notify(req.user, 'skill_spent', notices);
    return { skills: req.user.skills, skillPoints: req.user.skillPoints };
  }));
  app.add('GET', '/api/profile/:id', (req) => {
    // Если ID начинается с "bot_" — отдаём профиль бота
    if (String(req.params.id).startsWith('bot_')) {
      return { profile: battle.botProfile(req.params.id, req.user) };
    }
    const target = player.users()[req.params.id];
    if (!target) throw new u.ApiError('Игрок не найден');
    player.refresh(target);
    const prof: any = player.publicProfile(target, req.user);
    // Раскрытие армии по разведке (трофей «Спутник-шпион»): если игрок ранее
    // провёл разведку этой цели — отдаём рассекреченные данные для профиля.
    if (!prof.isOwn) {
      const intel = features.spyReport(req.user, target.id);
      if (intel) prof.spyIntel = intel;
    }
    return { profile: prof };
  });
  // Найти игрока по позывному (для выбора цели — например, ракетный удар)
  app.add('GET', '/api/find-player', (req) => {
    const found = player.findByName(req.query.name || '');
    if (!found) return { userId: null };
    return { userId: found.id, name: found.name };
  });

  // ---------- Война ----------
  app.add('GET', '/api/war/opponents', (req) => battle.opponents(req.user));
  app.add('POST', '/api/war/attack', act((req, n) => battle.attack(req.user, String(req.body.targetId || ''), n)));
  app.add('POST', '/api/war/bank-hack/guess', act((req, n) => battle.bankHackGuess(req.user, String(req.body.code || ''), n)));
  app.add('POST', '/api/war/bank-hack/skip',  act((req, n) => battle.bankHackSkip(req.user)));
  app.add('POST', '/api/war/bank-hack/cancel', act((req, n) => battle.bankHackCancel(req.user)));
  app.add('POST', '/api/war/mine-defuse',     act((req, n) => battle.mineDefuse(req.user, req.body.wireIndex, n)));
  app.add('POST', '/api/war/mine-sacrifice',  act((req, n) => battle.mineSacrifice(req.user, n)));
  app.add('GET',  '/api/saboteurs', (req) => require('./services/saboteurs').view(req.user));
  app.add('POST', '/api/saboteurs/buy',     act((req, n) => require('./services/saboteurs').buyPack(req.user, req.body.type, req.body.packs, n)));
  app.add('POST', '/api/saboteurs/suicide/buy', act((req, n) => require('./services/saboteurs').buySuicide(req.user, req.body.qty, n)));
  app.add('POST', '/api/saboteurs/upgrade', act((req, n) => require('./services/saboteurs').upgradeLimit(req.user, req.body.type, n)));
  app.add('GET',  '/api/sanctions', (req) => sanctions.list(req.user));
  app.add('POST', '/api/sanctions/declare', act((req, n) => sanctions.declare(req.user, String(req.body.targetId || ''), req.body.amount, n)));
  app.add('POST', '/api/war/fatality', act((req, n) => battle.fatality(req.user, req.body.choice, n)));
  app.add('POST', '/api/war/ear-message', act((req, n) => battle.leaveEarMessage(req.user, String(req.body.victimId || ''), String(req.body.text || ''), n)));

  // ---------- Миссии ----------
  app.add('GET',  '/api/missions',          (req) => missions.list(req.user));
  app.add('GET',  '/api/missions/:id',      (req) => missions.detail(req.user, req.params.id));
  app.add('POST', '/api/missions/start',    act((req, n) => missions.startStep(req.user, req.body.confId, u.toInt(req.body.opIdx, 0), u.toInt(req.body.stepIdx, 0), n)));
  app.add('POST', '/api/missions/boost',    act((req, n) => missions.boostStep(req.user, req.body.processId, n)));

  // ---------- Техника ----------
  app.add('GET', '/api/units', (req) => units.list(req.user));
  app.add('POST', '/api/units/buy', act((req, n) => units.buy(req.user, req.body.unitId, req.body.qty, n)));
  app.add('POST', '/api/units/sell', act((req) => units.sell(req.user, req.body.unitId, req.body.qty)));

  // ---------- Постройки ----------
  app.add('GET', '/api/buildings', (req) => buildings.list(req.user));
  app.add('POST', '/api/buildings/build', act((req, n) => buildings.build(req.user, req.body.buildingId, req.body.qty, n)));

  // ---------- Производство ----------
  app.add('GET', '/api/production', (req) => production.view(req.user));
  app.add('POST', '/api/production/workshop', act((req, n) => production.buyWorkshop(req.user, n)));
  app.add('POST', '/api/production/start',    act((req, n) => production.startModernization(req.user, req.body, n)));
  app.add('POST', '/api/production/boost',    act((req, n) => production.boostProcess(req.user, req.body.processId, n)));

  // ---------- Шахты ----------
  app.add('GET',  '/api/mines',              (req) => mines.view(req.user));
  app.add('POST', '/api/mines/buy-plot',     act((req, n) => mines.buyPlot(req.user, n)));
  app.add('POST', '/api/mines/build',        act((req, n) => mines.build(req.user, req.body.mineId, n)));
  app.add('POST', '/api/mines/rebuild',      act((req, n) => mines.rebuild(req.user, req.body.mineId, n)));
  app.add('POST', '/api/mines/descend',      act((req, n) => mines.descend(req.user, req.body.mineId, req.body.minutes, n)));
  app.add('POST', '/api/mines/fight',        act((req, n) => mines.fightTerrorists(req.user, req.body.mineId, n)));
  app.add('POST', '/api/mines/dismiss',      act((req, n) => mines.dismissResult(req.user, req.body.mineId, n)));
  app.add('POST', '/api/admin/mines/wipe',   act((req, n) => mines.wipeAllMines(req.user, n)), { admin: true });

  // ---------- Ракетные шахты ----------
  app.add('GET',  '/api/silos',              (req) => silos.view(req.user));
  app.add('POST', '/api/silos/build',        act((req, n) => silos.build(req.user, n)));
  app.add('POST', '/api/silos/boost',        act((req, n) => silos.boost(req.user, req.body.siloId, n)));
  app.add('POST', '/api/silos/fuel-ready',   act((req, n) => silos.fuelReady(req.user, req.body.siloId, req.body.amount, n)));
  app.add('POST', '/api/silos/fuel-power',   act((req, n) => silos.fuelPower(req.user, req.body.siloId, req.body.amount, n)));
  app.add('POST', '/api/silos/launch',       act((req, n) => silos.launch(req.user, req.body.siloId, req.body.targetId, n)));
  app.add('POST', '/api/rockets/dismiss-hit', (req) => require('./services/silos').dismissRocketHit(req.user));
  // ---------- Лазеры (ПВО) ----------
  app.add('GET',  '/api/lasers',             (req) => require('./services/lasers').view(req.user));
  app.add('POST', '/api/lasers/build',       act((req, n) => require('./services/lasers').buyLaser(req.user, n)));
  app.add('POST', '/api/lasers/boost',       act((req, n) => require('./services/lasers').boost(req.user, req.body.laserId, n)));
  app.add('POST', '/api/lasers/fuel-ready',  act((req, n) => require('./services/lasers').fuelReady(req.user, req.body.laserId, req.body.amount, n)));
  app.add('POST', '/api/lasers/fuel-power',  act((req, n) => require('./services/lasers').fuelPower(req.user, req.body.laserId, req.body.amount, n)));
  app.add('POST', '/api/lasers/intercept',   act((req, n) => require('./services/lasers').intercept(req.user, req.body.laserId, req.body.rocketId, n)));

  // ---------- Чёрный рынок ----------
  app.add('GET', '/api/market/items', () => market.itemsList());
  app.add('POST', '/api/market/buy', act((req, n) => market.buyItem(req.user, req.body.itemId, req.body.targetName, n)));
  app.add('GET', '/api/market/mines', (req) => market.mineInfo(req.user));
  app.add('POST', '/api/market/mines/buy', act((req, n) => market.buyMines(req.user, req.body.qty, n)));
  app.add('GET', '/api/market/containers', (req) => market.containersView(req.user));
  app.add('POST', '/api/market/open', act((req, n) => market.openContainer(req.user, req.body.tier, n, req.body.qty)));
  app.add('GET', '/api/market/container-history', (req) => market.containerHistory(req.user));
  app.add('GET', '/api/market/auction', () => market.auctionView());
  app.add('POST', '/api/market/bid', act((req, n) => market.bid(req.user, req.body.lotId, req.body.amount, n)));

  // ---------- Клуб офицеров ----------
  app.add('GET', '/api/club', (req) => club.view(req.user));
  // 1. Военный преферанс
  app.add('POST', '/api/club/pref/start', act((req) => club.prefStart(req.user)));
  app.add('POST', '/api/club/pref/hit',   act((req, n) => club.prefHit(req.user, n)));
  app.add('POST', '/api/club/pref/stand', act((req, n) => club.prefStand(req.user, n)));
  // 2. Сейф штаба
  app.add('POST', '/api/club/safe/start', act((req) => club.safeStart(req.user)));
  app.add('POST', '/api/club/safe/try',   act((req, n) => club.safeTry(req.user, req.body.guess, n)));
  // 3. Минное поле
  app.add('POST', '/api/club/mine/start',   act((req) => club.mineStart(req.user)));
  app.add('POST', '/api/club/mine/open',    act((req, n) => club.mineOpen(req.user, req.body.cell, n)));
  app.add('POST', '/api/club/mine/cashout', act((req, n) => club.mineCashout(req.user, n)));
  // 4. Полоса препятствий
  app.add('POST', '/api/club/run/start',   act((req) => club.runStart(req.user)));
  app.add('POST', '/api/club/run/step',    act((req, n) => club.runStep(req.user, req.body.level, n)));
  app.add('POST', '/api/club/run/cashout', act((req, n) => club.runCashout(req.user, n)));
  // 5. Штабная партия
  app.add('POST', '/api/club/duel/start', act((req) => club.duelStart(req.user)));
  app.add('POST', '/api/club/duel/move',  act((req, n) => club.duelMove(req.user, req.body.unit, n)));

  // ---------- Трофеи ----------
  app.add('GET', '/api/trophies', (req) => trophies.list(req.user));
  app.add('POST', '/api/trophies/start',   act((req, n) => trophies.startUpgrade(req.user, req.body.id, n)));
  app.add('POST', '/api/trophies/boost',   act((req, n) => trophies.boostUpgrade(req.user, req.body.id, n)));

  // ---------- Госпиталь ----------
  app.add('GET',  '/api/hospital',         (req) => hospital.view(req.user));
  app.add('POST', '/api/hospital/heal',    act((req, n) => hospital.heal(req.user, n)));

  // ---------- Паспорт (на чёрном рынке) ----------
  app.add('GET',  '/api/passport',         (req) => passport.view(req.user));
  app.add('POST', '/api/passport/name',    act((req, n) => passport.changeName(req.user, req.body.newName, n)));
  app.add('POST', '/api/passport/country', act((req, n) => passport.changeCountry(req.user, req.body.country, n)));

  // ---------- Ежедневные задания ----------
  app.add('GET',  '/api/daily',            (req) => dailyQuests.list(req.user));
  app.add('POST', '/api/daily/claim',      act((req, n) => dailyQuests.claim(req.user, req.body.questId, n)));
  app.add('POST', '/api/daily/bonus',      act((req, n) => dailyQuests.claimBonus(req.user, n)));

  // ---------- Банк ----------
  app.add('POST', '/api/bank', act((req) => {
    if (req.body.action === 'deposit') player.bankDeposit(req.user, req.body.amount);
    else if (req.body.action === 'withdraw') player.bankWithdraw(req.user, req.body.amount);
    else throw new u.ApiError('Неизвестная операция');
    return { dollars: req.user.dollars, bank: req.user.bank };
  }));
  app.add('POST', '/api/bank/reserve',         act((req, n) => player.reserveForLegion(req.user, req.body.dollars, n)));
  app.add('GET',  '/api/bank/gold-packages', (req) => ({ packages: player.goldPackages() }));
  app.add('POST', '/api/bank/buy-gold',      act((req) => player.buyGold(req.user, req.body.packId)));

  // ---------- Альянс ----------
  // ---------- Группы (альянс и легион работают через один API) ----------
  // :kind — 'alliance' или 'legion'
  app.add('GET',  '/api/group/:kind',         (req) => groups.view(req.user, req.params.kind));
  app.add('GET',  '/api/group/:kind/invites', (req) => ({ invites: groups.pendingInvites(req.user, req.params.kind) }));
  app.add('POST', '/api/group/:kind/create',  act((req, n) => groups.create(req.user, req.params.kind, req.body.name, n)));
  app.add('POST', '/api/group/:kind/apply',   act((req, n) => groups.apply(req.user, req.params.kind, req.body.groupId, n)));
  app.add('POST', '/api/group/:kind/decide',  act((req, n) => groups.decide(req.user, req.params.kind, req.body.userId, !!req.body.accept, n)));
  app.add('POST', '/api/group/:kind/invite',  act((req, n) => groups.invite(req.user, req.params.kind, req.body.userId, n)));
  app.add('POST', '/api/group/:kind/diplomat', act((req, n) => groups.hireDiplomat(req.user, req.params.kind, n)));
  app.add('POST', '/api/group/:kind/respond', act((req, n) => groups.respondInvite(req.user, req.params.kind, req.body.groupId, !!req.body.accept, n)));
  app.add('POST', '/api/group/:kind/kick',    act((req, n) => groups.kick(req.user, req.params.kind, req.body.userId, n)));
  // Личный альянс (у каждого игрока свой)
  app.add('GET',  '/api/alliance',          (req) => palliance.view(req.user));
  app.add('GET',  '/api/alliance/invites',  (req) => palliance.myInvites(req.user));
  app.add('POST', '/api/alliance/invite-bot', act((req, n) => palliance.inviteBot(req.user, n)));
  app.add('POST', '/api/alliance/diplomat',   act((req, n) => palliance.buyDiplomat(req.user, n)));
  app.add('POST', '/api/alliance/invite',   act((req, n) => palliance.invitePlayer(req.user, req.body.name, n)));
  app.add('POST', '/api/alliance/accept',   act((req, n) => palliance.acceptInvite(req.user, req.body.fromId, n)));
  app.add('POST', '/api/alliance/decline',  act((req, n) => palliance.declineInvite(req.user, req.body.fromId, n)));
  app.add('POST', '/api/alliance/remove',   act((req, n) => palliance.removeMember(req.user, req.body.memberId, n)));
  // ── Новые системы ──
  // Ежедневный вход
  app.add('GET',  '/api/streak',       (req) => features.loginStreakView(req.user));
  // Титулы
  app.add('GET',  '/api/titles',     (req) => features.titlesView(req.user));
  app.add('POST', '/api/titles/set', act((req, n) => features.setTitle(req.user, req.body.titleId, n)));
  // Контракты
  app.add('GET',  '/api/contracts',       (req) => features.contractsView(req.user));
  app.add('POST', '/api/contracts/claim', act((req, n) => features.claimContract(req.user, req.body.contractId, n)));
  // Косметика
  app.add('GET',  '/api/cosmetics',         (req) => features.cosmeticsView(req.user));
  app.add('POST', '/api/cosmetics/buy',     act((req, n) => features.buyCosmetic(req.user, req.body.id, n)));
  app.add('POST', '/api/cosmetics/equip',   act((req, n) => features.equipCosmetic(req.user, req.body.id, n)));
  app.add('POST', '/api/cosmetics/unequip', act((req, n) => features.unequipCosmetic(req.user, req.body.type)));
  // Рефералы
  app.add('GET',  '/api/referral',       (req) => features.referralView(req.user));
  app.add('POST', '/api/referral/apply', act((req, n) => features.applyReferral(req.user, req.body.code, n)));
  // Шпионаж
  app.add('POST', '/api/spy', act((req, n) => features.spyOn(req.user, req.body.targetId, n)));
  // Рейтинговые сезоны
  app.add('GET',  '/api/season', (req) => require('./services/seasons').view(req.user));
  app.add('POST', '/api/admin/season/config', act((req) => require('./services/seasons').adminSetRewards(req.user, req.body)), { admin: true });
  app.add('POST', '/api/admin/season/end',    act((req, n) => require('./services/seasons').adminForceRollover(req.user, n)), { admin: true });
  // Мировое событие (босс)
  app.add('GET',  '/api/event',        (req) => worldEvent.view(req.user));
  app.add('POST', '/api/event/attack', act((req, n) => worldEvent.attack(req.user, n)));
  app.add('POST', '/api/admin/event/start', act((req, n) => worldEvent.adminStart(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/event/stop',  act((req, n) => worldEvent.adminStop(req.user, n)), { admin: true });
  app.add('POST', '/api/admin/event/drops', act((req, n) => worldEvent.adminSetDrops(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/event/hp', act((req, n) => worldEvent.adminSetHp(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/group/:kind/leave',   act((req, n) => groups.leave(req.user, req.params.kind, n)));

  // ---------- Легион: казна, постройки, кланвойны ----------
  app.add('GET',  '/api/legion',                   (req) => legion.view(req.user));
  app.add('GET',  '/api/legion/battle',             (req) => legion.battleState(req.user));
  app.add('POST', '/api/legion/deposit-resources', act((req, n) => legion.depositResources(req.user, req.body.ears, req.body.tokens, req.body.useAdmin, n)));
  app.add('POST', '/api/legion/exchange',          act((req, n) => legion.exchangeToReserves(req.user, req.body.dollars, n)));
  app.add('POST', '/api/legion/build',             act((req, n) => legion.build(req.user, req.body.buildingId, n)));
  app.add('POST', '/api/legion/build-battle',      act((req, n) => legion.buildBattle(req.user, req.body.buildingId, n)));
  app.add('POST', '/api/legion/tech/start',        act((req, n) => legion.startTech(req.user, req.body.techId, n)));
  app.add('POST', '/api/legion/shop/buy',          act((req, n) => legion.shopBuy(req.user, req.body.itemId, req.body.qty, n)));
  app.add('POST', '/api/legion/gear/pick',         act((req, n) => legion.gearPick(req.user, req.body.itemId, n)));
  app.add('POST', '/api/legion/challenge',         act((req, n) => legion.challengeLegion(req.user, req.body.enemyId, n)));
  app.add('POST', '/api/legion/challenge/accept',  act((req, n) => legion.acceptChallenge(req.user, n)));
  app.add('POST', '/api/legion/challenge/decline', act((req, n) => legion.declineChallenge(req.user, n)));
  app.add('POST', '/api/legion/war',               act((req, n) => legion.declareWar(req.user, req.body.enemyId, n)));
  app.add('POST', '/api/legion/rank',              act((req, n) => legion.setRank(req.user, req.body.targetId, req.body.rank, n)));
  app.add('GET',  '/api/legion/chat',              (req) => legion.chatGet(req.user));
  app.add('POST', '/api/legion/chat',              act((req, n) => legion.chatPost(req.user, req.body.text, n)));
  app.add('GET',  '/api/legion/public/:id',        (req) => legion.publicView(req.params.id, req.user));
  // Админ-привилегии прямо в аккаунте (проверка isAdmin — внутри обработчиков)
  app.add('POST', '/api/legion/admin-join',        act((req, n) => require('./services/groups').adminJoin(req.user, 'legion', req.body.legionId, n)));
  app.add('POST', '/api/legion/admin-deposit',     act((req, n) => legion.adminDeposit(req.user, req.body.legionId, req.body.amount, n, req.body.resource)));

  // ---------- Новости (чтение — всем; управление — админу, проверка в сервисе) ----------
  app.add('GET',  '/api/news',        (req) => require('./services/news').list(req.user));
  app.add('POST', '/api/news/create', act((req, n) => require('./services/news').create(req.user, req.body, n)));
  app.add('POST', '/api/news/update', act((req, n) => require('./services/news').update(req.user, req.body.id, req.body, n)));
  app.add('POST', '/api/news/delete', act((req, n) => require('./services/news').remove(req.user, req.body.id, n)));
  app.add('POST', '/api/news/pin',    act((req, n) => require('./services/news').togglePin(req.user, req.body.id, n)));
  app.add('POST', '/api/legion/battle/join',       act((req, n) => legion.joinBattle(req.user, req.body.role, n)));
  app.add('POST', '/api/legion/battle/ready',      act((req, n) => legion.setReady(req.user, req.body.ready, n)));
  app.add('POST', '/api/legion/battle/direction',  act((req, n) => legion.chooseDirection(req.user, req.body.direction, n)));
  app.add('POST', '/api/legion/battle/attack',     act((req, n) => legion.attack(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/heal',       act((req, n) => legion.heal(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/chat',       act((req, n) => legion.sendChat(req.user, String(req.body.scope||'team'), String(req.body.text||''), n)));
  app.add('POST', '/api/legion/battle/guard',      act((req, n) => legion.guard(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/item',       act((req, n) => legion.useItem(req.user, req.body.itemId, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/leave',      act((req, n) => legion.leaveBattle(req.user, n)));
  app.add('POST', '/api/legion/battle/restore',    act((req, n) => legion.restoreForBattle(req.user, req.body.kind, n)));

  // ---------- Чат, почта, зал славы, достижения ----------
  app.add('GET', '/api/chat', (req) => social.chatGet(req.query.after));
  app.add('POST', '/api/chat', act((req) => { social.chatPost(req.user, req.body.text); return { ok: true }; }));
  app.add('GET', '/api/mail', (req) => social.inbox(req.user));
  app.add('GET', '/api/mail/:id', (req) => social.readThread(req.user, req.params.id));
  app.add('POST', '/api/mail/read-all', act((req) => social.markAllRead(req.user)));
  app.add('POST', '/api/mail/:id/delete', act((req) => social.deleteMail(req.user, req.params.id)));
  app.add('POST', '/api/mail', act((req, n) => {
    social.sendMail(req.user, req.body.toName, req.body.subject, req.body.text);
    n.push('✉ Письмо отправлено.');
    return { ok: true };
  }));
  app.add('GET', '/api/fame', () => require('./services/fame').fame());
  // Принудительный сброс снапшота «за сегодня» (только для администратора)
  app.add('POST', '/api/admin/fame/reset-snapshot', (req) => {
    require('./services/fame').forceResetSnapshot();
    return { ok: true, message: 'Снапшот сброшен. При следующем запросе /api/fame создастся новый.' };
  }, { admin: true });

  // ---------- Уведомления (колокольчик) ----------
  app.add('GET',  '/api/notifications',           (req) => notifications.list(req.user));
  app.add('POST', '/api/notifications/:id/read',  act((req) => { notifications.markRead(req.user, req.params.id); return { ok: true }; }));
  app.add('POST', '/api/notifications/read-all',  act((req) => { notifications.markAllRead(req.user); return { ok: true }; }));
  app.add('GET', '/api/achievements', (req) => ach.list(req.user));

  // ---------- Администратор ----------
  app.add('GET', '/api/admin/players', (req) => admin.listPlayers(req.query.q), { admin: true });
  app.add('GET', '/api/admin/player-view/:id', (req) => admin.viewAsPlayer(req.user, req.params.id), { admin: true });
  app.add('GET', '/api/admin/player-snapshot/:id', (req) => admin.playerSnapshot(req.user, req.params.id), { admin: true });
  app.add('GET', '/api/admin/groups/:kind', (req) => require('./services/groups').listAllAdmin(req.params.kind), { admin: true });
  app.add('GET', '/api/admin/groups/:kind/:id', (req) => require('./services/groups').viewDetailAdmin(req.params.kind, req.params.id), { admin: true });
  app.add('POST', '/api/admin/legion/deposit', act((req, n) => require('./services/legion').adminDeposit(req.user, req.body.legionId, req.body.amount, n, req.body.resource)), { admin: true });
  app.add('POST', '/api/admin/legion/battle', act((req, n) => require('./services/legion').adminStartBattle(req.user, req.body.legionAId, req.body.legionBId, n)), { admin: true });
  // Турниры легионов
  app.add('GET',  '/api/admin/tournaments',        () => require('./services/tournaments').list(), { admin: true });
  app.add('GET',  '/api/admin/tournaments/legions', () => require('./services/tournaments').legionOptions(), { admin: true });
  app.add('GET',  '/api/admin/tournaments/:id',    (req) => require('./services/tournaments').view(req.params.id), { admin: true });
  app.add('POST', '/api/admin/tournaments/create', act((req, n) => require('./services/tournaments').create(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/tournaments/:id/cancel', act((req, n) => require('./services/tournaments').cancel(req.user, req.params.id, n)), { admin: true });
  app.add('POST', '/api/admin/grant',      act((req, n) => admin.grant(req.user, req.body, n)),    { admin: true });
  app.add('POST', '/api/admin/grant-all',  act((req, n) => admin.grantAll(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/rewards/grant', act((req, n) => require('./services/rewards').adminGrant(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/claim-gift', act((req, n) => { const r = admin.claimGift(req.user, req.body.giftId); n.push('OK'); return r; }));
  app.add('GET',  '/api/admin/discounts', () => admin.discountCategories(), { admin: true });
  app.add('POST', '/api/admin/discount',  act((req, n) => admin.setDiscount(req.user, req.body, n)), { admin: true });
  app.add('GET',  '/api/admin/global-buffs', () => admin.listGlobalBuffs(), { admin: true });
  app.add('POST', '/api/admin/global-buff',  act((req, n) => admin.setGlobalBuff(req.user, req.body, n)), { admin: true });
  app.add('GET',  '/api/admin/logs',      (req) => admin.listLogs(req.query), { admin: true });
  // Бан и обнуление аккаунтов
  app.add('POST', '/api/admin/ban',   act((req, n) => admin.setBan(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/reset', act((req, n) => admin.resetAccount(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/reset-param', act((req, n) => admin.resetParam(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/reset-missions', act((req, n) => admin.resetMissions(req.user, req.body, n)), { admin: true });
  // Диагностика почты: статус конфигурации и тестовая отправка
  app.add('GET',  '/api/admin/email/status', () => require('./services/email').status(), { admin: true });
  app.add('POST', '/api/admin/email/test', (req) => require('./services/email').sendTest(req.body.to), { admin: true });
  app.add('POST', '/api/admin/wipe-groups', act((req, n) => admin.wipeGroups(req.user, req.body, n)), { admin: true });
  // Служба поддержки — пользователь
  app.add('GET',  '/api/support',        (req) => support.myTickets(req.user));
  app.add('POST', '/api/support/create', act((req, n) => support.createTicket(req.user, req.body.category, req.body.subject, req.body.text, n)));
  app.add('POST', '/api/support/reply',  act((req, n) => support.replyTicket(req.user, req.body.ticketId, req.body.text, n)));

  // Push-уведомления на телефон
  const push = require('./services/push');
  app.add('GET',  '/api/push/key',         () => ({ key: push.getPublicKey() }));
  app.add('GET',  '/api/push/status',      (req) => ({ devices: push.deviceCount(req.user) }));
  app.add('POST', '/api/push/subscribe',   act((req) => push.subscribe(req.user, req.body.subscription)));
  app.add('POST', '/api/push/unsubscribe', act((req) => push.unsubscribe(req.user, req.body.endpoint)));
  app.add('GET',  '/api/admin/push/stats', () => push.adminStats(), { admin: true });
  app.add('POST', '/api/admin/push/broadcast', act((req, n) => push.broadcast(req.user, req.body.title, req.body.body, n)), { admin: true });

  // Награды-письма от «Система» (сезоны, администрация)
  const rewards = require('./services/rewards');
  app.add('GET',  '/api/rewards',            (req) => ({ rewards: rewards.listFor(req.user), pending: rewards.pendingCount(req.user) }));
  app.add('POST', '/api/rewards/:id/claim',  act((req, n) => rewards.claim(req.user, req.params.id, n)));
  app.add('POST', '/api/rewards/:id/delete', act((req) => rewards.remove(req.user, req.params.id)));
  // Служба поддержки — администратор
  app.add('GET',  '/api/admin/support',       (req) => support.adminList(req.query), { admin: true });
  app.add('POST', '/api/admin/support/reply', act((req, n) => support.adminReply(req.user, req.body.ticketId, req.body.text, !!req.body.close, n)), { admin: true });
  // Платёжная система (заготовка)
  app.add('GET',  '/api/payments/packages', (req) => payments.packages());
  app.add('GET',  '/api/payments/orders',   (req) => payments.myOrders(req.user));
  app.add('POST', '/api/payments/create',   act((req, n) => payments.createOrder(req.user, req.body.packageId, n)));
};

export = registerRoutes;
