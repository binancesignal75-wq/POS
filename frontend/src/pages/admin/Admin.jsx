/**
 * Super Admin — store + logo + license key (monthly / yearly). Bas.
 */
import { useEffect, useRef, useState } from 'react';
import { api, storage, asset } from '../../api';
import { useUi } from '../../context/UiContext';
import Icon from '../../components/Icon';
import Modal from '../../components/Modal';
import { StoreLogo, TyposLogo, Seg, Spinner, Field, RowMenu, Empty } from '../../components/ui';
import { dateOnly, initials } from '../../utils/format';

function AdminLogin({ onDone }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pin.length !== 6) { setErr('6 digit PIN likhein'); return; }
    setBusy(true); setErr('');
    try { const r = await api('/admin/login', { method: 'POST', body: { pin }, admin: true }); storage.setAdminToken(r.token); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b2530', padding: 20 }}>
      <form className="card" style={{ width: 380, padding: 28 }} onSubmit={submit}>
        <img src="/typos-logo.png" alt="TYPOS" style={{ width: 110, borderRadius: 22, display: 'block', margin: '0 auto 16px' }} />
        <h3 style={{ textAlign: 'center', fontSize: 20 }}>Super Admin</h3>
        <p className="t2" style={{ textAlign: 'center', marginBottom: 20 }}>Stores aur license keys</p>
        <Field label="Admin PIN (6 digit)">
          <input className="inp" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6}
            style={{ textAlign: 'center', fontSize: 22, letterSpacing: 10 }}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
        <button className="btn btn-pr btn-lg w100" style={{ marginTop: 18 }} disabled={busy}>{busy ? <Spinner /> : 'Login'}</button>
      </form>
    </div>
  );
}

