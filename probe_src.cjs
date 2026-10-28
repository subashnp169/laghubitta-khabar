const Database = require('better-sqlite3');
const db = new Database('data/durable/store.db', { readonly: true });
const rows = db.prepare("SELECT id, source_type, source_scope FROM sources ORDER BY id").all();
console.log(JSON.stringify(rows.map(r=>r.id)));
db.close();
