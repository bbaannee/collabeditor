import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { Server } from 'socket.io';
import { setDocumentContent, findDocumentById } from '../models/document';
import {
  createVersion,
  getLatestVersionTimestamp,
} from '../models/documentVersion';

const SAVE_DEBOUNCE_MS = 1500;
const VERSION_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // one auto-snapshot per 5 minutes of activity

interface Room {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connectionCount: number;
  saveTimer: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();

let ioRef: Server | null = null;

// The socket.io server instance is created after this module loads, so it's
// injected once at startup rather than imported directly (avoids a circular
// import between socket.ts and documentRooms.ts).
export function attachIo(io: Server) {
  ioRef = io;
}

export function roomChannel(documentId: string) {
  return `document:${documentId}`;
}

async function loadOrCreateRoom(documentId: string): Promise<Room | null> {
  const existing = rooms.get(documentId);
  if (existing) return existing;

  const doc = await findDocumentById(documentId);
  if (!doc) return null;

  const ydoc = new Y.Doc();
  if (doc.content) {
    ydoc.getText('content').insert(0, doc.content);
  }

  const awareness = new awarenessProtocol.Awareness(ydoc);

  const room: Room = { ydoc, awareness, connectionCount: 0, saveTimer: null };

  // One listener per room (not per connection) — handles broadcasting *any*
  // change to the document text, regardless of whether it came from a
  // client's keystroke (via applyUpdate) or a server-initiated action like
  // restoring a version (via restoreContent). This is what lets restore
  // propagate live to everyone currently viewing the document for free.
  ydoc.on('update', (update: Uint8Array) => {
    ioRef
      ?.to(roomChannel(documentId))
      .emit('update', Buffer.from(update).toString('base64'));
    scheduleSave(documentId, room);
  });

  // One listener per room — broadcasts every cursor / selection / presence
  // change to everyone currently viewing this document.
  awareness.on(
    'update',
    ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const changedClientIds = added.concat(updated, removed);
      const update = awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        changedClientIds
      );
      ioRef
        ?.to(roomChannel(documentId))
        .emit('awareness-update', Buffer.from(update).toString('base64'));
    }
  );

  rooms.set(documentId, room);
  return room;
}

function scheduleSave(documentId: string, room: Room) {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(async () => {
    const content = room.ydoc.getText('content').toString();
    await setDocumentContent(documentId, content);
    await maybeSnapshotVersion(documentId, content);
  }, SAVE_DEBOUNCE_MS);
}

// Basic version history: rather than a row per keystroke (way too many) or
// requiring a person to manually click "save version" every time, take an
// automatic snapshot at most once every few minutes of active editing.
async function maybeSnapshotVersion(documentId: string, content: string) {
  const lastSnapshotAt = await getLatestVersionTimestamp(documentId);
  const dueForSnapshot =
    !lastSnapshotAt ||
    Date.now() - lastSnapshotAt.getTime() > VERSION_SNAPSHOT_INTERVAL_MS;
  if (dueForSnapshot) {
    await createVersion(documentId, content, null);
  }
}

export async function joinRoom(
  documentId: string
): Promise<{ ydoc: Y.Doc; awareness: awarenessProtocol.Awareness } | null> {
  const room = await loadOrCreateRoom(documentId);
  if (!room) return null;
  room.connectionCount += 1;
  return { ydoc: room.ydoc, awareness: room.awareness };
}

export function applyUpdate(documentId: string, update: Uint8Array) {
  const room = rooms.get(documentId);
  if (!room) return;
  Y.applyUpdate(room.ydoc, update); // triggers the room's ydoc 'update' listener above
}

// Used by the restore-a-version feature. If the document is currently open
// (a "room" exists in memory), replace the live CRDT text in a transaction
// so the change flows through the exact same broadcast + save path as a
// normal edit. If nobody has it open, there's no live state to touch — the
// caller falls back to updating Postgres directly.
export function restoreContent(documentId: string, content: string): boolean {
  const room = rooms.get(documentId);
  if (!room) return false;
  const ytext = room.ydoc.getText('content');
  room.ydoc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, content);
  });
  return true;
}

export function applyAwarenessUpdate(documentId: string, update: Uint8Array) {
  const room = rooms.get(documentId);
  if (!room) return;
  awarenessProtocol.applyAwarenessUpdate(room.awareness, update, null);
}

export function removeAwarenessClient(documentId: string, clientId: number) {
  const room = rooms.get(documentId);
  if (!room) return;
  awarenessProtocol.removeAwarenessStates(room.awareness, [clientId], null);
}

export function leaveRoom(documentId: string) {
  const room = rooms.get(documentId);
  if (!room) return;
  room.connectionCount = Math.max(0, room.connectionCount - 1);

  if (room.connectionCount === 0) {
    // Flush immediately and free memory once everyone has left.
    if (room.saveTimer) clearTimeout(room.saveTimer);
    const content = room.ydoc.getText('content').toString();
    setDocumentContent(documentId, content).finally(() => {
      room.ydoc.destroy();
      room.awareness.destroy();
      rooms.delete(documentId);
    });
  }
}
