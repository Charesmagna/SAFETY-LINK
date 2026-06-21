const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function setTenant(tenantId) {
  if (!tenantId) return;
  // Use a raw query to set the session GUC for RLS policies
  await prisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
}

module.exports = { prisma, setTenant };
