import { useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeaturesContext';
import { useBackend } from '@/context/BackendGate';
import Layout from '@/components/Layout';
import LoadingScreen from '@/components/LoadingScreen';
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
import PlexReturnPage from '@/pages/PlexReturnPage';
import InstallPage from '@/pages/InstallPage';
import SearchPage from '@/pages/SearchPage';
import MediaDetailPage from '@/pages/MediaDetailPage';
import PersonPage from '@/pages/PersonPage';
import RequestsPage from '@/pages/RequestsPage';

const AdminPage = lazy(() => import('@/pages/AdminPage'));
const AdminLayout = lazy(() => import('@/components/layouts/AdminLayout'));
import NoAccessPage from '@/pages/NoAccessPage';
import DiscoverGenrePage from '@/pages/DiscoverGenrePage';
import CategoryPage from '@/pages/CategoryPage';
import CalendarPage from '@/pages/CalendarPage';
import { PluginPage } from '@/plugins/PluginPage';
import { NsfwFilterContext, useNsfwFilterProvider } from '@/hooks/useNsfwFilter';

function ProtectedRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, loading } = useAuth();
  const nsfwFilter = useNsfwFilterProvider();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <NsfwFilterContext.Provider value={nsfwFilter}>
      {children}
    </NsfwFilterContext.Provider>
  );
}

function RequireAccess({ children }: Readonly<{ children: React.ReactNode }>) {
  const { hasAccess, user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!hasAccess) return <NoAccessPage />;
  return <>{children}</>;
}

function RequireFeature({ feature, children }: Readonly<{ feature: string; children: React.ReactNode }>) {
  const { features, loading } = useFeatures();
  if (loading) return null;
  if (!features[feature]) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PageTransition({ children }: Readonly<{ children: React.ReactNode }>) {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location.pathname]);
  return (
    <div key={location.pathname} className="animate-fade-in">
      {children}
    </div>
  );
}

function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-ndp-accent focus:text-white focus:font-medium focus:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
    >
      {t('nav.skip_to_content')}
    </a>
  );
}

export default function App() {
  const { installed } = useBackend();

  if (!installed) {
    return (
      <Routes>
        <Route path="/install" element={<InstallPage />} />
        <Route path="*" element={<Navigate to="/install" replace />} />
      </Routes>
    );
  }

  return (
    <>
    <SkipLink />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/plex-return" element={<PlexReturnPage />} />
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LoadingScreen />}>
              <AdminLayout>
                <AdminPage />
              </AdminLayout>
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <PageTransition>
                <Routes>
                  <Route path="/" element={<RequireAccess><HomePage /></RequireAccess>} />
                  <Route path="/search" element={<RequireAccess><SearchPage /></RequireAccess>} />
                  <Route path="/movie/:id" element={<RequireAccess><MediaDetailPage type="movie" /></RequireAccess>} />
                  <Route path="/tv/:id" element={<RequireAccess><MediaDetailPage type="tv" /></RequireAccess>} />
                  <Route path="/person/:id" element={<RequireAccess><PersonPage /></RequireAccess>} />
                  <Route path="/requests" element={<RequireFeature feature="requestsEnabled"><RequireAccess><RequestsPage /></RequireAccess></RequireFeature>} />
                  <Route path="/discover/:mediaType/genre/:genreId" element={<RequireAccess><DiscoverGenrePage /></RequireAccess>} />
                  <Route path="/category/:slug" element={<RequireAccess><CategoryPage /></RequireAccess>} />
                  <Route path="/calendar" element={<RequireFeature feature="calendarEnabled"><RequireAccess><CalendarPage /></RequireAccess></RequireFeature>} />
                  <Route path="/p/:pluginId/*" element={<PluginPage />} />
                  <Route path="/install" element={<Navigate to="/" replace />} />
                </Routes>
              </PageTransition>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
    </>
  );
}
