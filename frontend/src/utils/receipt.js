/**
 * 80mm thermal receipt — dukan ke logo ke saath
 * Electron aur browser dono mein window.print() se chalta hai.
 */
import { asset } from '../api';
import { dateTime, PAYMENTS, initials } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => (Number(v) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function receiptHtml(store, sale, items) {
  const logo = asset(store.logo_url);
  const abs = logo && !/^https?:/.test(logo) ? new URL(logo, window.location.href).href : logo;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${sale.bill_no}</title>
<style>
@page{size:80mm auto;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{width:80mm;padding:4mm 4mm 8mm;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#000}
.c{text-align:center}.logo{width:52px;height:52px;object-fit:contain;margin:0 auto 4px;display:block}
.ini{width:46px;height:46px;border:2px solid #000;border-radius:10px;margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px}
h1{font-size:16px;margin-bottom:2px}.sm{font-size:10.5px}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}
.r{text-align:right}.b{font-weight:700}.tot td{font-size:15px;font-weight:800;padding-top:4px}
</style></head><body>
<div class="c">${abs ? `<img class="logo" src="${esc(abs)}">` : `<div class="ini">${esc(initials(store.name))}</div>`}
<h1>${esc(store.name)}</h1>
${store.address || store.city ? `<div class="sm">${esc([store.address, store.city].filter(Boolean).join(', '))}</div>` : ''}
${store.phone ? `<div class="sm">Ph: ${esc(store.phone)}</div>` : ''}</div>
<hr><table><tr><td>Bill #${sale.bill_no}</td><td class="r">${esc(dateTime(sale.created_at))}</td></tr>
${sale.customer_name ? `<tr><td colspan="2">Customer: ${esc(sale.customer_name)}</td></tr>` : ''}</table><hr>
<table><tr class="b"><td>Item</td><td class="r">Qty</td><td class="r">Rate</td><td class="r">Total</td></tr>
${items.map((i) => `<tr><td>${esc(i.name)}${i.unit === 'strip' ? ' (Strip)' : ' (Box)'}</td><td class="r">${i.qty}</td><td class="r">${money(i.price)}</td><td class="r">${money(i.total)}</td></tr>`).join('')}
</table><hr><table>
<tr><td>Subtotal</td><td class="r">${money(sale.subtotal)}</td></tr>
${Number(sale.discount_pct) > 0 ? `<tr><td>Discount (${Number(sale.discount_pct)}%)</td><td class="r">-${money(sale.discount_amount || (sale.subtotal - sale.total))}</td></tr>` : ''}
<tr class="tot"><td>TOTAL</td><td class="r">Rs ${money(sale.total)}</td></tr>
<tr><td>${esc(PAYMENTS[sale.payment_method] || '')}${sale.payment_method === 'cash' ? ' diye' : ''}</td><td class="r">${sale.payment_method === 'cash' ? money(sale.paid) : ''}</td></tr>
${sale.payment_method === 'cash' && Number(sale.change_due) > 0 ? `<tr><td>Wapas</td><td class="r">${money(sale.change_due)}</td></tr>` : ''}
</table><hr>
<div class="c sm">Shukriya! Dobara tashreef laayein.<br>Dawai doctor ke mashwaray se istemal karein.</div>
<div class="c sm" style="margin-top:6px;color:#444">Powered by TYPOS POS</div>
</body></html>`;
}

export function printReceipt(store, sale, items) {
  const iframe = document.createElement('iframe');
  iframe.className = 'receipt-frame';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(receiptHtml(store, sale, items)); doc.close();
  const go = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch { /* ignore */ }
    setTimeout(() => iframe.remove(), 1500);
  };
  const imgs = [...doc.images];
  if (!imgs.length) return setTimeout(go, 50);
  let left = imgs.length;
  const done = () => { if (--left <= 0) go(); };
  imgs.forEach((im) => (im.complete ? done() : (im.onload = im.onerror = done)));
  setTimeout(() => { if (left > 0) { left = 0; go(); } }, 2500);
}
