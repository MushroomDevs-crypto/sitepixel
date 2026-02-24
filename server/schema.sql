CREATE TABLE IF NOT EXISTS pixels (
  x         SMALLINT NOT NULL,
  y         SMALLINT NOT NULL,
  owner     VARCHAR(44) NOT NULL,
  color     CHAR(7) NOT NULL DEFAULT '#ffffff',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (x, y)
);

CREATE INDEX IF NOT EXISTS idx_pixels_owner ON pixels(owner);

CREATE TABLE IF NOT EXISTS purchases (
  id            SERIAL PRIMARY KEY,
  wallet        VARCHAR(44) NOT NULL,
  tx_signature  VARCHAR(88) NOT NULL UNIQUE,
  pixel_count   INTEGER NOT NULL,
  token_amount  BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_wallet ON purchases(wallet);

CREATE TABLE IF NOT EXISTS purchase_pixels (
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  x           SMALLINT NOT NULL,
  y           SMALLINT NOT NULL,
  PRIMARY KEY (purchase_id, x, y)
);

CREATE TABLE IF NOT EXISTS media (
  id          SERIAL PRIMARY KEY,
  wallet      VARCHAR(44) NOT NULL,
  file_data   BYTEA NOT NULL,
  mime_type   VARCHAR(50) NOT NULL,
  x           SMALLINT NOT NULL,
  y           SMALLINT NOT NULL,
  width       SMALLINT NOT NULL,
  height      SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_wallet ON media(wallet);

CREATE TABLE IF NOT EXISTS link_buttons (
  id          SERIAL PRIMARY KEY,
  wallet      VARCHAR(44) NOT NULL,
  x           SMALLINT NOT NULL,
  y           SMALLINT NOT NULL,
  width       SMALLINT NOT NULL,
  height      SMALLINT NOT NULL,
  text        VARCHAR(60) NOT NULL,
  url         VARCHAR(2048) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_link_buttons_wallet ON link_buttons(wallet);
