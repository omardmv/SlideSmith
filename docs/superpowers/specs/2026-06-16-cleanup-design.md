# Cleanup: drop post-bridge + OpenRouter, add ZAI + local save

**Date:** 2026-06-16
**Status:** Approved (Approach A — surgical)

## Goal

Strip SlideSmith down to slide generation only. Remove scheduling/posting/analytics (post-bridge) and replace OpenRouter with ZAI (Zhipu AI), which the user already has a subscription for. Generated slides save to disk as loose image files instead of being scheduled.

## Non-goals

- Database migration of existing `~/.slidesmith/config.json` files.
- Adding tests. No test infra currently exists in the repo; out of scope.
- Reshaping `App.tsx` state management or splitting components.
- Auto-removing queue items on save (kept explicit — user deletes via the existing "reject" action if they want).

## What changes

### Server

**Deleted files**
- `server/postbridge.js`
- `server/openrouter.js` (replaced by `server/zai.js`)

**`server/zai.js` (new)** — copy of `openrouter.js` with these changes:
- `BASE = 'https://api.z.ai/api/paas/v4'`
- Drop `HTTP-Referer` / `X-Title` attribution headers.
- `listModels()` → GET `/models` (ZAI exposes the OpenAI-style catalog).
- `validateKey(apiKey)` → reuse GET `/models` with the auth header (ZAI has no OpenRouter `/key` endpoint; a 200 means the key works).
- `chatJSON()` → identical request body. ZAI is OpenAI-compatible and supports `response_format: { type: 'json_object' }`.

**`server/generate.js`** — change import from `./openrouter.js` to `./zai.js`. No other changes.

**`server/store.js`**
- Default `keys` object: drop `postbridge`, rename `openrouter` → `zai`. Result: `{ zai: '', apify: '' }`.
- Default model: `'glm-4.7'`.
- Same spread-merge pattern on read, so old configs with `openrouter` just become orphaned (unread). Documented in README.

**`server/index.js`** — remove:
- Imports of `./postbridge.js` and `listAccounts`/`listPosts`/`listAnalytics`/`syncAnalytics`/`uploadMedia`/`createPost`.
- Routes: `GET /api/accounts`, `GET /api/posts`, `GET /api/results`, `POST /api/results/sync`, `POST /api/schedule`.
- The `postbridge` branch in `POST /api/config/test`.
- The `schedLog = logger('schedule')` line.
- Swap `import { listModels, validateKey } from './openrouter.js'` → `from './zai.js'`.

**New endpoint: `POST /api/save/:id`**
- Body: `{ slides: string[] (PNG data URLs), caption: string, hashtags: string[] }`
- Resolves the active project's name + the slideshow's hook.
- Writes to `~/.slidesmith/exports/<projectSlug>/<NNN>-<hookSlug>/` where:
  - `projectSlug` = slugified project name (lowercase, hyphenated, fallback `project`).
  - `NNN` = next number in the project folder, zero-padded to 3 digits. Determined by scanning existing sibling folders and incrementing from the highest prefix found. Deleted folders don't get reused (no collisions).
  - `hookSlug` = first 5 words of the hook, slugified, truncated to 40 chars. Fallback `untitled`.
- Files inside the folder: `slide-01.png`, `slide-02.png`, … and `caption.txt` (caption + space + hashtags joined with spaces, trailing newline).
- Returns `{ path }` (absolute path to the written folder).
- Errors: 500 with `{ error }` if disk write fails.

### Frontend

**Deleted files**
- `src/views/ScheduleView.tsx`
- `src/views/ResultsView.tsx`
- `src/components/ScheduleModal.tsx`
- `src/components/BulkScheduleModal.tsx`

**Renamed/adapted**
- `src/components/BulkScheduleModal.tsx` is deleted. A new `src/components/BulkSaveModal.tsx` is added (same modal shape — progress, per-item status, list of saved paths at the end).

**`src/types.ts`**
- Remove `SocialAccount`, `ScheduledPost`, `PostResult`, `ProjectDefaults` interfaces.
- `ViewKey` → drop `'schedule' | 'results'`. New value: `'queue' | 'library' | 'brain' | 'settings'`.
- `Project` → drop the `defaults` field.
- `AppConfig.keys` → `{ zai: string; apify: string }` (drop `postbridge`, rename `openrouter` → `zai`).

