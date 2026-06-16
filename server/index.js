// Slidesmith local server. Holds the user's API keys, runs ZAI generation,
// saves rendered slideshows to disk under ~/.slidesmith/exports/, and serves
// the built UI in production. In dev, Vite proxies /api here.
import express from 'express'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getConfig,
  saveGlobal,
  getActiveProject,
  createProject,
  updateProject,
  deleteProject,
  setActiveProject,
  getQueue,
  setQueue,
  addToQueue,
  removeFromQueue,
  CONFIG_DIR,
  EXPORTS_DIR,
} from './store.js'
import { generateSlideshows } from './generate.js'
import { listModels, validateKey } from './zai.js'
import { listLibrary, listPacks, scrapePinterest, removeScraped, getScrapedFile } from './library.js'
import { saveSlideshowToDisk } from './save.js'
import { logger } from './log.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const genLog = logger('generate')
const saveLog = logger('save')
const PORT = process.env.PORT || 8787
// Bind loopback only by default. This server returns the user's API keys in
// plaintext (GET /api/config feeds the Settings UI), so listening on all
// interfaces would hand them to anyone on the same network. Set HOST yourself
// only if you know what you're doing (e.g. a firewalled headless box).
const HOST = process.env.HOST || '127.0.0.1'
const app = express()
app.use(express.json({ limit: '50mb' })) // base64 slide images can be large

// DNS-rebinding guard: a malicious website can point its own domain at
// 127.0.0.1 and read API responses from the visitor's browser, bypassing
// same-origin policy. Rejecting unexpected Host headers closes that hole.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', process.env.HOST].filter(Boolean))
app.use((req, res, next) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '')
  if (!ALLOWED_HOSTS.has(host)) return res.status(403).json({ error: `Forbidden host: ${host}` })
  next()
})

// Wrap async handlers so thrown errors become clean 500 JSON instead of crashes.
const h = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e)
  res.status(500).json({ error: e.message || String(e) })
})

// ── Config ──────────────────────────────────────────────────────────────────
app.get('/api/config', h(async (_req, res) => res.json(getConfig())))
// Global settings only: keys + model. Project data goes through /api/projects.
app.put('/api/config', h(async (req, res) => res.json(saveGlobal(req.body || {}))))

// ── Projects (each = a Brain + background-pack selection) ──────────────────────
app.post('/api/projects', h(async (req, res) => res.json(createProject(req.body?.name))))
app.put('/api/projects/:id', h(async (req, res) => res.json(updateProject(req.params.id, req.body || {}))))
app.delete('/api/projects/:id', h(async (req, res) => res.json(deleteProject(req.params.id))))
app.post('/api/projects/:id/activate', h(async (req, res) => res.json(setActiveProject(req.params.id))))

// Validate that the saved keys actually work, so Settings can show a green check.
app.post('/api/config/test', h(async (_req, res) => {
  const { keys } = getConfig()
  const result = { zai: false, apify: false, errors: {} }
  if (keys.zai) {
    try { await validateKey(keys.zai); result.zai = true }
    catch (e) { result.errors.zai = e.message }
  }
  if (keys.apify) {
    try {
      const r = await fetch(`https://api.apify.com/v2/users/me?token=${keys.apify}`)
      if (!r.ok) throw new Error(`invalid key (${r.status})`)
      result.apify = true
    } catch (e) { result.errors.apify = e.message }
  }
  res.json(result)
}))

// Model catalog for the Settings dropdown. Requires the saved ZAI key.
app.get('/api/models', h(async (_req, res) => {
  const { keys } = getConfig()
  res.json(await listModels(keys.zai))
}))

// ── Queue (generated drafts for the active project, before save-to-disk) ──────
app.get('/api/queue', h(async (_req, res) => {
  const project = getActiveProject()
  res.json(getQueue(project.id))
}))

