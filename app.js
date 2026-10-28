'use strict';

// ---------- storage ----------
const KEY = 'billbook-v1';
const DEFAULT_CATEGORIES = ['Watches', 'Sunglasses', 'Frames', 'T-Shirts', 'Shirts', 'Tracks', 'Jeans'];
const MODES = ['Cash', 'UPI', 'Card', 'Other'];

let db = load();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.bills) && Array.isArray(d.customers)) return d;
  } catch (e) { /* fall through to fresh db */ }
  return {
    customers: [],
    bills: [],
    categories: [...DEFAULT_CATEGORIES],
    settings: { shopName: 'My Shop', phone: '', address: '', nextBillNo: 1 },
  };
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const money = n => '₹' + round2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const normPhone = p => String(p || '').replace(/\D/g, '').slice(-10);

function localISO(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
const today = () => localISO(new Date());
const fmtDate = iso => new Date(iso + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const cust = id => db.customers.find(c => c.id === id);
const findBill = id => db.bills.find(b => b.id === id);
const billSubtotal = b => sum(b.items, i => i.qty * i.price);
const billTotal = b => Math.max(0, billSubtotal(b) - (b.discount || 0));
const billPaid = b => sum(b.payments, p => p.amount);
const billDue = b => Math.max(0, round2(billTotal(b) - billPaid(b)));
const isPending = b => billDue(b) > 0;
const byNewest = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function periodStart(p) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === 'all') return null;
  if (p === 'week') d.setDate(d.getDate() - 6);
  else if (p === 'month') d.setDate(1);
  else d.setMonth(d.getMonth() - parseInt(p, 10));
  return localISO(d);
}

function billRow(b, showCustomer = true) {
  const c = cust(b.customerId);
  const due = billDue(b);
  const items = b.items.map(i => i.name || i.category).join(', ');
  return `<a class="row" href="#/bill/${b.id}">
    <div>
      <strong>${showCustomer ? esc(c?.name || 'Unknown') : esc(items)}</strong>
      <small>#${b.no} · ${fmtDate(b.date)}${showCustomer ? ' · ' + esc(items) : ''}</small>
    </div>
    <div class="amt">${money(billTotal(b))}<br>
      ${due > 0 ? `<span class="badge pending">Due ${money(due)}</span>` : '<span class="badge paid">Paid</span>'}
    </div>
  </a>`;
}

function billList(bills, showCustomer = true) {
  if (!bills.length) return '<div class="list"><div class="empty">No bills here</div></div>';
  return `<div class="list">${bills.map(b => billRow(b, showCustomer)).join('')}</div>`;
}

function tabs(base, current) {
  return `<div class="tabs">${['pending', 'paid', 'all'].map(t =>
    `<a href="${base}tab=${t}" class="${t === current ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</a>`).join('')}</div>`;
}
const filterTab = (bills, tab) => tab === 'all' ? bills : bills.filter(b => (tab === 'pending') === isPending(b));

// ---------- product photos ----------
// Photos live in IndexedDB (localStorage is too small); bill items keep only the photo id.
const imgDB = new Promise((resolve, reject) => {
  const req = indexedDB.open('billbook-images', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('images');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
function imgStore(mode, fn) {
  return imgDB.then(d => new Promise((resolve, reject) => {
    const tx = d.transaction('images', mode);
    const out = fn(tx.objectStore('images'));
    tx.oncomplete = () => resolve(typeof out === 'function' ? out() : out?.result);
    tx.onerror = () => reject(tx.error);
  }));
}
const putImage = (id, blob) => imgStore('readwrite', s => s.put(blob, id));
const getImage = id => imgStore('readonly', s => s.get(id));
const deleteImages = ids => ids.length && imgStore('readwrite', s => ids.forEach(id => s.delete(id)));
const clearImages = () => imgStore('readwrite', s => s.clear());
const allImages = () => imgStore('readonly', s => {
  const keys = s.getAllKeys(), vals = s.getAll();
  return () => keys.result.map((k, i) => [k, vals.result[i]]);
});
const billImageIds = b => b.items.map(i => i.img).filter(Boolean);

// Shrink camera photos (often 3-5MB) to ~800px JPEGs before storing.
async function compressImage(file, max = 800) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75));
}

const imgUrls = {};
async function loadImages(root = app) {
  for (const el of $$('img[data-img]', root)) {
    const id = el.dataset.img;
    if (!imgUrls[id]) {
      const blob = await getImage(id).catch(() => null);
      if (!blob) continue;
      imgUrls[id] = URL.createObjectURL(blob);
    }
    el.src = imgUrls[id];
  }
}

