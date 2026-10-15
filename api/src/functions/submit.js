'use strict';
const { app } = require('@azure/functions');
const { handleSubmit } = require('../lib/handleSubmit');

async function postToFlow(payload) {
  const url = process.env.FLOW_URL;
  if (!url) return { ok: false, status: 500, text: 'FLOW_URL is not set' };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { ok: r.ok, status: r.status, text: await r.text().catch(() => '') };
}

app.http('submit', {
  methods: ['POST'],
  authLevel: 'anonymous', // Static Web Apps only lets signed-in users through (see staticwebapp.config.json)
  route: 'submit',
  handler: async (request, context) => {
    let body = null;
    try { body = await request.json(); } catch { /* handled as "Nothing was sent" */ }
    const headers = Object.fromEntries(request.headers.entries());
    try {
      const res = await handleSubmit({ headers, body }, { postToFlow });
      if (res.status === 502) context.error('Flow call failed');
      return { status: res.status, jsonBody: res.body };
    } catch (e) {
      context.error(e);
      return { status: 500, jsonBody: { error: 'Something went wrong. Submit again in a minute.' } };
    }
  },
});
