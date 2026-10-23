// The sole intentional app/website difference: website discovery hides this
// exact event. Native catalogue data and every direct event screen stay intact.
export const websiteDiscoveryContract = Object.freeze({
  name: 'website-only-kempinski-discovery-exclusion',
  slug: 'sun-chasers-labadi',
  routes: Object.freeze(['/', '/events']),
});

export function websiteDiscoveryCatalogue(catalogue) {
  const { slug } = websiteDiscoveryContract;
  const events = catalogue.events;
  const screens = catalogue.screens;
  if (!Array.isArray(events) || !Array.isArray(screens) ||
    events.filter(event => event.slug === slug).length !== 1 ||
    screens.filter(screen => screen.event.slug === slug).length !== 1 ||
    JSON.stringify(events.map(event => event.slug)) !== JSON.stringify(screens.map(screen => screen.event.slug))) {
    throw new Error('Native catalogue must retain the excluded event and all corresponding direct screens');
  }
  // New arrays only; every remaining record/field and the original catalogue
  // are unchanged. Never use this reference fixture for actual app captures.
  return { ...catalogue, events: events.filter(event => event.slug !== slug), screens: screens.filter(screen => screen.event.slug !== slug) };
}

export async function readLayoutSnapshot(page) {
  return page.evaluate(() => {
    const selector = '.compact-hero, .compact-hero__image--active, main h1, .drop-card h3, .drop-card__schedule, .event-detail-facts, .event-story-content, .compact-ticket-panel, .event-detail-toolbar, .customer-dock';
    return [...document.querySelectorAll(selector)].map(element => {
      const style = getComputedStyle(element);
      const hero = element.matches('.compact-hero, .compact-hero__image--active');
      return { tag: element.tagName, text: element.textContent.replace(/\s+/g, ' ').trim(), font: style.fontFamily, size: style.fontSize, color: style.color, ...(hero ? { width: style.width, height: style.height, objectFit: style.objectFit, objectPosition: style.objectPosition, portraitCrop: element.getAttribute('data-portrait-crop') } : {}) };
    });
  });
}

export async function readDiscoveryEvidence(page, title) {
  return page.evaluate(({ slug, title }) => ({
    cardSlugs: [...document.querySelectorAll('.drop-card')].map(card => card.getAttribute('data-event-slug')),
    activeSlug: document.querySelector('[data-active-night]')?.getAttribute('data-active-night') ?? null,
    excludedLinks: [...document.querySelectorAll('main a[href]')].map(link => new URL(link.href).pathname)
      .filter(pathname => pathname.split('/').includes(slug)),
    excludedTitlePresent: document.querySelector('main')?.textContent.includes(title) ?? null,
  }), { slug: websiteDiscoveryContract.slug, title });
}

export function assessLayoutParity({ route, app, website, reference, discovery, referenceDiscovery }) {
  const problems = [];
  const discoveryRoute = websiteDiscoveryContract.routes.includes(route);
  const expected = discoveryRoute ? reference : app;
  if (![app, website, expected].every(snapshot => Array.isArray(snapshot) && snapshot.length > 0)) problems.push('Complete app, website and expected snapshots are required');
  if (JSON.stringify(expected) !== JSON.stringify(website)) problems.push('Screen fields differ from the exact expected snapshot');
  if (discoveryRoute) {
    const { slug } = websiteDiscoveryContract;
    if (!discovery || !referenceDiscovery || JSON.stringify(discovery) !== JSON.stringify(referenceDiscovery)) problems.push('Website discovery differs from the exact single-exclusion reference');
    if (discovery?.excludedTitlePresent !== false || discovery?.excludedLinks?.length !== 0 ||
      discovery?.activeSlug === slug || !Array.isArray(discovery?.cardSlugs) || discovery.cardSlugs.includes(slug)) {
      problems.push(`Website discovery must hide specifically ${slug}`);
    }
  }
  return {
    route, match: problems.length === 0, strictMatch: JSON.stringify(app) === JSON.stringify(website),
    contract: discoveryRoute ? websiteDiscoveryContract.name : 'strict-app-website-parity', problems, app, website,
    ...(discoveryRoute ? { excludedEvent: websiteDiscoveryContract.slug, reference, discovery, referenceDiscovery } : {}),
  };
}
