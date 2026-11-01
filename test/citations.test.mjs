import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePattern, mapMatch } from 'regex-stream-transform';
import { passages } from './citation-response.mjs';

test('streamed citations resolve sources and line locators without leaking partial markers', () => {
  const sources = new Map([
    ['turn0file0', { title: 'Handbook', url: 'https://example.org/handbook' }],
    ['turn1url0', { title: 'Policy', url: 'https://example.org/policy' }],
  ]);
  const sourceId = String.raw`turn\d+(?:file|block|url)\d+`;
  const pattern = compilePattern(
    `\uE200cite\uE202(?<sources>${sourceId}(?:\uE202${sourceId})*)` +
      String.raw`(?:\uE202(?<lines>L\d+(?:-L\d+)?))?\uE201`,
  );
  const rendered = [];
  const replacement = mapMatch((match) => {
    rendered.push(match.text);
    const ids = match.groups.sources.split('\uE202');
    const lines = match.groups.lines;
    if (ids.some((id) => !sources.has(id))) return match.text;
    return ids
      .map((id) => {
        const { title, url } = sources.get(id);
        const label = lines ? `${title}, ${lines}` : title;
        const target = lines ? `${url}#${lines}` : url;
        return `[${label}](${target})`;
      })
      .join(' ');
  });
  const stream = pattern.replacer(replacement);

  const steps = [
    ['Remote work is allowed. \uE200ci', 'Remote work is allowed. ', 0],
    ['te\uE202turn0fi', '', 0],
    ['le0\uE202L8-', '', 0],
    ['L13', '', 0],
    ['\uE201', '[Handbook, L8-L13](https://example.org/handbook#L8-L13)', 1],
    [' Unfinished: \uE200cite\uE202turn0fi', ' Unfinished: ', 1],
  ];
  for (const [chunk, output, calls] of steps) {
    assert.equal(stream.write(chunk), output);
    assert.equal(rendered.length, calls);
  }
  assert.equal(stream.finish(), '\uE200cite\uE202turn0fi');
  assert.deepEqual(rendered, [
    '\uE200cite\uE202turn0file0\uE202L8-L13\uE201',
  ]);

  const unresolved =
    '\n\nUnknown: \uE200cite\uE202turn9file9\uE201\nUnfinished: \uE200cite\uE202turn0fi';
  const input =
    passages.map(({ prose, citation }) => prose + citation).join('') +
    unresolved;
  const expected =
    passages.map(({ prose, link }) => prose + link).join('') + unresolved;
  for (const size of [1, 7, 64, 1024]) {
    rendered.length = 0;
    const stream = pattern.replacer(replacement);
    let output = '';
    for (let offset = 0; offset < input.length; offset += size) {
      output += stream.write(input.slice(offset, offset + size));
      assert.ok(
        expected.startsWith(output),
        `Output diverged at offset ${offset}, chunk size ${size}`,
      );
    }
    assert.equal(output + stream.finish(), expected);
    assert.deepEqual(rendered, [
      ...passages.map(({ citation }) => citation),
      '\uE200cite\uE202turn9file9\uE201',
    ]);
  }
});
