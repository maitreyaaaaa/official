import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './official-theme.css';
import { resolveClientRoute } from '../../marketing-site/frontend/routes.js';

const route = resolveClientRoute(window.location.pathname);
const App = lazy(() => import('./App.js').then(({ App: Component }) => ({ default: Component })));
const MarketingSite = lazy(() => import('../../marketing-site/frontend/MarketingSite.js').then(({ MarketingSite: Component }) => ({ default: Component })));

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="route-loading" role="status">Loading official…</div>}>
      {route.kind === 'app' ? <App /> : <MarketingSite page={route.page} />}
    </Suspense>
  </React.StrictMode>,
);