function showImage(src) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${src}" alt="">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
}

// Bottom sheet of choices, e.g. [['Take photo', fn], ...]
function actionSheet(choices) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `<div class="sheet">
    ${choices.map(([label], i) => `<button type="button" class="btn block${label.startsWith('Remove') ? ' danger' : ''}" data-i="${i}">${label}</button>`).join('')}
    <button type="button" class="btn block" data-i="-1">Cancel</button>
  </div>`;
  sheet.onclick = e => {
    const b = e.target.closest('[data-i]');
    if (!b && e.target !== sheet) return;
    sheet.remove();
    if (b && +b.dataset.i >= 0) choices[+b.dataset.i][1]();
  };
  document.body.appendChild(sheet);
}

const blobToDataURL = blob => new Promise(resolve => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

const CAMERA_ICON = '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';

// ---------- views ----------
let homePeriod = 'month';

function homeView() {
  const periods = [['week', '7 Days'], ['month', 'This Month'], ['3', '3 Months'], ['6', '6 Months'], ['12', '12 Months'], ['all', 'Lifetime']];
  const start = periodStart(homePeriod);
  const inRange = d => !start || d >= start;

  const bills = db.bills.filter(b => inRange(b.date));
  const sales = sum(bills, billTotal);
  let collected = 0;
  db.bills.forEach(b => b.payments.forEach(p => { if (inRange(p.date)) collected += p.amount; }));
  const pending = db.bills.filter(isPending);

  const byCat = {};
  bills.forEach(b => b.items.forEach(i => { byCat[i.category] = (byCat[i.category] || 0) + i.qty * i.price; }));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  const recent = [...db.bills].sort(byNewest).slice(0, 5);

  app.innerHTML = `
    <h1>Revenue</h1>
    <div class="chips">${periods.map(([k, l]) =>
      `<button class="chip ${k === homePeriod ? 'active' : ''}" data-act="period" data-p="${k}">${l}</button>`).join('')}</div>
    <div class="stats">
      <div class="stat big"><small>Sales (billed)</small><b>${money(sales)}</b></div>
      <div class="stat paid"><small>Collected</small><b>${money(collected)}</b></div>
      <div class="stat"><small>Bills</small><b>${bills.length}</b></div>
    </div>

    <h2>Overall</h2>
    <div class="stats">
      <a class="stat pending" href="#/bills?tab=pending"><small>Pending · ${pending.length} bill${pending.length === 1 ? "" : "s"}</small><b>${money(sum(pending, billDue))}</b></a>
      <a class="stat paid" href="#/bills?tab=paid"><small>Paid bills</small><b>${db.bills.length - pending.length}</b></a>
    </div>

    ${cats.length ? `<div class="card"><h2>Sales by category</h2>
      ${cats.map(([c, v]) => `<div class="bar">
        <div class="bar-label"><span>${esc(c)}</span><b>${money(v)}</b></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div>
      </div>`).join('')}</div>` : ''}

    <h2>Recent bills</h2>
    ${recent.length ? billList(recent) : `<div class="list"><div class="empty">No bills yet.<br><br><a class="btn primary" href="#/new">Make your first bill</a></div></div>`}
  `;
}

function billsView(tab) {
  app.innerHTML = `
    <h1>Bills</h1>
    ${tabs('#/bills?', tab)}
    <input class="search" id="q" type="search" placeholder="Search name, phone, bill no, item…">
    <div class="summary" id="summary"></div>
    <div id="list"></div>`;
  const q = $('#q');
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    let list = filterTab(db.bills, tab);
    if (term) list = list.filter(b => matchBill(b, term));
    list.sort(byNewest);
    $('#summary').innerHTML = `<span>${list.length} bill${list.length === 1 ? "" : "s"}</span>` + (tab === 'pending'
      ? `<span>Total due <b>${money(sum(list, billDue))}</b></span>`
      : `<span>Total <b>${money(sum(list, billTotal))}</b></span>`);
    $('#list').innerHTML = billList(list);
  };
  q.oninput = draw;
  draw();
}

function matchBill(b, term) {
  const c = cust(b.customerId) || {};
  const hay = [c.name, c.phone, '#' + b.no, String(b.no), ...b.items.map(i => i.name + ' ' + i.category)].join(' ').toLowerCase();
  return hay.includes(term);
}

