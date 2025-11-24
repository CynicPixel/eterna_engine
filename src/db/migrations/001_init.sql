CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_wallet TEXT,
  token_in TEXT,
  token_out TEXT,
  amount_in NUMERIC,
  slippage NUMERIC,
  status TEXT,
  selected_dex TEXT,
  execution_price NUMERIC,
  tx_hash TEXT,
  failure_reason TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
