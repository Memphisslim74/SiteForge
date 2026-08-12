ALTER TABLE devices ADD COLUMN manufacturer TEXT;
ALTER TABLE devices ADD COLUMN cable_pulls INTEGER NOT NULL DEFAULT 0;

UPDATE devices
SET cable_type = 'Cat6'
WHERE device_type IN ('ap', 'camera', 'drop', 'access')
  AND (cable_type IS NULL OR TRIM(cable_type) = '');

UPDATE devices
SET cable_pulls = 1
WHERE device_type IN ('ap', 'camera', 'drop', 'access')
  AND cable_pulls = 0;
