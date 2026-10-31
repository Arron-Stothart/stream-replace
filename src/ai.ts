import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';
import { resolvePattern, type TextOptions, type TextReplacer } from './text.js';

export function replaceInAISDKStream<TOOLS extends ToolSet = ToolSet>({
  pattern,
  replacement,
  flags = '',
}: TextOptions): StreamTextTransform<TOOLS> {
  const compiled = resolvePattern(pattern, flags);
  return () => {
    const active = new Map<string, TextReplacer>();
    const emit = (
      id: string,
      text: string,
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ) => {
      if (text) controller.enqueue({ type: 'text-delta', id, text });
    };
    const finish = (
      id: string,
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ) => {
      const replacer = active.get(id);
      if (replacer) {
        emit(id, replacer.finish(), controller);
        active.delete(id);
      }
    };
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(event, controller) {
        if (event.type === 'text-start') {
          if (active.has(event.id))
            throw new Error(`Duplicate text start: ${event.id}`);
          active.set(event.id, compiled.replacer(replacement));
          controller.enqueue(event);
          return;
        }
        if (event.type === 'text-delta') {
          let replacer = active.get(event.id);
          if (replacer === undefined) {
            replacer = compiled.replacer(replacement);
            active.set(event.id, replacer);
          }
          const text = replacer.write(event.text);
          if (text) controller.enqueue({ ...event, text });
          return;
        }
        if (event.type === 'text-end') finish(event.id, controller);
        if (
          event.type === 'finish-step' ||
          event.type === 'finish' ||
          event.type === 'error' ||
          event.type === 'abort'
        ) {
          for (const id of active.keys()) finish(id, controller);
        }
        controller.enqueue(event);
      },
      flush(controller) {
        for (const id of active.keys()) finish(id, controller);
      },
    });
  };
}
