/**
 * Ends an Ionic pull-to-refresh gesture.
 * Shared by every page's `doRefresh(event)` handler.
 */
export function completeRefresher(event: Event | undefined): void {
  const target = (event?.target ?? null) as { complete?: () => void } | null;
  target?.complete?.();
}
