import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { StoreLogo, TyposLogo } from './ui';
import ErrorBoundary from './ErrorBoundary';
import { useAuth } from '../context/AuthContext';
import { ScannerProvider, useScanner } from '../context/ScannerContext';
import { api } from '../api';
import { dateOnly } from '../utils/format';

const TITLES = {
  '/app': 'Dashboard', '/app/pos': 'New Sale', '/app/products': 'Products', '/app/products/new': 'Add Product',
  '/app/customers': 'Wholesale Customers', '/app/low-stock': 'Low Stock', '/app/records': 'Monthly Records',
  '/app/tp-calc': 'TP Calculator', '/app/settings': 'Phone & Settings'
};

function Sidebar({ counts }) {
  const { store, logout } = useAuth();
  const nav = useNavigate();
  const lic = Math.max(0, Math.min(100, (store.days_left / (store.plan === 'yearly' ? 365 : 30)) * 100));
  const item = (to, icon, label, extra, end) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-i ${isActive ? 'on' : ''}`}>
      <Icon name={icon} />{label}{extra}
    </NavLink>
  );
  return (
    <aside className="sidebar no-print">
      <div className="store">
        <StoreLogo store={store} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="nm">{store.name}</div>
          <small>{[store.city, store.plan === 'yearly' ? 'Yearly' : 'Monthly'].filter(Boolean).join(' · ')}</small>
        </div>
      </div>
      <button className="sb-search" onClick={() => nav('/app/products')}><Icon name="search" className="ic-sm" />Dawai dhoondein<span className="kbd">F3</span></button>
      <nav className="nav">
        <div className="nav-g">Main</div>
        {item('/app', 'home', 'Dashboard', null, true)}
        {item('/app/pos', 'cart', 'New Sale', <span className="kbd" style={{ marginLeft: 'auto' }}>F2</span>)}
        <div className="nav-g">Inventory</div>
        {item('/app/products', 'pill', 'Products', counts && <span className="cnt b-gy">{counts.total}</span>, true)}
        {item('/app/products/new', 'plusbox', 'Add Product')}
        {item('/app/low-stock', 'down', 'Low Stock', counts?.low > 0 && <span className="cnt" style={{ background: '#fef2f2', color: '#b91c1c' }}>{counts.low}</span>)}
        <div className="nav-g">Wholesale Khata</div>
        {item('/app/customers', 'users', 'Wholesale Customers')}
        <div className="nav-g">Reports</div>
        {item('/app/records', 'cal', 'Monthly Records')}
        {item('/app/tp-calc', 'calc', 'TP Calculator')}
        {item('/app/settings', 'gear', 'Phone & Settings')}
      </nav>
      <div className="lic-card">
        <div className="top"><span>License</span>
          <span className={`badge ${store.days_left <= 7 ? 'b-am' : 'b-gr'}`}><i />{store.days_left <= 7 ? `${store.days_left} din` : 'Active'}</span>
        </div>
        <div className="prog"><i style={{ width: `${lic}%`, background: store.days_left <= 7 ? '#f59e0b' : undefined }} /></div>
        <small className="muted" style={{ fontSize: 12 }}>{store.days_left} din baqi · {dateOnly(store.expires_at)}</small>
      </div>
      <div className="me">
        <TyposLogo size={30} />
        <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13, display: 'block' }}>TYPOS POS</b><small className="muted" style={{ fontSize: 12 }}>v1.0</small></div>
        <button className="kebab" title="Logout" onClick={logout}><Icon name="logout" className="ic-sm" /></button>
      </div>
    </aside>
  );
}

function Header() {
  const { devices, connected } = useScanner();
  const loc = useLocation();
  const { store } = useAuth();
  const title = TITLES[loc.pathname] || (loc.pathname.includes('/edit') ? 'Edit Product' : '');
  return (
    <header className="header no-print">
      <div className="crumb"><span>{store.name}</span><Icon name="right" className="ic-sm" /><b>{title}</b></div>
      <div className="hd-r">
        <Link to="/app/settings" className="conn" title="Mobile scanner">
          {devices.length ? <><span className="pulse" />{devices.length === 1 ? devices[0].name : `${devices.length} phones`}</> : <><Icon name="phone" className="ic-sm" />Phone connect karein</>}
        </Link>
        <div className="conn"><Icon name="wifi" className="ic-sm" style={{ color: connected ? '#5cc624' : '#dc2626' }} />{connected ? 'Online' : 'Offline'}</div>
        <Link className="btn btn-pr" to="/app/pos"><Icon name="plus" className="ic-sm" />New Sale</Link>
      </div>
    </header>
  );
}

function MobileNav() {
  const item = (to, icon, label, end) => (
    <NavLink to={to} end={end} className={({ isActive }) => `mob-nav-i ${isActive ? 'on' : ''}`}>
      <Icon name={icon} className="ic-sm" />
      <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="mob-nav no-print">
      {item('/app', 'home', 'Home', true)}
      {item('/app/pos', 'cart', 'New Sale')}
      {item('/app/products', 'pill', 'Products')}
      {item('/app/customers', 'users', 'Wholesale')}
      {item('/app/records', 'cal', 'Records')}
      {item('/app/settings', 'gear', 'Settings')}
    </nav>
  );
}

function Shell() {
  const [counts, setCounts] = useState(null);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { api('/products/counts').then(setCounts).catch(() => {}); }, [loc.pathname]);
  // keyboard: F2 sale, F3 products
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'F2') { e.preventDefault(); nav('/app/pos'); }
      if (e.key === 'F3') { e.preventDefault(); nav('/app/products'); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [nav]);
  return (
    <div className="app">
      <Sidebar counts={counts} />
      <div className="main">
        <Header />
        <div className="page">
          <ErrorBoundary>
            <Outlet context={{ counts, reloadCounts: () => api('/products/counts').then(setCounts).catch(() => {}) }} />
          </ErrorBoundary>
        </div>
      </div>
      <MobileNav />
    </div>
  );
}

export default function AppLayout() {
  const { store, loading } = useAuth();
  if (loading) return <div className="center"><span className="spin" /></div>;
  if (!store) return <Navigate to="/login" replace />;
  return <ScannerProvider><Shell /></ScannerProvider>;
}
