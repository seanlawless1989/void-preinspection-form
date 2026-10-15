// Local preview without Azure: serves site/, pretends you are signed in, and runs /api/submit
// against a mock flow that writes each submission to dev-submissions/ (JSON, PDF and email).
// Set FLOW_URL to send to a real flow instead.  Usage: npm run dev  →  http://localhost:4280
const http = require('http'), fs = require('fs'), path = require('path');
const { handleSubmit } = require('../api/src/lib/handleSubmit');
const root = path.join(__dirname, '..'), site = path.join(root, 'site'), out = path.join(root, 'dev-submissions');
const PORT = Number(process.env.PORT) || 4280;
const USER = { identityProvider: 'aad', userId: 'dev', userDetails: process.env.DEV_EMAIL || 'dev.user@northstarhg.co.uk', userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'name', val: process.env.DEV_NAME || 'Dev User' }] };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

async function postToFlow(p) {
  if (process.env.FLOW_URL) {
    const r = await fetch(process.env.FLOW_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    return { ok: r.ok, status: r.status, text: await r.text() };
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, p.reference + '.json'), JSON.stringify({ ...p, pdfBase64: `(${p.pdfBase64.length} chars)` }, null, 2));
  fs.writeFileSync(path.join(out, p.recordFileName), Buffer.from(p.pdfBase64, 'base64'));
  fs.writeFileSync(path.join(out, p.reference + '-email.html'), `<p>To: ${p.emailTo}<br>Cc: ${p.emailCc}<br>Subject: ${p.emailSubject}</p>` + p.emailHtml);
  console.log('Mock flow saved', p.reference, '→ dev-submissions/');
  return { ok: true, status: 200, text: JSON.stringify({ reference: p.reference }) };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (s, body, type = 'application/json') => { res.writeHead(s, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (url.pathname === '/.auth/me') return send(200, { clientPrincipal: USER });
  if (url.pathname === '/api/submit' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    const headers = { 'x-ms-client-principal': Buffer.from(JSON.stringify(USER)).toString('base64') };
    try { const r = await handleSubmit({ headers, body }, { postToFlow }); return send(r.status, r.body); }
    catch (e) { console.error(e); return send(500, { error: 'Server error' }); }
  }
  const file = path.join(site, path.normalize(url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'Not found', 'text/plain');
  send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`Void pre-inspection form on http://localhost:${PORT}`));
