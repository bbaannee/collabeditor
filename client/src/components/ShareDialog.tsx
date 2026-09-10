import { useEffect, useState, type FormEvent } from 'react';
import type { Collaborator, DocumentPermissions, LinkAccess } from '@shared/types';
import { documentsApi } from '../api/documents';
import { ApiError } from '../api/client';

export function ShareDialog({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const [permissions, setPermissions] = useState<DocumentPermissions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function load() {
    documentsApi
      .getPermissions(documentId)
      .then(setPermissions)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [documentId]);

  async function handleLinkAccessChange(next: LinkAccess) {
    setError(null);
    try {
      await documentsApi.setLinkAccess(documentId, next);
      setPermissions((p) => (p ? { ...p, linkAccess: next } : p));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update link access');
    }
  }

  async function handleAddCollaborator(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await documentsApi.addCollaborator(documentId, email.trim(), role);
      setPermissions((p) =>
        p
          ? {
              ...p,
              collaborators: [
                ...p.collaborators.filter((c) => c.userId !== res.collaborator.userId),
                res.collaborator as Collaborator,
              ],
            }
          : p
      );
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add collaborator');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove(userId: string) {
    setError(null);
    try {
      await documentsApi.removeCollaborator(documentId, userId);
      setPermissions((p) =>
        p ? { ...p, collaborators: p.collaborators.filter((c) => c.userId !== userId) } : p
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove collaborator');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Share document</h2>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {!permissions ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="link-access">Anyone with the link can</label>
              <select
                id="link-access"
                value={permissions.linkAccess}
                onChange={(e) => handleLinkAccessChange(e.target.value as LinkAccess)}
              >
                <option value="editor">Edit</option>
                <option value="viewer">View only</option>
                <option value="restricted">No access (invite only)</option>
              </select>
            </div>

            <h3>People with access</h3>
            <ul className="collaborator-list">
              {permissions.collaborators.length === 0 && (
                <li className="muted">No one has been individually invited.</li>
              )}
              {permissions.collaborators.map((c) => (
                <li key={c.userId}>
                  <div>
                    <div>{c.name}</div>
                    <div className="muted">{c.email}</div>
                  </div>
                  <div className="collaborator-actions">
                    <span className="muted">{c.role}</span>
                    <button className="btn-secondary" onClick={() => handleRemove(c.userId)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <form className="add-collaborator-form" onSubmit={handleAddCollaborator}>
              <input
                type="email"
                placeholder="Invite by email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <select value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button className="btn-primary" type="submit" disabled={isSubmitting}>
                Invite
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
