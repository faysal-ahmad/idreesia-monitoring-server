-- Runs once, on first container start, against the POSTGRES_DB/POSTGRES_USER
-- created from the postgres image's own env vars. Add extra databases/schemas here.
-- The vector extension lives in security_server (not public) so a connection
-- with search_path=security_server alone can resolve the vector type without
-- also needing public on the path.
CREATE SCHEMA IF NOT EXISTS security_server AUTHORIZATION idreesia;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA security_server;

CREATE DATABASE idreesia_config_test WITH OWNER idreesia;
\connect idreesia_config_test
CREATE SCHEMA IF NOT EXISTS security_server AUTHORIZATION idreesia;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA security_server;
