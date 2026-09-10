import type { PresentUser } from '../collab/usePresence';

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function PresenceAvatars({ users }: { users: PresentUser[] }) {
  if (users.length === 0) return null;

  return (
    <div className="presence-row" title={`${users.length} online`}>
      {users.map((u) => (
        <div
          key={u.clientId}
          className="presence-avatar"
          style={{ backgroundColor: u.color }}
          title={u.isLocal ? `${u.name} (you)` : u.name}
        >
          {initials(u.name)}
        </div>
      ))}
    </div>
  );
}
