'use strict';
const { app } = require('@azure/functions');
const { handleSubmit } = require('../lib/handleSubmit');

// Static Web Apps cuts an API call off at about 45 seconds and sends the browser a bare error page.
// Give up on the flow a little before that so the browser gets a proper answer it can retry on.
// The flow itself carries on and, if it finishes, the retry finds it already saved.
const FLOW_TIMEOUT_MS = Number(process.env.FLOW_TIMEOUT_MS) || 35000;
const CHECK_TIMEOUT_MS = 6000;

async function post(url, payload, ms) {
  const started = Date.now();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(ms) });
    return { ok: r.ok, status: r.status, text: await r.text().catch(() => ''), ms: Date.now() - started };
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, status: timedOut ? 504 : 0, timedOut, text: timedOut ? `no answer from the flow after ${ms / 1000}s` : String(e && (e.cause?.code || e.message) || e), ms: Date.now() - started };
  }
}

function postToFlow(payload) {
  if (!process.env.FLOW_URL) return { ok: false, status: 500, text: 'FLOW_URL is not set' };
  return post(process.env.FLOW_URL, payload, FLOW_TIMEOUT_MS);
}
// The review load flow (flow/README.md, Flow A) doubles as "is this reference already saved?".
const loadRecord = process.env.REVIEW_LOAD_URL
  ? ref => post(process.env.REVIEW_LOAD_URL, { reference: ref, dataFileName: `${ref}.json` }, CHECK_TIMEOUT_MS)
  : null;

app.http('submit', {
  methods: ['POST'],
  authLevel: 'anonymous', // Static Web Apps only lets signed-in users through (see staticwebapp.config.json)
  route: 'submit',
  handler: async (request, context) => {
    const started = Date.now();
    let body = null;
    try { body = await request.json(); } catch { /* handled as "Nothing was sent" */ }
    const headers = Object.fromEntries(request.headers.entries());
    try {
      const res = await handleSubmit({ headers, body }, { postToFlow, loadRecord });
      // One line per submission, so Application Insights (traces, search "submit:") shows every
      // attempt with its reference, how long the flow took and, on failure, what the flow said.
      const line = `submit: ${res.status} ${JSON.stringify({ ...(res.log || {}), totalMs: Date.now() - started })}`;
      if (res.status >= 500) context.error(line); else if (res.status >= 400) context.warn(`${line} ${JSON.stringify(res.body)}`); else context.log(line);
      return { status: res.status, jsonBody: res.body };
    } catch (e) {
      context.error('submit: 500 unexpected', e);
      return { status: 500, jsonBody: { error: 'Something went wrong on the server. Nothing was lost.', retry: true, code: 'server-500' } };
    }
  },
});
