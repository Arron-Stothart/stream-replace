export function* matches(expression, input, position = 0, captures = {}) {
  switch (expression.kind) {
    case 'empty':
      yield { position, captures };
      return;
    case 'symbol':
      if (position < input.length && expression.accepts(input[position]))
        yield { position: position + 1, captures };
      return;
    case 'assert':
      if (
        expression.accepts({
          position,
          previous: input[position - 1],
          next: input[position],
          hasNext: position < input.length,
          ended: position === input.length,
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
      for (const next of matches(expression.body, input, position, captures)) {
        yield {
          position: next.position,
          captures: {
            ...next.captures,
            [expression.name]: [position, next.position],
          },
        };
      }
      return;
    case 'repeat':
    case 'quantify': {
      const minimum = expression.kind === 'repeat' ? 0 : expression.minimum;
      const maximum =
        expression.kind === 'repeat' ? Infinity : expression.maximum;
      function* iterations(count, position, captures) {
        if (count >= minimum && !expression.greedy)
          yield { position, captures };
        if (count < maximum)
          for (const next of matches(
            expression.body,
            input,
            position,
            captures,
          )) {
            if (
              count >= minimum &&
              maximum === Infinity &&
              next.position === position
            )
              continue;
            yield* iterations(count + 1, next.position, next.captures);
          }
        if (count >= minimum && expression.greedy) yield { position, captures };
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
  for (let length = 1; length <= maximum; length++) {
    for (const prefix of result.filter((word) => word.length === length - 1))
      for (const symbol of alphabet) result.push([...prefix, symbol]);
  }
  return result;
}
