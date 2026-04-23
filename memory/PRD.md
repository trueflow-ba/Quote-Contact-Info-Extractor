# QuoteExtract (TrueFlow Business Automations) - PRD

## Problem Statement
Build a construction-industry contact extraction portal. Users upload PDFs/ZIPs (and now DOCX/XLSX) of quotes and bids. The app uses Gemini 2.5 Flash Vision to extract structured contact info (CSI, City, State, Bid By, Quote Amount, Contractor, Sub-Contractor, Customer Info, Email, Phone), deduplicates, filters excluded internal domains, and displays results with sortable, reorderable tables and custom CSV export.

## Architecture
- **Frontend**: React + Tailwind + Shadcn UI (dark navy theme)
- **Backend**: FastAPI + MongoDB + Emergent Object Storage
- **AI**: emergentintegrations LlmChat — **Gemini 2.5 Flash** (primary for vision + text), Claude/GPT-4o available as configurable alternates
- **Office Parsing**: python-docx, openpyxl, LibreOffice CLI (DOCX/XLSX vision fallback)
- **OCR (legacy fallback)**: pdfplumber + tesseract + easyocr
- **Auth**: JWT httpOnly cookies

## Core Requirements
- [x] JWT auth with brute-force protection
- [x] Admin Portal (role-based access, max PDF limits, API keys)
- [x] PDF/ZIP/DOCX/XLSX upload (2-phase async to object storage)
- [x] AI extraction with live progress, pause/resume/cancel
- [x] Cross-run deduplication
- [x] Contractor + Sub-Contractor + Customer info separation
- [x] Quote Amount field
- [x] **CSI field** (numeric prefix extracted from filename)
- [x] Domain exclusion (configurable)
- [x] All Contacts unified tab, Duplicates tab, Errors tab, Run History
- [x] Column filters with search + select-all/clear-all
- [x] **Draggable column reordering** (persisted per-table in localStorage)
- [x] Sortable tables + custom-field CSV export
- [x] **CSV exports reflect current UI column order**
- [x] Charts/data viz
- [x] PII purge instruction in all AI prompts
- [x] Immediate PDF deletion after analysis
- [x] DOCX/XLSX upload & extraction

## What's Been Implemented

### Apr 16, 2026
- Full MVP, auth, dashboard, Gemini vision pipeline, dedup, CSV export, admin portal, charts.

### Apr 17–20, 2026
- Separated Contractor/Sub-Contractor, Customer fields, Quote Amount, import date, custom CSV export.
- Column filters, sortable tables, grouped views.
- Pause/Resume/Cancel with checkpoint recovery.
- Concurrency bumped 3→6, PDF auto-compression, storage auto-cleanup.
- Large ZIP upload 2-phase async flow.
- Switched entire pipeline to pure Gemini 2.5 Flash Vision.

### Apr 21, 2026
- **DOCX/XLSX support**: text-first via python-docx/openpyxl → Gemini text; vision fallback via LibreOffice → PDF → images → Gemini vision.
- **CSI field**: extracted from numeric prefix in filename (e.g., `"03. KHC.pdf"` → `03`). Stored on every contact, available in all tables and CSV exports.
- **Draggable column reorder**: every main table header is drag-and-drop. Order persists in localStorage per table (flat/grouped). "Reset cols" button.
- **UI-order CSV exports**: per-run Download CSV now routes through `/contacts/download` using current column order. All Contacts "Export CSV" dialog lists fields in UI order and sends them in that order.
- **ColumnFilter enhancements**: dropdown now has a search bar to narrow values, plus a "Select all / Clear all" checkbox (works on visible/filtered values). "Reset filter" preserved. No existing functionality removed.

### Apr 22, 2026
- **Large-run safety controls**: exponential backoff for Gemini 429s, circuit-breaker auto-pause on N consecutive failures, budget-ceiling guard (USD), admin UI thresholds.
- **LibreOffice hardening**: process-group SIGKILL on timeout, zombie sweep.
- **Chunked uploads**: frontend/backend support 25 MB chunks for files > 200 MB (bypasses ingress limit).
- **Pause/Resume state-machine race fix**: pause/resume now idempotent.
- **SHA-256 content dedup**: identical file bytes skip LLM entirely (cross-run).
- **Skip Registry export/import**: portable CSV preserves dedup state across container rebuilds.
- **Per-run Excel processing log** with 3-run retention.
- **Accounting summary bars**: "This Run" and "All Contacts" tabs now show a summary row (Files uploaded / Contacts / Duplicates / Issues / No contacts found) and cross-run totals via new `/api/stats/all` endpoint.
- **Master Index tab**: upload CSV/XLSX with a `FileName` column; compares against Skip Registry + run history and reports status per file (`Processed`, `Processed (no contacts)`, `Error`, `Pending`, `Not Uploaded`). Summary cards + file-type breakdown + searchable table + downloadable comparison CSV. Endpoints: `POST /api/master-index/upload`, `GET /api/master-index`, `GET /api/master-index/download`, `DELETE /api/master-index`.
- **Extended file format support**: `.txt` (direct decode → Gemini Text), `.odt` (odfpy → Gemini Text, LibreOffice vision fallback), `.rtf` (striprtf → Gemini Text, LibreOffice vision fallback), `.eml` (stdlib email → Gemini Text). All integrated with dedup, logging, Skip Registry, and Master Index.
- **Run stats self-healing**: `/api/runs` and `/api/runs/{id}` now recompute `total_pdfs`/`processed`/`errors`/`duplicates_removed`/`net_new` from live collection counts on every read. Fixes pre-existing drift (e.g. `processed = -21` bug). One-time backfill runs on startup. Completion snapshot now uses authoritative `files.count_documents` (not local `total_files` variable).
- **Excel log fallback**: when `file_logs` is empty (old runs or pruned data), `/api/runs/{id}/log` and `/api/runs/{id}/download/log` synthesize rows from `files`+`contacts`+`processing_errors` so the log download never returns empty.
- **Log retention removed**: file_logs kept forever (was: keep-3-runs). Disk indicator replaces the old retention policy.
- **Container disk utilization indicator**: new admin endpoints `GET /api/admin/disk-usage` and `POST /api/admin/disk-usage/clear-staging`. Admin page shows %-used bars for `/app`, `/`, `/tmp` with color-coded thresholds (green < 50%, sky < 75%, amber < 90%, red ≥ 90%) plus a "Clear Staging" button.

## Prioritized Backlog
- **P1**: Password reset flow.
- **P2**: Pagination for "All Contacts" table (10k+ rows).
- **P2**: Bulk operations on contacts (multi-select delete).
- **P2**: Advanced filtering (date range, field-level).
- **P2**: GPT-4o-mini failover on Gemini 429.
- **P2**: Optional support for .msg / .html / .rtf / .odt / .eml.
- **P3**: Admin user management (invite users).
- **P3**: Export history as spreadsheet.

## Key Credentials
- Seed admin: `admin@trueflow.com` / `TrueFlow2024!` (see `/app/memory/test_credentials.md`)
