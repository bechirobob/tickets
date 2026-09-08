# Event presentation

Every public event uses the same card layout, with its own artwork, palette and editorial line. Dates, titles, venues, lines, prices, verification and actions share grid tracks across neighbouring cards. Text wraps in full; longer copy grows its row for both cards. Poster frames share a 5:6 ratio and contain the complete image. Different source proportions are preserved. Desktop cards stop at 280px wide; event-page posters stop at 400 × 480px.

Write an individual event line in Curation before approval/publication. There is no category or perk slogan fallback. The Event line editor can update coming-soon listings without supplying dates or inventory. Whitespace is normalized and case-insensitive duplicate lines are rejected; a database unique index also protects concurrent writes. Shared interface labels such as View event remain consistent.

Migration 0034 adds nullable tagline columns to submissions and curated events and assigns the two launch lines. It does not alter event dates, tiers, orders or publication status. Older code can run against the expanded schema, but would restore the previous category-copy behavior; prefer a forward fix. Previous production: fa721fdfe7fde28675052e02720b6049481e9f46, Worker 01ece4cb-3332-4edd-9366-ecf761f038c1.

Verify the exact release in the candidate workflow: lint, types, automated tests, migration check, dependency audit, Worker dry run and all three isolated browser projects. Browser assertions check corresponding row positions, equal bounded poster frames, full text visibility and longer future copy on home and directory pages. Confirm the deployed revision and both launch listings after release.

Layout reference: [CSS subgrid](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Subgrid); artwork reference: [object-fit](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit).
