import { useEffect, useState } from 'react';
import type { DocumentVersionDetail, DocumentVersionSummary } from '@shared/types';
import { documentsApi } from '../api/documents';
import { ApiError } from '../api/client';

export function VersionHistoryPanel({
  documentId,
  canEdit,
  onClose,
  onRestored,
}: {
  documentId: string;
  canEdit: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [selected, setSelected] = useState<DocumentVersionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    documentsApi
      .listVersions(documentId)
      .then((res) => setVersions(res.versions))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setIsLoading(false));
  }, [documentId]);

  async function handleSelect(versionId: string) {
    setError(null);
    try {
      const res = await documentsApi.getVersion(documentId, versionId);
      setSelected(res.version);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load version');
    }
  }

  async function handleSaveNow() {
    setError(null);
    try {
      const res = await documentsApi.saveVersion(documentId);
      setVersions((v) => [res.version, ...v]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save version');
    }
  }

  async function handleRestore(versionId: string) {
    setError(null);
    try {
      await documentsApi.restoreVersion(documentId, versionId);
      onRestored();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to restore version');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Version history</h2>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {canEdit && (
          <button className="btn-secondary" onClick={handleSaveNow}>
            Save current version
          </button>
        )}

        <div className="version-layout">
          <ul className="version-list">
            {isLoading && <li className="muted">Loading…</li>}
            {!isLoading && versions.length === 0 && (
              <li className="muted">No versions yet — versions are saved automatically
                every few minutes while editing.</li>
            )}
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  className={selected?.id === v.id ? 'version-item selected' : 'version-item'}
                  onClick={() => handleSelect(v.id)}
                >
                  <div>{new Date(v.createdAt).toLocaleString()}</div>
                  <div className="muted">
                    {v.createdByName ? `Saved by ${v.createdByName}` : 'Automatic snapshot'}
                    {' · '}
                    {v.contentLength} chars
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="version-preview">
            {selected ? (
              <>
                <textarea className="doc-content-preview" readOnly value={selected.content} />
                {canEdit && (
                  <button className="btn-primary" onClick={() => handleRestore(selected.id)}>
                    Restore this version
                  </button>
                )}
              </>
            ) : (
              <p className="muted">Select a version to preview it.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