// Guess a category from the item name, e.g. "cartier watch" -> Watches.
const CATEGORY_ALIASES = {
  'Frames': ['specs', 'spectacle', 'eyeglass', 'optical'],
  'Sunglasses': ['shades', 'goggle'],
  'T-Shirts': ['tshirt', 'polo'],
  'Tracks': ['track', 'jogger'],
  'Jeans': ['jean', 'denim'],
};
function guessCategory(text) {
  const t = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = 'Other', bestLen = 0;
  for (const cat of db.categories) {
    const base = cat.toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = [base, base.replace(/(es|s)$/, ''), ...(CATEGORY_ALIASES[cat] || [])];
    // longest match wins, so "t-shirt" beats "shirt"
    for (const k of keys) if (k.length > bestLen && t.includes(k)) { best = cat; bestLen = k.length; }
  }
  return best;
}

function itemRow(item = {}) {
  return `<tr class="item" data-qty="${item.qty || 1}" data-img="${item.img || ''}">
    <td class="photo">
      <button type="button" class="photo-btn" data-act="photo" aria-label="Product photo">${item.img ? `<img data-img="${item.img}" alt="">` : CAMERA_ICON}</button>
      <input type="file" accept="image/*" capture="environment" data-src="camera" hidden>
      <input type="file" accept="image/*" data-src="gallery" hidden>
    </td>
    <td><input name="iname" placeholder="Item name" enterkeyhint="next" value="${esc(item.name || item.category)}"><small class="cat"></small></td>
    <td><input name="price" type="number" min="0" step="any" inputmode="decimal" enterkeyhint="next" placeholder="0" value="${item.price ?? ''}"></td>
    <td><button type="button" class="icon-btn" data-act="del-item" aria-label="Remove item">✕</button></td>
  </tr>`;
}

