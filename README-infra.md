# SAFETY-LINK - infra & initial scaffold

This branch adds a minimal infra scaffold for Postgres, RLS policies, an OTP flow, a mock SMS adapter, and a Fastify-based HTTP + Socket.IO server.

What's included:
- docker-compose.yml (postgres + adminer)
- prisma/schema.prisma (data model)
- migrations/01_init.sql (DB create + RLS policies)
- src/* (minimal server, DB helper, OTP utils, SMS adapter)
- .env.example

Quickstart (local)
1. Copy .env.example to .env and adjust if needed.
2. Start DB: docker-compose up -d
   This will initialize the DB and load migrations/01_init.sql into Postgres.
3. Install dependencies:
   npm install fastify pg jsonwebtoken socket.io twilio
4. Run server:
   node src/index.js

Notes:
- RLS policies require that your session sets the GUC `app.current_tenant`. The server sets it for authenticated requests using `SELECT set_config('app.current_tenant', <tenant>, true)`.
- SMS provider defaults to `mock`. Configure TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM to use Twilio.

Next steps (follow-up PRs / issues):
- Add Prisma client generation and replace raw SQL access with Prisma
- Add tests and CI
- Add admin dashboard wiring to socket.io
- Add BLE parser library and cordova plugin glue
