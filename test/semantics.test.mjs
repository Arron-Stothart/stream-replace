import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compilePattern,
  literal,
  mapMatch,
  matchInStream,
  replaceInStream,
  template,
} from 'stream-replace';
import { parse } from '../dist/syntax.js';
import { replace, words } from './reference.mjs';

const flags = { ignoreCase: false, multiline: false, dotAll: false };

function patterns() {
  const atoms = ['a', 'b', '(?:)', '[]'];
  const result = [...atoms];
  for (const left of atoms)
    for (const right of atoms)
      result.push(`(?:${left}|${right})`, left + right);
  for (const body of ['a', '(?:a|b)', 'a*?', '(?:|a)', '(?:(a)|b)'])
    for (const lazy of ['', '?'])
      result.push(
        `(?:${body})*${lazy}`,
        `(?:${body}){1,2}${lazy}`,
        `(?:${body})*${lazy}b`,
        `(((?:${body})*${lazy})a)`,
      );
  return result;
}

const text = (codePoints) => String.fromCodePoint(...codePoints);

function reference(source, input, replacement, limit = Infinity) {
  const calls = [];
  const output = replace(
    parse(source, flags),
    input,
    (match) => {
      const captures = {};
      for (const [index, [start, end]] of Object.entries(match.captures))
        captures[index] = text(input.slice(start, end));
      calls.push({ start: match.start, end: match.end, captures });
      return Array.from(
        replacement(text(input.slice(match.start, match.end))),
        (character) => character.codePointAt(0),
      );
    },
    limit,
  );
  return { output: text(output), calls };
}

function streamed(source, input, replacement, options = {}) {
  const calls = [];
  const stream = compilePattern(source).replacer(
    mapMatch((match) => {
      const captures = {};
      match.captures.forEach((capture, index) => {
        if (capture !== undefined) captures[index] = capture;
      });
      calls.push({ start: match.start, end: match.end, captures });
      return replacement(match.text);
    }),
    options,
  );
  const output = input.map((value) => stream.write(text([value]))).join('');
  return { output: output + stream.finish(), calls };
}

function replaced(source, input, replacement) {
  const stream = compilePattern(source).replacer(replacement);
  const output = input.map((value) => stream.write(text([value]))).join('');
  return output + stream.finish();
}

test('replacement follows the reference semantics', () => {
  for (const source of patterns())
    for (const replacement of ['', 'X'])
      for (const input of words([97, 98], 3)) {
        const expected = reference(source, input, () => replacement);
        const label = JSON.stringify({ source, input });
        assert.deepEqual(
          streamed(source, input, () => replacement),
          expected,
          label,
        );
        assert.equal(
          replaced(source, input, literal(replacement)),
          expected.output,
          label,
        );
      }
});

test('copying templates reproduce matched text exactly', () => {
  for (const source of patterns())
    for (const input of words([97, 98], 3))
      assert.equal(
        replaced(source, input, template('[$&]')),
        reference(source, input, (match) => `[${match}]`).output,
        source,
      );
});

test('a match length limit keeps the first match in priority order that fits', () => {
  for (const source of [...patterns(), 'a*b|a', '(?:a|b)*b|a', 'aa*?b|aa'])
    for (const maxMatchLength of [0, 1, 2, 3])
      for (const input of words([97, 98], 4))
        assert.deepEqual(
          streamed(source, input, () => 'X', { maxMatchLength }),
          reference(source, input, () => 'X', maxMatchLength),
          JSON.stringify({ source, maxMatchLength, input }),
        );
});

