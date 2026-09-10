import type { Awareness } from 'y-protocols/awareness';

const STYLE_ELEMENT_ID = 'collab-remote-cursor-styles';

interface AwareUser {
  name?: string;
  color?: string;
}

// y-monaco tags remote selection/cursor decorations with classes named after
// each client's numeric id (yRemoteSelection-<id>, yRemoteSelectionHead-<id>)
// but intentionally leaves *styling* those classes to the app — this
// generates that CSS dynamically from each client's awareness `user` field.
export function watchRemoteCursorStyles(awareness: Awareness): () => void {
  let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleEl);
  }

  const render = () => {
    const rules: string[] = [];

    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.doc.clientID) return; // never style our own cursor

      const user = state.user as AwareUser | undefined;
      if (!user) return;

      const color = user.color || '#888888';
      const name = (user.name || 'Anonymous').replace(/["\\]/g, '');

      rules.push(`
        .yRemoteSelection-${clientId} {
          background-color: ${color}40;
        }
        .yRemoteSelectionHead-${clientId} {
          position: absolute;
          border-left: 2px solid ${color};
        }
        .yRemoteSelectionHead-${clientId}::after {
          content: "${name}";
          position: absolute;
          top: -1.15em;
          left: -2px;
          font-size: 11px;
          line-height: 1.4;
          padding: 0 4px;
          border-radius: 3px 3px 3px 0;
          background-color: ${color};
          color: #fff;
          white-space: nowrap;
          user-select: none;
          pointer-events: none;
        }
      `);
    });

    styleEl!.textContent = rules.join('\n');
  };

  awareness.on('change', render);
  render();

  return () => {
    awareness.off('change', render);
  };
}
