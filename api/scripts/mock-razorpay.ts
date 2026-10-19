import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const links = new Set<string>();
const expected = 'Basic ' + Buffer.from('rzp_key:rzp_secret').toString('base64');

createServer((req, res) => {
  let raw = '';
  req.on('data', d => (raw += d));
  req.on('end', () => {
    let body: any = {};
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = {}; }
    }
    const authed = req.headers.authorization === expected;
    appendFileSync(join(tmpdir(), 'rzp-calls.log'), `${req.method} ${req.url} auth=${authed}${body.reference_id ? ' ref=' + body.reference_id : ''}\n`);
    const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!authed) return send(401, { error: { description: 'bad auth' } });

    if (req.method === 'POST' && req.url === '/v1/payment_links') {
      if (links.has(body.reference_id)) return send(400, { error: { description: 'reference_id already used' } });
      links.add(body.reference_id);
      return send(200, { id: 'plink_mock_' + links.size, short_url: 'https://rzp.io/i/mock' + links.size, status: 'created' });
    }
    if (req.method === 'POST' && req.url === '/v2/accounts') return send(200, { id: 'acc_mock1' });
    if (req.method === 'POST' && /\/stakeholders$/.test(req.url!)) return send(200, { id: 'sth_mock1' });
    if (req.method === 'POST' && /\/products$/.test(req.url!)) return send(200, { id: 'acc_prd_mock1', activation_status: 'needs_clarification' });
    if (req.method === 'PATCH' && /\/products\//.test(req.url!)) return send(200, { activation_status: 'under_review' });
    if (req.method === 'GET' && req.url === '/v2/accounts/acc_mock1') return send(200, { id: 'acc_mock1', status: 'created' });
    send(404, { error: { description: 'not mocked' } });
  });
}).listen(Number(process.env.PORT ?? 4010));
