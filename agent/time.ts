/** The civil date of an instant in a timezone, as YYYY-MM-DD. */
export function dayOf(at: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD, which is what we want verbatim.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
