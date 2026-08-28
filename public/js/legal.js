// ═══════════════════════════════════════════════════════════════════
// public/js/legal.js — реквизиты Оператора для всех документов
//
// ЕДИНСТВЕННОЕ МЕСТО, где заполняются данные Оператора. Раньше одни и
// те же одиннадцать значений (наименование, ИНН, адрес, три ящика,
// номер редакции, дата) повторялись в каждом документе — то есть
// одиннадцать раз в одиннадцати файлах. Так их не заполняют, а
// заполнив, не поддерживают: где-то остаётся старый адрес, и документ
// начинает противоречить сам себе.
//
// КАК ЗАПОЛНИТЬ: впишите значения в объект LEGAL ниже. Пока значение
// пустое, на странице на его месте горит красная подсказка — пропуск
// невозможно не заметить.
//
// Меняете существенные условия — поднимите REDACTION и DATE, а в
// src/services/consent.ts поднимите версию соответствующего документа:
// тогда игроки будут спрошены заново, а не «согласятся молчанием».
// ═══════════════════════════════════════════════════════════════════
(function () {
  var LEGAL = {
    // ── Кто Оператор ────────────────────────────────────────────────
    // Это корневое решение: от статуса зависит, можно ли принимать
    // платежи, применяется ли 54-ФЗ и что писать в уведомлении РКН.
    operator: '',        // «ИП Иванов Иван Иванович» / «ООО "Название"»
    status: '',          // «индивидуальный предприниматель» / «ООО» / «самозанятый»
    inn: '',
    ogrn: '',            // ОГРН или ОГРНИП; для самозанятого — «не применяется»
    address: '',         // почтовый адрес для обращений

    // ── Домен и ящики ───────────────────────────────────────────────
    site: 'https://aliance-general.ru',
    mailSupport: '',     // support@aliance-general.ru
    mailPayments: '',    // payments@aliance-general.ru
    mailPrivacy: '',     // privacy@aliance-general.ru

    // ── Редакция комплекта ──────────────────────────────────────────
    redaction: '1.0',
    date: '',            // «26 августа 2026 г.» — дата вступления в силу

    // ── Обработка персональных данных ───────────────────────────────
    rknNotice: '',       // номер записи в реестре РКН и дата уведомления
    hosting: '',         // хостинг и адрес ЦОД, где лежит база
    backupPlace: '',     // где хранится резервная копия и в какой стране
  };

  // Подсказки на случай незаполненного значения: что именно вписать.
  var HINT = {
    operator: 'НАИМЕНОВАНИЕ ИЛИ ФИО ОПЕРАТОРА',
    status: 'ИП / ООО / САМОЗАНЯТЫЙ',
    inn: 'ИНН',
    ogrn: 'ОГРН / ОГРНИП',
    address: 'АДРЕС ДЛЯ ОБРАЩЕНИЙ',
    site: 'АДРЕС САЙТА',
    mailSupport: 'ЯЩИК ПОДДЕРЖКИ',
    mailPayments: 'ЯЩИК ПО ПЛАТЕЖАМ',
    mailPrivacy: 'ЯЩИК ПО ПЕРСОНАЛЬНЫМ ДАННЫМ',
    redaction: 'НОМЕР РЕДАКЦИИ',
    date: 'ДАТА ВСТУПЛЕНИЯ В СИЛУ',
    rknNotice: 'НОМЕР ЗАПИСИ В РЕЕСТРЕ РКН И ДАТА УВЕДОМЛЕНИЯ',
    hosting: 'ХОСТИНГ И АДРЕС ЦОД',
    backupPlace: 'МЕСТО РЕЗЕРВНОГО КОПИРОВАНИЯ И СТРАНА',
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Значение или красная подсказка на его месте.
  function val(key) {
    var v = LEGAL[key];
    if (v) return esc(v);
    return '<span class="doc-fill">[' + esc(HINT[key] || key.toUpperCase()) + ']</span>';
  }

  function mailto(key) {
    var v = LEGAL[key];
    if (!v) return val(key);
    return '<a href="mailto:' + esc(v) + '">' + esc(v) + '</a>';
  }

  // ── Подстановка в текст ─────────────────────────────────────────
  // <span data-legal="operator"></span> в любом документе.
  function fill() {
    var nodes = document.querySelectorAll('[data-legal]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-legal');
      nodes[i].innerHTML = /^mail/.test(key) ? mailto(key) : val(key);
    }

    // Дата редакции в шапке
    var d = document.querySelectorAll('[data-legal-date]');
    for (var j = 0; j < d.length; j++) {
      d[j].innerHTML = 'Редакция ' + val('redaction') + ' · действует с ' + val('date');
    }

    // Блок реквизитов в подвале
    var r = document.getElementById('legal-req');
    if (r) {
      r.innerHTML = '<h2>Реквизиты и контакты Оператора</h2>'
        + '<div class="doc-table-wrap"><table><tbody>'
        + '<tr><th>Оператор</th><td>' + val('operator') + ', ' + val('status') + '</td></tr>'
        + '<tr><th>ИНН / ОГРН</th><td>ИНН ' + val('inn') + '; ОГРН(ИП) ' + val('ogrn') + '</td></tr>'
        + '<tr><th>Адрес</th><td>' + val('address') + '</td></tr>'
        + '<tr><th>Сайт</th><td>' + val('site') + '</td></tr>'
        + '<tr><th>Поддержка</th><td>' + mailto('mailSupport') + '</td></tr>'
        + '<tr><th>Платежи</th><td>' + mailto('mailPayments') + '</td></tr>'
        + '<tr><th>Персональные данные</th><td>' + mailto('mailPrivacy') + '</td></tr>'
        + '</tbody></table></div>';
    }

    // Подвал со ссылками на весь комплект
    var f = document.getElementById('legal-foot');
    if (f) {
      f.innerHTML = '<a href="/terms.html">Соглашение</a> · '
        + '<a href="/rules.html">Правила игры</a> · '
        + '<a href="/payments.html">Платежи</a> · '
        + '<a href="/privacy.html">Политика ПДн</a> · '
        + '<a href="/cookies.html">Cookie</a> · '
        + '<a href="/consent-pdn.html">Согласия</a> · '
        + '<a href="/">Вернуться в игру</a>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
  else fill();

  window.LEGAL = LEGAL;
})();
