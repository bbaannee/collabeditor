# Collab Editor — Build Log & Concepts

A running record of what's been built, why, and the core concepts behind each
piece. Written so you can come back in a week and still understand the whole
system.

---

## Project layout

```
collab-editor/
├── client/          React + TypeScript frontend (Vite)
├── server/          Node.js + Express + Socket.io backend
└── shared/
    └── types/       TypeScript types used by both client and server
```

`shared/types/index.ts` exists so the frontend and backend agree on the shape
of a `User`, `Document`, etc. without duplicating interfaces. Vite is
configured with a `@shared` alias so the client can `import type { User } from
'@shared/types'` even though that folder lives outside `client/`.

---

## Step 1 — User auth (register / login / JWT)

**Files:**
`server/src/routes/auth.ts`, `server/src/models/user.ts`,
`server/src/utils/jwt.ts`, `server/src/middleware/auth.ts`,
`server/src/db/migrate.ts`, `server/src/db/pool.ts`

### Concepts

**PostgreSQL + `pg` pool** — `pool.ts` creates a connection pool (a reusable
set of open DB connections) using `DATABASE_URL` from `.env`. Every model
function (`user.ts`, `document.ts`) runs parameterized SQL queries through
this pool (`$1`, `$2` placeholders — never string-concatenated SQL, which
prevents SQL injection).

**Migrations** — `migrate.ts` is a plain script that runs `CREATE TABLE IF NOT
EXISTS ...` to set up the database schema. It's a repeatable, version-controlled
way to build/change your DB structure instead of manually typing SQL into
`psql` every time. Run it with `npm run migrate` whenever the schema changes.

