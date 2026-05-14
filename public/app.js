// --- Owner Token (im LocalStorage, wird als Header gesendet) ---
const TOKEN_KEY = 'cww:owner-token';
function getToken() {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}
function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  headers.set('X-Owner-Token', getToken());
  return fetch(path, { ...opts, headers });
}

// --- DOM ---
const mineCards = document.getElementById('mine-cards');
const allCards = document.getElementById('all-cards');
const catFilter = document.getElementById('category-filter');
const catList = document.getElementById('cat-list');
const addBtn = document.getElementById('add-btn');

const svcModal = document.getElementById('svc-modal');
const svcForm = document.getElementById('svc-form');
const svcTitle = document.getElementById('svc-title');
const svcError = document.getElementById('svc-error');
const svcPort = document.getElementById('svc-port');
const svcPortHint = document.getElementById('svc-port-hint');
const svcFree = document.getElementById('svc-free');
const svcCancel = document.getElementById('svc-cancel');

const tokenBtn = document.getElementById('token-btn');
const tokenModal = document.getElementById('token-modal');
const myTokenInput = document.getElementById('my-token');
const claimInput = document.getElementById('claim-token');
const claimApply = document.getElementById('claim-apply');
const tokenError = document.getElementById('token-error');

let BLOCKED = new Set();
let services = [];
let editingId = null;

async function init() {
  BLOCKED = new Set(await fetch('/api/blocked-ports').then(r => r.json()));
  await reload();
}

async function reload() {
  services = await api('/api/services').then(r => r.json());
  renderAll();
  renderCategories();
}

function renderCategories() {
  const cats = [...new Set(services.map(s => s.category).filter(Boolean))].sort();
  const cur = catFilter.value;
  catFilter.innerHTML = '<option value="">Alle Kategorien</option>'
    + cats.map(c => `<option ${c===cur?'selected':''}>${escapeHtml(c)}</option>`).join('');
  catList.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

function renderAll() {
  const mine = services.filter(s => s.mine);
  const filter = catFilter.value;
  const all = filter ? services.filter(s => s.category === filter) : services;

  mineCards.innerHTML = '';
  if (mine.length === 0) {
    mineCards.innerHTML = '<p class="empty">Noch keine eigenen Dienste. Klick auf „+ Neuer Dienst".</p>';
  } else {
    mine.sort((a,b) => (a.order??0)-(b.order??0))
      .forEach(s => mineCards.appendChild(renderCard(s, true)));
    enableReorder(mineCards);
  }

  allCards.innerHTML = '';
  if (all.length === 0) {
    allCards.innerHTML = '<p class="empty">Keine Dienste in dieser Kategorie.</p>';
  } else {
    all.sort((a,b) => (a.order??0)-(b.order??0))
      .forEach(s => allCards.appendChild(renderCard(s, false)));
  }
}

function renderCard(s, owned) {
  const card = document.createElement('div');
  card.className = 'card' + (owned ? ' mine' : '');
  card.dataset.id = s.id;
  if (owned) card.draggable = true;
  const url = `http://${s.address}:${s.port}`;
  card.innerHTML = `
    <a class="body" href="${url}" target="_blank" rel="noopener">
      ${s.image
        ? `<img src="${s.image}" alt="">`
        : `<div class="ph"></div>`}
      <div class="name"></div>
      <div class="addr"></div>
      ${s.category ? `<div class="cat"></div>` : ''}
      ${s.description ? `<div class="desc"></div>` : ''}
    </a>
    ${owned ? `<div class="card-actions">
      <button class="icon" data-act="edit" title="Bearbeiten">✎</button>
      <button class="icon danger" data-act="del" title="Löschen">🗑</button>
    </div>` : ''}
  `;
  card.querySelector('.name').textContent = s.name;
  card.querySelector('.addr').textContent = `${s.address}:${s.port}`;
  if (!s.image) card.querySelector('.ph').textContent = s.name.charAt(0).toUpperCase();
  if (s.category) card.querySelector('.cat').textContent = s.category;
  if (s.description) card.querySelector('.desc').textContent = s.description;
  if (owned) {
    card.querySelector('[data-act=edit]').onclick = (e) => { e.preventDefault(); openEdit(s); };
    card.querySelector('[data-act=del]').onclick = async (e) => {
      e.preventDefault();
      if (!confirm(`"${s.name}" löschen?`)) return;
      await api(`/api/services/${s.id}`, { method: 'DELETE' });
      await reload();
    };
  }
  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Modal: Add / Edit ---
function openCreate() {
  editingId = null;
  svcTitle.textContent = 'Neuer Dienst';
  svcForm.reset();
  svcForm.id.value = '';
  svcError.textContent = '';
  svcPortHint.textContent = '';
  svcModal.showModal();
}
function openEdit(s) {
  editingId = s.id;
  svcTitle.textContent = 'Dienst bearbeiten';
  svcForm.reset();
  svcForm.id.value = s.id;
  svcForm.name.value = s.name;
  svcForm.address.value = s.address;
  svcForm.port.value = s.port;
  svcForm.category.value = s.category || '';
  svcForm.description.value = s.description || '';
  svcError.textContent = '';
  svcPortHint.textContent = '';
  svcModal.showModal();
}
addBtn.onclick = openCreate;
svcCancel.onclick = () => svcModal.close();

// Port-Live-Check
let portTimer = null;
function validatePortLocal(p) {
  if (!Number.isInteger(p) || p < 1 || p > 65535) return 'Port 1–65535';
  if (BLOCKED.has(p)) return `Port ${p} ist gesperrt`;
  return null;
}
svcPort.addEventListener('input', () => {
  svcPortHint.textContent = '';
  svcError.textContent = '';
  const p = parseInt(svcPort.value, 10);
  if (!svcPort.value) { svcPort.setCustomValidity(''); return; }
  const err = validatePortLocal(p);
  svcPort.setCustomValidity(err || '');
  if (err) { svcPortHint.textContent = err; return; }
  clearTimeout(portTimer);
  portTimer = setTimeout(async () => {
    const r = await fetch(`/api/check-port?port=${p}`);
    const j = await r.json();
    if (!j.ok) {
      // bei Edit den eigenen aktuellen Port nicht als belegt anzeigen
      const editing = editingId ? services.find(x => x.id === editingId) : null;
      if (editing && editing.port === p) { svcPortHint.textContent = 'aktueller Port'; return; }
      const msg = j.reason === 'in_use' ? `Port ${p} ist belegt (Prozess läuft)`
        : j.reason === 'already_assigned' ? `Port ${p} ist schon einem Dienst zugewiesen`
        : `Port ${p} nicht verfügbar`;
      svcPort.setCustomValidity(msg);
      svcPortHint.textContent = msg;
    } else {
      svcPortHint.textContent = '✓ frei';
    }
  }, 350);
});

svcFree.onclick = async () => {
  svcFree.disabled = true; svcFree.textContent = '…';
  try {
    const r = await fetch('/api/free-port');
    const j = await r.json();
    if (j.port) { svcPort.value = j.port; svcPort.dispatchEvent(new Event('input')); }
    else svcError.textContent = j.error || 'Kein freier Port';
  } finally {
    svcFree.disabled = false; svcFree.textContent = 'Freien Port holen';
  }
};

svcForm.addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value !== 'save') return;
  e.preventDefault();
  svcError.textContent = '';
  const p = parseInt(svcPort.value, 10);
  const err = validatePortLocal(p);
  if (err) { svcError.textContent = err; return; }

  const fd = new FormData(svcForm);
  fd.delete('id');
  if (!fd.get('image') || !fd.get('image').name) fd.delete('image');

  const url = editingId ? `/api/services/${editingId}` : '/api/services';
  const method = editingId ? 'PUT' : 'POST';
  const r = await api(url, { method, body: fd });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    svcError.textContent = j.error || 'Fehler';
    return;
  }
  svcModal.close();
  await reload();
});

