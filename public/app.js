const cardsEl = document.getElementById('cards');
const form = document.getElementById('add-form');
const errEl = document.getElementById('form-error');
const portInput = document.getElementById('port-input');
const portHint = document.getElementById('port-hint');
const freeBtn = document.getElementById('free-port-btn');

let BLOCKED = new Set();

async function init() {
  const blocked = await fetch('/api/blocked-ports').then(r => r.json());
  BLOCKED = new Set(blocked);
  portHint.textContent = `Gesperrte Ports (Browser): ${blocked.length} – z.B. 22, 25, 80 ist erlaubt, 6000 nicht.`;
  await loadServices();
}

function validatePort(p) {
  if (!Number.isInteger(p) || p < 1 || p > 65535) return 'Port muss 1–65535 sein';
  if (BLOCKED.has(p)) return `Port ${p} ist vom Browser gesperrt`;
  return null;
}

portInput.addEventListener('input', () => {
  const p = parseInt(portInput.value, 10);
  if (!portInput.value) { portInput.setCustomValidity(''); return; }
  const err = validatePort(p);
  portInput.setCustomValidity(err || '');
  errEl.textContent = err || '';
});

freeBtn.addEventListener('click', async () => {
  freeBtn.disabled = true;
  freeBtn.textContent = 'Suche …';
  try {
    const r = await fetch('/api/free-port');
    const j = await r.json();
    if (j.port) {
      portInput.value = j.port;
      portInput.dispatchEvent(new Event('input'));
    } else {
      errEl.textContent = j.error || 'Kein freier Port';
    }
  } catch (e) {
    errEl.textContent = 'Fehler beim Holen';
  } finally {
    freeBtn.disabled = false;
    freeBtn.textContent = 'Freien Port holen';
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.textContent = '';
  const p = parseInt(portInput.value, 10);
  const err = validatePort(p);
  if (err) { errEl.textContent = err; return; }

  const fd = new FormData(form);
  const r = await fetch('/api/services', { method: 'POST', body: fd });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    errEl.textContent = j.error || 'Fehler';
    return;
  }
  form.reset();
  await loadServices();
});

async function loadServices() {
  const list = await fetch('/api/services').then(r => r.json());
  cardsEl.innerHTML = '';
  if (list.length === 0) {
    cardsEl.innerHTML = '<p style="opacity:.6">Noch keine Dienste.</p>';
    return;
  }
  for (const s of list) {
    const card = document.createElement('div');
    card.className = 'card';
    const url = `http://${s.address}:${s.port}`;
    card.innerHTML = `
      <a class="body" href="${url}" target="_blank" rel="noopener">
        ${s.image
          ? `<img src="${s.image}" alt="">`
          : `<div class="ph">${s.name.charAt(0).toUpperCase()}</div>`}
        <div class="name"></div>
        <div class="addr"></div>
      </a>
      <button class="del" data-id="${s.id}">Löschen</button>
    `;
    card.querySelector('.name').textContent = s.name;
    card.querySelector('.addr').textContent = `${s.address}:${s.port}`;
    card.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`"${s.name}" löschen?`)) return;
      await fetch(`/api/services/${s.id}`, { method: 'DELETE' });
      await loadServices();
    });
    cardsEl.appendChild(card);
  }
}

init();
