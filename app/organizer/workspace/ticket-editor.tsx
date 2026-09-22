'use client';
import { useState } from 'react';
import { Message, money, useMutation, apiUrl, type Tier } from './suite-shared';

export default function TicketEditor({ event, tiers, onSaved }: { event: string; tiers?: Tier[]; onSaved: () => void }) {
  const [editing, setEditing] = useState<Tier | 'new' | null>(null), mutation = useMutation(), [reloading,setReloading] = useState(false);
  const tier = editing && editing !== 'new' ? editing : null;
  return <>
    <div className="suite-rows">{tiers?.map(t => <article key={t.id}><div><b>{t.name}</b><p>{money(t.priceMinor)} · {t.admissionsPerUnit} admissions per package · {t.status}</p><small>{t.allocated} / {t.capacity} allocated · {Math.max(0,t.capacity-t.allocated)} available</small></div><button disabled={mutation.busy} onClick={() => { setEditing(t); mutation.setMessage(''); }}>Edit <span className="sr-only">{t.name}</span></button></article>)}</div>
    {tiers ? <div className="suite-actions"><button disabled={mutation.busy || tiers.length >= 12} onClick={() => { setEditing('new'); mutation.setMessage(''); }}>Add ticket grade</button><button disabled={mutation.busy} onClick={onSaved}>Refresh allocations</button></div> : null}
    {editing ? <form className="suite-detail" aria-label="Edit ticket grade" key={tier ? `${tier.id}:${tier.updatedAt}` : 'new'} onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget);
      const saved = await mutation.mutate({ action: 'ticket_save', eventSlug: event, id: tier?.id, updatedAt: tier?.updatedAt, code: form.get('code'), name: form.get('name'), description: form.get('description'), priceMinor: Math.round(Number(form.get('price')) * 100), capacity: Number(form.get('capacity')), admissionsPerUnit: tier?.hasHistory ? tier.admissionsPerUnit : Number(form.get('admissions')), maxUnitsPerOrder: Number(form.get('limit')), status: form.get('status'), roomBadge: tier?.hasHistory ? tier.roomBadge : form.get('badge') || null });
      if (saved) { setEditing(null); onSaved(); }
    }}>
      <header><div><h3>{tier ? `Edit ${tier.name}` : 'Add ticket grade'}</h3><p className="suite-note">Prices apply to new bookings. Issued passes and active checkout totals stay unchanged.</p></div></header>
      <div className="suite-form-grid">
        <label>Ticket grade / name<input name="name" defaultValue={tier?.name} maxLength={80} required/></label>
        {!tier ? <label>Code<input name="code" maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="early-bird" required/><small>A permanent code for this grade.</small></label> : null}
        <label>Price per package (GH₵)<input name="price" type="number" min={0} max={1000000} step="0.01" defaultValue={tier ? tier.priceMinor / 100 : ''} required/></label>
        <label>Total admission allocation<input name="capacity" type="number" min={Math.max(tier?.allocated ?? 0,tier?.admissionsPerUnit ?? 1)} max={100000} defaultValue={tier?.capacity} required/><small>{tier?.allocated ?? 0} issued or held. This is the total limit, including these admissions.</small></label>
        <label>Admissions per package<input name="admissions" type="number" min={1} max={20} defaultValue={tier?.admissionsPerUnit ?? 1} disabled={Boolean(tier?.hasHistory)} required/></label>
        <label>Packages per order<input name="limit" type="number" min={1} max={20} defaultValue={tier?.maxUnitsPerOrder ?? 10} required/></label>
        <label>Availability<select name="status" defaultValue={tier?.status ?? 'available'}><option value="available">Available</option><option value="sold_out">Pause sales</option><option value="hidden">Hidden</option></select></label>
        <label>Room grade<select name="badge" defaultValue={tier?.roomBadge ?? ''} disabled={Boolean(tier?.hasHistory)}><option value="">Standard</option><option value="VIP">VIP badge & concierge</option></select></label>
      </div>
      <label>Description<input name="description" defaultValue={tier?.description} maxLength={240} required/></label>
      {tier?.hasHistory ? <p className="suite-note">This grade has booking history. To change package size or Room access, add a new grade and pause sales on this one.</p> : null}
      <div className="suite-actions"><button disabled={mutation.busy || reloading}>{mutation.busy ? 'Saving…' : 'Save ticket grade'}</button><button type="button" disabled={mutation.busy || reloading} onClick={() => setEditing(null)}>Cancel</button>{tier ? <button type="button" disabled={mutation.busy || reloading} onClick={async()=>{
        setReloading(true);
        try { const response=await fetch(apiUrl('tickets',event),{cache:'no-store'});const data=await response.json() as {tiers?:Tier[];error?:string};if(!response.ok)throw new Error(data.error??'Could not reload.');const saved=data.tiers?.find(x=>x.id===tier.id);if(!saved)throw new Error('This grade is no longer available.');setEditing(saved);onSaved();mutation.setMessage('Loaded the latest saved values.'); }
        catch(error){mutation.setMessage(error instanceof Error?error.message:'Could not reload. Your draft is still here.');}finally{setReloading(false);}
      }}>{reloading?'Reloading…':'Reload saved grade'}</button> : null}</div>
    </form> : null}
    <Message>{mutation.message}</Message>
  </>;
}
