export interface Session<Input, Output> {
  write(input: Input): Output;
  finish(): Output;
}

export function session<Input, Output>(
  write: (input: Input) => Output,
  finish: () => Output,
): Session<Input, Output> {
  let status: 'ready' | 'running' | 'closed' = 'ready';

  function run(operation: () => Output, final: boolean): Output {
    if (status !== 'ready') throw new Error(`Stream is ${status}`);
    status = 'running';
    try {
      const output = operation();
      status = final ? 'closed' : 'ready';
      return output;
    } catch (error) {
      status = 'closed';
      throw error;
    }
  }

  return {
    write: (input) => run(() => write(input), false),
    finish: () => run(finish, true),
  };
}
