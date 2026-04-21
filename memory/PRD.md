# QuoteExtract (TrueFlow Business Automations) - PRD

## Problem Statement
Build a construction-industry contact extraction portal. Users upload PDFs/ZIPs (and now DOCX/XLSX) of quotes and bids. The app uses Gemini 2.5 Flash Vision to extract structured contact info (City, State, Bid By, Quote Amount, Contractor, Sub-Contractor, Customer Info, Email, Phone), deduplicates, filters excluded internal domains, and displays results with sortable tables and custom CSV export.

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
- [x] Domain exclusion (configurable)
- [x] All Contacts unified tab, Duplicates tab, Errors tab, Run History
- [x] Column filters + sortable tables + custom-field CSV export
- [x] Charts/data viz
- [x] PII purge instruction in all AI prompts
- [x] Immediate PDF deletion after analysis
- [x] DOCX/XLSX upload & extraction

## What's Been Implemented

### Apr 16, 2026
- Full MVP, auth, dashboard, Gemini vision pipeline, dedup, CSV export, admin portal, charts.

### Apr 17–20, 2026
- Separated Contractor/Sub-Contractor, Customer fields, Quote Amount, import date, custom CSV export.
- Column filters across all tables.
- Pause/Resume/Cancel with checkpoint recovery.
- Concurrency bumped 3→6, PDF auto-compression, storage auto-cleanup.
- Large ZIP upload 2-phase async flow.
- Grouped table views (Company, Bid By).
- Switched entire pipeline to pure Gemini 2.5 Flash Vision.

### Apr 21, 2026
- **DOCX/XLSX support**: upload endpoint accepts `.docx/.doc/.xlsx/.xls`.
  - DOCX → python-docx text extract → Gemini text; vision fallback via LibreOffice→PDF→images→Gemini vision if zero contacts.
  - XLSX → openpyxl text extract → Gemini text; same vision fallback.
  - Refactored `extract_contacts_with_gemini` into text + images helpers for reuse.
  - Verified E2E: real DOCX + XLSX uploaded via API → contacts correctly extracted, domain-exclusion respected.

## Prioritized Backlog
- **P1**: Harden LibreOffice subprocess (timeout cleanup, zombie process handling on high load).
- **P1**: Password reset flow.
- **P2**: Pagination for "All Contacts" table (10k+ rows).
- **P2**: Bulk operations on contacts (multi-select delete).
- **P2**: Advanced filtering (date range, field-level).
- **P3**: Admin user management (invite users).
- **P3**: Export history as spreadsheet.

## Key Credentials
- Seed admin: `admin@trueflow.com` / `TrueFlow2024!` (see `/app/memory/test_credentials.md`)
