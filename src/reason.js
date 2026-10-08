// -----------------------------------------------------------------------------
// An error, as one short line a user can read.
//
// Every user-facing message that has to say WHY something failed — the
// Supervision status, an action's answer, a line of the test report — quotes
// the error's message, and quotes it SHORT: those surfaces are one line, and a
// stack trace or a 2 KB HTML error page pasted into them helps nobody.
// -----------------------------------------------------------------------------

/** The default length a reason is cut at. */
export const MAX_REASON_LENGTH = 150;

/**
 * The message of an error, cut to `max` characters.
 *
 * Accepts anything a `catch` can hand over: an Error, a string, `undefined`.
 * @param {unknown} err
 * @param {number} [max]
 * @returns {string}
 */
export function shortReason(err, max = MAX_REASON_LENGTH) {
  return String(err?.message ?? err).slice(0, max);
}
