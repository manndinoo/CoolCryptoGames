// Entry point: loads .env, opens the database and starts HTTP (or HTTPS).
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createApp } from './app.mjs';
import { loadEnv } from './env.mjs';

loadEnv();

const dataDir = path.resolve(process.env.LINEWATCH_DATA_DIR || 'data');
const port = Number(process.env.PORT || 3000);
const app = createApp({ dataDir });

// Phones only allow camera and GPS on HTTPS (or localhost). Point these at a
// certificate to test on a phone over the local network.
const cert = process.env.LINEWATCH_TLS_CERT, key = process.env.LINEWATCH_TLS_KEY;
const server = cert && key
  ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, app.handle)
  : http.createServer(app.handle);
server.requestTimeout = 5 * 60 * 1000;

server.listen(port, () => {
  const ai = process.env.ANTHROPIC_API_KEY ? 'Claude' : process.env.OPENAI_API_KEY ? 'OpenAI' : 'off (manual review only)';
  console.log(`Linewatch on ${cert ? 'https' : 'http'}://localhost:${port}  data: ${dataDir}  AI: ${ai}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); app.close(); process.exit(0); });
