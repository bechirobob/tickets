import Image from 'next/image';
import { Coins } from 'lucide-react';

const methods = [
  { file: 'mtn-momo', label: 'MTN MoMo', width: 38 },
  { file: 'telecel-cash', label: 'Telecel Cash (formerly Vodafone Cash)', width: 38 },
  { file: 'at-money', label: 'AT Money (formerly AirtelTigo Money)', width: 38 },
  { file: 'visa', label: 'Visa', width: 48 },
  { file: 'mastercard', label: 'Mastercard', width: 44 },
];

export default function PaymentFooter() {
  return <section className="payment-footer" aria-label="Payments">
    <div className="payment-footer__group">
      <h2>Payment providers</h2>
      <ul className="payment-footer__providers" aria-label="Payment providers">
        <li><Image src="/payment-providers/seev-white.png" alt="Seev" width={113} height={22} unoptimized /></li>
        <li><Image className="payment-footer__paystack" src="/payment-providers/paystack.svg" alt="Paystack" width={112} height={20} unoptimized /></li>
      </ul>
    </div>
    <div className="payment-footer__group">
      <h2>Accepted payment methods</h2>
      <div className="payment-footer__methods-row">
        <ul className="payment-footer__methods" aria-label="Accepted payment methods">
          {methods.map(method => <li key={method.file} title={method.label}><Image className={method.file === 'visa' ? 'payment-footer__visa' : undefined} src={`/payment-providers/${method.file}.svg`} alt={method.label} width={method.width} height={38} unoptimized /></li>)}
        </ul>
        <p className="payment-footer__crypto"><Coins size={27} strokeWidth={1.5} aria-hidden="true" /><span>Crypto<small>Coming soon</small></span></p>
      </div>
    </div>
  </section>;
}
