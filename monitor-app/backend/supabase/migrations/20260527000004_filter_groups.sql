-- filter_groups: user-defined custom status filter groups for the Diario view.
-- Accessed exclusively through the FastAPI backend (service_role bypasses RLS).
-- RLS is still enabled as defense in depth if PostgREST is ever exposed.

CREATE TABLE IF NOT EXISTS app.filter_groups (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 50),
  statuses   text[]      NOT NULL DEFAULT '{}',
  color      text        NOT NULL DEFAULT 'blue'
                         CHECK (color IN ('blue','green','orange','purple','red','teal','amber','pink','slate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.filter_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "filter_groups_own"
  ON app.filter_groups FOR ALL
  USING ((select auth.uid()) = user_id);

CREATE INDEX idx_filter_groups_user_id ON app.filter_groups (user_id);
