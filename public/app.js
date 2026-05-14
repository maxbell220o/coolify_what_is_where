const hostsContainer = document.getElementById('hosts-container');
const hostForm = document.getElementById('host-form');
const svcForm = document.getElementById('service-form');
const hostSelect = document.getElementById('host-select');
const errEl = document.getElementById('form-error');
const portInput = document.getElementById('port-input');
const portHint = document.getElementById('port-hint');
const freeBtn = document.getElementById('free-port-btn');

const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const editErr = document.getElementById('edit-error');
const editTitle = document.getElementById('edit-title');
const editFreeBtn = document.getElementById('edit-free-port');
const editCancel = document.getElementById('edit-cancel');

let BLOCKED = new Set();
let hosts = [];
let services = [];

async function init() {
  const blocked = await fetch('/api/blocked-ports').then(r => r.json());
  BLOCKED = new Set(blocked);
  portHint.textContent = `Gesperrte Ports werden abgelehnt. "Freien Port holen" bevorzugt 4-stellige Ports wie 9000, 8000, 7000…`;
  await reload();
}

async function reload() {
  [hosts, services] = await Promise.all([
    fetch('/api/hosts').then(r => r.json()),
    fetch('/api/services').then(r => r.json()),
  ]);
  renderHostSelect(hostSelect);
  renderHosts();
}

function renderHostSelect(sel, selectedId) {
  sel.innerHTML = hosts.length
    ? hosts.map(h => `<option value="${h.id}"${h.id===selectedId?' selected':''}>${escapeHtml(h.name)}</option>`).join('')
    : '<option value="">— erst Host anlegen —</option>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function validatePort(p) {
  if (!Number.isInteger(p) || p < 1 || p > 65535) return 'Port 1–65535';
  if (BLOCKED.has(p)) return `Port ${p} ist gesperrt`;
  return null;
}

portInput.addEventListener('input', () => {
  const p = parseInt(portInput.value, 10);
  if (!portInput.value) { portInput.setCustomValidity(''); errEl.textContent = ''; return; }
  const err = validatePort(p);
  portInput.setCustomValidity(err || '');
  errEl.textContent = err || '';
});

async function fetchFreePort() {
  const r = await fetch('/api/free-port');
  const j = await r.json();
  return j.port || null;
}

freeBtn.addEventListener('click', async () => {
  freeBtn.disabled = true; freeBtn.textContent = '…';
  const p = await fetchFreePort();
  if (p) { portInput.value = p; portInput.dispatchEvent(new Event('input')); }
  else errEl.textContent = 'Kein freier Port';
  freeBtn.disabled = false; freeBtn.textContent = 'Freien Port holen';
});

hostForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(hostForm);
  const r = await fetch('/api/hosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fd.get('name') }),
  });
  if (r.ok) { hostForm.reset(); await reload(); }
});

svcForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.textContent = '';
  const p = parseInt(portInput.value, 10);
  const err = validatePort(p);
  if (err) { errEl.textContent = err; return; }
  const fd = new FormData(svcForm);
  if (!fd.get('hostId')) { errEl.textContent = 'Bitte Host anlegen'; return; }
  const r = await fetch('/api/services', { method: 'POST', body: fd });
  if (!r.ok) { const j = await r.json().catch(()=>({})); errEl.textContent = j.error || 'Fehler'; return; }
  svcForm.reset();
  await reload();
});

function renderHosts() {
  hostsContainer.innerHTML = '';
  if (hosts.length === 0) {
    hostsContainer.innerHTML = '<p style="opacity:.6;padding:1rem">Noch kein Host. Lege einen oben an.</p>';
    return;
  }
  for (const h of hosts) {
    const section = document.createElement('section');
    section.className = 'panel host';
    section.dataset.id = h.id;
    section.draggable = true;
    const hostSvcs = services.filter(s => s.hostId === h.id);
    section.innerHTML = `
      <div class="host-head">
        <span class="grip" title="Ziehen zum Verschieben">⠿</span>
        <h2></h2>
        <div class="host-actions">
          <button class="icon" data-act="edit-host">✎</button>
          <button class="icon danger" data-act="del-host">🗑</button>
        </div>
      </div>
      <div class="cards"></div>
    `;
    section.querySelector('h2').textContent = h.name;
    const cardsEl = section.querySelector('.cards');
    if (hostSvcs.length === 0) {
      cardsEl.innerHTML = '<p style="opacity:.5">Keine Dienste.</p>';
    } else {
      for (const s of hostSvcs) cardsEl.appendChild(renderCard(s));
    }
    section.querySelector('[data-act=edit-host]').onclick = () => openEdit('host', h);
    section.querySelector('[data-act=del-host]').onclick = async () => {
      if (!confirm(`Host "${h.name}" und alle zugehörigen Dienste löschen?`)) return;
      await fetch(`/api/hosts/${h.id}`, { method: 'DELETE' });
      await reload();
    };
    enableDnD(section, 'host');
    enableCardDnD(cardsEl);
    hostsContainer.appendChild(section);
  }
}

