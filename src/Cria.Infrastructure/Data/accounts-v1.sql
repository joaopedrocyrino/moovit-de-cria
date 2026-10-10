CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS addresses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    alias_key TEXT NOT NULL,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    UNIQUE(user_id, alias_key)
);
CREATE TABLE IF NOT EXISTS favorite_lines (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    line TEXT NOT NULL,
    line_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(user_id, mode, line_key)
);
CREATE TABLE usage_events (
    id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, visitor TEXT NOT NULL,
    session TEXT NOT NULL, name TEXT NOT NULL, occurred_at BIGINT NOT NULL,
    received_at BIGINT NOT NULL, properties JSONB NOT NULL
);
CREATE INDEX usage_time ON usage_events(received_at);
CREATE INDEX usage_name_time ON usage_events(name, occurred_at);
CREATE INDEX usage_session_time ON usage_events(session, occurred_at);
CREATE INDEX usage_visitor_time ON usage_events(visitor, occurred_at);
CREATE TABLE usage_revocations(visitor TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
