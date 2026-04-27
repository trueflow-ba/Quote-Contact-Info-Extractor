// Bump APP_VERSION on every release so we can verify which build is live.
// Format: <major>.<minor>.<patch> · <UTC date>
//
// Recent changes:
//   0.3.0 (2026-04-27) — chunk-upload dir auto-create on every chunk; dropped
//                         heavy ML deps (torch/easyocr/cuda); LO startup quiet
//   0.2.0 (2026-04-25) — orphan auto-cleanup; archive provenance; Resume banner
//   0.1.x — pre-versioning
export const APP_VERSION = '0.3.0';
export const APP_BUILD_DATE = '2026-04-27';
