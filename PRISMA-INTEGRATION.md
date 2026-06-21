# Prisma integration notes

Files added:
- src/prismaClient.js — exports `prisma` (PrismaClient) and `setTenant(tenantId)` which sets the app.current_tenant GUC for the session.

Next steps to finish integration:
1. Run `npm install` to install dependencies (including @prisma/client and prisma).
2. Run `npx prisma generate` to generate the client (or `npm run prisma:generate`).
3. Replace raw SQL calls in src/* with calls to the `prisma` client. Example:
   - `await prisma.responderLocation.create({ data: { responderId, tenantId, lat, lng, rssi, battery } })`
4. Add Prisma migrations (or convert the SQL migrations to Prisma Migrate format) if you prefer to use prisma migrate.

Notes:
- I've intentionally not replaced src/db.js yet to keep the running scaffold stable; this commit adds the Prisma client skeleton and package.json scripts so we can incrementally migrate the codebase.
- Let me know if you want me to continue and replace the src/db.js usages now (I can convert the queries in src/index.js to prisma calls).