function billFormView(editId, presetCustomerId) {
  const bill = editId ? findBill(editId) : null;
  if (editId && !bill) return notFound();
  const c = bill ? cust(bill.customerId) : cust(presetCustomerId);

  app.innerHTML = `
    <h1>${bill ? 'Edit Bill #' + bill.no : 'New Bill'}</h1>
    <form id="billForm" autocomplete="off">
      <div class="card">
        <h2>Customer</h2>
        <input type="hidden" name="customerId" value="${c?.id || ''}">
        <div class="field"><label>Name</label><input name="cname" required value="${esc(c?.name)}"></div>
        <div class="field"><label>Phone</label><input name="cphone" type="tel" inputmode="tel" value="${esc(c?.phone)}"></div>
        <div class="picked" id="picked">${c ? '✓ Existing customer' : ''}</div>
        <div class="suggest" id="suggest"></div>
      </div>

      <div class="card">
        <table class="bill-table">
          <thead><tr><th>Photo</th><th>Item</th><th>Price (₹)</th><th></th></tr></thead>
          <tbody id="items">${(bill?.items || []).map(itemRow).join('')}</tbody>
        </table>
        <button type="button" class="btn" data-act="add-item">+ Add row</button>
      </div>

      <div class="card">
        <div class="field"><label>Discount (₹)</label><input name="discount" type="number" min="0" step="any" inputmode="decimal" value="${bill?.discount || ''}"></div>
        ${bill ? '' : `
        <div class="grid2">
          <div class="field"><label>Paid now (₹)</label><input name="paid" type="number" min="0" step="any" inputmode="decimal" placeholder="0"></div>
          <div class="field"><label>Mode</label><select name="mode">${MODES.map(m => `<option>${m}</option>`).join('')}</select></div>
        </div>
        <button type="button" class="btn small" data-act="full-paid" aria-pressed="false">Paid in full</button>`}
        <div class="field" style="margin-top:12px"><label>Note</label><input name="note" value="${esc(bill?.note)}"></div>
        <div class="totals" id="totals"></div>
      </div>

      <button class="btn primary block">${bill ? 'Save Changes' : 'Save Bill'}</button>
    </form>`;

  const form = $('#billForm');
  const items = $('#items');
  const rows = () => $$('.item', items);
  // a photo added in this form but then removed/replaced is never saved, so drop it
  const dropUnsavedImage = img => {
    if (img && !(bill && billImageIds(bill).includes(img))) deleteImages([img]);
  };
  const isBlank = r => !$('[name=iname]', r).value.trim() && !$('[name=price]', r).value && !r.dataset.img;
  const readItems = () => rows().filter(r => !isBlank(r)).map(r => {
    const name = $('[name=iname]', r).value.trim();
    const item = { category: guessCategory(name), name, qty: +r.dataset.qty || 1, price: parseFloat($('[name=price]', r).value) || 0 };
    if (r.dataset.img) item.img = r.dataset.img;
    return item;
  });

  // "Paid in full" is a toggle: while on, the paid amount follows the total
  let fullPaid = false;
  const setFullPaid = on => {
    fullPaid = on;
    const btn = $('[data-act=full-paid]');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.textContent = on ? '✓ Paid in full' : 'Paid in full';
  };

  const refreshRows = () => {
    // show at least 5 rows, and always keep an empty one at the bottom for the next item
    while (rows().length < 5) items.insertAdjacentHTML('beforeend', itemRow());
    if (!isBlank(rows().pop())) items.insertAdjacentHTML('beforeend', itemRow());
    rows().forEach(r => {
      const name = $('[name=iname]', r).value.trim();
      const qty = +r.dataset.qty || 1;
      $('.cat', r).textContent = name ? guessCategory(name) + (qty > 1 ? ` · ×${qty}` : '') : '';
    });
  };

  const updateTotals = () => {
    const subtotal = sum(readItems(), i => i.qty * i.price);
    const discount = parseFloat(form.discount.value) || 0;
    const total = Math.max(0, subtotal - discount);
    if (fullPaid) form.paid.value = round2(total);
    const paid = bill ? billPaid(bill) : Math.min(parseFloat(form.paid.value) || 0, total);
    $('#totals').innerHTML = `
      ${discount ? `<div class="t-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        <div class="t-row"><span>Discount</span><span>− ${money(discount)}</span></div>` : ''}
      <div class="t-row grand"><span>Total</span><span>${money(total)}</span></div>
      <div class="t-row"><span>Paid</span><span>${money(paid)}</span></div>
      ${total - paid > 0 ? `<div class="t-row due"><span>Pending</span><span>${money(total - paid)}</span></div>` : ''}`;
  };

  // photo picked for a row: shrink it, store it, show the thumbnail
  items.onchange = async e => {
    const input = e.target;
    if (input.type !== 'file' || !input.files[0]) return;
    const r = input.closest('.item');
    const id = uid();
    try {
      await putImage(id, await compressImage(input.files[0]));
    } catch (err) {
      return toast('Could not use that photo');
    } finally {
      input.value = '';
    }
    dropUnsavedImage(r.dataset.img);
    r.dataset.img = id;
    $('.photo-btn', r).innerHTML = `<img data-img="${id}" alt="">`;
    loadImages(r);
    refreshRows();
  };

  // Enter / keyboard "Next": item -> price -> next row's item
  items.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const r = e.target.closest('.item');
    if (e.target.name === 'iname') $('[name=price]', r).focus();
    else {
      refreshRows();
      $('[name=iname]', r.nextElementSibling)?.focus();
    }
  };

  // customer suggestions
  const showSuggest = () => {
    form.customerId.value = '';
    $('#picked').textContent = '';
    const n = form.cname.value.trim().toLowerCase();
    const p = normPhone(form.cphone.value);
    if (n.length < 1 && p.length < 3) { $('#suggest').innerHTML = ''; return; }
    const matches = db.customers.filter(cu =>
      (n && cu.name.toLowerCase().includes(n)) || (p.length >= 3 && normPhone(cu.phone).includes(p))).slice(0, 5);
    $('#suggest').innerHTML = matches.map(cu =>
      `<button type="button" data-act="pick-customer" data-id="${cu.id}">${esc(cu.name)} <small>${esc(cu.phone)}</small></button>`).join('');
  };
  form.cname.oninput = showSuggest;
  form.cphone.oninput = showSuggest;

  form.oninput = e => {
    if (e.target.name === 'cname' || e.target.name === 'cphone') return;
    if (e.target.name === 'paid' && fullPaid) setFullPaid(false);
    if (items.contains(e.target)) refreshRows();
    updateTotals();
  };
  form.onclick = e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'add-item') {
      items.insertAdjacentHTML('beforeend', itemRow());
      refreshRows();
      $('[name=iname]', rows().find(isBlank)).focus();
    } else if (act === 'photo') {
      const row = btn.closest('.item');
      const choices = [
        ['Take photo', () => $('[data-src=camera]', row).click()],
        ['Choose from gallery', () => $('[data-src=gallery]', row).click()],
      ];
      if (row.dataset.img) choices.push(['Remove photo', () => {
        dropUnsavedImage(row.dataset.img);
        row.dataset.img = '';
        btn.innerHTML = CAMERA_ICON;
        refreshRows();
      }]);
      actionSheet(choices);
      return;
    } else if (act === 'del-item') {
      const row = btn.closest('.item');
      dropUnsavedImage(row.dataset.img);
      row.remove();
      refreshRows();
    } else if (act === 'full-paid') {
      setFullPaid(!fullPaid);
      if (!fullPaid) form.paid.value = '';
    } else if (act === 'pick-customer') {
      const cu = cust(btn.dataset.id);
      form.cname.value = cu.name;
      form.cphone.value = cu.phone;
      form.customerId.value = cu.id;
      $('#picked').textContent = '✓ Existing customer';
      $('#suggest').innerHTML = '';
      $('[name=iname]', items).focus();
      return;
    }
    updateTotals();
  };

  form.onsubmit = e => {
    e.preventDefault();
    const list = readItems();
    const noPrice = list.find(i => !i.price);
    if (noPrice) return toast(`Enter price for ${noPrice.name || 'item'}`);
    if (!list.length) return toast('Add at least one item');
    const name = form.cname.value.trim();
    if (!name) return toast('Enter customer name');

    let customerId = form.customerId.value;
    if (!customerId) {
      const phone = normPhone(form.cphone.value);
      const existing = phone && db.customers.find(cu => normPhone(cu.phone) === phone);
      if (existing) customerId = existing.id;
      else {
        customerId = uid();
        db.customers.push({ id: customerId, name, phone: form.cphone.value.trim(), createdAt: Date.now() });
      }
    }

    const data = {
      customerId,
      date: bill ? bill.date : today(),
      items: list,
      discount: parseFloat(form.discount.value) || 0,
      note: form.note.value.trim(),
    };
    let id;
    if (bill) {
      const kept = billImageIds(data);
      deleteImages(billImageIds(bill).filter(img => !kept.includes(img)));
      Object.assign(bill, data);
      id = bill.id;
    } else {
      const nb = { id: uid(), no: db.settings.nextBillNo++, createdAt: Date.now(), payments: [], ...data };
      const paid = fullPaid ? billTotal(nb) : Math.min(parseFloat(form.paid.value) || 0, billTotal(nb));
      if (paid > 0) nb.payments.push({ id: uid(), amount: round2(paid), date: nb.date, mode: form.mode.value });
      db.bills.push(nb);
      id = nb.id;
    }
    save();
    toast('Bill saved');
    location.hash = '#/bill/' + id;
  };

  refreshRows();
  updateTotals();
  loadImages();
}

function billView(id) {
  const b = findBill(id);
  if (!b) return notFound();
  const c = cust(b.customerId) || {};
  const s = db.settings;
  const total = billTotal(b), paid = billPaid(b), due = billDue(b);

  app.innerHTML = `
    <div class="card receipt">
      <div class="r-head">
        <strong>${esc(s.shopName)}</strong>
        <small>${esc(s.address)}${s.address && s.phone ? '<br>' : ''}${esc(s.phone)}</small>
      </div>
      <div class="r-meta">
        <div>Bill <b>#${b.no}</b><br>${fmtDate(b.date)}</div>
        <div><a href="#/customer/${c.id}"><b>${esc(c.name)}</b></a><br>${esc(c.phone)}</div>
      </div>
      <table>
        <tr><th>Item</th><th class="n">Price</th></tr>
        ${b.items.map(i => `<tr>
          <td><div class="r-item">${i.img ? `<img class="thumb" data-img="${i.img}" data-act="view-img" alt="">` : ''}<div>${esc(i.name || i.category)}${i.qty > 1 ? ` × ${i.qty}` : ''}<small>${esc(i.category)}</small></div></div></td>
          <td class="n">${money(i.qty * i.price)}</td>
        </tr>`).join('')}
      </table>
      <div class="totals" style="margin-top:10px">
        ${b.discount ? `<div class="t-row"><span>Subtotal</span><span>${money(billSubtotal(b))}</span></div>
          <div class="t-row"><span>Discount</span><span>− ${money(b.discount)}</span></div>` : ''}
        <div class="t-row grand"><span>Total</span><span>${money(total)}</span></div>
        <div class="t-row"><span>Paid</span><span>${money(paid)}</span></div>
        ${due > 0 ? `<div class="t-row due"><span>Pending</span><span>${money(due)}</span></div>` : ''}
      </div>
      ${b.note ? `<p class="muted">Note: ${esc(b.note)}</p>` : ''}
      <p style="text-align:center;margin:14px 0 0">${due > 0 ? '<span class="badge pending">PENDING</span>' : '<span class="badge paid">PAID</span>'}</p>
    </div>

    ${due > 0 ? `
    <form class="card no-print" id="payForm">
      <h2>Receive payment</h2>
      <div class="grid2">
        <div class="field"><label>Amount (₹)</label><input name="amount" type="number" min="0" step="any" inputmode="decimal" value="${due}"></div>
        <div class="field"><label>Mode</label><select name="mode">${MODES.map(m => `<option>${m}</option>`).join('')}</select></div>
      </div>
      <button class="btn primary block">Add Payment</button>
    </form>` : ''}

    ${b.payments.length ? `<h2 class="no-print">Payments</h2>
    <div class="list no-print">${b.payments.map(p => `<div class="row">
      <div><strong>${money(p.amount)}</strong><small>${fmtDate(p.date)} · ${esc(p.mode)}</small></div>
      <button class="icon-btn" data-act="del-payment" data-id="${p.id}" aria-label="Delete payment">✕</button>
    </div>`).join('')}</div>` : ''}

    <div class="actions no-print">
      <button class="btn" data-act="print">Print</button>
      <button class="btn" data-act="whatsapp">WhatsApp</button>
      <a class="btn" href="#/edit/${b.id}">Edit</a>
    </div>
    <button class="btn danger block no-print" data-act="del-bill">Delete Bill</button>`;

  const payForm = $('#payForm');
  if (payForm) payForm.onsubmit = e => {
    e.preventDefault();
    const amount = Math.min(parseFloat(payForm.amount.value) || 0, billDue(b));
    if (amount <= 0) return toast('Enter an amount');
    b.payments.push({ id: uid(), amount: round2(amount), date: today(), mode: payForm.mode.value });
    save();
    toast(billDue(b) > 0 ? 'Payment added' : 'Bill fully paid ✓');
    billView(id);
  };

  app.onclick = e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'view-img' && btn.src) showImage(btn.src);
    else if (act === 'print') window.print();
    else if (act === 'whatsapp') shareWhatsApp(b);
    else if (act === 'del-payment' && confirm('Delete this payment?')) {
      b.payments = b.payments.filter(p => p.id !== btn.dataset.id);
      save();
      billView(id);
    } else if (act === 'del-bill' && confirm(`Delete bill #${b.no}? This cannot be undone.`)) {
      db.bills = db.bills.filter(x => x.id !== b.id);
      deleteImages(billImageIds(b));
      save();
      toast('Bill deleted');
      location.hash = '#/bills';
    }
  };
  loadImages();
}

