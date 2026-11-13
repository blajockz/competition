import { lazy, Suspense } from 'react';
import { Toaster } from './components/common.jsx';

const Landing = lazy(() => import('./pages/Landing.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Host = lazy(() => import('./pages/Host.jsx'));
const Play = lazy(() => import('./pages/Play.jsx'));

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  let page = <Landing />;
  if (path === '/admin') page = <Admin />;
  else if (path === '/host') page = <Host />;
  else if (path === '/play' || path === '/join') page = <Play />;
  return (
    <>
      <Suspense fallback={<div className="page" aria-busy="true" />}>{page}</Suspense>
      <Toaster />
    </>
  );
}
