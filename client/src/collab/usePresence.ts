import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

export interface PresentUser {
  clientId: number;
  name: string;
  color: string;
  isLocal: boolean;
}

interface AwareUser {
  name?: string;
  color?: string;
}

// Renders the same Awareness state used for cursors (Step 5) as a plain
// "who's here" list — no new sync mechanism, just a different view of data
// that was already being broadcast.
export function usePresence(awareness: Awareness | null): PresentUser[] {
  const [users, setUsers] = useState<PresentUser[]>([]);

  useEffect(() => {
    if (!awareness) {
      setUsers([]);
      return;
    }

    const render = () => {
      const list: PresentUser[] = [];
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
      // Local user first, then everyone else in a stable order.
      list.sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.clientId - b.clientId);
      setUsers(list);
    };

    awareness.on('change', render);
    render();

    return () => {
      awareness.off('change', render);
    };
  }, [awareness]);

  return users;
}
