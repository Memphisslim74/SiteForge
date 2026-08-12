ALTER TABLE devices ADD COLUMN pdf_page INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_devices_plan_page ON devices(plan_id, pdf_page);
