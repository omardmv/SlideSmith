// Save a rendered slideshow (PNG data URLs + caption) to disk as loose files.
// Each save lands in its own numbered folder so generations never overwrite
// each other:
//   ~/.slidesmith/exports/<projectSlug>/<NNN>-<hookSlug>/
//     slide-01.png, slide-02.png, …, caption.txt
//
// The number prefix is the next one after the highest existing sibling, so
// deleted folders don't get reused (no collisions).
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXPORTS_DIR } from './store.js'

// Make a filesystem-safe slug: lowercase, ASCII-ish, hyphen-separated, trimmed.
function slugify(input, fallback) {
  const base = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || fallback
}

// First 5 words of the hook, capped at 40 chars, slugified.
function hookSlug(hook) {
  const words = String(hook || '').split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
  const slug = slugify(words, 'untitled')
  return slug.slice(0, 40) || 'untitled'
}

// Scan the project folder, find the highest "<NNN>-" prefix, return the next.
function nextIndex(projectDir) {
  if (!existsSync(projectDir)) return 1
  let max = 0
  for (const entry of readdirSync(projectDir)) {
    const m = entry.match(/^(\d{1,6})-/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

// Write a slideshow's rendered slides + caption to its own folder.
// `slides` are PNG data URLs ("data:image/png;base64,…").
// Returns the absolute path of the written folder.
export function saveSlideshowToDisk({ projectName, hook, slides, caption, hashtags }) {
  const projectSlug = slugify(projectName, 'project')
  const projectDir = join(EXPORTS_DIR, projectSlug)
  const idx = nextIndex(projectDir)
  const prefix = String(idx).padStart(3, '0')
  const folder = join(projectDir, `${prefix}-${hookSlug(hook)}`)

  mkdirSync(folder, { recursive: true })

  slides.forEach((dataUrl, i) => {
    const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '')
    const name = `slide-${String(i + 1).padStart(2, '0')}.png`
    writeFileSync(join(folder, name), Buffer.from(base64, 'base64'))
  })

  // Strip a leading '#' from each hashtag (the model sometimes returns them
  // already prefixed), then format. Caller passes the RAW caption — we are the
  // single source of truth for joining caption + hashtags.
  const tags = (hashtags || [])
    .map((t) => String(t).trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(' ')
  const captionText = tags ? `${caption || ''}${caption ? ' ' : ''}${tags}\n` : `${caption || ''}\n`
  writeFileSync(join(folder, 'caption.txt'), captionText, 'utf8')

  return folder
}
