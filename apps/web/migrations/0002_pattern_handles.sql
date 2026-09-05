ALTER TABLE shared_patterns
  ADD COLUMN handle TEXT CHECK (handle IS NULL OR length(handle) BETWEEN 1 AND 24);
