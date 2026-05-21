// Derive the lean dataset + keyword index from upstream's data/all.json.
//
// We keep data/all.json untouched (matches upstream so we can pull updates
// without merge conflicts) and write two derived files alongside it:
//   data/all-lean.json — base dataset for native-only rendering. Compact
//                        shape: sprite fields dropped, skin variations
//                        flagged as a number (standard Fitzpatrick set)
//                        or short array (multi-skin pairs), category
//                        membership stored per-emoji rather than as a
//                        list of IDs per category, keywords removed.
//   data/keywords.json — { emojiId: [kw, kw, ...] }, capped + filler-dropped
//
// Consumers that don't need keyword search can skip importing keywords.json;
// their bundler omits the ~25 KB gzip payload entirely.

const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data')
const INPUT = path.join(DATA_DIR, 'all.json')
const BASE_OUTPUT = path.join(DATA_DIR, 'all-lean.json')
const KEYWORDS_OUTPUT = path.join(DATA_DIR, 'keywords.json')

const KEYWORD_CAP = 6

// These keywords appear hundreds of times across the dataset (every flag has
// "country"/"nation"/"banner"; every animal has "animal"; every food has
// "food") but nobody types them to find a specific emoji. Dropping them
// trims the search index without hurting actual search.
const FILLER_KEYWORDS = new Set([
  'face',
  'human',
  'female',
  'male',
  'nature',
  'animal',
  'food',
  'sports',
  'transportation',
  'blue-square',
])

// Short-form keys from compress.js to drop entirely:
//   d, e, f, h — has_img_<set> sprite flags (sprite rendering removed)
//   k          — sheet_x/sheet_y (sprite rendering removed)
//   o          — added_in / sort_order (never read by picker code)
// `subcategory` is also dropped (also never read).
const STRIP_FIELDS = ['d', 'e', 'f', 'h', 'k', 'o', 'subcategory']

// The 292 of 305 emojis that have skin variations use exactly these five
// Fitzpatrick tones. We flag them with `s: 1` and reconstruct the full set
// at uncompress time. The other 13 are multi-skin pair emojis (Handshake,
// Two Women Holding Hands, Kiss, etc.) — they get the explicit tone list.
const STANDARD_TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']
const STANDARD_TONE_SET = new Set(STANDARD_TONES)

// About half the canonical names match a trivial Title Case of the emoji
// id (e.g., `grinning_face` → "Grinning Face"). For those we drop `a`
// from the lean dataset and reconstruct in uncompress(). The other half
// have richer names that don't derive cleanly (`100` → "Hundred Points
// Symbol", `joy` → "Face with Tears of Joy") — we keep those verbatim.
const deriveName = (id) =>
  id
    .replace(/[-_]+/g, ' ')
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())

const isDerivableName = (id, name) =>
  typeof name === 'string' && name.toLowerCase() === deriveName(id).toLowerCase()

const compactSkinVariations = (variations) => {
  const tones = Object.keys(variations)
  if (
    tones.length === STANDARD_TONES.length &&
    tones.every((t) => STANDARD_TONE_SET.has(t))
  ) {
    return 1
  }
  return tones
}

const extractKeywords = (emoji) => {
  if (!Array.isArray(emoji.j)) return null
  const filtered = emoji.j.filter((k) => !FILLER_KEYWORDS.has(k))
  const capped = filtered.slice(0, KEYWORD_CAP)
  return capped.length ? capped : null
}

const trimEmoji = (emoji, id) => {
  for (const key of STRIP_FIELDS) delete emoji[key]

  if (emoji.skin_variations) {
    emoji.s = compactSkinVariations(emoji.skin_variations)
    delete emoji.skin_variations
  }

  if (isDerivableName(id, emoji.a)) {
    delete emoji.a
  }

  // Keywords are extracted into a separate file; drop them from the base
  // record so consumers that don't need search pay no extra weight.
  delete emoji.j

  return emoji
}

const main = () => {
  const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'))

  // Move category membership onto the per-emoji record as `p: <category index>`.
  // The category list keeps only id + name (no per-category emoji ID arrays).
  // (`c` is taken by upstream's compressed `non_qualified` field, so we use `p`.)
  data.categories.forEach((cat, idx) => {
    if (Array.isArray(cat.emojis)) {
      for (const emojiId of cat.emojis) {
        if (data.emojis[emojiId]) {
          data.emojis[emojiId].p = idx
        }
      }
      delete cat.emojis
    }
  })

  const keywords = {}
  let touched = 0
  for (const id in data.emojis) {
    const kw = extractKeywords(data.emojis[id])
    if (kw) keywords[id] = kw
    trimEmoji(data.emojis[id], id)
    touched++
  }

  fs.writeFileSync(BASE_OUTPUT, JSON.stringify(data))
  fs.writeFileSync(KEYWORDS_OUTPUT, JSON.stringify(keywords))

  const baseKb = (fs.statSync(BASE_OUTPUT).size / 1024).toFixed(1)
  const kwKb = (fs.statSync(KEYWORDS_OUTPUT).size / 1024).toFixed(1)
  console.log(
    `Read data/all.json (upstream). Wrote data/all-lean.json ${baseKb} KB, data/keywords.json ${kwKb} KB. ${touched} emojis processed.`,
  )
}

main()
