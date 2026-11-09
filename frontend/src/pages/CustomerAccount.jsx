import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { Field, Spinner } from '../components/ui';
import { useUi } from '../context/UiContext';
import { rs, rs2, dateOnly } from '../utils/format';

export default function CustomerAccount() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast } = useUi();

  const [customer, setCustomer] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ledger'); // 'ledger' | 'deliveries' | 'payments' | 'returns'

  // Ledger state
  const [ledger, setLedger] = useState([]);
  const [ledgerTotals, setLedgerTotals] = useState({ total_debit: 0, total_credit: 0 });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Deliveries state
  const [deliveries, setDeliveries] = useState([]);

  // Payments state
  const [payments, setPayments] = useState([]);

  // Returns state
  const [returns, setReturns] = useState([]);

  // Modals
  const [deliveryModal, setDeliveryModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [returnModal, setReturnModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null); // Selected delivery invoice to view/print

  // Delivery Form State
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryItems, setDeliveryItems] = useState([]);
  const [deliveryDiscount, setDeliveryDiscount] = useState('0');
  const [deliveryPaidAmount, setDeliveryPaidAmount] = useState('');
  const [deliveryPayMethod, setDeliveryPayMethod] = useState('cash');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [searchProductQuery, setSearchProductQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [delSaving, setDelSaving] = useState(false);

  // Payment Form State
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [payDeliveryId, setPayDeliveryId] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // Return Form State
  const [returnDeliveryItemId, setReturnDeliveryItemId] = useState('');
  const [returnQty, setReturnQty] = useState('');
  const [returnReason, setReturnReason] = useState('Dawai kharab / expiry / store request');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [returnSaving, setReturnSaving] = useState(false);

  // Edit Customer Form State
  const [editData, setEditData] = useState({ name: '', owner_name: '', phone: '', address: '', city: '', notes: '' });
  const [editSaving, setEditSaving] = useState(false);

  const loadCustomer = async () => {
    try {
      const res = await api(`/customers/${id}`);
      setCustomer(res.customer);
      setStats(res.stats);
      setEditData({
        name: res.customer.name,
        owner_name: res.customer.owner_name || '',
        phone: res.customer.phone,
        address: res.customer.address || '',
        city: res.customer.city || '',
        notes: res.customer.notes || '',
      });
    } catch (e) {
      toast(e.message || 'Customer account load nahi ho saka', 'err');
    } finally {
      setLoading(false);
    }
  };

  const loadLedger = async () => {
    try {
      const res = await api(`/customers/${id}/ledger`, {
        query: { start_date: startDate || undefined, end_date: endDate || undefined },
      });
      setLedger(res.ledger || []);
      setLedgerTotals({ total_debit: res.total_debit, total_credit: res.total_credit });
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const loadDeliveries = async () => {
    try {
      const res = await api(`/customers/${id}/deliveries`);
      setDeliveries(res.deliveries || []);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const loadPayments = async () => {
    try {
      const res = await api(`/customers/${id}/payments`);
      setPayments(res.payments || []);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const loadReturns = async () => {
    try {
      const res = await api(`/customers/${id}/returns`);
      setReturns(res.returns || []);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const refreshAccount = async () => {
    setLoading(true);
    await Promise.all([loadCustomer(), loadLedger(), loadDeliveries(), loadPayments(), loadReturns()]);
    setLoading(false);
    toast('Customer hisaab refresh ho gaya');
  };

  useEffect(() => {
    loadCustomer();
    loadLedger();
    loadDeliveries();
    loadPayments();
    loadReturns();
  }, [id]); // eslint-disable-line

  useEffect(() => {
    loadLedger();
  }, [startDate, endDate]); // eslint-disable-line

  // Search medicines for Delivery Form
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
    if (prod.stock <= 0) {
      return toast(`"${prod.name}" ka stock 0 hai!`, 'err');
    }
    const existingIndex = deliveryItems.findIndex((it) => it.product_id === prod.id);
    if (existingIndex >= 0) {
      return toast('Ye dawai pehle se delivery list mein hai', 'err');
    }

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
        unit_price: prod.mrp, // Default wholesale selling price is MRP, editable
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

  const handleConfirmDelivery = async (e) => {
    e.preventDefault();
    if (!deliveryItems.length) return toast('Kam az kam 1 dawai shamil karein', 'err');
    for (const it of deliveryItems) {
      if (it.qty > it.stock) {
        return toast(`"${it.name}" ka stock kam hai (Available: ${it.stock}, Required: ${it.qty})`, 'err');
      }
    }

    setDelSaving(true);
    try {
      const res = await api(`/customers/${id}/deliveries`, {
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
      setDeliveryModal(false);
      setDeliveryItems([]);
      setDeliveryDiscount('0');
      setDeliveryPaidAmount('');
      setDeliveryPayMethod('cash');
      setDeliveryNotes('');
      loadCustomer();
      loadLedger();
      loadDeliveries();
      loadPayments();
    } catch (err) {
      toast(err.message || 'Delivery save nahi ho saki', 'err');
    } finally {
      setDelSaving(false);
    }
  };

  const handleReceivePayment = async (e) => {
    e.preventDefault();
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) return toast('Sahi raqam darj karein', 'err');

    setPaySaving(true);
    try {
      const res = await api(`/customers/${id}/payments`, {
        method: 'POST',
        body: {
          amount: amt,
          payment_date: payDate,
          payment_method: payMethod,
          reference_no: payRef,
          delivery_id: payDeliveryId || null,
          notes: payNotes,
        },
      });

      toast(`Payment Wasool: ${rs(res.amount)} (Receipt: ${res.paymentNo})`);
      setPaymentModal(false);
      setPayAmount('');
      setPayRef('');
      setPayNotes('');
      setPayDeliveryId('');
      loadCustomer();
      loadLedger();
      loadDeliveries();
      loadPayments();
    } catch (err) {
      toast(err.message || 'Payment save nahi ho saki', 'err');
    } finally {
      setPaySaving(false);
    }
  };

  const handleMedicineReturn = async (e) => {
    e.preventDefault();
    if (!returnDeliveryItemId) return toast('Wapas karne wali dawai select karein', 'err');
    const q = parseInt(returnQty, 10);
    if (!q || q <= 0) return toast('Wapsi quantity darj karein', 'err');

    setReturnSaving(true);
    try {
      const res = await api(`/customers/${id}/returns`, {
        method: 'POST',
        body: {
          delivery_item_id: returnDeliveryItemId,
          qty: q,
          return_date: returnDate,
          reason: returnReason,
        },
      });

      toast(`Credit Note ${res.returnNo} ban gaya! Stock wapas inventory mein aa gaya.`);
      setReturnModal(false);
      setReturnDeliveryItemId('');
      setReturnQty('');
      loadCustomer();
      loadLedger();
      loadDeliveries();
      loadReturns();
    } catch (err) {
      toast(err.message || 'Return process nahi ho saka', 'err');
    } finally {
      setReturnSaving(false);
    }
  };

  const handleUpdateCustomer = async (e) => {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api(`/customers/${id}`, { method: 'PUT', body: editData });
      toast('Customer details update ho gayin');
      setEditModal(false);
      loadCustomer();
    } catch (err) {
      toast(err.message || 'Update nahi ho saka', 'err');
    } finally {
      setEditSaving(false);
    }
  };

  const exportLedgerCSV = () => {
    if (!ledger.length) return toast('Ledger khali hai', 'err');
    const headers = ['Date', 'Type', 'Ref No', 'Description', 'Debit (Rs)', 'Credit (Rs)', 'Running Balance (Rs)'];
    const rows = ledger.map((l) => [
      l.date,
      l.type,
      `"${l.ref_no || ''}"`,
      `"${l.description}"`,
      l.debit,
      l.credit,
      l.running_balance,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${customer?.name || 'Customer'}_Ledger_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spinner />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <h3>Customer account nahi mila</h3>
        <button className="btn btn-pr" style={{ marginTop: 14 }} onClick={() => nav('/app/customers')}>
          Wapas List Par Jayein
        </button>
      </div>
    );
  }

  const currentBal = Number(customer.current_balance) || 0;

  // Flattened list of all delivered items for Returns selection
  const allDeliveredItems = [];
  for (const del of deliveries) {
    for (const item of del.items || []) {
      const remainingReturnable = item.qty - item.returned_qty;
      if (remainingReturnable > 0) {
        allDeliveredItems.push({
          id: item.id,
          label: `${item.medicine_name} ${item.strength || ''} (Inv: ${del.delivery_no}) — Dastiyab: ${remainingReturnable} packs`,
          remaining: remainingReturnable,
          unit_price: item.unit_price,
        });
      }
    }
  }

  return (
    <>
      {/* Header: Center Aligned Name, Address, & Action Buttons */}
      <div className="no-print" style={{ textAlign: 'center', margin: '6px 0 24px', padding: '0 12px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--t2)', marginBottom: 6 }}>
          <Link to="/app/customers" style={{ color: 'var(--pr)', fontWeight: 600 }}>
            Wholesale Customers
          </Link>
          <Icon name="right" className="ic-sm" />
          <span>Customer Account #{customer.id}</span>
        </div>

        {/* 1. Center-aligned Name */}
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '2px 0 6px', textAlign: 'center', letterSpacing: '-0.02em' }}>
          {customer.name}
        </h1>

        {/* 2. Center-aligned Address & Contact Details */}
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 18px', textAlign: 'center' }}>
          {[
            customer.owner_name && `Malik: ${customer.owner_name}`,
            customer.phone && `Phone: ${customer.phone}`,
            customer.address,
            customer.city
          ].filter(Boolean).join(' · ')}
        </p>

        {/* 3. Center-aligned Action Buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-sc" disabled={loading} onClick={refreshAccount}>
            <Icon name="refresh" className={`ic-sm ${loading ? 'spin' : ''}`} />
            Refresh
          </button>
          <button className="btn btn-sc" onClick={() => setEditModal(true)}>
            <Icon name="edit" className="ic-sm" />
            Edit Info
          </button>
          <button className="btn btn-sc" onClick={() => window.print()}>
            <Icon name="print" className="ic-sm" />
            Print Ledger
          </button>
          <button className="btn btn-sc" onClick={exportLedgerCSV}>
            <Icon name="fileText" className="ic-sm" />
            Export CSV
          </button>
          <button className="btn btn-sc" style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }} onClick={() => setReturnModal(true)}>
            <Icon name="trend" className="ic-sm" />
            Wapsi / Return
          </button>
          <button className="btn btn-sc" style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }} onClick={() => setPaymentModal(true)}>
            <Icon name="cash" className="ic-sm" />
            Receive Payment
          </button>
          <button className="btn btn-pr" onClick={() => setDeliveryModal(true)}>
            <Icon name="plus" className="ic-sm" />
            New Delivery
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '100%', padding: '0 4px' }}>
        {/* 4 Summary Cards (Icon -> Label -> Price -> Sub-label) */}
        <div className="customers-grid-4">
          {/* Card 1: Total Medicines Supplied */}
          <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid var(--bd)', background: '#fff' }}>
            <div className="kpi-ic" style={{ background: '#ecfdf5', color: '#059669' }}>
              <Icon name="pill" size={22} />
            </div>
            <div className="kpi-lbl" style={{ color: 'var(--t2)' }}>
              Total Medicines Supplied
            </div>
            <div className="kpi-v" style={{ color: '#0f172a' }}>
              {stats?.total_medicines_supplied ?? 0} packs
            </div>
            <small className="muted">{stats?.total_deliveries ?? 0} delivery invoices</small>
          </div>

          {/* Card 2: Total Amount Charged */}
          <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid var(--bd)', background: '#fff' }}>
            <div className="kpi-ic" style={{ background: 'var(--sub)', color: 'var(--pr)' }}>
              <Icon name="trend" size={22} />
            </div>
            <div className="kpi-lbl" style={{ color: 'var(--t2)' }}>
              Total Amount Charged
            </div>
            <div className="kpi-v" style={{ color: '#0f172a' }}>
              {rs2(stats?.total_charged ?? 0)}
            </div>
            <small className="muted">Total Debit (Purchases + Opening)</small>
          </div>

          {/* Card 3: Total Payments Received */}
          <div className="card kpi-vertical" style={{ margin: 0, border: '1px solid #bbf7d0', background: '#fff' }}>
            <div className="kpi-ic" style={{ background: '#f0fdf4', color: '#16a34a' }}>
              <Icon name="check" size={22} />
            </div>
            <div className="kpi-lbl" style={{ color: '#15803d' }}>
              Total Payments Received
            </div>
            <div className="kpi-v" style={{ color: '#16a34a' }}>
              {rs2(stats?.total_payments ?? 0)}
            </div>
            <small className="muted">Total Credit (Paid)</small>
          </div>

          {/* Card 4: Current Outstanding Balance */}
          <div
            className="card kpi-vertical"
            style={{
              margin: 0,
              border: currentBal > 0 ? '1px solid #fecaca' : currentBal < 0 ? '1px solid #bfdbfe' : '1px solid var(--bd)',
              background: currentBal > 0 ? '#fff' : currentBal < 0 ? '#eff6ff' : '#fff',
            }}
          >
            <div
              className="kpi-ic"
              style={{
                background: currentBal > 0 ? '#fef2f2' : currentBal < 0 ? '#dbeafe' : '#f0fdf4',
                color: currentBal > 0 ? '#dc2626' : currentBal < 0 ? '#1d4ed8' : '#16a34a',
              }}
            >
              <Icon name="dollar" size={22} />
            </div>
            <div className="kpi-lbl" style={{ color: currentBal > 0 ? '#dc2626' : currentBal < 0 ? '#1d4ed8' : 'var(--t2)' }}>
              Current Outstanding Balance
            </div>
            <div
              className="kpi-v"
              style={{ color: currentBal > 0 ? '#dc2626' : currentBal < 0 ? '#1d4ed8' : '#16a34a' }}
            >
              {currentBal > 0 ? `${rs2(currentBal)} (Udhaar)` : currentBal < 0 ? `${rs2(Math.abs(currentBal))} (Advance)` : 'Rs 0.00'}
            </div>
            <small className="muted">Formula: Charged − Payments</small>
          </div>
        </div>

        {/* Full-Width Table Card */}
        <div className="card" style={{ width: '100%', marginBottom: 24, borderRadius: 14 }}>
          <div className="th no-print" style={{ borderBottom: '1px solid var(--bd)', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {[
                ['ledger', 'Customer Ledger (Hisaab)'],
                ['deliveries', `Delivery Invoices (${deliveries.length})`],
                ['payments', `Payment History (${payments.length})`],
                ['returns', `Returns & Credit (${returns.length})`],
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  className={`tab ${activeTab === k ? 'on' : ''}`}
                  onClick={() => setActiveTab(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {activeTab === 'ledger' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="muted" style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Date:</span>
                <input
                  type="date"
                  className="inp"
                  style={{ height: 36, padding: '0 8px', fontSize: 13 }}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <span className="muted">ta</span>
                <input
                  type="date"
                  className="inp"
                  style={{ height: 36, padding: '0 8px', fontSize: 13 }}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                {(startDate || endDate) && (
                  <button className="btn btn-sc btn-sm" onClick={() => { setStartDate(''); setEndDate(''); }}>
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {/* TAB 1: Ledger Table */}
          {activeTab === 'ledger' && (
            <div className="tw" style={{ overflowX: 'auto', padding: '0 0 8px' }}>
              <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '14px 18px' }}>Date</th>
                    <th style={{ padding: '14px 14px' }}>Type</th>
                    <th style={{ padding: '14px 14px' }}>Ref #</th>
                    <th style={{ padding: '14px 14px' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '14px 16px' }}>Debit (Charged)</th>
                    <th style={{ textAlign: 'right', padding: '14px 16px' }}>Credit (Received)</th>
                    <th style={{ textAlign: 'right', padding: '14px 18px' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t3)' }}>
                        Koi ledger transaction darj nahi hai
                      </td>
                    </tr>
                  ) : (
                    ledger.map((row) => (
                      <tr key={row.id}>
                        <td style={{ padding: '12px 18px' }}>{dateOnly(row.date)}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <span
                            className={`badge ${
                              row.type === 'delivery' ? 'b-am' : row.type === 'payment' ? 'b-gr' : 'b-gy'
                            }`}
                          >
                            <i />
                            {row.type === 'delivery' ? 'Delivery' : row.type === 'payment' ? 'Payment' : row.type === 'return' ? 'Return' : 'Opening'}
                          </span>
                        </td>
                        <td className="mono" style={{ padding: '12px 14px' }}><b>{row.ref_no || '—'}</b></td>
                        <td style={{ padding: '12px 14px' }}>{row.description}</td>
                        <td style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 600, color: row.debit > 0 ? '#dc2626' : undefined }}>
                          {row.debit > 0 ? rs2(row.debit) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 600, color: row.credit > 0 ? '#16a34a' : undefined }}>
                          {row.credit > 0 ? rs2(row.credit) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', padding: '12px 18px', fontWeight: 700 }}>
                          {rs2(row.running_balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {ledger.length > 0 && (
                  <tfoot>
                    <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                      <td colSpan={4} style={{ padding: '16px 18px', fontWeight: 800, fontSize: 14 }}>
                        Grand Total
                      </td>
                      <td style={{ textAlign: 'right', padding: '16px 16px', color: ledgerTotals.total_debit > 0 ? '#dc2626' : 'inherit', fontWeight: 800, fontSize: 14 }}>
                        {rs2(ledgerTotals.total_debit)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '16px 16px', color: ledgerTotals.total_credit > 0 ? '#16a34a' : 'inherit', fontWeight: 800, fontSize: 14 }}>
                        {rs2(ledgerTotals.total_credit)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '16px 18px', fontSize: 15, fontWeight: 800, color: currentBal > 0 ? '#dc2626' : currentBal < 0 ? '#16a34a' : 'inherit' }}>
                        {rs2(currentBal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* TAB 2: Delivery Invoices */}
          {activeTab === 'deliveries' && (
            <div className="tw" style={{ overflowX: 'auto', padding: '0 0 8px' }}>
              <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '14px 18px' }}>Delivery Date</th>
                    <th style={{ padding: '14px 14px' }}>Invoice / Ref #</th>
                    <th style={{ padding: '14px 14px' }}>Items</th>
                    <th style={{ textAlign: 'right', padding: '14px 16px' }}>Total Amount</th>
                    <th style={{ textAlign: 'right', padding: '14px 16px' }}>Paid</th>
                    <th style={{ textAlign: 'right', padding: '14px 16px' }}>Remaining</th>
                    <th style={{ padding: '14px 14px' }}>Status</th>
                    <th style={{ textAlign: 'right', padding: '14px 18px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t3)' }}>
                        Koi delivery record nahi mila
                      </td>
                    </tr>
                  ) : (
                    deliveries.map((del) => {
                      const remaining = Math.max(0, Number(del.total_amount) - Number(del.paid_amount));
                      return (
                        <tr key={del.id}>
                          <td style={{ padding: '12px 18px' }}>{dateOnly(del.delivery_date)}</td>
                          <td className="mono" style={{ padding: '12px 14px' }}><b>{del.delivery_no}</b></td>
                          <td style={{ padding: '12px 14px' }}>{del.items?.length || 0} items</td>
                          <td style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 700 }}>{rs2(del.total_amount)}</td>
                          <td style={{ textAlign: 'right', padding: '12px 16px', color: '#16a34a' }}>{rs2(del.paid_amount)}</td>
                          <td style={{ textAlign: 'right', padding: '12px 16px', color: remaining > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                            {rs2(remaining)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span
                              className={`badge ${
                                del.status === 'paid' ? 'b-gr' : del.status === 'partially_paid' ? 'b-am' : 'b-gy'
                              }`}
                            >
                              <i />
                              {del.status === 'paid' ? 'Paid' : del.status === 'partially_paid' ? 'Partial' : 'Unpaid'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '12px 18px' }}>
                            <button
                              className="btn btn-sc btn-sm"
                              onClick={() => setInvoiceModal(del)}
                            >
                              <Icon name="eye" className="ic-sm" />
                              View Invoice
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: Payment History */}
          {activeTab === 'payments' && (
            <div className="tw" style={{ overflowX: 'auto', padding: '0 0 8px' }}>
              <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '14px 18px' }}>Payment Date</th>
                    <th style={{ padding: '14px 14px' }}>Receipt #</th>
                    <th style={{ padding: '14px 14px' }}>Method</th>
                    <th style={{ padding: '14px 14px' }}>Reference / Tran ID</th>
                    <th style={{ padding: '14px 14px' }}>Notes</th>
                    <th style={{ textAlign: 'right', padding: '14px 18px' }}>Amount Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t3)' }}>
                        Koi payment history nahi hai
                      </td>
                    </tr>
                  ) : (
                    payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ padding: '12px 18px' }}>{dateOnly(p.payment_date)}</td>
                        <td className="mono" style={{ padding: '12px 14px' }}><b>{p.payment_no}</b></td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{p.payment_method}</span>
                        </td>
                        <td className="mono" style={{ padding: '12px 14px' }}>{p.reference_no || '—'}</td>
                        <td style={{ padding: '12px 14px' }}>{p.notes || '—'}</td>
                        <td style={{ textAlign: 'right', padding: '12px 18px', fontWeight: 700, color: '#16a34a', fontSize: 14.5 }}>
                          {rs2(p.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: Returns History */}
          {activeTab === 'returns' && (
            <div className="tw" style={{ overflowX: 'auto', padding: '0 0 8px' }}>
              <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '14px 18px' }}>Date</th>
                    <th style={{ padding: '14px 14px' }}>Return No</th>
                    <th style={{ padding: '14px 14px' }}>Medicine</th>
                    <th style={{ padding: '14px 14px' }}>Quantity</th>
                    <th style={{ textAlign: 'right', padding: '14px 16px' }}>Unit Price</th>
                    <th style={{ textAlign: 'right', padding: '14px 16px' }}>Credit Amount</th>
                    <th style={{ padding: '14px 18px' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t3)' }}>
                        Koi returns / credit notes record nahi hai
                      </td>
                    </tr>
                  ) : (
                    returns.map((ret) => (
                      <tr key={ret.id}>
                        <td style={{ padding: '12px 18px' }}>{dateOnly(ret.return_date)}</td>
                        <td className="mono" style={{ padding: '12px 14px' }}><b>{ret.return_no}</b></td>
                        <td style={{ padding: '12px 14px' }}>
                          <b>{ret.medicine_name}</b> {ret.strength && <small className="muted">({ret.strength})</small>}
                        </td>
                        <td style={{ padding: '12px 14px' }}>{ret.qty} packs</td>
                        <td style={{ textAlign: 'right', padding: '12px 16px' }}>{rs2(ret.unit_price)}</td>
                        <td style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 700, color: '#16a34a' }}>
                          {rs2(ret.total_amount)}
                        </td>
                        <td style={{ padding: '12px 18px' }}>{ret.reason || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: Add Medicines / New Delivery */}
      {deliveryModal && (
        <Modal
          title={`New Medicine Delivery — ${customer.name}`}
          subtitle="Inventory se dawaiyan select karein (Stock khud bakhud deduct hoga)"
          onClose={() => setDeliveryModal(false)}
          width={860}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div style={{ fontSize: 14 }}>
                Total Delivery Amount: <b style={{ fontSize: 17, color: 'var(--pr-d)' }}>{rs2(deliveryFinalTotal)}</b>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sc" onClick={() => setDeliveryModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-pr"
                  disabled={delSaving || !deliveryItems.length}
                  onClick={handleConfirmDelivery}
                >
                  {delSaving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                  Confirm Delivery &amp; Deduct Stock
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Delivery Date & Search bar */}
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
                <Field label="Dawai Search Karein (Naam, Barcode, Company)">
                  <div style={{ position: 'relative' }}>
                    <input
                      className="inp"
                      style={{ paddingLeft: 34 }}
                      placeholder="Panadol, Augmentin, barcode..."
                      value={searchProductQuery}
                      onChange={(e) => setSearchProductQuery(e.target.value)}
                      autoFocus
                    />
                    <Icon
                      name="search"
                      className="ic-sm"
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)' }}
                    />
                  </div>
                </Field>

                {/* Dropdown search results */}
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
                      maxHeight: 220,
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
                          <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>
                            MRP: {rs2(prod.mrp)} · Khareed TP: {rs2(prod.tp)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span className={`badge ${prod.stock > 5 ? 'b-gr' : 'b-am'}`}>
                            Stock: {prod.stock} packs
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Selected Items Table */}
            <div className="tw" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th style={{ width: 90 }}>Available</th>
                    <th style={{ width: 110 }}>Qty (Packs)</th>
                    <th style={{ width: 130 }}>Selling Price</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Total</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>
                        Oopar search bar se delivery ke liye dawaiyan select karein
                      </td>
                    </tr>
                  ) : (
                    deliveryItems.map((item, idx) => (
                      <tr key={item.product_id}>
                        <td>
                          <b>{item.name}</b> {item.strength && <small className="muted">({item.strength})</small>}
                        </td>
                        <td>
                          <span className="badge b-gy">{item.stock}</span>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            max={item.stock}
                            className="inp mono"
                            style={{ height: 34, padding: '0 8px' }}
                            value={item.qty}
                            onChange={(e) => updateDeliveryItem(idx, 'qty', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            className="inp mono"
                            style={{ height: 34, padding: '0 8px' }}
                            value={item.unit_price}
                            onChange={(e) => updateDeliveryItem(idx, 'unit_price', e.target.value)}
                          />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {rs2(item.line_total)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="kebab"
                            onClick={() => removeDeliveryItem(idx)}
                            title="Remove"
                          >
                            <Icon name="x" className="ic-sm" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Discount & Notes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Special Discount (Rs)">
                <input
                  className="inp mono"
                  inputMode="decimal"
                  value={deliveryDiscount}
                  onChange={(e) => setDeliveryDiscount(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Delivery Notes / Hidayat">
                <input
                  className="inp"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="Bilty number, driver name ya details..."
                />
              </Field>
            </div>

            {/* Immediate Payment at Delivery */}
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

      {/* MODAL 2: Receive Payment */}
      {paymentModal && (
        <Modal
          title={`Receive Payment — ${customer.name}`}
          subtitle={`Current Baqaya: ${rs2(customer.current_balance)}`}
          onClose={() => setPaymentModal(false)}
          width={520}
          footer={
            <>
              <button className="btn btn-sc" onClick={() => setPaymentModal(false)}>
                Cancel
              </button>
              <button className="btn btn-pr" disabled={paySaving} onClick={handleReceivePayment}>
                {paySaving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                Payment Record Karein
              </button>
            </>
          }
        >
          <form onSubmit={handleReceivePayment} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              <Field label="Payment Date *">
                <input
                  type="date"
                  className="inp"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  required
                />
              </Field>

              <Field label="Payment Method">
                <select className="inp" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>

            <Field label="Reference / Cheque / Transaction ID (Optional)">
              <input
                className="inp mono"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="Cheque # ya online TID"
              />
            </Field>

            <Field label="Specific Delivery Invoice (Optional, Default FIFO)">
              <select className="inp" value={payDeliveryId} onChange={(e) => setPayDeliveryId(e.target.value)}>
                <option value="">-- FIFO Allocation (Purani deliveries pehle clear hongi) --</option>
                {deliveries.filter((d) => d.status !== 'paid').map((d) => (
                  <option key={d.id} value={d.id}>
                    Invoice #{d.delivery_no} ({dateOnly(d.delivery_date)}) — Remaining: {rs2(d.total_amount - d.paid_amount)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Payment Notes">
              <input
                className="inp"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Kis ne payment di ya zaroori note..."
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* MODAL 3: Medicine Return / Credit Note */}
      {returnModal && (
        <Modal
          title={`Medicine Return / Credit Note — ${customer.name}`}
          subtitle="Dawai wapas lene par inventory restore hogi aur customer balance kam hoga"
          onClose={() => setReturnModal(false)}
          width={560}
          footer={
            <>
              <button className="btn btn-sc" onClick={() => setReturnModal(false)}>
                Cancel
              </button>
              <button className="btn btn-pr" disabled={returnSaving} onClick={handleMedicineReturn}>
                {returnSaving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                Wapsi Accept &amp; Stock Restore
              </button>
            </>
          }
        >
          <form onSubmit={handleMedicineReturn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Pehle Deliver Hui Dawai Chunein *">
              <select
                className="inp"
                value={returnDeliveryItemId}
                onChange={(e) => setReturnDeliveryItemId(e.target.value)}
                required
              >
                <option value="">-- Select medicine from delivery invoices --</option>
                {allDeliveredItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.label}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Wapsi Quantity (Packs) *">
                <input
                  type="number"
                  min="1"
                  className="inp mono"
                  value={returnQty}
                  onChange={(e) => setReturnQty(e.target.value)}
                  placeholder="Kitne packs wapas aaye"
                  required
                />
              </Field>

              <Field label="Return Date">
                <input
                  type="date"
                  className="inp"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Wapsi Ki Wajah / Reason">
              <input
                className="inp"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Expiry, damage, ya excess stock..."
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* MODAL 4: Edit Customer Details */}
      {editModal && (
        <Modal
          title={`Edit Info — ${customer.name}`}
          onClose={() => setEditModal(false)}
          width={540}
          footer={
            <>
              <button className="btn btn-sc" onClick={() => setEditModal(false)}>
                Cancel
              </button>
              <button className="btn btn-pr" disabled={editSaving} onClick={handleUpdateCustomer}>
                {editSaving ? <Spinner /> : <Icon name="check" className="ic-sm" />}
                Save Changes
              </button>
            </>
          }
        >
          <form onSubmit={handleUpdateCustomer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Medical Store Ka Naam *">
              <input
                className="inp"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                required
              />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Owner Name">
                <input
                  className="inp"
                  value={editData.owner_name}
                  onChange={(e) => setEditData({ ...editData, owner_name: e.target.value })}
                />
              </Field>
              <Field label="Phone / Mobile *">
                <input
                  className="inp mono"
                  value={editData.phone}
                  onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                  required
                />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="City">
                <input
                  className="inp"
                  value={editData.city}
                  onChange={(e) => setEditData({ ...editData, city: e.target.value })}
                />
              </Field>
              <Field label="Address">
                <input
                  className="inp"
                  value={editData.address}
                  onChange={(e) => setEditData({ ...editData, address: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                className="inp"
                style={{ height: 60, resize: 'vertical' }}
                value={editData.notes}
                onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* MODAL 5: Printable Delivery Invoice */}
      {invoiceModal && (
        <Modal
          title={`Delivery Invoice #${invoiceModal.delivery_no}`}
          subtitle={`Date: ${dateOnly(invoiceModal.delivery_date)} · Customer: ${customer.name}`}
          onClose={() => setInvoiceModal(null)}
          width={700}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <button className="btn btn-sc" onClick={() => setInvoiceModal(null)}>
                Close
              </button>
              <button className="btn btn-pr" onClick={() => window.print()}>
                <Icon name="print" className="ic-sm" />
                Print Invoice
              </button>
            </div>
          }
        >
          <div style={{ padding: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <b>Customer:</b> {customer.name}<br />
                {customer.phone && <small>Phone: {customer.phone}<br /></small>}
                {customer.address && <small>Address: {customer.address}, {customer.city}</small>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <b>Invoice:</b> {invoiceModal.delivery_no}<br />
                <small>Date: {dateOnly(invoiceModal.delivery_date)}<br /></small>
                <span className="badge b-gr">{invoiceModal.status?.toUpperCase()}</span>
              </div>
            </div>

            <table className="tbl" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>Qty</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(invoiceModal.items || []).map((it) => (
                  <tr key={it.id}>
                    <td><b>{it.medicine_name}</b> {it.strength && <small className="muted">({it.strength})</small>}</td>
                    <td>{it.batch_no || '—'}</td>
                    <td>{it.expiry_date ? dateOnly(it.expiry_date) : '—'}</td>
                    <td>{it.qty} packs</td>
                    <td style={{ textAlign: 'right' }}>{rs2(it.unit_price)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{rs2(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>Subtotal:</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{rs2(invoiceModal.subtotal)}</td>
                </tr>
                {Number(invoiceModal.discount) > 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'right' }}>Discount:</td>
                    <td style={{ textAlign: 'right', color: '#dc2626' }}>-{rs2(invoiceModal.discount)}</td>
                  </tr>
                )}
                <tr style={{ background: 'var(--sub)', fontSize: 15, fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right' }}>Total Amount:</td>
                  <td style={{ textAlign: 'right' }}>{rs2(invoiceModal.total_amount)}</td>
                </tr>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', color: '#16a34a' }}>Amount Paid:</td>
                  <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>{rs2(invoiceModal.paid_amount)}</td>
                </tr>
                <tr style={{ fontWeight: 700, color: '#dc2626' }}>
                  <td colSpan={5} style={{ textAlign: 'right' }}>Remaining Balance:</td>
                  <td style={{ textAlign: 'right' }}>{rs2(invoiceModal.total_amount - invoiceModal.paid_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}

