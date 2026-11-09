/**
 * "Mobile app install" button.
 * Android: browser ka asal install dialog. iPhone: Apple sirf Share menu se install karne deta hai, is liye steps.
 * Computer se dabayein to phone ke liye QR.
 */
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from './Icon';
import Modal from './Modal';
import { canPrompt, isInstalled, onInstallChange, platform, promptInstall } from '../utils/install';

const STEPS = {
  ios: ['Safari mein ye page kholein', 'Neeche Share button dabayein (dabba aur upar teer)', '"Add to Home Screen" chunein', 'Upar "Add" dabayein. TYPOS icon home screen par aa jayega'],
  android: ['Browser ke upar ⋮ menu dabayein', '"Install app" ya "Add to Home screen" chunein', '"Install" dabayein. TYPOS icon home screen par aa jayega']
};

export default function InstallApp({ className = 'btn btn-pr btn-lg', label = 'Mobile app install' }) {
  const [, refresh] = useState(0);
  const [guide, setGuide] = useState(false);
  useEffect(() => onInstallChange(() => refresh((n) => n + 1)), []);

  if (isInstalled()) return null;

  const click = async () => {
    if (canPrompt()) { await promptInstall(); return; }
    setGuide(true);
  };

  const os = platform();
  return (
    <>
      <button type="button" className={className} onClick={click}><Icon name="phone" />{label}</button>
      {guide && (
        <Modal title="TYPOS app install karein" subtitle={os === 'desktop' ? 'Ye app phone ke liye hai' : 'Play Store ki zaroorat nahi, 2 taps ka kaam hai'} onClose={() => setGuide(false)} width={420}>
          {os === 'desktop' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'inline-block', padding: 10, background: '#fff', border: '1px solid var(--bd)', borderRadius: 12 }}><QRCodeSVG value={`${location.origin}/scan`} size={150} /></div>
              <p className="t2" style={{ marginTop: 12, fontSize: 13.5 }}>Phone ke camera se ye QR scan karein, phir wahan "Mobile app install" dabayein</p>
            </div>
          ) : (
            STEPS[os].map((s, i) => <div className="step" key={s}><b>{i + 1}</b>{s}</div>)
          )}
        </Modal>
      )}
    </>
  );
}
