import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ConsentGate from './components/ConsentGate';
import PwaUpdateNotice from './components/PwaUpdateNotice';
import DeviceHeartbeat from './components/DeviceHeartbeat';
import NoticeHost from './components/NoticeHost';
import AppDialogHost from './components/AppDialogHost';
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
const ExamPage = lazy(() => import('./pages/ExamPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PreferencesPage = lazy(() => import('./pages/PreferencesPage'));
const LocalSettingsPage = lazy(() => import('./pages/LocalSettingsPage'));
const PluginConnectPage = lazy(() => import('./pages/PluginConnectPage'));
function BodyScrollLock(){const {pathname}=useLocation();useEffect(()=>{document.body.classList.toggle('lock-scroll',pathname==='/'||pathname==='/exam');return()=>document.body.classList.remove('lock-scroll')},[pathname]);return null}
function Loading(){return <div aria-live="polite" style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0d0d0d',color:'#fff'}}>正在载入…</div>}
function AppContent(){const location=useLocation();const {pathname}=location;const content=<><Suspense fallback={<Loading/>}><div key={pathname} className="app-route-transition"><Routes location={location}><Route path="/" element={<WelcomePage/>}/><Route path="/exam" element={<ExamPage/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/admin" element={<AdminPage/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="/preferences" element={<PreferencesPage/>}/><Route path="/local-settings" element={<LocalSettingsPage/>}/><Route path="/plugin/connect" element={<PluginConnectPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></div></Suspense><PwaUpdateNotice/></>;return pathname==='/plugin/connect'?content:<ConsentGate>{content}</ConsentGate>}
export default function App(){return <BrowserRouter><BodyScrollLock/><DeviceHeartbeat/><NoticeHost/><AppDialogHost/><AppContent/></BrowserRouter>}
