/**
 * Monthly Records — har mahine ka card. Naya mahina sab se upar.
 * Sale, profit, dawaiyan biki (stock gaya), stock aaya, top dawai.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUi } from '../context/UiContext';
import Icon from '../components/Icon';
import { Seg, Spinner, Empty } from '../components/ui';
import { monthPdf } from '../utils/pdf';
import { lakh, num, monthName, monthShort } from '../utils/format';

export default function Records() {
  const { store } = useAuth();
  const { toast } = useUi();
  const [year, setYear] = useState(null);
  const [d, setD] = useState(null);

  useEffect(() => {
    setD(null);
    api('/reports/monthly', { query: { year } }).then((r) => { setD(r); if (!year && r.years[0]) setYear(r.years[0]); })
      .catch((e) => toast(e.message, 'err'));
  }, [year]); // eslint-disable-line

  return (
    <>
      <div className="ph">
        <div><h1>Monthly Records</h1><p>Har mahine ka record — sale, profit, stock aaya aur gaya. Naya mahina upar.</p></div>
        {d?.years?.length > 1 && <div className="acts"><Seg value={year} onChange={setYear} options={d.years.map((y) => ({ value: y, label: String(y) }))} /></div>}
      </div>
      {!d ? <div className="center"><Spinner /></div> : d.records.length === 0 ? <div className="card"><Empty title="Abhi koi record nahi" text="Pehli sale ke baad yahan mahine ka card banega" /></div> : (
        <div className="rec-grid">
          {d.records.map((r) => (
            <div key={r.ym} className={`card rec ${r.is_current ? 'cur' : ''}`}>
              <div className="rec-h">
                <div className="mo">
                  <div className="cal"><small>{monthShort(r.ym).toUpperCase()}</small><b>{r.ym.slice(2, 4)}</b></div>
                  <div><h4>{monthName(r.ym)}</h4><small className="muted" style={{ fontSize: 12 }}>{num(r.bills)} bills</small></div>
                </div>
                {r.is_current ? <span className="badge b-gr"><i />Jaari hai</span> : <span className="badge b-gy">Band</span>}
              </div>
              <div className="rec-big">
                <small>Kul sale</small>
                <div className="v">{lakh(r.sale)}</div>
                {r.change_pct !== null
                  ? <small className={r.change_pct >= 0 ? 'up' : 'dn'} style={{ fontSize: 12 }}>{r.change_pct >= 0 ? '↑' : '↓'} {Math.abs(r.change_pct).toFixed(1)}% pichle mahine se</small>
                  : <small className="muted" style={{ fontSize: 12 }}>{r.is_current ? 'Mahina abhi chal raha hai' : 'Pehla record'}</small>}
              </div>
              <div className="rec-m">
                <div><small>Profit</small><b style={{ color: 'var(--pr-d)' }}>{lakh(r.profit)}</b></div>
                <div><small>Dawaiyan biki</small><b>{num(r.items_sold)} packs</b></div>
                <div><small>Stock aaya</small><b>{lakh(r.stock_in_value)}</b></div>
                <div><small>Stock gaya</small><b>{num(r.items_sold)} packs</b></div>
              </div>
              <div className="rec-f">
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Top: <b style={{ color: 'var(--t1)' }}>{r.top_product || '—'}</b></span>
                <button className="btn btn-gh btn-sm" onClick={() => monthPdf(store, r).catch((e) => toast(e.message, 'err'))}><Icon name="pdf" className="ic-sm" />PDF</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
