import { holds } from '../dist/syntax/boundary.js';
import { contains } from '../dist/syntax/charset.js';

function names(expression) {
  switch (expression.kind) {
    case 'capture':
      return [expression.name, ...names(expression.body)];
    case 'sequence':
      return expression.parts.flatMap(names);
    case 'choice':
      return expression.alternatives.flatMap(names);
    case 'repeat':
      return names(expression.body);
    default:
      return [];
  }
}

export function* matches(expression, input, position = 0, captures = {}) {
  switch (expression.kind) {
    case 'empty':
      yield { position, captures };
      return;
    case 'chars':
      if (
        position < input.length &&
        contains(expression.ranges, input[position])
      )
        yield { position: position + 1, captures };
      return;
    case 'assert':
      if (
        holds(expression.boundary, {
          previous: input[position - 1],
          next: input[position],
        })
      )
        yield { position, captures };
      return;
    case 'choice':
      for (const alternative of expression.alternatives)
        yield* matches(alternative, input, position, captures);
      return;
    case 'sequence': {
      function* rest(index, position, captures) {
        if (index === expression.parts.length) {
          yield { position, captures };
          return;
        }
        for (const next of matches(
          expression.parts[index],
          input,
          position,
          captures,
        ))
          yield* rest(index + 1, next.position, next.captures);
      }
      yield* rest(0, position, captures);
      return;
    }
    case 'capture':
      for (const next of matches(expression.body, input, position, captures))
        yield {
          position: next.position,
          captures: {
            ...next.captures,
            [expression.name]: [position, next.position],
          },
        };
      return;
    case 'repeat': {
      const { minimum, maximum, greedy, body } = expression;
      const inner = names(body);
      function* iterations(count, position, captures) {
        if (count >= minimum && !greedy) yield { position, captures };
        if (count < maximum) {
          const cleared = { ...captures };
          for (const name of inner) delete cleared[name];
          for (const next of matches(body, input, position, cleared)) {
            if (count >= minimum && next.position === position) continue;
            yield* iterations(count + 1, next.position, next.captures);
          }
        }
        if (count >= minimum && greedy) yield { position, captures };
      }
      yield* iterations(0, position, captures);
    }
  }
}

export function replace(expression, input, replacement) {
  const output = [];
  let position = 0;
  while (position <= input.length) {
    const result = matches(expression, input, position).next().value;
    if (!result) {
      if (position === input.length) break;
      output.push(input[position++]);
    } else {
      output.push(
        ...replacement({
          start: position,
          end: result.position,
          captures: result.captures,
        }),
      );
      if (result.position === position) {
        if (position === input.length) break;
        output.push(input[position++]);
      } else position = result.position;
    }
  }
  return output;
}

export function words(alphabet, maximum) {
  const result = [[]];
  for (let length = 1; length <= maximum; length++)
    for (const prefix of result.filter((word) => word.length === length - 1))
      for (const symbol of alphabet) result.push([...prefix, symbol]);
  return result;
}
