# Statement timeout and session settings

This repo's recommended stability improvements include setting a statement_timeout for database sessions to avoid long-running queries holding serverless function instances.

Recommended usage (run at session start or in your connection initialization):

```sql
-- milliseconds
SET statement_timeout = 5000;
-- optionally set lock timeout
SET lock_timeout = 2000;
```

Notes:
- In serverless environments you can set these per-request after obtaining the connection (e.g. run the SET statements at the top of your handler) or configure them in a pool/connection wrapper if available.
- Creating indexes with `CREATE INDEX CONCURRENTLY` avoids exclusive locks. Run the migration file with psql:

psql "$DATABASE_URL" -f migrations/001_add_indexes.sql

