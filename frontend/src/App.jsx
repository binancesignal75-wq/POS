import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { UiProvider } from './context/UiContext';
import AppLayout from './components/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pos from './pages/Pos';
import Products from './pages/Products';
import ProductForm from './pages/ProductForm';
import LowStock from './pages/LowStock';
import Records from './pages/Records';
import TpCalc from './pages/TpCalc';
import Settings from './pages/Settings';
import Customers from './pages/Customers';
import CustomerAccount from './pages/CustomerAccount';
import Admin from './pages/admin/Admin';
import WebScanner from './pages/WebScanner';

// Desktop app (Electron) mein landing page nahi — seedha login
const isDesktop = typeof window !== 'undefined' && !!window.typos?.isDesktop;

export default function App() {
  return (
    <BrowserRouter>
      <UiProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={isDesktop ? <Navigate to="/login" replace /> : <Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/scan" element={<WebScanner />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/app" element={<ErrorBoundary><AppLayout /></ErrorBoundary>}>
              <Route index element={<Dashboard />} />
              <Route path="pos" element={<Pos />} />
              <Route path="products" element={<Products />} />
              <Route path="products/new" element={<ProductForm />} />
              <Route path="products/:id/edit" element={<ProductForm />} />
              <Route path="customers" element={<Customers />} />
              <Route path="customers/:id" element={<CustomerAccount />} />
              <Route path="low-stock" element={<LowStock />} />
              <Route path="records" element={<Records />} />
              <Route path="tp-calc" element={<TpCalc />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </UiProvider>
    </BrowserRouter>
  );
}
