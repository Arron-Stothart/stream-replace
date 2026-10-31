import assert from 'node:assert/strict';
import test from 'node:test';
import {
  literal,
  template,
  mapMatch,
  compile,
  parse,
  replacer,
  exactReplacer,
  transducer,
  codepoints,
  choice,
  sequence,
  repeat,
  empty,
  capture,
  compilePattern,
  replaceInStream,
  symbol,
} from 'regex-stream-transform';
import { prefixes } from '../dist/onward.js';
import { replace, words } from './reference.mjs';

const a = codepoints([[97, 97]]);
const b = codepoints([[98, 98]]);

function expressions() {
  const atoms = [a, b, empty(), choice()];
  const result = [...atoms];
  for (const left of atoms)
    for (const right of atoms)
      result.push(choice(left, right), sequence(left, right));
  for (const body of [a, choice(a, b), repeat(a, false), choice(empty(), a)])
    for (const greedy of [true, false]) {
      result.push(
        repeat(body, greedy),
        sequence(repeat(body, greedy), b),
        capture('outer', sequence(capture('inner', repeat(body, greedy)), a)),
      );
    }
  return result;
}

test('both executors implement the independent ordered-expression semantics', () => {
  for (const expression of expressions()) {
    const program = compile(expression);
    for (const replacement of [[], [88]]) {
      const machine = transducer(program, replacement);
      assert.ok(prefixes(machine).every((prefix) => prefix.length === 0));
      for (const input of words([97, 98], 3)) {
        const calls = [];
        const expected = replace(expression, input, (match) => {
          calls.push(match);
          return replacement;
        });
        const observed = [];
        const stream = replacer(program, (match) => {
          observed.push({
            start: match.start,
            end: match.end,
            captures: Object.fromEntries(
              [...match.captures]
                .filter(([, span]) => span !== null)
                .map(([name, span]) => [name, [span.start, span.end]]),
            ),
          });
          return replacement;
        });
        const exact = exactReplacer(machine);
        const actual = [];
        const earliest = [];
        for (const value of input) {
          actual.push(...stream.write([value]));
          earliest.push(...exact.write([value]));
        }
        actual.push(...stream.finish());
        earliest.push(...exact.finish());
        assert.deepEqual(actual, expected);
        assert.deepEqual(earliest, expected);
        assert.deepEqual(observed, calls);
      }
    }
  }
});

test('literal emission includes output forced beyond an unresolved match', () => {
  const branching = compilePattern('a*b|a').replacer(literal('X'));
  assert.equal(branching.write('a'), 'X');
  assert.equal(branching.write('a'), '');
  assert.equal(branching.finish(), 'X');
  const repeated = compilePattern('a*').replacer(literal('X'));
  assert.equal(repeated.write('a'), 'XX');
  assert.equal(repeated.finish(), '');
  const identity = compilePattern('a*b').replacer(template('$&'));
  assert.equal(identity.emission, 'earliest');
  assert.equal(identity.write('aaaa'), 'aaaa');
});

test('committed output is a prefix of every examined continuation', () => {
  for (const source of ['a*b|a', 'a*', 'ab|a', '^a|b$', '\\b[a-b]*\\b']) {
    const expression = parse(source);
    const pattern = compilePattern(source);
    for (const prefix of words([97, 98], 3)) {
      const stream = pattern.replacer(literal('X'));
      const output = stream.write(String.fromCodePoint(...prefix));
      for (const suffix of words([97, 98, 33], 3)) {
        const expected = String.fromCodePoint(
          ...replace(expression, [...prefix, ...suffix], () => [88]),
        );
        assert.ok(expected.startsWith(output));
      }
    }
  }
});

test('text results and callback spans are independent of UTF-16 chunk partitions', () => {
  const input = 'a😀b𝄞!';
  for (const replacement of [
    literal('X'),
    template('$&'),
    mapMatch((match) => `${match.start}:${match.text}`),
  ]) {
    const pattern = compilePattern('.', 's');
    const whole = pattern.replacer(replacement);
    const expected = whole.write(input) + whole.finish();
    for (let mask = 0; mask < 2 ** (input.length - 1); mask++) {
      const stream = pattern.replacer(replacement);
      let output = stream.write('');
      let start = 0;
      for (let index = 1; index <= input.length; index++)
        if (index === input.length || mask & (1 << (index - 1))) {
          output += stream.write(input.slice(start, index));
          output += stream.write('');
          start = index;
        }
      assert.equal(output + stream.finish(), expected);
    }
  }
});

test('the dialect rejects unsupported syntax and makes capture rules explicit', () => {
  for (const source of [
    '*',
    'a**',
    '(',
    ')',
    '[a-',
    'a{3,1}',
    '(?=a)',
    '(a)\\1',
    '(?<x>a)(?<x>b)',
  ])
    assert.throws(() => compilePattern(source));
  assert.throws(() => compilePattern('a', 'y'), SyntaxError);
  assert.throws(
    () => compilePattern('a').replacer(template('$1')),
    SyntaxError,
  );
  const retained = compilePattern('(?<outer>(?:(?<inner>a)|b)*)').replacer(
    template('$<inner>'),
  );
  assert.equal(retained.write('ab') + retained.finish(), 'a');
  const nested = compilePattern('(a*?)*').replacer(literal('X'));
  assert.equal(nested.write('aa') + nested.finish(), 'XX');
  const zero = compilePattern('(a){0}').replacer(template('$1'));
  assert.equal(zero.write('a') + zero.finish(), 'a');
});

