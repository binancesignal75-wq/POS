/**
 * Login = License key + 4-digit PIN
 * Key ek dafa — computer yaad rakhta hai. Agli dafa sirf PIN, key ka box kabhi nahi
 * (sirf tab jab key waqai ghalat ho, ya user khud "Doosri license key" dabaye).
 * PIN set na ho to yahin naya PIN banta hai (2 dafa likh kar).
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, storage } from '../api';
import { useAuth } from '../context/AuthContext';
import { StoreLogo, TyposLogo, Spinner } from '../components/ui';
import Icon from '../components/Icon';
import { dateOnly } from '../utils/format';

function PinBoxes({ value, onChange, onDone, autoFocus }) {
  const refs = [useRef(), useRef(), useRef(), useRef()];
  useEffect(() => { if (autoFocus) refs[0].current?.focus(); }, [autoFocus]); // eslint-disable-line
  const set = (i, v, typed) => {
    const d = v.replace(/\D/g, '');
    // paste ya browser ka saved PIN: khana bhar do, lekin login khud na karo.
    // Warna logout ke foran baad browser PIN bhar kar dobara login kar deta tha.
    if (d.length > 1) {
      const all = (value.slice(0, i) + d).slice(0, 4);
      onChange(all);
      refs[Math.min(3, all.length)].current?.focus();
      return;
    }
    const arr = value.padEnd(4, ' ').split('');
    arr[i] = d || ' ';
    const next = arr.join('').trimEnd();
    onChange(next.replace(/ /g, ''));
    if (d && i < 3) refs[i + 1].current?.focus();
    if (d && i === 3 && typed) { const full = arr.join(''); if (!full.includes(' ')) onDone?.(full); }
  };
  return (
    <div className="pins">
      {[0, 1, 2, 3].map((i) => (
        // type="password" nahi: browser password manager is par PIN save/fill karta hai. Digits CSS se chhupe hain.
        <input key={i} ref={refs[i]} inputMode="numeric" type="text" maxLength={4} autoComplete="off" data-lpignore="true" data-1p-ignore="true"
          aria-label={`PIN digit ${i + 1}`} style={{ WebkitTextSecurity: 'disc' }}
          className={value[i] ? 'f' : ''} value={value[i] || ''}
          onChange={(e) => set(i, e.target.value, /^insert(Text|CompositionText)$/.test(e.nativeEvent.inputType || ''))}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !value[i] && i > 0) { refs[i - 1].current?.focus(); onChange(value.slice(0, i - 1)); } }} />
      ))}
    </div>
  );
}

export default function Login() {
  const { store: loggedIn, login, sessionMsg, loading } = useAuth();
  const nav = useNavigate();
  const [key, setKey] = useState(storage.licenseKey() || '');
  const [store, setStore] = useState(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  // key yaad hai to pehli hi screen PIN: server ke jawab ka intezar nahi
  const [step, setStep] = useState(storage.licenseKey() ? 'pin' : 'key'); // key | pin | setpin | confirm
  const [err, setErr] = useState(sessionMsg || '');
  const [busy, setBusy] = useState(false);

  const checkKey = async (k = key) => {
    setErr(''); setBusy(true);
    try {
      const { store } = await api('/auth/check-key', { method: 'POST', body: { key: k } });
      setStore(store);
      setStep(store.has_pin ? 'pin' : 'setpin');
      setPin(''); setPin2('');
    } catch (e) {
      // internet/server ka masla key ka masla nahi: PIN wali screen par hi raho
      if (storage.licenseKey() && (!e.status || e.status >= 500)) setErr('Network issue hai. Internet check karke PIN daalein.');
      else { setErr(e.message); setStep('key'); }
    } finally { setBusy(false); }
  };

  // key yaad hai to seedha PIN
  useEffect(() => { if (storage.licenseKey()) checkKey(storage.licenseKey()); }, []); // eslint-disable-line

  const finish = (token, s) => {
    storage.setLicenseKey(s ? key.trim().toUpperCase() : null);
    navigator.storage?.persist?.().catch(() => {}); // browser jagah bachane ke liye key delete na kare
    login(token, s);
    nav('/app', { replace: true });
  };

  const doLogin = async (p = pin) => {
    if (p.length !== 4) return setErr('4 numbers ka PIN daalein');
    setErr(''); setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { key, pin: p } });
      finish(r.token, r.store);
    } catch (e) {
      setErr(e.message); setPin('');
      if (e.status === 409) checkKey(key); // PIN abhi bana nahi: PIN banane wali screen
    } finally { setBusy(false); }
  };

  const doSetPin = async (p2 = pin2) => {
    if (pin.length !== 4) return setErr('4 numbers ka PIN daalein');
    if (p2 !== pin) { setErr('Dono PIN ek jaise nahi. Dobara likhein.'); setPin2(''); return; }
    setErr(''); setBusy(true);
    try {
      const r = await api('/auth/set-pin', { method: 'POST', body: { key, pin } });
      finish(r.token, r.store);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (loggedIn) return <Navigate to="/app" replace />;
  if (loading) return <div className="center"><Spinner /></div>; // session check ho raha hai

  const otherKey = () => { storage.setLicenseKey(null); setStore(null); setStep('key'); setKey(''); setErr(''); };

  return (
    <div className="auth">
      <div className="auth-l">
        <div className="brand" style={{ color: '#fff' }}><TyposLogo size={42} />TYPOS</div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <img src="/typos-logo.png" alt="TYPOS" style={{ width: 150, borderRadius: 26, marginBottom: 24, boxShadow: '0 20px 40px rgba(0,0,0,.25)' }} />
          <h2>Key ek dafa. Phir sirf 4&#8209;digit PIN.</h2>
          <p style={{ opacity: 0.85, marginTop: 14, maxWidth: 420, fontSize: 15 }}>Pehli dafa license key daal kar apna PIN banayein. Agli dafa se app kholte hi sirf PIN.</p>
        </div>
        <div className="glass"><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="key" /><b style={{ fontSize: 13.5 }}>Key khatam hone se 7 din pehle reminder aata hai</b></div></div>
      </div>

      <div className="auth-r"><div className="auth-c">
        <h3 style={{ fontSize: 26, letterSpacing: '-.02em' }}>{step === 'setpin' || step === 'confirm' ? 'Apna PIN banayein' : 'Login'}</h3>
        <p className="t2" style={{ marginTop: 4 }}>
          {step === 'key' && 'License key daalein (admin se mili hai)'}
          {step === 'pin' && 'Apna 4-digit PIN daalein'}
          {step === 'setpin' && 'Pehli dafa — 4 numbers ka PIN chunein'}
          {step === 'confirm' && 'Wohi PIN dobara likhein'}
        </p>

        {step === 'key' ? (
          <form onSubmit={(e) => { e.preventDefault(); checkKey(); }} style={{ marginTop: 24 }}>
            <label className="lbl">License key</label>
            <input className="inp mono" autoFocus placeholder="TYPS-XXXX-XXXX-XXXX" value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              style={{ height: 48, letterSpacing: '.08em', fontSize: 15 }} />
            {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
            <button className="btn btn-pr btn-lg w100" style={{ marginTop: 18 }} disabled={busy || key.length < 8}>{busy ? <Spinner /> : 'Aage'}</button>
          </form>
        ) : (
          <div style={{ marginTop: 20 }}>
            {store && (
              <div className="found">
                <StoreLogo store={store} />
                <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 14, display: 'block' }}>{store.name}</b>
                  <small className="t2" style={{ fontSize: 12.5 }}>{store.plan === 'yearly' ? 'Yearly' : 'Monthly'} · {dateOnly(store.expires_at)} tak</small></div>
                <span className="badge b-gr"><Icon name="check" className="ic-sm" style={{ width: 12 }} />Valid</span>
              </div>
            )}
            {step === 'pin' && (
              <>
                <label className="lbl">4-digit PIN</label>
                <PinBoxes value={pin} onChange={setPin} onDone={doLogin} autoFocus />
                {err && <div className="err" style={{ margin: '10px 0' }}>{err}</div>}
                <button className="btn btn-pr btn-lg w100" style={{ marginTop: 14 }} disabled={busy || pin.length !== 4} onClick={() => doLogin()}>{busy ? <Spinner /> : 'Login'}</button>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 14, textAlign: 'center' }}>PIN bhool gaye? Admin se PIN reset karwayein.</p>
              </>
            )}
            {step === 'setpin' && (
              <>
                <label className="lbl">Naya PIN</label>
                <PinBoxes value={pin} onChange={setPin} onDone={() => { setErr(''); setStep('confirm'); }} autoFocus />
                {err && <div className="err" style={{ margin: '10px 0' }}>{err}</div>}
                <button className="btn btn-pr btn-lg w100" style={{ marginTop: 14 }} disabled={pin.length !== 4} onClick={() => setStep('confirm')}>Aage</button>
              </>
            )}
            {step === 'confirm' && (
              <>
                <label className="lbl">PIN dobara</label>
                <PinBoxes key="c" value={pin2} onChange={setPin2} onDone={doSetPin} autoFocus />
                {err && <div className="err" style={{ margin: '10px 0' }}>{err}</div>}
                <button className="btn btn-pr btn-lg w100" style={{ marginTop: 14 }} disabled={busy || pin2.length !== 4} onClick={() => doSetPin()}>{busy ? <Spinner /> : 'PIN save karein'}</button>
                <button className="btn btn-gh w100" style={{ marginTop: 8 }} onClick={() => { setStep('setpin'); setPin(''); setPin2(''); setErr(''); }}>Wapas</button>
              </>
            )}
            <button className="btn btn-gh w100" style={{ marginTop: 6 }} onClick={otherKey}>Doosri license key</button>
          </div>
        )}
      </div></div>
    </div>
  );
}
