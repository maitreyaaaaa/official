const introHoldDuration = 700;
let marketingIntroStartedAt: number | null = null;

export function shouldShowMarketingIntro(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  marketingIntroStartedAt ??= Date.now();
  return true;
}

export function getMarketingIntroHoldRemaining(): number {
  if (marketingIntroStartedAt === null) return introHoldDuration;
  return Math.max(0, introHoldDuration - (Date.now() - marketingIntroStartedAt));
}

export function completeMarketingIntro(): void {
  marketingIntroStartedAt = null;
}
