const introStorageKey = 'official-marketing-intro-seen';
const introStartedPrefix = 'started:';
const introHoldDuration = 700;

export function shouldShowMarketingIntro(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

  try {
    const storedState = window.sessionStorage.getItem(introStorageKey);
    if (storedState === 'seen') return false;
    if (!storedState?.startsWith(introStartedPrefix)) {
      window.sessionStorage.setItem(introStorageKey, `${introStartedPrefix}${Date.now()}`);
    }
    return true;
  } catch {
    return true;
  }
}

export function getMarketingIntroHoldRemaining(): number {
  try {
    const storedState = window.sessionStorage.getItem(introStorageKey);
    if (!storedState?.startsWith(introStartedPrefix)) return introHoldDuration;

    const startedAt = Number(storedState.slice(introStartedPrefix.length));
    if (!Number.isFinite(startedAt)) return introHoldDuration;
    return Math.max(0, introHoldDuration - (Date.now() - startedAt));
  } catch {
    return introHoldDuration;
  }
}

export function markMarketingIntroSeen(): void {
  try {
    window.sessionStorage.setItem(introStorageKey, 'seen');
  } catch {
    // The intro still works when session storage is unavailable.
  }
}
