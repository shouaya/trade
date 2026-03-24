const KLINES_DDL = `
  CREATE TABLE IF NOT EXISTS klines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    open_time BIGINT NOT NULL,
    bid_open DECIMAL(20, 8) NOT NULL,
    bid_high DECIMAL(20, 8) NOT NULL,
    bid_low DECIMAL(20, 8) NOT NULL,
    bid_close DECIMAL(20, 8) NOT NULL,
    ask_open DECIMAL(20, 8) NOT NULL,
    ask_high DECIMAL(20, 8) NOT NULL,
    ask_low DECIMAL(20, 8) NOT NULL,
    ask_close DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(20, 8) DEFAULT 0,
    symbol VARCHAR(20) DEFAULT 'USDJPY',
    interval_type VARCHAR(10) DEFAULT '1m',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_kline (symbol, interval_type, open_time),
    INDEX idx_open_time (open_time),
    INDEX idx_symbol_time (symbol, open_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const REQUIRED_KLINE_COLUMNS = [
  ['bid_open', 'DECIMAL(20, 8) NULL AFTER open_time'],
  ['bid_high', 'DECIMAL(20, 8) NULL AFTER bid_open'],
  ['bid_low', 'DECIMAL(20, 8) NULL AFTER bid_high'],
  ['bid_close', 'DECIMAL(20, 8) NULL AFTER bid_low'],
  ['ask_open', 'DECIMAL(20, 8) NULL AFTER bid_close'],
  ['ask_high', 'DECIMAL(20, 8) NULL AFTER ask_open'],
  ['ask_low', 'DECIMAL(20, 8) NULL AFTER ask_high'],
  ['ask_close', 'DECIMAL(20, 8) NULL AFTER ask_low']
];

async function ensureKlineSchema(db) {
  for (const [name, ddl] of REQUIRED_KLINE_COLUMNS) {
    const [rows] = await db.query('SHOW COLUMNS FROM klines LIKE ?', [name]);

    if (rows.length === 0) {
      await db.query(`ALTER TABLE klines ADD COLUMN ${name} ${ddl}`);
      continue;
    }

    await db.query(`ALTER TABLE klines MODIFY COLUMN ${name} DECIMAL(20, 8) NULL`);
  }
}

module.exports = {
  KLINES_DDL,
  ensureKlineSchema
};
