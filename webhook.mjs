import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function createWebhookServer({ secret, handle, isReady = () => true }) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret || '')) throw new Error('WEBHOOK_SECRET должен содержать 32–256 символов A-Z, a-z, 0-9, _ или -.');
  const processed = new Set();
  const inFlight = new Map();
  return createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return reply(isReady() ? 200 : 503, { ok: isReady() });
    if (req.method !== 'POST' || req.url !== '/telegram') return reply(404, { ok: false });
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (typeof header !== 'string' || Buffer.byteLength(header) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(header), Buffer.from(secret))) return reply(403, { ok: false });
    if (!isReady()) return reply(503, { ok: false });
    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw) > 1024 * 1024) return reply(413, { ok: false });
      }
      const update = JSON.parse(raw);
      if (!Number.isSafeInteger(update.update_id)) return reply(400, { ok: false });
      if (!processed.has(update.update_id)) {
        if (!inFlight.has(update.update_id)) {
          const task = Promise.resolve().then(() => handle(update)).then(() => {
            if (processed.size >= 1000) processed.delete(processed.values().next().value);
            processed.add(update.update_id);
          }).finally(() => inFlight.delete(update.update_id));
          inFlight.set(update.update_id, task);
        }
        await inFlight.get(update.update_id);
      }
      return reply(200, { ok: true });
    } catch {
      return reply(500, { ok: false });
    }
  });
}
