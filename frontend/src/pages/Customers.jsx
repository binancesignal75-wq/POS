import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { Field, Spinner, RowMenu } from '../components/ui';
import { useUi } from '../context/UiContext';
import { rs, rs2, dateOnly } from '../utils/format';

export default function Customers() {
  const nav = useNavigate();
  const { toast } = useUi();

  const [customers, setCustomers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Modals
  const [addModal, setAddModal] = useState(false);
  const [agingModal, setAgingModal] = useState(false);
  const [agingData, setAgingData] = useState(null);
  const [agingLoading, setAgingLoading] = useState(false);

  // Row Quick Actions Modals
  const [deliveryModalCustomer, setDeliveryModalCustomer] = useState(null);
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryItems, setDeliveryItems] = useState([]);
  const [deliveryDiscount, setDeliveryDiscount] = useState('0');
  const [deliveryPaidAmount, setDeliveryPaidAmount] = useState('');
  const [deliveryPayMethod, setDeliveryPayMethod] = useState('cash');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [searchProductQuery, setSearchProductQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [delSaving, setDelSaving] = useState(false);

  const [payModalCustomer, setPayModalCustomer] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  const [editModalCustomer, setEditModalCustomer] = useState(null);
  const [editData, setEditData] = useState({ name: '', owner_name: '', phone: '', address: '', city: '', notes: '' });
  const [editSaving, setEditSaving] = useState(false);

  // New Customer Form State
  const [newCust, setNewCust] = useState({
    name: '',
    owner_name: '',
    phone: '',
    address: '',
    city: '',
    opening_balance: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const res = await api('/customers', {
        query: {
          q: search,
          filter,
          page,
          limit: 20,
        },
      });
      setCustomers(res.customers || []);
      setSummary(res.summary || null);
      setPages(res.pages || 1);
      setTotal(res.total || 0);
    } catch (e) {
      toast(e.message || 'Customers load nahi ho sakay', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [filter, page]); // eslint-disable-line

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadCustomers();
  };

  const clearFilters = () => {
    setFilter('all');
    setSearch('');
    setPage(1);
  };

  const openAgingReport = async () => {
    setAgingModal(true);
    setAgingLoading(true);
    try {
      const res = await api('/customers/reports/aging');
      setAgingData(res);
    } catch (e) {
      toast(e.message || 'Aging report load nahi ho saki', 'err');
    } finally {
      setAgingLoading(false);
    }
  };

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (!newCust.name.trim()) return toast('Medical Store ka naam zaroori hai', 'err');
    if (!newCust.phone.trim()) return toast('Phone number zaroori hai', 'err');

    setSaving(true);
    try {
      const res = await api('/customers', {
        method: 'POST',
        body: newCust,
      });
      toast(`Customer account ban gaya: ${res.customer.name}`);
      setAddModal(false);
      setNewCust({
        name: '',
        owner_name: '',
        phone: '',
        address: '',
        city: '',
        opening_balance: '',
        notes: '',
      });
      loadCustomers();
      if (res.customer?.id) {
        nav(`/app/customers/${res.customer.id}`);
      }
    } catch (err) {
      toast(err.message || 'Customer account nahi ban saka', 'err');
    } finally {
      setSaving(false);
    }
  };

  // Medicine Search for Quick Delivery
  useEffect(() => {
    const q = searchProductQuery.trim();
    if (q.length < 2) {
      setProductSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api('/products/search', { query: { q } });
        setProductSearchResults(res.products || []);
      } catch {
        setProductSearchResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchProductQuery]);

  const addProductToDelivery = (prod) => {
    if (prod.stock <= 0) return toast(`"${prod.name}" ka stock 0 hai!`, 'err');
    const existingIndex = deliveryItems.findIndex((it) => it.product_id === prod.id);
    if (existingIndex >= 0) return toast('Ye dawai pehle se delivery list mein hai', 'err');

    setDeliveryItems([
      ...deliveryItems,
      {
        product_id: prod.id,
        name: prod.name,
        strength: prod.strength,
        stock: prod.stock,
        mrp: prod.mrp,
        tp: prod.tp,
        qty: 1,
        unit_price: prod.mrp,
        line_total: prod.mrp,
      },
    ]);
    setSearchProductQuery('');
    setProductSearchResults([]);
  };

  const updateDeliveryItem = (idx, field, val) => {
    const updated = [...deliveryItems];
    const it = { ...updated[idx], [field]: val };
    const q = Math.max(1, parseInt(it.qty, 10) || 1);
    const p = Math.max(0, parseFloat(it.unit_price) || 0);
    it.qty = q;
    it.unit_price = p;
    it.line_total = Math.round(q * p * 100) / 100;
    updated[idx] = it;
    setDeliveryItems(updated);
  };

  const removeDeliveryItem = (idx) => {
    setDeliveryItems(deliveryItems.filter((_, i) => i !== idx));
  };

  const deliverySubtotal = deliveryItems.reduce((acc, it) => acc + (it.line_total || 0), 0);
  const deliveryFinalTotal = Math.max(0, deliverySubtotal - (parseFloat(deliveryDiscount) || 0));

  const handleConfirmQuickDelivery = async (e) => {
    e.preventDefault();
    if (!deliveryModalCustomer) return;
    if (!deliveryItems.length) return toast('Kam az kam 1 dawai shamil karein', 'err');
    for (const it of deliveryItems) {
      if (it.qty > it.stock) {
        return toast(`"${it.name}" ka stock kam hai (Available: ${it.stock}, Required: ${it.qty})`, 'err');
      }
    }

    setDelSaving(true);
    try {
      const res = await api(`/customers/${deliveryModalCustomer.id}/deliveries`, {
        method: 'POST',
        body: {
          delivery_date: deliveryDate,
          items: deliveryItems.map((it) => ({
            product_id: it.product_id,
            qty: it.qty,
            unit_price: it.unit_price,
          })),
          discount: parseFloat(deliveryDiscount) || 0,
          paid_amount: parseFloat(deliveryPaidAmount) || 0,
          payment_method: deliveryPayMethod,
          notes: deliveryNotes,
        },
      });

      const msg = res.paidAmount > 0
        ? `Delivery ${res.deliveryNo} ban gaya! Stock deduct ho gaya aur Rs ${rs(res.paidAmount)} ki wasooli sale mein add ho gayi.`
        : `Delivery Invoice ${res.deliveryNo} ban gaya! Stock deduct ho gaya.`;
      toast(msg);
      setDeliveryModalCustomer(null);
      setDeliveryItems([]);
      setDeliveryDiscount('0');
      setDeliveryPaidAmount('');
      setDeliveryPayMethod('cash');
      setDeliveryNotes('');
      loadCustomers();
    } catch (err) {
      toast(err.message || 'Delivery save nahi ho saki', 'err');
    } finally {
      setDelSaving(false);
    }
  };

  const handleConfirmQuickPayment = async (e) => {
    e.preventDefault();
    if (!payModalCustomer) return;
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) return toast('Sahi raqam darj karein', 'err');

    setPaySaving(true);
    try {
      const res = await api(`/customers/${payModalCustomer.id}/payments`, {
        method: 'POST',
        body: {
          amount: amt,
          payment_date: payDate,
          payment_method: payMethod,
          reference_no: payRef,
          notes: payNotes,
        },
      });

      toast(`Payment Wasool: ${rs(res.amount)} (Receipt: ${res.paymentNo})`);
      setPayModalCustomer(null);
      setPayAmount('');
      setPayRef('');
      setPayNotes('');
      loadCustomers();
    } catch (err) {
      toast(err.message || 'Payment save nahi ho saki', 'err');
    } finally {
      setPaySaving(false);
    }
  };

  const handleConfirmQuickEdit = async (e) => {
    e.preventDefault();
    if (!editModalCustomer) return;
    setEditSaving(true);
    try {
      await api(`/customers/${editModalCustomer.id}`, { method: 'PUT', body: editData });
      toast('Customer details update ho gayin');
      setEditModalCustomer(null);
      loadCustomers();
    } catch (err) {
      toast(err.message || 'Update nahi ho saka', 'err');
    } finally {
      setEditSaving(false);
    }
  };

  const exportCustomersCSV = () => {
    if (!customers.length) return toast('Koi data export ke liye nahi hai', 'err');
    const headers = ['ID', 'Medical Store', 'Owner', 'Phone', 'City', 'Total Supplied (Rs)', 'Total Paid (Rs)', 'Outstanding Balance (Rs)', 'Last Transaction'];
    const rows = customers.map((c) => [
      c.id,
      `"${c.name}"`,
      `"${c.owner_name || ''}"`,
      `"${c.phone}"`,
      `"${c.city || ''}"`,
      c.total_supplied,
      c.total_paid,
      c.current_balance,
      c.last_activity ? dateOnly(c.last_activity) : '',
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Wholesale_Customers_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: '0 4px', maxWidth: '100%' }}>
      {/* SECTION 1: Page Header */}
      <div className="ph no-print" style={{ marginBottom: 20 }}>
        <div>
          <h1>Wholesale Customers / Khata</h1>
          <p>Dawai distributor hisaab, bulk delivery invoices, payments aur ledgers</p>
        </div>
        <div className="acts">
          <button
            type="button"
            className="btn btn-sc"
            title="Customers list refresh karein"
            disabled={loading}
            onClick={() => {
              loadCustomers();
              toast('Wholesale customers refresh ho gaye');
            }}
          >
            <Icon name="refresh" className={`ic-sm ${loading ? 'spin' : ''}`} />
            Refresh
          </button>
          <button className="btn btn-sc" onClick={openAgingReport}>
            <Icon name="clock" className="ic-sm" />
            Aging Report
          </button>
          <button className="btn btn-sc" onClick={exportCustomersCSV}>
            <Icon name="fileText" className="ic-sm" />
            Export CSV
          </button>
          <button className="btn btn-pr" onClick={() => setAddModal(true)}>
            <Icon name="plus" className="ic-sm" />
            Add New Customer
          </button>
        </div>
      </div>

      {/* SECTION 2: Vertical Summary Cards (Icon -> Label -> Price -> Sub-label) */}
      <div className="customers-grid-5">
        {/* Card 1: Total Wholesale Customers */}
        <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid var(--bd)', background: '#fff' }}>
          <div className="kpi-ic" style={{ background: 'var(--sub)', color: 'var(--pr)' }}>
            <Icon name="users" size={22} />
          </div>
          <div className="kpi-lbl" style={{ color: 'var(--t2)' }}>
            Total Wholesale Customers
          </div>
          <div className="kpi-v" style={{ color: '#0f172a' }}>
            {summary?.total_customers ?? 0}
          </div>
          <small className="muted">Active medical stores</small>
        </div>

        {/* Card 2: Total Outstanding (Udhar) */}
        <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid #fecaca', background: '#fff' }}>
          <div className="kpi-ic" style={{ background: '#fef2f2', color: '#dc2626' }}>
            <Icon name="dollar" size={22} />
          </div>
          <div className="kpi-lbl" style={{ color: '#dc2626' }}>
            Total Outstanding (Udhar)
          </div>
          <div className="kpi-v" style={{ color: '#dc2626' }}>
            {rs(summary?.total_receivable ?? 0)}
          </div>
          <small className="muted">Market se wasool talab</small>
        </div>

        {/* Card 3: Total Payments Received */}
        <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid #bbf7d0', background: '#fff' }}>
          <div className="kpi-ic" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <Icon name="check" size={22} />
          </div>
          <div className="kpi-lbl" style={{ color: '#15803d' }}>
            Total Payments Received
          </div>
          <div className="kpi-v" style={{ color: '#15803d' }}>
            {rs(summary?.total_payments ?? 0)}
          </div>
          <small className="muted">Confirmed wasooliyan</small>
        </div>

        {/* Card 4: Total Medicines Supplied */}
        <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid var(--bd)', background: '#fff' }}>
          <div className="kpi-ic" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <Icon name="truck" size={22} />
          </div>
          <div className="kpi-lbl" style={{ color: 'var(--t2)' }}>
            Total Medicines Supplied
          </div>
          <div className="kpi-v" style={{ color: '#0f172a' }}>
            {rs(summary?.total_supplied ?? 0)}
          </div>
          <small className="muted">Confirmed deliveries value</small>
        </div>

        {/* Card 5: Total Wholesale Profit */}
        <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid #d9f99d', background: '#f7fee7' }}>
          <div className="kpi-ic" style={{ background: '#ecfccb', color: '#4d7c0f' }}>
            <Icon name="trend" size={22} />
          </div>
          <div className="kpi-lbl" style={{ color: '#4d7c0f' }}>
            Total Wholesale Profit
          </div>
          <div className="kpi-v" style={{ color: '#3f6212' }}>
            {rs(summary?.total_profit ?? 0)}
          </div>
          <small className="muted">Wholesale khalis munafa</small>
        </div>
      </div>

      {/* SECTION 3: Full-Width Search & Filter Bar */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 18, border: '1px solid var(--bd)', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          {/* Filter Tabs */}
          <div className="tabs" style={{ marginBottom: 0 }}>
            {[
              ['all', `Sab Customers (${summary?.total_customers ?? 0})`],
              ['outstanding', 'Baqaya (Udhar)'],
              ['advance', 'Advance Payments'],
              ['zero', 'Clear (Zero Balance)'],
            ].map(([k, lbl]) => (
              <button
                key={k}
                className={`tab ${filter === k ? 'on' : ''}`}
                onClick={() => { setFilter(k); setPage(1); }}
              >
                {lbl}
              </button>
            ))}
          </div>

          {/* Search Input & Clear Filters */}
          <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 300, justifyContent: 'flex-end' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
              <input
                className="inp"
                style={{ paddingLeft: 36, height: 42, borderWidth: 2, borderRadius: 9 }}
                placeholder="Medical store, contact ya phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Icon
                name="search"
                className="ic-sm"
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)' }}
              />
            </div>
            <button type="submit" className="btn btn-pr" style={{ height: 42, padding: '0 16px' }}>
              Search
            </button>
            {(search || filter !== 'all') && (
              <button type="button" className="btn btn-sc" style={{ height: 42 }} onClick={clearFilters}>
                Reset
              </button>
            )}
          </form>
        </div>
      </div>

      {/* SECTION 4: WHOLESALE CUSTOMER CARDS GRID */}
      <div className="card" style={{ border: '1px solid var(--bd)', borderRadius: 14, overflow: 'visible', marginBottom: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <Spinner />
          </div>
        ) : customers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ maxWidth: 360, margin: '0 auto' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--sub)', color: 'var(--pr)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
                <Icon name="users" style={{ width: 28, height: 28 }} />
              </div>
              <b style={{ fontSize: 16, display: 'block', color: 'var(--t1)' }}>Koi customer nahi mila</b>
              <p className="muted" style={{ fontSize: 13, margin: '6px 0 16px' }}>
                {search || filter !== 'all' ? 'Aap ki search se koi customer match nahi hua.' : 'Abhi tak koi wholesale medical store account nahi banaya gaya.'}
              </p>
              <button className="btn btn-pr" onClick={() => setAddModal(true)}>
                <Icon name="plus" className="ic-sm" />
                Add New Customer
              </button>
            </div>
          </div>
        ) : (
          <div className="product-cards-grid">
            {customers.map((c) => {
              const bal = Number(c.current_balance) || 0;
              return (
                <div className="product-card cust-card" key={c.id}>
                  {/* SECTION A: Customer Header */}
                  <div className="pcard-header">
                    <div className="pcard-title-group">
                      <div className="pcard-type-icon" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                        <Icon name="store" size={20} />
                      </div>
                      <div className="pcard-name-wrap">
                        <h4
                          className="pcard-name"
                          title={`${c.name} (Khata aur details dekhein)`}
                          onClick={() => nav(`/app/customers/${c.id}`)}
                        >
                          {c.name}
                        </h4>
                        <div className="pcard-sub" title={[c.owner_name && `Malik: ${c.owner_name}`, c.city].filter(Boolean).join(' · ') || 'Medical Store'}>
                          {[c.owner_name && `Malik: ${c.owner_name}`, c.city].filter(Boolean).join(' · ') || 'Medical Store'}
                        </div>
                      </div>
                    </div>
                    <div className="pcard-badges">
                      <span className={`badge ${bal > 0 ? 'b-rd' : bal < 0 ? 'b-bl' : 'b-gr'}`}>
                        <i />
                        {bal > 0 ? 'Baqaya' : bal < 0 ? 'Advance' : 'Clear'}
                      </span>
                    </div>
                  </div>

                  {/* 1px Solid Divider */}
                  <div className="pcard-solid-divider" />

                  {/* SECTION B: Outstanding Balance Highlight Panel */}
                  <div
                    className="pcard-stock-panel"
                    style={{
                      background: bal > 0 ? '#fff1f2' : bal < 0 ? '#eff6ff' : '#f0fdf4',
                      borderColor: bal > 0 ? '#fecaca' : bal < 0 ? '#bfdbfe' : '#bbf7d0',
                      padding: '10px 14px'
                    }}
                  >
                    <div className="pcard-stock-row" style={{ marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: bal > 0 ? '#991b1b' : bal < 0 ? '#1e40af' : '#166534' }}>
                        Outstanding Balance
                      </span>
                      <b style={{ fontSize: 16, fontWeight: 800, color: bal > 0 ? '#dc2626' : bal < 0 ? '#2563eb' : '#16a34a' }}>
                        {bal > 0 ? `${rs2(bal)} (Udhaar)` : bal < 0 ? `${rs2(Math.abs(bal))} (Adv)` : 'Rs 0.00'}
                      </b>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.address ? `${c.address}${c.city ? `, ${c.city}` : ''}` : c.city || 'Wholesale customer'}
                    </div>
                  </div>

                  {/* 1px Solid Divider */}
                  <div className="pcard-solid-divider" />

                  {/* SECTION C: 2-Column Financial Details */}
                  <div className="pcard-pricing-grid">
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">TOTAL SUPPLIED</span>
                      <span className="pcard-price-val t-num">{rs(c.total_supplied ?? 0)}</span>
                    </div>
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">TOTAL RECEIVED (PAID)</span>
                      <span className="pcard-price-val t-num" style={{ color: '#16a34a' }}>{rs(c.total_paid ?? 0)}</span>
                    </div>
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">CONTACT PHONE</span>
                      <span className="pcard-price-val mono" style={{ fontSize: 12.5 }}>{c.phone}</span>
                    </div>
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">LAST TRANSACTION</span>
                      <span className="pcard-price-val" style={{ fontSize: 12.5, color: '#64748b' }}>
                        {c.last_activity && c.last_activity !== '2000-01-01' ? dateOnly(c.last_activity) : '—'}
                      </span>
                    </div>
                  </div>

                  {/* 1px Solid Divider */}
                  <div className="pcard-solid-divider" />

                  {/* SECTION D: Footer Actions */}
                  <div className="pcard-footer" style={{ justifyContent: 'flex-end' }}>
                    <div className="pcard-footer-actions">
                      <button
                        type="button"
                        className="btn btn-pr btn-sm"
                        style={{ padding: '0 12px', height: 32 }}
                        onClick={() => nav(`/app/customers/${c.id}`)}
                      >
                        <Icon name="eye" className="ic-sm" />
                        <span>Account</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sc btn-sm"
                        style={{ padding: '0 10px', height: 32 }}
                        onClick={() => setDeliveryModalCustomer(c)}
                      >
                        <Icon name="plus" className="ic-sm" />
                        <span>Delivery</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sc btn-sm"
                        style={{ background: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0', padding: '0 8px', height: 32 }}
                        title="Receive Payment"
                        onClick={() => setPayModalCustomer(c)}
                      >
                        <Icon name="cash" className="ic-sm" />
                      </button>
                      <RowMenu
                        items={[
                          { label: 'View Account & Ledger', icon: 'fileText', onClick: () => nav(`/app/customers/${c.id}`) },
                          { label: 'New Delivery Invoice', icon: 'truck', onClick: () => setDeliveryModalCustomer(c) },
                          { label: 'Receive Payment', icon: 'cash', onClick: () => setPayModalCustomer(c) },
                          {
                            label: 'Edit Info',
                            icon: 'edit',
                            onClick: () => {
                              setEditModalCustomer(c);
                              setEditData({
                                name: c.name,
                                owner_name: c.owner_name || '',
                                phone: c.phone,
                                address: c.address || '',
                                city: c.city || '',
                                notes: c.notes || '',
                              });
                            },
                          },
                          { label: 'Delete Customer', icon: 'trash', danger: true, onClick: () => handleDeleteCustomer(c) },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Full-width Pagination */}
        {pages > 1 && (
          <div className="tf" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#f8fafc', borderTop: '1px solid var(--bd)' }}>
            <div className="muted" style={{ fontSize: 13 }}>
              Total {total} wholesale customers
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-sc btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span style={{ padding: '4px 12px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid var(--bd)', borderRadius: 6 }}>
                Page {page} of {pages}
              </span>
              <button
                className="btn btn-sc btn-sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Add New Customer */}
      {addModal && (
        <Modal
          title="Naya Wholesale Customer Account"
          subtitle="Medical store ya pharmacy ka mukammal account register karein"
          onClose={() => setAddModal(false)}
          width={560}
          footer={
            <>
              <button className="btn btn-sc" onClick={() => setAddModal(false)}>
                Cancel
              </button>
              <button className="btn btn-pr" disabled={saving} onClick={handleCreateCustomer}>
                {saving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                Account Banayein
              </button>
            </>
          }
        >
          <form onSubmit={handleCreateCustomer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Medical Store Ka Naam *" autoFocus>
              <input
                className="inp"
                style={{ borderWidth: 2, height: 44 }}
                value={newCust.name}
                onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                placeholder="e.g. Al-Madina Medical Store"
                required
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Owner / Malik Ka Naam">
                <input
                  className="inp"
                  style={{ borderWidth: 2, height: 44 }}
                  value={newCust.owner_name}
                  onChange={(e) => setNewCust({ ...newCust, owner_name: e.target.value })}
                  placeholder="e.g. Haji Muhammad Aslam"
                />
              </Field>
              <Field label="Phone / WhatsApp Number *">
                <input
                  className="inp mono"
                  style={{ borderWidth: 2, height: 44 }}
                  value={newCust.phone}
                  onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                  placeholder="0300-1234567"
                  required
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Shehar / City">
                <input
                  className="inp"
                  style={{ borderWidth: 2, height: 44 }}
                  value={newCust.city}
                  onChange={(e) => setNewCust({ ...newCust, city: e.target.value })}
                  placeholder="Lahore, Karachi, etc."
                />
              </Field>
              <Field label="Opening Balance (Purana Baqaya)">
                <input
                  className="inp mono"
                  style={{ borderWidth: 2, height: 44 }}
                  inputMode="decimal"
                  value={newCust.opening_balance}
                  onChange={(e) => setNewCust({ ...newCust, opening_balance: e.target.value })}
                  placeholder="0.00"
                />
              </Field>
            </div>

            <Field label="Pura Pata / Address">
              <input
                className="inp"
                style={{ borderWidth: 2, height: 44 }}
                value={newCust.address}
                onChange={(e) => setNewCust({ ...newCust, address: e.target.value })}
                placeholder="Shop #, Market, Road..."
              />
            </Field>

            <Field label="Notes / Zaroori Hidayat">
              <textarea
                className="inp"
                style={{ height: 60, resize: 'vertical', borderWidth: 2 }}
                value={newCust.notes}
                onChange={(e) => setNewCust({ ...newCust, notes: e.target.value })}
                placeholder="Customer ke hawale se koi khas baat..."
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* MODAL: Quick Delivery from Table Row */}
      {deliveryModalCustomer && (
        <Modal
          title={`New Medicine Delivery — ${deliveryModalCustomer.name}`}
          subtitle="Inventory se dawaiyan select karein (Stock khud bakhud deduct hoga)"
          onClose={() => setDeliveryModalCustomer(null)}
          width={840}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div style={{ fontSize: 14 }}>
                Total Delivery Amount: <b style={{ fontSize: 17, color: 'var(--pr-d)' }}>{rs2(deliveryFinalTotal)}</b>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sc" onClick={() => setDeliveryModalCustomer(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-pr"
                  disabled={delSaving || !deliveryItems.length}
                  onClick={handleConfirmQuickDelivery}
                >
                  {delSaving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                  Confirm Delivery
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <Field label="Delivery Date">
                <input
                  type="date"
                  className="inp"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                />
              </Field>

              <div style={{ position: 'relative' }}>
                <Field label="Dawai Search Karein">
                  <input
                    className="inp"
                    placeholder="Panadol, Augmentin, barcode..."
                    value={searchProductQuery}
                    onChange={(e) => setSearchProductQuery(e.target.value)}
                    autoFocus
                  />
                </Field>
                {productSearchResults.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid var(--bd)',
                      borderRadius: 8,
                      boxShadow: 'var(--sh-md)',
                      maxHeight: 200,
                      overflowY: 'auto',
                      zIndex: 50,
                      marginTop: 4,
                    }}
                  >
                    {productSearchResults.map((prod) => (
                      <div
                        key={prod.id}
                        onClick={() => addProductToDelivery(prod)}
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--bd)',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <b>{prod.name}</b> {prod.strength && <span className="muted">({prod.strength})</span>}
                          <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>MRP: {rs2(prod.mrp)}</div>
                        </div>
                        <span className={`badge ${prod.stock > 5 ? 'b-gr' : 'b-am'}`}>
                          Stock: {prod.stock}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="tw" style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Available</th>
                    <th>Qty</th>
                    <th>Selling Price</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>
                        Dawaiyan search karke delivery mein add karein
                      </td>
                    </tr>
                  ) : (
                    deliveryItems.map((item, idx) => (
                      <tr key={item.product_id}>
                        <td><b>{item.name}</b> {item.strength && <small className="muted">({item.strength})</small>}</td>
                        <td><span className="badge b-gy">{item.stock}</span></td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            max={item.stock}
                            className="inp mono"
                            style={{ height: 34, width: 80 }}
                            value={item.qty}
                            onChange={(e) => updateDeliveryItem(idx, 'qty', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            className="inp mono"
                            style={{ height: 34, width: 90 }}
                            value={item.unit_price}
                            onChange={(e) => updateDeliveryItem(idx, 'unit_price', e.target.value)}
                          />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{rs2(item.line_total)}</td>
                        <td>
                          <button type="button" className="kebab" onClick={() => removeDeliveryItem(idx)}>
                            <Icon name="x" className="ic-sm" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Special Discount (Rs)">
                <input
                  className="inp mono"
                  value={deliveryDiscount}
                  onChange={(e) => setDeliveryDiscount(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Delivery Notes">
                <input
                  className="inp"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="Bilty number ya details..."
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <Field label="Payment Abhi Hui? (Optional Rs)">
                <input
                  className="inp mono"
                  inputMode="decimal"
                  value={deliveryPaidAmount}
                  onChange={(e) => setDeliveryPaidAmount(e.target.value)}
                  placeholder="0.00 (Agar naqad / wasooli hui)"
                />
              </Field>
              <Field label="Payment Method">
                <select className="inp" value={deliveryPayMethod} onChange={(e) => setDeliveryPayMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: Quick Payment from Table Row */}
      {payModalCustomer && (
        <Modal
          title={`Receive Payment — ${payModalCustomer.name}`}
          subtitle={`Current Baqaya: ${rs2(payModalCustomer.current_balance)}`}
          onClose={() => setPayModalCustomer(null)}
          width={500}
          footer={
            <>
              <button className="btn btn-sc" onClick={() => setPayModalCustomer(null)}>Cancel</button>
              <button className="btn btn-pr" disabled={paySaving} onClick={handleConfirmQuickPayment}>
                {paySaving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                Payment Record Karein
              </button>
            </>
          }
        >
          <form onSubmit={handleConfirmQuickPayment} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Payment Amount (Rs) *" autoFocus>
              <input
                className="inp mono"
                inputMode="decimal"
                style={{ fontSize: 18, fontWeight: 700 }}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Date">
                <input type="date" className="inp" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </Field>
              <Field label="Method">
                <select className="inp" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
            <Field label="Reference # / TID">
              <input className="inp mono" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Notes">
              <input className="inp" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Optional" />
            </Field>
          </form>
        </Modal>
      )}

      {/* MODAL: Quick Edit from Table Row */}
      {editModalCustomer && (
        <Modal
          title={`Edit Info — ${editModalCustomer.name}`}
          onClose={() => setEditModalCustomer(null)}
          width={540}
          footer={
            <>
              <button className="btn btn-sc" onClick={() => setEditModalCustomer(null)}>Cancel</button>
              <button className="btn btn-pr" disabled={editSaving} onClick={handleConfirmQuickEdit}>
                {editSaving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                Save Changes
              </button>
            </>
          }
        >
          <form onSubmit={handleConfirmQuickEdit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Medical Store Ka Naam *">
              <input className="inp" value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })} required />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Owner Name">
                <input className="inp" value={editData.owner_name} onChange={(e) => setEditData({ ...editData, owner_name: e.target.value })} />
              </Field>
              <Field label="Phone *">
                <input className="inp mono" value={editData.phone} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} required />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="City">
                <input className="inp" value={editData.city} onChange={(e) => setEditData({ ...editData, city: e.target.value })} />
              </Field>
              <Field label="Address">
                <input className="inp" value={editData.address} onChange={(e) => setEditData({ ...editData, address: e.target.value })} />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: Aging Report */}
      {agingModal && (
        <Modal
          title="Wholesale Customers Aging Report"
          subtitle="Baqaya raqam kitne dino se overdue hai (0-30, 31-60, 61-90, 90+ Din)"
          onClose={() => setAgingModal(false)}
          width={840}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                Total Overdue: <span style={{ color: '#dc2626' }}>{rs(agingData?.totals?.total_outstanding ?? 0)}</span>
              </div>
              <button className="btn btn-pr" onClick={() => window.print()}>
                <Icon name="print" className="ic-sm" />
                Print Aging Report
              </button>
            </div>
          }
        >
          {agingLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>
          ) : (
            <div className="tw" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>Phone</th>
                    <th style={{ textAlign: 'right' }}>0–30 Din</th>
                    <th style={{ textAlign: 'right' }}>31–60 Din</th>
                    <th style={{ textAlign: 'right' }}>61–90 Din</th>
                    <th style={{ textAlign: 'right' }}>90+ Din</th>
                    <th style={{ textAlign: 'right' }}>Total Due</th>
                  </tr>
                </thead>
                <tbody>
                  {(agingData?.aging || []).length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20 }}>Koi overdue baqaya nahi</td></tr>
                  ) : (
                    agingData.aging.map((row) => (
                      <tr key={row.id}>
                        <td><b>{row.name}</b> {row.city && <small className="muted">({row.city})</small>}</td>
                        <td className="mono">{row.phone}</td>
                        <td style={{ textAlign: 'right' }}>{rs(row.age_0_30)}</td>
                        <td style={{ textAlign: 'right', color: row.age_31_60 > 0 ? '#b45309' : undefined }}>{rs(row.age_31_60)}</td>
                        <td style={{ textAlign: 'right', color: row.age_61_90 > 0 ? '#ea580c' : undefined }}>{rs(row.age_61_90)}</td>
                        <td style={{ textAlign: 'right', color: row.age_90_plus > 0 ? '#dc2626' : undefined, fontWeight: 700 }}>
                          {rs(row.age_90_plus)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{rs2(row.total_balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--sub)', fontWeight: 700 }}>
                    <td colSpan={2}>Grand Total</td>
                    <td style={{ textAlign: 'right' }}>{rs(agingData?.totals?.age_0_30 ?? 0)}</td>
                    <td style={{ textAlign: 'right' }}>{rs(agingData?.totals?.age_31_60 ?? 0)}</td>
                    <td style={{ textAlign: 'right' }}>{rs(agingData?.totals?.age_61_90 ?? 0)}</td>
                    <td style={{ textAlign: 'right', color: '#dc2626' }}>{rs(agingData?.totals?.age_90_plus ?? 0)}</td>
                    <td style={{ textAlign: 'right', color: '#dc2626' }}>{rs2(agingData?.totals?.total_outstanding ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
