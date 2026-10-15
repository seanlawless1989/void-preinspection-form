// Copies shared/ (the single source of truth) into site/ and api/shared/.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['preinspection.js', 'sors.json'])
  for (const dir of ['site', 'api/shared']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(root, 'shared', f), path.join(root, dir, f));
  }
// jsPDF is self-hosted (the CSP blocks CDNs): copy it from node_modules after `npm install`.
const vendor = [['jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'], ['jspdf-autotable/dist/jspdf.plugin.autotable.min.js', 'jspdf.plugin.autotable.min.js']];
fs.mkdirSync(path.join(root, 'site/vendor'), { recursive: true });
for (const [from, to] of vendor) {
  const src = path.join(root, 'node_modules', from), dest = path.join(root, 'site/vendor', to);
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  else if (!fs.existsSync(dest)) console.warn(`site/vendor/${to} is missing: run npm install first.`);
}
console.log('Synced shared/ to site/ and api/shared/');
