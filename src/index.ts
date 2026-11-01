export { compilePattern } from './api/pattern.js';
export type {
  Pattern,
  ReplaceOptions,
  TextEvent,
  TextMatcher,
  TextReplacer,
} from './api/pattern.js';
export { literal, template, mapMatch } from './api/replacement.js';
export type { TextMatch, TextReplacement } from './api/replacement.js';
export { replaceInStream, matchInStream } from './api/stream.js';
export type { MatchStreamOptions, ReplaceStreamOptions } from './api/stream.js';
export type { Session } from './api/session.js';
