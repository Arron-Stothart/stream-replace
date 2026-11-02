export { compilePattern } from './api.ts';
export type { MatchOptions, Matcher, Pattern, Replacer } from './api.ts';
export { literal, template, mapMatch } from './api.ts';
export type { Replacement } from './core/replacement.ts';
export type { Match, Segment } from './core/chunk-processor.ts';
export { replaceInStream, matchInStream } from './adapters/web.ts';
export type {
  MatchStreamOptions,
  ReplaceStreamOptions,
} from './adapters/web.ts';
