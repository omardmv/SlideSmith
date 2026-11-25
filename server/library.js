// Image library: the bundled aesthetic packs (shipped in public/library/) plus
// any images the user scrapes from Pinterest with their own Apify key. Scraped
// images are downloaded to ~/.slidesmith/library/ so the browser can composite
// them onto the export canvas same-origin (remote URLs would taint it).
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { logger } from './log.js'

const log = logger('scrape')
const __dirname = dirname(fileURLToPath(import.meta.url))
const DIR = process.env.SLIDESMITH_DIR || join(homedir(), '.slidesmith')
const MEDIA_DIR = join(DIR, 'library')
const INDEX_PATH = join(DIR, 'library.json')
const BUNDLED_MANIFEST = join(__dirname, '..', 'public', 'library', 'manifest.json')

function ensure() {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true })
}
function readJson(p, fb) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fb }
}

// Flatten the bundled manifest into image records the UI can render.
function bundled() {
  const m = readJson(BUNDLED_MANIFEST, { packs: [] })
  return (m.packs || []).flatMap((pack) =>
    (pack.images || []).map((path) => ({
      id: `bundled:${path}`,
      url: `/library/${path}`,
      pack: pack.name,
      source: 'bundled',
    }))
  )
}

// Names of the bundled aesthetic packs (used as the default selection for new projects).
export function bundledPackNames() {
  const m = readJson(BUNDLED_MANIFEST, { packs: [] })
  return (m.packs || []).map((p) => p.name)
}

function scrapedIndex() {
  return readJson(INDEX_PATH, [])
}

// Recover image files on disk that aren't in the index (e.g. if the index was
// emptied or drifted). Re-indexes them with stable ids matching the original
// scheme so nothing is silently orphaned.
function reconcileOrphans() {
  const index = scrapedIndex()
  if (!existsSync(MEDIA_DIR)) return index
  const known = new Set(index.map((s) => s.file))
  let changed = false
  for (const file of readdirSync(MEDIA_DIR)) {
    if (!/\.(jpe?g|png|webp)$/i.test(file) || known.has(file)) continue
    index.push({ id: `scraped:${file.replace(/\.[^.]+$/, '')}`, file, pack: 'Scraped', addedAt: new Date().toISOString() })
    changed = true
  }
  if (changed) writeJson(INDEX_PATH, index)
  return index
}

// Images scraped before format sniffing existed may be HEIC/AVIF, which render
// blank on the canvas. Convert them to JPEG in place (keeping their id, so
// slideshows that already point at them keep working); drop any we can't convert.
function repairUnsafeFormats(index) {
  let changed = false
  const out = []
  for (const rec of index) {
    const p = join(MEDIA_DIR, rec.file)
    if (!/\.(heic|heif|avif)$/i.test(rec.file) || !existsSync(p)) { out.push(rec); continue }
    const buf = readFileSync(p)
    const jpeg = toJpeg(buf, sniffImage(buf) || 'heic')
    changed = true
    if (!jpeg) { log.warn(`dropped ${rec.file} (format the browser can't draw)`); continue }
    const file = rec.file.replace(/\.[^.]+$/, '.jpg')
    writeFileSync(join(MEDIA_DIR, file), jpeg)
    rmSync(p)
    out.push({ ...rec, file })
  }
  if (changed) writeJson(INDEX_PATH, out)
  return out
}

export function listLibrary() {
  // Only list scraped images whose files actually exist on disk — avoids broken
  // thumbnails / 404s if the index and files ever drift apart. Reconcile first
  // so any orphaned files on disk are picked back up.
  const scraped = repairUnsafeFormats(reconcileOrphans())
    .filter((s) => existsSync(join(MEDIA_DIR, s.file)))
    .map((s) => ({
      id: s.id,
      url: `/api/library/img/${encodeURIComponent(s.id)}`,
      pack: s.pack || 'Scraped',
      source: 'scraped',
    }))
  // Scraped first (newest), then the bundled packs.
  return [...scraped, ...bundled()]
}

