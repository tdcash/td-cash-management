import React, { useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, can } from './auth.jsx';
import { ToastProvider, Icon, Loading, useApi, BusyBar } from './components/ui.jsx';
import { ROLE } from './format.js';
import Login from './pages/Login.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Reports from './pages/Reports.jsx';
import ReportEdit from './pages/ReportEdit.jsx';
import NewReport from './pages/NewReport.jsx';
import NcList from './pages/NcList.jsx';
import NcDetail from './pages/NcDetail.jsx';
import Stats from './pages/Stats.jsx';
import Reconcile from './pages/Reconcile.jsx';
import Royalty from './pages/Royalty.jsx';
import SiteRoyalty from './pages/SiteRoyalty.jsx';
import Deposits from './pages/Deposits.jsx';
import Companies from './pages/Companies.jsx';
import Sites from './pages/Sites.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Profile from './pages/Profile.jsx';

function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  React.useEffect(() => setOpen(false), [loc.pathname]);
  const partner = user.role === 'PARTNER';
  const nc = useApi(partner ? null : '/nc?status=APERTA', [loc.pathname]);
  const openNc = nc.data?.length || 0;
  const admin = can(user, 'SUPERADMIN', 'ADMIN');
  const sup = can(user, 'SUPERADMIN');
  const L = ({ to, icon, children, count, end }) => (
    <NavLink to={to} end={end}><Icon name={icon} />{children}{count ? <span className="count">{count}</span> : null}</NavLink>
  );
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><img src="/logo-light.svg" alt="Toscana Diagnostica" /><div className="app">Cash Management</div></div>
        <nav>
          {partner ? <>
            <div className="group">Struttura ospitante</div>
            <L to="/statistiche" icon="chart">Statistiche incassi</L>
            <L to="/canoni" icon="percent">Royalty di sede</L>
          </> : <>
          <div className="group">Operatività</div>
          <L to="/" icon="home" end>Cruscotto</L>
          <L to="/rendiconti/nuovo" icon="plus">Nuovo rendiconto</L>
          <L to="/rendiconti" icon="cash" end>Rendiconti</L>
          {admin && <L to="/versamenti" icon="shield">Cassaforte e versamenti</L>}
          <L to="/nc" icon="alert" count={openNc}>Errori e NC</L>
          <div className="group">Analisi</div>
          <L to="/statistiche" icon="chart">Statistiche</L>
          {admin && <L to="/canoni" icon="percent">Royalty di sede</L>}
          {admin && <L to="/riconciliazione" icon="link">Riconciliazione</L>}</>}
          {sup && <L to="/royalty" icon="link">Partner: royalty e SEPA</L>}
          {admin && !partner && <>
            <div className="group">Anagrafiche</div>
            <L to="/aziende" icon="building">{sup ? 'Aziende' : 'Azienda'}</L>
            <L to="/sedi" icon="pin">Sedi e fondo cassa</L>
            <L to="/utenti" icon="users">Utenti</L>
            <L to="/audit" icon="shield">Registro attività</L>
          </>}
          {sup && <L to="/impostazioni" icon="gear">Impostazioni</L>}
        </nav>
        <div className="me">
          <div className="name">{user.full_name}</div>
          <div>{ROLE[user.role]}{user.company_name ? ` · ${user.company_name}` : ''}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <NavLink to="/profilo" className="btn sm ghost" style={{ color: 'var(--teal)' }}>Profilo</NavLink>
            <button className="btn sm dark" onClick={logout}>Esci</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><button onClick={() => setOpen(!open)} aria-label="Menu">☰</button><img src="/logo-light.svg" alt="" /></div>
        <Routes>
          {partner ? <>
            <Route path="/statistiche" element={<Stats />} />
            <Route path="/canoni" element={<SiteRoyalty />} />
            <Route path="/profilo" element={<Profile />} />
            <Route path="*" element={<Navigate to="/canoni" replace />} />
          </> : <>
          <Route path="/" element={<Dashboard />} />
          <Route path="/rendiconti" element={<Reports />} />
          <Route path="/rendiconti/nuovo" element={<NewReport />} />
          <Route path="/rendiconti/:id" element={<ReportEdit />} />
          {admin && <Route path="/versamenti" element={<Deposits />} />}
          <Route path="/nc" element={<NcList />} />
          <Route path="/nc/:id" element={<NcDetail />} />
          <Route path="/statistiche" element={<Stats />} />
          {admin && <Route path="/canoni" element={<SiteRoyalty />} />}
          {admin && <Route path="/riconciliazione" element={<Reconcile />} />}
          {sup && <Route path="/royalty" element={<Royalty />} />}
          {admin && <Route path="/aziende" element={<Companies />} />}
          {admin && <Route path="/sedi" element={<Sites />} />}
          {admin && <Route path="/utenti" element={<Users />} />}
          {admin && <Route path="/audit" element={<Audit />} />}
          {sup && <Route path="/impostazioni" element={<Settings />} />}
          <Route path="/profilo" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </>}
        </Routes>
      </main>
    </div>
  );
}

function Gate() {
  const { loading, user, onboarding } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  if (onboarding) return <Onboarding />;
  return <Shell />;
}

export default function App() {
  return (
    <ToastProvider>
      <BusyBar />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
