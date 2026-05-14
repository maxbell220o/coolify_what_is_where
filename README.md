# Coolify – What is Where

Kleines Dashboard, um selbst gehostete Dienste (z.B. in Coolify) zu sammeln:
Adresse + Port, Name, Bild. Klick auf eine Karte öffnet `http://adresse:port`.

## Features
- Dienste speichern, anzeigen (Karten-Grid mit Bild), löschen
- **Port-Validierung** gegen die vom Browser gesperrten Ports
  (1, 7, 9, 11, 13, 15, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665–6669, 6697,
  10080) – diese können nicht gewählt werden
- **Free-Port-Tool**: Knopf "Freien Port holen" findet einen auf dem Server
  tatsächlich freien Port (überspringt die gesperrten)

## Start
```
npm install
npm start
```
Dann http://localhost:3000 öffnen.

`PORT=8080 npm start` für anderen Port.

## Port-Prüfung in Docker / Coolify

Wenn die App im Container läuft, kann der lokale `listen()`-Test einen Port als
„frei" melden, der in Wirklichkeit am Host (z.B. von Coolify-Containern) belegt
ist. Der Container hat eine eigene Netzwerk-Namespace.

Lösung: Die App verbindet sich per TCP zu konfigurierbaren Probe-Hosts und
prüft, ob der Port von dort aus offen ist.

Wichtig beim Deploy:
- In **docker-compose** ist `extra_hosts: ["host.docker.internal:host-gateway"]`
  bereits gesetzt.
- In **Coolify** als Dockerfile-Resource: unter „Custom Docker Options" ergänzen:
  `--add-host=host.docker.internal:host-gateway`
- Umgebungsvariable `PROBE_HOSTS` (Default `host.docker.internal,172.17.0.1`)
  kann auf die echte LAN-IP des Servers gesetzt werden, falls
  `host.docker.internal` nicht aufgelöst wird.

## Daten
- `data/services.json` – Liste der Dienste
- `uploads/` – hochgeladene Icons
