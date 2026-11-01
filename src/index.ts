export { compilePattern, literal, template, mapMatch } from './api.js';
export type {
  MatchOptions,
  Pattern,
  Replacement,
  ReplaceOptions,
} from './api.js';
export type { Match, Segment, Session } from './output.js';
export { replaceInStream, matchInStream } from './stream.js';
export type { MatchStreamOptions, ReplaceStreamOptions } from './stream.js';
