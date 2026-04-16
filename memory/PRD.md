# QuoteExtract (TrueFlow Business Automations) - PRD

## Problem Statement
Build a PDF contact extraction portal for a construction company. Users upload PDFs/ZIPs, the app uses AI (Claude/GPT) to extract contact info, deduplicates, filters, and displays results in a sortable table with CSV download.

## Architecture
- **Frontend**: React + Tailwind + Shadcn UI (dark navy theme)
- **Backend**: FastAPI + MongoDB + Emergent Object Storage
- **AI**: emergentintegrations LlmChat (Claude Sonnet default, Claude Haiku, GPT-4o configurable)
- **OCR**: pdfplumber + pytesseract fallback
- **Auth**: JWT httpOnly cookies

## User Personas
- Construction company employees who need to extract contacts from bid documents
- Admin users who manage AI model settings and API keys

## Core Requirements
- [x] JWT auth (login, register, logout)
- [x] Dashboard with stats cards
- [x] PDF/ZIP file upload to Emergent Object Storage
- [x] AI-powered contact extraction with progress bar
- [x] Deduplication by email, exclusion of internal domain
- [x] Sortable/filterable contacts table
- [x] CSV download for contacts and error reports
- [x] Processing errors table with detailed failure reasons
- [x] Run history with re-download capability
- [x] Settings: AI model, API keys, exclusion domain
- [x] OCR fallback for scanned PDFs
- [x] Batch processing (10 at a time)
- [x] Dark navy professional theme
- [x] Mobile responsive

## What's Been Implemented (Apr 16, 2026)
- Full JWT auth system with brute force protection
- Dashboard with 8 stat cards, upload zone, 3 tabs
- PDF upload + ZIP extraction to Emergent Object Storage
- Background AI extraction with real-time progress polling
- Contact deduplication, domain exclusion, no-contact filtering
- Sortable/filterable contacts table with CSV download
- Error tracking table with error report CSV download
- Run history with re-download for past runs
- Settings page: AI model selector, API keys, exclusion domain
- Dark navy theme with Work Sans/IBM Plex Sans/IBM Plex Mono fonts

## Prioritized Backlog
- P0: None (MVP complete)
- P1: End-to-end test with real PDF uploads to verify AI extraction
- P1: Password reset flow
- P2: Bulk operations on contacts (select, delete)
- P2: Advanced filtering (by field, date range)
- P3: User management (admin invite users)
- P3: Export history as spreadsheet
