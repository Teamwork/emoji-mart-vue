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

// 116 of 305 skin-variation emojis have unified codepoints that are
// straightforwardly `parent-tone` (e.g., wave 1F44B → 1F44B-1F3FB). For
// those we flag them with `s: 1` (or `s: [tones]` when the tone keys
// aren't the standard 5) and reconstruct at uncompress time.
//
// The other 189 are ZWJ sequences (`1F468-1F3FB-200D-1F9B0` for red
// haired man — tone in the middle) or variation-selector sequences
// (`261D-FE0F-1F3FB` for point up + VS-16 + tone) that don't fit the
// simple pattern. Those keep the full `skin_variations` map with the
// unified codepoint per tone; the size cost (~2.6 KB gzip) is worth
// not rendering "👨🟫" instead of "👨🏽".
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

// Either returns a compact `s` value (1 or [tones]) when every variation's
// unified codepoint is exactly `parent-tone`, or null when the variations
// need their full unified strings preserved (ZWJ sequences etc.).
const compactSkinVariations = (parent, variations) => {
  const tones = Object.keys(variations)
  for (const tone of tones) {
    const v = variations[tone]
    const unified = typeof v === 'string' ? v : v && v.unified
    if (unified !== `${parent}-${tone}`) {
      return null
    }
  }
  if (
    tones.length === STANDARD_TONES.length &&
    tones.every((t) => STANDARD_TONE_SET.has(t))
  ) {
    return 1
  }
  return tones
}

// Flatten the upstream `{tone: {unified, sheet_x, ...}}` shape to a simple
// `{tone: unified}` map. Used for the emojis where compactSkinVariations
// returns null.
const flattenSkinVariations = (variations) => {
  const out = {}
  for (const tone in variations) {
    const v = variations[tone]
    out[tone] = typeof v === 'string' ? v : v.unified
  }
  return out
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
    const compact = compactSkinVariations(emoji.b, emoji.skin_variations)
    if (compact !== null) {
      emoji.s = compact
      delete emoji.skin_variations
    } else {
      // ZWJ / VS-16 sequence — preserve the full unified codepoints.
      emoji.skin_variations = flattenSkinVariations(emoji.skin_variations)
    }
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