**Password hashing (`bcrypt`)** — passwords are never stored in plain text.
`bcrypt.hash(password, 10)` turns a password into a one-way hash (10 = "salt
rounds", a cost factor that makes brute-forcing slower). Login compares with
`bcrypt.compare(password, hash)` — you can never reverse a hash back to the
original password, only check if a given password produces the same hash.

**JWT (JSON Web Token)** — after a successful register/login, the server
signs a token (`jwt.ts`) containing `{ userId, email }`, signed with a secret
key (`JWT_SECRET`) so it can't be forged. The client stores this token and
sends it back on every request as `Authorization: Bearer <token>`.
`requireAuth` middleware (`middleware/auth.ts`) verifies that signature on
protected routes — no database lookup needed just to know "who is this
request from." This is what makes the API **stateless**: the server doesn't
need a session store. Tradeoff: a token can't be instantly revoked before it
expires (7 days here) without extra machinery like a token blocklist.

### Endpoints
- `POST /api/auth/register` — create account, returns `{ token, user }`
- `POST /api/auth/login` — verify credentials, returns `{ token, user }`
- `GET /api/auth/me` — (protected) returns the current user, used to restore
  a session on page load

---

## Step 2 — Frontend auth pages (React + TypeScript)

**Files:**
`client/src/context/AuthContext.tsx`, `client/src/api/client.ts`,
`client/src/components/ProtectedRoute.tsx`,
`client/src/pages/{Login,Register,Dashboard}Page.tsx`

### Concepts

**React Context for auth state** — `AuthContext` holds the current `user`
object and exposes `login`, `register`, `logout`. Any component can call
`useAuth()` to read/react to auth state without prop-drilling it through
every component.

**Token persistence** — on login/register, the JWT is saved to
`localStorage`. On app load, `AuthContext` calls `GET /api/auth/me` with
whatever token is in `localStorage` to check if it's still valid and restore
the session — this is why refreshing the page doesn't log you out.

**`apiRequest` fetch wrapper** (`api/client.ts`) — a small wrapper around
`fetch()` that automatically attaches the `Authorization` header from
`localStorage` and throws a typed `ApiError` on non-2xx responses, so every
API call site doesn't need to repeat that logic.

**`ProtectedRoute`** — a wrapper component that redirects to `/login` if
`user` is `null`. Used to gate `/` (dashboard) and `/documents/:id`.

**React Router** — client-side routing (`/login`, `/register`, `/`,
`/documents/:id`) without full page reloads.

---

## Step 3 — Documents: create, list, share link

**Files:**
`server/src/models/document.ts`, `server/src/routes/documents.ts`,
`client/src/api/documents.ts`, `client/src/pages/{Dashboard,Document}Page.tsx`

### Concepts

**Ownership model (for now)** — every document has an `owner_id`. Listing
(`GET /api/documents`) only returns documents *you* own. But fetching a
single document by id (`GET /api/documents/:id`) works for **any** logged-in
user who has the link — the document's UUID itself acts as an unguessable
"share key." This is intentionally simple for now; **Step 7** will replace it
with real owner/editor/viewer roles stored in a permissions table.

**Why UUIDs instead of sequential IDs** — `gen_random_uuid()` (Postgres) gives
each document an id like `bc57ef6b-570e-...` instead of `1`, `2`, `3`. You
can't guess another document's id by incrementing a number, which is what
makes "share by link" safe even before proper permissions exist.

---

## Step 4 — Real-time collaborative editing (Monaco + Y.js + Socket.io)

**Files:**
`server/src/socket.ts`, `server/src/collab/documentRooms.ts`,
`client/src/collab/useCollaborativeDoc.ts`, `client/src/pages/DocumentPage.tsx`

This is the core of the whole project — the part that makes it "Google Docs
style" instead of just a form that saves on submit.

### Concepts

**CRDT (Conflict-free Replicated Data Type) — the `Y.Doc`** — the hard
problem in collaborative editing is: what happens when two people type in the
same spot at the same time? A CRDT is a data structure specifically designed
so that concurrent edits from multiple sources can always be merged back
together automatically, deterministically, without conflicts — no "merge
conflict" dialog like Git. **Y.js** is the CRDT library used here. Both the
client and server keep a `Y.Doc` (a Y.js document) representing the text
content; when either side changes it, that change is encoded as a small
binary "update," and applying the same updates in any order on any copy
always converges to the same final text.

**Socket.io — the transport** — WebSockets keep a persistent, two-way
connection open between browser and server (unlike normal HTTP
request/response). Socket.io wraps raw WebSockets with automatic
reconnection, and a "rooms" concept (`socket.join('document:<id>')`) so you
can broadcast a message to everyone viewing one specific document without
manually tracking who's connected to what.

---

### Deep dive: how a keystroke actually travels, with code

There are really only **three moving parts**: a `Y.Doc` living in each
browser tab, one `Y.Doc` living on the server per open document, and Socket.io
carrying small binary "update" messages between them. Everything else is
plumbing around those three things. Walking through one keystroke end to end:

#### 1. Monaco fires a change → `y-monaco` turns it into a Y.js update

You never write the code that listens to Monaco's `onDidChangeModelContent`
yourself — that's what the `y-monaco` library does internally. All you do is
wire it up once, in `DocumentPage.tsx`:

```tsx
// client/src/pages/DocumentPage.tsx
const handleEditorMount: OnMount = (editorInstance, monaco) => {
  if (!ydoc) return;
  const model = editorInstance.getModel();
  if (!model) return;

  const ytext = ydoc.getText('content');       // a shared Y.js text type
  bindingRef.current = new MonacoBinding(
    ytext,                                     // the CRDT text to bind
    model,                                     // Monaco's text model
    new Set([editorInstance]),                 // which editor instance(s) to keep in sync
    undefined                                  // awareness — wired up in Step 5
  );
};
```

From this point on, `MonacoBinding` is a two-way bridge: keystrokes in Monaco
turn into `ytext.insert(...)` / `ytext.delete(...)` calls, and any change
made to `ytext` from *outside* Monaco (i.e. from the network) gets rendered
back into the editor. You never call `ytext.insert` yourself.

#### 2. The local `Y.Doc` fires an `update` event → sent over the socket

Every `Y.Doc` emits an `'update'` event whenever *any* shared type inside it
changes, regardless of what caused the change. `useCollaborativeDoc.ts`
listens for that and forwards it to the server:

```ts
// client/src/collab/useCollaborativeDoc.ts
doc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin === 'remote') return;   // see "origin tagging" below
  const base64 = btoa(String.fromCharCode(...update));
  s.emit('update', documentId, base64);
});
```

`update` here is not "the new full text" — it's a small, efficient binary
diff (a few dozen bytes for a single keystroke), encoded by Y.js. Socket.io
can't send raw binary cleanly through a JSON-friendly event payload in this
setup, so it's base64-encoded into a string first.

#### 3. The server applies it to its own copy, then rebroadcasts

```ts
// server/src/socket.ts
socket.on('update', (documentId: string, updateBase64: string) => {
  if (documentId !== joinedDocumentId) return;
  const update = new Uint8Array(Buffer.from(updateBase64, 'base64'));
  applyUpdate(documentId, update);                      // apply to server's Y.Doc
  socket.to(roomName(documentId)).emit('update', updateBase64); // fan out to everyone else
});
```

`socket.to(room)` — not `io.to(room)` — is deliberate: it broadcasts to every
*other* socket in the room, excluding the sender. The sender already has the
change (it made it locally), so echoing it back would be wasted bandwidth at
best.

`applyUpdate` (in `documentRooms.ts`) is where the server keeps its own
authoritative `Y.Doc` per document up to date:

```ts
// server/src/collab/documentRooms.ts
export function applyUpdate(documentId: string, update: Uint8Array) {
  const room = rooms.get(documentId);
  if (!room) return;
  Y.applyUpdate(room.ydoc, update);
  scheduleSave(documentId, room);   // debounced Postgres write, see below
}
```

**Why the server keeps its own live `Y.Doc` at all**, instead of being a dumb
relay that just forwards messages between clients: a brand-new person joining
mid-session needs to be caught up instantly, without replaying every
keystroke that happened before they arrived. Because Y.js can serialize an
entire document's current state as one blob:

```ts
// server/src/socket.ts — on join
const ydoc = await joinRoom(documentId);
const state = Y.encodeStateAsUpdate(ydoc);      // one full snapshot, not a log of edits
ack?.({ state: Buffer.from(state).toString('base64') });
```

...the server just hands the joiner one snapshot. On the client:

```ts
// client/src/collab/useCollaborativeDoc.ts
s.emit('join-document', documentId, (ack: JoinAck) => {
  if (ack.state) {
    const update = Uint8Array.from(atob(ack.state), (c) => c.charCodeAt(0));
    Y.applyUpdate(doc, update, 'remote');   // "load" the whole doc in one shot
  }
  setIsSynced(true);
});
```

#### 4. Origin tagging — how the echo loop is avoided

If a client just blindly re-emitted every `update` event on its `Y.Doc`
regardless of where that update came from, you'd get an infinite loop: server
sends you an update → you apply it → your `Y.Doc` fires `'update'` → you send
it right back to the server → server rebroadcasts it → ... forever. Y.js
solves this generically: `Y.applyUpdate(doc, update, origin)` takes an
optional third argument, and that same value shows up as the second argument
of the `'update'` event. So every place an update arrives *from the network*
is tagged:

```ts
Y.applyUpdate(doc, update, 'remote');
```

and the outgoing listener checks for exactly that tag before deciding to
transmit:

```ts
doc.on('update', (update, origin) => {
  if (origin === 'remote') return;   // this change came from the network — don't re-send it
  // ...only genuinely local edits reach this point
});
```

Anything typed directly into Monaco has no origin tag (`undefined`), so it
always passes this check and gets sent — only network-sourced updates are
suppressed from being re-sent.

#### 5. Persistence — bridging the in-memory CRDT to Postgres

Y.js's `Y.Doc` lives entirely in server RAM; it is not itself durable
storage. If the Node process restarts, every in-memory `Y.Doc` is gone. The
bridge back to Postgres is a debounce timer:

```ts
// server/src/collab/documentRooms.ts
const SAVE_DEBOUNCE_MS = 1500;

function scheduleSave(documentId: string, room: Room) {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(async () => {
    const content = room.ydoc.getText('content').toString();
    await pool.query(
      'UPDATE documents SET content = $1, updated_at = now() WHERE id = $2',
      [content, documentId]
    );
  }, SAVE_DEBOUNCE_MS);
}
```

Every incoming update resets the timer, so a burst of fast typing produces
one write 1.5 seconds after the person *stops*, not one write per keystroke
(which would hammer Postgres). `ydoc.getText('content').toString()` collapses
the CRDT back down to a plain string — Postgres only ever sees the final
text, never Y.js's internal structure.

That same `content` column is also what **seeds** a document's `Y.Doc` the
first time it's opened after being cold (no one has it in memory yet):

```ts
// server/src/collab/documentRooms.ts
async function loadOrCreateRoom(documentId: string): Promise<Room | null> {
  const existing = rooms.get(documentId);
  if (existing) return existing;

  const doc = await findDocumentById(documentId);   // read the Postgres row
  if (!doc) return null;

  const ydoc = new Y.Doc();
  if (doc.content) {
    ydoc.getText('content').insert(0, doc.content); // bootstrap CRDT from saved plain text
  }
  // ...
}
```

And when the *last* person leaves a document, the room flushes immediately
(rather than waiting out the debounce) and frees the memory:

```ts
// server/src/collab/documentRooms.ts
export function leaveRoom(documentId: string) {
  const room = rooms.get(documentId);
  if (!room) return;
  room.connectionCount = Math.max(0, room.connectionCount - 1);

  if (room.connectionCount === 0) {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    const content = room.ydoc.getText('content').toString();
    pool.query('UPDATE documents SET content = $1, updated_at = now() WHERE id = $2',
      [content, documentId]
    ).finally(() => {
      room.ydoc.destroy();
      rooms.delete(documentId);   // free memory — nobody's watching anymore
    });
  }
}
```

#### 6. A subtle React bug this design avoids

React Router reuses the same `DocumentPage` component **instance** when you
navigate from `/documents/A` to `/documents/B` — it does not unmount and
remount just because a route *parameter* changed. If the collaboration hook
naively created one `Y.Doc` with `useRef` and reused it forever, navigating
between two different documents would leave document B's editor polluted
with document A's leftover content and CRDT history. The fix is that the
hook's effect re-runs on every `documentId` change and constructs a
completely fresh `Y.Doc` and socket connection each time, tearing the old
ones down in the cleanup function:

```ts
// client/src/collab/useCollaborativeDoc.ts
useEffect(() => {
  if (!documentId) return;

  // A fresh Y.Doc per document — React Router reuses this component
  // instance across param changes, so we must not carry state between docs.
  const doc = new Y.Doc();
  const s = io(API_BASE_URL, { auth: { token } });
  // ...set up listeners, join room...

  return () => {
    s.disconnect();
    doc.destroy();
  };
}, [documentId]);
```

### Summary of the full round trip

```
 Browser A (Monaco)                Server (Node)                 Browser B (Monaco)
 ───────────────────               ───────────────               ───────────────────
 keystroke
   → y-monaco writes to ytext
   → Y.Doc "update" event
   → socket.emit('update', ...)  ──────▶ socket.on('update', ...)
                                          → Y.applyUpdate(serverYdoc)
                                          → scheduleSave() [Postgres, debounced]
                                          → socket.to(room).emit('update', ...) ──▶ socket.on('update', ...)
                                                                                     → Y.applyUpdate(doc, update, 'remote')
                                                                                     → Y.Doc "update" event (origin='remote', not re-sent)
                                                                                     → y-monaco renders it into the editor
```

### Dependency gotchas hit while building this (recorded so you know why the
versions are pinned the way they are)
- `y-monaco` (the library binding Y.js to the Monaco editor) requires
  `y-protocols` and `monaco-editor` as peer dependencies — they don't get
  installed automatically and must be added explicitly.
