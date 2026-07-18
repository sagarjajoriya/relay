-- Stored generated column: Postgres recomputes the tsvector on every INSERT/
-- UPDATE of content, keeping search transactionally consistent with the data.
ALTER TABLE "messages"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;

CREATE INDEX "messages_search_vector_idx" ON "messages" USING GIN ("search_vector");