function shareWhatsApp(b) {
  const c = cust(b.customerId) || {};
  const due = billDue(b);
  const lines = [
    `*${db.settings.shopName}*`,
    `Bill #${b.no} · ${fmtDate(b.date)}`,
    `Customer: ${c.name}`,
    '',
    ...b.items.map(i => `${i.name || i.category}${i.qty > 1 ? ' × ' + i.qty : ''} — ${money(i.qty * i.price)}`),
    '',
    b.discount ? `Discount: −${money(b.discount)}` : '',
    `*Total: ${money(billTotal(b))}*`,
    `Paid: ${money(billPaid(b))}`,
    due > 0 ? `*Pending: ${money(due)}*` : 'Status: PAID ✅',
    '',
    'Thank you for shopping with us!',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  let phone = normPhone(c.phone);
  if (phone.length === 10) phone = '91' + phone;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
}

function customerStats(c) {
  const bills = db.bills.filter(b => b.customerId === c.id);
  return {
    bills,
    total: sum(bills, billTotal),
    paid: sum(bills, billPaid),
    due: sum(bills, billDue),
    last: bills.reduce((m, b) => (b.date > m ? b.date : m), ''),
  };
}

function customersView() {
  app.innerHTML = `
    <h1>Customers</h1>
    <input class="search" id="q" type="search" placeholder="Search by name or phone…">
    <div class="summary" id="summary"></div>
    <div id="list"></div>`;
  const q = $('#q');
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const digits = normPhone(term);
    let list = db.customers.map(c => ({ c, s: customerStats(c) }));
    if (term) list = list.filter(({ c }) => c.name.toLowerCase().includes(term) || (digits && normPhone(c.phone).includes(digits)));
    list.sort((a, b) => b.s.last.localeCompare(a.s.last));
    $('#summary').innerHTML = `<span>${list.length} customers</span><span>Pending <b>${money(sum(list, x => x.s.due))}</b></span>`;
    $('#list').innerHTML = list.length ? `<div class="list">${list.map(({ c, s }) => `
      <a class="row" href="#/customer/${c.id}">
        <div><strong>${esc(c.name)}</strong><small>${esc(c.phone || 'No phone')} · ${s.bills.length} bills</small></div>
        <div class="amt">${money(s.total)}<br>
          ${s.due > 0 ? `<span class="badge pending">Due ${money(s.due)}</span>` : '<span class="badge paid">Clear</span>'}
        </div>
      </a>`).join('')}</div>`
      : `<div class="list"><div class="empty">${term ? 'No customer found' : 'Customers appear here after you make a bill'}</div></div>`;
  };
  q.oninput = draw;
  draw();
}

