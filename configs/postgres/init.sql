-- Runs once, on first container start, against the POSTGRES_DB/POSTGRES_USER
-- created from the postgres image's own env vars. The schema itself has to
-- exist before Prisma Migrate can run against it (multiSchema doesn't manage
-- schema creation) — the vector extension inside it is owned by Prisma's init
-- migration instead, so it isn't created here.
CREATE SCHEMA IF NOT EXISTS security_server AUTHORIZATION idreesia;
