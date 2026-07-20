# Field Agronomy Offline (PWA)

This module runs alongside the main app and does not modify app.py.

## Complete offline app scope

The app now covers the full field workflow in offline mode:

1. Agronomic collection (dry matter, weight, fruit items, defects, notes)
2. Plot inspection (pests, diseases, irrigation, fertilization, weather, action)
3. Field occurrences (type, severity, description, coordinates)
4. Local supplier catalog (updated from API or manually)
5. Sync queue with JSON export/import

All records are saved locally in IndexedDB and synchronized later.

## 1) Run API + frontend together on port 8010

The PWA frontend is served by the same API process, so you only need one process:

```powershell
cd \\192.168.0.24\blue_skies_app\agronomia_offline_sync_api
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8010
```

Access:

1. Desktop: http://localhost:8010/index.html
2. Mobile (same network): http://MACHINE_IP:8010/index.html

With free ngrok, open only one tunnel:

```powershell
ngrok http 8010
```

Use the same HTTPS domain to install the app and synchronize data.

Optional (recommended for production): protect API with token.

```powershell
$env:AGRONOMIA_SYNC_API_KEY="YOUR_STRONG_TOKEN_HERE"
uvicorn main:app --host 0.0.0.0 --port 8010
```

Then in the PWA app under Synchronization, fill in the API token field and save.

Main endpoints:

1. GET /health
2. GET /api/agronomia/catalogos/fornecedores
3. POST /api/agronomia/sync/lote

## 2) Database setup

Run:

1. [sql/setup_offline_sync_agronomia.sql](../sql/setup_offline_sync_agronomia.sql)

## 3) Recommended field usage flow

1. Open the app and go to Synchronization
2. Set API URL to /api/agronomia/sync/lote (same origin)
3. Refresh supplier catalog
4. Register collections/inspections/occurrences in the field
5. When internet is available again, click Sync now

## 4) Technical notes

1. The offline queue uses id_local (UUID) for idempotency.
2. analise_campo records insert into trusted.tb_analise_detalhada_agronomia.
3. inspecao_talhao and ocorrencia_campo records are also persisted in domain tables:
   trusted.tb_inspecao_talhao_agronomia and trusted.tb_ocorrencia_campo_agronomia.
4. All types still write to trusted.tb_sync_offline_agronomia for sync auditing.
5. Service Worker caches static assets for offline usage and does not cache /api/*.
6. /health and /api/* remain in the API; /index.html and assets are served on the same port 8010.
