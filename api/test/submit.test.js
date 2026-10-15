'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handleSubmit, principal } = require('../src/lib/handleSubmit');

const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const who = (email = 'sean.lawless@northstarhg.co.uk') => ({ 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: email, userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'name', val: 'Sean Lawless' }] })).toString('base64') });
const form = over => ({
  id: 'abc123', officer: 'Laurie Edmundson', date: '2026-10-15', address: 'WEBB HOUSE, Flat 3, 7 Zetland Road, Middlesbrough, TS1 1EH', propRef: 'ZETL0200703', propType: 'Flat',
  gasCap: 'Yes', epc: 'No', utilities: 'Yes', elec: 'Yes', pat: 'No', redec: 'Part', colour: 'White', cc: 'voids@northstarhg.co.uk, laurie.edmundson@northstarhg.co.uk',
  rooms: [
    { name: 'Bed 1', type: 'living', ticks: { 0: { qty: '1' }, 10: { qty: '4.5' } }, extra: [], notes: '', photoCount: 2 },
    { name: 'Bathroom', type: 'bathroom', ticks: { 7: { qty: '1' } }, extra: [{ id: '630521', code: '630521', qty: '1', rate: 0.01 }], notes: '' },
    { name: 'Other general repairs', type: 'general', ticks: { 2: { qty: '2', where: 'Whole flat' } }, extra: [] },
  ], ...over,
});
const run = async (body, headers = who()) => { let sent = null; const r = await handleSubmit({ headers, body }, { postToFlow: async p => { sent = p; return { ok: true, status: 200 }; }, now: () => new Date('2026-10-15T10:00:00Z') }); return { ...r, sent }; };

test('rejects anyone not signed in', async () => {
  const r = await run({ form: form(), pdfBase64: PDF }, {});
  assert.equal(r.status, 401); assert.equal(r.sent, null);
});

test('reads the Entra user from the Static Web Apps header', () => {
  assert.deepEqual(principal(who()), { name: 'Sean Lawless', email: 'sean.lawless@northstarhg.co.uk' });
});

test('shapes the flow payload and re-prices SORs from the book', async () => {
  const r = await run({ form: form(), pdfBase64: PDF });
  assert.equal(r.status, 200);
  const p = r.sent;
  assert.match(p.reference, /^VPI-20261015-[0-9A-F]{4}$/);
  assert.equal(p.worksItems.length, 5);
  const extra = p.worksItems.find(w => w.AddedFromBook);
  assert.ok(extra.Rate > 1, 'extra SOR priced from the book, not the browser');
  const mould = p.worksItems.find(w => w.SORCode === '442511');
  assert.equal(mould.Quantity, 4.5);
  assert.equal(p.sharepointItem.WorksCount, 5);
  assert.equal(p.sharepointItem.PhotoCount, 2);
  assert.equal(p.worksValue, Math.round(p.worksItems.reduce((a, w) => a + w.LineValue, 0) * 100) / 100);
  assert.equal(p.emailTo, 'sean.lawless@northstarhg.co.uk');
  assert.equal(p.emailCc, 'Laurie.Edmundson@northstarhg.co.uk;voids@northstarhg.co.uk', 'officer CC once, case-insensitive');
  assert.match(p.recordFileName, /^VPI-20261015-.{4} - WEBB HOUSE, Flat 3 - Void Pre-Inspection - 15-10-2026\.pdf$/);
  assert.match(p.sharepointItem.SORText, /460012  Final clean .* x 2  \(Whole flat\)/);
  assert.equal(p.pdfBase64, PDF);
});

test('no-works voids send no works rows and flag the subject', async () => {
  const r = await run({ form: form({ noWorks: true }), pdfBase64: PDF });
  assert.equal(r.status, 200);
  assert.equal(r.sent.worksItems.length, 0);
  assert.match(r.sent.emailSubject, /NO WORKS – close void/);
});

test('validation messages', async () => {
  const bad = async (over, re) => { const r = await run({ form: form(over), pdfBase64: PDF }); assert.equal(r.status, 400); assert.match(r.body.error, re); };
  await bad({ officer: '' }, /supported officer/);
  await bad({ officer: 'Someone Else' }, /from the list/);
  await bad({ epc: '' }, /EPC required/);
  await bad({ redec: '' }, /redecoration/);
  await bad({ rooms: [{ name: 'Bed 1', type: 'living', ticks: { 10: { qty: '' } } }] }, /area in m²/);
  await bad({ rooms: [{ name: 'Bed 1', type: 'living', ticks: {} }] }, /Tick at least one/);
  await bad({ rooms: [{ name: 'Bed 1', type: 'living', ticks: {}, extra: [{ id: 'nope', code: 'nope', qty: '1' }] }] }, /not in the NHF8 book/);
  const notPdf = await run({ form: form(), pdfBase64: Buffer.from('hello').toString('base64') });
  assert.equal(notPdf.status, 400);
});

test('a flow failure is reported, not hidden', async () => {
  const r = await handleSubmit({ headers: who(), body: { form: form(), pdfBase64: PDF } }, { postToFlow: async () => ({ ok: false, status: 500 }) });
  assert.equal(r.status, 502);
});
