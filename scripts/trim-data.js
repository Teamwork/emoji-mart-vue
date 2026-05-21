// Derive the lean dataset + keyword index from upstream's data/all.json.
//
// We keep data/all.json untouched (matches upstream so we can pull updates
// without merge conflicts) and write two derived files alongside it:
//   data/all-lean.json — base dataset for native-only rendering
//                        (no sprite fields, flattened skin variations,
//                         keywords stripped out)
//   data/keywords.json — { emojiId: [kw, kw, ...] }, capped + filler-dropped
//
// Consumers that don't need keyword search can skip importing keywords.json;
// their bundler omits the ~30 KB gzip payload entirely.

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

// Short-form keys from compress.js: d/e/f/h are has_img_<set> sprite flags,
// k is sheet_x/sheet_y.
const STRIP_FIELDS = ['d', 'e', 'f', 'h', 'k']

const trimSkinVariations = (variations) => {
  const out = {}
  for (const tone in variations) {
    const v = variations[tone]
    // Source shape carries sheet coords + per-OS image flags per tone;
    // native rendering only needs the unified codepoint.
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

const trimEmoji = (emoji) => {
  for (const key of STRIP_FIELDS) delete emoji[key]

  if (emoji.skin_variations) {
    emoji.skin_variations = trimSkinVariations(emoji.skin_variations)
  }

  // Keywords are extracted into a separate file; drop them from the base
  // record so consumers that don't need search pay no extra weight.
  delete emoji.j

  return emoji
}

const main = () => {
  const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'))

  const keywords = {}
  let touched = 0
  for (const id in data.emojis) {
    const kw = extractKeywords(data.emojis[id])
    if (kw) keywords[id] = kw
    trimEmoji(data.emojis[id])
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
