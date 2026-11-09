import { useEffect, useState } from 'react';
import { api, storage } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUi } from '../context/UiContext';
import { useScanner } from '../context/ScannerContext';
import Icon from '../components/Icon';
import PairCard from '../components/PairCard';
import { StoreLogo, Field } from '../components/ui';
import { dateOnly, dateTime } from '../utils/format';

export default function Settings() {
  const { store, logout } = useAuth();
  const { toast, confirm } = useUi();
  const { devices: online } = useScanner();
  const [devices, setDevices] = useState([]);
  const [pin, setPin] = useState({ old_pin: '', new_pin: '' });

  const load = () => api('/pair/devices').then((r) => setDevices(r.devices)).catch(() => {});
  useEffect(() => { load(); }, [online.length]);

  const remove = async (d) => {
    if (!(await confirm({ title: 'Phone hatayein?', text: `"${d.name}" ab scan nahi kar sakega. Dobara jorne ke liye QR scan karna hoga.`, okText: 'Hatayein', danger: true }))) return;
    await api(`/pair/devices/${d.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'err'));
    load();
  };

  const changePin = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/change-pin', { method: 'POST', body: pin });
      storage.setToken(r.token);
      setPin({ old_pin: '', new_pin: '' });
      toast('PIN badal gaya');
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="ph"><div><h1>Phone &amp; Settings</h1><p>Scanner phone jorein, PIN badlein, license dekhein</p></div>
        <div className="acts"><button className="btn btn-sc" onClick={logout}><Icon name="logout" className="ic-sm" />Logout</button></div></div>
      <div className="ap">
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card">
            <div className="c-h"><h3>Store</h3><span className="badge b-gy">Naam aur logo admin badalta hai</span></div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 18 }}>
              <StoreLogo store={store} size={64} />
              <div><b style={{ fontSize: 17 }}>{store.name}</b>
                <div className="t2" style={{ fontSize: 13 }}>{[store.address, store.city, store.phone].filter(Boolean).join(' · ') || '—'}</div>
                <div style={{ marginTop: 6 }}><span className="badge b-gr"><i />{store.plan === 'yearly' ? 'Yearly' : 'Monthly'} · {store.days_left} din baqi · {dateOnly(store.expires_at)}</span></div></div>
            </div>
          </div>
          <div className="card tbl-card">
            <div className="tbl-bar"><div className="tt">Jure hue phones <span className="badge b-gy">{devices.length}</span></div></div>
            {devices.length === 0 ? <div className="empty"><b>Koi phone nahi</b>Daayen taraf wala QR scan karein</div> : (
              <table>
                <thead><tr><th>Phone</th><th>Status</th><th>Aakhri dafa</th><th /></tr></thead>
                <tbody>{devices.map((d) => (
                  <tr key={d.id}>
                    <td><div className="med"><div className="mi f-tab"><Icon name="phone" className="ic-sm" /></div><b>{d.name}</b></div></td>
                    <td>{d.online || online.some((o) => o.id === d.id) ? <span className="badge b-gr"><i />Online</span> : <span className="badge b-gy">Offline</span>}</td>
                    <td>{dateTime(d.last_seen)}</td>
                    <td className="r"><button className="btn btn-dg btn-sm" onClick={() => remove(d)}>Hatayein</button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <form className="card" onSubmit={changePin}>
            <div className="c-h"><h3>PIN badlein</h3></div>
            <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
              <Field label="Purana PIN"><input className="inp" type="password" inputMode="numeric" maxLength={4} value={pin.old_pin} onChange={(e) => setPin({ ...pin, old_pin: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Naya PIN"><input className="inp" type="password" inputMode="numeric" maxLength={4} value={pin.new_pin} onChange={(e) => setPin({ ...pin, new_pin: e.target.value.replace(/\D/g, '') })} /></Field>
              <button className="btn btn-pr" disabled={pin.old_pin.length !== 4 || pin.new_pin.length !== 4}>Save</button>
            </div>
          </form>
        </div>
        <PairCard />
      </div>
    </>
  );
}