app.post('/api/generate', h(async (req, res) => {
  const { keys, model } = getConfig()
  const project = getActiveProject()
  const count = Math.min(Math.max(Math.round(Number(req.body?.count) || 4), 1), 100)
  // Optional preset: look it up by id in the project's preset list. If the id
  // isn't found (or is null/empty), generate without a preset.
  const presetId = req.body?.presetId ? String(req.body.presetId) : ''
  const preset = presetId
    ? (project.presets || []).find((p) => p.id === presetId) || null
    : null
  if (presetId && !preset) {
    throw new Error(`Unknown preset: ${presetId}`)
  }
  const slideshows = await generateSlideshows({ apiKey: keys.zai, model, brain: project.brain, count, preset })

  // Auto-assign background images. A per-batch `packs` override (from the
  // Generate modal) wins; otherwise fall back to the project's saved packs.
  // Empty selection → slides keep their gradients.
  const packs = Array.isArray(req.body?.packs) ? req.body.packs : project.imagePacks || []
  const pool = packs.length ? listLibrary().filter((i) => packs.includes(i.pack)) : []
  if (pool.length) {
    genLog.step(`assigning backgrounds from ${packs.length} pack${packs.length === 1 ? '' : 's'} (${pool.length} images)`)
    for (const show of slideshows) {
      const used = new Set()
      for (const slide of show.slides) {
        // Prefer an unused image within this slideshow for visual variety.
        const fresh = pool.filter((i) => !used.has(i.url))
        const pick = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))]
        slide.imageUrl = pick.url
        used.add(pick.url)
      }
    }
  }

  addToQueue(project.id, slideshows)
  res.json(slideshows)
}))

app.delete('/api/queue/:id', h(async (req, res) =>
  res.json(removeFromQueue(getActiveProject().id, req.params.id))
))

// Edit a queued slideshow: caption, hashtags, hook, and/or per-slide text+image.
app.put('/api/queue/:id', h(async (req, res) => {
  const pid = getActiveProject().id
  const patch = req.body || {}
  const allowed = ['slides', 'caption', 'hashtags', 'hook']
  const next = getQueue(pid).map((s) => {
    if (s.id !== req.params.id) return s
    const merged = { ...s }
    for (const k of allowed) if (patch[k] !== undefined) merged[k] = patch[k]
    return merged
  })
  res.json(setQueue(pid, next))
}))

// Save a rendered slideshow to disk. `slides` are PNG data URLs from the browser.
// Writes to ~/.slidesmith/exports/<projectSlug>/<NNN>-<hookSlug>/ and returns
// the absolute path so the UI can show "Saved to …".
app.post('/api/save/:id', h(async (req, res) => {
  const project = getActiveProject()
  const { slides, caption, hashtags } = req.body || {}
  if (!Array.isArray(slides) || !slides.length) throw new Error('No slide images to save.')

  saveLog.start(`Saving ${req.params.id} → ${project.name}`)
  const path = saveSlideshowToDisk({
    projectName: project.name,
    // Look up the hook from the queued slideshow so the folder name reflects
    // what was actually saved (falls back if the id has already been removed).
    hook: (getQueue(project.id).find((s) => s.id === req.params.id) || {}).hook || '',
    slides,
    caption: caption || '',
    hashtags: Array.isArray(hashtags) ? hashtags : [],
  })
  saveLog.ok(`Saved → ${path}`)
  res.json({ path })
}))

// ── Image library (bundled aesthetic packs + Pinterest scrapes via Apify) ────────
app.get('/api/library', h(async (_req, res) => res.json(listLibrary())))
app.get('/api/library/packs', h(async (_req, res) => res.json(listPacks())))

app.post('/api/library/scrape', h(async (req, res) => {
  const { keys, pinterestActor } = getConfig()
  const { searches, count } = req.body || {}
  res.json(await scrapePinterest({ apiKey: keys.apify, actor: pinterestActor, searches, count }))
}))

app.delete('/api/library/:id', h(async (req, res) => res.json(removeScraped(req.params.id))))

app.get('/api/library/img/:id', h(async (req, res) => {
  const file = getScrapedFile(req.params.id)
  if (!file) return res.status(404).end()
  // dotfiles:'allow' is required — the path lives under ~/.slidesmith, and
  // sendFile blocks dot-segment paths by default (would 404 every scrape).
  res.sendFile(file, { dotfiles: 'allow' })
}))

// ── Static (production / `npm start`) ─────────────────────────────────────────
const dist = join(__dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  // SPA fallback: any non-API GET serves index.html. (Express 5 dropped the
  // bare '*' route string, so use a middleware instead of app.get('*').)
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(join(dist, 'index.html'))
  })
}

app.listen(PORT, HOST, () => {
  console.log(`\n  Slidesmith server → http://localhost:${PORT} (bound to ${HOST})`)
  console.log(`  Config + queue stored in ${CONFIG_DIR}`)
  console.log(`  Saved slideshows written under ${EXPORTS_DIR}\n`)
})
