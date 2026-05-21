const build = require('./build')

// Trimmed fork: only `all.json` is shipped. Per-set sprite files
// (apple/facebook/google/twitter) were dropped along with sprite rendering.
build({ output: 'data/all.json' })
