ALTER TABLE participants ADD COLUMN x REAL NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE participants ADD COLUMN z REAL NOT NULL DEFAULT 2.3;
--> statement-breakpoint
UPDATE participants SET x=(seat % 5 - 2) * 1.5, z=2.3 + CAST(seat / 5 AS INTEGER) * 1.5;
