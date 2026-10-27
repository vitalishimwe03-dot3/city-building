const p = require('./src/db');
p.initialize().then(async () => {
  try {
    const [r] = await p.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='course_registrations'");
    console.log(r[0] ? r[0].sql : 'no');
    const [c] = await p.query("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('TABLES:', c.map(x => x.name).join(','));
  } catch (e) {
    console.log('E', e.message);
  }
  process.exit(0);
});