test('word boundaries use the same folded alphabet as word characters', () => {
  const pattern = compilePattern('\\b\\w+\\b', 'i');
  const stream = pattern.replacer(literal('X'));
  assert.equal(stream.write('ſ K') + stream.finish(), 'X X');
  const properties = compilePattern('\\p{Letter}+', 'u').replacer(literal('X'));
  assert.equal(properties.write('λ🙂é') + properties.finish(), 'X🙂X');
});

test('memoized replacement reuses failure work after a delayed match', () => {
  let evaluations = 0;
  const letter = symbol((value) => {
    evaluations++;
    return value === 'a';
  });
  const end = symbol((value) => {
    evaluations++;
    return value === 'b';
  });
  const stream = replacer(
    compile(choice(sequence(repeat(letter), end), letter)),
    ['X'],
  );
  const length = 10000;
  for (let index = 0; index < length; index++)
    assert.deepEqual(stream.write(['a']), []);
  assert.equal(stream.finish().join(''), 'X'.repeat(length));
  assert.ok(evaluations <= length * 4);
});

test('sessions reject reentrancy and remain closed after failure or EOF', () => {
  const error = new Error('replacement');
  const failed = compilePattern('a').replacer(
    mapMatch(() => {
      throw error;
    }),
  );
  assert.throws(
    () => failed.write('a'),
    (value) => value === error,
  );
  assert.throws(() => failed.finish(), /closed/);
  let reentrant;
  reentrant = compilePattern('a').replacer(
    mapMatch(() => {
      assert.throws(() => reentrant.write('a'), /running/);
      return 'X';
    }),
  );
  assert.equal(reentrant.write('a'), 'X');
  reentrant.finish();
  assert.throws(() => reentrant.write(''), /closed/);
});

test('the exported Web Stream transform executes the built package', async () => {
  const input = new ReadableStream({
    start(controller) {
      for (const chunk of ['a', 'a', 'b', '!']) controller.enqueue(chunk);
      controller.close();
    },
  });
  const reader = input
    .pipeThrough(replaceInStream({ pattern: 'a+b', replacement: literal('X') }))
    .getReader();
  let output = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    output += next.value;
  }
  assert.equal(output, 'X!');
});

test('malformed UTF-16 fails the text session instead of entering the scalar model', () => {
  const stream = compilePattern('.').replacer(literal('X'));
  assert.equal(stream.write('\ud800'), '');
  assert.throws(() => stream.finish(), /surrogate/);
  assert.throws(() => stream.write('a'), /closed/);
  assert.throws(
    () => compilePattern('.').replacer(literal('X')).write('\udc00'),
    /surrogate/,
  );
  assert.throws(
    () => compilePattern('.').replacer(literal('\ud800')),
    /surrogate/,
  );
  assert.throws(
    () =>
      compilePattern('.')
        .replacer(mapMatch(() => '\ud800'))
        .write('a'),
    /surrogate/,
  );
});

test('replacement descriptions expose their interpretation and emission timing', () => {
  const pattern = compilePattern('(a+)');
  const fixed = pattern.replacer(literal('$1'));
  assert.equal(fixed.emission, 'earliest');
  assert.equal(fixed.write('a'), '$1');
  assert.equal(fixed.write('a'), '');
  assert.equal(fixed.finish(), '');

  const captured = pattern.replacer(template('$1'));
  assert.equal(captured.emission, 'after-match');
  assert.equal(captured.write('aa'), '');
  assert.equal(captured.finish(), 'aa');

  const identity = pattern.replacer(template('$&'));
  assert.equal(identity.emission, 'earliest');
  assert.equal(identity.write('aa'), 'aa');
  assert.equal(identity.finish(), '');

  const calls = [];
  const mapped = pattern.replacer(
    mapMatch((match) => {
      calls.push(match.text);
      return String(match.text.length);
    }),
  );
  assert.equal(mapped.emission, 'after-match');
  assert.equal(mapped.write('a'), '');
  assert.equal(mapped.write('a'), '');
  assert.deepEqual(calls, []);
  assert.equal(mapped.finish(), '2');
  assert.deepEqual(calls, ['aa']);
  assert.throws(
    () => compilePattern('a').replacer(template('$1')),
    /Unknown capture/,
  );
});

test('pattern nesting does not consume the JavaScript call stack', () => {
  const depth = 4000;
  const pattern = compilePattern('('.repeat(depth) + 'a' + ')'.repeat(depth));
  const stream = pattern.replacer(
    mapMatch((match) => `${match.groups.length}:${match.text}`),
  );
  assert.equal(stream.write('a') + stream.finish(), `${depth}:a`);
});
