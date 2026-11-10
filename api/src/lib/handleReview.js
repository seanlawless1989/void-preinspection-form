'use strict';
// Surveyor review: a surveyor opens a submitted pre-inspection (with its photos), changes what
// needs changing and saves it. Saving makes a new PDF, updates the SharePoint rows and emails
// everyone who had the original. Two small flows do the SharePoint work (flow/README.md):
//   loadRecord(ref)   → the saved Data/<ref>.json, as { ok, status, text }
//   postToReview(json) → saves the new PDF and JSON, updates the list rows, sends the email
const VPI = require('../../shared/preinspection');
const SURVEYORS = require('../../shared/surveyors.json');
const S = require('./handleSubmit');
const { CAT, InputError, fail, esc, str, REF_RE } = S;

// Who may review: the HMS surveyors, plus a few Property Services people. REVIEWERS (app setting,
// comma separated) adds more; REVIEWERS=* lets anyone signed in to North Star review.
const EXTRA_REVIEWERS = ['Amy.Rose@northstarhg.co.uk', 'Fiona.McCulloch@northstarhg.co.uk', 'propertyservicesteam@northstarhg.co.uk', S.MONITOR_CC.email];
function canReview(email) {
  const env = String(process.env.REVIEWERS || '').split(/[,;\s]+/).filter(Boolean);
  if (env.includes('*')) return true;
  const all = [...Object.values(SURVEYORS.emails || {}), ...EXTRA_REVIEWERS, ...env].map(e => e.toLowerCase());
  return all.includes(String(email || '').toLowerCase());
}

// The flow returns the JSON file either as text or, depending on the SharePoint action, wrapped as
// { "$content-type": ..., "$content": "<base64>" }. Both are accepted.
function parseRecord(text) {
  let j = typeof text === 'string' ? JSON.parse(text) : text;
  if (j && typeof j === 'object' && typeof j.$content === 'string') j = JSON.parse(Buffer.from(j.$content, 'base64').toString('utf8'));
  if (typeof j === 'string') j = JSON.parse(j);
  return j;
}

async function getRecord(ref, loadRecord) {
  const r = await loadRecord(ref);
  if (r.status === 404) return { error: { status: 404, body: { error: `No saved form was found for ${ref}. Pre-inspections sent before surveyor review was switched on can't be opened here: use the PDF in the Void Pre-Inspection Records library instead.` } } };
  if (!r.ok) return { error: { status: 502, body: { error: 'The pre-inspection could not be fetched from SharePoint just now. Try again in a minute.' } } };
  let rec;
  try { rec = parseRecord(r.text); } catch { rec = null; }
  if (!rec || rec.reference !== ref || !rec.form || !Array.isArray(rec.form.rooms)) return { error: { status: 502, body: { error: `The saved form for ${ref} could not be read.` } } };
  rec.revision = Number(rec.revision) || 0;
  rec.history = Array.isArray(rec.history) ? rec.history : [];
  return { rec };
}

function who(headers) {
  const user = S.principal(headers || {});
  if (!user) return { error: { status: 401, body: { error: 'Please sign in.' } } };
  if (!canReview(user.email)) return { error: { status: 403, body: { error: 'Only Property Services surveyors can review and change a submitted pre-inspection. Ask Sean Lawless if you need access.' } } };
  return { user };
}

// GET /api/review?ref=VPI-...
async function handleLoad({ headers, query }, { loadRecord }) {
  const w = who(headers);
  if (w.error) return w.error;
  const ref = String(query?.ref || '').trim().toUpperCase();
  if (!REF_RE.test(ref)) return { status: 400, body: { error: 'That is not a pre-inspection reference. It looks like VPI-20261015-D632.' } };
  const g = await getRecord(ref, loadRecord);
  if (g.error) return g.error;
  return { status: 200, body: { record: g.rec, reviewer: w.user } };
}

