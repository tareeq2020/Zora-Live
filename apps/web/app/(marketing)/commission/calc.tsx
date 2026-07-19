'use client';

/* Commission "quick calculator" from public/commission.html — the only
   interactive part of the page (the legacy inline <script>). Gross/fee/net are
   derived from the two inputs; formatting matches Intl.NumberFormat('en-US'). */

import { useState } from 'react';

const nf = new Intl.NumberFormat('en-US');

export function Calc() {
  const [price, setPrice] = useState('50000');
  const [qty, setQty] = useState('500');

  const p = Math.max(0, parseFloat(price) || 0);
  const q = Math.max(0, parseInt(qty) || 0);
  const gross = p * q;
  const fee = Math.round(gross * 0.05);
  const net = gross - fee;

  return (
    <div className="calc">
      <p className="kicker" style={{ marginBottom: 20 }}>QUICK CALCULATOR</p>
      <div className="calc-grid">
        <div>
          <label>TICKET PRICE (TZS)</label>
          <input id="c-price" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label>TICKETS SOLD</label>
          <input id="c-qty" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
      </div>
      <div className="calc-out">
        <div className="co"><p className="col">GROSS SALES</p><p className="cov mono" id="o-gross">{nf.format(gross)} TZS</p></div>
        <div className="co zora"><p className="col">ZORA 5%</p><p className="cov mono" id="o-fee">−{nf.format(fee)} TZS</p></div>
        <div className="co net"><p className="col">YOUR NET</p><p className="cov mono" id="o-net">{nf.format(net)} TZS</p></div>
      </div>
    </div>
  );
}
