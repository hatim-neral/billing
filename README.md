# BillBook

A simple, mobile-first billing app for a retail shop (watches, sunglasses, frames, clothing). Runs in the browser and can be installed on Android via Chrome → **Add to Home screen**.

## Features

- **Quick bills**: type an item and its price in a table; the category is detected from the name (e.g. "Cartier watch" → Watches)
- **Product photos**: take a photo or choose one from the gallery for each item
- **Payments**: paid in full, part-paid, or pending; record later payments against a bill
- **Customers**: search by name or phone and see their full history: total bought, paid, pending
- **Bills**: pending, paid, and all, with search
- **Revenue**: last 7 days, this month, 3 / 6 / 12 months, lifetime; sales vs. collected, by category
- **Share**: print a bill or send it on WhatsApp
- **Backup**: download and restore everything, photos included
- **Sample data**: optionally load 100 demo customers to try it out

## Run locally

No build step. Serve the folder:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. To use it on a phone on the same Wi-Fi, open `http://<your-computer-ip>:8000`.

## Data

All data stays on the device: bills and customers in `localStorage`, photos in IndexedDB. Use **More → Download backup** regularly.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell and bottom navigation |
| `app.js` | All screens, storage, and logic |
| `sample.js` | Optional demo data generator |
| `styles.css` | Styles (light and dark mode) |
| `manifest.json`, `sw.js`, `icon.svg` | Installable PWA and offline support |
