export interface Session<Output> {
  write(chunk: string): Output;
  finish(): Output;
}

export function guard<Output>(inner: Session<Output>): Session<Output> {
  let status: 'ready' | 'running' | 'finished' | 'failed' = 'ready';
  function run(final: boolean, operation: () => Output): Output {
    if (status !== 'ready') throw new TypeError(`The session is ${status}`);
    status = 'running';
    try {
      const output = operation();
      status = final ? 'finished' : 'ready';
      return output;
    } catch (error) {
      status = 'failed';
      throw error;
    }
  }
  return {
    write: (chunk) => {
      if (typeof chunk !== 'string')
        throw new TypeError('Expected a string chunk');
      return run(false, () => inner.write(chunk));
    },
    finish: () => run(true, () => inner.finish()),
  };
}
