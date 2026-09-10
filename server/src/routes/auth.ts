import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { createUser, findUserByEmail, findUserById, toPublicUser } from '../models/user';
import { signToken } from '../utils/jwt';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { authRateLimiter } from '../middleware/rateLimit';

const router = Router();
const SALT_ROUNDS = 10;

const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1, 'Name is required'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

router.post(
  '/register',
  authRateLimiter,
  validateBody(registerSchema),
  async (req, res) => {
    const { email, password, name } = req.body as z.infer<typeof registerSchema>;

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(email, name, passwordHash);

    const token = signToken({ userId: user.id, email: user.email });
    res.status(201).json({ token, user: toPublicUser(user) });
  }
);

router.post('/login', authRateLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken({ userId: user.id, email: user.email });
  res.json({ token, user: toPublicUser(user) });
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const user = await findUserById(req.user!.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user: toPublicUser(user) });
});

export default router;