// Group the library into packs with a few cover thumbnails each (for the
// pack-picker UIs in Generate + Settings).
export function listPacks() {
  const map = new Map()
  for (const img of listLibrary()) {
    if (!map.has(img.pack)) map.set(img.pack, { name: img.pack, source: img.source, count: 0, covers: [] })
    const p = map.get(img.pack)
    p.count++
    if (p.covers.length < 4) p.covers.push(img.url)
  }
  return [...map.values()]
}

export function getScrapedFile(id) {
  const rec = scrapedIndex().find((s) => s.id === id)
  if (!rec) return null
  const p = join(MEDIA_DIR, rec.file)
  return existsSync(p) ? p : null
}

export function removeScraped(id) {
  const index = scrapedIndex()
  const rec = index.find((s) => s.id === id)
  // Delete the actual file too — otherwise reconcileOrphans() sees an
  // un-indexed file on disk and immediately re-adds it ("zombie" delete).
  if (rec) {
    const p = join(MEDIA_DIR, rec.file)
    if (existsSync(p)) rmSync(p)
  }
  writeJson(INDEX_PATH, index.filter((s) => s.id !== id))
  return listLibrary()
}
function writeJson(p, v) {
  ensure()
  writeFileSync(p, JSON.stringify(v, null, 2))
}

