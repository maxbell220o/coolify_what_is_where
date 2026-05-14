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

## Daten
- `data/services.json` – Liste der Dienste
- `uploads/` – hochgeladene Icons
