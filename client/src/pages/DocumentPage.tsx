import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Editor, { type OnMount } from '@monaco-editor/react';
import { MonacoBinding } from 'y-monaco';
import type { Document, DocumentRole } from '@shared/types';
import { documentsApi } from '../api/documents';
import { ApiError } from '../api/client';
import { useCollaborativeDoc } from '../collab/useCollaborativeDoc';
import { usePresence } from '../collab/usePresence';
import { PresenceAvatars } from '../components/PresenceAvatars';
import { ShareDialog } from '../components/ShareDialog';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';
import { useAuth } from '../context/AuthContext';

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [document, setDocument] = useState<Document | null>(null);
  const [docRole, setDocRole] = useState<DocumentRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { ydoc, awareness, isSynced, role, error: collabError } = useCollaborativeDoc(id, user);
  const presentUsers = usePresence(awareness);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  function loadDocument() {
    if (!id) return;
    documentsApi
      .get(id)
      .then((res) => {
        setDocument(res.document);
        setDocRole(res.role);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load document')
      );
  }

  useEffect(loadDocument, [id]);

  // The socket handshake's role is the one that actually governs whether the
  // server will accept our edits — use it as soon as it's available, falling
  // back to the plain HTTP fetch's role before the socket has connected.
  const effectiveRole = role ?? docRole;
  const canEdit = effectiveRole === 'owner' || effectiveRole === 'editor';
  const isOwner = effectiveRole === 'owner';

  const handleEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    if (!ydoc || !awareness) return;
    const model = editorInstance.getModel();
    if (!model) return;

    const ytext = ydoc.getText('content');
    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(
      ytext,
      model,
      new Set([editorInstance]),
      awareness
    );

    void monaco;
  };

  // Monaco's readOnly option is set at mount time via `options`, but our
  // role isn't known yet at that point (it arrives async from the socket) —
  // update it imperatively once the role becomes known.
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !canEdit });
  }, [canEdit]);

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, [id]);

  function copyShareLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (error || collabError) {
    return (
      <div className="dashboard">
        <div className="auth-error">{error || collabError}</div>
        <Link to="/">Back to documents</Link>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="dashboard">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="document-page">
      <div className="dashboard-header">
        <div>
          <Link to="/" className="muted">
            &larr; My Documents
          </Link>
          <h1>{document.title}</h1>
        </div>
        <div className="doc-header-actions">
          <PresenceAvatars users={presentUsers} />
          {effectiveRole === 'viewer' && <span className="muted">View only</span>}
          <span className="muted">{isSynced ? 'Synced' : 'Connecting…'}</span>
          <button className="btn-secondary" onClick={() => setShowHistory(true)}>
            History
          </button>
          {isOwner && (
            <button className="btn-secondary" onClick={() => setShowShare(true)}>
              Share
            </button>
          )}
          <button className="btn-secondary" onClick={copyShareLink}>
            {copied ? 'Copied!' : 'Copy share link'}
          </button>
        </div>
      </div>

      <div className="editor-wrapper">
        {ydoc && awareness && (
          <Editor
            height="70vh"
            defaultLanguage="plaintext"
            theme="vs-dark"
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              readOnly: !canEdit,
            }}
          />
        )}
      </div>

      {showShare && id && (
        <ShareDialog documentId={id} onClose={() => setShowShare(false)} />
      )}

      {showHistory && id && (
        <VersionHistoryPanel
          documentId={id}
          canEdit={canEdit}
          onClose={() => setShowHistory(false)}
          onRestored={loadDocument}
        />
      )}
    </div>
  );
}
