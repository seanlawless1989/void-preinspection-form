'use strict';
const { app } = require('@azure/functions');
const { handleLoad, handleSave } = require('../lib/handleReview');

// REVIEW_LOAD_URL and REVIEW_SAVE_URL are the HTTP POST URLs of the two review flows (flow/README.md).
async function callFlow(setting, payload) {
  const url = process.env[setting];
  if (!url) return { ok: false, status: 503, text: `${setting} is not set` };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { ok: r.ok, status: r.status, text: await r.text().catch(() => '') };
}
const loadRecord = ref => callFlow('REVIEW_LOAD_URL', { reference: ref, dataFileName: `${ref}.json` });
const postToReview = payload => callFlow('REVIEW_SAVE_URL', payload);
const notOn = s => ({ status: 503, jsonBody: { error: `Surveyor review is not switched on yet (${s} is not set).` } });

app.http('review', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // Static Web Apps only lets signed-in users through (see staticwebapp.config.json)
  route: 'review',
  handler: async (request, context) => {
    const headers = Object.fromEntries(request.headers.entries());
    try {
      if (!process.env.REVIEW_LOAD_URL) return notOn('REVIEW_LOAD_URL');
      if (request.method === 'GET') {
        const res = await handleLoad({ headers, query: { ref: request.query.get('ref') } }, { loadRecord });
        if (res.status === 502) context.error('Review load flow failed');
        return { status: res.status, jsonBody: res.body };
      }
      if (!process.env.REVIEW_SAVE_URL) return notOn('REVIEW_SAVE_URL');
      let body = null;
      try { body = await request.json(); } catch { /* handled as "Nothing was sent" */ }
      const res = await handleSave({ headers, body }, { loadRecord, postToReview });
      if (res.status === 502) context.error('Review save flow failed');
      return { status: res.status, jsonBody: res.body };
    } catch (e) {
      context.error(e);
      return { status: 500, jsonBody: { error: 'Something went wrong. Try again in a minute.' } };
    }
  },
});
