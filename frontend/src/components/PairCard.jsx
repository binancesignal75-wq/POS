import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';
import { useScanner } from '../context/ScannerContext';
import Icon from './Icon';
import { Spinner } from './ui';

/** Phone connect karne ka QR (10 minute valid) */
export default function PairCard({ compact }) {
  const { devices } = useScanner();
  const [pc, setPc] = useState(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState('');

  const make = () => {
    setErr('');
    api('/pair/code', { method: 'POST' }).then((r) => { setPc(r); setLeft(r.expires_in); }).catch((e) => setErr(e.message));
  };
  useEffect(() => { make(); }, []);
  useEffect(() => {
    if (!pc) return undefined;
    const t = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [pc]);

  // Website se khula ho to wahi domain; warna (desktop app, localhost) server ka bataya hua link
  const qrLink = window.location.protocol === 'https:' && pc?.code ? `${window.location.origin}/scan?code=${pc.code}` : pc?.qr || '';

  return (
    <div className="card pair">
      <h3 style={{ fontSize: 16 }}>Phone connect karein</h3>
      <p className="t2" style={{ fontSize: 13, marginTop: 3 }}>Phone ke camera se QR scan karein. Scanner browser mein khud khul jayega, app ki zaroorat nahi</p>
      {err ? <div className="err" style={{ marginTop: 14 }}>{err}</div> : !pc ? <div style={{ padding: 60 }}><Spinner /></div> : left > 0 ? (
        <>
          <div className="qr" style={{ display: 'grid', placeItems: 'center' }}><QRCodeSVG value={qrLink} size={140} /></div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '.2em' }}>{pc.code}</div>
          <small className="muted">ya ye code likhein · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} baqi</small>
        </>
      ) : (
        <div style={{ padding: '30px 0' }}><button className="btn btn-sc" onClick={make}><Icon name="refresh" className="ic-sm" />Naya code banayein</button></div>
      )}
      <div style={{ marginTop: 14 }}>
        {devices.length ? devices.map((d) => (
          <span key={d.id} className="badge b-gr" style={{ margin: 3 }}><span className="pulse" style={{ width: 6, height: 6 }} />{d.name} connected</span>
        )) : <span className="badge b-gy">Koi phone connected nahi</span>}
      </div>
      {!compact && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
          <div className="step"><b>1</b>Dabbi ko phone camera ke aage rokein</div>
          <div className="step"><b>2</b>AI naam, MG, pack, MRP aur expiry khud parh leta hai</div>
          <div className="step"><b>3</b>Phone par check karke "Counter par Add karein" dabayein</div>
          <div className="step"><b>4</b>Yahan form bhar jayega, check karke Save karein</div>
        </div>
      )}
    </div>
  );
}
