# Theripo

An anonymous online therapy chat, built as a school project. Clients pick any name, describe what's on their mind, and wait for a therapist. Therapists sign in with a display name and a shared access code, see the waiting room, and chat in real time. Both sides can send photos and screenshots (up to 8 MB, or paste with Cmd/Ctrl+V), voice notes (recorded in the browser, up to 5 minutes) and videos (up to 30 MB).

## Run it

Needs Node.js 18+ and nothing else (no `npm install`).

```bash
npm start
```

Then open:

- http://localhost:3000 — landing page
- http://localhost:3000/client — client side
- http://localhost:3000/therapist — therapist dashboard (demo access code: `care2026`)

To try both sides at once, open the client page and the therapist page in two separate browser tabs.

## How it works

- `server.js` — plain Node HTTP server. Stores sessions in memory and pushes live updates with Server-Sent Events.
- `public/` — static pages (`index.html`, `client.html`, `therapist.html`), shared `styles.css` and `common.js`.

Everything is in memory, including shared files, so restarting the server wipes all conversations. Ended conversations and their files are also deleted an hour after they end. Files can only be opened by the client and therapist in that conversation. Change the access code with `THERAPIST_CODE=yourcode npm start`.

This is a demo and not a real mental-health service.