- `monaco-editor@0.56+` ships a strict `"exports"` field in its
  `package.json` that blocks the specific deep import path (`monaco-editor/
  esm/vs/editor/editor.api.js`) that `y-monaco` needs internally. The fix was
  pinning `monaco-editor@0.45.0`, an earlier version without that
  restriction. If you ever run `npm update` and the editor breaks with a
  "Failed to resolve import" error, this is almost certainly why.

### What's still a placeholder (before Step 5)
- Presence list ("who's online") — **Step 6**, likely built on the same
  Awareness mechanism as Step 5 below.
- Version history — **Step 6/7**.
- Real owner/editor/viewer permissions — **Step 7**, replacing today's
  "anyone with the link can edit" behavior.

---

## Step 5 — Cursor presence (colored cursors with names)

**Files:**
`server/src/collab/documentRooms.ts`, `server/src/socket.ts`,
`client/src/collab/useCollaborativeDoc.ts`,
`client/src/collab/remoteCursorStyles.ts`, `client/src/collab/userColor.ts`

### Concepts

**`Awareness` — Y.js's *other* shared state mechanism.** Everything in Step 4
(`Y.Doc`, `ytext`) is durable, persisted content — the actual document text.
Cursor position, text selection, and "who's currently connected" are the
opposite: **ephemeral** state that should vanish the instant someone
disconnects and should never be written to Postgres. Y.js ships a companion
library, `y-protocols/awareness`, purpose-built for exactly this. An
`Awareness` instance is tied to a `Y.Doc` and holds a small JSON blob per
connected client (keyed by that client's random numeric id), e.g.
`{ user: { name: 'Bane UI', color: '#81c784' }, cursor: {...} }`. Like a
`Y.Doc`, it fires an `'update'` event with `{ added, updated, removed }`
client-id arrays whenever any of that shared state changes.

**Same transport, parallel channel.** Cursor updates travel over the exact
same Socket.io connection as text updates, just as a separate event name
(`'awareness-update'` instead of `'update'`), and follow the identical
shape of logic: encode a binary update, send it, apply it on the other side,
rebroadcast:

```ts
// client/src/collab/useCollaborativeDoc.ts
localAwareness.on('update', ({ added, updated, removed }, origin) => {
  if (origin === 'remote') return;   // same echo-prevention pattern as Step 4
  const changedClientIds = added.concat(updated, removed);
  const update = encodeAwarenessUpdate(localAwareness, changedClientIds);
  s.emit('awareness-update', documentId, encodeBase64(update));
});
```

**One room-level listener, not one per connection.** For the `Y.Doc` in Step
4, the server applies an incoming update and then explicitly rebroadcasts it
(`socket.to(room).emit(...)`) inside the `'update'` handler. Awareness takes
a cleaner shape: a *single* listener is attached once, when the room's
`Awareness` instance is first created — not per socket connection — and it
handles broadcasting for every future change regardless of who triggered it:

```ts
// server/src/collab/documentRooms.ts — set up once per document room
awareness.on('update', ({ added, updated, removed }) => {
  const changedClientIds = added.concat(updated, removed);
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClientIds);
  ioRef?.to(roomChannel(documentId)).emit('awareness-update', Buffer.from(update).toString('base64'));
});
```

This works because `Awareness` state is small and idempotent to re-receive —
unlike the `Y.Doc` case, there's no benefit to excluding the sender from the
broadcast, so the code is simpler for no real cost.

**Catching up a new joiner.** Exactly like the `Y.Doc` state snapshot, a
client joining mid-session needs the *current* cursor positions of everyone
already there, not just future changes:

```ts
// server/src/socket.ts — inside join-document
const awarenessStates = room.awareness.getStates();
const awarenessUpdate = awarenessStates.size > 0
  ? awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()))
  : null;

ack?.({ state: ..., awareness: awarenessUpdate ? Buffer.from(awarenessUpdate).toString('base64') : null });
```

**Cleanup on disconnect.** Unlike document text (which should obviously
persist after someone leaves), a stale cursor left behind forever would be
confusing. The client tells the server its `Awareness` client id at join
time; if that socket disconnects, the server explicitly removes just that
client's awareness state and the room's listener (above) automatically
broadcasts the removal to everyone else:

```ts
// server/src/socket.ts
socket.on('disconnect', () => {
  if (joinedDocumentId) {
    if (awarenessClientId !== null) {
      removeAwarenessClient(joinedDocumentId, awarenessClientId);
    }
    leaveRoom(joinedDocumentId);
  }
});
```

Note: this only fires promptly for a *clean* disconnect (navigating away in
the app, closing the browser normally). An abrupt crash/network drop is only
detected once Socket.io's heartbeat (ping/pong) times out — by default this
can take up to ~20-45 seconds, during which a "ghost" cursor may briefly
remain visible to others. This is standard, expected WebSocket behavior, not
a bug in this app.

**`y-monaco` renders the cursor decorations — but not their colors.** The
`MonacoBinding` from Step 4 already knows how to read/write `Awareness`; once
you pass an `Awareness` instance as its 4th constructor argument, it
automatically tracks your local text selection into `awareness.setLocalStateField('cursor', ...)`
and, for every *other* client's awareness state, creates a Monaco decoration
tagged with CSS classes like `yRemoteSelection-<clientId>` and
`yRemoteSelectionHead-<clientId>`:

```tsx
// client/src/pages/DocumentPage.tsx
bindingRef.current = new MonacoBinding(
  ytext,
  model,
  new Set([editorInstance]),
  awareness   // ← this one extra argument is most of what "adds" cursor sync
);
```

What `y-monaco` deliberately does **not** do is style those classes — no
color, no name label. That part is left entirely to the app (this is the same
pattern used by `y-codemirror` and `y-prosemirror` in the wider Y.js
ecosystem). Without additional CSS, remote cursors are technically
synchronized but **invisible**. `remoteCursorStyles.ts` fixes this by
watching `awareness.on('change', ...)` and regenerating a `<style>` tag with
one CSS rule block per connected remote client, using that client's own
`user.color` / `user.name` fields to color the selection highlight and render
a small name-tag flag above the cursor via a CSS `::after { content: "..." }`
pseudo-element:

```ts
// client/src/collab/remoteCursorStyles.ts
rules.push(`
  .yRemoteSelection-${clientId} { background-color: ${color}40; }
  .yRemoteSelectionHead-${clientId} { border-left: 2px solid ${color}; }
  .yRemoteSelectionHead-${clientId}::after {
    content: "${name}";
    background-color: ${color};
    /* ...positioned as a small flag above the cursor */
  }
`);
```

**Assigning each user a stable color.** Rather than a random color every
time someone connects (which would make the same person look like a
different collaborator on every reload), `userColor.ts` hashes the user's
database id into one of a fixed palette — the same person always renders in
the same color:

```ts
// client/src/collab/userColor.ts
export function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
```

### A bug fixed along the way (unrelated to cursors, found while testing)

While restarting the dev server mid-testing, `AuthContext`'s startup
`GET /api/auth/me` check happened to race against the API server still
coming back up, hit a network error, and — because the original code treated
*any* failure the same as "token rejected" — silently deleted a perfectly
valid JWT from `localStorage`, logging the user out for no real reason.
Fixed by only clearing the token on an actual `401` response:

```ts
// client/src/context/AuthContext.tsx
.catch((err) => {
  if (err instanceof ApiError && err.status === 401) {
    localStorage.removeItem('token');
  }
})
```

---

## Step 6 — Online presence ("who's here")

**Files:**
`client/src/collab/usePresence.ts`, `client/src/components/PresenceAvatars.tsx`,
`client/src/pages/DocumentPage.tsx`

### Concepts

**No new sync mechanism — this is a pure UI layer on top of Step 5.** The
entire reason this step is small is that "who's currently in the document"
and "where is everyone's cursor" are **the same underlying data** — the
`Awareness` states from Step 5 already contain every connected client's
`{ user: { name, color } }`. Step 5 rendered that data as cursor decorations
inside Monaco; Step 6 just reads the exact same `Awareness` instance and
renders it as a row of avatar chips instead:

```ts
// client/src/collab/usePresence.ts
awareness.getStates().forEach((state, clientId) => {
  const user = state.user as AwareUser | undefined;
  if (!user) return;
  list.push({
    clientId,
    name: user.name || 'Anonymous',
    color: user.color || '#888888',
    isLocal: clientId === awareness.doc.clientID,
  });
});
```

`usePresence` is a thin React hook wrapper: it subscribes to the same
`awareness.on('change', ...)` event used in `remoteCursorStyles.ts`, and
turns the current states into a plain array any component can render —
sorted so the local user (you) always appears first.

**Why this includes yourself, not just remote users.** Unlike
`remoteCursorStyles.ts` (which explicitly skips `clientId === awareness.doc.clientID`
because you don't need a cursor decoration for your *own* cursor), a
presence list should show everyone including you — "3 people here" naturally
includes yourself. `PresenceAvatars.tsx` renders your own chip with a
"(you)" tooltip rather than hiding it.

**Rendering:** a small stack of circular initials-avatars, colored using the
same `user.color` set back in Step 5's `useCollaborativeDoc.ts`, overlapping
slightly (`margin-left: -8px`) the way most collaborative apps (Google Docs,
Figma, Notion) show presence:

```tsx
// client/src/components/PresenceAvatars.tsx
<div className="presence-avatar" style={{ backgroundColor: u.color }}
     title={u.isLocal ? `${u.name} (you)` : u.name}>
  {initials(u.name)}
</div>
```

Because it's driven by the same live `Awareness` subscription as the
cursors, the avatar row updates in real time with zero extra network
traffic — someone joining or leaving updates both the cursors *and* the
avatar row from the same event.

---

## Step 6 — Document version history

**Files:**
`server/src/models/documentVersion.ts`, `server/src/collab/documentRooms.ts`,
`server/src/routes/documents.ts` (versions section),
`client/src/components/VersionHistoryPanel.tsx`

### Concepts

**Two ways a version gets created.** A `document_versions` table stores
independent full-text snapshots (id, document_id, content, created_by,
created_at) — deliberately full copies, not diffs, since diff-based history
adds real complexity (computing/storing/replaying patches) for a feature
whose whole job here is "let me see and go back to an earlier draft," which
full snapshots do perfectly well for a project this size.

1. **Automatic, throttled snapshots.** Every time the debounced content-save
   from Step 4 fires, it also asks "has it been more than 5 minutes since the
   last snapshot for this document?" — if so, it saves one:

   ```ts
   // server/src/collab/documentRooms.ts
   async function maybeSnapshotVersion(documentId: string, content: string) {
     const lastSnapshotAt = await getLatestVersionTimestamp(documentId);
     const dueForSnapshot =
       !lastSnapshotAt ||
       Date.now() - lastSnapshotAt.getTime() > VERSION_SNAPSHOT_INTERVAL_MS;
     if (dueForSnapshot) {
       await createVersion(documentId, content, null);
     }
   }
   ```

   The throttle exists because the debounced save itself already fires
   roughly every 1.5 seconds of active typing — without a time gate, a
   single editing session would produce hundreds of near-duplicate version
   rows. `created_by` is `null` for these because, in a real-time
   multi-editor document, there usually isn't one single person to credit for
   "the state of the document at this exact 5-minute mark."

2. **Manual snapshots**, via an explicit "Save current version" button —
   these *do* have a clear author (whoever clicked it), no time-gating, and
   go through a dedicated endpoint: `POST /api/documents/:id/versions`.

**The harder problem: restoring a version while people are actively
editing.** The naive approach — just `UPDATE documents SET content = ...` in
Postgres — would work, but wouldn't show up for anyone with the document
currently open (they have their own in-memory `Y.Doc`, unaware the database
changed underneath it), and worse, their very next keystroke's debounced save
would silently overwrite the restore a few seconds later. The real fix has
to go through the same CRDT the live editors are using:

```ts
// server/src/collab/documentRooms.ts
export function restoreContent(documentId: string, content: string): boolean {
  const room = rooms.get(documentId);
  if (!room) return false;   // nobody has it open — fall back to a plain DB write
  const ytext = room.ydoc.getText('content');
  room.ydoc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, content);
  });
  return true;
}
```

This is exactly why Step 4's document-update broadcasting needed a refactor
first (see below) — `restoreContent` mutates the server's `Y.Doc` directly,
with no socket message triggering it, so the broadcast has to happen as a
side effect of the `Y.Doc` changing, not as something `socket.ts` explicitly
does after receiving a message.

### A refactor this step required: centralizing the update broadcast

Back in Step 4, broadcasting a text update was explicit and lived in
`socket.ts` — it only happened as a direct reaction to receiving a client's
`'update'` socket event:

```ts
// server/src/socket.ts — OLD, Step 4
socket.on('update', (documentId, updateBase64) => {
  applyUpdate(documentId, update);
  socket.to(roomChannel(documentId)).emit('update', updateBase64); // manual, per-message
});
```

That only covers changes that arrive *from a client*. Restoring a version is
a change the *server* makes on its own initiative — there's no incoming
socket message to hook the broadcast onto. The fix mirrors the pattern
already used for `Awareness` in Step 5: attach **one listener per room**,
directly on the `Y.Doc` itself, that broadcasts *any* change regardless of
its source:

```ts
// server/src/collab/documentRooms.ts — NEW
ydoc.on('update', (update: Uint8Array) => {
  ioRef?.to(roomChannel(documentId)).emit('update', Buffer.from(update).toString('base64'));
  scheduleSave(documentId, room);
});
```

`socket.ts`'s handler shrinks to just applying the incoming update — the
`Y.Doc`'s own listener now takes care of both broadcasting *and* scheduling
the Postgres save, regardless of whether the update came from a keystroke or
a server-side restore:

```ts
// server/src/socket.ts — NEW
socket.on('update', (documentId, updateBase64) => {
  if (role !== 'owner' && role !== 'editor') return; // see Step 7 below
  applyUpdate(documentId, update); // triggers the ydoc's own 'update' listener above
});
```

---

## Step 7 — Permissions (owner / editor / viewer)

**Files:**
`server/src/models/document.ts` (role/collaborator functions),
`server/src/socket.ts`, `server/src/routes/documents.ts`,
`client/src/components/ShareDialog.tsx`, `client/src/pages/DocumentPage.tsx`

### Concepts

**Two independent sources of access**, combined into one "effective role"
per request. Before this step, *any* logged-in user with a document's link
could fully edit it — the UUID alone was the only gate. Real access control
needed two new pieces:

1. **`documents.link_access`** — what the link itself grants to someone with
   no other relationship to the document: `'editor'`, `'viewer'`, or
   `'restricted'` (link alone grants nothing).
2. **`document_collaborators`** — an explicit table of
   `(document_id, user_id, role)` rows, for people the owner has specifically
   invited by email, which can override what the link alone would grant
   (e.g. inviting someone as `'viewer'` even while the link itself is set to
   `'editor'` for everyone else).

Resolving these into one answer — "what can *this* user actually do with
*this* document" — happens in one place, checked in priority order: owner
beats explicit collaborator beats link default:

```ts
// server/src/models/document.ts
export async function getEffectiveRole(documentId, userId): Promise<DocumentRole | null> {
  const doc = await findDocumentById(documentId);
  if (!doc) return null;
  if (doc.owner_id === userId) return 'owner';

  const collaborator = await pool.query(
    'SELECT role FROM document_collaborators WHERE document_id = $1 AND user_id = $2',
    [documentId, userId]
  );
  if (collaborator.rows[0]) return collaborator.rows[0].role;

  if (doc.link_access === 'restricted') return null;
  return doc.link_access;
}
```

**Enforcement happens in two separate places, deliberately.** A viewer
should be able to *open* a document (see live content and cursors) but never
successfully *write* to it. That means the check can't live only on the HTTP
route that fetches the document — the actual danger is the WebSocket path,
since that's how edits happen:

```ts
// server/src/socket.ts — join-document
role = await getEffectiveRole(payload.documentId, socket.user!.userId);
if (!role) {
  return ack?.({ error: 'You do not have access to this document' });
}
// ...role is sent back in the join ack, and also remembered on this connection

// server/src/socket.ts — update
socket.on('update', (documentId, updateBase64) => {
  if (role !== 'owner' && role !== 'editor') return; // viewer's edit is silently dropped
  applyUpdate(documentId, update);
});
```

This was verified directly (not just assumed correct): a small throwaway
script logged in as a `'viewer'`-role user, joined the document's socket,
and deliberately tried to push a malicious edit. The server accepted the
join (confirming `role: 'viewer'` in the ack) but the edit never reached the
document — proving the check actually holds under a real Socket.io
connection, not just in the HTTP API. The equivalent HTTP-side checks (a
viewer can't hit `POST /:id/versions`, can't see `/permissions`, etc.) were
verified the same way, with `curl` calls returning `403` as expected.

**Why enforcement isn't *only* server-side.** The Monaco editor is also set
`readOnly` on the client for a `'viewer'`, via `editor.updateOptions({ readOnly: true })`
once the role arrives from the join ack. This is pure UX — it stops a viewer
from typing into an editor that will just silently reject their keystrokes
server-side, which would otherwise look broken. The actual security boundary
is the server-side check above; the client-side `readOnly` flag is not a
substitute for it and could be bypassed by anyone editing the client code —
which is fine, because the server never trusts it.

**"Shared with me."** Since a collaborator's access is a database row rather
than something derivable from a document's own fields, they need a way to
*discover* documents they didn't create. `GET /api/documents/shared` joins
`document_collaborators` back to `documents` for the current user, and the
dashboard renders it as a second list alongside "My Documents."

### A bug found and fixed while testing this step

The manual "Save current version" endpoint returned a version object missing
two fields (`createdByName`, `contentLength`) that the *list* versions
endpoint always includes — an inconsistency invisible until actually clicking
the button in the browser, where the newly-created entry displayed as
"Automatic snapshot" (wrong) instead of "Saved by Bane UI" (correct) until
the list was reloaded from the server. Fixed by looking up the author's name
and computing the content length in the same response:

```ts
// server/src/routes/documents.ts
const author = await findUserById(req.user!.userId);
res.status(201).json({
  version: {
    id: version.id,
    documentId: version.document_id,
    createdBy: version.created_by,
    createdByName: author?.name ?? null,
    createdAt: version.created_at,
    contentLength: version.content.length,
  },
});
```

---

## Interview-polish pass — security hardening + E2E tests

Done after the core 7 steps were complete, to make this project stand on its
own as something to show off rather than just a working demo.

### Security hardening

**`helmet`** — adds a set of standard security-related HTTP response headers
(`X-Content-Type-Options`, `X-Frame-Options`, a baseline
`Strict-Transport-Security`, etc.) with one line: `app.use(helmet())`. None of
this is application logic — it's closing gaps a browser would otherwise leave
open by default (e.g. preventing the API from being framed by another site).

**Rate limiting on `/register` and `/login`** (`express-rate-limit`) — 10
attempts per IP per 15 minutes, independent of success/failure. Cheap,
effective brute-force protection with essentially no cost to a genuine user.
Deliberately disabled when `NODE_ENV=test` (see the E2E section below for
why that matters in practice, not just in theory).

**Zod validation, centralized** — every route handler used to hand-roll
`typeof x !== 'string'` checks with ad-hoc error messages. A single
`validateBody(schema)` middleware ([server/src/middleware/validate.ts](server/src/middleware/validate.ts))
now does this consistently everywhere, and doubles as documentation: reading
a route's Zod schema tells you its exact input contract at a glance.

**A structural gap: Express 4 doesn't catch async errors.** This is a classic
gotcha, not a hypothetical one — in this codebase specifically, hitting any
document route with a malformed id in the URL (e.g. `/api/documents/not-a-uuid`)
makes Postgres throw `invalid input syntax for type uuid`. In an ordinary
Express 4 async route handler, a *rejected promise* is not automatically
forwarded to error-handling middleware the way a *thrown synchronous error*
is — without a fix, that rejection would be unhandled, and the request would
hang or crash the process instead of returning a clean response. Fixed with
two pieces:

1. `import 'express-async-errors'` (must load before any `express.Router()`
   is created — it patches Express's routing internals) — this alone makes
   async rejections correctly reach a final error handler.
2. A global error-handling middleware (last thing registered in
   [index.ts](server/src/index.ts)) that logs the error server-side and
   returns a generic `500` — so an unexpected failure never leaks a stack
   trace to the client.

Separately, a `router.param('id', validateUuidParam)` check
([validate.ts](server/src/middleware/validate.ts)) catches a malformed id
*before* it ever reaches a query, returning a proper `400` — the difference
between "the client sent something wrong" (400) and "something we didn't
expect happened" (500) matters for anyone debugging this API later.

### E2E tests (Playwright) — and a real bug they caught

[client/e2e/collaboration.spec.ts](client/e2e/collaboration.spec.ts) runs
two scenarios end-to-end against real running servers (not mocks):

1. Two **genuinely independent** user accounts (registered fresh per test
   run, each in its own isolated Playwright browser context — unlike manual
   testing earlier in this project, which used two tabs of one browser and
   could only simulate "two users" as the same login) open the same
   document, see each other's presence avatar, and see each other's edits
   merge live.
2. A user explicitly granted `'viewer'` access sees the "View only" label,
   sees the owner's edits arrive live, but their own keystrokes never persist
   — end-to-end proof of the Step 7 permission boundary, not just a unit
   test of the role-resolution function in isolation.

**Setting this up surfaced a genuine production bug, not a test-authoring
mistake.** The first version of test 1 failed consistently:

```
Locator:  locator('.presence-avatar')
Expected: 2
Received: 1
```

One user's presence avatar was simply never appearing on the other's screen
in the seconds right after both joined. The cause was a race condition in
[useCollaborativeDoc.ts](client/src/collab/useCollaborativeDoc.ts): the local
`Awareness` `user` field (name/color) was being set **synchronously at
mount**, before the socket had even connected. Socket.io buffers `emit()`
calls made before connecting and flushes that buffer as soon as the
transport opens — which happens *before* the `'connect'` event fires on the
client. Since `'join-document'` is only sent from inside the `'connect'`
handler, the buffered `'awareness-update'` packet could reach the server
*first*, while the server's `joinedDocumentId` for that socket was still
`null` — so the server silently dropped it (see the `if (documentId !==
joinedDocumentId) return;` guard in `socket.ts`).

This had been invisible through weeks of manual testing because a *second*
awareness change (e.g. Monaco reporting the initial cursor position moments
after mount) would arrive slightly later, once the join had definitely
completed, and awareness broadcasts always carry each client's *entire*
current state — so that second update happened to carry the `user` field
along with it, papering over the missing first one. An E2E test asserting
presence *immediately* after page load, before any editor interaction,
exposed it directly. The fix: move `setLocalStateField('user', ...)` to
*inside* the `join-document` acknowledgement callback, so it provably cannot
fire until the server has already recorded this socket as joined.

**A related fix this forced:** running the suite twice in a row initially
failed on the *second* run with `429 Too Many Requests` — a leftover manual
`curl` brute-force test from the security-hardening work above had already
used up part of the rate limiter's window on the same machine, and the
Playwright suite's own registrations pushed it over. This is a real
production consideration, not just a test-environment inconvenience: any
rate limiter needs to be either scoped away from automated test traffic or
sized with CI in mind. Fixed with `skip: () => process.env.NODE_ENV === 'test'`
in the limiter config.

Run it: `cd client && NODE_ENV=test npm run dev` (backend, in one terminal —
`NODE_ENV=test` disables the rate limiter) then `cd client && npm run test:e2e`.

### Known related gap not yet fixed

The same race-condition *shape* could in principle affect the very first
*document edit* too (not just awareness), if a user typed into Monaco in the
instant between the socket connecting and the join acknowledgement landing —
`ydoc` and `awareness` are put into React state (and therefore bound to
Monaco) as soon as they're created, not gated on the join ack. In practice
this window is a few dozen milliseconds and a human typing is nowhere near
fast enough to hit it, which is why it wasn't caught the same way the
awareness case was — but it's the same underlying design gap, just far less
likely to manifest. A more thorough fix would buffer local `Y.Doc` updates
client-side until the join ack arrives, the same way the awareness fix does.

---

## Local environment notes

- **PostgreSQL** runs natively as a Windows service (`postgresql-x64-18`),
  not in Docker — already installed on this machine.
- Database: `collab_editor`. Credentials are in `server/.env`
  (`DATABASE_URL`), which is git-ignored.
- Two dev servers run side by side during development:
  ```bash
  cd server && npm run dev     # http://localhost:4000
  cd client && npm run dev     # http://localhost:5173
  ```
- `server/src/db/migrate.ts` must be re-run (`npm run migrate`) any time the
  schema changes (a new table, a new column).
