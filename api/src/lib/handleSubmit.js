'use strict';
// Checks a submitted void pre-inspection, re-prices every SOR from the NHF8 book and hands the
// Power Automate flow everything it needs, already shaped: the PDF, the SharePoint list rows and
// the email. The flow only copies fields across, so all the rules live here.
const crypto = require('crypto');
const VPI = require('../../shared/preinspection');
const CAT = VPI.catalogue(require('../../shared/sors.json'));

const MAX_PDF_BYTES = 6e6;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const str = (v, max = 2000) => String(v ?? '').slice(0, max);
const safeName = s => String(s).replace(/[\\/:*?"<>|#%~&{}]+/g, ' ').replace(/\s+/g, ' ').trim();

class InputError extends Error {}
const fail = m => { throw new InputError(m); };

// Who is signed in, from the header Azure Static Web Apps adds after Entra sign-in.
function principal(headers) {
  const raw = headers['x-ms-client-principal'];
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!p || !(p.userRoles || []).includes('authenticated')) return null;
    const claim = t => (p.claims || []).find(c => c.typ === t)?.val;
    const email = claim('preferred_username') || claim('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress') || p.userDetails;
    return { name: claim('name') || p.userDetails, email };
  } catch { return null; }
}

function clean(f) {
  if (!f || typeof f !== 'object') fail('The form is missing.');
  const o = {};
  for (const k of ['id', 'officer', 'officerOther', 'propRef', 'date', 'address', 'propType', 'duration', 'keysafe', 'access', 'hs', 'redec', 'redecOther', 'colour', 'colourOther', 'notes', 'external', 'cc', 'stockRecord'])
    o[k] = str(f[k]).trim();
  for (const [k] of VPI.YN) o[k] = str(f[k]);
  o.noWorks = f.noWorks === true;
  if (!Array.isArray(f.rooms) || f.rooms.length > 40) fail('The rooms are missing.');
  o.rooms = f.rooms.map(r => {
    if (!VPI.ITEMS[r?.type]) fail('A room has an unknown type.');
    const ticks = {};
    for (const [i, t] of Object.entries(r.ticks || {})) {
      if (!VPI.ITEMS[r.type][+i]) fail(`${str(r.name, 60)}: unknown repair.`);
      ticks[+i] = { qty: str(t?.qty, 12), where: str(t?.where, 200) };
    }
    const extra = (Array.isArray(r.extra) ? r.extra : []).slice(0, 60).map(e => {
      const s = (e?.id && CAT.byId.get(String(e.id))) || CAT.byCode.get(String(e?.code));
      if (!s) fail(`${str(r.name, 60)}: SOR ${str(e?.code, 20)} is not in the NHF8 book.`);
      return { id: s.id, code: s.code, qty: str(e.qty, 12) };
    });
    return { name: str(r.name, 80).trim() || 'Room', type: r.type, ticks, extra, notes: str(r.notes), photoCount: Math.max(0, Math.min(99, Number(r.photoCount) || 0)) };
  });
  return o;
}

