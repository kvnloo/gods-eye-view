// node:test reporter that writes one JSON line per finished test or suite, plus
// summaries. scripts/factory-ci.mjs rebuilds each test's full name from these.
export default async function* testEvents(source) {
  for await (const { type, data } of source) {
    if (type === 'test:pass' || type === 'test:fail') {
      yield `${JSON.stringify({
        event: type === 'test:pass' ? 'pass' : 'fail',
        file: data.file ?? null,
        name: data.name,
        nesting: data.nesting,
        kind: data.details?.type ?? 'test',
        skip: data.skip !== undefined && data.skip !== false,
        todo: data.todo !== undefined && data.todo !== false,
        failureType: data.details?.error?.failureType ?? null,
        durationMs: data.details?.duration_ms ?? null,
      })}\n`;
    } else if (type === 'test:diagnostic' && data.nesting > 0) {
      yield `${JSON.stringify({ event: 'diagnostic', file: data.file ?? null, nesting: data.nesting, message: data.message })}\n`;
    } else if (type === 'test:summary') {
      yield `${JSON.stringify({ event: 'summary', file: data.file ?? null, counts: data.counts, success: data.success })}\n`;
    }
  }
}