// Pull image URLs out of whatever the Pinterest actor returns. Pinterest actors
// vary in shape between versions, so we try the structured path first (best
// quality) and fall back to scanning the whole response for pinimg.com assets,
// preferring full-size originals over thumbnails.
function pinImageUrls(items) {
  const list = Array.isArray(items) ? items : []

  // 1) Structured: media.images.{original|large|...}
  const structured = new Set()
  for (const item of list) {
    if (item && typeof item === 'object') {
      if (item.type && item.type !== 'pin') continue
      const s = item?.media?.images
      const chosen = s?.original ?? s?.orig ?? s?.large ?? s?.medium ?? s?.small
      if (chosen?.url) structured.add(String(chosen.url).replace(/&amp;/g, '&'))
    }
  }
  if (structured.size) return [...structured]

  // 2) Fallback: scan the whole blob for pinimg URLs. Prefer /originals/.
  const blob = JSON.stringify(list)
  const matches = blob.match(/https?:\\?\/\\?\/[^"'\\\s]*pinimg\.com[^"'\\\s]*/gi) || []
  const cleaned = matches
    .map((u) => u.replace(/\\\//g, '/').replace(/&amp;/g, '&'))
    .filter((u) => /\.(jpe?g|png|webp)/i.test(u))
  const originals = cleaned.filter((u) => /\/originals\//i.test(u))
  // De-dupe by the trailing filename so we don't keep both a thumb and original.
  const byName = new Map()
  for (const u of [...originals, ...cleaned]) {
    const name = u.split('/').pop()
    if (name && !byName.has(name)) byName.set(name, u)
  }
  return [...byName.values()]
}

// Pinterest's CDN 403s requests without a browser-ish User-Agent.
const IMG_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://www.pinterest.com/',
}

const APIFY = 'https://api.apify.com/v2/acts'

// What the bytes actually are. Pinterest URLs don't reliably say (a ".jpg" pin can
// be served as HEIC), so we sniff the header instead of trusting the extension.
function sniffImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif'
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (/^(avif|avis)$/.test(brand)) return 'avif'
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'heic'
  }
  return null
}

// Formats every browser can draw onto the export canvas. HEIC is Safari-only and
// AVIF support is uneven, so both get converted to JPEG instead.
const CANVAS_SAFE = new Set(['jpg', 'png', 'webp', 'gif'])

// Convert a downloaded image to JPEG. Uses macOS's built-in `sips` (no extra
// dependency); returns null where that isn't available so the caller can skip
// the image rather than save a file the canvas can't draw.
function toJpeg(buf, kind) {
  if (process.platform !== 'darwin') return null
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
  const src = join(tmpdir(), `slidesmith-${stamp}.${kind}`)
  const dst = join(tmpdir(), `slidesmith-${stamp}.jpg`)
  try {
    writeFileSync(src, buf)
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', src, '--out', dst], { stdio: 'ignore' })
    return readFileSync(dst)
  } catch {
    return null
  } finally {
    for (const p of [src, dst]) if (existsSync(p)) rmSync(p)
  }
}

export async function scrapePinterest({ apiKey, actor, searches, count }) {
  if (!apiKey) throw new Error('Missing Apify API key. Add it in Settings.')
  const queries = (searches || []).map((s) => s.trim()).filter(Boolean)
  if (!queries.length) throw new Error('Enter at least one Pinterest search.')

  const actorPath = (actor || 'fatihtahta/pinterest-scraper-search').replace('/', '~')
  // This actor expects `{ queries, limit }` (NOT `searches`/`resultsLimit`), and
  // its minimum limit is 10 — anything lower returns 0 items.
  const limit = Math.min(Math.max(Number(count) || 40, 10), 200)
  const input = { queries, limit }
  const pack = queries.join(', ')

  log.start(`Scraping Pinterest → "${pack}" (up to ${limit})`)
  log.step(`running Apify actor ${actor || 'fatihtahta/pinterest-scraper-search'}…`)
  const res = await fetch(`${APIFY}/${actorPath}/run-sync-get-dataset-items?token=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    log.fail(`Apify ${res.status}`)
    throw new Error(`Apify ${res.status}: ${t.slice(0, 160)}`)
  }
  const items = await res.json()
  log.info(`actor returned ${Array.isArray(items) ? items.length : 0} item${(Array.isArray(items) ? items.length : 0) === 1 ? '' : 's'}`)
  const urls = pinImageUrls(items).slice(0, limit)
  if (!urls.length) {
    const n = Array.isArray(items) ? items.length : 0
    log.fail(`no images found (actor returned ${n} item${n === 1 ? '' : 's'})`)
    throw new Error(`No images found (actor returned ${n} item${n === 1 ? '' : 's'}). Try a different search or actor.`)
  }
  log.ok(`found ${urls.length} image${urls.length === 1 ? '' : 's'} — downloading…`)

  ensure()
  const index = scrapedIndex()
  let added = 0
  let skipped = 0
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: IMG_FETCH_HEADERS })
      if (!r.ok) { skipped++; continue }
      let buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 1024) { skipped++; continue } // skip tiny/placeholder
      let kind = sniffImage(buf)
      if (kind && !CANVAS_SAFE.has(kind)) {
        // e.g. HEIC: the browser can't draw it, so the slide would render blank.
        const jpeg = toJpeg(buf, kind)
        if (!jpeg) { log.warn(`skipped a ${kind.toUpperCase()} image (can't convert on this system)`); skipped++; continue }
        buf = jpeg
        kind = 'jpg'
      }
      if (!kind) { skipped++; continue } // not an image we recognise
      const id = `scraped:${Date.now()}-${Math.round(Math.random() * 1e6)}`
      const file = `${id.replace('scraped:', '')}.${kind}`
      writeFileSync(join(MEDIA_DIR, file), buf)
      index.unshift({ id, file, pack, addedAt: new Date().toISOString() })
      added++
      if (added % 5 === 0 || added === urls.length) log.progress(added, urls.length, 'downloaded')
    } catch {
      skipped++ // skip individual failures
    }
  }
  writeJson(INDEX_PATH, index)
  log.ok(`Added ${added} image${added === 1 ? '' : 's'} to "${pack}"${skipped ? ` (${skipped} skipped)` : ''}`)
  return { added, found: urls.length }
}