function reviewEmail(f, ref, rec, user, changes, notes, revision, surveyor, reviewUrl) {
  const addr = VPI.addr1(f.address);
  return `<div style="font-family:Arial,sans-serif;color:#06122b">
<h2 style="color:#005291">Void pre-inspection reviewed: ${esc(addr)}</h2>
<p>Reference <b>${esc(ref)}</b>, review ${revision}. ${esc(user.name)} has reviewed this pre-inspection${changes.length ? ' and changed it' : ''}. The updated PDF is attached and saved in the Void Pre-Inspection Records library, and the SharePoint lists now show the updated works.</p>
<p style="color:#46566b;font-size:13px">First submitted by ${esc(rec.submittedBy?.name || '')} on ${esc(VPI.ukDate(String(rec.submittedAt || '').slice(0, 10)))}. Property surveyor in HMS: ${esc(surveyor.fallback ? 'not found' : surveyor.name)}.</p>
${f.noWorks ? '<p style="background:#fff8db;padding:8px 12px"><b>No repairs needed. Please close off this void.</b></p>' : ''}
<h3 style="color:#005291">What changed</h3>
${changes.length ? `<ul>${changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p>No changes to the form: reviewed and agreed.</p>'}
${notes ? `<h3 style="color:#005291">Surveyor's notes</h3><p style="white-space:pre-line">${esc(notes)}</p>` : ''}
<h3 style="color:#005291">SOR codes by room (copy and paste)</h3>
<pre style="background:#e9f8f5;padding:12px;font-size:13px">${esc(VPI.sorText(f, CAT))}</pre>
${S.inventoryHtml(f)}${reviewUrl ? S.reviewButton(reviewUrl, 'Open it again to make more changes') : ''}</div>`;
}

// POST /api/review  { reference, baseRevision, notes, form, pdfBase64 }
async function handleSave({ headers, body }, { loadRecord, postToReview, now = () => new Date() }) {
  const w = who(headers);
  if (w.error) return w.error;
  const user = w.user;
  let f, ref, notes;
  try {
    if (!body || typeof body !== 'object') fail('Nothing was sent.');
    ref = String(body.reference || '').trim().toUpperCase();
    if (!REF_RE.test(ref)) fail('The pre-inspection reference is missing.');
    notes = str(body.notes, 2000).trim();
    f = S.clean(body.form);
    S.validate(f);
    if (typeof body.pdfBase64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(body.pdfBase64)) fail('The PDF report is missing.');
    const bytes = Buffer.from(body.pdfBase64, 'base64');
    if (bytes.length > S.MAX_PDF_BYTES) fail('The report is too large. Remove some photos and save again.');
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') fail('The report is not a PDF.');
  } catch (e) {
    if (e instanceof InputError) return { status: 400, body: { error: e.message } };
    throw e;
  }

  const g = await getRecord(ref, loadRecord);
  if (g.error) return g.error;
  const prev = g.rec;
  if (Number(body.baseRevision) !== prev.revision) {
    const last = prev.history[prev.history.length - 1];
    return { status: 409, body: { error: `${last?.by?.name || 'Someone'} saved a review of ${ref} after you opened it. Reload the page to see their changes, then make yours again.` } };
  }

  const at = now().toISOString();
  const revision = prev.revision + 1;
  const changes = VPI.changes(prev.form, f, CAT);
  const { works, inventoryItems, total, sharepointItem } = S.buildRows(f, ref, prev.submittedAt, prev.submittedBy || {});
  const { Title, SubmittedAt, SubmittedBy, SubmittedByEmail, SubmissionId, ...rest } = sharepointItem;
  const listUpdate = {
    ...rest,
    ReviewStatus: 'Reviewed by surveyor',
    Revision: revision,
    ReviewedBy: user.name,
    ReviewedByEmail: user.email,
    ReviewedAt: at,
    ReviewNotes: notes,
    ReviewChanges: changes.length ? changes.join('\n') : 'No changes: reviewed and agreed',
  };
  const history = [...prev.history, { revision, at, by: user, notes, changes }];
  const record = { ...prev, schema: 1, revision, status: 'Reviewed', form: f, history };
  const addr = VPI.addr1(f.address);
  const surveyor = S.surveyorFor(f.propRef);
  const monitor = at < S.MONITOR_CC.until ? S.MONITOR_CC.email : '';
  const earlier = prev.history.map(h => h.by?.email);
  const cc = S.ccList([prev.submittedBy?.email, VPI.officerEmail(f), surveyor.fallback ? '' : surveyor.email, ...earlier, monitor], user.email);
  const reviewUrl = S.reviewLink(headers || {}, ref);

  const payload = {
    reference: ref,
    revision,
    reviewedAt: at,
    reviewedByName: user.name,
    reviewedByEmail: user.email,
    recordFileName: `${ref} - ${S.safeName(addr || 'Property').slice(0, 60)} - Void Pre-Inspection - ${VPI.ukDate(f.date).replace(/\//g, '-')} - Review ${revision}.pdf`,
    pdfBase64: body.pdfBase64,
    dataFileName: `${ref}.json`,
    recordJson: JSON.stringify(record),
    listUpdate,
    worksItems: works,
    inventoryItems,
    noWorks: f.noWorks,
    worksValue: total,
    changes,
    reviewUrl,
    emailTo: user.email,
    emailCc: cc.join(';'),
    emailSubject: `Void pre-inspection reviewed${f.noWorks ? ' (NO WORKS – close void)' : ''} – ${addr} – ${VPI.ukDate(f.date)} – ${ref} (review ${revision})`,
    emailHtml: reviewEmail(f, ref, prev, user, changes, notes, revision, surveyor, reviewUrl),
  };
  const res = await postToReview(payload);
  if (!res.ok) return { status: 502, body: { error: 'The review could not be saved just now. Nothing was lost: save again in a minute.' } };
  return { status: 200, body: { reference: ref, revision, changes, worksCount: works.length } };
}

module.exports = { handleLoad, handleSave, canReview, parseRecord };
