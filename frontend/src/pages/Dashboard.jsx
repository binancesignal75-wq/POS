import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import { Stat, Change, BarChart, Seg, Spinner, Empty } from '../components/ui';
import { BillModal } from './Pos';
import { rs, num, time, todayLong, monthName, PAYMENTS, daysUntil, dateOnly } from '../utils/format';

export default function Dashboard() {
  const { store } = useAuth();
  const getTodayStr = () => new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(getTodayStr);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [range, setRange] = useState('today');
  const [bills, setBills] = useState(null);
  const [openBill, setOpenBill] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const isToday = selectedDate === getTodayStr();

  const loadDashboard = () => {
    setRefreshing(true);
    const p1 = api('/reports/dashboard', { query: { date: selectedDate } })
      .then(setD)
      .catch((e) => setErr(e.message));
    const q = isToday ? { range, limit: 10 } : { date: selectedDate, limit: 10 };
    const p2 = api('/sales', { query: q })
      .then(setBills)
      .catch(() => setBills({ sales: [], total: 0 }));
    Promise.all([p1, p2]).finally(() => setRefreshing(false));
  };

  useEffect(() => {
    loadDashboard();
  }, [selectedDate, range]);

  if (err) return <div className="err">{err}</div>;
  if (!d) return <div className="center"><Spinner /></div>;

  const t = d.today, m = d.month;
  const margin = (p, s) => (s ? `Margin ${((p / s) * 100).toFixed(1)}%` : 'Abhi koi sale nahi');
  const alerts = [
    ...(d.low_stock.count ? [{ key: 'low', icon: 'down', bg: 'var(--rd-50)', col: 'var(--rd)', title: `${d.low_stock.count} dawaiyan khatam hone wali`, sub: d.low_stock.list.map((x) => x.name).slice(0, 3).join(', '), link: '/app/low-stock', btn: 'PDF' }] : []),
    ...d.expiring.list.map((x) => {
      const days = daysUntil(x.expiry_date);
      return { key: `e${x.id}`, icon: 'clock', bg: 'var(--am-50)', col: 'var(--am)', title: `${x.name} ${x.strength || ''} — ${days < 0 ? 'expire ho chuki' : `${days} din mein expire`}`, sub: `Batch ${x.batch_no || '—'} · ${x.stock} packs` };
    }),
    ...(store.days_left <= 7 ? [{ key: 'lic', icon: 'key', bg: 'var(--am-50)', col: 'var(--am)', title: `License ${store.days_left} din mein khatam`, sub: 'Admin se renew karwayein' }] : [])
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h1>Dashboard</h1>
          <p>{todayLong()} · {store.name}</p>
        </div>
        <div className="acts" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* SINGLE DATE FILTER */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: '#ffffff',
              border: '1.5px solid var(--bd, #e2e8f0)',
              borderRadius: 10,
              padding: '6px 12px',
              boxShadow: 'var(--sh-xs)',
            }}
          >
            <Icon name="cal" className="ic-sm" style={{ color: 'var(--pr)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>Tareekh:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              style={{
                border: 'none',
                outline: 'none',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--t1)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            />
            {!isToday && (
              <button
                type="button"
                className="btn btn-pr btn-sm"
                onClick={() => setSelectedDate(getTodayStr())}
                style={{ height: 26, padding: '0 8px', fontSize: 11.5 }}
              >
                Aaj (Today)
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-sc"
            title="Dashboard hisaab refresh karein"
            disabled={refreshing}
            onClick={loadDashboard}
          >
            <Icon name="refresh" className={`ic-sm ${refreshing ? 'spin' : ''}`} />
            Refresh
          </button>
          <Link className="btn btn-sc" to="/app/low-stock"><Icon name="pdf" className="ic-sm" />Low stock PDF</Link>
          <Link className="btn btn-sc" to="/app/records"><Icon name="cal" className="ic-sm" />Monthly records</Link>
        </div>
      </div>

      <div className="sec-t" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{isToday ? 'Aaj ka Hisaab' : `${dateOnly(selectedDate)} ka Hisaab`}</span>
        {!isToday && <span className="badge b-am"><i />Selected Day Filter</span>}
      </div>
      <div className="stats-3">
        <Stat
          icon="cash"
          label={isToday ? "Aaj ki sale" : "Is din ki sale"}
          value={rs(t.sale)}
          badge={isToday ? <span className="badge b-gr">Live</span> : undefined}
          foot={<Change now={t.sale} prev={t.yesterday_sale} label="pichle din se" />}
        />
        <Stat
          icon="trend"
          iconColor="var(--pr)"
          label={isToday ? "Aaj ka profit" : "Is din ka profit"}
          value={rs(t.profit)}
          valueColor="var(--pr-d)"
          foot={margin(t.profit, t.sale)}
        />
        <Stat
          icon="receipt"
          label={isToday ? "Aaj ke bills" : "Is din ke bills"}
          value={num(t.bills)}
          foot={`Avg bill ${rs(t.avg_bill)}`}
        />
        <Stat
          icon="alert"
          iconColor="var(--rd)"
          label="Expiry (90 din)"
          value={num(d.expiring.count)}
          valueColor="#b45309"
          foot={`${rs(d.expiring.value)} ka maal`}
        />
      </div>

      <div className="sec-t">Is mahina — {monthName(d.date.slice(0, 7))}</div>
      <div className="stats-3">
        <Stat highlight icon="cash" label="Is mahine ki sale" value={rs(m.sale)} badge={<span className="badge b-gr">Day {d.day_of_month} / {d.days_in_month}</span>}
          foot={<Change now={m.sale} prev={m.prev_same_period_sale} label="pichle mahine isi waqt se" />} />
        <Stat highlight icon="trend" iconColor="var(--pr)" label="Is mahine ka profit" value={rs(m.profit)} valueColor="var(--pr-d)" foot={margin(m.profit, m.sale)} />
        <Stat icon="truck" iconColor="var(--bl)" label="Stock aaya (purchase)" value={rs(m.stock_in_value)} foot={`${num(m.stock_in_qty)} packs${m.suppliers ? ` · ${m.suppliers} suppliers` : ''}`} />
        <Stat icon="box" iconColor="var(--vi)" label="Dawaiyan biki (stock gaya)" value={num(m.items_sold)} foot={`packs · ${num(m.bills)} bills`} />
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="c-h"><div><h3>Sale aur profit</h3><p>Pichle 6 mahine</p></div>
          <div className="legend"><span><i style={{ background: '#c3e9a6' }} />Sale</span><span><i style={{ background: 'var(--pr)' }} />Profit</span></div></div>
        <div style={{ padding: '14px 18px 10px' }}><BarChart data={d.chart} height={260} /></div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="c-h"><div><h3>Alerts</h3><p>Abhi dhyan dein</p></div>{alerts.length > 0 && <span className="badge b-rd">{alerts.length}</span>}</div>
        {alerts.length === 0 && <Empty title="Sab theek hai" text="Koi alert nahi" />}
        {alerts.map((a) => (
          <div className="alert-row" key={a.key}>
            <div className="ai" style={{ background: a.bg, color: a.col }}><Icon name={a.icon} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><b>{a.title}</b><small>{a.sub}</small></div>
            {a.link && <Link className="btn btn-sc btn-sm" to={a.link}>{a.btn}</Link>}
          </div>
        ))}
      </div>

      <div className="card tbl-card">
        <div className="tbl-bar">
          <div className="tt">Recent bills {bills && <span className="badge b-gy">{bills.total}</span>}</div>
          <Seg value={range} onChange={setRange} options={[{ value: 'today', label: 'Aaj' }, { value: 'yesterday', label: 'Kal' }, { value: 'week', label: 'Hafta' }]} />
        </div>
        {!bills ? <div className="empty"><Spinner /></div> : bills.sales.length === 0 ? <Empty title="Koi bill nahi" text="Is waqt mein koi sale nahi hui" /> : (
          <table>
            <thead><tr><th>Bill #</th><th>Waqt</th><th>Items</th><th>Payment</th><th className="r">Amount</th><th className="r">Profit</th><th /></tr></thead>
            <tbody>
              {bills.sales.map((b) => (
                <tr key={b.id}>
                  <td><span className="t-num">#{b.bill_no}</span></td>
                  <td>{time(b.created_at)}</td>
                  <td>{b.items_count} items</td>
                  <td><span className={`badge ${b.payment_method === 'cash' ? 'b-gr' : b.payment_method === 'udhaar' ? 'b-am' : 'b-bl'}`}>{PAYMENTS[b.payment_method]}</span></td>
                  <td className="r t-num">{rs(b.total)}</td>
                  <td className="r" style={{ color: 'var(--pr-d)', fontWeight: 600 }}>{rs(b.profit)}</td>
                  <td className="r"><button className="kebab" title="Bill dekhein" onClick={() => setOpenBill(b.id)}><Icon name="print" className="ic-sm" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openBill && <BillModal id={openBill} onClose={() => setOpenBill(null)} />}
    </>
  );
}
