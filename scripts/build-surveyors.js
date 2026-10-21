// Builds shared/surveyors.json (property reference -> HMS surveyor) from an HMS Endeavour export.
//
//   node scripts/build-surveyors.js "<export>.xlsx"     (or .csv)
//   npm run sync
//
// The export needs a Surveyor column and either a property reference column (best: a property
// view of HMS) or the work order view's "Property" address, which is matched to site/properties.json.
// When a property has jobs under more than one surveyor, Voids jobs win, then the surveyor with
// the most jobs, then the most recent. Emails already in surveyors.json are kept, so a corrected
// address only needs fixing once; new surveyors get firstname.lastname@northstarhg.co.uk.
const fs = require('fs'), path = require('path');
const XLSX = require('xlsx');
const root = path.join(__dirname, '..');
const OUT = path.join(root, 'shared/surveyors.json');

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/build-surveyors.js "<HMS export>.xlsx"'); process.exit(1); }

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const postcode = s => (String(s).toUpperCase().match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/) || [''])[0].replace(/\s+/g, '');

// Read every sheet row as an array and find the header row (the first one with a Surveyor column).
const wb = XLSX.readFile(file, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const hi = rows.findIndex(r => r.some(c => /surveyor/i.test(c)));
if (hi < 0) { console.error('No Surveyor column found in ' + file); process.exit(1); }
const head = rows[hi].map(c => String(c).trim());
const col = re => head.findIndex(h => re.test(h));
const iSurv = col(/surveyor/i);
const iRef = col(/^(property |place )?ref(erence)?$|property reference|place reference/i);
const iAddr = iRef < 0 ? col(/^property$|address/i) : -1;
const iContract = col(/^contract$/i), iCreated = col(/created on/i);
if (iRef < 0 && iAddr < 0) { console.error('Need a property reference or Property (address) column.'); process.exit(1); }

// Address matching, for the work order view: same postcode, and the first line(s) of the HMS
// address appear in the property list address. Only an unambiguous match counts.
const props = JSON.parse(fs.readFileSync(path.join(root, 'site/properties.json'), 'utf8')).properties;
const known = new Set(props.map(p => p[0]));
const byPc = new Map();
for (const [ref, address] of props) {
  const pc = postcode(address);
  if (!byPc.has(pc)) byPc.set(pc, []);
  byPc.get(pc).push({ ref, k: ' ' + norm(address) + ' ' });
}
// Created On arrives as a date, an Excel serial number or US-format text, depending on the export.
function isoDate(v) {
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(Math.round((v - 25569) * 864e5)) : new Date(String(v));
  return isNaN(d) ? '' : d.toISOString();
}
const cache = new Map();
function refFromAddress(a) {
  if (cache.has(a)) return cache.get(a);
  const parts = String(a).split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
  const pc = postcode(a), cands = byPc.get(pc) || [];
  // "Flat 1" / "Room 2" on its own needs the next line (the street) to mean anything. Some
  // addresses start with a block name ("Gloucester Place;Flat 13;Birch Road"), so try from line 2 too.
  const flat = s => /^(flat|room|apartment|apt|unit|bedsit)\s*\S+$/i.test(s || '');
  const keys = [flat(parts[0]) ? parts.slice(0, 2).join(' ') : parts[0], flat(parts[1]) && parts.slice(1, 3).join(' ')];
  let ref = '';
  for (const key of keys) {
    const k = ' ' + norm(key) + ' ';
    const hits = k.trim() ? cands.filter(c => c.k.includes(k)) : [];
    if (hits.length === 1) { ref = hits[0].ref; break; }
  }
  cache.set(a, ref);
  return ref;
}

const tally = new Map(); // ref -> name -> { voids, jobs, last }
let rowsUsed = 0, noRef = 0, noSurveyor = 0;
const unmatched = new Set();
for (const r of rows.slice(hi + 1)) {
  const name = String(r[iSurv] || '').trim().replace(/\s+/g, ' ');
  if (!name) { noSurveyor++; continue; }
  let ref = iRef >= 0 ? String(r[iRef] || '').trim().toUpperCase() : refFromAddress(r[iAddr]);
  if (!ref || (iRef >= 0 && !known.has(ref) && !/^[A-Z]{4}\d{7}$/.test(ref))) { noRef++; if (iAddr >= 0) unmatched.add(r[iAddr]); continue; }
  rowsUsed++;
  if (!tally.has(ref)) tally.set(ref, new Map());
  const t = tally.get(ref).get(name) || { voids: 0, jobs: 0, last: '' };
  t.jobs++;
  if (iContract >= 0 && /void/i.test(r[iContract])) t.voids++;
  const when = iCreated >= 0 ? isoDate(r[iCreated]) : '';
  if (when > t.last) t.last = when;
  tally.get(ref).set(name, t);
}

const properties = {};
for (const [ref, m] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [name] = [...m].sort(([, a], [, b]) => b.voids - a.voids || b.jobs - a.jobs || b.last.localeCompare(a.last))[0];
  properties[ref] = name;
}

const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { emails: {} };
const emails = {}, guessed = [];
for (const name of [...new Set(Object.values(properties))].sort()) {
  emails[name] = old.emails?.[name] || name.replace(/'/g, '').split(' ').join('.') + '@northstarhg.co.uk';
  if (!old.emails?.[name]) guessed.push(`${name} -> ${emails[name]}`);
}
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), source: path.basename(file), emails, properties }, null, 1) + '\n');

const perSurveyor = {};
for (const n of Object.values(properties)) perSurveyor[n] = (perSurveyor[n] || 0) + 1;
console.log(`${Object.keys(properties).length} properties from ${rowsUsed} rows (${noSurveyor} rows had no surveyor, ${noRef} no matching property).`);
console.log(perSurveyor);
if (unmatched.size) console.log(`${unmatched.size} addresses did not match the property list, e.g.`, [...unmatched].slice(0, 5));
if (guessed.length) console.log('Check these guessed emails in shared/surveyors.json:\n  ' + guessed.join('\n  '));
console.log('Now run: npm run sync');
