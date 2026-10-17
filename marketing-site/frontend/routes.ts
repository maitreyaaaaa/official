export type MarketingPage = 'home' | 'review' | 'method' | 'guardrails' | 'notFound';

export type ClientRoute =
  | { kind: 'app' }
  | { kind: 'marketing'; page: MarketingPage };

const marketingPages = new Map<string, MarketingPage>([
  ['/', 'home'],
  ['/review', 'review'],
  ['/method', 'method'],
  ['/guardrails', 'guardrails'],
]);

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function resolveClientRoute(pathname: string): ClientRoute {
  const path = normalizePathname(pathname);
  if (path === '/app') return { kind: 'app' };
  return { kind: 'marketing', page: marketingPages.get(path) ?? 'notFound' };
}
