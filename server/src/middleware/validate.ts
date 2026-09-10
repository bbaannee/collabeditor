import { Request, Response, NextFunction } from 'express';
import { ZodSchema, z } from 'zod';

const uuidSchema = z.string().uuid();

// Registered via router.param(name, validateUuidParam) — rejects a malformed
// id in the URL (e.g. someone hand-editing `/documents/not-a-uuid`) with a
// clean 400 before it ever reaches a query, instead of letting Postgres
// throw "invalid input syntax for type uuid" and falling through to the
// generic 500 handler.
export function validateUuidParam(
  req: Request,
  res: Response,
  next: NextFunction,
  value: string
) {
  if (!uuidSchema.safeParse(value).success) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  next();
}

// Validates req.body against a Zod schema, replacing it with the parsed
// (and thus type-safe, trimmed/coerced) value on success. Centralizing this
// means individual routes never hand-roll `typeof x !== 'string'` checks.
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Invalid request body';
      return res.status(400).json({ error: message });
    }
    req.body = result.data;
    next();
  };
}
