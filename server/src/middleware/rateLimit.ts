import rateLimit from 'express-rate-limit';

// Blunt but effective brute-force protection: register/login attempts are
// capped per IP, independent of whether they succeed or fail. 10 attempts
// per 15 minutes is generous for a real user (who mistypes a password a
// couple of times) but useless for a password-spraying script.
//
// Disabled under NODE_ENV=test: an E2E suite that registers several users
// per run would otherwise start tripping this after only a handful of test
// executions sharing one IP (as happened while building this — a manual
// curl brute-force test and the Playwright suite were sharing the same
// window). Rate limiting is a production concern, not something a test
// environment should have to work around.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});
