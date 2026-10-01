import 'server-only';
import { db } from './db';

interface Starter { title: string; description?: string; status: number; priority: 'high' | 'medium' | 'low'; tags: string[]; dueIn?: number }

// Each card teaches one thing by asking you to do it. They are private, so nobody else sees them.
const COMMON: Starter[] = [
  { title: 'Drag this card to In progress', description: 'On a phone, swipe it right. With a keyboard, focus it and press →.', status: 0, priority: 'high', tags: ['start'] },
  { title: 'Press Ctrl K (⌘K on a Mac) and type anything', description: 'The command palette jumps to any task, team or action. Type a sentence and press Enter to add it as a task.', status: 0, priority: 'medium', tags: ['start'] },
  { title: 'Add three tasks in one breath', description: 'Tap the mic and say: “Call the bank tomorrow next task Book dentist next task Pay rent by Friday urgent”.', status: 0, priority: 'medium', tags: ['start', 'voice'], dueIn: 1 },
  { title: 'Start a focus timer on a card', description: 'Press the Focus button on any card (or Space when it is focused). Dayflow chimes when the session ends.', status: 1, priority: 'low', tags: ['start'] }
];
const PERSONAL: Starter[] = [
  { title: 'Create a team when you are ready to share', description: 'Open the command palette and choose “Create a team”. Your private tasks stay private; you choose which ones to bring along.', status: 0, priority: 'low', tags: ['start'], dueIn: 7 }
];
const ORG: Starter[] = [
  { title: 'Invite your people', description: 'Organization → People → Copy invite link. You can pick the team each person lands in.', status: 0, priority: 'low', tags: ['start'], dueIn: 3 }
];
const DONE: Starter = { title: 'Create my Dayflow account', status: 4, priority: 'medium', tags: ['start'] };

/** Seeds the "getting started" cards for someone who just created a space or an organization. */
export async function seedStarterTasks(orgId: string, userId: string, kind: 'personal' | 'org') {
  const list = [...COMMON, ...(kind === 'personal' ? PERSONAL : ORG), DONE].map((t, i) => ({
    title: t.title, description: t.description ?? null, status: t.status, priority: t.priority, tags: t.tags, due_in: t.dueIn ?? null, pos: i
  }));
  await db()`
    INSERT INTO tasks (id, org_id, private, title, description, status, priority, creator_id, tags, position, due_date, done_at)
    SELECT gen_random_uuid(), ${orgId}, true, x.title, x.description, x.status, x.priority, ${userId}, x.tags, x.pos,
           CASE WHEN x.due_in IS NULL THEN NULL ELSE current_date + x.due_in END,
           CASE WHEN x.status = 4 THEN now() END
    FROM jsonb_to_recordset(${JSON.stringify(list)}::jsonb)
         AS x(title text, description text, status smallint, priority text, tags text[], due_in int, pos double precision)`;
}
