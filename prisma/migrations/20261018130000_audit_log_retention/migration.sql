-- NUD-111: audit log retention. The trigger stays append-only with one narrow exception: a DELETE
-- is allowed inside a transaction that set `nudel.audit_retention = 'on'` (SET LOCAL / set_config
-- with is_local = true) AND only for rows older than 90 days, checked here against the database
-- clock so that the application cannot delete recent history even with the setting on. UPDATE is
-- refused always. CREATE OR REPLACE keeps the migration safe for a fresh and an existing database
-- (the trigger from 20261018120000_audit_log keeps pointing at this function by name).
CREATE OR REPLACE FUNCTION "audit_log_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('nudel.audit_retention', true) = 'on' THEN
    -- "createdAt" is a UTC timestamp without time zone.
    IF OLD."createdAt" < (timezone('UTC', now()) - interval '90 days') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'AuditLog retention may only delete entries older than 90 days';
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
