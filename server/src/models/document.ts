import { pool } from '../db/pool';

export type LinkAccess = 'editor' | 'viewer' | 'restricted';
export type DocumentRole = 'owner' | 'editor' | 'viewer';

export interface DocumentRow {
  id: string;
  title: string;
  content: string;
  owner_id: string;
  link_access: LinkAccess;
  created_at: string;
  updated_at: string;
}

export interface CollaboratorRow {
  document_id: string;
  user_id: string;
  role: 'editor' | 'viewer';
  created_at: string;
  name: string;
  email: string;
}

export async function createDocument(
  ownerId: string,
  title: string
): Promise<DocumentRow> {
  const result = await pool.query<DocumentRow>(
    `INSERT INTO documents (title, owner_id)
     VALUES ($1, $2)
     RETURNING *`,
    [title, ownerId]
  );
  return result.rows[0];
}

export async function listDocumentsByOwner(
  ownerId: string
): Promise<DocumentRow[]> {
  const result = await pool.query<DocumentRow>(
    'SELECT * FROM documents WHERE owner_id = $1 ORDER BY updated_at DESC',
    [ownerId]
  );
  return result.rows;
}

export interface SharedDocumentRow extends DocumentRow {
  role: 'editor' | 'viewer';
}

export async function listDocumentsSharedWithUser(
  userId: string
): Promise<SharedDocumentRow[]> {
  const result = await pool.query<SharedDocumentRow>(
    `SELECT d.*, c.role
     FROM documents d
     JOIN document_collaborators c ON c.document_id = d.id
     WHERE c.user_id = $1
     ORDER BY d.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function findDocumentById(
  id: string
): Promise<DocumentRow | null> {
  const result = await pool.query<DocumentRow>(
    'SELECT * FROM documents WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

export async function setDocumentContent(id: string, content: string) {
  await pool.query(
    'UPDATE documents SET content = $1, updated_at = now() WHERE id = $2',
    [content, id]
  );
}

export async function setLinkAccess(id: string, linkAccess: LinkAccess) {
  await pool.query('UPDATE documents SET link_access = $1 WHERE id = $2', [
    linkAccess,
    id,
  ]);
}

// Resolves what a user is allowed to do with a document: the owner always
// has full access; otherwise an explicit collaborator row wins; otherwise
// fall back to whatever the document's link_access allows; otherwise none.
export async function getEffectiveRole(
  documentId: string,
  userId: string
): Promise<DocumentRole | null> {
  const doc = await findDocumentById(documentId);
  if (!doc) return null;
  if (doc.owner_id === userId) return 'owner';

  const collaborator = await pool.query<{ role: 'editor' | 'viewer' }>(
    'SELECT role FROM document_collaborators WHERE document_id = $1 AND user_id = $2',
    [documentId, userId]
  );
  if (collaborator.rows[0]) return collaborator.rows[0].role;

  if (doc.link_access === 'restricted') return null;
  return doc.link_access;
}

export async function listCollaborators(
  documentId: string
): Promise<CollaboratorRow[]> {
  const result = await pool.query<CollaboratorRow>(
    `SELECT c.document_id, c.user_id, c.role, c.created_at, u.name, u.email
     FROM document_collaborators c
     JOIN users u ON u.id = c.user_id
     WHERE c.document_id = $1
     ORDER BY c.created_at ASC`,
    [documentId]
  );
  return result.rows;
}

export async function upsertCollaborator(
  documentId: string,
  userId: string,
  role: 'editor' | 'viewer'
) {
  await pool.query(
    `INSERT INTO document_collaborators (document_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [documentId, userId, role]
  );
}

export async function removeCollaborator(documentId: string, userId: string) {
  await pool.query(
    'DELETE FROM document_collaborators WHERE document_id = $1 AND user_id = $2',
    [documentId, userId]
  );
}

export function toPublicDocument(row: DocumentRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    ownerId: row.owner_id,
    linkAccess: row.link_access,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
