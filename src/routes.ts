// ===================================================================
// src/routes.ts — карта всех API-маршрутов
// Здесь URL связываются с функциями сервисов. Хелпер act() собирает
// уведомления (notices) и после каждого действия перепроверяет
// достижения — так награды никогда не теряются.
// ===================================================================

import config = require('../config/gameConfig');
import u = require('./core/utils');
import db = require('./core/db');
import player = require('./services/player');
import auth = require('./services/auth');
import twoFactor = require('./services/twoFactor');
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
import auditLog = require('./services/auditLog');
import payments = require('./services/payments');
import palliance = require('./services/personalAlliance');
import features = require('./services/features');
import worldEvent = require('./services/worldEvent');

// Сохранение картинки темы. Браузер присылает уже уменьшенное
// изображение как data:URL — здесь проверяем формат и размер и кладём
// файлом: base64 в базе раздул бы её в разы.
// Записи журнала приходят с сырым адресом запроса. Переводим их в
// человеческий вид ОДИН РАЗ на сервере: иначе каждый экран панели
// показывал бы «/api/war/attack» вместо «Атаковал игрока».
// Журнал наружу — БЕЗ сырого тела запроса.
//
// Раньше здесь был `...l`, то есть в ответ уходило поле body целиком. Это
// значило, что уже записанные в журнал секреты (см. sanitizeBody в
// auditLog: до исправления туда попадали oldPassword/newPassword) мог
// прочитать любой сотрудник с зоной «Игроки» — достаточно посмотреть ответ
// запроса в браузере. Вырезание секретов при ЗАПИСИ закрывает будущее,
// а это — доступ к тому, что уже лежит.
//
// body используется только внутри, чтобы собрать человеческое описание,
// и дальше не отдаётся. Если сотруднику нужны подробности действия — они
// в самом описании, а не в сыром теле запроса.
function humanizeLogs(logs: any[]): any[] {
  const translate = require('./services/logTranslate');
  return (logs || []).map((l: any) => {
    const { body, params, ...safe } = l;
    return {
      ...safe,
      human: l.human || translate.describe(l.path, body, l.result) || l.path,
    };
  });
}

// Поимённая разница по технике: что было в копии и чего не хватает сейчас.
// Возвращаем только недостачу — прибыль после сбоя разбирательству не мешает.
function unitDiff(was: any, now: any): any[] {
  const out: any[] = [];
  for (const id of Object.keys(was || {})) {
    const w = was[id] || {}, n = (now && now[id]) || {};
    for (let mk = 0; mk <= 2; mk++) {
      const lost = (w[mk] || 0) - (n[mk] || 0);
      if (lost > 0) {
        const def = config.UNIT_BY_ID[id];
        out.push({ id, mk, name: (def ? def.name : id) + (mk ? ` Mk${mk}` : ''), lost });
      }
    }
  }
  return out.sort((a, b) => b.lost - a.lost).slice(0, 60);
}

function buildDiff(was: any, now: any): any[] {
  const out: any[] = [];
  for (const id of Object.keys(was || {})) {
    const lost = (was[id] || 0) - ((now && now[id]) || 0);
    if (lost > 0) {
      const def = config.BUILDING_BY_ID[id];
      out.push({ id, name: def ? def.name : id, lost });
    }
  }
  return out.sort((a, b) => b.lost - a.lost).slice(0, 60);
}

function saveForumImage(dataUrl: any): string | null {
  const raw = String(dataUrl || '');
  if (!raw) return null;
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m) throw new u.ApiError('Неподдерживаемый формат изображения');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 700 * 1024) throw new u.ApiError('Изображение слишком большое даже после сжатия');
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(process.cwd(), 'data', 'forum');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return '/forum-img/' + name;
}

