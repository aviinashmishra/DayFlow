-- Dayflow schema: organizations contain teams and people; people own tasks.
-- Idempotent: safe to run on every deploy with `npm run db:migrate`.
-- Databases created before organizations existed are upgraded in place (the "Upgrade" blocks).

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- The read model depends on tasks.*, so rebuild it at the end.
DROP VIEW IF EXISTS task_view;

-- Upgrade: the first version called the whole tenant a "team". It becomes the
-- organization, and every team_id column (which pointed at it) becomes org_id.
DO $$
BEGIN
  IF to_regclass('organizations') IS NULL AND to_regclass('teams') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'teams' AND column_name = 'invite_code') THEN
    ALTER TABLE teams RENAME TO organizations;
  END IF;
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['users', 'tasks', 'attachments', 'focus_sessions'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = tbl AND column_name = 'team_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = tbl AND column_name = 'org_id') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN team_id TO org_id', tbl);
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass(tbl) AND conname = tbl || '_team_id_fkey') THEN
        EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', tbl, tbl || '_team_id_fkey', tbl || '_org_id_fkey');
      END IF;
    END IF;
  END LOOP;
END $$;

DROP INDEX IF EXISTS users_team_idx;
DROP INDEX IF EXISTS tasks_team_active_idx;
DROP INDEX IF EXISTS tasks_team_done_idx;

-- ---------------------------------------------------------------- organizations & people
CREATE TABLE IF NOT EXISTS organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  invite_code  text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- 'personal': one person's own space (no teams yet). 'team': an organization with teams.
-- A personal space becomes a team workspace when its owner creates the first team.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'team' CHECK (kind IN ('personal', 'team'));

CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  email             text NOT NULL,
  password_hash     text NOT NULL,
  -- Organization role. Team leads are set per team in team_members.
  role              text NOT NULL DEFAULT 'member' CONSTRAINT users_role_check CHECK (role IN ('member', 'admin', 'owner')),
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  timer_task_id     uuid,
  timer_started_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS title text CHECK (char_length(title) <= 80);
-- Deactivated people cannot sign in or be assigned, but their history stays attributed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id);

-- Teams (departments) inside an organization. A person can be in several.
CREATE TABLE IF NOT EXISTS teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description  text CHECK (char_length(description) <= 300),
  color        text NOT NULL DEFAULT '#4f6cff' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_org_name_key ON teams (org_id, lower(name));

CREATE TABLE IF NOT EXISTS team_members (
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'lead')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members (user_id);

-- ---------------------------------------------------------------- tasks
CREATE TABLE IF NOT EXISTS tasks (
  id                  uuid PRIMARY KEY,
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title               text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  status              smallint NOT NULL DEFAULT 0 CHECK (status BETWEEN 0 AND 4),
  priority            text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  assignee_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  creator_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  due_date            date,
  tags                text[] NOT NULL DEFAULT '{}',
  project             text,
  blocked_reason      text,
  blocked_at          timestamptz,
  time_spent_seconds  integer NOT NULL DEFAULT 0,
  position            double precision NOT NULL DEFAULT 0,
  source              text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'voice')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  status_changed_at   timestamptz NOT NULL DEFAULT now(),
  done_at             timestamptz,
  archived_at         timestamptz,
  deleted_at          timestamptz
);
-- Detailed tasks: long description, remarks, and reference links ([{url, label}]).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description text CHECK (char_length(description) <= 5000);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remarks text CHECK (char_length(remarks) <= 2000);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;
-- The team a task belongs to (optional). Deleting a team keeps its tasks, without a team.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
-- Private tasks are visible only to their creator, never filed under a team, and assigned to nobody else.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('tasks') AND conname = 'tasks_private_no_team') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_private_no_team CHECK (NOT private OR team_id IS NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tasks_org_active_idx ON tasks (org_id) WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_org_done_idx ON tasks (org_id, done_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_team_idx ON tasks (team_id);

-- Files attached to a task. Stored in Postgres (small files only; the API caps size and count).
CREATE TABLE IF NOT EXISTS attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploader_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  mime         text NOT NULL,
  size         integer NOT NULL CHECK (size BETWEEN 0 AND 3145728),
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_task_idx ON attachments (task_id, created_at);

CREATE TABLE IF NOT EXISTS comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_task_idx ON comments (task_id, created_at);

-- Per-task history (status changes, edits, files, focus).
CREATE TABLE IF NOT EXISTS activity (
  id          bigserial PRIMARY KEY,
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  change      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_task_idx ON activity (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id     uuid REFERENCES tasks(id) ON DELETE SET NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  seconds     integer NOT NULL CHECK (seconds >= 0)
);
CREATE INDEX IF NOT EXISTS focus_user_idx ON focus_sessions (user_id, started_at);

-- ---------------------------------------------------------------- notifications & audit
-- In-app notifications: assigned to you, review requests, comments, mentions, blockers.
CREATE TABLE IF NOT EXISTS notifications (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL,
  task_id     uuid REFERENCES tasks(id) ON DELETE CASCADE,
  text        text NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- Organization-level audit trail: people, roles, teams, invites. Task history lives in activity.
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  detail      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_log (org_id, created_at DESC);

-- Upgrade (runs once): give existing work a home in the new structure.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = 'orgs-v1') THEN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    -- Every organization gets a General team with everyone in it; existing tasks move there.
    INSERT INTO teams (org_id, name, description)
      SELECT o.id, 'General', 'Everyone in the organization' FROM organizations o
      WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.org_id = o.id);
    INSERT INTO team_members (team_id, user_id, role)
      SELECT t.id, u.id, CASE WHEN u.role = 'lead' THEN 'lead' ELSE 'member' END
      FROM users u JOIN teams t ON t.org_id = u.org_id
      ON CONFLICT DO NOTHING;
    UPDATE tasks k SET team_id = t.id FROM teams t WHERE t.org_id = k.org_id AND k.team_id IS NULL;
    -- "lead" was an organization role; it now lives on the team membership above.
    UPDATE users SET role = 'member' WHERE role = 'lead';
    -- The earliest admin of each organization becomes its owner.
    UPDATE users u SET role = 'owner'
      FROM (SELECT DISTINCT ON (org_id) id FROM users WHERE role = 'admin' ORDER BY org_id, created_at) first
      WHERE u.id = first.id;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('member', 'admin', 'owner'));
    INSERT INTO schema_migrations (name) VALUES ('orgs-v1');
  END IF;
END $$;

-- Read model used by the API: dates as text, comment and attachment counts included.
CREATE VIEW task_view AS
SELECT t.*,
       t.due_date::text AS due,
       (SELECT count(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
       (SELECT count(*)::int FROM attachments a WHERE a.task_id = t.id) AS attachment_count
FROM tasks t;
