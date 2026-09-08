import "./event-details.css";

export default function Loading() {
  return <main className="skeleton-shell event-detail-loading" aria-busy="true" aria-label="Loading event details">
    <header aria-hidden="true"><i className="skeleton-block skeleton-block--brand" /><i className="skeleton-block skeleton-block--action" /></header>
    <div className="event-detail-toolbar" aria-hidden="true"><i className="skeleton-block skeleton-block--action" /></div>
    <div className="event-detail-layout" aria-hidden="true"><i className="event-detail-poster skeleton-block" /><div className="event-detail-overview"><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></div></div>
  </main>;
}
