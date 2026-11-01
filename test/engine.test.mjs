import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compilePattern,
  literal,
  mapMatch,
  replaceInStream,
  template,
} from 'regex-stream-transform';
import { automaton } from '../dist/nfa/automaton.js';
import { compile } from '../dist/nfa/compile.js';
import { Scanner } from '../dist/engine/scanner.js';
import { Budget } from '../dist/engine/earliest/budget.js';
import { markMatches } from '../dist/engine/earliest/marks.js';
import { project } from '../dist/engine/earliest/project.js';
import { Simulation } from '../dist/engine/earliest/simulation.js';
import { parse } from '../dist/syntax/parse.js';
import { replace, words } from './reference.mjs';

const chars = (...values) => ({
  kind: 'chars',
  ranges: values.map((value) => [value, value]),
});
const a = chars(97);
const b = chars(98);
const empty = { kind: 'empty' };
const choice = (...alternatives) => ({ kind: 'choice', alternatives });
const sequence = (...parts) => ({ kind: 'sequence', parts });
const star = (body, greedy = true) => ({
  kind: 'repeat',
  body,
  minimum: 0,
  maximum: Infinity,
  greedy,
});
const capture = (index, body) => ({ kind: 'capture', index, name: null, body });
const flags = { ignoreCase: false, multiline: false, dotAll: false };

function expressions() {
  const atoms = [a, b, empty, choice()];
  const result = [...atoms];
  for (const left of atoms)
    for (const right of atoms)
      result.push(choice(left, right), sequence(left, right));
  for (const body of [
    a,
    choice(a, b),
    star(a, false),
    choice(empty, a),
    choice(capture(2, a), b),
  ])
    for (const greedy of [true, false])
      result.push(
        star(body, greedy),
        { kind: 'repeat', body, minimum: 1, maximum: 2, greedy },
        sequence(star(body, greedy), b),
        capture(0, sequence(capture(1, star(body, greedy)), a)),
      );
  return result;
}

function scan(machine, input, replacement) {
  const output = [];
  const calls = [];
  const sink = {
    text: (text) =>
      output.push(...Array.from(text, (unit) => unit.codePointAt(0))),
    progress() {},
    match({ start, end, captures }) {
      const found = {};
      captures.forEach((text, index) => {
        if (text !== undefined) found[index] = text;
      });
      calls.push({ start, end, captures: found });
      output.push(...replacement);
    },
  };
  const scanner = new Scanner(machine, sink);
  for (const value of input) scanner.write(String.fromCharCode(value));
  scanner.finish();
  return { output, calls };
}

function earliest(machine, input, replacement) {
  const graph = project(
    markMatches(machine, new Budget(1e7)),
    { open: String.fromCodePoint(...replacement), inside: false, close: '' },
    new Budget(1e7),
  );
  const simulation = new Simulation(graph);
  const output = simulation.start();
  for (const value of input) simulation.read(value, output);
  simulation.finish(output);
  return output;
}

test('both engines implement the independent ordered-expression semantics', () => {
  for (const expression of expressions()) {
    const machine = automaton(compile(expression));
    for (const replacement of [[], [88]])
      for (const input of words([97, 98], 3)) {
        const calls = [];
        const expected = replace(expression, input, (match) => {
          const captures = {};
          for (const [index, [start, end]] of Object.entries(match.captures))
            captures[index] = String.fromCharCode(...input.slice(start, end));
          calls.push({ start: match.start, end: match.end, captures });
          return replacement;
        });
        const scanned = scan(machine, input, replacement);
        assert.deepEqual(scanned.output, expected);
        assert.deepEqual(scanned.calls, calls);
        assert.deepEqual(earliest(machine, input, replacement), expected);
      }
  }
});

test('earliest emission writes output forced beyond an unresolved match', () => {
  const branching = compilePattern('a*b|a').replacer(literal('X'), {
    earliest: true,
  });
  assert.equal(branching.write('a'), 'X');
  assert.equal(branching.write('a'), '');
  assert.equal(branching.finish(), 'X');
  const repeated = compilePattern('a*').replacer(literal('X'), {
    earliest: true,
  });
  assert.equal(repeated.write('a'), 'XX');
  assert.equal(repeated.finish(), '');
  const plain = compilePattern('a*').replacer(literal('X'));
  assert.equal(plain.write('a'), 'X');
  assert.equal(plain.finish(), 'X');
});

test('committed output is a prefix of every examined continuation', () => {
  for (const source of ['a*b|a', 'a*', 'ab|a', '^a|b$', '\\b[a-b]*\\b'])
    for (const options of [{}, { earliest: true }]) {
      const expression = parse(source, flags);
      const pattern = compilePattern(source);
      for (const prefix of words([97, 98], 3)) {
        const output = pattern
          .replacer(literal('X'), options)
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
  ])
    for (const options of [{}, { earliest: true }]) {
      const pattern = compilePattern('.', 's');
      const whole = pattern.replacer(replacement, options);
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
        const stream = pattern.replacer(replacement, options);
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
  assert.throws(() => failed.finish(), /finished|failed/);
  let reentrant;
  reentrant = compilePattern('a').replacer(
    mapMatch(() => {
      assert.throws(() => reentrant.write('a'), /running/);
      return 'X';
    }),
  );
  assert.equal(reentrant.write('a'), 'X');
  reentrant.finish();
  assert.throws(() => reentrant.write(''), /finished|failed/);
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