function customerView(id, tab) {
  const c = cust(id);
  if (!c) return notFound();
  const s = customerStats(c);
  const bills = filterTab(s.bills, tab).sort(byNewest);
  const digits = normPhone(c.phone);

  app.innerHTML = `
    <h1>${esc(c.name)}</h1>
    <div class="actions">
      ${digits ? `<a class="btn" href="tel:${esc(c.phone)}">Call</a>` : ''}
      <a class="btn primary" href="#/new?c=${c.id}">+ New Bill</a>
      <button class="btn" data-act="edit-customer">Edit</button>
    </div>
    <form class="card" id="custForm" hidden>
      <div class="field"><label>Name</label><input name="name" required value="${esc(c.name)}"></div>
      <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(c.phone)}"></div>
      <button class="btn primary">Save</button>
      ${s.bills.length ? '' : '<button type="button" class="btn danger" data-act="del-customer">Delete customer</button>'}
    </form>
    <div class="stats">
      <div class="stat big"><small>Total purchases · ${s.bills.length} bills</small><b>${money(s.total)}</b></div>
      <div class="stat paid"><small>Paid</small><b>${money(s.paid)}</b></div>
      <div class="stat pending"><small>Pending</small><b>${money(s.due)}</b></div>
    </div>
    ${tabs(`#/customer/${c.id}?`, tab)}
    ${billList(bills, false)}`;

  const f = $('#custForm');
  f.onsubmit = e => {
    e.preventDefault();
    c.name = f.elements.name.value.trim() || c.name;
    c.phone = f.phone.value.trim();
    save();
    toast('Customer updated');
    customerView(id, tab);
  };
  app.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit-customer') f.hidden = !f.hidden;
    else if (act === 'del-customer' && confirm('Delete this customer?')) {
      db.customers = db.customers.filter(x => x.id !== id);
      save();
      location.hash = '#/customers';
    }
  };
}

function moreView() {
  const s = db.settings;
  app.innerHTML = `
    <h1>Settings</h1>
    <form class="card" id="shopForm">
      <h2>Shop details (shown on bills)</h2>
      <div class="field"><label>Shop name</label><input name="shopName" value="${esc(s.shopName)}"></div>
      <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(s.phone)}"></div>
      <div class="field"><label>Address</label><input name="address" value="${esc(s.address)}"></div>
      <button class="btn primary">Save</button>
    </form>

    <div class="card">
      <h2>Categories</h2>
      <div class="list cat-list">${db.categories.map((c, i) => `<div class="row">
        <span>${esc(c)}</span>
        <button class="icon-btn" data-act="del-cat" data-i="${i}" aria-label="Remove ${esc(c)}">✕</button>
      </div>`).join('')}</div>
      <form class="add-row" id="catForm">
        <input name="cat" placeholder="New category, e.g. Belts">
        <button class="btn primary">Add</button>
      </form>
    </div>

    <div class="card">
      <h2>Sample data</h2>
      ${db.customers.some(c => c.sample) ? `
        <p class="muted" style="margin-top:0">Sample customers are loaded. Remove them before you start real billing. Your own bills are kept.</p>
        <button class="btn danger block" data-act="remove-sample">Remove sample data</button>` : `
        <p class="muted" style="margin-top:0">Try the app with 100 made-up customers and a year of bills. You can remove them later with one tap.</p>
        <button class="btn block" data-act="load-sample">Load 100 sample customers</button>`}
    </div>

    <div class="card">
      <h2>Backup</h2>
      <p class="muted" style="margin-top:0">Data and product photos are saved on this device only. Download a backup regularly.</p>
      <div class="actions">
        <button class="btn" data-act="export">Download backup</button>
        <label class="btn">Restore backup<input type="file" accept="application/json,.json" id="importFile" hidden></label>
      </div>
      <button class="btn danger block" data-act="reset">Erase all data</button>
    </div>`;

  $('#shopForm').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    s.shopName = f.shopName.value.trim() || 'My Shop';
    s.phone = f.phone.value.trim();
    s.address = f.address.value.trim();
    save();
    renderShopName();
    toast('Saved');
  };
  $('#catForm').onsubmit = e => {
    e.preventDefault();
    const name = e.target.cat.value.trim();
    if (!name) return;
    if (db.categories.some(c => c.toLowerCase() === name.toLowerCase())) return toast('Category already exists');
    db.categories.push(name);
    save();
    moreView();
  };
  $('#importFile').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then(text => {
      const d = JSON.parse(text);
      if (!Array.isArray(d.bills) || !Array.isArray(d.customers)) throw new Error('bad file');
      if (!confirm(`Restore backup with ${d.bills.length} bills and ${d.customers.length} customers? Current data will be replaced.`)) return;
      const images = d.images || {};
      delete d.images;
      db = d;
      save();
      return clearImages().then(() => Promise.all(Object.entries(images).map(([id, url]) =>
        fetch(url).then(res => res.blob()).then(blob => putImage(id, blob)))));
    }).then(restored => {
      if (!restored) return;
      renderShopName();
      toast('Backup restored');
      location.hash = '#/';
    }).catch(() => toast('Not a valid backup file'));
  };
  app.onclick = e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'del-cat') {
      if (db.categories.length <= 1) return toast('Keep at least one category');
      db.categories.splice(+btn.dataset.i, 1);
      save();
      moreView();
    } else if (act === 'load-sample') {
      const { customers, bills } = makeSampleData(db.settings.nextBillNo);
      db.customers.push(...customers);
      db.bills.push(...bills);
      db.settings.nextBillNo += bills.length;
      save();
      toast(`Added ${customers.length} customers and ${bills.length} bills`);
      moreView();
    } else if (act === 'remove-sample' && confirm('Remove all sample customers and their bills?')) {
      db.customers = db.customers.filter(c => !c.sample);
      db.bills = db.bills.filter(b => !b.sample);
      save();
      toast('Sample data removed');
      moreView();
    } else if (act === 'export') {
      allImages().then(async pairs => {
        const images = {};
        for (const [id, blob] of pairs) images[id] = await blobToDataURL(blob);
        const blob = new Blob([JSON.stringify({ ...db, images })], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `billbook-backup-${today()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    } else if (act === 'reset' && confirm('Erase ALL bills and customers? Download a backup first!') && confirm('Are you absolutely sure?')) {
      localStorage.removeItem(KEY);
      clearImages();
      db = load();
      renderShopName();
      location.hash = '#/';
    }
  };
}

