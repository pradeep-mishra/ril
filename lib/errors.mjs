// An error meant for people: a plain message, an exit code and a "Next:" hint.
// The hint is kept in `next` and also appended to the message as a "Next: ..." line.
// `detail` holds low-level system text (for logs or --json), never shown in the message.
export class RilError extends Error {
  constructor(message, { code = 1, next = '', detail = '' } = {}) {
    super(next ? `${message}\nNext: ${next}` : message);
    this.name = 'RilError';
    this.plain = message; // the message without the Next line
    this.code = code;
    this.next = next;
    this.detail = detail;
  }
}

export function noProjectError(dir) {
  return new RilError(`There is no ril project in ${dir} yet.`, { code: 2, next: 'run ril init' });
}
