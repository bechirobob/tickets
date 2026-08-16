type SkeletonKind = "events" | "detail" | "wallet" | "room" | "operations";

export default function LoadingSkeleton({ kind = "events", label = "Loading" }: { kind?: SkeletonKind; label?: string }) {
  return <div className={`skeleton-shell skeleton-shell--${kind}`} aria-busy="true" aria-live="polite">
    <span className="sr-only">{label}</span>
    <header aria-hidden="true"><i className="skeleton-block skeleton-block--brand" /><i className="skeleton-block skeleton-block--action" /></header>
    {kind === "detail" ? <><i className="skeleton-block skeleton-block--hero" /><section><div><i /><i /><i /></div><aside><i /><i /><i /></aside></section></> : null}
    {kind === "events" ? <><div className="skeleton-heading" aria-hidden="true"><i /><i /></div><section className="skeleton-cards" aria-hidden="true">{[0, 1, 2].map((item) => <article key={item}><i /><span /><small /></article>)}</section></> : null}
    {kind === "wallet" ? <><div className="skeleton-heading" aria-hidden="true"><i /><i /></div><section className="skeleton-passes" aria-hidden="true">{[0, 1].map((item) => <article key={item}><div><i /><span /></div><b /><small /></article>)}</section></> : null}
    {kind === "room" ? <section className="skeleton-room" aria-hidden="true"><div>{[0, 1, 2, 3].map((item) => <i key={item} />)}</div><b /></section> : null}
    {kind === "operations" ? <><div className="skeleton-heading" aria-hidden="true"><i /><i /></div><section className="skeleton-metrics" aria-hidden="true">{[0, 1, 2, 3].map((item) => <article key={item}><i /><b /></article>)}</section><section className="skeleton-rows" aria-hidden="true">{[0, 1, 2, 3].map((item) => <i key={item} />)}</section></> : null}
  </div>;
}
