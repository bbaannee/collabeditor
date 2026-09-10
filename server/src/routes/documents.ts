import { Router } from 'express';
import { z } from 'zod';
import {
  createDocument,
  findDocumentById,
  getEffectiveRole,
  listCollaborators,
  listDocumentsByOwner,
  listDocumentsSharedWithUser,
  removeCollaborator,
  setDocumentContent,
  setLinkAccess,
  toPublicDocument,
  upsertCollaborator,
} from '../models/document';
import { findUserByEmail, findUserById, toPublicUser } from '../models/user';
import {
  createVersion,
  getVersion,
  listVersions,
  toPublicVersionSummary,
} from '../models/documentVersion';
import { restoreContent } from '../collab/documentRooms';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { validateBody, validateUuidParam } from '../middleware/validate';

const router = Router();

router.use(requireAuth);
router.param('id', validateUuidParam);
router.param('versionId', validateUuidParam);
router.param('userId', validateUuidParam);

const createDocumentSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
});

const linkAccessSchema = z.object({
  linkAccess: z.enum(['editor', 'viewer', 'restricted']),
});

const addCollaboratorSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(['editor', 'viewer']),
});

router.post('/', validateBody(createDocumentSchema), async (req: AuthedRequest, res) => {
  const { title } = req.body as z.infer<typeof createDocumentSchema>;
  const doc = await createDocument(req.user!.userId, title);
  res.status(201).json({ document: toPublicDocument(doc) });
});

router.get('/', async (req: AuthedRequest, res) => {
  const docs = await listDocumentsByOwner(req.user!.userId);
  res.json({ documents: docs.map(toPublicDocument) });
});

router.get('/shared', async (req: AuthedRequest, res) => {
  const docs = await listDocumentsSharedWithUser(req.user!.userId);
  res.json({
    documents: docs.map((doc) => ({ ...toPublicDocument(doc), role: doc.role })),
  });
});

router.get('/:id', async (req: AuthedRequest, res) => {
  const role = await getEffectiveRole(req.params.id, req.user!.userId);
  if (!role) {
    return res.status(404).json({ error: 'Document not found' });
  }
  const doc = await findDocumentById(req.params.id);
  res.json({ document: toPublicDocument(doc!), role });
});

// --- Sharing / permissions -------------------------------------------------

router.get('/:id/permissions', async (req: AuthedRequest, res) => {
  const doc = await findDocumentById(req.params.id);
  if (!doc || doc.owner_id !== req.user!.userId) {
    return res.status(403).json({ error: 'Only the owner can view sharing settings' });
  }
  const collaborators = await listCollaborators(req.params.id);
  res.json({
    linkAccess: doc.link_access,
    collaborators: collaborators.map((c) => ({
      userId: c.user_id,
      name: c.name,
      email: c.email,
      role: c.role,
    })),
  });
});

router.put(
  '/:id/link-access',
  validateBody(linkAccessSchema),
  async (req: AuthedRequest, res) => {
    const doc = await findDocumentById(req.params.id);
    if (!doc || doc.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Only the owner can change sharing settings' });
    }

    const { linkAccess } = req.body as z.infer<typeof linkAccessSchema>;
    await setLinkAccess(req.params.id, linkAccess);
    res.json({ linkAccess });
  }
);

router.post(
  '/:id/collaborators',
  validateBody(addCollaboratorSchema),
  async (req: AuthedRequest, res) => {
    const doc = await findDocumentById(req.params.id);
    if (!doc || doc.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Only the owner can manage collaborators' });
    }

    const { email, role } = req.body as z.infer<typeof addCollaboratorSchema>;
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'No user with that email' });
    }
    if (user.id === doc.owner_id) {
      return res.status(400).json({ error: 'That user already owns this document' });
    }

    await upsertCollaborator(req.params.id, user.id, role);
    res.status(201).json({ collaborator: { ...toPublicUser(user), role } });
  }
);

router.delete('/:id/collaborators/:userId', async (req: AuthedRequest, res) => {
  const doc = await findDocumentById(req.params.id);
  if (!doc || doc.owner_id !== req.user!.userId) {
    return res.status(403).json({ error: 'Only the owner can manage collaborators' });
  }

  await removeCollaborator(req.params.id, req.params.userId);
  res.status(204).end();
});

// --- Version history ---------------------------------------------------

router.get('/:id/versions', async (req: AuthedRequest, res) => {
  const role = await getEffectiveRole(req.params.id, req.user!.userId);
  if (!role) {
    return res.status(404).json({ error: 'Document not found' });
  }
  const versions = await listVersions(req.params.id);
  res.json({ versions: versions.map(toPublicVersionSummary) });
});

router.get('/:id/versions/:versionId', async (req: AuthedRequest, res) => {
  const role = await getEffectiveRole(req.params.id, req.user!.userId);
  if (!role) {
    return res.status(404).json({ error: 'Document not found' });
  }
  const version = await getVersion(req.params.id, req.params.versionId);
  if (!version) {
    return res.status(404).json({ error: 'Version not found' });
  }
  res.json({
    version: {
      id: version.id,
      documentId: version.document_id,
      content: version.content,
      createdBy: version.created_by,
      createdAt: version.created_at,
    },
  });
});

router.post('/:id/versions', async (req: AuthedRequest, res) => {
  const role = await getEffectiveRole(req.params.id, req.user!.userId);
  if (role !== 'owner' && role !== 'editor') {
    return res.status(403).json({ error: 'You do not have edit access to this document' });
  }
  const doc = await findDocumentById(req.params.id);
  const version = await createVersion(req.params.id, doc!.content, req.user!.userId);
  const author = await findUserById(req.user!.userId);
  res.status(201).json({
    version: {
      id: version.id,
      documentId: version.document_id,
      createdBy: version.created_by,
      createdByName: author?.name ?? null,
      createdAt: version.created_at,
      contentLength: version.content.length,
    },
  });
});

router.post('/:id/versions/:versionId/restore', async (req: AuthedRequest, res) => {
  const role = await getEffectiveRole(req.params.id, req.user!.userId);
  if (role !== 'owner' && role !== 'editor') {
    return res.status(403).json({ error: 'You do not have edit access to this document' });
  }

  const version = await getVersion(req.params.id, req.params.versionId);
  if (!version) {
    return res.status(404).json({ error: 'Version not found' });
  }

  // If the document is currently open, restore through the live CRDT so it
  // shows up instantly for everyone connected. Otherwise fall back to a
  // direct write, since there's no in-memory state to reconcile.
  const restoredLive = restoreContent(req.params.id, version.content);
  if (!restoredLive) {
    await setDocumentContent(req.params.id, version.content);
  }

  res.json({ restored: true });
});

export default router;
