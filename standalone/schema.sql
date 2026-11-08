-- Esquema Postgres de Noche Eterna para Neon.
-- Pégalo en el SQL Editor de Neon (o córrelo con psql $DATABASE_URL) una sola vez
-- al crear el proyecto. Es el equivalente Postgres de las tablas del juego:
-- cuentas con login, sesiones, personajes, inventario, registro y recargas.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  faction TEXT NOT NULL CHECK (faction IN ('vampiro', 'lobo')),
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  gold INTEGER NOT NULL DEFAULT 250,
  gems INTEGER NOT NULL DEFAULT 10,
  hp INTEGER NOT NULL DEFAULT 100,
  max_hp INTEGER NOT NULL DEFAULT 100,
  energy INTEGER NOT NULL DEFAULT 10,
  max_energy INTEGER NOT NULL DEFAULT 10,
  strength INTEGER NOT NULL DEFAULT 10,
  defense INTEGER NOT NULL DEFAULT 10,
  agility INTEGER NOT NULL DEFAULT 10,
  stamina INTEGER NOT NULL DEFAULT 10,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  hunts INTEGER NOT NULL DEFAULT 0,
  last_regen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  item_key TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  equipped INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS battle_log (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  result TEXT NOT NULL,
  gold_delta INTEGER NOT NULL DEFAULT 0,
  xp_delta INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recharges (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  pack_key TEXT NOT NULL,
  gems INTEGER NOT NULL,
  price_mxn INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_characters_user ON characters (user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory (character_id);
CREATE INDEX IF NOT EXISTS idx_battle_log_character ON battle_log (character_id);
CREATE INDEX IF NOT EXISTS idx_recharges_character ON recharges (character_id);