function validate(f) {
  if (!VPI.officerName(f)) fail('Choose the supported officer.');
  if (f.officer && f.officer !== 'Other' && !VPI.OFFICERS.some(o => o[0] === f.officer)) fail('Choose the supported officer from the list.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) fail('Enter the date of inspection.');
  if (!f.address) fail('Enter the property address.');
  for (const [k, l] of VPI.YN) if (!['Yes', 'No'].includes(f[k])) fail(`Answer Yes or No for "${l}".`);
  for (const [k, vals] of Object.entries(VPI.CHOICES)) if (f[k] && !vals.includes(f[k])) fail(`Choose a valid ${k === 'redec' ? 'redecoration' : 'colour'}.`);
  if (!f.redec) fail('Choose the redecoration: full, part or other.');
  if (f.redec === 'Other' && !f.redecOther) fail('Describe the redecoration for "Other".');
  if (f.colour === 'Other' && !f.colourOther) fail('Give the colour for "Other".');
  if (f.noWorks) return;
  let any = false;
  for (const r of f.rooms) for (const l of VPI.lines(r, CAT)) {
    any = true;
    const q = Number(l.qty);
    if (!(q > 0 && q < 10000)) fail(`${r.name}: enter the ${l.sqm ? 'area in m²' : 'quantity'} for "${l.label}".`);
  }
  if (!any) fail('Tick at least one repair, or tick "No repairs needed" if this void needs no works.');
}

function reference(f, submittedAt) {
  const h = crypto.createHash('sha256').update(f.id + '|' + submittedAt).digest('hex').slice(0, 4).toUpperCase();
  return `VPI-${submittedAt.slice(0, 10).replace(/-/g, '')}-${h}`;
}

function emailHtml(f, ref, works, total, by) {
  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:4px 0">${esc(v)}</td></tr>`;
  return `<div style="font-family:Arial,sans-serif;color:#06122b">
<h2 style="color:#005291">Void pre-inspection: ${esc(VPI.addr1(f.address))}</h2>
<p>Reference <b>${esc(ref)}</b>, submitted by ${esc(by.name)}. The PDF report is attached and saved in the Void Pre-Inspection Records library.</p>
${f.noWorks ? '<p style="background:#fff8db;padding:8px 12px"><b>No repairs needed. Please close off this void.</b></p>' : `<p>${works.length} repair${works.length === 1 ? '' : 's'}, estimated ${money(total)} at NHF8 base rates.</p>`}
<table>${row('Supported officer', VPI.officerName(f))}${row('Date', VPI.ukDate(f.date))}${row('Address', f.address.replace(/\s*\n\s*/g, ', '))}${row('Property reference', f.propRef || '—')}${row('Property type', f.propType || '—')}${f.stockRecord ? row('Stock record', f.stockRecord) : ''}${row('Void duration', f.duration || '—')}${row('Keysafe number', f.keysafe || '—')}${row('Access', f.access || '—')}${VPI.YN.map(([k, l]) => row(l, f[k])).join('')}${row('Redecoration', VPI.choice(f, 'redec', 'redecOther'))}${row('Colour', VPI.choice(f, 'colour', 'colourOther'))}${row('H&S issues', f.hs || 'None recorded')}${row('Notes / appointments', f.notes || '—')}${row('External works', f.external || '—')}</table>
<h3 style="color:#005291">SOR codes by room (copy and paste)</h3>
<pre style="background:#e9f8f5;padding:12px;font-size:13px">${esc(VPI.sorText(f, CAT))}</pre>
<p style="color:#46566b;font-size:12px">The inventory (items to leave or remove) is recorded on a separate sheet.</p></div>`;
}

// Returns { status, body }. postToFlow(json) must resolve to { ok, status, text }.
async function handleSubmit({ headers, body }, { postToFlow, now = () => new Date() }) {
  const user = principal(headers || {});
  if (!user) return { status: 401, body: { error: 'Please sign in.' } };
  let f;
  try {
    if (!body || typeof body !== 'object') fail('Nothing was sent.');
    f = clean(body.form);
    validate(f);
    if (typeof body.pdfBase64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(body.pdfBase64)) fail('The PDF report is missing.');
    const bytes = Buffer.from(body.pdfBase64, 'base64');
    if (bytes.length > MAX_PDF_BYTES) fail('The report is too large. Remove some photos and submit again.');
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') fail('The report is not a PDF.');
  } catch (e) {
    if (e instanceof InputError) return { status: 400, body: { error: e.message } };
    throw e;
  }

  const submittedAt = now().toISOString();
  const ref = reference(f, submittedAt);
  const works = [];
  for (const r of f.rooms) for (const l of VPI.lines(r, CAT)) {
    const q = Number(l.qty);
    works.push({ Title: ref, Room: r.name, SORCode: l.code, Repair: l.label, SORDescription: l.description, Where: l.where, UOM: l.uom, Quantity: q, Rate: l.rate, LineValue: VPI.lineValue({ rate: l.rate, qty: q }), AddedFromBook: !!l.extra });
  }
  if (f.noWorks) works.length = 0;
  const total = Math.round(works.reduce((a, w) => a + w.LineValue, 0) * 100) / 100;
  const addr = VPI.addr1(f.address);
  const officerEmail = VPI.officerEmail(f);
  const cc = [officerEmail, ...f.cc.split(/[,;\s]+/)].map(x => x.trim())
    .filter((x, i, a) => EMAIL_RE.test(x) && x.toLowerCase() !== user.email.toLowerCase() && a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i)
    .slice(0, 10);

  const payload = {
    reference: ref,
    submissionId: f.id || ref,
    submittedAt,
    submittedByName: user.name,
    submittedByEmail: user.email,
    address: f.address.replace(/\s*\n\s*/g, ', '),
    propRef: f.propRef,
    noWorks: f.noWorks,
    worksValue: total,
    recordFileName: `${ref} - ${safeName(addr || 'Property').slice(0, 60)} - Void Pre-Inspection - ${VPI.ukDate(f.date).replace(/\//g, '-')}.pdf`,
    pdfBase64: body.pdfBase64,
    sharepointItem: {
      Title: ref,
      SubmittedAt: submittedAt,
      InspectionDate: f.date,
      Officer: VPI.officerName(f),
      OfficerEmail: officerEmail,
      Address: f.address.replace(/\s*\n\s*/g, ', '),
      PropertyRef: f.propRef,
      PropertyType: f.propType,
      StockRecord: f.stockRecord,
      VoidDuration: f.duration,
      Keysafe: f.keysafe,
      Access: f.access,
      GasCap: f.gasCap, EPCRequired: f.epc, UtilitiesSwap: f.utilities, ElectricOn: f.elec, WhiteGoodsPAT: f.pat,
      Redecoration: VPI.choice(f, 'redec', 'redecOther'),
      Colour: f.colour ? VPI.choice(f, 'colour', 'colourOther') : '',
      HSIssues: f.hs,
      Notes: f.notes,
      ExternalWorks: f.external,
      NoWorks: f.noWorks,
      SORText: VPI.sorText(f, CAT),
      WorksCount: works.length,
      WorksValue: total,
      PhotoCount: f.rooms.reduce((n, r) => n + r.photoCount, 0),
      SubmittedBy: user.name,
      SubmittedByEmail: user.email,
      SubmissionId: f.id || ref,
    },
    worksItems: works,
    emailTo: user.email,
    emailCc: cc.join(';'),
    emailSubject: `Void pre-inspection${f.noWorks ? ' (NO WORKS – close void)' : ''} – ${addr} – ${VPI.ukDate(f.date)} – ${ref}`,
    emailHtml: emailHtml(f, ref, works, total, user),
  };

  const res = await postToFlow(payload);
  if (!res.ok) return { status: 502, body: { error: 'The report could not be saved just now. Nothing was lost: submit again in a minute.' } };
  return { status: 200, body: { reference: ref, worksCount: works.length, worksValue: total } };
}

module.exports = { handleSubmit, principal, MAX_PDF_BYTES };
