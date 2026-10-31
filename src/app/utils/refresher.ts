/**
 * Shared pull-to-refresh plumbing.
 *
 * Ionic's <ion-refresher> has two annoying failure modes this helper fixes:
 *  1. `complete()` called before the "refreshing" state has painted → the
 *     spinner never dismisses and stays stuck on the screen.
 *  2. a network call that never settles → the `await` never returns, so
 *     the spinner never goes away.
 *
 * `runRefresh` runs the page's refresh work with a hard timeout, guarantees
 * a minimum visible duration (so a cache-fast refresh still feels like a
 * refresh), then always dismisses the spinner.
 */

const MIN_VISIBLE_MS = 450;
const WORK_TIMEOUT_MS = 15000;

type RefresherElement = HTMLElement & {
  complete?: () => Promise<void> | void;
  state?: string;
};

function refresherOf(event?: Event): RefresherElement | null {
  const target = (event?.target ?? null) as RefresherElement | null;
  return target && typeof target.complete === 'function' ? target : null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for two animation frames so Ionic has painted the spinner state. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 32);
    }
  });
}

async function dismiss(refresher: RefresherElement | null): Promise<void> {
  if (!refresher) {
    return;
  }
  try {
    await refresher.complete?.();
  } catch {
    /* already dismissed */
  }
  // Belt & braces: if Ionic missed the transition and the spinner is still
  // spinning a moment later, close it once more. Never leave it stuck.
  if (refresher.state === 'refreshing') {
    await wait(250);
    try {
      await refresher.complete?.();
    } catch {
      /* noop */
    }
  }
}

/**
 * Wrap a page's `doRefresh` body:
 *
 *   async doRefresh(event: Event): Promise<void> {
 *     await runRefresh(event, async () => {
 *       await this.service.hydrate();
 *     });
 *   }
 *
 * The work can never hang the gesture, and the spinner always closes.
 */
export async function runRefresh(
  event: Event | undefined,
  work: () => Promise<unknown> | unknown,
  options: { minVisibleMs?: number; timeoutMs?: number } = {}
): Promise<void> {
  const startedAt = Date.now();
  const minVisibleMs = options.minVisibleMs ?? MIN_VISIBLE_MS;
  const timeoutMs = options.timeoutMs ?? WORK_TIMEOUT_MS;
  const refresher = refresherOf(event);

  let timedOut = false;
  try {
    await Promise.race([
      Promise.resolve().then(work),
      wait(timeoutMs).then(() => {
        timedOut = true;
      }),
    ]);
    if (timedOut) {
      console.warn('[refresh] timed out — dismissing the spinner anyway');
    }
  } catch (err) {
    console.warn('[refresh] failed', err);
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed < minVisibleMs) {
      await wait(minVisibleMs - elapsed);
    }
    // Only needed when complete() arrives while the gesture is still being
    // released — without this frame Ionic ignores it and the icon sticks.
    if (refresher?.state === 'refreshing' || refresher?.state === 'pulling') {
      await nextFrame();
    }
    await dismiss(refresher);
  }
}

/**
 * Ends an Ionic pull-to-refresh gesture immediately.
 * Kept for any call site that manages its own timing.
 */
export async function completeRefresher(event?: Event): Promise<void> {
  await dismiss(refresherOf(event));
}
