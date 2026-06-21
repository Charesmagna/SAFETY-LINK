-- 01_init.sql
-- Minimal schema + RLS policies for tenant isolation

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone text UNIQUE NOT NULL,
  role text DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

-- Responders
CREATE TABLE IF NOT EXISTS responders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text,
  status text,
  created_at timestamptz DEFAULT now()
);

-- Responder locations
CREATE TABLE IF NOT EXISTS responder_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  responder_id uuid NOT NULL REFERENCES responders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  lat double precision,
  lng double precision,
  rssi integer,
  battery integer,
  created_at timestamptz DEFAULT now()
);

-- OTP sessions
CREATE TABLE IF NOT EXISTS otp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  tenant_id uuid,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS and tenant policies
ALTER TABLE responders ENABLE ROW LEVEL SECURITY;
ALTER TABLE responder_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- responders policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'tenant_isolation_responders'
  ) THEN
    EXECUTE $$
      CREATE POLICY tenant_isolation_responders ON responders
      FOR ALL USING (tenant_id = current_setting(''app.current_tenant'')::uuid)
    $$;
  END IF;

  -- responder_locations policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'tenant_isolation_responder_locations'
  ) THEN
    EXECUTE $$
      CREATE POLICY tenant_isolation_responder_locations ON responder_locations
      FOR ALL USING (tenant_id = current_setting(''app.current_tenant'')::uuid)
    $$;
  END IF;

  -- users policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'tenant_isolation_users'
  ) THEN
    EXECUTE $$
      CREATE POLICY tenant_isolation_users ON users
      FOR ALL USING (tenant_id = current_setting(''app.current_tenant'')::uuid)
    $$;
  END IF;
END$$;

-- NOTE: To use these policies you must set the GUC 'app.current_tenant' for your session.
-- Example (in SQL): SELECT set_config('app.current_tenant', '00000000-0000-0000-0000-000000000000', true);
