import 'express-async-errors'; // must load before any express.Router() is created

import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth';
import documentRoutes from './routes/documents';
import { setupSocket } from './socket';

dotenv.config();

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN },
});

app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

setupSocket(io);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);

// Catches anything a route handler throws or rejects with — without this,
// express-async-errors would still forward the error here, but Express's
// own *default* handler leaks stack traces to the client and logs nothing
// useful server-side. A malformed UUID in a URL param (which makes Postgres
// throw "invalid input syntax for type uuid") is exactly the kind of error
// that reaches this handler in normal use, not just attacker input.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
