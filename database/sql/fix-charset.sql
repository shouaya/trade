-- Fix database charset and reseed strategies.

ALTER DATABASE trading CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DELETE FROM strategies WHERE id > 0;

INSERT INTO strategies (name, description, parameters) VALUES
('default', 'standard stop-loss and take-profit strategy', '{"stopLossPips": 50, "takeProfitPips": 100, "holdMinutes": 60}'),
('aggressive', 'short-term quick entry and exit strategy', '{"stopLossPips": 30, "takeProfitPips": 60, "holdMinutes": 30}'),
('conservative', 'long-hold strategy', '{"stopLossPips": 100, "takeProfitPips": 200, "holdMinutes": 240}');

SELECT * FROM strategies;
