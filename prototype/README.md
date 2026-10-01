# Dayflow

A voice-first task and status tracker: speak or type tasks, move them through five status levels, and copy your standup in one click. Built from the Dayflow PRD (v0.1). This is Phase 1, plus local previews of the Phase 2 and Phase 3 features.

## Run it

```bash
node serve.js          # then open http://localhost:5173
```

Any static server works. Voice input needs `http://localhost` or `https://`. It won't work from a `file://` path. On phones, host it over HTTPS (Vercel, Netlify or GitHub Pages).

## What's inside

| File | Purpose |
|---|---|
| `index.html` | Page structure, icon sprite, sheets and dialogs |
| `css/styles.css` | Design tokens (light and dark), 3D cards, responsive layout |
| `js/parser.js` | Understands typed and spoken input: status, priority, due dates, assignee, tags, blocked reason, "next task" splitting, Hinglish words, and commands like "mark X done" |
| `js/store.js` | State, localStorage, undo, activity history, focus timer, progress math |
| `js/scene3d.js` | Three.js "Day Orb": a progress ring, with each task as a moon that moves toward the core as its level rises |
| `js/app.js` | Rendering and interactions: drag and drop, touch swipe, keyboard, voice, standup, insights |
| `sw.js`, `manifest.webmanifest` | Works offline and can be installed as an app |

## Things to try

- Say: "Fix login crash urgent in progress **next task** send invoice by Friday assign to Priya **next task** design review blocked by missing specs"
- Say: "mark login crash as done", "start invoice", "pause timer", "undo"
- On a phone, swipe a card right to move it up a level, or left to move it back. Swipes skip Blocked, because blocking always asks for a reason.
- Press `?` to see all keyboard shortcuts.
