// Shared types used by both client and server

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ApiError {
  error: string;
}

export type LinkAccess = 'editor' | 'viewer' | 'restricted';
export type DocumentRole = 'owner' | 'editor' | 'viewer';

export interface Document {
  id: string;
  title: string;
  content: string;
  ownerId: string;
  linkAccess: LinkAccess;
  createdAt: string;
  updatedAt: string;
}

export interface SharedDocument extends Document {
  role: 'editor' | 'viewer';
}

export interface CreateDocumentRequest {
  title: string;
}

export interface Collaborator {
  userId: string;
  name: string;
  email: string;
  role: 'editor' | 'viewer';
}

export interface DocumentPermissions {
  linkAccess: LinkAccess;
  collaborators: Collaborator[];
}

export interface DocumentVersionSummary {
  id: string;
  documentId: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  contentLength: number;
}

export interface DocumentVersionDetail {
  id: string;
  documentId: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
}
