import { useMemo, useState } from 'react';
import { Field } from '../components/ui';
import { rs2 } from '../utils/format';

export default function TpCalc() {
  const [v, setV] = useState({ mrp: '500', tpp: '15', tp: '', dd: '2', buy: '10', free: '1', cd: '0', qty: '11' });
  const [tpManual, setTpManual] = useState(false);
  const set = (k) => (e) => {
    const val = e.target.value.replace(/[^\d.]/g, '');
    if (k === 'tp') setTpManual(true);
    if (k === 'mrp' || k === 'tpp') setTpManual(false);
    setV((x) => ({ ...x, [k]: val }));
  };
  const n = (k) => Number(v[k]) || 0;

  const r = useMemo(() => {
    const mrp = n('mrp'), buy = Math.max(1, n('buy')), free = n('free');
    const tp = tpManual ? n('tp') : mrp * (1 - n('tpp') / 100);
    const afterDisc = tp * (1 - n('dd') / 100);
    const net = (afterDisc * buy) / (buy + free);
    const sale = mrp * (1 - n('cd') / 100);
    const ppu = sale - net;
    return { tp, afterDisc, net, sale, ppu, margin: sale ? (ppu / sale) * 100 : 0, total: ppu * n('qty'), buy, free, mrp };
  }, [v, tpManual]); // eslint-disable-line

  const tpVal = tpManual ? v.tp : r.tp.toFixed(2);

  return (
    <>
      <div className="ph"><div><h1>TP &amp; Profit Calculator</h1><p>MRP, TP, distributor discount aur bonus scheme se asal cost aur munafa</p></div></div>
      <div className="tp">
        <div className="card">
          <div className="c-h"><h3>Input</h3><span className="badge b-vi">Live hisaab</span></div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="MRP (per pack)"><input className="inp" value={v.mrp} onChange={set('mrp')} /></Field>
            <Field label="TP % (MRP se kam)"><input className="inp" value={v.tpp} onChange={set('tpp')} /></Field>
            <Field label="TP (khud bhi likh sakte hain)"><input className="inp" value={tpVal} onChange={set('tp')} /></Field>
            <Field label="Distributor extra discount %"><input className="inp" value={v.dd} onChange={set('dd')} /></Field>
            <Field label="Bonus: kitne khareede"><input className="inp" value={v.buy} onChange={set('buy')} /></Field>
            <Field label="Bonus: kitne free"><input className="inp" value={v.free} onChange={set('free')} /></Field>
            <Field label="Customer ko discount %"><input className="inp" value={v.cd} onChange={set('cd')} /></Field>
            <Field label="Kitne packs"><input className="inp" value={v.qty} onChange={set('qty')} /></Field>
          </div>
        </div>
        <div className="card">
          <div className="c-h"><h3>Result</h3></div>
          <div className="res">
            <div className="box"><small>TP per pack</small><div>{rs2(r.tp)}</div></div>
            <div className="box"><small>Asal cost per pack</small><div>{rs2(r.net)}</div></div>
            <div className="box"><small>Sale price per pack</small><div>{rs2(r.sale)}</div></div>
            <div className="box hi"><small>Profit per pack</small><div>{rs2(r.ppu)}</div></div>
            <div className="box hi"><small>Margin</small><div>{r.margin.toFixed(1)}%</div></div>
            <div className="box hi"><small>Total profit</small><div>{rs2(r.total)}</div></div>
          </div>
        </div>
      </div>
    </>
  );
}
