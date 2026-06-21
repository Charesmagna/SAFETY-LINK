const fastify = require('fastify');
const jwt = require('jsonwebtoken');
const { query, setTenant } = require('./db');
const { generateCode, hashCode } = require('./otp');
const { sendSMS } = require('./smsAdapter');
const http = require('http');

const app = fastify({ logger: true });
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// Simple auth: bearer token JWT { sub: phone, tenantId }
app.decorate('authenticate', async function (request, reply) {
  try {
    const auth = request.headers['authorization'];
    if (!auth) return reply.status(401).send({ error: 'missing auth' });
    const token = auth.replace(/^Bearer\s+/i, '');
    const decoded = jwt.verify(token, JWT_SECRET);
    request.user = decoded;
    // set tenant for DB session
    if (decoded.tenantId) await setTenant(decoded.tenantId);
  } catch (err) {
    request.log.warn(err);
    return reply.status(401).send({ error: 'invalid token' });
  }
});

app.post('/auth/request-otp', async (req, reply) => {
  const { phone, tenantId } = req.body;
  if (!phone) return reply.status(400).send({ error: 'phone required' });
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5min
  await query(
    'INSERT INTO otp_sessions(phone, tenant_id, code_hash, expires_at) VALUES($1,$2,$3,$4)',
    [phone, tenantId || null, codeHash, expiresAt]
  );
  await sendSMS(phone, `Your SAFETY-LINK login code is ${code}`);
  return { ok: true };
});

app.post('/auth/verify-otp', async (req, reply) => {
  const { phone, code } = req.body;
  if (!phone || !code) return reply.status(400).send({ error: 'phone+code required' });
  const res = await query(
    `SELECT id, code_hash, expires_at, attempts FROM otp_sessions WHERE phone=$1 ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (res.rowCount === 0) return reply.status(400).send({ error: 'no otp session' });
  const row = res.rows[0];
  if (new Date(row.expires_at) < new Date()) return reply.status(400).send({ error: 'expired' });
  const ok = hashCode(code) === row.code_hash;
  if (!ok) {
    await query('UPDATE otp_sessions SET attempts = attempts + 1 WHERE id=$1', [row.id]);
    return reply.status(400).send({ error: 'invalid code' });
  }
  // success: create or find user and issue JWT
  // For simplicity we create a user row if none
  const tenantId = row.tenant_id || null;
  let userRes = await query('SELECT id FROM users WHERE phone=$1 LIMIT 1', [phone]);
  let userId;
  if (userRes.rowCount === 0) {
    const r = await query('INSERT INTO users(tenant_id, phone) VALUES($1,$2) RETURNING id', [tenantId, phone]);
    userId = r.rows[0].id;
  } else {
    userId = userRes.rows[0].id;
  }
  const token = jwt.sign({ sub: userId, phone, tenantId }, JWT_SECRET, { expiresIn: '7d' });
  return { ok: true, token };
});

// WebSocket + realtime (socket.io)
const server = http.createServer(app.server);
const io = require('socket.io')(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  app.log.info('socket connected', socket.id);
  socket.on('joinTenant', (tenantId) => {
    socket.join(`tenant:${tenantId}`);
  });
});

app.post('/locations', { preHandler: [app.authenticate] }, async (req, reply) => {
  const { responderId, lat, lng, rssi, battery } = req.body;
  const tenantId = req.user && req.user.tenantId;
  if (!tenantId) return reply.status(400).send({ error: 'tenant required' });
  // persist
  const res = await query(
    'INSERT INTO responder_locations(responder_id, tenant_id, lat, lng, rssi, battery) VALUES($1,$2,$3,$4,$5,$6) RETURNING id, created_at',
    [responderId, tenantId, lat, lng, rssi, battery]
  );
  const row = res.rows[0];
  // broadcast to tenant room
  io.to(`tenant:${tenantId}`).emit('location', { responderId, lat, lng, rssi, battery, createdAt: row.created_at });
  return { ok: true };
});

app.get('/health', async (req, reply) => {
  return { ok: true };
});

server.listen(PORT, () => {
  app.log.info(`Server listening on ${PORT}`);
});
