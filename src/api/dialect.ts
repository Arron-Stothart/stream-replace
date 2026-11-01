import type { Flags } from '../syntax/parse.js';

export interface Source {
  readonly source: string;
  readonly flags: string;
  readonly options: Flags;
}

export function readSource(pattern: string | RegExp, flags?: string): Source {
  let source: string;
  if (pattern instanceof RegExp) {
    if (flags !== undefined)
      throw new TypeError('Pass flags only with a string pattern');
    if (pattern.flags.includes('v'))
      throw new SyntaxError('The v flag is not supported; use u');
    if (!pattern.unicode)
      throw new SyntaxError(
        'A RegExp pattern needs the u flag; without it JavaScript matches UTF-16 code units',
      );
    ({ source, flags } = pattern);
  } else source = pattern;
  flags ??= '';
  if (/[^dgimsu]/.test(flags) || new Set(flags).size !== flags.length)
    throw new SyntaxError(`Unsupported or repeated flags: ${flags}`);
  const options: Flags = {
    ignoreCase: flags.includes('i'),
    multiline: flags.includes('m'),
    dotAll: flags.includes('s'),
  };
  const canonical = [...'ims'].filter((flag) => flags.includes(flag)).join('');
  return { source, flags: `${canonical}u`, options };
}
