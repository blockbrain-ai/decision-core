/**
 * GET /health — Health check endpoint. No auth required.
 */

export function handleHealth(): { status: number; data: unknown } {
  return {
    status: 200,
    data: { status: 'ok', data: { service: 'decision-core', timestamp: new Date().toISOString() } },
  };
}
