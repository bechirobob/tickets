"use client";

import Link from "next/link";
import { CheckCircle2, CloudOff, Keyboard, ScanLine, Search, Signal, Users, XCircle } from "lucide-react";
import { useState } from "react";

export default function Scanner() {
  const [mode, setMode] = useState<"ready" | "valid" | "invalid">("ready");
  const [code, setCode] = useState("");
  function checkTicket() { setMode(code.trim().length > 5 ? "valid" : "invalid"); }
  return (
    <main className="scanner-page">
      <header className="scanner-header"><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Gate</span></Link><div><Signal size={15} /> Online · Gate A</div></header>
      <div className="scanner-event"><div><small>Now scanning</small><h1>After Dark: Osu</h1><p>Friday, 21 August · The Treehouse</p></div><button>Change event</button></div>
      <section className={`scan-surface scan-surface--${mode}`}>
        {mode === "ready" && <><div className="scan-frame"><i /><i /><i /><i /><ScanLine size={76} /></div><h2>Position QR code inside the frame</h2><p>The ticket will scan automatically</p></>}
        {mode === "valid" && <><CheckCircle2 size={92} /><h2>Ticket valid</h2><strong>General admission · 1 guest</strong><p>Akosua Mensah · Entry recorded at 10:34 PM</p><button onClick={() => { setMode("ready"); setCode(""); }}>Scan next ticket</button></>}
        {mode === "invalid" && <><XCircle size={92} /><h2>Ticket not recognised</h2><strong>Check the code and try again</strong><p>No entry was recorded.</p><button onClick={() => setMode("ready")}>Try again</button></>}
      </section>
      <section className="manual-entry"><div><Keyboard size={19} /><span><strong>Enter ticket code</strong><small>Use when the camera cannot read the QR</small></span></div><label><Search size={17} /><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. AD-84K2P9" /><button onClick={checkTicket}>Check</button></label></section>
      <footer className="scanner-stats"><span><Users size={17} /><b>182</b> checked in</span><span><CloudOff size={17} /><b>0</b> awaiting sync</span><span><b>30%</b> capacity</span></footer>
    </main>
  );
}
