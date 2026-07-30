// Диагностика базы на проде. Ничего не меняет — только читает и печатает.
// Запуск на сервере:  cd ~/Aliance-Generals && node diagnose-prod.js
const db = require('./dist/src/core/db');
(async () => {
  await db.init();
  const rep = db.findDuplicateUsers();
  console.log(`\nВсего записей игроков в базе: ${rep.total}`);
  console.log(`Игроков без сезонного объекта (счёт недели = 0): ${rep.noSeasonWeekly}\n`);

  if (!rep.dupNames.length) console.log('✅ Одинаковых позывных не найдено.');
  else {
    console.log(`⚠️  ОДИНАКОВЫЕ ПОЗЫВНЫЕ — ${rep.dupNames.length} групп(ы).`);
    console.log('   Это и есть причина одного имени на нескольких местах в рейтинге.');
    console.log('   Оставьте тот аккаунт, где свежий «вход» и есть сезонные данные,');
    console.log('   второй удалите в админке (Техническое → удаление аккаунта).\n');
    for (const g of rep.dupNames) {
      console.log(`  Позывной «${g.accounts[0].name}»:`);
      for (const a of g.accounts) {
        const seen = a.lastSeen ? new Date(a.lastSeen).toISOString().slice(0, 16).replace('T', ' ') : 'никогда';
        const made = a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : '—';
        console.log(`    id=${a.id}  ур.${a.level}  ушей всего=${a.ears}  за неделю=${a.weeklyEars}` +
                    `  сезон=${a.hasSeasonWeekly ? 'есть' : 'НЕТ'}  создан=${made}  вход=${seen}  email=${a.email || '—'}`);
      }
      console.log('');
    }
  }
  if (rep.dupEmails.length) {
    console.log(`⚠️  Одинаковые email — ${rep.dupEmails.length} групп(ы):`);
    for (const g of rep.dupEmails) console.log(`  ${g.key}: ${g.accounts.map((a) => a.name + '/' + a.id).join(', ')}`);
  }
  process.exit(0);
})().catch((e) => { console.error('Ошибка:', e); process.exit(1); });
