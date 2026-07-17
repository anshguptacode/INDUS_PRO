-- Digital Footprint Analyzer PRO — schema v2
-- Auto-applied on first boot via docker-entrypoint-initdb.d

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL,
    email         VARCHAR(255)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    timezone      VARCHAR(50)   NOT NULL DEFAULT 'Asia/Kolkata',
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- refresh-token rotation (revocable sessions)
CREATE TABLE refresh_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,      -- sha256 of the token
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens (user_id);

CREATE TABLE social_accounts (
    id               SERIAL PRIMARY KEY,
    user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform         VARCHAR(20) NOT NULL CHECK (platform IN ('twitter','instagram','github','mock')),
    handle           VARCHAR(100) NOT NULL,
    provider_user_id VARCHAR(100),
    -- AES-256-GCM ciphertext (iv:tag:data, hex) — never stored in plaintext
    access_token_enc  TEXT,
    refresh_token_enc TEXT,
    token_expires_at  TIMESTAMPTZ,
    scopes           TEXT,
    connected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at   TIMESTAMPTZ,
    sync_error       TEXT,
    UNIQUE (user_id, platform)
);

CREATE TABLE posts (
    id              SERIAL PRIMARY KEY,
    account_id      INT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    platform        VARCHAR(20)  NOT NULL,
    external_id     VARCHAR(64)  NOT NULL,
    content         TEXT         NOT NULL,
    topic           VARCHAR(50),
    hashtags        TEXT[],
    posted_at       TIMESTAMPTZ  NOT NULL,
    likes           INT NOT NULL DEFAULT 0,
    comments        INT NOT NULL DEFAULT 0,
    shares          INT NOT NULL DEFAULT 0,
    impressions     INT NOT NULL DEFAULT 0,
    engagement_rate NUMERIC(6,2),
    sentiment_label VARCHAR(10) CHECK (sentiment_label IN ('positive','neutral','negative')),
    sentiment_score NUMERIC(4,3),
    UNIQUE (platform, external_id)
);
CREATE INDEX idx_posts_posted_at ON posts (posted_at);
CREATE INDEX idx_posts_account   ON posts (account_id);

CREATE TABLE follower_history (
    id         SERIAL PRIMARY KEY,
    account_id INT  NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    snapshot   TIMESTAMPTZ NOT NULL DEFAULT now(),
    followers  INT  NOT NULL,
    following  INT  NOT NULL DEFAULT 0
);
CREATE INDEX idx_fh_account ON follower_history (account_id, snapshot);

CREATE TABLE insights (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    insight_type VARCHAR(40) NOT NULL,
    payload      JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_insights_user ON insights (user_id, insight_type, generated_at DESC);

CREATE TABLE predictions (
    id             SERIAL PRIMARY KEY,
    user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform       VARCHAR(20) NOT NULL,
    target_date    DATE NOT NULL,
    predicted_low  INT NOT NULL,
    predicted_high INT NOT NULL,
    confidence     NUMERIC(4,2) NOT NULL,
    model          VARCHAR(30) NOT NULL,
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit trail for background jobs (drives the sync-status UI)
CREATE TABLE sync_jobs (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id  INT REFERENCES social_accounts(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
    detail      JSONB,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX idx_sync_jobs_user ON sync_jobs (user_id, started_at DESC);
