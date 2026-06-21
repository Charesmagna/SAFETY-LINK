const { Pool } = require('pg');
const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/safety_link_dev';
const pool = new Pool({ connectionString: url });

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

async function setTenant(tenantId) {
  if (!tenantId) return;
  // set GUC for current session
  await pool.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

module.exports = { query, setTenant, pool };