catFilter.addEventListener('change', renderAll);

// --- Drag-Reorder (nur eigene) ---
let dragCard = null;
function enableReorder(container) {
  container.querySelectorAll('.card.mine').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragCard = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', async () => {
      card.classList.remove('dragging');
      dragCard = null;
      const order = [...container.querySelectorAll('.card')].map(c => c.dataset.id);
      await api('/api/services/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
    });
  });
  container.addEventListener('dragover', (e) => {
    if (!dragCard) return;
    e.preventDefault();
    const target = e.target.closest('.card');
    if (!target || target === dragCard) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    container.insertBefore(dragCard, before ? target : target.nextSibling);
  });
}

// --- Token-Dialog ---
tokenBtn.onclick = () => {
  myTokenInput.value = getToken();
  claimInput.value = '';
  tokenError.textContent = '';
  tokenModal.showModal();
};
myTokenInput.addEventListener('focus', () => myTokenInput.select());
claimApply.onclick = async () => {
  const other = claimInput.value.trim();
  if (!other) { tokenError.textContent = 'Token eintragen'; return; }
  let ok = 0, fail = 0;
  for (const s of services) {
    const r = await api(`/api/services/${s.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: other }),
    });
    if (r.ok) ok++; else if (r.status === 403) {/* not owned by other */} else fail++;
  }
  tokenError.style.color = ok ? '#4ade80' : '#f87171';
  tokenError.textContent = ok
    ? `${ok} Dienst(e) übernommen.`
    : 'Token passt zu keinem Dienst.';
  if (ok) await reload();
};

init();
