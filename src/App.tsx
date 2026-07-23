import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ConsentGate from './components/ConsentGate';
import PwaUpdateNotice from './components/PwaUpdateNotice';
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
const ExamPage = lazy(() => import('./pages/ExamPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
function BodyScrollLock(){const {pathname}=useLocation();useEffect(()=>{document.body.classList.toggle('lock-scroll',pathname==='/exam');return()=>document.body.classList.remove('lock-scroll')},[pathname]);return null}
function Loading(){return <div aria-live="polite" style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0d0d0d',color:'#fff'}}>正在载入…</div>}
export default function App(){return <BrowserRouter><BodyScrollLock/><ConsentGate><Suspense fallback={<Loading/>}><Routes><Route path="/" element={<WelcomePage/>}/><Route path="/exam" element={<ExamPage/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/admin" element={<AdminPage/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></Suspense><PwaUpdateNotice/></ConsentGate></BrowserRouter>}
