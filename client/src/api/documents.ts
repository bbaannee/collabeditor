import type {
  Collaborator,
  CreateDocumentRequest,
  Document,
  DocumentPermissions,
  DocumentRole,
  DocumentVersionDetail,
  DocumentVersionSummary,
  LinkAccess,
  SharedDocument,
} from '@shared/types';
import { apiRequest } from './client';

export const documentsApi = {
  create: (body: CreateDocumentRequest) =>
    apiRequest<{ document: Document }>('/api/documents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  list: () => apiRequest<{ documents: Document[] }>('/api/documents'),

  listShared: () =>
    apiRequest<{ documents: SharedDocument[] }>('/api/documents/shared'),

  get: (id: string) =>
    apiRequest<{ document: Document; role: DocumentRole }>(`/api/documents/${id}`),

  getPermissions: (id: string) =>
    apiRequest<DocumentPermissions>(`/api/documents/${id}/permissions`),

  setLinkAccess: (id: string, linkAccess: LinkAccess) =>
    apiRequest<{ linkAccess: LinkAccess }>(`/api/documents/${id}/link-access`, {
      method: 'PUT',
      body: JSON.stringify({ linkAccess }),
    }),

  addCollaborator: (id: string, email: string, role: 'editor' | 'viewer') =>
    apiRequest<{ collaborator: Collaborator }>(`/api/documents/${id}/collaborators`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  removeCollaborator: (id: string, userId: string) =>
    apiRequest<void>(`/api/documents/${id}/collaborators/${userId}`, {
      method: 'DELETE',
    }),

  listVersions: (id: string) =>
    apiRequest<{ versions: DocumentVersionSummary[] }>(`/api/documents/${id}/versions`),

  getVersion: (id: string, versionId: string) =>
    apiRequest<{ version: DocumentVersionDetail }>(
      `/api/documents/${id}/versions/${versionId}`
    ),

  saveVersion: (id: string) =>
    apiRequest<{ version: DocumentVersionSummary }>(`/api/documents/${id}/versions`, {
      method: 'POST',
    }),

  restoreVersion: (id: string, versionId: string) =>
    apiRequest<{ restored: true }>(`/api/documents/${id}/versions/${versionId}/restore`, {
      method: 'POST',
    }),
};
