# Dayflow

A voice-first task management system for whole organizations. An organization contains teams (departments), and people can belong to several teams. It's built with Next.js 16, React 19 and Neon Postgres, and covers all three phases of the PRD: fast capture, team boards, a company dashboard, roles, notifications, reports and an audit log.

## Run it locally

Requirements: Node.js 20.9 or newer (22 LTS recommended).

```bash
npm install
npm run db:migrate     # creates the tables in the database in .env.local (safe to re-run)
npm run dev            # http://localhost:3000
```

For a production build: `npm run build && npm start`.

`.env.local` (gitignored) holds:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (the pooled one) |
| `AUTH_SECRET` | 32+ random characters used to sign session cookies |
| `GEMINI_API_KEY` | Optional. Lets Gemini sort a spoken story into separate tasks. Without it, voice uses the built-in parser only |
| `GEMINI_MODEL` | Optional. Defaults to `gemini-flash-latest` |

Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. `.env.example` shows the format.

## First use

**On your own.** Choose **Just me** when you sign up. You get a personal space with a few getting-started cards. Everything in it is private. When you want to work with others, pick **Create a team** (from the board, Settings, Insights, or the command palette):

1. Name the workspace and its first team.
2. Tick which of your tasks the team should see. The rest stay private.
3. Send the invite link. People who use it land straight in that team.

**As a team.** Choose **My team or company**, or open `/signup?mode=team`:

1. Open the app and **create an account**. That creates your organization and its first team. You become the owner and lead that team.
2. On **Organization → Teams**, create more teams (for example Design or Marketing) and add people to them. Make someone a **lead** to let them run that team.
3. On **Organization → People**, copy an invite link. You can pick the team the new person lands in. You can also set roles, job titles, and deactivate or reactivate accounts.
4. On the **Board**, use the **Team** switcher to view one team or all of them. New tasks go to the team you are viewing.
5. Speak or type tasks. Say "next task" between tasks to add several at once.
   - **Hands-free:** on a computer, once you have allowed the microphone, say **"Hey Dayflow"** followed by a task. When you pause, it is added. Saying "that's it" adds it straight away. It only listens while the tab is visible, and you can turn it off in Settings → Voice.
   - **Tell your day:** after "Hey Dayflow" (or the mic), describe what you did, what you're doing and what's next, for example: "I fixed the login crash and sent the invoice, now I'm on the pricing page, and tomorrow I need to call the vendor." Gemini splits it into separate tasks and files each one as Done, In progress, Blocked, Review or Queued. Work that is already on your board is moved instead of added again, so "I finished the login crash" moves that card to Done. A typed story works the same way, and one Undo reverts the whole story.
6. The **bell** shows notifications:
   - someone assigned you work or asked for your review;
   - someone @mentioned you or commented on your task;
   - a task in your team got blocked;
   - you were added to a team.
7. For a task that needs more detail, open **My tasks → New task** (or press **T**). You can add a description, remarks, links, file attachments and a first comment.
8. To export tasks, use **Export** on My tasks or on the board toolbar, or press **E**.
   - **Filters:** whose tasks, status, priority, due date (including a custom range), people, teams, projects, tags, keyword, and cleared done tasks.
   - **Layout:** pick the columns, grouping and sort order.
   - **Formats:**
     - **Excel:** a Summary dashboard; a styled Tasks sheet with a frozen header, filters or collapsible groups, and print setup; and a Links sheet.
     - **PDF:** a print-ready A4 report with charts. Choose "Save as PDF" in the print dialog.
     - **CSV:** plain data rows.
   - Exports are built in the browser from the tasks already loaded, so nothing extra is sent to the server. `exceljs` loads only when you export to Excel.
9. Press **Ctrl K** (⌘K on a Mac) to open the command palette. It finds any task, team or action. Type a sentence and press Enter to add it as a task.
10. Everyone has a **Personal** lane for **private tasks**. Pick "Personal (only you)" as the team on a task, or switch the board to Personal before adding. Moving a private task to a team shares it.

## Tests

```bash
npm test          # parser unit tests
npm run test:api  # full API test against a running server (npm start) and the real database
```

`test:api` creates throwaway organizations (`e2e+t40-…@dayflow.test`) and deletes them when it finishes. `npm run db:migrate` is idempotent: it only upgrades what is missing.

