import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compilePattern,
  literal,
  mapMatch,
  template,
} from 'regex-stream-transform';

function random(seed) {
  let state = seed;
  const next = (bound) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % bound;
  };
  return { next, pick: (values) => values[next(values.length)] };
}

const atoms = ['a', 'b', 'c', '.', '[ab]', '[^a]', '\\b', '\\B', '^', '$'];
const assertion = /^(?:\\[bB]|\^|\$)$/;
const quantifiers = ['*', '+', '?', '*?', '+?', '??', '{0,2}', '{1,2}?', '{2}'];

function pattern({ next, pick }, depth) {
  if (depth === 0 || next(4) === 0) return pick([...atoms, '\\w', '\\s', ' ']);
  const inner = () => pattern({ next, pick }, depth - 1);
  switch (next(5)) {
    case 0:
      return inner() + inner();
    case 1:
      return `(?:${inner()}|${inner()})`;
    case 2: {
      const body = inner();
      return assertion.test(body) ? body : `(?:${body})${pick(quantifiers)}`;
    }
    case 3:
      return `(${inner()})`;
    default:
      return inner() + inner() + inner();
  }
}

const replacements = [
  { replacement: literal('X'), native: 'X', earliest: 'always' },
  { replacement: template('[$&]'), native: '[$&]', earliest: 'always' },
  { replacement: template('<$1>'), native: '<$1>', earliest: 'no-captures' },
  {
    replacement: mapMatch((match) => `${match.start}:${match.text};`),
    native: (text, ...rest) => `${rest[rest.length - 2]}:${text};`,
    earliest: 'never',
  },
];

const capturing = /\((?!\?:)/;

test('streamed replacement agrees with String.prototype.replace', () => {
  const generator = random(12345);
  const { next, pick } = generator;
  for (let round = 0; round < 1500; round++) {
    const source = pattern(generator, 4);
    const flags = pick(['', 'i', 'm', 's', 'im']);
    const native = new RegExp(source, `gu${flags}`);
    for (let sample = 0; sample < 4; sample++) {
      const input = Array.from({ length: next(10) }, () =>
        pick(['a', 'b', 'c', ' ', '\n', 'A']),
      ).join('');
      for (const {
        replacement,
        native: equivalent,
        earliest,
      } of replacements) {
        const expected = input.replace(native, equivalent);
        const supported =
          earliest === 'always' ||
          (earliest === 'no-captures' && !capturing.test(source));
        for (const options of supported ? [{}, { earliest: true }] : [{}]) {
          const label = JSON.stringify({ source, flags, input, options });
          const stream = compilePattern(source, flags).replacer(
            replacement,
            options,
          );
          let output = '';
          for (let start = 0; start < input.length; ) {
            const end = start + 1 + next(3);
            output += stream.write(input.slice(start, end));
            assert.ok(expected.startsWith(output), label);
            start = end;
          }
          assert.equal(output + stream.finish(), expected, label);
        }
      }
    }
  }
});
