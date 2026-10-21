'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handleSubmit, principal } = require('../src/lib/handleSubmit');
// The tests don't depend on the live property-to-surveyor list; each one that needs a surveyor sets it.
const SV = require('../shared/surveyors.json');
SV.properties = {};

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
  assert.equal(p.emailCc, 'Laurie.Edmundson@northstarhg.co.uk;propertyservicesteam@northstarhg.co.uk;voids@northstarhg.co.uk', 'officer CC once, case-insensitive');
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
  await bad({ officer: '' }, /who completed/);
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

test('property surveyors can be chosen as the person completing the form', async () => {
  const VPI = require('../../shared/preinspection');
  for (const n of ['Jakub Napierala', 'Amy Rose', 'Azhir Bashir', 'Deborah Olver', "Callum O'Reilly", 'Fiona McCulloch', 'Alex McGirr'])
    assert.ok(VPI.OFFICERS.some(o => o[0] === n && /@northstarhg\.co\.uk$/.test(o[1])), n);
  const r = await run({ form: form({ officer: 'Amy Rose', cc: '' }), pdfBase64: PDF });
  assert.equal(r.status, 200);
  assert.equal(r.sent.emailCc, 'Amy.Rose@northstarhg.co.uk;propertyservicesteam@northstarhg.co.uk');
  assert.equal(r.sent.sharepointItem.Officer, 'Amy Rose');
});

test('inventory is optional and left out when not switched on', async () => {
  const r = await run({ form: form(), pdfBase64: PDF });
  assert.equal(r.status, 200);
  assert.equal(r.sent.hasInventory, false);
  assert.equal(r.sent.inventoryText, '');
  assert.deepEqual(r.sent.inventoryItems, []);
  assert.match(r.sent.emailHtml, /No inventory was completed/);
  assert.ok(!('Inventory' in r.sent.sharepointItem), 'list rows are unchanged so the existing SharePoint list keeps working');
});

test('inventory is cleaned, summarised and added to the email', async () => {
  const inventory = { on: true, access: 'Keysafe 1234', clearance: 'Skip needed',
    rooms: {
      kitchen: { items: { 0: { act: 'remove', clean: true }, 1: { act: 'stay', clean: false }, 2: { act: 'bogus', clean: false }, 99: { act: 'stay' } }, lists: { Other: [{ text: 'Ironing board', act: 'remove', clean: false }, { text: '  ', act: 'stay' }] } },
      nope: { items: { 0: { act: 'stay' } } },
    } };
  const r = await run({ form: form({ inventory }), pdfBase64: PDF });
  assert.equal(r.status, 200);
  assert.equal(r.sent.hasInventory, true);
  assert.match(r.sent.inventoryText, /Cooker – REMOVE \+ CLEAN/);
  assert.match(r.sent.inventoryText, /Washing machine – STAY\n/);
  assert.match(r.sent.inventoryText, /Other: Ironing board – REMOVE/);
  assert.ok(!/bogus|nope|99/i.test(r.sent.inventoryText));
  assert.match(r.sent.inventoryText, /Access instructions: Keysafe 1234/);
  assert.match(r.sent.emailHtml, /Inventory/);
  assert.match(r.sent.emailHtml, /Skip needed/);
  assert.equal(r.sent.inventoryItems.length, 3);
  const cooker = r.sent.inventoryItems.find(i => i.Item === 'Cooker');
  assert.deepEqual({ ...cooker }, { Title: r.sent.reference, Room: 'Kitchen', Item: 'Cooker', Decision: 'Remove', Clean: true, Address: 'WEBB HOUSE, Flat 3, 7 Zetland Road, Middlesbrough, TS1 1EH', PropertyRef: 'ZETL0200703', AccessInstructions: 'Keysafe 1234', ClearanceInstructions: 'Skip needed' });
});

test('inventory works on a no-works void and is validated when switched on', async () => {
  const ok = await run({ form: form({ noWorks: true, inventory: { on: true, rooms: { lounge: { items: { 0: { act: 'stay' } }, lists: {} } } } }), pdfBase64: PDF });
  assert.equal(ok.status, 200); assert.equal(ok.sent.worksItems.length, 0); assert.match(ok.sent.inventoryText, /Flooring \/ carpet – STAY/);
  const empty = await run({ form: form({ inventory: { on: true, rooms: {} } }), pdfBase64: PDF });
  assert.equal(empty.status, 400); assert.match(empty.body.error, /nothing is recorded/);
  const undecided = await run({ form: form({ inventory: { on: true, rooms: { lounge: { items: {}, lists: { Furniture: [{ text: 'Sofa' }] } } } } }), pdfBase64: PDF });
  assert.equal(undecided.status, 400); assert.match(undecided.body.error, /Stay, Remove or Clean/);
});

test('copies in the property surveyor from HMS', async () => {
  SV.properties.ZETL0200703 = 'Denise Manning';
  try {
    const r = await run({ form: form({ cc: '' }), pdfBase64: PDF });
    assert.equal(r.status, 200);
    assert.equal(r.sent.emailCc, `Laurie.Edmundson@northstarhg.co.uk;${SV.emails['Denise Manning']}`);
    assert.equal(r.sent.surveyorName, 'Denise Manning');
    assert.equal(r.sent.surveyorFound, true);
    assert.match(r.sent.emailHtml, /Property surveyor.*Denise Manning/);
    const other = await run({ form: form({ cc: '', propRef: 'NOPE0000000' }), pdfBase64: PDF });
    assert.equal(other.sent.emailCc, 'Laurie.Edmundson@northstarhg.co.uk;propertyservicesteam@northstarhg.co.uk', 'no surveyor known: Property Services team instead');
    assert.equal(other.sent.surveyorFound, false);
    assert.match(other.sent.emailHtml, /Not found in HMS, copied to the Property Services team/);
    const noRef = await run({ form: form({ cc: '', propRef: '' }), pdfBase64: PDF });
    assert.equal(noRef.sent.emailCc, 'Laurie.Edmundson@northstarhg.co.uk;propertyservicesteam@northstarhg.co.uk');
  } finally { delete SV.properties.ZETL0200703; }
});

test('Sean is copied in while the form beds in, then not', async () => {
  const send = async when => { let sent; await handleSubmit({ headers: who('clare.latham@northstarhg.co.uk'), body: { form: form({ cc: '' }), pdfBase64: PDF } }, { postToFlow: async p => { sent = p; return { ok: true }; }, now: () => new Date(when) }); return sent; };
  assert.equal((await send('2026-10-21T13:00:00Z')).emailCc, 'Laurie.Edmundson@northstarhg.co.uk;propertyservicesteam@northstarhg.co.uk;sean.lawless@northstarhg.co.uk');
  assert.equal((await send('2026-12-01T09:00:00Z')).emailCc, 'Laurie.Edmundson@northstarhg.co.uk;propertyservicesteam@northstarhg.co.uk');
});

test('redecoration can be No (no redecoration needed)', async () => {
  const r = await run({ form: form({ redec: 'No', colour: '' }), pdfBase64: PDF });
  assert.equal(r.status, 200);
  assert.equal(r.sent.sharepointItem.Redecoration, 'No');
  assert.match(r.sent.emailHtml, /<b>Redecoration<\/b><\/td><td[^>]*>No</);
});