function StoreModal({ store, onClose, onSaved }) {
  const { toast } = useUi();
  const [f, setF] = useState({ name: store?.name || '', city: store?.city || '', phone: store?.phone || '', address: store?.address || '', plan: store?.plan || 'monthly' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(asset(store?.logo_url));
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const fileRef = useRef(null);

  const pick = (e) => {
    const fl = e.target.files[0];
    if (!fl) return;
    if (fl.size > 2 * 1024 * 1024) { toast('Logo 2MB se chhota ho', 'err'); return; }
    setFile(fl); setRemoveLogo(false); setPreview(URL.createObjectURL(fl));
  };

  const save = async () => {
    if (!f.name.trim()) { toast('Store ka naam likhein', 'err'); return; }
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    if (file) fd.append('logo', file);
    if (removeLogo) fd.append('remove_logo', '1');
    try {
      const r = await api(store ? `/admin/stores/${store.id}` : '/admin/stores', { method: store ? 'PUT' : 'POST', form: fd, admin: true });
      if (store) { toast('Store update ho gaya'); onSaved(); onClose(); }
      else { setCreated(r.store); onSaved(); }
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  if (created) {
    return (
      <Modal title="Store ban gaya" subtitle="Ye license key store ko bhejein. PIN store khud pehli login par banayega." onClose={onClose}
        footer={<button className="btn btn-pr" onClick={onClose}>Theek hai</button>}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}><StoreLogo store={created} size={48} /><div><b>{created.name}</b><div className="t2" style={{ fontSize: 13 }}>{created.city}</div></div></div>
        <div className="genkey on">
          <small style={{ color: '#94a3b8' }}>License key</small>
          <div className="mono" style={{ fontSize: 20, margin: '4px 0', letterSpacing: '.06em' }}>{created.license_key}</div>
          <small style={{ color: '#94a3b8' }}>{created.plan === 'yearly' ? 'Yearly' : 'Monthly'} · Expiry: {dateOnly(created.expires_at)}</small>
        </div>
        <button className="btn btn-sc w100" style={{ marginTop: 12 }} onClick={() => { navigator.clipboard?.writeText(created.license_key); toast('Key copy ho gayi'); }}><Icon name="copy" className="ic-sm" />Key copy karein</button>
      </Modal>
    );
  }

  return (
    <Modal title={store ? 'Store edit karein' : 'Naya store'} subtitle="Ye naam aur logo store ki app mein har jagah aayega — sidebar, bill, PDF" onClose={onClose}
      footer={<><button className="btn btn-sc" onClick={onClose}>Cancel</button><button className="btn btn-pr" onClick={save} disabled={busy}>{busy ? <Spinner /> : store ? 'Save' : <><Icon name="key" className="ic-sm" />Save &amp; key banayein</>}</button></>}>
      <div className="upl" onClick={() => fileRef.current.click()}>
        <div className="b-logo" style={{ background: preview ? '#fff' : undefined }}>{preview ? <img src={preview} alt="" /> : initials(f.name)}</div>
        <div><b style={{ fontSize: 13.5 }}>Logo upload karein</b><div className="t2" style={{ fontSize: 12.5 }}>PNG, JPG ya WEBP · 2MB tak · square behtar</div></div>
        <span className="btn btn-sc btn-sm" style={{ marginLeft: 'auto' }}><Icon name="upload" className="ic-sm" />Choose</span>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
      {preview && <button className="btn btn-gh btn-sm" style={{ marginTop: 6 }} onClick={() => { setFile(null); setPreview(null); setRemoveLogo(true); }}>Logo hatayein</button>}
      <div className="grid-form" style={{ marginTop: 14 }}>
        <Field label="Store ka naam *" style={{ gridColumn: '1/-1' }}><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Shehar"><input className="inp" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="Phone"><input className="inp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Address (bill par)" style={{ gridColumn: '1/-1' }}><input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      {!store && (
        <div style={{ marginTop: 14 }}><label className="lbl">Plan</label>
          <div className="plan2">
            {[['monthly', 'Monthly', '1 mahina'], ['yearly', 'Yearly', '1 saal']].map(([v, t, s]) => (
              <button key={v} className={f.plan === v ? 'on' : ''} onClick={() => setF({ ...f, plan: v })}><b>{t}</b><div className="t2" style={{ fontSize: 12 }}>{s}</div></button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function RenewModal({ store, onClose, onSaved }) {
  const { toast } = useUi();
  const [plan, setPlan] = useState(store.plan);
  const save = async () => {
    try { await api(`/admin/stores/${store.id}/renew`, { method: 'POST', body: { plan }, admin: true }); toast('License renew ho gaya'); onSaved(); onClose(); }
    catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="License renew" subtitle={`${store.name} · abhi expiry ${dateOnly(store.expires_at)}`} onClose={onClose} width={440}
      footer={<><button className="btn btn-sc" onClick={onClose}>Cancel</button><button className="btn btn-pr" onClick={save}>Renew karein</button></>}>
      <div className="plan2">
        {[['monthly', '+1 mahina'], ['yearly', '+1 saal']].map(([v, t]) => (
          <button key={v} className={plan === v ? 'on' : ''} onClick={() => setPlan(v)}><b>{v === 'yearly' ? 'Yearly' : 'Monthly'}</b><div className="t2" style={{ fontSize: 12 }}>{t}</div></button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Agar license abhi chal raha hai to purani expiry se aage barhega.</p>
    </Modal>
  );
}

function ApiKeyModal({ onClose }) {
  const { toast } = useUi();
  const [apiKey, setApiKey] = useState('');
  const [currentMasked, setCurrentMasked] = useState('');
  const [keysStatus, setKeysStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/admin/settings', { admin: true })
      .then((res) => {
        setApiKey(res.groq_api_key || '');
        setCurrentMasked(res.masked_key || '');
        setKeysStatus(res.keys_status || []);
      })
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, []);

  const checkLiveKeys = async (keysToCheck = apiKey) => {
    setChecking(true);
    try {
      const res = await api('/admin/settings/check-keys', {
        method: 'POST',
        body: { keys: keysToCheck },
        admin: true
      });
      setKeysStatus(res.keys_status || []);
      toast('API Keys status refresh ho gaya');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setChecking(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/admin/settings', {
        method: 'POST',
        body: { groq_api_key: apiKey },
        admin: true
      });
      toast(res.message || 'Groq API Key save ho gayi');
      setCurrentMasked(res.masked_key || '');
      setKeysStatus(res.keys_status || []);
      onClose();
    } catch (err) {
      toast(err.message, 'err');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Groq AI API Settings & Credit Limits"
      subtitle="Mobile camera se dawai scan karne ke liye Groq Vision API keys aur unka live quota / limit"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn btn-sc" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-pr" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : 'Save API Key'}
          </button>
        </>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}><Spinner /></div>
      ) : (
        <form onSubmit={save}>
          <div style={{ marginBottom: 16, background: '#f8fafc', padding: '12px 14px', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ fontSize: 12, color: '#64748b' }}>Active Key Summary:</span>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: '#0f172a', marginTop: 2, fontFamily: 'monospace' }}>
                {currentMasked || 'Koi key set nahi'}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sc btn-sm"
              onClick={() => checkLiveKeys(apiKey)}
              disabled={checking}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              {checking ? <Spinner /> : <Icon name="refresh" className="ic-sm" />}
              Check Live Status
            </button>
          </div>

          <Field label="Groq API Keys (gsk_...) — Ek ya comma / new line se multiple keys">
            <textarea
              className="inp mono"
              autoFocus
              rows={3}
              style={{ height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.5 }}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx, gsk_yyyyyyyyyyyyyyyyyyyyyyyyyyyy"
            />
          </Field>
          <p className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
            Groq console (<b>console.groq.com/keys</b>) se keys copy karein. Multiple keys comma (,) ya nayi line par daal sakte hain — agar ek key ki limit khatam ho to system automatically doosri key par switch ho jata hai.
          </p>

          {/* Individual Keys Live Credit Limit and Progress Bars */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#334155' }}>
                Configured Keys &amp; Credit Limits ({keysStatus.length}):
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Live Groq Rate Limits</span>
            </div>

            {keysStatus.length === 0 ? (
              <div style={{ padding: 14, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12.5, color: '#64748b', textAlign: 'center' }}>
                Key daal kar &quot;Check Live Status&quot; par click karein
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {keysStatus.map((k, idx) => {
                  const isRateLimited = k.status === 'rate_limited';
                  const isInvalid = k.status === 'invalid';
                  const pct = Math.max(0, Math.min(100, k.percent_requests_remaining ?? 100));
                  const barColor = isRateLimited || isInvalid || pct < 15 ? '#ef4444' : pct < 40 ? '#f59e0b' : '#22c55e';
                  const badgeBg = isRateLimited || isInvalid ? '#fef2f2' : '#f0fdf4';
                  const badgeBorder = isRateLimited || isInvalid ? '#fecaca' : '#bbf7d0';
                  const badgeText = isRateLimited || isInvalid ? '#991b1b' : '#166534';

                  return (
                    <div
                      key={k.key || idx}
                      style={{
                        padding: '12px 14px',
                        background: '#ffffff',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                      }}
                    >
                      {/* Key Top Row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 12, color: '#475569' }}>API Key #{idx + 1}:</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                            {k.masked_key}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: badgeBg,
                            border: `1px solid ${badgeBorder}`,
                            color: badgeText
                          }}
                        >
                          ● {k.statusText || (isRateLimited ? 'Limit Khatam' : isInvalid ? 'Invalid' : 'Active')}
                        </span>
                      </div>

                      {/* Visual Credit / Quota Progress Bar (Green line) */}
                      <div style={{ width: '100%', height: 7, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
                        <div
                          style={{
                            width: `${Math.max(2, pct)}%`,
                            height: '100%',
                            background: barColor,
                            transition: 'width 0.4s ease, background-color 0.4s ease'
                          }}
                        />
                      </div>

                      {/* Quota Details Below Progress Line */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5, color: '#64748b', flexWrap: 'wrap', gap: 6 }}>
                        <div>
                          <span>Credit Remaining: </span>
                          <b style={{ color: barColor }}>
                            {k.remaining_requests !== undefined ? `${k.remaining_requests} / ${k.limit_requests || 1000}` : '1000'} ({pct}%)
                          </b>
                          {k.used_requests > 0 && <span style={{ marginLeft: 6 }}>· Used: {k.used_requests}</span>}
                        </div>
                        <div>
                          {k.remaining_tokens !== undefined && (
                            <span style={{ marginRight: 8 }}>
                              Tokens: <b>{k.remaining_tokens.toLocaleString()}</b>
                            </span>
                          )}
                          {k.reset_requests && (
                            <span>Reset: <b>{k.reset_requests}</b></span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function Admin() {
  const { toast, confirm } = useUi();
  const [authed, setAuthed] = useState(!!storage.adminToken());
  const [stats, setStats] = useState(null);
  const [stores, setStores] = useState(null);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [renew, setRenew] = useState(null);
  const [apiModal, setApiModal] = useState(false);

  useEffect(() => {
    const h = () => setAuthed(false);
    window.addEventListener('typos:admin-logout', h);
    return () => window.removeEventListener('typos:admin-logout', h);
  }, []);

  const load = () => {
    api('/admin/stats', { admin: true }).then(setStats).catch(() => {});
    api('/admin/stores', { admin: true, query: { status, q } }).then((r) => setStores(r.stores)).catch((e) => toast(e.message, 'err'));
  };
  useEffect(() => { if (authed) load(); }, [authed, status]); // eslint-disable-line
  useEffect(() => { if (!authed) return undefined; const t = setTimeout(load, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line

  const handleSyncTp = async () => {
    try {
      const res = await api('/admin/sync-tp', { method: 'POST', admin: true });
      toast(res.message || 'Products TP sync ho gaya');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  if (!authed) return <AdminLogin onDone={() => setAuthed(true)} />;

  const act = async (s, path, msg, ask) => {
    if (ask && !(await confirm(ask))) return;
    try { await api(`/admin/stores/${s.id}/${path}`, { method: 'POST', admin: true }); toast(msg); load(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const badge = (s) => ({
    active: <span className="badge b-gr"><i />Active</span>,
    expiring: <span className="badge b-am"><i />{s.days_left} din</span>,
    expired: <span className="badge b-rd"><i />Expired</span>,
    inactive: <span className="badge b-gy"><i />Band</span>
  }[s.status]);

  return (
    <div className="app">
      <aside className="sidebar adm-side">
        <div className="brand" style={{ color: '#fff', padding: '6px 8px 18px' }}><TyposLogo size={36} />TYPOS <span className="badge" style={{ background: '#123845', color: '#94a3b8', borderColor: '#1e4a58' }}>Admin</span></div>
        <nav className="nav"><div className="nav-g">Manage</div><a className="nav-i on"><Icon name="store" />Stores &amp; Keys</a></nav>
        <div className="me" style={{ borderColor: '#123845' }}>
          <div className="av" style={{ background: '#123845', color: '#fff' }}>SA</div>
          <div style={{ flex: 1 }}><b style={{ fontSize: 13, color: '#fff', display: 'block' }}>Super admin</b><small style={{ color: '#64748b', fontSize: 12 }}>TYPOS</small></div>
          <button className="kebab" style={{ color: '#94a3b8' }} title="Logout" onClick={() => { storage.setAdminToken(null); setAuthed(false); }}><Icon name="logout" className="ic-sm" /></button>
        </div>
      </aside>
      <div className="main">
        <header className="header"><div className="crumb"><span>Super Admin</span><Icon name="right" className="ic-sm" /><b>Stores &amp; Keys</b></div>
          <div className="hd-r">
            <button className="btn btn-sc" onClick={() => { load(); toast('Stores refresh ho gaye'); }}><Icon name="refresh" className="ic-sm" />Refresh</button>
            <button className="btn btn-sc" onClick={handleSyncTp} title="Existing products ka TP naye sequential discount formula se sync karein"><Icon name="tag" className="ic-sm" />Sync Products TP</button>
            <button className="btn btn-sc" onClick={() => setApiModal(true)}><Icon name="gear" className="ic-sm" />Groq AI Key</button>
            <button className="btn btn-pr" onClick={() => setModal({})}><Icon name="plus" className="ic-sm" />Naya store</button>
          </div></header>
        <div className="page">
          <div className="ph"><div><h1>Stores &amp; License Keys</h1><p>Store ka naam, logo, license key aur expiry — bas itna hi</p></div></div>
          <div className="stats">
            {[['Total stores', stats?.total], ['Active', stats?.active, 'var(--pr-d)'], ['7 din mein expire', stats?.expiring, '#b45309'], ['Expired', stats?.expired, 'var(--rd)']].map(([l, v, c]) => (
              <div className="card stat" key={l}><div className="l" style={{ margin: 0 }}>{l}</div><div className="v" style={{ color: c }}>{v ?? '…'}</div></div>
            ))}
          </div>
          <div className="card tbl-card" style={{ overflow: 'visible' }}>
            <div className="tbl-bar">
              <Seg value={status} onChange={setStatus} options={[{ value: 'all', label: 'Sab' }, { value: 'active', label: 'Active' }, { value: 'expiring', label: 'Expire hone wale' }, { value: 'expired', label: 'Expired' }, { value: 'inactive', label: 'Band' }]} />
              <div className="tsearch"><Icon name="search" className="ic-sm" /><input placeholder="Store, shehar ya key…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            </div>
            {!stores ? <div className="empty"><Spinner /></div> : stores.length === 0 ? <Empty title="Koi store nahi" text="Naya store bana kar key dein"><button className="btn btn-pr" onClick={() => setModal({})}><Icon name="plus" className="ic-sm" />Naya store</button></Empty> : (
              <table>
                <thead><tr><th>Store</th><th>License key</th><th>Plan</th><th>Expiry</th><th>PIN</th><th>Status</th><th className="r">Actions</th></tr></thead>
                <tbody>{stores.map((s) => (
                  <tr key={s.id}>
                    <td><div className="med"><StoreLogo store={s} /><div><b>{s.name}</b><small>{s.city || '—'}</small></div></div></td>
                    <td><span className="key-chip copy" title="Copy" onClick={() => { navigator.clipboard?.writeText(s.license_key); toast('Key copy ho gayi'); }}>{s.license_key}</span></td>
                    <td>{s.plan === 'yearly' ? 'Yearly' : 'Monthly'}</td>
                    <td>{dateOnly(s.expires_at)}</td>
                    <td>{s.has_pin ? <span className="badge b-gr">Bana hua</span> : <span className="badge b-gy">Abhi nahi</span>}</td>
                    <td>{badge(s)}</td>
                    <td className="r"><div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <button className="btn btn-sc btn-sm" onClick={() => setRenew(s)}>Renew</button>
                      <RowMenu items={[
                        { label: 'Naam / logo edit', icon: 'edit', onClick: () => setModal(s) },
                        { label: 'PIN reset', icon: 'lock', onClick: () => act(s, 'reset-pin', 'PIN reset — store naya PIN banayega', { title: 'PIN reset karein?', text: `${s.name} agli login par naya PIN banayega.` }) },
                        { label: 'Nayi key banayein', icon: 'key', onClick: () => act(s, 'regenerate-key', 'Nayi key ban gayi', { title: 'Nayi key?', text: 'Purani key foran band ho jayegi aur sab phones hat jayenge.', danger: true, okText: 'Nayi key' }) },
                        { label: s.is_active ? 'Store band karein' : 'Store chalu karein', icon: 'power', danger: s.is_active, onClick: () => act(s, 'toggle', s.is_active ? 'Store band' : 'Store chalu', s.is_active ? { title: 'Store band karein?', text: `${s.name} login nahi kar sakega.`, danger: true, okText: 'Band karein' } : null) }
                      ]} />
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {modal && <StoreModal store={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={load} />}
      {renew && <RenewModal store={renew} onClose={() => setRenew(null)} onSaved={load} />}
      {apiModal && <ApiKeyModal onClose={() => setApiModal(false)} />}
    </div>
  );
}
