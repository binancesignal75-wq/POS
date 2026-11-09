import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import InstallApp from '../components/InstallApp';

const WIN_URL = '/downloads/TYPOS-Setup.exe';

const FEATURES = [
  ['text', 'var(--pr)', 'Dabbi se naam aur MG', 'Dabbi phone camera ke aage rokein — AI naam, MG, pack, MRP aur expiry parh kar counter ka form khud bhar deta hai.'],
  ['scan', 'var(--bl)', 'Barcode se sale', 'Ek dafa code link karein, agli dafa scan karte hi dawai bill mein. Code na ho to naam se search.'],
  ['pdf', 'var(--rd)', 'Low stock PDF', 'Khatam hone wali dawaiyon ki list dukan ke logo ke saath PDF mein — seedha distributor ko bhejein.'],
  ['calc', 'var(--vi)', 'TP aur profit hisaab', 'MRP, TP %, distributor discount aur bonus scheme se asal cost aur munafa khud nikal aata hai.'],
  ['cal', 'var(--am)', 'Har mahine ka record', 'Mahina khatam, dashboard 0 se shuru — aur pichle mahine ki sale, profit aur stock ka card mehfooz.'],
  ['receipt', 'var(--pr)', 'Logo wali receipt', '80mm thermal printer par aapki dukan ke naam aur logo ke saath bill.']
];

export default function Landing() {
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <div className="lp">
      <div className="lp-nav">
        <div className="brand"><img className="lp-logo" src="/typos-mark.png" alt="" />TYPOS</div>
        <nav><a href="#feat" onClick={(e) => { e.preventDefault(); jump('feat'); }}>Features</a><a href="#dl" onClick={(e) => { e.preventDefault(); jump('dl'); }}>Download</a><a href="#price" onClick={(e) => { e.preventDefault(); jump('price'); }}>Pricing</a></nav>
        <div style={{ display: 'flex', gap: 8 }}><Link className="btn btn-gh" to="/login">Login</Link><button className="btn btn-pr" onClick={() => jump('dl')}>Download</button></div>
      </div>

      <div className="hero">
        <img className="hero-logo" src="/typos-logo.png" alt="TYPOS Medical Store POS" />
        <div className="eyebrow"><span>Naya</span>Mobile se dawai ka naam scan karein</div>
        <h1>Medical store ka <em>smart POS</em> — scan karo, becho, hisaab khud.</h1>
        <p>Barcode aur dawai ka naam phone se scan, TP aur profit ka automatic hisaab, low stock PDF aur har mahine ka record — Windows, Android aur iPhone par.</p>
        <div className="hero-cta">
          <a className="btn btn-pr btn-lg" href={WIN_URL}><Icon name="win" />Windows ke liye download</a>
          <InstallApp className="btn btn-sc btn-lg" />
        </div>
      </div>

      <div className="features" id="feat">
        <div className="sec-h"><small>Features</small><h2>Jo medical store ko asal mein chahiye</h2><p>Kam typing, zyada automatic. Har cheez aapki dukan ke naam aur logo ke saath.</p></div>
        <div className="fgrid3">
          {FEATURES.map(([ic, c, t, d]) => (
            <div className="fcard" key={t}><div className="fi" style={{ color: c }}><Icon name={ic} /></div><h3>{t}</h3><p>{d}</p></div>
          ))}
        </div>
      </div>

      <div className="dl" id="dl">
        <div className="dl-box">
          <div>
            <img src="/typos-mark.png" alt="" style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 18, position: 'relative' }} />
            <h2>Apne counter aur phone par install karein</h2>
            <p>Desktop app billing ke liye, mobile app scanning ke liye. Phone Android ho ya iPhone, QR se counter se jur jata hai.</p>
          </div>
          <div>
            <a className="dlb" href={WIN_URL}><span className="di" style={{ color: '#0078d4' }}><Icon name="win" style={{ width: 24, height: 24 }} /></span><span><small>Desktop · Windows 10 / 11</small><b>Download for Windows</b></span><span className="dl-tag">.exe</span></a>
            <div className="dlb-install"><InstallApp className="btn btn-pr btn-lg w100" /></div>
            <Link className="dlb" to="/login"><span className="di" style={{ color: 'var(--pr)' }}><Icon name="key" style={{ width: 22, height: 22 }} /></span><span><small>Mobile & Desktop</small><b>Web par Full POS Login</b></span><span className="dl-tag">→</span></Link>
            <Link className="dlb" to="/scan"><span className="di" style={{ color: '#0284c7' }}><Icon name="scan" style={{ width: 22, height: 22 }} /></span><span><small>Instant Camera</small><b>Mobile Web Scanner</b></span><span className="dl-tag">⚡</span></Link>
          </div>
        </div>
      </div>

      <div className="pricing" id="price">
        <div className="price"><b className="t2">Monthly</b><div className="amt">Rs 1,500</div><small className="muted">har mahine</small>
          <ul><li>1 store, unlimited dawaiyan</li><li>Windows + mobile app</li><li>Low stock PDF, monthly records</li></ul>
          <a className="btn btn-sc w100 btn-lg" href="#dl" onClick={(e) => { e.preventDefault(); jump('dl'); }}>Shuru karein</a></div>
        <div className="price pop"><div style={{ display: 'flex', justifyContent: 'space-between' }}><b className="t2">Yearly</b><span className="badge b-gr">2 mahine free</span></div><div className="amt">Rs 15,000</div><small className="muted">har saal</small>
          <ul><li>Monthly ki saari cheezein</li><li>Priority support</li><li>Dukan ka logo har jagah</li></ul>
          <a className="btn btn-pr w100 btn-lg" href="#dl" onClick={(e) => { e.preventDefault(); jump('dl'); }}>Shuru karein</a></div>
      </div>
      <div className="foot">© {new Date().getFullYear()} TYPOS — Medical Store POS</div>
    </div>
  );
}
