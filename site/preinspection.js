// Supported Housing void pre-inspection: the paper form's questions, the SOR tick list for
// each kind of room, and the pricing rules. This file is the single source of truth.
// `npm run sync` copies it to site/ (browser, window.VPI) and api/shared/ (Node, require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VPI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OFFICERS = [
    ['Alison Wright', 'Alison.Wright@northstarhg.co.uk'],
    ['Allison Alderton', 'allison.alderton@northstarhg.co.uk'],
    ['Brenda Pugh', 'Brenda.Pugh@northstarhg.co.uk'],
    ['Catherine Hartigan', 'Catherine.Hartigan@northstarhg.co.uk'],
    ['Claire Teasdale', 'Claire.Teasdale@northstarhg.co.uk'],
    ['Clare Latham', 'Clare.Latham@northstarhg.co.uk'],
    ['David Ayton', 'David.Ayton@northstarhg.co.uk'],
    ['Gemma Jackson', 'Gemma.Jackson@northstarhg.co.uk'],
    ['Heidi Scott', 'Heidi.Scott@northstarhg.co.uk'],
    ['Helen Simpson', 'Helen.Simpson@northstarhg.co.uk'],
    ['Janet Mohan', 'Janet.Mohan@northstarhg.co.uk'],
    ['Jill Wright', 'Jill.Wright@northstarhg.co.uk'],
    ['Kim Jackson', 'Kim.Jackson@northstarhg.co.uk'],
    ['Laurie Edmundson', 'Laurie.Edmundson@northstarhg.co.uk'],
    ['Lisa Dodds', 'Lisa.Dodds@northstarhg.co.uk'],
    ['Louise Russell', 'Louise.Russell@northstarhg.co.uk'],
    ['Lyndsey Grayson', 'Lyndsey.Grayson@northstarhg.co.uk'],
    ['Michaela Dobing', 'Michaela.Dobing@northstarhg.co.uk'],
    ['Nicola Miller', 'nicola.miller@northstarhg.co.uk'],
    ['Nicola Warren', 'Nicola.Warren@northstarhg.co.uk'],
    ['Paige Muirhead', 'Paige.Muirhead@northstarhg.co.uk'],
    ['Peter Booth', 'Peter.Booth@northstarhg.co.uk'],
    ['Ross Nimmo', 'Ross.Nimmo@northstarhg.co.uk'],
    ['Susan Gray', 'Susan.Gray@northstarhg.co.uk'],
    ['Sue Splevins', 'Susan.Splevins@northstarhg.co.uk'],
    ['Suzanne Collantine', 'Suzanne.Collantine@northstarhg.co.uk'],
    ['Zoe Holley', 'Zoe.Holley@northstarhg.co.uk'],
    // Property Services surveyors (same people as the Property Services inspection form).
    ['Alex McGirr', 'Alexandra.McGirr@northstarhg.co.uk'],
    ['Amy Rose', 'Amy.Rose@northstarhg.co.uk'],
    ['Azhir Bashir', 'Azhir.Bashir@northstarhg.co.uk'],
    ['Callum O\'Reilly', 'Callum.OReilly@northstarhg.co.uk'],
    ['Deborah Olver', 'Deborah.Olver@northstarhg.co.uk'],
    ['Fiona McCulloch', 'Fiona.McCulloch@northstarhg.co.uk'],
    ['Jakub Napierala', 'Jakub.Napierala@northstarhg.co.uk'],
  ].sort((a, b) => a[0].localeCompare(b[0], 'en'));

  const YN = [['gasCap', 'Gas cap'], ['epc', 'EPC required'], ['utilities', 'Utilities swap to North Star needed'], ['elec', 'Electric on'], ['pat', 'Supported white goods PAT']];
  const CHOICES = { redec: ['Full', 'Part', 'Other'], colour: ['White', 'Grey', 'Other'] };

  // sqm: the paper asks for square metres; q: default quantity.
  const ITEMS = {
    living: [{ c: '397007', t: 'Remove pins from walls' }, { c: '324101', t: 'Ease the door' }, { c: '315107', t: 'Fill any holes in door' }, { c: '392501', t: 'Renew door handles / latch' }, { c: '393101', t: 'Renew door stop' }, { c: '318203', t: 'Reseal around window' }, { c: '318123', t: 'Fit child restrictors to windows' }, { c: '318108', t: 'Renew window handle' }, { c: '411105', t: 'Fill any holes in walls' }, { c: '450001', t: 'Redecorate room' }, { c: '442511', t: 'Clean any mould', sqm: 1 }, { c: '435121', t: 'Stain block any stains on walls / ceiling', sqm: 1 }, { c: '460507', t: 'Carpet clean' }],
    kitchen: [{ c: '397007', t: 'Remove pins from walls' }, { c: '324101', t: 'Ease door' }, { c: '393101', t: 'Renew door stop' }, { c: '373049', t: 'Adjust any kitchen doors / drawers' }, { c: '411105', t: 'Fill any holes in walls' }, { c: '631507', t: 'Re-seal worktops' }, { c: '431025', t: 'Re-grout tiles', sqm: 1 }, { c: '630109', t: 'Renew plug and chain to sink' }, { c: '432603', t: 'Renew polysafe flooring', sqm: 1 }, { c: '450001', t: 'Redecorate room' }, { c: '442511', t: 'Clean mould', sqm: 1 }, { c: '435121', t: 'Stain block any stains to ceiling / walls', sqm: 1 }, { c: '841007', t: 'Service extractor fan' }, { c: '841007', t: 'Filter change to kitchen extractor' }],
    bathroom: [{ c: '397007', t: 'Remove any pins from walls' }, { c: '324101', t: 'Ease the door' }, { c: '391705', t: 'Renew the privacy bolt' }, { c: '315107', t: 'Fill any holes in the door' }, { c: '388013', t: 'Renew side bath panel' }, { c: '393101', t: 'Renew door stop' }, { c: '630573', t: 'Overhaul the WC flush' }, { c: '630513', t: 'Renew WC seat' }, { c: '631505', t: 'Re-seal the wash hand basin' }, { c: '630715', t: 'Renew plug and chain to wash hand basin' }, { c: '630721', t: 'Overhaul pop-up plug' }, { c: '631501', t: 'Re-seal bath' }, { c: '630919', t: 'Renew plug and chain to bath' }, { c: '631125', t: 'Renew shower curtain' }, { c: '631111', t: 'Renew shower head / hose' }, { c: '631503', t: 'Renew sealant to shower tray' }, { c: '570017', t: 'Overhaul shower screens' }, { c: '432603', t: 'Renew polysafe flooring', sqm: 1 }, { c: '442511', t: 'Clean mould', sqm: 1 }, { c: '435121', t: 'Stain block any stains to walls and ceiling', sqm: 1 }, { c: '841007', t: 'Overhaul extractor fan' }],
    general: [{ c: '460003', t: 'Clear out any rubbish' }, { c: '460035', t: 'Skip for any large items to be removed' }, { c: '460012', t: 'Final clean including white goods inside and outside', q: 2 }, { c: '460010', t: 'Clearance of any needles / bodily fluids etc' }, { c: '896001', t: 'Electric check' }, { c: '872025', t: 'Check smoke detection' }, { c: '841105', t: 'Clean / service air vents' }, { c: '895503', t: 'PAT test 2–3 items' }, { c: '895505', t: 'PAT test 4–10 items' }],
  };
  const DEFAULT_ROOMS = [['Bed 1', 'living'], ['Bed 2', 'living'], ['Lounge', 'living'], ['Hall', 'living'], ['Kitchen', 'kitchen'], ['Bathroom', 'bathroom'], ['Other general repairs', 'general']];

  // The optional property inventory (from the paper "Property Inventory" sheet): for each item the
  // officer or surveyor says whether it stays or is removed, and whether it needs cleaning.
  // `lists` are the "Other (list)" / "Furniture (list)" rows: free-text lines, each with the same choices.
  const INVENTORY = [
    { key: 'kitchen', name: 'Kitchen', items: ['Cooker', 'Washing machine', 'Fridge / freezer', 'Blinds', 'Microwave', 'Kettle', 'Toaster', 'Pots, pans and cutlery', 'Flooring'], lists: ['Other'] },
    { key: 'lounge', name: 'Lounge', items: ['Flooring / carpet', 'Blinds', 'Curtains', 'Lampshade'], lists: ['Furniture', 'Other'] },
    { key: 'bed1', name: 'Large bedroom', items: ['Blinds (x1)', 'Lampshade', 'Carpet / flooring'], lists: ['Other'] },
    { key: 'bed2', name: 'Bed 2', items: ['Curtains', 'Blinds', 'Lampshade', 'Carpet / flooring'], lists: ['Other'] },
    { key: 'bathroom', name: 'Bathroom', items: ['Blinds', 'Lampshade', 'Flooring'], lists: ['Other'] },
  ];
  const INV_ACTS = ['stay', 'remove'];
  const invActText = r => [r.act ? r.act.toUpperCase() : '', r.clean ? 'CLEAN' : ''].filter(Boolean).join(' + ');

  // Everything recorded on the inventory, one row per item (only items with a decision, plus any typed list lines).
  function invRows(inv) {
    const out = [];
    if (!inv || !inv.on) return out;
    for (const rm of INVENTORY) {
      const st = (inv.rooms || {})[rm.key];
      if (!st) continue;
      rm.items.forEach((name, i) => {
        const r = st.items && st.items[i];
        if (r && (r.act || r.clean)) out.push({ room: rm.name, item: name, act: r.act || '', clean: !!r.clean });
      });
      for (const l of rm.lists) for (const e of (st.lists && st.lists[l]) || []) {
        const text = String(e.text || '').trim();
        if (text) out.push({ room: rm.name, item: `${l}: ${text}`, act: e.act || '', clean: !!e.clean, listed: true });
      }
    }
    return out;
  }
  const invHasContent = inv => !!inv && inv.on === true && (invRows(inv).length > 0 || !!String(inv.access || '').trim() || !!String(inv.clearance || '').trim());

  function inventoryText(f) {
    if (!f.inventory || !f.inventory.on) return '';
    const rows = invRows(f.inventory), rooms = [...new Set(rows.map(r => r.room))];
    const out = [`Inventory – ${addr1(f.address) || 'address'} – ${ukDate(f.date)}`];
    for (const rm of rooms) out.push('', rm, ...rows.filter(r => r.room === rm).map(r => `  ${r.item} – ${invActText(r) || 'no decision'}`));
    if (!rooms.length) out.push('', 'No items recorded.');
    if (f.inventory.access) out.push('', 'Access instructions: ' + f.inventory.access);
    if (f.inventory.clearance) out.push('', 'Clearance instructions: ' + f.inventory.clearance);
    return out.join('\n');
  }

  // The NHF8 book (sors.json) indexed by row id and by code.
  function catalogue(raw) {
    const list = raw.sors.map(([id, code, priority, description, element, section, subsection, uom, rate]) => ({ id: String(id), code: String(code), description, element, section, subsection, uom, rate }));
    const byId = new Map(list.map(s => [s.id, s]));
    const byCode = new Map();
    list.forEach(s => { if (!byCode.has(s.code)) byCode.set(s.code, s); });
    return { list, byId, byCode };
  }

  const unitOf = uom => ({ SM: 'm²', LM: 'm', IT: 'item', NO: 'no.' }[uom] || uom || '');
  const lineValue = l => Math.round((l.rate || 0) * (Number(l.qty) || 0) * 100) / 100;
  const qtyText = l => `${l.qty}${l.uom === 'SM' ? ' m²' : l.uom === 'LM' ? ' m' : ''}`;
  const ukDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.split('-').reverse().join('/') : (d || '');
  // First line of the address, keeping "Flat 3, 7 Zetland Road" and "WEBB HOUSE, Flat 3" together.
  const addr1 = address => { const p = String(address || '').split(/\n|,/).map(x => x.trim()).filter(Boolean), unit = /^(flat|room|apartment|unit|apt)\b/i; return (unit.test(p[0] || '') || unit.test(p[1] || '')) && p[1] ? p[0] + ', ' + p[1] : p[0] || ''; };
  const choice = (f, k, other) => f[k] === 'Other' ? `Other: ${f[other] || ''}` : (f[k] || '—');
  const officerName = f => f.officer === 'Other' ? String(f.officerOther || '').trim() : (f.officer || '');
  const officerEmail = f => (OFFICERS.find(o => o[0] === f.officer) || [])[1] || '';

  // Every SOR line in a room: ticked paper items first, then any extra SORs added from the book.
  // Rates always come from the book, never from what the browser sent.
  function lines(room, cat) {
    const L = [];
    const items = ITEMS[room.type] || [];
    items.forEach((it, i) => {
      const t = room.ticks && room.ticks[i];
      if (!t) return;
      const s = cat.byCode.get(it.c) || {};
      L.push({ code: it.c, label: it.t, description: s.description || '', uom: s.uom || '', rate: s.rate || 0, qty: t.qty, where: t.where || '', sqm: !!it.sqm });
    });
    (room.extra || []).forEach(e => {
      const s = (e.id && cat.byId.get(String(e.id))) || cat.byCode.get(String(e.code)) || null;
      if (!s) return;
      L.push({ code: s.code, label: s.description, description: s.description, uom: s.uom, rate: s.rate, qty: e.qty, where: '', extra: true });
    });
    return L;
  }

  function roomSorText(room, cat) {
    const L = lines(room, cat);
    return [room.name].concat(L.length ? L.map(l => `  ${l.code}  ${l.label} x ${qtyText(l)}${l.where ? '  (' + l.where + ')' : ''}`) : ['  No repairs']).join('\n');
  }
  function sorText(f, cat) {
    const head = `Void pre-inspection – ${addr1(f.address) || 'address'} – ${ukDate(f.date)}`;
    if (f.noWorks) return head + '\n\nNo repairs needed. Close off the void.';
    const rs = f.rooms.filter(r => lines(r, cat).length);
    return [head].concat(rs.length ? rs.map(r => '\n' + roomSorText(r, cat)) : ['\nNo repairs ticked yet.']).join('\n');
  }

  return { OFFICERS, YN, CHOICES, ITEMS, DEFAULT_ROOMS, INVENTORY, INV_ACTS, invActText, invRows, invHasContent, inventoryText, catalogue, unitOf, lineValue, qtyText, ukDate, addr1, choice, officerName, officerEmail, lines, roomSorText, sorText };
});
