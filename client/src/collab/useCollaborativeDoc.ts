import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { io, Socket } from 'socket.io-client';
import type { DocumentRole, User } from '@shared/types';
import { colorForUserId } from './userColor';
import { watchRemoteCursorStyles } from './remoteCursorStyles';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface JoinAck {
  state?: string;
  awareness?: string | null;
  role?: DocumentRole;
  error?: string;
}

export interface CollaborativeDoc {
  ydoc: Y.Doc | null;
  awareness: Awareness | null;
  socket: Socket | null;
  isSynced: boolean;
  role: DocumentRole | null;
  error: string | null;
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function useCollaborativeDoc(
  documentId: string | undefined,
  user: User | null
): CollaborativeDoc {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isSynced, setIsSynced] = useState(false);
  const [role, setRole] = useState<DocumentRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId || !user) return;

    // A fresh Y.Doc (and Awareness) per document — React Router reuses this
    // component instance across param changes, so we must not carry state
    // between different documents.
    const doc = new Y.Doc();
    const localAwareness = new Awareness(doc);

    const token = localStorage.getItem('token');
    const s = io(API_BASE_URL, { auth: { token } });

    setYdoc(doc);
    setAwareness(localAwareness);
    setIsSynced(false);
    setError(null);

    s.on('connect', () => {
      s.emit(
        'join-document',
        { documentId, awarenessClientId: localAwareness.clientID },
        (ack: JoinAck) => {
          if (ack.error) {
            setError(ack.error);
            return;
          }
          if (ack.state) {
            Y.applyUpdate(doc, decodeBase64(ack.state), 'remote');
          }
          if (ack.awareness) {
            applyAwarenessUpdate(localAwareness, decodeBase64(ack.awareness), 'remote');
          }
          setRole(ack.role ?? null);
          setIsSynced(true);

          // Only announce our own presence once the server has actually
          // acknowledged the join. Setting this earlier — even just earlier
          // in the same tick, before `connect` even fires — races with
          // Socket.io's own connection handshake: emits queued before the
          // socket connects get flushed as soon as the transport opens,
          // which happens *before* the 'connect' event (and therefore
          // 'join-document') reaches the server. The result was this
          // client's very first awareness broadcast silently arriving
          // before the server had recorded `joinedDocumentId` for the
          // socket, so it got dropped — invisible in manual testing (a
          // subsequent cursor-move update would "fix" it moments later) but
          // caught immediately by an E2E test asserting presence right
          // after page load.
          localAwareness.setLocalStateField('user', {
            name: user.name,
            color: colorForUserId(user.id),
          });
        }
      );
    });

    s.on('connect_error', (err) => {
      setError(err.message);
    });

    s.on('update', (updateBase64: string) => {
      Y.applyUpdate(doc, decodeBase64(updateBase64), 'remote');
    });

    s.on('awareness-update', (updateBase64: string) => {
      applyAwarenessUpdate(localAwareness, decodeBase64(updateBase64), 'remote');
    });

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      s.emit('update', documentId, encodeBase64(update));
    });

    localAwareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown
      ) => {
        if (origin === 'remote') return;
        const changedClientIds = added.concat(updated, removed);
        const update = encodeAwarenessUpdate(localAwareness, changedClientIds);
        s.emit('awareness-update', documentId, encodeBase64(update));
      }
    );

    const stopWatchingCursorStyles = watchRemoteCursorStyles(localAwareness);

    setSocket(s);

    return () => {
      stopWatchingCursorStyles();
      removeAwarenessStates(localAwareness, [doc.clientID], null);
      s.disconnect();
      localAwareness.destroy();
      doc.destroy();
      setSocket(null);
      setYdoc(null);
      setAwareness(null);
      setIsSynced(false);
      setRole(null);
    };
  }, [documentId, user]);

  return { ydoc, awareness, socket, isSynced, role, error };
}
