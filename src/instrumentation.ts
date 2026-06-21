/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize runtime log capture for the Doctor export feature.
 *
 * Sentry server-side init is gated behind a non-development guard. The
 * `@sentry/node` package eagerly registers a chain of `@opentelemetry/*`
 * instrumentations (HTTP, fs, dns, undici, …) on import — under
 * `next dev` with Turbopack this graph is one of the heaviest single
 * contributors to the dev-server RSS floor, and we don't ship dev-only
 * crashes anywhere. Production / packaged builds keep the original
 * behavior: read `NEXT_PUBLIC_SENTRY_DSN`, honor the
 * `~/.codepilot/sentry-disabled` opt-out marker, and call `Sentry.init`.
 *
 * `initRuntimeLog()` and `ensureSchedulerRunning()` deliberately stay
 * OUTSIDE the dev-guard — runtime-log capture and persisted task
 * scheduling have to work in `next dev` too.
 *
 * Locked in by `src/__tests__/unit/instrumentation-shape.test.ts`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV !== 'development') {
      // Initialize Sentry for server-side error capture (respects opt-out marker file)
      const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
      if (dsn) {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const markerPath = path.join(os.homedir(), '.xjlpilot', 'sentry-disabled');
        const optedOut = fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf-8').trim() === 'true';
        if (!optedOut) {
          const Sentry = await import('@sentry/node');
          Sentry.init({
            dsn,
            environment: process.env.NODE_ENV,
            release: `codepilot@${process.env.NEXT_PUBLIC_APP_VERSION}`,
            tracesSampleRate: 0,
            ignoreErrors: [
              // Aborts — user/client cancellation, not bugs
              'AbortError',
              'Operation aborted',
              'The operation was aborted',
              'signal is aborted',
              // Electron renderer doesn't implement window.prompt — known and handled with PromptDialog
              'prompt() is not supported',
              // Browser quirk: not a real error but Chromium reports it
              'ResizeObserver loop',
            ],
            beforeSend(event) {
              // Strip auth headers
              if (event.request?.headers) {
                delete event.request.headers['x-api-key'];
                delete event.request.headers['authorization'];
                delete event.request.headers['anthropic-api-key'];
              }
              // Add server context
              event.tags = {
                ...event.tags,
                runtime: 'server',
                'os.platform': process.platform,
                'os.arch': process.arch,
                'node.version': process.version,
              };
              return event;
            },
          });
        }
      }
    }

    const { initRuntimeLog } = await import('@/lib/runtime-log');
    initRuntimeLog();

    // Start the task scheduler so persisted tasks resume on cold boot
    // (previously only started as a side effect of /api/chat)
    const { ensureSchedulerRunning } = await import('@/lib/task-scheduler');
    ensureSchedulerRunning();
  }
}
