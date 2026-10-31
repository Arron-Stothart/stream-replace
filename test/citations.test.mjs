import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePattern, mapMatch } from 'regex-stream-transform';

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
  const stream = pattern.replacer(
    mapMatch((match) => {
      rendered.push(match.text);
      const ids = match.captures.get('sources').split('\uE202');
      const lines = match.captures.get('lines');
      if (ids.some((id) => !sources.has(id))) return match.text;
      return ids
        .map((id) => {
          const { title, url } = sources.get(id);
          const label = lines ? `${title}, ${lines}` : title;
          const target = lines ? `${url}#${lines}` : url;
          return `[${label}](${target})`;
        })
        .join(' ');
    }),
  );

  const steps = [
    ['Remote work is allowed. \uE200ci', 'Remote work is allowed. ', 0],
    ['te\uE202turn0fi', '', 0],
    ['le0\uE202L8-', '', 0],
    ['L13', '', 0],
    ['\uE201', '[Handbook, L8-L13](https://example.org/handbook#L8-L13)', 1],
    [
      ' Both sources agree. \uE200cite\uE202turn0file0\uE202turn1',
      ' Both sources agree. ',
      1,
    ],
    [
      'url0\uE201',
      '[Handbook](https://example.org/handbook) [Policy](https://example.org/policy)',
      2,
    ],
    [' Unfinished: \uE200cite\uE202turn0fi', ' Unfinished: ', 2],
  ];
  for (const [chunk, output, calls] of steps) {
    assert.equal(stream.write(chunk), output);
    assert.equal(rendered.length, calls);
  }
  assert.equal(stream.finish(), '\uE200cite\uE202turn0fi');
  assert.deepEqual(rendered, [
    '\uE200cite\uE202turn0file0\uE202L8-L13\uE201',
    '\uE200cite\uE202turn0file0\uE202turn1url0\uE201',
  ]);
});
