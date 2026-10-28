const Database = require('better-sqlite3');
const db = new Database('data/durable/store.db', { readonly: true });

function q(sql){ try { return db.prepare(sql).all(); } catch(e){ return [{error:e.message}]; } }
function one(sql){ try { return db.prepare(sql).get(); } catch(e){ return {error:e.message}; } }

console.log("=== ingestion_runs: total & status ===");
console.log(q("SELECT status, COUNT(*) c FROM ingestion_runs GROUP BY status"));
console.log("=== ingestion_runs: last 5 by started_at ===");
console.log(q("SELECT id, source_id, status, started_at, finished_at, error_count FROM ingestion_runs ORDER BY started_at DESC LIMIT 5"));
console.log("=== ingestion_sources: total ===");
console.log(one("SELECT COUNT(*) c FROM ingestion_sources"));
console.log("=== sources: total & type/scope ===");
console.log(q("SELECT source_type, source_scope, COUNT(*) c FROM sources GROUP BY source_type, source_scope"));
console.log("=== sources: missing url? ===");
console.log(one("SELECT COUNT(*) c FROM sources WHERE url IS NULL OR url=''"));
console.log("=== source_snapshots: total ===");
console.log(one("SELECT COUNT(*) c FROM source_snapshots"));
console.log("=== data_assertions: by entity_type ===");
console.log(q("SELECT entity_type, COUNT(*) c FROM data_assertions GROUP BY entity_type"));
console.log("=== data_assertions: missing source_id ===");
console.log(one("SELECT COUNT(*) c FROM data_assertions WHERE source_id IS NULL OR source_id=''"));
console.log("=== data_assertions: missing observed_at ===");
console.log(one("SELECT COUNT(*) c FROM data_assertions WHERE observed_at IS NULL OR observed_at=''"));
console.log("=== data_conflicts: by status ===");
console.log(q("SELECT status, COUNT(*) c FROM data_conflicts GROUP BY status"));
console.log("=== institutions represented in assertions ===");
console.log(one("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_type='institution'"));
console.log("=== validation_results: total & pass/fail ===");
console.log(q("SELECT status, COUNT(*) c FROM validation_results GROUP BY status"));
console.log("=== audit_logs: last 3 ===");
console.log(q("SELECT action, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 3"));

db.close();
EOF
