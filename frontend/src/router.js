import { useEffect, useState } from 'react';

// Minimal hash router: #/marketplace, #/create, #/dashboard, #/profile,
// #/contracts/<id>, #/transactions/<hash>
export function useHashRoute() {
  const [route, setRoute] = useState(() => cleanHash());
  useEffect(() => {
    const onChange = () => setRoute(cleanHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function cleanHash() {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/marketplace';
}

export function navigate(path) {
  window.location.hash = path;
  // Some environments (happy-dom, certain webviews) do not fire hashchange
  // synchronously for programmatic assignment — notify listeners directly.
  forceRouteSync();
}

export function parseRoute(route) {
  const parts = route.split('/').filter(Boolean);
  if (parts[0] === 'contracts' && parts[1]) return { view: 'contract', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'transactions' && parts[1]) return { view: 'tx', hash: parts[1] };
  if (parts[0] === 'create') return { view: 'create' };
  if (parts[0] === 'dashboard') return { view: 'dashboard' };
  if (parts[0] === 'profile') return { view: 'profile' };
  return { view: 'marketplace' };
}

// Ensure hashchange listeners fire even in environments (happy-dom, some
// embedded webviews) where programmatic hash assignment is silent.
export function forceRouteSync() {
  try {
    window.dispatchEvent(new Event('hashchange'));
  } catch {}
}
