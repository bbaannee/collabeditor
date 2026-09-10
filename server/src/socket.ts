import { Server, Socket } from 'socket.io';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { verifyToken, JwtPayload } from './utils/jwt';
import { getEffectiveRole, DocumentRole } from './models/document';
import {
  applyUpdate,
  applyAwarenessUpdate,
  attachIo,
  joinRoom,
  leaveRoom,
  removeAwarenessClient,
  roomChannel,
} from './collab/documentRooms';

interface AuthedSocket extends Socket {
  user?: JwtPayload;
}

interface JoinPayload {
  documentId: string;
  awarenessClientId: number;
}

export function setupSocket(io: Server) {
  attachIo(io);

  io.use((socket: AuthedSocket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') {
      return next(new Error('Missing auth token'));
    }
    try {
      socket.user = verifyToken(token);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    let joinedDocumentId: string | null = null;
    let awarenessClientId: number | null = null;
    let role: DocumentRole | null = null;

    socket.on('join-document', async (payload: JoinPayload, ack) => {
      role = await getEffectiveRole(payload.documentId, socket.user!.userId);
      if (!role) {
        return ack?.({ error: 'You do not have access to this document' });
      }

      const room = await joinRoom(payload.documentId);
      if (!room) {
        return ack?.({ error: 'Document not found' });
      }

      joinedDocumentId = payload.documentId;
      awarenessClientId = payload.awarenessClientId;
      socket.join(roomChannel(payload.documentId));

      const state = Y.encodeStateAsUpdate(room.ydoc);
      const awarenessStates = room.awareness.getStates();
      const awarenessUpdate =
        awarenessStates.size > 0
          ? awarenessProtocol.encodeAwarenessUpdate(
              room.awareness,
              Array.from(awarenessStates.keys())
            )
          : null;

      ack?.({
        role,
        state: Buffer.from(state).toString('base64'),
        awareness: awarenessUpdate
          ? Buffer.from(awarenessUpdate).toString('base64')
          : null,
      });
    });

    socket.on('update', (documentId: string, updateBase64: string) => {
      if (documentId !== joinedDocumentId) return;
      if (role !== 'owner' && role !== 'editor') return; // viewers can't write
      const update = new Uint8Array(Buffer.from(updateBase64, 'base64'));
      // documentRooms broadcasts this to the whole room itself once applied
      // — see the room-level ydoc listener in documentRooms.ts.
      applyUpdate(documentId, update);
    });

    socket.on('awareness-update', (documentId: string, updateBase64: string) => {
      if (documentId !== joinedDocumentId) return;
      const update = new Uint8Array(Buffer.from(updateBase64, 'base64'));
      // documentRooms broadcasts this to the whole room itself (including
      // back to this socket) once it applies the update — see the room-level
      // awareness listener in documentRooms.ts.
      applyAwarenessUpdate(documentId, update);
    });

    socket.on('disconnect', () => {
      if (joinedDocumentId) {
        if (awarenessClientId !== null) {
          removeAwarenessClient(joinedDocumentId, awarenessClientId);
        }
        leaveRoom(joinedDocumentId);
      }
    });
  });
}