function registerRoutes(app: any) {
  // Перед каждым авторизованным запросом игрок «освежается»:
  // регенерация, почасовой доход, чистка эффектов.
  app.setUserRefresher(player.refresh);

  // Обёртка для действий: собирает notices и догоняет достижения.
  // ВАЖНО: await обязателен. Обработчик может быть асинхронным (например,
  // смена пароля — там scrypt считается в пуле потоков), и без await сюда
  // попадал бы Promise: `{ ...Promise }` даёт пустой объект, то есть ответ
  // игроку молча терял бы всё содержимое. Роутер сам ждёт результат
  // обработчика, поэтому возвращать отсюда промис безопасно.
  const act = (handler: any) => async (req: any) => {
    const notices: string[] = [];
    const result = (await handler(req, notices)) || {};
    ach.check(req.user, notices);
    return { ...result, notices };
  };

  // ---------- Авторизация (открытые маршруты) ----------
  app.add('GET', '/api/countries', () => ({ countries: config.COUNTRIES }), { open: true });
  app.add('POST', '/api/register', (req) =>
    auth.register(req.body.login, req.body.password, req.body.email, req.body.country, req.ip, req.ua, (req as any).hints, (req as any).fp), { open: true });
  app.add('POST', '/api/login', (req) =>
    auth.login(req.body.login, req.body.password, req.ip, req.ua, (req as any).hints, (req as any).fp), { open: true });
  // Второй шаг входа: код из приложения-аутентификатора либо код
  // восстановления. Открытый роут — пароль уже проверен на первом шаге,
  // а сам пропуск живёт 5 минут и сгорает после пяти неверных попыток.
  app.add('POST', '/api/login/totp', (req) =>
    auth.loginTotp(req.body.challengeId, req.body.code, req.ip, req.ua, (req as any).hints, (req as any).fp), { open: true });
  app.add('POST', '/api/logout', (req) => { auth.logout(req.body.token || ''); return { ok: true }; }, { open: true });

  // ═══ ВТОРОЙ ФАКТОР: подключение и управление ═════════════════════
  // Только для сотрудников. У обычного игрока красть, кроме его же
  // прогресса, нечего, а потерянный телефон обернулся бы потоком
  // обращений в поддержку — цена защиты превысила бы пользу.
  const staffOnly2fa = (user: any) => {
    if (!roles.zonesFor(user).length) {
      throw new u.ApiError('Второй фактор подключается сотрудникам — у вашей учётной записи нет доступа к панели');
    }
  };
  app.add('GET',  '/api/2fa/status', (req) => {
    staffOnly2fa(req.user);
    return twoFactor.status(req.user);
  });
  app.add('POST', '/api/2fa/setup', (req) => {
    staffOnly2fa(req.user);
    return twoFactor.setup(req.user, 'Генералы');
  });
  app.add('POST', '/api/2fa/enable', act((req, n) => {
    staffOnly2fa(req.user);
    return twoFactor.enable(req.user, String(req.body.code || ''), n);
  }));
  app.add('POST', '/api/2fa/disable', act((req, n) => {
    staffOnly2fa(req.user);
    return twoFactor.disable(req.user, String(req.body.code || ''), n);
  }));
  app.add('POST', '/api/2fa/recovery', act((req, n) => {
    staffOnly2fa(req.user);
    return twoFactor.regenerateRecovery(req.user, String(req.body.code || ''), n);
  }));
  app.add('POST', '/api/verify-email', (req) => auth.verifyEmail(req.body.token), { open: true });
  app.add('POST', '/api/resend-verification', (req) => auth.resendVerification(req.body.login, req.ip), { open: true });
  app.add('POST', '/api/request-password-reset', (req) => auth.requestPasswordReset(req.body.loginOrEmail), { open: true });
  app.add('POST', '/api/reset-password', (req) => auth.resetPassword(req.body.token, req.body.password, req.ip), { open: true });

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
      // Награда за вход ждёт получения в окне (не начисляется молча)
      pendingLoginReward: (req.user as any).pendingLoginReward || null,
      // Роль в проекте: фронт по ней рисует значок и кнопки модерации
      staffRole: require('./services/roles').roleOf(req.user),
      staffLabel: require('./services/roles').roleLabel(req.user) || null,
      staffTag: require('./services/roles').roleTag(req.user) || null,
      vip: require('./services/vip').isVip(req.user),
      // Состояние боёв: нужно на каждом экране — показать плашку с
      // отсчётом и запереть игрока в бою, где бы он ни находился
      combat: (() => {
        try {
          const a = require('./services/arena');
          const g = require('./services/groupBattle');
          const av = a.view(req.user, 'elite');
          const av2 = a.view(req.user, 'basic');
          const gv = g.view(req.user);
          const inArena = a.busyState(req.user.id);
          const inGroup = g.busyState(req.user.id);
          const arenaBattle = a.battleState(req.user);
          const groupBattle = g.battleState(req.user);
          const fighting = !!(arenaBattle.active && arenaBattle.me && arenaBattle.me.alive)
            || !!(groupBattle.active && groupBattle.me && groupBattle.me.alive);
          const regDiv = av.iAmRegistered ? 'elite' : (av2.iAmRegistered ? 'basic' : null);
          // Идёт подготовка и место ещё не занято — зовём в комнату
          const needArena = !!(av.battle && av.battle.needEnter) || !!(av2.battle && av2.battle.needEnter);
          const needGroup = !!(gv.battle && gv.battle.needEnter);
          const prepLeft = needArena
            ? ((av.battle && av.battle.prepareLeftSec) || (av2.battle && av2.battle.prepareLeftSec) || 0)
            : ((gv.battle && gv.battle.prepareLeftSec) || 0);
          return {
            fighting,
            needEnter: needArena || needGroup,
            prepareLeftSec: prepLeft,
            enterWhere: needArena ? 'arena' : (needGroup ? 'group' : null),
            where: (arenaBattle.active && arenaBattle.me && arenaBattle.me.alive) ? 'arena'
              : ((groupBattle.active && groupBattle.me && groupBattle.me.alive) ? 'group' : null),
            registered: !!inArena || !!inGroup,
            regWhere: regDiv ? 'arena' : (gv.iAmRegistered ? 'group' : null),
            regDiv,
            startsAt: regDiv ? (regDiv === 'elite' ? av.nextStartAt : av2.nextStartAt)
              : (gv.iAmRegistered ? gv.nextStartAt : 0),
          };
        } catch (e) {
          return { fighting: false, needEnter: false, prepareLeftSec: 0, enterWhere: null,
                   where: null, registered: false, regWhere: null, startsAt: 0 };
        }
      })(),
      accountLogin: (req.user as any).accountLogin || '',
      vipUntil: Number((req.user as any).vipUntil || 0),
      // Зоны админ-панели, доступные этому сотруднику
      staffZones: require('./services/roles').zonesFor(req.user),
      // Адрес панели отдаём ТОЛЬКО тем, у кого есть доступ. Так сотрудникам
      // не нужно знать секретный путь: они нажимают кнопку в игре, а сам
      // путь известен только владельцу и не расходится по людям.
      staffPanel: (require('./services/roles').zonesFor(req.user).length
        ? (process.env.ADMIN_PATH || null) : null),
      // Своя блокировка чата — чтобы поле ввода сразу показало причину
      chatBan: require('./services/roles').chatBanInfo(req.user),
      // Сводка «пока вас не было»: атаки/санкции за время оффлайна
      pendingWarReport: (() => { try { return require('./services/warReport').view(req.user); } catch (e) { return null; } })(),
      // Очередь окон о новых достижениях (показываются по одному)
      pendingAchievements: (req.user.pendingAchievements && req.user.pendingAchievements.length)
        ? req.user.pendingAchievements : null,
    };
  });
  // Игрок закрыл окно «События» — очищаем сводку оффлайн-событий
  app.add('POST', '/api/war-report/ack', (req) => require('./services/warReport').ack(req.user));
  // Игрок закрыл окно достижения — убираем его из очереди
  app.add('POST', '/api/achievements/ack', (req) => ach.ackPending(req.user, String(req.body.id || '')));
  // Смена пароля самим игроком: старый пароль + новый дважды
  app.add('POST', '/api/change-password', (req) => auth.changePassword(
    req.user, req.body.oldPassword, req.body.newPassword, req.body.newPassword2));
  app.add('POST', '/api/status', (req) => { player.setStatus(req.user, req.body.text); return { status: req.user.status }; });
  app.add('POST', '/api/avatar', (req) => player.setAvatar(req.user, req.body.avatar));
  // Смена позывного (VIP): бесплатно раз в 30 дней
  app.add('POST', '/api/rename', act((req, n) => auth.renameSelf(req.user, String(req.body.name || ''), n)));
  app.add('POST', '/api/verify-human', (req) => require('./services/antibot').passVerification(req.user));
  app.add('POST', '/api/ears/restore', act((req, n) => player.restoreEar(req.user, n)));
  app.add('POST', '/api/skill', act((req, notices) => {
    player.spendSkill(req.user, req.body.stat);
    // Сюжетное задание «Школа бойца» — единственный хук, который
    // вызывается из роутов (player не может зависеть от tutorial)
    tutorial.notify(req.user, 'skill_spent', notices);
    return { skills: req.user.skills, skillPoints: req.user.skillPoints };
  }));
  app.add('POST', '/api/skill/reset', act((req, n) => {
    const r = player.resetSkills(req.user);
    n.push(r.cost > 0
      ? `♻ Навыки сброшены за ${r.cost} золота. Возвращено ${r.refunded} очков.`
      : `♻ Навыки сброшены бесплатно. Возвращено ${r.refunded} очков.`);
    return r;
  }));
  app.add('GET', '/api/profile/:id', (req) => {
    // Плашка блокировки добавляется к профилю ниже, после его сборки
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
  app.add('GET',  '/api/sanctions/:id/orders', (req) => sanctions.orders(req.user, req.params.id));
  app.add('POST', '/api/sanctions/declare', act((req, n) => sanctions.declare(req.user, String(req.body.targetId || ''), req.body.amount, n)));
  app.add('POST', '/api/war/fatality', act((req, n) => battle.fatality(req.user, req.body.choice, n)));
  app.add('POST', '/api/war/ear-message', act((req, n) => battle.leaveEarMessage(req.user, String(req.body.victimId || ''), String(req.body.text || ''), n)));

  // ---------- Миссии ----------
  app.add('GET',  '/api/missions',          (req) => missions.list(req.user));
  app.add('GET',  '/api/missions/:id',      (req) => missions.detail(req.user, req.params.id));
  app.add('POST', '/api/missions/start',    act((req, n) => missions.startStep(req.user, req.body.confId, u.toInt(req.body.opIdx, 0), u.toInt(req.body.stepIdx, 0), n)));
  app.add('POST', '/api/missions/buy-required', act((req, n) => missions.buyRequiredUnits(req.user, req.body.confId, u.toInt(req.body.opIdx, 0), u.toInt(req.body.stepIdx, 0), n)));
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
  // История ракет: запущенные игроком и прилетевшие по нему.
  // Перед выдачей добавляем долетевшие — иначе только что попавшая
  // ракета появилась бы в журнале лишь после следующего тика.
  app.add('GET',  '/api/silos/history',      (req) => {
    try { silos.resolveInFlight(); } catch (e) {}
    return silos.history(req.user);
  });
  // ---------- Лазеры (ПВО) ----------
  app.add('GET',  '/api/lasers',             (req) => require('./services/lasers').view(req.user));
  app.add('POST', '/api/lasers/build',       act((req, n) => require('./services/lasers').buyLaser(req.user, n)));
  app.add('POST', '/api/lasers/boost',       act((req, n) => require('./services/lasers').boost(req.user, req.body.laserId, n)));
  app.add('POST', '/api/lasers/fuel-ready',  act((req, n) => require('./services/lasers').fuelReady(req.user, req.body.laserId, req.body.amount, n)));
  app.add('POST', '/api/lasers/fuel-power',  act((req, n) => require('./services/lasers').fuelPower(req.user, req.body.laserId, req.body.amount, n)));
  app.add('POST', '/api/lasers/intercept',   act((req, n) => require('./services/lasers').intercept(req.user, req.body.laserId, req.body.rocketId, n)));

  // ---------- Чёрный рынок ----------
  app.add('GET', '/api/market/items', (req) => market.itemsList(req.user));
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
  // 3. Артиллерийская пристрелка
  app.add('POST', '/api/club/arty/start', act((req) => club.artyStart(req.user)));
  app.add('POST', '/api/club/arty/shoot', act((req, n) => club.artyShoot(req.user, req.body.distance, n)));
  // 4. Военные кости
  app.add('POST', '/api/club/dice/start',  act((req) => club.diceStart(req.user)));
  app.add('POST', '/api/club/dice/reroll', act((req, n) => club.diceReroll(req.user, req.body.keep, n)));
  app.add('POST', '/api/club/dice/finish', act((req, n) => club.diceFinish(req.user, n)));
  // 5. Штабной аукцион
  app.add('POST', '/api/club/bids/play',   act((req, n) => club.bidsPlay(req.user, req.body.bids, n)));

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
  // Принять поручение: прогресс начинает считаться только после этого
  // Забрать награду за вход (окно «довольствие от штаба»)
  app.add('POST', '/api/login-reward/claim', act((req, n) => features.claimLoginReward(req.user, n)));
  app.add('POST', '/api/daily/accept',     act((req, n) => dailyQuests.accept(req.user, req.body.questId, n)));
  app.add('POST', '/api/daily/claim',      act((req, n) => dailyQuests.claim(req.user, req.body.questId, n)));
  app.add('POST', '/api/daily/bonus',      act((req, n) => dailyQuests.claimBonus(req.user, n)));
  // VIP: массовые действия и замена поручений
  app.add('POST', '/api/daily/accept-all', act((req, n) => dailyQuests.acceptAll(req.user, n)));
  app.add('POST', '/api/daily/claim-all',  act((req, n) => dailyQuests.claimAll(req.user, n)));
  app.add('POST', '/api/daily/reroll',     act((req, n) => dailyQuests.reroll(req.user, String(req.body.questId || ''), n)));
  // Расширенная статистика (VIP, пункт 9). Собирает всё, что игра
  // накопила об игроке: время в строю, движение денег и золота по
  // источникам, техника и диверсанты по родам и типам.
  // Расширенная статистика (VIP, пункт 9). Данные собирает сервис
  // stats: он и так ведёт учёт времени в игре, движения денег и золота
  // по источникам, техники и диверсантов по типам — писать свой второй
  // учёт значило бы разойтись в цифрах.
  app.add('GET', '/api/stats-full', (req) => {
    if (!require('./services/vip').isVip(req.user)) {
      throw new u.ApiError('Расширенная статистика доступна по VIP-подписке');
    }
    return require('./services/stats').report(req.user);
  });

  // Смена позывного (VIP, пункт 18)
  app.add('POST', '/api/rename', act((req, n) =>
    player.renameSelf(req.user, String(req.body.name || ''), n)));

  // Кто разведал игрока за сутки (VIP, пункт 10)
  app.add('GET', '/api/spied-by', (req) => {
    const vipSrv = require('./services/vip');
    if (!vipSrv.isVip(req.user)) throw new u.ApiError('Доступно по VIP-подписке');
    const sb: any = (req.user as any).spiedBy;
    const day = vipSrv.mskDayKey();
    const list = (sb && sb.day === day) ? (sb.list || []) : [];
    return { day, list: list.slice().sort((a: any, b: any) => b.at - a.at) };
  });
  // Недельные поручения: свой пул, свои лимиты и награды, сброс в понедельник
  app.add('GET',  '/api/weekly',            (req) => dailyQuests.weeklyList(req.user));
  app.add('POST', '/api/weekly/accept',     act((req, n) => dailyQuests.weeklyAccept(req.user, req.body.questId, n)));
  app.add('POST', '/api/weekly/claim',      act((req, n) => dailyQuests.weeklyClaim(req.user, req.body.questId, n)));
  app.add('POST', '/api/weekly/bonus',      act((req, n) => dailyQuests.weeklyClaimBonus(req.user, n)));

  // ---------- Банк ----------
  app.add('POST', '/api/bank', act((req) => {
    if (req.body.action === 'deposit') player.bankDeposit(req.user, req.body.amount);
    else if (req.body.action === 'withdraw') player.bankWithdraw(req.user, req.body.amount);
    else throw new u.ApiError('Неизвестная операция');
    return { dollars: req.user.dollars, bank: req.user.bank };
  }));
  app.add('POST', '/api/bank/reserve',         act((req, n) => player.reserveForLegion(req.user, req.body.dollars, n)));
  // История сейфа: кто лез ко мне и к кому лез я. Без неё пропажа денег
  // из хранилища выглядела для игрока необъяснимой.
  app.add('GET',  '/api/bank/history', (req) => require('./services/bankHack').history(req.user));
  app.add('GET',  '/api/bank/gold-packages', (req) => ({ packages: player.goldPackages() }));
  app.add('POST', '/api/bank/buy-gold',      act((req) => player.buyGold(req.user, req.body.packId)));

  // ---------- Альянс ----------
  // ---------- Группы (альянс и легион работают через один API) ----------
  // :kind — 'alliance' или 'legion'
  // ВАЖНО: групповые бои объявлены ДО шаблона '/api/group/:kind'.
  // Маршрутизатор берёт первое совпадение, и шаблон с параметром
  // перехватывал бы '/api/group/upgrades' как альянс с видом
  // «upgrades» — отсюда была ошибка «Неизвестный тип группы».
  // Диагностика лобби: показывает СЫРОЕ состояние в базе и что именно
  // мешает бою стартовать. Нужна, когда участники висят, а таймер стоит.
  app.add('GET', '/api/admin/lobby-check', (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const raw = require('./core/db').load('groupBattle', {});
    const arenaRaw = require('./core/db').load('arena', {});
    const now = Date.now();
    const gbList = Object.values(raw.registered || {});
    const problems: string[] = [];

    if (gbList.length && !raw.slot) problems.push('Групповые: есть участники, но время старта не задано');
    if (gbList.length && raw.slot && raw.slot < now - 60000) {
      problems.push('Групповые: время старта в прошлом, но бой не создан');
    }
    if (raw.battle && raw.battle.state === 'done') problems.push('Групповые: висит завершённый бой');

    const divInfo: any = {};
    for (const d of ['basic', 'elite']) {
      const dv = (arenaRaw.divs || {})[d];
      if (!dv) { divInfo[d] = 'нет данных'; continue; }
      const n = Object.keys(dv.registered || {}).length;
      divInfo[d] = {
        registered: n,
        slot: dv.slot || 0,
        slotIn: dv.slot ? Math.round((dv.slot - now) / 1000) + ' с' : 'не задан',
        battle: dv.battle ? dv.battle.state : 'нет',
      };
      if (n && !dv.slot) problems.push(`Арена (${d}): есть участники, но время старта не задано`);
      if (n && dv.slot && dv.slot < now - 60000) problems.push(`Арена (${d}): время старта в прошлом`);
    }

    return {
      serverTime: now,
      serverTimeText: new Date(now).toISOString(),
      group: {
        registered: gbList.length,
        names: gbList.map((r: any) => r.name),
        slot: raw.slot || 0,
        slotIn: raw.slot ? Math.round((raw.slot - now) / 1000) + ' с' : 'не задан',
        battle: raw.battle ? raw.battle.state : 'нет',
      },
      arena: divInfo,
      problems,
      verdict: problems.length ? problems.join('; ') : 'Состояние в порядке — лобби считается верно',
    };
  }, { admin: true });

  // Сброс зависшего лобби. Возвращает всё в исходное: записи снимаются,
  // взносы на арене возвращаются, отсчёт начнётся с новой записи.
  app.add('POST', '/api/admin/lobby-reset', act((req, n) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const dbc = require('./core/db');
    const users = player.users();
    let refunded = 0;

    const raw = dbc.load('groupBattle', {});
    raw.registered = {};
    raw.slot = 0;
    raw.battle = null;
    dbc.save('groupBattle');

    const arenaSrv = require('./services/arena');
    const arenaRaw = dbc.load('arena', {});
    for (const d of ['basic', 'elite']) {
      const dv = (arenaRaw.divs || {})[d];
      if (!dv) continue;
      // Взносы возвращаем: люди платили за бой, которого не было
      for (const r of Object.values(dv.registered || {}) as any[]) {
        const p = users[r.id];
        if (!p) continue;
        if (d === 'elite') player.addGold(p, arenaSrv.DIVISIONS.elite.entry, 'arena_refund');
        else player.addMoney(p, arenaSrv.DIVISIONS.basic.entry, false);
        dbc.markUser(p.id);
        refunded++;
      }
      dv.registered = {};
      dv.slot = 0;
      dv.battle = null;
    }
    dbc.save('arena');
    dbc.save('users');
    auditLog.record({ userId: req.user.id, userName: req.user.name, path: '/api/admin/lobby-reset', body: { refunded } });
    n.push(`Лобби сброшено. Взносов возвращено: ${refunded}`);
    return { ok: true, refunded };
  }), { admin: true });

  // ═══ ГРУППОВЫЕ БОИ 5 на 5 ════════════════════════════════════════
  const gb = require('./services/groupBattle');

  app.add('GET',  '/api/group',            (req) => gb.view(req.user));
  app.add('POST', '/api/group/register',   act((req, n) => gb.register(req.user, String(req.body.role || ''), n)));
  app.add('POST', '/api/group/unregister', act((req, n) => gb.unregister(req.user, n)));
  app.add('POST', '/api/group/role',       act((req, n) => gb.setRole(req.user, String(req.body.role || ''), n)));
  // Отдельного «вступить в бой» в ГБ больше нет: бой стартует сам через
  // полминуты подготовки, и все в нём с первой секунды. Маршрут оставлен
  // совместимости ради — старые вкладки в браузере ещё могут его дёрнуть,
  // и падать с 404 им незачем. Просто отдаём состояние боя.
  app.add('POST', '/api/group/enter',      (req) => gb.battleState(req.user));
  app.add('GET',  '/api/group/battle',     (req) => gb.battleState(req.user, String(req.query.watch || '')));
  app.add('POST', '/api/group/act',        act((req, n) =>
    gb.act(req.user, String(req.body.action || ''), String(req.body.targetId || ''), n)));
  app.add('POST', '/api/group/leave',      act((req, n) => gb.leave(req.user, n)));

  // Улучшения групповых боёв
  const gup = require('./services/groupUpgrades');
  app.add('GET',  '/api/group/upgrades',   (req) => gup.view(req.user));
  app.add('POST', '/api/group/upgrade',    act((req, n) =>
    gup.upgrade(req.user, String(req.body.skill || ''), n)));

  // База снабжения: торговцы и временные усиления
  const gsup = require('./services/groupSupply');
  app.add('GET',  '/api/group/supply',      (req) => gsup.view(req.user));
  app.add('POST', '/api/group/supply/buy',  act((req, n) =>
    gsup.buy(req.user, String(req.body.item || ''), n)));

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
  // Подкрепления союзникам (личный альянс)
  app.add('GET',  '/api/reinforcements',      (req) => require('./services/reinforcements').view(req.user));
  app.add('POST', '/api/reinforcements/send', act((req, n) => require('./services/reinforcements').send(req.user, req.body.toId, n)));

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
  // Диагностика базы: одинаковые позывные/email (следствие старой ошибки
  // удаления аккаунтов) и сколько игроков без сезонного объекта
  app.add('GET', '/api/admin/db-integrity', (req) => require('./core/db').findDuplicateUsers(), { admin: true });
  app.add('POST', '/api/admin/season/end',    act((req, n) => require('./services/seasons').adminForceRollover(req.user, n)), { admin: true });
  // Мировое событие (босс)
  app.add('GET',  '/api/event',        (req) => worldEvent.view(req.user));
  app.add('POST', '/api/event/attack', act((req, n) => worldEvent.attack(req.user, n)));
  app.add('POST', '/api/admin/event/start', act((req, n) => worldEvent.adminStart(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/event/stop',  act((req, n) => worldEvent.adminStop(req.user, n)), { admin: true });
  app.add('POST', '/api/admin/event/drops', act((req, n) => worldEvent.adminSetDrops(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/event/hp', act((req, n) => worldEvent.adminSetHp(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/event/look', act((req, n) => worldEvent.adminSetLook(req.user, req.body, n)), { admin: true });
  app.add('GET',  '/api/admin/event/images', () => worldEvent.adminListImages(), { admin: true });
  // Наёмники: выдача админом в обход аукциона (аукцион работает как прежде)
  app.add('GET',  '/api/admin/merc/list',    () => market.adminCommandersList(), { admin: true });
  app.add('GET',  '/api/admin/merc/holders', () => market.adminCommanderHolders(), { admin: true });
  app.add('POST', '/api/admin/merc/grant',   act((req, n) => market.adminGrantCommander(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/merc/revoke',  act((req, n) => market.adminRevokeCommander(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/group/:kind/leave',   act((req, n) => groups.leave(req.user, req.params.kind, n)));

  // ---------- Легион: казна, постройки, кланвойны ----------
  app.add('GET',  '/api/legion',                   (req) => legion.view(req.user));
  app.add('GET',  '/api/legion/battle',             (req) => legion.battleState(req.user));
  app.add('GET',  '/api/legion/contributions', (req) => legion.contributions(req.user));
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

  // Сохранение уменьшенной картинки босса. Панель присылает её уже
  // сжатой до 400×400 — здесь только проверка и запись файлом, чтобы
  // игроки грузили лёгкое изображение со своего же сервера, а не
  // мегабайтную картинку с чужого сайта.
  app.add('POST', '/api/admin/event/image', act((req) => {
    const url = saveForumImage(req.body.image);
    if (!url) throw new u.ApiError('Изображение не передано');
    return { url };
  }), { admin: true });

  // ═══ АРЕНА: бой каждый сам за себя ═══════════════════════════════
  const arena = require('./services/arena');

  app.add('GET',  '/api/arena',            (req) => arena.view(req.user, req.query.div));
  app.add('POST', '/api/arena/register',   act((req, n) => arena.register(req.user, req.body.div, n)));
  app.add('POST', '/api/arena/unregister', act((req, n) => arena.unregister(req.user, req.body.div, n)));
  // Разбор законченного боя — отдельной страницей
  app.add('GET',  '/api/arena/result/:id', (req) => arena.result(req.user, String(req.params.id || '')));
  app.add('GET',  '/api/arena/rating',     (req) => arena.rating(req.user, arena.divOf(req.query.div), req.query.limit));
  app.add('POST', '/api/arena/enter',      act((req, n) => arena.enter(req.user, n)));
  app.add('GET',  '/api/arena/battle',     (req) => arena.battleState(req.user));
  app.add('POST', '/api/arena/attack',     act((req) => arena.attack(req.user)));
  app.add('POST', '/api/arena/switch',     act((req) => arena.switchTarget(req.user)));
  app.add('POST', '/api/arena/skill',      act((req) => arena.useSkill(req.user, String(req.body.skill || ''))));
  app.add('POST', '/api/arena/leave',      act((req, n) => arena.leave(req.user, n)));

  // ═══ КАБИНЕТ: до трёх персонажей на аккаунт ══════════════════════
  const account = require('./services/account');

  app.add('GET', '/api/account', (req) => account.view(req.user));

  app.add('POST', '/api/account/create', act((req, n) =>
    account.createCharacter(req.user, String(req.body.name || ''), String(req.body.country || ''), n)));

  app.add('POST', '/api/account/switch', act((req, n) =>
    account.switchTo(req.user, String(req.body.id || ''), n)));

  // Смена логина аккаунта. Позывной персонажа и логин входа — разные
  // вещи: персонажей трое, а вход один.
  app.add('POST', '/api/account/login', act((req, n) =>
    auth.setAccountLogin(req.user, String(req.body.login || ''), String(req.body.password || ''), n)));

  // ═══ ЛОТЫ ДНЯ на чёрном рынке ════════════════════════════════════
  const lots = require('./services/lots');
  app.add('GET',  '/api/lots',     (req) => lots.view(req.user));
  app.add('POST', '/api/lots/bid', act((req, n) =>
    lots.bid(req.user, String(req.body.devId || ''), u.toInt(req.body.gold, 0), n)));
  app.add('POST', '/api/lots/buy', act((req, n) =>
    lots.buyBuff(req.user, String(req.body.itemId || ''), u.toInt(req.body.qty, 1), n)));

  // ═══ ФОРУМ ═══════════════════════════════════════════════════════
  const forum = require('./services/forum');

  app.add('GET', '/api/forum', (req) => forum.list(req.user, req.query.page));
  app.add('GET', '/api/forum/topic/:id', (req) => forum.view(req.user, String(req.params.id || '')));

  // Создание темы. Картинка приходит уже уменьшенной браузером —
  // сервер только проверяет формат и размер и сохраняет файлом.
  app.add('POST', '/api/forum/topic', act((req, n) => {
    const img = saveForumImage(req.body.image);
    return forum.createTopic(req.user, String(req.body.title || ''), String(req.body.text || ''), img, n);
  }));

  app.add('POST', '/api/forum/comment', act((req, n) =>
    forum.addComment(req.user, String(req.body.topicId || ''), String(req.body.text || ''), n)));

  app.add('POST', '/api/forum/close', act((req, n) =>
    forum.setClosed(req.user, String(req.body.topicId || ''), !!req.body.closed, n)));
  app.add('POST', '/api/forum/pin', act((req, n) =>
    forum.setPinned(req.user, String(req.body.topicId || ''), !!req.body.pinned, n)));
  app.add('POST', '/api/forum/delete', act((req, n) =>
    forum.deleteTopic(req.user, String(req.body.topicId || ''), n)));
  app.add('POST', '/api/forum/delete-comment', act((req, n) =>
    forum.deleteComment(req.user, String(req.body.topicId || ''), String(req.body.commentId || ''), n)));

  // Ограничения игроку на форуме — по праву «Модерация чатов»
  app.add('GET', '/api/forum/ban-scopes', (req) => {
    if (!roles.canAccessZone(req.user, 'chat')) throw new u.ApiError('Недостаточно прав');
    return { scopes: forum.FORUM_SCOPES };
  });
  app.add('POST', '/api/forum/ban', act((req, n) =>
    forum.banForum(req.user, String(req.body.userId || ''), u.toInt(req.body.minutes, 0),
                   String(req.body.reason || ''),
                   Array.isArray(req.body.scopes) ? req.body.scopes.map((x: any) => String(x)) : [], n)));
  app.add('POST', '/api/forum/unban', act((req, n) =>
    forum.unbanForum(req.user, String(req.body.userId || ''), n)));

  // ═══ VIP-ПОДПИСКА ════════════════════════════════════════════════
  const vip = require('./services/vip');

  // Своё состояние и витрина преимуществ — открыта всем
  app.add('GET', '/api/vip', (req) => ({
    ...vip.vipInfo(req.user),
    benefits: vip.benefits(),
    left: {
      heal: vip.left(req.user, 'heal'),
      immunity: vip.left(req.user, 'immunity'),
      reroll: vip.left(req.user, 'reroll'),
    },
    canRenameFree: vip.canRenameFree(req.user),
    priceGold: vip.PRICE_GOLD,
    priceDays: vip.PRICE_DAYS,
    myGold: req.user.gold || 0,
  }));

  app.add('POST', '/api/vip/buy', act((req, n) => vip.buy(req.user, n)));

  // Выдача и снятие — зона «Ресурсы»: подписка это благо, как и золото
  app.add('POST', '/api/admin/vip/grant', act((req, n) => {
    const target = player.users()[String(req.body.userId || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    return vip.grant(req.user, target, u.toInt(req.body.days, 0), String(req.body.reason || ''), n);
  }), { admin: true });

  app.add('POST', '/api/admin/vip/revoke', act((req, n) => {
    const target = player.users()[String(req.body.userId || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    return vip.revoke(req.user, target, n);
  }), { admin: true });

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
  // Счётчик онлайна для подвала. Онлайн считаем по активности за 5 минут —
  // это реальные люди в игре, а не «зарегистрировано всего».
  // Доступен без входа: цифра на главной нужна и гостям.
  app.add('GET', '/api/online', () => {
    const now = Date.now();
    const all = Object.values(player.users()).filter((p: any) => !p.isBot);
    const online = all.filter((p: any) => now - (p.lastSeen || 0) < 5 * 60 * 1000).length;
    const day = all.filter((p: any) => now - (p.lastSeen || 0) < 24 * 3600 * 1000).length;
    return { online, day, total: all.length };
  }, { open: true });   // виден и гостям: цифра нужна на странице входа

  app.add('GET', '/api/chat', (req) => social.chatGet(req.user, req.query.after, req.query.room));
  app.add('POST', '/api/chat', act((req) => { social.chatPost(req.user, req.body.text, req.body.room); return { ok: true }; }));
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
  app.add('GET',  '/api/admin/legion/:id/state', (req) => require('./services/legion').adminLegionInfo(req.params.id), { admin: true });
  app.add('POST', '/api/admin/legion/set', act((req, n) => require('./services/legion').adminSetLegion(req.user, req.body.legionId, req.body.patch, n)), { admin: true });
  app.add('POST', '/api/admin/legion/battle', act((req, n) => require('./services/legion').adminStartBattle(req.user, req.body.legionAId, req.body.legionBId, n)), { admin: true });
  // Турниры легионов
  app.add('GET',  '/api/admin/tournaments',        () => require('./services/tournaments').list(), { admin: true });
  app.add('GET',  '/api/admin/tournaments/legions', () => require('./services/tournaments').legionOptions(), { admin: true });
  app.add('GET',  '/api/admin/tournaments/:id',    (req) => require('./services/tournaments').view(req.params.id), { admin: true });
  app.add('POST', '/api/admin/tournaments/create', act((req, n) => require('./services/tournaments').create(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/tournaments/:id/cancel', act((req, n) => require('./services/tournaments').cancel(req.user, req.params.id, n)), { admin: true });
  app.add('POST', '/api/admin/grant',      act((req, n) => admin.grant(req.user, req.body, n)),    { admin: true });
  app.add('POST', '/api/admin/take',       act((req, n) => admin.take(req.user, req.body, n)),     { admin: true });
  app.add('POST', '/api/admin/grant-all',  act((req, n) => admin.grantAll(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/rewards/grant', act((req, n) => require('./services/rewards').adminGrant(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/claim-gift', act((req, n) => { const r = admin.claimGift(req.user, req.body.giftId); n.push('OK'); return r; }));
  // ═══ РОЛИ И МОДЕРАЦИЯ ════════════════════════════════════════════
  const roles = require('./services/roles');

  // Список сотрудников проекта. Видят администраторы и модераторы —
  // модератору полезно знать, к кому обращаться.
  app.add('GET', '/api/staff', (req) => {
    if (!roles.isModerator(req.user)) throw new u.ApiError('Недостаточно прав');
    return { staff: roles.staffList(), me: { role: roles.roleOf(req.user), label: roles.roleLabel(req.user) } };
  });

  // Назначение и снятие ролей. Проверка «кто кого может» внутри setRole:
  // владелец назначает любые роли, администратор — только модераторов.
  app.add('POST', '/api/staff/role', act((req, n) => {
    if (!roles.isAdmin(req.user)) throw new u.ApiError('Недостаточно прав');
    const role = req.body.role === 'none' ? null : String(req.body.role || '');
    return roles.setRole(req.user, String(req.body.userId || ''), role as any, n);
  }));

  // ── Настройка возможностей ролей (только владелец) ──
  app.add('GET', '/api/staff/permissions', (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    return roles.permissionsView();
  });

  app.add('POST', '/api/staff/permissions', act((req, n) =>
    roles.setRoleZone(req.user, String(req.body.role || ''), String(req.body.zone || ''), !!req.body.enabled, n)));

  app.add('POST', '/api/staff/permissions/reset', act((req, n) =>
    roles.resetRoleZones(req.user, String(req.body.role || ''), n)));

  // ── Модерация чата (доступна и модераторам, и администрации) ──
  app.add('GET', '/api/mod/chat-bans', (req) => {
    if (!roles.isModerator(req.user)) throw new u.ApiError('Недостаточно прав');
    return { bans: roles.bannedList(), maxMinutes: roles.MAX_BAN_MINUTES };
  });

  app.add('POST', '/api/mod/chat-ban', act((req, n) =>
    roles.banChat(req.user, String(req.body.userId || ''), u.toInt(req.body.minutes, 0),
                  String(req.body.reason || ''), n,
                  Array.isArray(req.body.scopes) ? req.body.scopes.map((x: any) => String(x)) : undefined,
                  !!req.body.purge)));

  // Блокировка аккаунта — зона «Модерация», доступна администрации.
  // Адрес намеренно в /api/admin/: так он попадает в админскую зону и
  // проверяется на входе, ещё до вызова сервиса. Раньше он лежал в
  // /api/mod/ и пускал по признаку «сотрудник», из-за чего «Дозор»
  // мог закрыть игроку вход в игру.
  app.add('POST', '/api/admin/account-ban', act((req, n) =>
    roles.banAccount(req.user, String(req.body.userId || ''), u.toInt(req.body.minutes, 0), String(req.body.reason || ''), n)),
    { admin: true });

  app.add('POST', '/api/admin/account-unban', act((req, n) =>
    roles.unbanAccount(req.user, String(req.body.userId || ''), n)),
    { admin: true });

  // Список каналов для окна блокировки
  app.add('GET', '/api/mod/chat-scopes', (req) => {
    if (!roles.isModerator(req.user)) throw new u.ApiError('Недостаточно прав');
    return { scopes: roles.CHAT_SCOPES, maxMinutes: roles.MAX_BAN_MINUTES };
  });

  // Состояние блокировки конкретного игрока — для кнопки в профиле
  app.add('GET', '/api/mod/chat-status/:id', (req) => {
    if (!roles.isModerator(req.user)) throw new u.ApiError('Недостаточно прав');
    const target = player.users()[String(req.params.id || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    const info = roles.chatBanInfo(target);
    return {
      id: target.id, name: target.name,
      role: roles.roleOf(target),
      banned: !!info,
      until: info ? info.until : 0,
      reason: info ? info.reason : '',
      byName: info ? info.byName : '',
      scopes: info ? info.scopes : [],
      scopeNames: info
        ? info.scopes.map((sc: string) => (roles.CHAT_SCOPES.find((z: any) => z.id === sc) || { name: sc }).name).join(', ')
        : '',
      canBan: !roles.roleOf(target) || roles.isOwner(req.user),
      // Сведения о бане аккаунта — только тем, кто вправе им управлять
      account: roles.canAccessZone(req.user, 'moderation')
        ? (() => {
            const ab = roles.accountBanInfo(target);
            return ab ? { banned: true, reason: ab.reason, until: ab.until, byName: ab.byName } : { banned: false };
          })()
        : null,
      canBanAccount: roles.canAccessZone(req.user, 'moderation'),
    };
  });

  app.add('POST', '/api/mod/chat-unban', act((req, n) =>
    roles.unbanChat(req.user, String(req.body.userId || ''), n)));

  // Поиск игрока по позывному — модератору нужен, чтобы найти нарушителя
  app.add('GET', '/api/mod/find', (req) => {
    if (!roles.isModerator(req.user)) throw new u.ApiError('Недостаточно прав');
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return { players: [] };
    const found = Object.values(player.users())
      .filter((p: any) => !p.isBot && String(p.name || '').toLowerCase().includes(q))
      .slice(0, 15)
      .map((p: any) => {
        const ban = roles.chatBanInfo(p);
        return {
          id: p.id, name: p.name, level: p.level, flag: player.flag(p),
          role: roles.roleOf(p), label: roles.roleLabel(p),
          banned: !!ban, banUntil: ban ? ban.until : 0, banReason: ban ? ban.reason : '',
        };
      });
    return { players: found };
  });

  // ═══ СВОДКА ДЛЯ АДМИНИСТРАТОРА ════════════════════════════════════
  // Рабочий стол вместо голого списка вкладок: показывает, что требует
  // внимания прямо сейчас. Панель владельца — про настройку игры,
  // панель администратора — про ежедневную работу с людьми, поэтому
  // и открывается она с этого экрана.
  app.add('GET', '/api/admin/dashboard', async (req) => {
    const me = req.user;
    const zones = roles.zonesFor(me);
    const has = (z: string) => zones.indexOf(z) >= 0;
    const users = player.users();
    const live = Object.values(users).filter((p: any) => !p.isBot);
    const now = Date.now();
    const DAY = 24 * 3600 * 1000;

    // Обращения в поддержку
    let tickets = { open: 0, answered: 0, oldest: 0 };
    if (has('support')) {
      try {
        const list = support.adminList({ status: 'open' }).tickets || [];
        tickets.open = list.filter((t: any) => t.status === 'open').length;
        tickets.answered = list.filter((t: any) => t.status === 'answered').length;
        const oldest = list.filter((t: any) => t.status === 'open').sort((a: any, b: any) => a.createdAt - b.createdAt)[0];
        tickets.oldest = oldest ? Math.floor((now - oldest.createdAt) / 3600000) : 0;
      } catch (e) {}
    }

    // Действующие меры
    const chatBans = has('moderation') ? roles.bannedList() : [];
    const accountBans = has('moderation')
      ? live.filter((p: any) => roles.accountBanInfo(p)).map((p: any) => {
          const ab = roles.accountBanInfo(p);
          return { id: p.id, name: p.name, reason: ab.reason, until: ab.until, byName: ab.byName };
        })
      : [];

    // Люди: кто в игре, новички за сутки
    const online = live.filter((p: any) => now - (p.lastSeen || 0) < 5 * 60 * 1000).length;
    const newToday = live.filter((p: any) => now - (p.createdAt || 0) < DAY).length;

    // Мои действия за сутки — прозрачность для самого сотрудника
    let myActions: any[] = [];
    try {
      const logs = await auditLog.listForUser(me.id, 40);
      myActions = humanizeLogs(logs.filter((l: any) => now - (l.at || 0) < DAY).slice(0, 12));
    } catch (e) {}

    return {
      me: { name: me.name, role: roles.roleOf(me), label: roles.roleLabel(me) },
      zones,
      // Что сотруднику РАЗРЕШЕНО и что нет — человеческими словами.
      // Раньше он видел только вкладки и догадывался о границах сам;
      // из-за этого приходили вопросы «почему у меня не работает».
      myAccess: roles.ZONE_INFO.map((z: any) => ({
        id: z.id, name: z.name, note: z.note,
        allowed: zones.indexOf(z.id) >= 0,
        ownerOnly: roles.OWNER_ONLY_ZONES.indexOf(z.id) >= 0,
      })),
      // Новые жалобы — счётчик на «Требует внимания»
      reportsNew: has('moderation') ? (() => {
        try { return require('./services/reports').pendingCount(); } catch (e) { return 0; }
      })() : 0,
      tickets,
      players: { total: live.length, online, newToday },
      chatBans: chatBans.slice(0, 20),
      chatBansTotal: chatBans.length,
      accountBans: accountBans.slice(0, 20),
      accountBansTotal: accountBans.length,
      myActions,
      myActionsTotal: myActions.length,
    };
  }, { admin: true });

  // Карточка игрока для администратора: всё нужное в одном ответе,
  // чтобы не собирать её из пяти запросов
  app.add('GET', '/api/admin/player-card/:id', async (req) => {
    if (!roles.canAccessZone(req.user, 'players')) throw new u.ApiError('Недостаточно прав');
    const target = player.users()[String(req.params.id || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    const chatBan = roles.chatBanInfo(target);
    const accBan = roles.accountBanInfo(target);
    let recent: any[] = [];
    try { recent = humanizeLogs((await auditLog.listForUser(target.id, 15)) || []); } catch (e) {}
    const now = Date.now();
    return {
      id: target.id, name: target.name, level: target.level,
      flag: player.flag(target), role: roles.roleOf(target), roleLabel: roles.roleLabel(target),
      createdAt: (target as any).createdAt || 0,
      lastSeen: target.lastSeen || 0,
      online: now - (target.lastSeen || 0) < 5 * 60 * 1000,
      email: (target as any).email || '',
      dollars: target.dollars || 0, gold: target.gold || 0,
      legionId: (target as any).legionId || null,
      chatBan: chatBan
        ? { until: chatBan.until, reason: chatBan.reason, byName: chatBan.byName, scopes: chatBan.scopes }
        : null,
      accountBan: accBan
        ? { until: accBan.until, reason: accBan.reason, byName: accBan.byName }
        : null,
      recent,
      can: {
        chatBan: roles.isModerator(req.user),
        accountBan: roles.canAccessZone(req.user, 'moderation'),
        password: roles.canAccessZone(req.user, 'security'),
        resources: roles.canAccessZone(req.user, 'economy'),
      },
    };
  }, { admin: true });

  // ═══ ПОЧТА: проверка настройки и помощь игрокам ══════════════════
  // Подтверждение почты включается само, когда задан ключ отправки.
  // Эти два роута нужны, чтобы включение не обернулось бедой: сначала
  // проверить, что письма уходят, и иметь способ помочь игроку, до
  // которого письмо не дошло.
  app.add('GET', '/api/admin/email-status', (req) => {
    if (!roles.canAccessZone(req.user, 'security')) throw new u.ApiError('Недостаточно прав');
    const email = require('./services/email');
    const users = Object.values(player.users()).filter((p: any) => !p.isBot);
    const unverified = users.filter((p: any) => !p.emailVerified);
    return {
      configured: email.isConfigured,
      testSender: email.usingTestSender,
      from: email.EMAIL_FROM || '',
      appUrl: email.APP_URL || '',
      total: users.length,
      unverified: unverified.length,
      list: unverified
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 50)
        .map((p: any) => ({
          id: p.id, name: p.name, email: p.email || '',
          createdAt: p.createdAt || 0, level: p.level,
        })),
      hint: email.isConfigured
        ? (email.usingTestSender
            ? 'Отправитель тестовый (resend.dev) — письма уходят только на вашу собственную почту. '
              + 'Для игроков подключите свой домен в Resend и укажите его в EMAIL_FROM.'
            : 'Отправка настроена. Новые игроки обязаны подтвердить почту перед входом.')
        : 'Ключ отправки не задан (RESEND_API_KEY). Пока его нет, почта считается подтверждённой '
          + 'автоматически, и требование не действует.',
    };
  }, { admin: true });

  // Подтвердить почту вручную. Нужно, когда письмо не дошло: попало в
  // спам, игрок ошибся в адресе, почтовый сервис отклонил. Без этого
  // человек остаётся заперт снаружи, и помочь ему нечем.
  app.add('POST', '/api/admin/verify-email', act((req, n) => {
    if (!roles.canAccessZone(req.user, 'security')) throw new u.ApiError('Недостаточно прав');
    const target = player.users()[String(req.body.userId || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    if ((target as any).emailVerified) throw new u.ApiError('Почта уже подтверждена');
    (target as any).emailVerified = true;
    (target as any).emailVerifyToken = null;
    require('./core/db').markUser(target.id);
    require('./core/db').save('users');
    auditLog.record({
      userId: req.user.id, userName: req.user.name, path: '/api/admin/verify-email',
      body: { targetId: target.id, targetName: target.name, email: (target as any).email },
    });
    n.push(`✅ Почта игрока «${target.name}» подтверждена вручную`);
    return { ok: true };
  }), { admin: true });

  // ═══ ПОЧТА: проверка настройки и ручное подтверждение ════════════
  // Включать обязательное подтверждение вслепую опасно: если отправка
  // настроена неверно, новые игроки не смогут войти вообще. Эта проверка
  // показывает состояние ДО того, как игроки столкнутся с проблемой.
  // ═══ ШАБЛОНЫ ПИСЕМ И РАССЫЛКА ════════════════════════════════════
  // Правит только владелец: письмо уходит от имени игры, и текст в нём —
  // такая же ответственность, как объявление на главной.
  app.add('GET', '/api/admin/mail/templates', (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const mailer = require('./services/mailer');
    return {
      ...mailer.list(),
      audience: mailer.audience(player.users()),
      broadcast: mailer.broadcastStatus(),
    };
  }, { admin: true });

  app.add('POST', '/api/admin/mail/template', act((req, n) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    return require('./services/mailer').save(
      req.user.name, String(req.body.id || ''), String(req.body.subject || ''), String(req.body.html || ''), n);
  }), { admin: true });

  app.add('POST', '/api/admin/mail/template/default', act((req, n) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    return require('./services/mailer').resetToDefault(String(req.body.id || ''), n);
  }), { admin: true });

  app.add('POST', '/api/admin/mail/preview', async (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    return require('./services/mailer').sendPreview(
      String(req.body.id || ''), String(req.body.to || ''), req.user.name);
  }, { admin: true });

  app.add('POST', '/api/admin/mail/broadcast', act((req, n) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const mailer = require('./services/mailer');
    if (req.body.stop) return mailer.broadcastStop(n);
    auditLog.record({ userId: req.user.id, userName: req.user.name, path: '/api/admin/mail/broadcast' });
    return mailer.broadcastStart(req.user.name, player.users(), n);
  }), { admin: true });

  app.add('GET', '/api/admin/mail/broadcast', (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    return require('./services/mailer').broadcastStatus();
  }, { admin: true });

  app.add('GET', '/api/admin/email-check', (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const email = require('./services/email');
    const users = player.users();
    const list = Object.values(users).filter((p: any) => !p.isBot);
    const unverified = list.filter((p: any) => !p.emailVerified);
    const PROVIDER_NAMES: Record<string, string> = {
      unisender: 'Unisender Go (Россия)',
      resend: 'Resend (США)',
      none: 'не настроен',
    };
    return {
      configured: email.isConfigured,
      provider: email.provider,
      providerName: PROVIDER_NAMES[email.provider] || email.provider,
      from: email.EMAIL_FROM || '',
      appUrl: email.APP_URL || '',
      testSender: email.usingTestSender,
      totals: { players: list.length, unverified: unverified.length },
      unverified: unverified
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 50)
        .map((p: any) => ({ id: p.id, name: p.name, email: p.email, createdAt: p.createdAt || 0 })),
      hint: !email.isConfigured
        ? 'Отправка писем не настроена: почта у новых игроков подтверждается сама, '
          + 'подтверждение не требуется. Задайте UNISENDER_API_KEY в .env и перезапустите — '
          + 'после этого новые игроки будут обязаны подтвердить почту.'
        : (email.usingTestSender
          ? 'Ключ задан, но отправитель тестовый (resend.dev): письма уходят только на вашу '
            + 'собственную почту. Игроки писем не получат. Укажите в EMAIL_FROM адрес на '
            + 'своём домене и подтвердите домен у почтового сервиса.'
          : (email.provider === 'resend'
            ? 'Работает Resend (США). Для игроков с почтой mail.ru и Яндекс письма чаще '
              + 'попадают в спам. Рекомендуется Unisender Go: задайте UNISENDER_API_KEY.'
            : 'Отправка настроена. Новые игроки обязаны подтвердить почту перед входом.')),
    };
  }, { admin: true });

  // Подтвердить почту вручную. Нужно, когда письмо не доходит: у игрока
  // опечатка в адресе, письмо в спаме или почтовый ящик недоступен.
  // Без этого единственным выходом была бы правка базы руками.
  app.add('POST', '/api/admin/verify-email', act((req, n) => {
    if (!roles.canAccessZone(req.user, 'players')) throw new u.ApiError('Недостаточно прав');
    const target = player.users()[String(req.body.userId || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    if ((target as any).emailVerified) throw new u.ApiError('Почта уже подтверждена');
    (target as any).emailVerified = true;
    (target as any).emailVerifyToken = null;
    require('./core/db').markUser(target.id);
    require('./core/db').save('users');
    auditLog.record({
      userId: req.user.id, userName: req.user.name, path: '/api/admin/verify-email',
      body: { targetId: target.id, targetName: target.name, email: (target as any).email },
    });
    n.push(`✅ Почта игрока «${target.name}» подтверждена вручную`);
    return { ok: true };
  }), { admin: true });

  // Диагностика: что на самом деле приходит от прокси. Нужна, когда в
  // журнале у всех один адрес — сразу видно, передаёт ли nginx заголовки
  // или их вовсе нет.
  app.add('GET', '/api/admin/net-check', (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const h = (req as any).rawHeaders || {};
    return {
      detected: req.ip,
      ua: (req as any).ua || '',
      hints: (req as any).hints || {},
      headers: {
        'x-forwarded-for': h['x-forwarded-for'] || '(нет)',
        'x-real-ip': h['x-real-ip'] || '(нет)',
        'cf-connecting-ip': h['cf-connecting-ip'] || '(нет)',
        'true-client-ip': h['true-client-ip'] || '(нет)',
        'sec-ch-ua-model': h['sec-ch-ua-model'] || '(нет)',
        'sec-ch-ua-platform-version': h['sec-ch-ua-platform-version'] || '(нет)',
      },
      socket: h['__socket'] || '',
      // Подсказка администратору, что делать с увиденным
      hint: (() => {
        const hasProxy = h['x-forwarded-for'] || h['x-real-ip'] || h['cf-connecting-ip'];
        if (!hasProxy) {
          return 'Прокси не передаёт адрес игрока. В настройках nginx добавьте: '
               + 'proxy_set_header X-Real-IP $remote_addr; '
               + 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;';
        }
        if (!h['sec-ch-ua-model']) {
          return 'Адрес передаётся верно. Модель устройства придёт со следующего '
               + 'запроса: браузер присылает её только после того, как получил наш запрос на подсказки.';
        }
        return 'Всё в порядке: адрес и модель устройства приходят.';
      })(),
    };
  }, { admin: true });

  // ═══ УЧЁТ ВХОДОВ: адреса, устройства, почта ══════════════════════
  // Данные о входах — чувствительные. Открываем их только тем, кому
  // выдана зона «Игроки»: это те же люди, что разбирают жалобы.
  app.add('GET', '/api/admin/access/:id', (req) => {
    if (!roles.canAccessZone(req.user, 'players')) throw new u.ApiError('Недостаточно прав');
    const target = player.users()[String(req.params.id || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    const access = require('./services/access');
    return {
      id: target.id, name: target.name, level: target.level,
      ...access.view(target),
      related: access.related(target, player.users()),
      // Персонажи того же аккаунта — законная связь через кабинет.
      // Показываем отдельно, чтобы не путать с подозрительными совпадениями.
      characters: access.sameAccountChars(target, player.users()),
      accountLogin: (target as any).accountLogin || '',
      // Открытые прямо сейчас входы: с какого устройства и адреса.
      // По ним же работают кнопки «выкинуть».
      sessions: auth.sessionsOf(target.id),
    };
  }, { admin: true });

  // ═══ УСТРОЙСТВА И СЕССИИ ═════════════════════════════════════════

  // Кто ещё заходил с этого же устройства. Сигнал сильнее совпадения
  // адреса, но тоже не доказательство: общий компьютер в семье или
  // интернет-клуб дают ровно такое же совпадение честно.
  app.add('GET', '/api/admin/by-device', (req) => {
    if (!roles.canAccessZone(req.user, 'players')) throw new u.ApiError('Недостаточно прав');
    const access = require('./services/access');
    const key = String(req.query.key || '');
    if (!key) throw new u.ApiError('Не указано устройство');
    return { key, players: access.byDevice(key, player.users()) };
  }, { admin: true });

  // Все открытые сессии сервера — сводка по игрокам
  app.add('GET', '/api/admin/sessions', (req) => {
    if (!roles.canAccessZone(req.user, 'security')) throw new u.ApiError('Недостаточно прав');
    const counts = auth.sessionCounts();
    const users = player.users();
    const rows = Object.entries(counts)
      .map(([id, n]) => {
        const p: any = users[id];
        return {
          id, n,
          name: p ? p.name : '(удалён)',
          level: p ? p.level : 0,
          lastSeen: p ? (p.lastSeen || 0) : 0,
          sessions: auth.sessionsOf(id),
        };
      })
      .sort((a, b) => b.n - a.n || (b.lastSeen || 0) - (a.lastSeen || 0));
    return { total: rows.reduce((s, r) => s + r.n, 0), players: rows.length, rows };
  }, { admin: true });

  // Выброс из кабинета: одна сессия, все сессии игрока или все сразу.
  // Три случая — один адрес: разные кнопки для одного и того же действия
  // расходятся при первой же правке.
  app.add('POST', '/api/admin/sessions/kick', act((req, n) => {
    if (!roles.canAccessZone(req.user, 'security')) throw new u.ApiError('Недостаточно прав');
    const access = require('./services/access');
    const users = player.users();

    if (req.body.all) {
      const killed = auth.killEverySession();
      auditLog.record({ userId: req.user.id, userName: req.user.name,
        path: '/api/admin/sessions/kick', body: { all: true, killed } });
      n.push(`🚪 Из кабинетов выброшены все: закрыто сессий — ${killed}. Игроки войдут заново по паролю.`);
      return { killed };
    }

    if (req.body.token) {
      const token = String(req.body.token);
      // Кого именно выкинули — нужно для журнала безопасности игрока,
      // поэтому владельца ищем ДО удаления записи.
      const owner: any = Object.values(users)
        .find((p: any) => auth.sessionsOf(p.id).some((s: any) => s.token === token));
      const ok = auth.killOne(token);
      if (!ok) throw new u.ApiError('Эта сессия уже закрыта');
      if (owner) {
        try { access.securityEvent(owner, 'kicked', `Сессия закрыта сотрудником ${req.user.name}`); } catch (e) {}
      }
      auditLog.record({ userId: req.user.id, userName: req.user.name,
        path: '/api/admin/sessions/kick',
        body: { token: token.slice(0, 6) + '…', target: owner ? owner.name : '' } });
      n.push('🚪 Сессия закрыта — с этого устройства придётся войти заново.');
      return { killed: 1 };
    }

    const target: any = users[String(req.body.userId || '')];
    if (!target) throw new u.ApiError('Игрок не найден');
    const killed = auth.killSessions(target.id);
    try { access.securityEvent(target, 'kicked', `Все сессии закрыты сотрудником ${req.user.name}`); } catch (e) {}
    auditLog.record({ userId: req.user.id, userName: req.user.name,
      path: '/api/admin/sessions/kick', body: { userId: target.id, name: target.name, killed } });
    n.push(`🚪 «${target.name}» выброшен из кабинета: закрыто сессий — ${killed}.`);
    return { killed };
  }), { admin: true });

  // Сводка: с каких адресов заходит по несколько аккаунтов
  // ═══ АНТИЧИТ ═════════════════════════════════════════════════════
  // Ничего не банит автоматически — только показывает подозрительное с
  // доказательствами. Решение всегда за человеком.
  app.add('GET', '/api/admin/anticheat', async (req) => {
    if (!roles.canAccessZone(req.user, 'security')) throw new u.ApiError('Недостаточно прав');
    const ac = require('./services/antiCheat');
    return ac.scan(u.clamp(u.toInt(req.query.hours, 24), 1, 720),
                   u.clamp(u.toInt(req.query.limit, 40), 1, 200));
  }, { admin: true });

  app.add('GET', '/api/admin/anticheat/player', async (req) => {
    if (!roles.canAccessZone(req.user, 'security')) throw new u.ApiError('Недостаточно прав');
    const ac = require('./services/antiCheat');
    const r = await ac.scanOne(String(req.query.id || ''), u.clamp(u.toInt(req.query.hours, 72), 1, 2160));
    if (!r) throw new u.ApiError('Игрок не найден');
    return r;
  }, { admin: true });

  // ═══ АНАЛИТИКА ПРОЕКТА ═══════════════════════════════════════════
  // Удержание, воронка новичка, экономика. Считается на лету по объектам
  // игроков плюс ежедневный срез — он копит историю для динамики.
  app.add('GET', '/api/admin/analytics', (req) => {
    if (!roles.canAccessZone(req.user, 'analytics')) throw new u.ApiError('Недостаточно прав');
    const an = require('./services/analytics');
    return an.overview();
  }, { admin: true });

  app.add('GET', '/api/admin/multi-check', (req) => {
    if (!roles.canAccessZone(req.user, 'security')) throw new u.ApiError('Недостаточно прав');
    const access = require('./services/access');
    // Отдаём не только группы, но и признак «прокси не передаёт адрес»:
    // без него панель показывала бы 36 игроков под одним 127.0.0.1 как
    // готовый список мультоводов — и это худший вид ложного сигнала,
    // потому что он выглядит убедительно.
    return access.ipSummary(player.users(), u.toInt(req.query.min, 2));
  }, { admin: true });

  // ═══ ЖУРНАЛ НАЧИСЛЕНИЙ ЗОЛОТА (только владелец) ══════════════════
  // Золото — премиум-валюта: владелец должен видеть каждый источник,
  // включая выдачу администрацией. Администраторам раздел недоступен,
  // иначе смысл контроля теряется.
  app.add('GET', '/api/admin/gold-log', async (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const limit = u.clamp(u.toInt(req.query.limit, 200), 1, 1000);
    const who = String(req.query.userId || '').trim();
    const stats = require('./services/stats');

    // Список игроков с движением золота — чтобы выбрать, чью историю смотреть.
    // Данные берём из накопленной статистики: она и так ведёт разбивку
    // по источникам, а журнал действий для сводки слишком «сырой».
    const live = Object.values(player.users()).filter((p: any) => !p.isBot);
    const players = live
      .map((p: any) => {
        const st = (p.stats || {}) as any;
        const got = Object.values(st.goldGot || {}).reduce((a: any, b: any) => a + b, 0) as number;
        const spent = Object.values(st.goldSpent || {}).reduce((a: any, b: any) => a + b, 0) as number;
        return { id: p.id, name: p.name, level: p.level, now: p.gold || 0, got, spent, vip: require('./services/vip').isVip(p) };
      })
      .filter((p) => p.got > 0 || p.spent > 0 || p.now > 0)
      .sort((a, b) => b.got - a.got);

    // Если игрок не выбран — отдаём только список и общую сводку
    if (!who) {
      const totals = players.reduce((acc, p) => {
        acc.got += p.got; acc.spent += p.spent; acc.now += p.now; return acc;
      }, { got: 0, spent: 0, now: 0 });
      return { players, totals, rows: [], selected: null };
    }

    const target: any = player.users()[who];
    if (!target) throw new u.ApiError('Игрок не найден');
    const report = stats.report(target);

    // История операций конкретного игрока — с человеческим описанием
    let logs: any[] = [];
    try { logs = await auditLog.listForUser(who, 500); } catch (e) {}
    const translate = require('./services/logTranslate');
    const rows = logs
      .map((l: any) => {
        const human = l.human || translate.describe(l.path, l.body, l.result) || '';
        // Сумма золота: из описания или из тела запроса
        const m = /🪙\s*([\d\s]+)/.exec(human);
        const gold = m ? Number(m[1].replace(/\s/g, '')) || 0 : (Number((l.body || {}).gold) || 0);
        return { at: l.at, text: human || l.path, gold, path: l.path };
      })
      .filter((r) => r.gold > 0)
      .slice(0, limit);

    return {
      players,
      selected: (() => {
        const src = report.gold.bySource || [];
        const pick = (ids: string[]) => src.filter((x: any) => ids.includes(x.id));
        const sum = (arr: any[]) => arr.reduce((n, x) => n + x.value, 0);
        // Три понятные группы поступлений вместо плоского списка
        const bought = pick(['purchase']);
        const won = pick(['event', 'season', 'contract', 'quest', 'achievement', 'login', 'referral']);
        const granted = pick(['admin']);
        const rest = src.filter((x: any) => !['purchase', 'event', 'season', 'contract',
          'quest', 'achievement', 'login', 'referral', 'admin'].includes(x.id));
        return {
          id: target.id, name: target.name, level: target.level,
          now: target.gold || 0,
          got: report.gold.total, spent: report.gold.spent,
          groups: [
            { id: 'bought',  label: 'Куплено за деньги',        total: sum(bought),  items: bought },
            { id: 'won',     label: 'Выиграно в игре',          total: sum(won),     items: won },
            { id: 'granted', label: 'Начислено администрацией', total: sum(granted), items: granted },
            ...(rest.length ? [{ id: 'other', label: 'Прочее', total: sum(rest), items: rest }] : []),
          ],
          spending: report.gold.bySpending || [],
        };
      })(),
      rows,
    };
  }, { admin: true });

  // ═══ ЖУРНАЛ ДЕЙСТВИЙ СОТРУДНИКОВ (только владелец) ════════════════
  // Владелец должен видеть, что делают его администраторы и модераторы:
  // это единственная защита от злоупотреблений теми правами, что он им
  // выдал. Сотрудники свой журнал видят, чужой — нет.
  app.add('GET', '/api/admin/staff-log', async (req) => {
    if (!roles.isOwner(req.user)) throw new u.ApiError('Только для владельца');
    const users = player.users();
    const staffIds = new Set(
      Object.values(users).filter((p: any) => roles.roleOf(p)).map((p: any) => p.id));
    const who = String(req.query.userId || '').trim();
    const limit = u.clamp(u.toInt(req.query.limit, 200), 1, 1000);

    let logs: any[] = [];
    try {
      logs = who
        ? await auditLog.listForUser(who, limit)
        : (await auditLog.listAll(1000)).filter((l: any) => staffIds.has(l.userId));
    } catch (e) {}

    // Кто есть кто — для фильтра в интерфейсе
    const staff = Object.values(users)
      .filter((p: any) => roles.roleOf(p))
      .map((p: any) => ({ id: p.id, name: p.name, role: roles.roleOf(p), label: roles.roleLabel(p) }));

    return { staff, logs: humanizeLogs(logs.slice(0, limit)), total: logs.length };
  }, { admin: true });

  // ═══ БАЗА ДАННЫХ: копии, снимки, восстановление ═══════════════════
  // Всё только для администратора. Произвольный SQL наружу НЕ выставляется
  // намеренно: даже админский эндпоинт с произвольным запросом — это
  // готовый инструмент для порчи данных, если чужой получит доступ к
  // админской сессии. Наружу отдаются только конкретные операции.
  app.add('GET', '/api/admin/db/stats', () => {
    const st = db.dbStats();
    const backups = db.backupsList ? db.backupsList() : [];
    // Копии различаем по метке ВНУТРИ имени: файл называется
    // «generals-{метка}-{дата}.db», поэтому искать метку надо не в
    // начале строки, а после названия игры.
    const kindOf = (f: string) => (/-manual-/.test(f) ? 'manual'
      : (/-pre-restore-/.test(f) ? 'pre-restore'
      : (/pre-deploy/.test(f) ? 'pre-deploy'
      : (/-light-/.test(f) ? 'light' : 'auto'))));
    return {
      stats: st,
      backups: backups.map((b: any) => ({ ...b, kind: kindOf(String(b.file || '')) })),
      logs: db.logStats ? db.logStats() : null,
      // Вывоз копий за пределы сервера: работает ли расписание
      offsite: db.offsiteStatus ? db.offsiteStatus() : null,
    };
  }, { admin: true });

  app.add('POST', '/api/admin/db/backup', act((req, n) => {
    const file = db.backupNow('manual');
    if (!file) throw new u.ApiError('Копии доступны только на своей базе (DB_DRIVER=sqlite)');
    n.push(`🗄 Копия базы создана: ${require('path').basename(file)}`);
    return { file };
  }), { admin: true });

  // ── Что было у игрока до сбоя ─────────────────────────────────────
  // Открывает выбранную копию базы на чтение и отдаёт состояние игрока
  // на тот момент вместе с разницей против текущего. По этой разнице и
  // видно, что именно возвращать.
  app.add('GET', '/api/admin/db/player-at', (req) => {
    const file = String(req.query.file || '');
    const q = String(req.query.q || '').trim();
    if (!q) throw new u.ApiError('Укажите позывной или id игрока');
    // Ошибки чтения копии (нет файла, недопустимое имя) — это ошибка
    // ввода, а не сбой сервера: отвечаем 400 с понятным текстом, иначе
    // в логи сыплется стектрейс, а админ видит «внутренняя ошибка».
    let was: any = null;
    try { was = db.playerFromBackup(file, q); }
    catch (e: any) { throw new u.ApiError(e && e.message ? e.message : 'Не удалось прочитать копию'); }
    if (!was) return { found: false };

    const audit = require('./services/auditLog');
    const players: Record<string, any> = player.users();
    const now = players[was.id] || null;

    const snap = (p: any) => (p ? audit.expandBalance(audit.balanceOf(p)) : null);
    const a = snap(was), b = snap(now);
    const diff = a && b ? {
      dollars: b.dollars - a.dollars, gold: b.gold - a.gold,
      level: b.level - a.level, exp: b.exp - a.exp,
      units: b.units - a.units, buildings: b.buildings - a.buildings,
    } : null;

    return {
      found: true,
      file,
      player: { id: was.id, name: was.name },
      wasBalance: a,
      nowBalance: b,
      diff,
      existsNow: !!now,
      // Поимённо: чего именно не хватает сейчас против копии
      lostUnits: unitDiff(was.units, now && now.units),
      lostBuildings: buildDiff(was.buildings, now && now.buildings),
    };
  }, { admin: true });

  // ═══ ИСТОРИЯ СОСТОЯНИЯ ИГРОКА ════════════════════════════════════
  // Копии базы отвечают на вопрос «что было в 4 утра». История отвечает
  // на «что было в 14:35» — с точностью до пяти минут и с полным составом
  // имущества. Именно она нужна в разборе почти всегда.
  // Зона «Игроки», а не «База данных». Сначала было наоборот, и получалось
  // абсурдно: самая частая задача сотрудника — разобрать «у меня всё
  // пропало» — оказывалась доступна только владельцу. При этом полное
  // досье игрока с тем же имуществом сотрудник и так видит по зоне
  // «Игроки»; история показывает ТО ЖЕ САМОЕ, только в прошлом, и ничего
  // не меняет. Копии базы и восстановление остаются владельческими.
  app.add('GET', '/api/admin/player-history', (req) => {
    if (!roles.canAccessZone(req.user, 'players')) throw new u.ApiError('Недостаточно прав');
    const q = String(req.query.q || '').trim();
    if (!q) throw new u.ApiError('Укажите позывной или id игрока');
    const users = player.users();
    const target = users[q] || Object.values(users).find(
      (p: any) => String(p.name || '').toLowerCase() === q.toLowerCase());
    if (!target) throw new u.ApiError('Игрок не найден');
    return {
      player: { id: (target as any).id, name: (target as any).name },
      list: db.playerHistory((target as any).id, u.clamp(u.toInt(req.query.limit, 100), 1, 500)),
      stats: db.historyStats(),
    };
  }, { admin: true });

  // Один срез с разницей против текущего состояния: сразу видно, что
  // именно возвращать, а не «вот два больших объекта, сравнивайте сами»
  app.add('GET', '/api/admin/player-history/at', (req) => {
    if (!roles.canAccessZone(req.user, 'players')) throw new u.ApiError('Недостаточно прав');
    const snapRec = db.playerHistoryGet(u.toInt(req.query.seq, 0));
    if (!snapRec) throw new u.ApiError('Срез не найден');
    const was = snapRec.player;
    const now = player.users()[snapRec.id] || null;
    const audit = require('./services/auditLog');
    const bal = (p: any) => (p ? audit.expandBalance(audit.balanceOf(p)) : null);
    const a = bal(was), b = bal(now);
    return {
      // found — чтобы панель отрисовала это той же функцией, что и сверку
      // с копией базы: разница выглядит одинаково, откуда бы ни пришла
      found: true,
      seq: snapRec.seq, at: snapRec.at, label: snapRec.label, actor: snapRec.actor,
      player: { id: was.id, name: was.name },
      existsNow: !!now,
      wasBalance: a,
      nowBalance: b,
      diff: a && b ? {
        dollars: b.dollars - a.dollars, gold: b.gold - a.gold,
        level: b.level - a.level, exp: b.exp - a.exp,
        units: b.units - a.units, buildings: b.buildings - a.buildings,
      } : null,
      lostUnits: unitDiff(was.units, now && (now as any).units),
      lostBuildings: buildDiff(was.buildings, now && (now as any).buildings),
    };
  }, { admin: true });

  app.add('GET', '/api/admin/db/snapshots', (req) => ({
    snapshots: db.snapshotsList(req.query.collection || undefined, u.toInt(req.query.limit, 30)),
  }), { admin: true });

  app.add('POST', '/api/admin/db/snapshot', act((req, n) => {
    const name = String(req.body.collection || '').trim();
    if (!name) throw new u.ApiError('Укажите коллекцию');
    if (!db.snapshotCollection(name, String(req.body.label || 'вручную').slice(0, 40))) {
      throw new u.ApiError('Не удалось снять снимок (нужна своя база и существующая коллекция)');
    }
    n.push(`📸 Снимок коллекции «${name}» сохранён`);
    return { ok: true };
  }), { admin: true });

  // Восстановление коллекции из снимка. ПЕРЕД восстановлением делается
  // копия базы — чтобы можно было отменить и само восстановление.
  app.add('POST', '/api/admin/db/restore', act((req, n) => {
    const seq = u.toInt(req.body.seq, 0);
    const name = String(req.body.collection || '').trim();
    if (!seq || !name) throw new u.ApiError('Укажите снимок и коллекцию');
    const safety = db.backupNow('перед-восстановлением');
    if (!db.snapshotRestore(seq, name)) {
      throw new u.ApiError('Не удалось восстановить: снимок не найден, либо это коллекция игроков (её восстанавливают только из копии базы)');
    }
    n.push(`♻️ Коллекция «${name}» восстановлена из снимка #${seq}. Страховочная копия: ${safety ? require('path').basename(safety) : '—'}`);
    return { ok: true, safety };
  }), { admin: true });

  // Сезонные метрики за прошлые недели — то, что теперь снимается перед
  // каждым обнулением. Отсюда видно, что можно вернуть пострадавшим.
  app.add('GET', '/api/admin/db/weekly-metrics', (req) => {
    const store: any = db.load('weeklyMetricsBackup', {});
    const week = req.query.week ? String(req.query.week) : null;
    if (week) {
      const m = store[week] || {};
      const rows = Object.keys(m).map((id) => ({ id, ...m[id] }));
      return { week, players: rows.length, rows: rows.slice(0, 500) };
    }
    return {
      weeks: Object.keys(store).sort().reverse().map((w) => ({ week: w, players: Object.keys(store[w] || {}).length })),
    };
  }, { admin: true });

  app.add('GET',  '/api/admin/discounts', () => admin.discountCategories(), { admin: true });
  app.add('POST', '/api/admin/discount',  act((req, n) => admin.setDiscount(req.user, req.body, n)), { admin: true });
  app.add('GET',  '/api/admin/global-buffs', () => admin.listGlobalBuffs(), { admin: true });
  app.add('POST', '/api/admin/global-buff',  act((req, n) => admin.setGlobalBuff(req.user, req.body, n)), { admin: true });
  // Журнал действий игроков. humanizeLogs здесь ОБЯЗАТЕЛЕН, и его тут
  // не было: этот роут отдавал сырое тело каждого запроса в браузер.
  // Секреты вычищаются ещё при записи, поэтому паролей там нет, но
  // остальное тело (почты при регистрации, тексты сообщений, параметры
  // покупок) уезжало сотруднику пачками по 200 строк — при том что
  // панель его не показывает. Отдавать в браузер то, что там не нужно, —
  // это лишний путь утечки и лишний трафик на ровном месте.
  app.add('GET',  '/api/admin/logs', async (req) => {
    const r = await admin.listLogs(req.query);
    return { ...r, logs: humanizeLogs(r.logs) };
  }, { admin: true });
  // Бан и обнуление аккаунтов
  app.add('POST', '/api/admin/ban',   act((req, n) => admin.setBan(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/reset', act((req, n) => admin.resetAccount(req.user, req.body, n)), { admin: true });
  // Технический раздел: полное удаление аккаунта и установка пароля
  app.add('POST', '/api/admin/delete-account', act((req, n) => admin.deleteAccount(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/set-password',   act((req, n) => admin.setPassword(req.user, req.body, n)), { admin: true });
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

  // ═══ ЖАЛОБЫ НА ИГРОКОВ ═══════════════════════════════════════════
  // Игрок жалуется прямо из профиля обидчика, сотрудник разбирает
  // очередь, сгруппированную по нарушителю. Санкции — только вручную.
  const reports = require('./services/reports');
  app.add('GET',  '/api/reports/mine', (req) => reports.mine(req.user));
  app.add('POST', '/api/reports/create', act((req, n) =>
    reports.create(req.user, String(req.body.targetId || ''), req.body.reason,
                   req.body.text, req.body.where, n)));

  app.add('GET', '/api/mod/reports', (req) => {
    if (!roles.canAccessZone(req.user, 'moderation')) throw new u.ApiError('Недостаточно прав');
    return reports.queue(String(req.query.status || 'new'), u.clamp(u.toInt(req.query.limit, 60), 1, 200));
  }, { admin: true });

  app.add('POST', '/api/mod/report/resolve', act((req, n) => {
    if (!roles.canAccessZone(req.user, 'moderation')) throw new u.ApiError('Недостаточно прав');
    return reports.resolve(req.user, String(req.body.id || ''), !!req.body.accept, req.body.verdict, n);
  }), { admin: true });

  app.add('POST', '/api/mod/report/resolve-all', act((req, n) => {
    if (!roles.canAccessZone(req.user, 'moderation')) throw new u.ApiError('Недостаточно прав');
    return reports.resolveAll(req.user, String(req.body.targetId || ''), !!req.body.accept, req.body.verdict, n);
  }), { admin: true });

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
  app.add('GET',  '/api/admin/support',       (req) => support.adminList(req.query, req.user), { admin: true });
  app.add('POST', '/api/admin/support/claim',   act((req, n) => support.claim(req.user, String(req.body.ticketId || ''), n)), { admin: true });
  app.add('POST', '/api/admin/support/release', act((req, n) => support.release(req.user, String(req.body.ticketId || ''), n)), { admin: true });
  app.add('POST', '/api/admin/support/reply', act((req, n) => support.adminReply(req.user, req.body.ticketId, req.body.text, !!req.body.close, n)), { admin: true });
  // Платёжная система (заготовка)
  app.add('GET',  '/api/payments/packages', (req) => payments.packages());
  app.add('GET',  '/api/payments/orders',   (req) => payments.myOrders(req.user));
  app.add('POST', '/api/payments/create',   act((req, n) => payments.createOrder(req.user, req.body.packageId, n)));
};

export = registerRoutes;
