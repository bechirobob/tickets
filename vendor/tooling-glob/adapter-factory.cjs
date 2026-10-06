'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_PATTERNS = 256;
const MAX_PATTERN_LENGTH = 4096;
const MAX_TOTAL_PATTERN_LENGTH = 65536;
const MAX_NESTING = 16;

// Tickets-only contract. This is not an implementation of the fast-glob API.
// The provider must be the official glob package's supported synchronous API.
module.exports = function createToolingGlob(providerSync) {
  function globSync(input, options = {}) {
    const patterns = typeof input === 'string' ? [input] : input;
    if (!Array.isArray(patterns) || patterns.some(p => typeof p !== 'string' || !p)) {
      throw new TypeError('tooling-glob expects a nonempty string or an array of nonempty strings');
    }
    if (patterns.length > MAX_PATTERNS) throw new RangeError('too many tooling-glob patterns');
    let totalLength = 0;
    for (const pattern of patterns) {
      totalLength += pattern.length;
      if (pattern.length > MAX_PATTERN_LENGTH || totalLength > MAX_TOTAL_PATTERN_LENGTH) {
        throw new RangeError('tooling-glob pattern length limit exceeded');
      }
      // Bound parser nesting before any provider sees input. This intentionally
      // conservative scan is not a proof of bounded brace-expansion cardinality.
      const depth = { '{': 0, '[': 0, '(': 0 };
      const open = { '}': '{', ']': '[', ')': '(' };
      for (let i = 0; i < pattern.length; i++) {
        const character = pattern[i];
        if (character === '\\') { i++; continue; }
        if (Object.hasOwn(depth, character)) depth[character]++;
        else if (Object.hasOwn(open, character)) depth[open[character]] = Math.max(0, depth[open[character]] - 1);
        if (depth['{'] + depth['['] + depth['('] > MAX_NESTING) {
          throw new RangeError('tooling-glob nesting limit exceeded');
        }
      }
    }
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'cwd' && k !== 'onlyDirectories')) {
      throw new TypeError('tooling-glob supports only cwd and onlyDirectories options');
    }
    if (options.cwd !== undefined && typeof options.cwd !== 'string') throw new TypeError('cwd must be a string');
    if (options.onlyDirectories !== undefined && typeof options.onlyDirectories !== 'boolean') throw new TypeError('onlyDirectories must be boolean');
    // Fail visibly for syntax whose semantics differ between implementations.
    for (const pattern of patterns) {
      const terminalGlobstar = /(^|\/)\*\*\/?$/;
      const dynamicBase = terminalGlobstar.test(pattern) && /[?*{}\[\]]/.test(pattern.replace(terminalGlobstar, ''));
      if (/(^|[^\\])\(/.test(pattern) || /(?:^|\/)\.\/\.\//.test(pattern) || /[?*{}\[\]][^]*\/\.\.(?:\/|$)/.test(pattern) || dynamicBase) {
        throw new Error('tooling-glob received an unsupported advanced pattern');
      }
    }
    const cwd = options.cwd ?? process.cwd();
    const stripDot = p => p.replace(/^\.\//, '') || '.';
    const negatives = patterns.filter(p => p.startsWith('!')).flatMap(p => {
      const bare = stripDot(p.slice(1));
      return [bare, `${bare.replace(/\/$/, '')}/**`];
    });
    const matches = new Set();
    for (const original of patterns.filter(p => !p.startsWith('!'))) {
      const pattern = stripDot(original).replace(/(^|\/)\*\*(\/?)$/, '$1**/*$2');
      // Sort within each pattern; preserve caller pattern order and deduplication.
      for (let candidate of providerSync(pattern, { cwd, ignore: negatives, follow: true, nocase: false, nodir: false, dot: false, mark: false }).sort()) {
        candidate = candidate.replace(/\\/g, '/');
        if (candidate.length > 1) candidate = candidate.replace(/\/$/, '');
        if (original.endsWith('/') && !/[?*\[\]]/.test(original)) candidate += '/';
        let stats;
        try { stats = fs.statSync(path.resolve(cwd, candidate)); }
        catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
        if (original.endsWith('/') && !stats.isDirectory()) continue;
        if (stats.isDirectory() !== !!options.onlyDirectories) continue;
        if (!/[?*{}\[\]\\]/.test(original)) {
          candidate = original;
        } else if (original.startsWith('./') && !candidate.startsWith('./') && !path.isAbsolute(candidate)) {
          candidate = `./${candidate}`;
        }
        matches.add(candidate);
      }
    }
    return [...matches];
  }
  return { globSync, sync: globSync };
};
