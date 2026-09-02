// ===================================================================
// src/services/release.ts — выкат версии и тестовые аккаунты
//
// Здесь три вещи, которые кажутся разными, но решают одну задачу:
// довести правку до игроков, ничего им не сломав.
//
// ── Про кнопку выката и безопасность ──────────────────────────────
//
// Кнопка в панели, запускающая обновление на сервере, — это по сути
// удалённое выполнение кода. Если бы она принимала от панели команду,
// то любой, кто получил доступ к аккаунту владельца, получил бы и
// сервер целиком. Поэтому:
//
//   1. Запускается ФИКСИРОВАННЫЙ скрипт из репозитория (tools/deploy.sh).
//      Панель не передаёт команду — она передаёт только номер версии.
//   2. Номер версии ПРОВЕРЯЕТСЯ по образцу: сорок шестнадцатеричных
//      знаков либо origin/<ветка>. Ничего другого до оболочки не дойдёт,
//      и подставить туда «; rm -rf» невозможно.
//   3. Только владелец, и только со включённым вторым фактором — вход в
//      панель без него закрыт (см. src/core/http.ts).
//   4. Каждый выкат пишется в журнал: кто, когда, какую версию.
//
// ── Про то, почему скрипт запускается открепившимся ───────────────
//
// Последнее, что делает выкат, — перезапускает процесс игры. То есть
// убивает того, кто его запустил. Обычный дочерний процесс умер бы
// вместе с родителем на середине сборки, оставив игру без dist/.
// Поэтому скрипт откручивается от родителя (detached) и пишет ход
// работы в файл, а панель читает этот файл.
//
// ── Про то, почему режим обслуживания не снимается сам ────────────
//
// После выката игра может не подняться: ошибка сборки, несовместимая
// правка, забытая переменная окружения. Автоматически открыть двери
// значит впустить людей в сломанную игру и узнать об этом от них.
// Поэтому режим снимает человек, глазами убедившись, что игра жива.
// В панели для этого одна кнопка.
// ===================================================================
import fs = require('fs');
import path = require('path');
import cp = require('child_process');
import db = require('../core/db');
import u = require('../core/utils');
import maintenance = require('./maintenance');
import testWorld = require('./testWorld');
import auditLog = require('./auditLog');
import type { Notices } from '../types';

const ROOT = process.cwd();
const STATUS_FILE = path.join(ROOT, 'data', 'deploy-status.json');
const LOG_FILE = path.join(ROOT, 'data', 'deploy.log');
const SCRIPT = path.join(ROOT, 'tools', 'deploy.sh');

// Что разрешено передавать скрипту как версию. Всё остальное —
// отказ ещё до запуска оболочки.
const COMMIT_RE = /^(?:[0-9a-f]{7,40}|origin\/[A-Za-z0-9._\-\/]{1,60})$/;

function git(args: string[]): string {
  try {
    return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 15000 }).trim();
  } catch (e) { return ''; }
}

// Какая версия работает прямо сейчас.
function current() {
  const hash = git(['rev-parse', 'HEAD']);
  return {
    commit: hash,
    short: hash.slice(0, 8),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    at: git(['log', '-1', '--format=%cI']),
    subject: git(['log', '-1', '--format=%s']).slice(0, 120),
    dirty: !!git(['status', '--porcelain']),
    isGit: !!hash,
  };
}

function readStatus(): any {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (e) { return null; }
}

function tail(n = 60): string {
  try {
    const t = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    return t.slice(-n).join('\n');
  } catch (e) { return ''; }
}

// ── Состояние для панели ───────────────────────────────────────────
function status() {
  const cur = current();
  const st = readStatus();
  return {
    world: testWorld.view(),
    maintenance: maintenance.adminView(),
    current: cur,
    // Что лежит в origin — то есть что выкатится, если нажать «выкатить
    // последнее». Обновляется только по кнопке «Проверить обновления»:
    // ходить в сеть на каждое открытие панели незачем.
    last: readStatus() && readStatus().fetched ? readStatus().fetched : null,
    deploy: st ? {
      state: st.state || '',
      commit: st.commit || '',
      startedAt: st.startedAt || 0,
      finishedAt: st.finishedAt || 0,
      by: st.by || '',
      rollbackTo: st.rollbackTo || '',
      error: st.error || '',
    } : null,
    log: tail(),
    canDeploy: cur.isGit && fs.existsSync(SCRIPT),
    // Скрипта нет или это не репозиторий — честно говорим почему, а не
    // прячем кнопку без объяснения.
    why: !cur.isGit ? 'Папка игры не является git-репозиторием — выкат кнопкой недоступен.'
      : (!fs.existsSync(SCRIPT) ? 'Не найден tools/deploy.sh.' : ''),
  };
}

