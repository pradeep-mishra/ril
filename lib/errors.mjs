// An error meant for people: a plain message, an exit code and a "Next:" hint.
// The hint is kept in `next` and also appended to the message as a "Next: ..." line.
export class RilError extends Error {
  constructor(message, { code = 1, next = '' } = {}) {
    super(next ? `${message}\nNext: ${next}` : message);
    this.name = 'RilError';
    this.code = code;
    this.next = next;
  }
}
