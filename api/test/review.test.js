'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handleSubmit } = require('../src/lib/handleSubmit');
const { handleLoad, handleSave, canReview, parseRecord } = require('../src/lib/handleReview');
const SV = require('../shared/surveyors.json');
SV.properties = { ZETL0200703: 'Jakub Napierala' };

const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
const who = (email, name = 'Someone') => ({ 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: email, userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'name', val: name }] })).toString('base64'), host: 'void.example.net' });
const OFFICER = who('Laurie.Edmundson@northstarhg.co.uk', 'Laurie Edmundson');
const SURVEYOR = who('Jakub.Napierala@northstarhg.co.uk', 'Jakub Napierala');
const form = over => ({
  id: 'abc123', officer: 'Laurie Edmundson', date: '2026-11-03', address: 'WEBB HOUSE, Flat 3, 7 Zetland Road, Middlesbrough, TS1 1EH', propRef: 'ZETL0200703', propType: 'Flat',
  gasCap: 'Yes', epc: 'No', utilities: 'Yes', elec: 'Yes', pat: 'No', redec: 'Part', colour: 'White', cc: '',
  inventory: { on: false },
  rooms: [
    { id: 'r1', name: 'Bed 1', type: 'living', ticks: { 0: { qty: '1' }, 10: { qty: '4.5' } }, extra: [], notes: '', photos: [PHOTO] },
    { id: 'r2', name: 'Kitchen', type: 'kitchen', ticks: { 5: { qty: '1' } }, extra: [], notes: '' },
  ], ...over,
});

// A fake SharePoint: the submit flow saves Data/<ref>.json, the load flow reads it back.
function fakeSharePoint() {
  const files = {}, sent = [];
  return {
    files, sent,
    postToFlow: async p => { files[p.dataFileName] = p.recordJson; sent.push(p); return { ok: true, status: 200 }; },
    loadRecord: async ref => files[ref + '.json'] ? { ok: true, status: 200, text: files[ref + '.json'] } : { ok: false, status: 404, text: '' },
    postToReview: async p => { files[p.dataFileName] = p.recordJson; sent.push(p); return { ok: true, status: 200 }; },
  };
}
async function submitted(sp) {
  const r = await handleSubmit({ headers: OFFICER, body: { form: form(), pdfBase64: PDF } }, { postToFlow: sp.postToFlow, now: () => new Date('2026-11-03T10:00:00Z') });
  assert.equal(r.status, 200);
  return r.body.reference;
}

test('submitting saves the whole form, photos included, and links to the review page', async () => {
  const sp = fakeSharePoint();
  const ref = await submitted(sp);
  const p = sp.sent[0];
  assert.equal(p.dataFileName, ref + '.json');
  const rec = JSON.parse(p.recordJson);
  assert.equal(rec.revision, 0);
  assert.equal(rec.form.rooms[0].photos[0], PHOTO);
  assert.equal(p.sharepointItem.PhotoCount, 1);
  assert.equal(p.reviewUrl, `https://void.example.net/?review=${ref}`);
  assert.match(p.emailHtml, /review or change this pre-inspection/);
});

test('only surveyors can open a pre-inspection for review', async () => {
  const sp = fakeSharePoint();
  const ref = await submitted(sp);
  assert.equal((await handleLoad({ headers: OFFICER, query: { ref } }, sp)).status, 403);
  assert.equal((await handleLoad({ headers: {}, query: { ref } }, sp)).status, 401);
  assert.equal((await handleLoad({ headers: SURVEYOR, query: { ref: '../x' } }, sp)).status, 400);
  assert.equal((await handleLoad({ headers: SURVEYOR, query: { ref: 'VPI-20200101-AAAA' } }, sp)).status, 404);
  const ok = await handleLoad({ headers: SURVEYOR, query: { ref: ref.toLowerCase() } }, sp);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.record.reference, ref);
  assert.equal(ok.body.reviewer.name, 'Jakub Napierala');
  assert.ok(canReview('sean.lawless@northstarhg.co.uk'));
  assert.ok(!canReview('someone@northstarhg.co.uk'));
});