// ── Выкат ──────────────────────────────────────────────────────────
// Кнопка одна, но означает разное в зависимости от того, где нажата:
//
//   в ТЕСТОВОМ мире — «обновить тестовый мир»: подтянуть свежее из
//     ветки и пересобрать себя. Это замена походу в консоль;
//   в БОЕВОМ — «выкатить проверенную версию»: поставить ровно тот
//     коммит, что проверен на тесте.
//
// Первое время этого различия не было: выкат из тестового мира был
// запрещён вовсе. Получалось, что тестовый мир обновляется только
// командой в консоли — то есть половина пути к игре по-прежнему шла
// мимо панели, и смысл кнопки терялся.
function deploy(actor: any, commit: string, notices: Notices) {
  const cur = current();
  if (!cur.isGit) throw new u.ApiError('Папка игры не является git-репозиторием');
  if (!fs.existsSync(SCRIPT)) throw new u.ApiError('Не найден tools/deploy.sh');

  const want = String(commit || '').trim() || ('origin/' + (cur.branch || 'main'));
  if (!COMMIT_RE.test(want)) {
    throw new u.ApiError('Версия указана неверно. Ожидается номер коммита '
      + '(7–40 шестнадцатеричных знаков) либо origin/ветка.');
  }

  const prev = readStatus();
  if (prev && prev.state === 'идёт') {
    throw new u.ApiError('Выкат уже идёт. Дождитесь окончания или проверьте журнал.');
  }

  // Режим обслуживания включаем ДО запуска: сборка занимает минуты, и
  // всё это время игроки не должны менять данные.
  if (!maintenance.isOn()) {
    maintenance.turnOn(actor.name, 'Идёт обновление игры. Скоро вернёмся.', 15);
  }

  const st = {
    state: 'идёт',
    commit: want,
    by: String(actor.name || ''),
    startedAt: Date.now(),
    finishedAt: 0,
    rollbackTo: cur.commit,     // куда возвращаться, если поднялось криво
    error: '',
  };
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(st, null, 2));
    fs.writeFileSync(LOG_FILE, '');
  } catch (e: any) {
    throw new u.ApiError('Не удалось подготовить файлы выката: ' + (e && e.message));
  }

  // Открепляем от себя: последним делом скрипт перезапустит игру, то
  // есть убьёт этот процесс. Обычный потомок умер бы вместе с ним на
  // середине сборки.
  const out = fs.openSync(LOG_FILE, 'a');
  const child = cp.spawn('/bin/bash', [SCRIPT, want], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, DEPLOY_STATUS_FILE: STATUS_FILE },
  });
  child.unref();

  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/admin/release/deploy',
    body: { commit: want, from: cur.commit },
  });
  notices.push(testWorld.isOn()
    ? `🧪 Тестовый мир обновляется: ${want}. После сборки проверьте и откройте его кнопкой.`
    : `🚀 Выкат запущен: ${want}. Игра закрыта на обновление — `
      + 'после проверки откройте её кнопкой.');
  return { started: true, commit: want, rollbackTo: cur.commit };
}

// ── Тестовый аккаунт ───────────────────────────────────────────────
// Только в тестовом мире. На боевом это была бы дыра размером с
// регистрацию без подтверждения почты.
async function makeTestAccount(actor: any, login: string, password: string,
  country: string, ip: string, notices: Notices) {
  if (!testWorld.isOn()) {
    throw new u.ApiError('Тестовые аккаунты создаются только в тестовом мире '
      + '(TEST_WORLD=1). На боевом сервере это запрещено.');
  }
  const auth = require('./auth');
  const consent = require('./consent');
  const player = require('./player');

  login = String(login || '').trim();
  password = String(password || '');
  if (password.length < 8) throw new u.ApiError('Пароль: минимум 8 символов');

  // Почта нужна формально — на неё ничего не отправляется, но она
  // обязана быть разной у разных аккаунтов. Правило одно на кнопку и на
  // консольный инструмент, см. testWorld.testAccountEmail.
  const mail = testWorld.testAccountEmail(login);

  const res: any = await auth.register(login, password, mail, country || 'ru', ip,
    'тестовый аккаунт', {}, '', { age18: true, terms: true, pdn: true });

  const users = player.users();
  const made: any = Object.values(users).find((p: any) => p.name === login);
  if (!made) throw new u.ApiError('Аккаунт не создался');

  // Подтверждаем почту сразу: ждать письмо, которое некуда слать, —
  // ровно то, ради чего эта кнопка и нужна.
  made.emailVerified = true;
  made.emailVerifyToken = null;
  made.emailVerifyCode = null;
  (made as any).isTestAccount = true;
  db.markUser(made.id);
  db.save('users');

  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/admin/test-account',
    body: { login, country },
  });
  notices.push(`🧪 Тестовый аккаунт «${login}» создан и готов к входу`);
  return {
    login, password, world: testWorld.NAME,
    note: 'Передайте тестировщику логин и пароль. Почта подтверждена, письма не нужны.',
    token: res && res.token ? res.token : null,
  };
}

export = { status, deploy, makeTestAccount, current, COMMIT_RE };
