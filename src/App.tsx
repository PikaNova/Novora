import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { applyPageSeo } from './utils/seo';
import { recordDiagnosticEvent } from './utils/diagnostics';
import ConsentGate from './components/ConsentGate';
import PwaUpdateNotice from './components/PwaUpdateNotice';
import DeviceHeartbeat from './components/DeviceHeartbeat';
import NoticeHost from './components/NoticeHost';
import AppDialogHost from './components/AppDialogHost';
import SyncQueueIndicator from './components/SyncQueueIndicator';
import './styles/mascot.css';
import LoadingState from './components/LoadingState';
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
const ExamPage = lazy(() => import('./pages/ExamPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PreferencesPage = lazy(() => import('./pages/PreferencesPage'));
const LocalSettingsPage = lazy(() => import('./pages/LocalSettingsPage'));
const PluginConnectPage = lazy(() => import('./pages/PluginConnectPage'));
function BodyScrollLock() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.body.classList.toggle('lock-scroll', pathname === '/' || pathname === '/exam');
    return () => document.body.classList.remove('lock-scroll');
  }, [pathname]);
  return null;
}
function Loading() {
  return <LoadingState kind="loading" />;
}
function AppContent() {
  const location = useLocation();
  const { pathname } = location;
  // 后台板块之间切换不能重挂载：AdminPage 里挂着云快照对账、向导挂起状态等重活，
  // 换板块只换 URL 与内容（`/admin/<板块>`），整棵子树保持挂载。
  const routeKey = pathname.startsWith('/admin/') ? '/admin' : pathname;
  React.useEffect(() => {
    applyPageSeo(pathname);
    recordDiagnosticEvent('route', pathname);
  }, [pathname]);
  const content = (
    <>
      <Suspense fallback={<Loading />}>
        <div key={routeKey} className="app-route-transition">
          <Routes location={location}>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/exam" element={<ExamPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/:section" element={<AdminPage />} />
            <Route path="/admin/:section/:view" element={<AdminPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:group" element={<SettingsPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="/local-settings" element={<LocalSettingsPage />} />
            <Route path="/plugin/connect" element={<PluginConnectPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Suspense>
      <PwaUpdateNotice />
    </>
  );
  return pathname === '/plugin/connect' ? content : <ConsentGate>{content}</ConsentGate>;
}
export default function App() {
  return (
    <BrowserRouter>
      <BodyScrollLock />
      <DeviceHeartbeat />
      <NoticeHost />
      <SyncQueueIndicator />
      <AppDialogHost />
      <AppContent />
    </BrowserRouter>
  );
}