test('committed output is a prefix of every examined continuation', () => {
  for (const source of ['a*b|a', 'a*', 'ab|a', '^a|b$', '\\b[a-b]*\\b']) {
    const expression = parse(source, flags);
    const pattern = compilePattern(source);
    for (const prefix of words([97, 98], 3)) {
      const output = pattern
        .replacer(literal('X'))
        .write(String.fromCodePoint(...prefix));
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
    assert.equal(
      expected,
      input.replace(
        /./gsu,
        replacement.kind === 'map'
          ? (text, start) => `${start}:${text}`
          : replacement.kind === 'literal'
            ? 'X'
            : '$&',
      ),
    );
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

test('the dialect follows JavaScript and rejects what it cannot support', () => {
  for (const source of [
    '*',
    'a**',
    '(',
    ')',
    '[a-',
    'a{3,1}',
    '(?=a)',
    '(?<=a)',
    '(a)\\1',
    '(?<x>a)(?<x>b)',
    'a{',
  ])
    assert.throws(() => compilePattern(source), SyntaxError);
  assert.throws(() => compilePattern('a', 'y'), SyntaxError);
  assert.throws(() => compilePattern(/a/), SyntaxError);
  assert.throws(
    () => compilePattern('a').replacer(template("$'")),
    SyntaxError,
  );
  const cases = [
    ['(?<outer>(?:(?<inner>a)|b)*)', 'ab', '$<inner>'],
    ['(?:(a)|b)*', 'ab', '[$1]'],
    ['(a?){2,3}b', 'aab', '[$1]'],
    ['(a*?)*', 'aa', 'X'],
    ['(a){0}', 'a', '$1'],
    ['(a)', 'a', '$0$10$01$<x>'],
    ['(?<x>a)', 'a', '$<x>${x}$<y>'],
    ['\\cJ', '\n', 'X'],
    ['a', 'a', '$<$&>'],
    ['(a)', 'a', '$<$1$$>'],
    ['(?<x>a)', 'a', '$<$&>$<x'],
  ];
  for (const [source, input, replacement] of cases) {
    const stream = compilePattern(source).replacer(template(replacement));
    assert.equal(
      stream.write(input) + stream.finish(),
      input.replace(new RegExp(source, 'gu'), replacement),
      source,
    );
  }
});

test('word boundaries use the same folded alphabet as word characters', () => {
  const stream = compilePattern('\\b\\w+\\b', 'i').replacer(literal('X'));
  assert.equal(stream.write('ſ K') + stream.finish(), 'X X');
  const properties = compilePattern('\\p{Letter}+').replacer(literal('X'));
  assert.equal(properties.write('λ🙂é') + properties.finish(), 'X🙂X');
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
  assert.throws(() => failed.finish(), /failed earlier/);
  let reentrant;
  reentrant = compilePattern('a').replacer(
    mapMatch(() => {
      assert.throws(() => reentrant.write('a'), /running/);
      return 'X';
    }),
  );
  assert.equal(reentrant.write('a'), 'X');
  reentrant.finish();
  assert.throws(() => reentrant.write(''), /already finished/);
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

test('unpaired surrogates are ordinary code points, as with the u flag', () => {
  const stream = compilePattern('.').replacer(literal('X'));
  assert.equal(stream.write('\ud800'), '');
  assert.equal(stream.finish(), 'X');
  const split = compilePattern('😀').replacer(literal('X'));
  assert.equal(
    split.write('a\ud83d') + split.write('\ude00b') + split.finish(),
    'aXb',
  );
  const lone = compilePattern('[^a]').replacer(literal('\ud800'));
  assert.equal(lone.write('\udc00') + lone.finish(), '\ud800');
});

test('replacements are written as soon as their kind allows', () => {
  const pattern = compilePattern('(a+)');
  const fixed = pattern.replacer(literal('$1'));
  assert.equal(fixed.write('a'), '$1');
  assert.equal(fixed.write('a'), '');
  assert.equal(fixed.finish(), '');

  const captured = pattern.replacer(template('$1'));
  assert.equal(captured.write('aa'), '');
  assert.equal(captured.finish(), 'aa');

  const identity = pattern.replacer(template('<$&'));
  assert.equal(identity.write('aa'), '<aa');
  assert.equal(identity.finish(), '');

  const calls = [];
  const mapped = pattern.replacer(
    mapMatch((match) => {
      calls.push(match.text);
      return String(match.text.length);
    }),
  );
  assert.equal(mapped.write('a'), '');
  assert.equal(mapped.write('a'), '');
  assert.deepEqual(calls, []);
  assert.equal(mapped.finish(), '2');
  assert.deepEqual(calls, ['aa']);
  assert.equal(compilePattern('a').replacer(template('$1')).write('a'), '$1');
});

test('pattern nesting does not consume the JavaScript call stack', () => {
  const depth = 4000;
  const pattern = compilePattern('('.repeat(depth) + 'a' + ')'.repeat(depth));
  const stream = pattern.replacer(
    mapMatch((match) => `${match.captures.length}:${match.text}`),
  );
  assert.equal(stream.write('a') + stream.finish(), `${depth}:a`);
});

test('a length limit releases text behind an unclosed marker', () => {
  for (const options of [{ maxMatchLength: 16 }, {}]) {
    const stream = compilePattern('<b>.*?</b>', 's').replacer(
      template('[$&]'),
      options,
    );
    const output = stream.write('<b>' + 'x'.repeat(1000));
    assert.equal(
      output,
      options.maxMatchLength ? '<b>' + 'x'.repeat(1000) : '',
    );
    assert.equal(
      output + stream.write('</b>') + stream.finish(),
      options.maxMatchLength
        ? '<b>' + 'x'.repeat(1000) + '</b>'
        : '[<b>' + 'x'.repeat(1000) + '</b>]',
    );
  }
  const closed = compilePattern('<b>.*?</b>', 's').replacer(template('[$&]'), {
    maxMatchLength: 16,
  });
  assert.equal(
    closed.write('a<b>x</b>b<b>') + closed.finish(),
    'a[<b>x</b>]b<b>',
  );
});

test('options and replacements that cannot be honoured are rejected plainly', () => {
  const pattern = compilePattern('(a)');
  const rejects = (action, type, message) =>
    assert.throws(action, (error) => {
      assert.ok(error instanceof type, `${error}`);
      assert.match(error.message, message);
      return true;
    });
  for (const maxMatchLength of [-1, 1.5, NaN, '4'])
    rejects(
      () => pattern.matcher({ maxMatchLength }),
      RangeError,
      /whole number, 0 or more/,
    );
  for (const replacement of [
    { kind: 'bogus' },
    literal(5),
    template(5),
    mapMatch('X'),
    undefined,
  ])
    rejects(
      () => pattern.replacer(replacement),
      TypeError,
      /must come from literal\(\), template\(\) or mapMatch\(\)/,
    );
  rejects(() => compilePattern('a{1000000000}'), RangeError, /too large/);
  rejects(
    () => compilePattern('a', 'v'),
    SyntaxError,
    /v flag is not supported/,
  );
  rejects(
    () => compilePattern('\\p{Foo}'),
    SyntaxError,
    /\\p\{Foo\} is not a known Unicode property/,
  );
  rejects(
    () => compilePattern('\\u{zz}'),
    SyntaxError,
    /may only contain hex digits/,
  );
  rejects(
    () => compilePattern('*a'),
    SyntaxError,
    /nothing before it to repeat/,
  );
});

test('the matcher reports text and matches with their positions', async () => {
  const matcher = compilePattern('(?<run>b+)').matcher();
  assert.deepEqual(
    [...matcher.write('aab'), ...matcher.write('ba'), ...matcher.finish()],
    [
      { kind: 'text', text: 'aa', start: 0, end: 2 },
      {
        kind: 'match',
        text: 'bb',
        start: 2,
        end: 4,
        captures: ['bb'],
        groups: { run: 'bb' },
      },
      { kind: 'text', text: 'a', start: 4, end: 5 },
    ],
  );
  const unnamed = compilePattern('b').matcher();
  assert.equal(unnamed.write('b').at(0).groups, undefined);
  const limited = compilePattern('a+b').matcher({ maxMatchLength: 2 });
  assert.deepEqual(limited.write('aaaa'), [
    { kind: 'text', text: 'aa', start: 0, end: 2 },
  ]);
  const reader = new ReadableStream({
    start(controller) {
      for (const chunk of ['xa', 'ay']) controller.enqueue(chunk);
      controller.close();
    },
  })
    .pipeThrough(matchInStream({ pattern: 'a+' }))
    .getReader();
  const segments = [];
  for (let next = await reader.read(); !next.done; next = await reader.read())
    segments.push(next.value.kind + ':' + next.value.text);
  assert.deepEqual(segments, ['text:x', 'match:aa', 'text:y']);
});
