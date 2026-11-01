'use strict';
// Preserve legacy callable imports; all matching uses the patched upstream engine.
const engine = require('@becoreops/minimatch-engine');
// Tickets' pinned eslint-plugin-import uses only makeRe(...).test(input).
// Return a matcher facade, not a RegExp or a general legacy regex API.
const makeRe = (pattern, options) => {
  const matcher = new engine.Minimatch(pattern, options);
  return { test: input => matcher.match(input) };
};
module.exports = Object.assign(engine.minimatch, engine, { makeRe });
