-- Runs once, on first container start, against the POSTGRES_DB/POSTGRES_USER
-- created from the postgres image's own env vars. Add extra databases/schemas here.
CREATE DATABASE idreesia_config_test WITH OWNER idreesia;
