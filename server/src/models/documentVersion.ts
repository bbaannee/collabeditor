import { pool } from '../db/pool';

export interface VersionRow {
  id: string;
  document_id: string;
  content: string;
  created_by: string | null;
  created_at: string;
}

export interface VersionSummaryRow {
  id: string;
  document_id: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  content_length: number;
}

export async function createVersion(
  documentId: string,
  content: string,
  createdBy: string | null
): Promise<VersionRow> {
  const result = await pool.query<VersionRow>(
    `INSERT INTO document_versions (document_id, content, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [documentId, content, createdBy]
  );
  return result.rows[0];
}

export async function getLatestVersionTimestamp(
  documentId: string
): Promise<Date | null> {
  const result = await pool.query<{ created_at: string }>(
    'SELECT created_at FROM document_versions WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
    [documentId]
  );
  return result.rows[0] ? new Date(result.rows[0].created_at) : null;
}

export async function listVersions(
  documentId: string
): Promise<VersionSummaryRow[]> {
  const result = await pool.query<VersionSummaryRow>(
    `SELECT v.id, v.document_id, v.created_by, u.name AS created_by_name,
            v.created_at, length(v.content) AS content_length
     FROM document_versions v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.document_id = $1
     ORDER BY v.created_at DESC`,
    [documentId]
  );
  return result.rows;
}

export async function getVersion(
  documentId: string,
  versionId: string
): Promise<VersionRow | null> {
  const result = await pool.query<VersionRow>(
    'SELECT * FROM document_versions WHERE id = $1 AND document_id = $2',
    [versionId, documentId]
  );
  return result.rows[0] ?? null;
}

export function toPublicVersionSummary(row: VersionSummaryRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    contentLength: Number(row.content_length),
  };
}