**`src/lib/api.ts`**
- Remove `getAccounts`, `schedule`, `getScheduledPosts`, `getResults`, `syncResults`.
- Add `saveSlideshow(id, payload: { slides: string[]; caption: string; hashtags: string[] })` → `POST /api/save/:id`, returns `{ path: string }`.

**`src/components/Sidebar.tsx`** — drop the `schedule` and `results` entries from the `nav` array.

**`src/App.tsx`**
- Drop state: `accounts`, `scheduling`, `bulkOpen` (renamed `bulkSaveOpen`), `selectedIds` (kept for bulk save).
- Drop handlers: `confirmSchedule`, `loadAccounts`.
- Add `saveSlideshow(slideshow)` — renders slides client-side, POSTs to `/api/save/:id`, shows the returned path as a transient toast/error.
- `onApprove` on QueueView → triggers `saveSlideshow`.
- New `bulkSaveOpen` state; bulk modal opens when selected IDs > 0.
- Update initial-view logic: `if (!cfg.keys.zai) setActiveView('settings')`.

**`src/views/QueueView.tsx`**
- Card primary action: "Save" instead of "Approve" → calls `onSave(id)`.
- Keep multi-select checkboxes. Bulk action bar button: "Save selected (N)".
- Drop any scheduling-specific copy.

**`src/components/SlideshowEditorModal.tsx`**
- Primary action: "Save to disk" instead of "Schedule" → renders + calls save.

**`src/components/BulkSaveModal.tsx` (new)**
- Adapted from `BulkScheduleModal` structure.
- Iterates over selected slideshows **sequentially** (not concurrent — avoids 5 big PNG POSTs at once).
- Per item: render → POST → show "Saved N/M" with a green check / red error per item.
- On finish: list saved paths. Selected items stay in the queue (no auto-clear); user can delete manually if desired.
- Closing via X/backdrop just closes — no queue mutation needed since we don't auto-remove.

**`src/views/SettingsView.tsx`**
- Remove the post-bridge key input + "connected accounts" section.
- Remove per-project `defaults.socialAccountIds` UI (the field is gone from the type).
- Rename "OpenRouter key" → "ZAI key". Same input shape, saved to `keys.zai`.
- Model dropdown still pulls from `/api/models` (now ZAI's catalog).
- Keep Apify key field (Library still uses it).

**`src/lib/render.ts`** — no changes.

### Docs

**`README.md`**
- Rewrite "How it works" diagram: drop post-bridge → show "Save to disk".
- Update "What you need" table: ZAI + Apify (optional). Remove post-bridge row.
- Update "Using it": drop steps 6 (Approve) and 7 (Schedule / Results). Replace with "Save — pick a slideshow and hit Save; PNGs + caption land in `~/.slidesmith/exports/`."
- Update "Where your data lives": add `~/.slidesmith/exports/` line; remove post-bridge line; note that old `openrouter` / `postbridge` config keys are orphaned (unread) after this change.

**`.env.example`** — drop the post-bridge mention from the trailing comment; note ZAI key entered via Settings.

**`package.json`** — no dependency changes.

## Data flow

```
You ──▶ Brain (niche, audience, style)
          │
          ▼
   ZAI writes slideshows ──▶ Queue (review / edit / Save)
                                      │
                                      ▼
                       Slides rendered to PNGs in the browser
                                      │
                                      ▼
                  POST /api/save/:id → ~/.slidesmith/exports/<project>/<NNN>-<hook>/
```

## Error handling

- Render errors (canvas failure) → caught client-side, surfaced per-item in bulk modal, or as inline error on the queue card / editor.
- Server write errors (disk full, permissions) → 500 with `{ error }`, surfaced same way.
- Missing ZAI key on generate → `Missing ZAI API key. Add it in Settings.` (existing message shape).
- ZAI API errors → bubble the status + message through (same as today).

## Out-of-scope notes for future work

- Tests. None exist; would be a separate initiative.
- Migrating existing `openrouter` config keys to `zai` automatically.
- Hiding vs. pruning the orphaned `openrouter` / `postbridge` keys in already-written `config.json` files (they're simply ignored on read).