function renderCard(s) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = s.id;
  card.draggable = true;
  const url = `http://${s.address}:${s.port}`;
  card.innerHTML = `
    <a class="body" href="${url}" target="_blank" rel="noopener">
      ${s.image ? `<img src="${s.image}" alt="">` : `<div class="ph"></div>`}
      <div class="name"></div>
      <div class="addr"></div>
    </a>
    <div class="card-actions">
      <button class="icon" data-act="edit">✎</button>
      <button class="icon danger" data-act="del">🗑</button>
    </div>
  `;
  card.querySelector('.name').textContent = s.name;
  card.querySelector('.addr').textContent = `${s.address}:${s.port}`;
  if (!s.image) card.querySelector('.ph').textContent = s.name.charAt(0).toUpperCase();
  card.querySelector('[data-act=edit]').onclick = (e) => { e.preventDefault(); openEdit('service', s); };
  card.querySelector('[data-act=del]').onclick = async (e) => {
    e.preventDefault();
    if (!confirm(`"${s.name}" löschen?`)) return;
    await fetch(`/api/services/${s.id}`, { method: 'DELETE' });
    await reload();
  };
  return card;
}

// Drag & Drop für Hosts (vertikal)
let dragEl = null;
function enableDnD(el, kind) {
  el.addEventListener('dragstart', (e) => {
    if (e.target !== el) return;
    dragEl = el;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', async () => {
    el.classList.remove('dragging');
    dragEl = null;
    const order = [...hostsContainer.querySelectorAll('.host')].map(n => n.dataset.id);
    await fetch('/api/hosts/reorder', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ order }),
    });
  });
  el.addEventListener('dragover', (e) => {
    if (!dragEl || dragEl === el || !dragEl.classList.contains('host')) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    hostsContainer.insertBefore(dragEl, before ? el : el.nextSibling);
  });
}

function enableCardDnD(container) {
  let cardDrag = null;
  container.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.card');
    if (!c) return;
    cardDrag = c;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  });
  container.addEventListener('dragend', async (e) => {
    if (!cardDrag) return;
    cardDrag.classList.remove('dragging');
    cardDrag = null;
    // Sammle alle Karten aus allen Hosts in DOM-Reihenfolge
    const order = [...document.querySelectorAll('.card')].map(c => c.dataset.id);
    await fetch('/api/services/reorder', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ order }),
    });
    // hostId ggf. anpassen, wenn in anderen Host gezogen
    await reload();
  });
  container.addEventListener('dragover', (e) => {
    if (!cardDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target.closest('.card');
    if (target && target !== cardDrag) {
      const rect = target.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      target.parentNode.insertBefore(cardDrag, before ? target : target.nextSibling);
    } else if (!target) {
      container.appendChild(cardDrag);
    }
    // Falls in einen anderen Host gezogen, hostId in Backend aktualisieren via PUT beim Drop
    const hostSection = container.closest('.host');
    if (hostSection) cardDrag.dataset.newHostId = hostSection.dataset.id;
  });
  container.addEventListener('drop', async (e) => {
    if (!cardDrag) return;
    const newHostId = cardDrag.dataset.newHostId;
    const id = cardDrag.dataset.id;
    const svc = services.find(s => s.id === id);
    if (newHostId && svc && svc.hostId !== newHostId) {
      await fetch(`/api/services/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: newHostId }),
      });
    }
  });
}

// Edit-Modal
function openEdit(kind, item) {
  editForm.kind.value = kind;
  editForm.id.value = item.id;
  editForm.name.value = item.name;
  editErr.textContent = '';
  const svcOnly = editForm.querySelector('.svc-only');
  if (kind === 'service') {
    editTitle.textContent = 'Dienst bearbeiten';
    svcOnly.style.display = '';
    renderHostSelect(editForm.hostId, item.hostId);
    editForm.address.value = item.address;
    editForm.port.value = item.port;
  } else {
    editTitle.textContent = 'Host bearbeiten';
    svcOnly.style.display = 'none';
  }
  editModal.showModal();
}

editCancel.onclick = () => editModal.close();

editFreeBtn.onclick = async () => {
  const p = await fetchFreePort();
  if (p) editForm.port.value = p;
};

editForm.addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value !== 'save') return;
  e.preventDefault();
  editErr.textContent = '';
  const kind = editForm.kind.value;
  const id = editForm.id.value;
  if (kind === 'host') {
    const r = await fetch(`/api/hosts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editForm.name.value }),
    });
    if (!r.ok) { const j = await r.json().catch(()=>({})); editErr.textContent = j.error || 'Fehler'; return; }
  } else {
    const p = parseInt(editForm.port.value, 10);
    const err = validatePort(p);
    if (err) { editErr.textContent = err; return; }
    const fd = new FormData(editForm);
    fd.delete('kind'); fd.delete('id');
    if (!fd.get('image') || !fd.get('image').name) fd.delete('image');
    const r = await fetch(`/api/services/${id}`, { method: 'PUT', body: fd });
    if (!r.ok) { const j = await r.json().catch(()=>({})); editErr.textContent = j.error || 'Fehler'; return; }
  }
  editModal.close();
  await reload();
});

init();