test('a surveyor change makes a new revision, lists what changed and updates the list rows', async () => {
  const sp = fakeSharePoint();
  const ref = await submitted(sp);
  const { record } = (await handleLoad({ headers: SURVEYOR, query: { ref } }, sp)).body;
  const f = JSON.parse(JSON.stringify(record.form));
  f.rooms[0].ticks[10].qty = '6';          // mould wash area changed
  delete f.rooms[1].ticks[5];              // worktop reseal removed
  f.rooms[1].extra.push({ id: '630521', code: '630521', qty: '1' });
  f.colour = 'Grey';
  const r = await handleSave({ headers: SURVEYOR, body: { reference: ref, baseRevision: 0, notes: 'Checked on site.', form: f, pdfBase64: PDF } }, { ...sp, now: () => new Date('2026-11-05T09:00:00Z') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.revision, 1);
  const p = sp.sent[1];
  assert.match(p.recordFileName, / - Review 1\.pdf$/);
  assert.ok(p.changes.some(c => /Bed 1: 442511 .* quantity 4\.5 m² → 6 m²/.test(c)), p.changes.join('\n'));
  assert.ok(p.changes.some(c => /Kitchen: removed 631507/.test(c)));
  assert.ok(p.changes.some(c => /Kitchen: added 630521/.test(c)));
  assert.ok(p.changes.includes('Colour: "White" → "Grey"'));
  assert.equal(p.listUpdate.Revision, 1);
  assert.equal(p.listUpdate.ReviewedBy, 'Jakub Napierala');
  assert.equal(p.listUpdate.ReviewNotes, 'Checked on site.');
  assert.equal(p.listUpdate.Title, undefined, 'the reference and who submitted it are never overwritten');
  assert.equal(p.listUpdate.SubmittedBy, undefined);
  assert.ok(p.worksItems.every(w => w.Title === ref));
  assert.ok(p.worksItems.some(w => w.SORCode === '630521' && w.Rate > 1));
  assert.equal(p.emailTo, 'Jakub.Napierala@northstarhg.co.uk');
  assert.ok(p.emailCc.split(';').includes('Laurie.Edmundson@northstarhg.co.uk'), 'the officer who submitted it gets the update');
  assert.match(p.emailSubject, /reviewed .* \(review 1\)$/);
  const saved = JSON.parse(sp.files[ref + '.json']);
  assert.equal(saved.revision, 1);
  assert.equal(saved.submittedBy.name, 'Laurie Edmundson');
  assert.equal(saved.history[0].by.name, 'Jakub Napierala');
  assert.equal(saved.form.rooms[0].photos.length, 1, 'photos kept');
});

test('a stale copy is refused instead of overwriting a newer review', async () => {
  const sp = fakeSharePoint();
  const ref = await submitted(sp);
  const { record } = (await handleLoad({ headers: SURVEYOR, query: { ref } }, sp)).body;
  const body = { reference: ref, baseRevision: 0, notes: '', form: record.form, pdfBase64: PDF };
  assert.equal((await handleSave({ headers: SURVEYOR, body }, sp)).status, 200);
  const again = await handleSave({ headers: SURVEYOR, body }, sp);
  assert.equal(again.status, 409);
  assert.match(again.body.error, /Jakub Napierala saved a review/);
});

test('no changes is allowed and recorded as agreed', async () => {
  const sp = fakeSharePoint();
  const ref = await submitted(sp);
  const { record } = (await handleLoad({ headers: SURVEYOR, query: { ref } }, sp)).body;
  const r = await handleSave({ headers: SURVEYOR, body: { reference: ref, baseRevision: 0, form: record.form, pdfBase64: PDF } }, sp);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.changes, []);
  assert.match(sp.sent[1].listUpdate.ReviewChanges, /reviewed and agreed/);
});

test('the review still validates the form', async () => {
  const sp = fakeSharePoint();
  const ref = await submitted(sp);
  const r = await handleSave({ headers: SURVEYOR, body: { reference: ref, baseRevision: 0, form: form({ epc: '' }), pdfBase64: PDF } }, sp);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /EPC required/);
});

test('reads the JSON file however SharePoint returns it', () => {
  const rec = { reference: 'VPI-20261103-ABCD' };
  assert.deepEqual(parseRecord(JSON.stringify(rec)), rec);
  assert.deepEqual(parseRecord(JSON.stringify({ '$content-type': 'application/octet-stream', $content: Buffer.from(JSON.stringify(rec)).toString('base64') })), rec);
  assert.deepEqual(parseRecord(JSON.stringify(JSON.stringify(rec))), rec);
});