## Deploy (Vercel)

1. In Vercel, choose **Add New → Project** and import `aviinashmishra/DayFlow`. Vercel detects Next.js, so leave the build settings at their defaults.
2. Under **Environment Variables**, add `DATABASE_URL` and `AUTH_SECRET`, plus `GEMINI_API_KEY` for story mode. Use a new `AUTH_SECRET` for production, not the one in your `.env.local`.
3. Create the tables in the production database once, from your machine (it is safe to re-run):

   ```bash
   DATABASE_URL="postgresql://…production…" node scripts/migrate.mjs
   ```

   In PowerShell: `$env:DATABASE_URL="postgresql://…"; node scripts/migrate.mjs`
4. Deploy. Every push to `main` deploys to production, and other branches get preview URLs.

Voice input needs HTTPS, which Vercel provides.

## How it fits together

| Path | What it does |
|---|---|
| `db/schema.sql` | Tables: organizations (personal space or team workspace), users, teams, team_members, tasks (with team, private flag, description, remarks and links), comments, attachments, activity, focus_sessions, notifications, audit_log, and the `task_view` read model. Older databases are upgraded in place, once: the old "team" becomes the organization and everyone lands in a General team |
| `lib/access.ts` | Permission rules shared by the API (which enforces them) and the UI (which hides what you cannot do) |
| `lib/server/*` | Database client, sessions (JWT cookie with bcrypt passwords), request guards, task queries, people/teams/notifications/audit helpers |
| `app/api/*` | Route handlers: auth, board, tasks, comments, attachments, archive, timer, settings, organization, teams and members, people, notifications, audit log |
| `lib/parser.ts` | Understands voice and typed input: status, priority, dates, assignee, tags, blocked reason, Hinglish words, and commands like "mark X done" |
| `lib/voice.ts`, `components/hooks.ts` | The "Hey Dayflow" wake phrase, end-of-speech detection, and the check that sends a long story to Gemini (`lib/server/gemini.ts`) instead of the instant parser |
| `lib/client/store.ts` | Updates the screen instantly, then saves through a write queue kept on the device. Offline changes wait and sync when you're back. Undo is supported, and the board re-syncs every 15 s to show teammates' changes |
| `components/*` | The UI: 3D Day Orb (Three.js), board with team switcher, drag, swipe and keyboard, My tasks view, full new-task form, detail and settings sheets, Organization page (company dashboard, teams, people, audit log), notifications |
| `prototype/` | The original single-user HTML prototype, kept for reference. You can import its JSON export from Settings |

**Roles:**
- **Member:** adds, edits and comments on any task in the organization. Can delete or clear tasks they created or are assigned to.
- **Team lead** (set per team): also manages that team's members and can delete or clear any task in the team.
- **Admin:** also manages people, organization roles, teams, invites and the organization name, and can read the audit log.
- **Owner:** everything, including granting or removing the owner role.
- Nobody can change their own role. Admins cannot demote or deactivate an owner.
- Deactivated people cannot sign in or be assigned, but their history stays attributed to them.
- **Private tasks:**
  - Only the creator can see a private task, whatever their role. That includes owners and the audit log.
  - A private task has no team and cannot be assigned to anyone else.
  - Only the creator can make a task private.
  - In a personal space every task is private, and its invite code does not work until the owner creates a team.

**Security:**
- Every query is scoped to the signed-in user's organization.
- Inputs are validated with zod.
- Write requests must be JSON from the same origin, which blocks cross-site forgery.
- Session cookies are httpOnly and SameSite=Lax.
- Voice audio is turned into text by the browser. Only the text is stored.
- Hands-free mode never asks for the microphone by itself. It starts only after you have allowed it, and it stops while the tab is hidden. Nothing said before "Hey Dayflow" is kept.
- Story mode sends only the transcript text (plus today's date and teammates' names) to Gemini, through `/api/voice/classify`. That route requires a signed-in user and is rate limited. The key stays on the server.
- Attachments are stored in Postgres, up to 3 MB each and 20 per task. They are organization-scoped like everything else. Only PNG, JPEG, GIF, WebP and AVIF images are shown in the browser, under a sandbox policy. Every other file type is served as a download, so an uploaded file can never run script on the site.
- Links must be http(s).
