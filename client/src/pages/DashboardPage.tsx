import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Document, SharedDocument } from '@shared/types';
import { useAuth } from '../context/AuthContext';
import { documentsApi } from '../api/documents';
import { ApiError } from '../api/client';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<SharedDocument[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([documentsApi.list(), documentsApi.listShared()])
      .then(([owned, shared]) => {
        setDocuments(owned.documents);
        setSharedDocuments(shared.documents);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load documents')
      )
      .finally(() => setIsLoading(false));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsCreating(true);
    setError(null);
    try {
      const res = await documentsApi.create({ title: newTitle.trim() });
      setDocuments((docs) => [res.document, ...docs]);
      setNewTitle('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create document');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>My Documents</h1>
          <p className="muted">
            {user?.name} &middot; {user?.email}
          </p>
        </div>
        <button className="btn-secondary" onClick={logout}>
          Log out
        </button>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <form className="create-doc-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="Untitled document"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button className="btn-primary" type="submit" disabled={isCreating}>
          {isCreating ? 'Creating…' : 'New document'}
        </button>
      </form>

      {isLoading ? (
        <p className="muted">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="muted">No documents yet. Create your first one above.</p>
      ) : (
        <ul className="doc-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <Link to={`/documents/${doc.id}`}>{doc.title}</Link>
              <span className="muted">
                {new Date(doc.updatedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && sharedDocuments.length > 0 && (
        <>
          <h2 className="section-heading">Shared with me</h2>
          <ul className="doc-list">
            {sharedDocuments.map((doc) => (
              <li key={doc.id}>
                <Link to={`/documents/${doc.id}`}>{doc.title}</Link>
                <span className="muted">{doc.role}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
