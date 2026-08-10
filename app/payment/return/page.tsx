import Link from "next/link";
import { Clock3, ShieldCheck } from "lucide-react";

export default function PaymentReturn() {
  return <main className="payment-return"><div><Clock3 size={45} /><p className="eyebrow">Your MoMo prompt did its thing</p><h1>We’re making sure the money really arrived.</h1><p>Keep this page open for a moment. We issue the ticket only after Paystack confirms payment—because optimism is lovely, but it is not a receipt.</p><Link href="/tickets">Check the ticket wallet</Link><span><ShieldCheck size={15} /> The browser saying “success” does not get the final vote.</span></div></main>;
}