function notFound() {
  app.innerHTML = '<div class="empty">Not found. <a href="#/">Go home</a></div>';
}

function renderShopName() { $('#shopName').textContent = db.settings.shopName; }

// ---------- router ----------
function route() {
  const [path, qs] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const q = new URLSearchParams(qs || '');
  const tab = ['pending', 'paid', 'all'].includes(q.get('tab')) ? q.get('tab') : null;
  app.onclick = null;

  const nav = { undefined: 'home', new: 'new', edit: 'new', bills: 'bills', bill: 'bills', customers: 'customers', customer: 'customers', more: 'more' }[parts[0]];
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));

  switch (parts[0]) {
    case undefined: homeView(); break;
    case 'new': billFormView(null, q.get('c')); break;
    case 'edit': billFormView(parts[1]); break;
    case 'bills': billsView(tab || 'pending'); break;
    case 'bill': billView(parts[1]); break;
    case 'customers': customersView(); break;
    case 'customer': customerView(parts[1], tab || 'all'); break;
    case 'more': moreView(); break;
    default: notFound();
  }
  window.scrollTo(0, 0);
}

// home period chips live outside per-view handlers
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-act=period]');
  if (chip) { homePeriod = chip.dataset.p; homeView(); }
});

window.addEventListener('hashchange', route);
renderShopName();
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js');
}
