-- Add indicator columns to trades.

SET NAMES utf8mb4;

ALTER TABLE trades ADD COLUMN entry_rsi DECIMAL(5, 2) NULL COMMENT 'entry RSI' AFTER entry_index;
ALTER TABLE trades ADD COLUMN entry_macd DECIMAL(10, 5) NULL COMMENT 'entry MACD' AFTER entry_rsi;
ALTER TABLE trades ADD COLUMN entry_macd_signal DECIMAL(10, 5) NULL COMMENT 'entry MACD signal' AFTER entry_macd;
ALTER TABLE trades ADD COLUMN entry_macd_histogram DECIMAL(10, 5) NULL COMMENT 'entry MACD histogram' AFTER entry_macd_signal;

ALTER TABLE trades ADD COLUMN exit_rsi DECIMAL(5, 2) NULL COMMENT 'exit RSI' AFTER exit_price;
ALTER TABLE trades ADD COLUMN exit_macd DECIMAL(10, 5) NULL COMMENT 'exit MACD' AFTER exit_rsi;
ALTER TABLE trades ADD COLUMN exit_macd_signal DECIMAL(10, 5) NULL COMMENT 'exit MACD signal' AFTER exit_macd;
ALTER TABLE trades ADD COLUMN exit_macd_histogram DECIMAL(10, 5) NULL COMMENT 'exit MACD histogram' AFTER exit_macd_signal;

DESCRIBE trades;
