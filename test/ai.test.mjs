import assert from 'node:assert/strict';
import test from 'node:test';
import { literal } from 'regex-stream-transform';
import { replaceInAISDKStream } from 'regex-stream-transform/ai';

test('AI text blocks retain their IDs and survive intervening non-text events', async () => {
  const events = [
    { type: 'text-start', id: 'one' },
    { type: 'text-delta', id: 'one', text: 'a' },
    { type: 'text-start', id: 'two' },
    { type: 'text-delta', id: 'two', text: 'ab' },
    { type: 'tool-call', toolCallId: 'call', toolName: 'tool', input: {} },
    { type: 'text-delta', id: 'one', text: 'b' },
    { type: 'text-end', id: 'one' },
    { type: 'text-end', id: 'two' },
  ];
  const input = new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
  const reader = input
    .pipeThrough(
      replaceInAISDKStream({ pattern: 'ab', replacement: literal('X') })(),
    )
    .getReader();
  const output = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    output.push(next.value);
  }
  assert.deepEqual(
    output.filter((event) => event.type !== 'text-delta'),
    events.filter((event) => event.type !== 'text-delta'),
  );
  for (const id of ['one', 'two']) {
    assert.equal(
      output
        .filter((event) => event.type === 'text-delta' && event.id === id)
        .map((event) => event.text)
        .join(''),
      'X',
    );
    const end = output.findIndex(
      (event) => event.type === 'text-end' && event.id === id,
    );
    assert.ok(
      output.every(
        (event, index) =>
          event.type !== 'text-delta' || event.id !== id || index < end,
      ),
    );
  }
});
