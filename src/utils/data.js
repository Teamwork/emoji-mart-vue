const mapping = {
  name: 'a',
  unified: 'b',
  non_qualified: 'c',
  has_img_apple: 'd',
  has_img_google: 'e',
  has_img_twitter: 'f',
  has_img_facebook: 'h',
  keywords: 'j',
  sheet: 'k',
  emoticons: 'l',
  text: 'm',
  short_names: 'n',
  added_in: 'o',
}

const buildSearch = (emoji) => {
  const search = []

  var addToSearch = (strings, split) => {
    if (!strings) {
      return
    }

    ;(Array.isArray(strings) ? strings : [strings]).forEach((string) => {
      ;(split ? string.split(/[-|_|\s]+/) : [string]).forEach((s) => {
        s = s.toLowerCase()

        if (search.indexOf(s) == -1) {
          search.push(s)
        }
      })
    })
  }

  addToSearch(emoji.short_names, true)
  addToSearch(emoji.name, true)
  addToSearch(emoji.keywords, false)
  addToSearch(emoji.emoticons, false)

  return search.join(',')
}

function deepFreeze(object) {
  // Retrieve the property names defined on object
  var propNames = Object.getOwnPropertyNames(object)

  // Freeze properties before freezing self
  for (let name of propNames) {
    let value = object[name]
    object[name] =
      value && typeof value === 'object' ? deepFreeze(value) : value
  }
  return Object.freeze(object)
}

// The 292 emojis with a standard skin variation set use these five
// Fitzpatrick tones. Stored as `s: 1` in the lean dataset and reconstructed
// here so downstream code can keep reading `emoji.skin_variations`.
const STANDARD_SKIN_TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']

const expandSkinVariations = (emoji) => {
  if (!emoji.s) return
  const tones = emoji.s === 1 ? STANDARD_SKIN_TONES : emoji.s
  // Skin variation unified codepoints are always `${parent}-${tone}`.
  // For multi-skin pair emojis (e.g., Handshake) the tone key itself can
  // contain a hyphen ("1F3FB-1F3FC"), producing "PARENT-1F3FB-1F3FC".
  // `emoji.b` is the parent's unified hex — the long-form field name
  // ("unified") hasn't been assigned yet, this runs before the mapping.
  const parent = emoji.b
  const out = {}
  for (const tone of tones) {
    out[tone] = `${parent}-${tone}`
  }
  emoji.skin_variations = out
  delete emoji.s
}

// In the lean dataset each emoji carries `p: <category index>` and the
// categories array no longer holds per-category emoji ID lists. Rebuild
// those lists in memory so the picker can iterate categories as before.
const rebuildCategoryLists = (data) => {
  if (!data.categories.some((c) => !c.emojis)) return
  for (const cat of data.categories) {
    if (!cat.emojis) cat.emojis = []
  }
  for (const id in data.emojis) {
    const em = data.emojis[id]
    if (typeof em.p === 'number' && data.categories[em.p]) {
      data.categories[em.p].emojis.push(id)
    }
    delete em.p
  }
}

const uncompress = (data) => {
  if (!data.compressed) {
    return data
  }
  data.compressed = false

  rebuildCategoryLists(data)

  for (let id in data.emojis) {
    let emoji = data.emojis[id]

    expandSkinVariations(emoji)

    for (let key in mapping) {
      emoji[key] = emoji[mapping[key]]
      delete emoji[mapping[key]]
    }

    if (!emoji.short_names) emoji.short_names = []
    emoji.short_names.unshift(id)

    // Sprite sheet coords are absent in the trimmed (native-only) dataset.
    // Leave sheet_x/sheet_y undefined — getPosition() in emoji-data.js is
    // only called for sprite rendering, which never runs when native=true.
    if (emoji.sheet) {
      emoji.sheet_x = emoji.sheet[0]
      emoji.sheet_y = emoji.sheet[1]
      delete emoji.sheet
    }

    if (!emoji.text) emoji.text = ''

    if (!emoji.added_in) emoji.added_in = 6
    emoji.added_in = emoji.added_in.toFixed(1)

    emoji.search = buildSearch(emoji)
  }
  data = deepFreeze(data)
  return data
}

export { buildSearch, uncompress }
