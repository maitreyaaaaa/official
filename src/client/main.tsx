import React, { Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './official-theme.css';
import { resolveClientRoute } from '../../marketing-site/frontend/routes.js';
import { shouldShowMarketingIntro } from '../../marketing-site/frontend/intro.js';

const route = resolveClientRoute(window.location.pathname);
const App = lazy(() => import('./App.js').then(({ App: Component }) => ({ default: Component })));
const MarketingSite = lazy(() => import('../../marketing-site/frontend/MarketingSite.js').then(({ MarketingSite: Component }) => ({ default: Component })));

function RouteLoadingFallback() {
  const [showMarketingSplash] = useState(() => route.kind === 'marketing' && shouldShowMarketingIntro());

  if (showMarketingSplash) {
    return <div className="marketing-route-splash" aria-hidden="true"><img src="/brand/official-logo-landscape.svg" alt="" draggable={false} /></div>;
  }

  return <div className="route-loading" role="status"><span className="loader" aria-hidden="true" />Loading page…</div>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<RouteLoadingFallback />}>
      {route.kind === 'app' ? <App /> : <MarketingSite page={route.page} />}
    </Suspense>
  </React.StrictMode>,
);
