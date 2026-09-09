# Delivery standard

Treat every increment as production engineering, including early device builds.
Do not distribute disposable debug-signed APKs, introduce temporary customer
identities, or defer durable configuration merely because testing has just begun.
Preserve the signing identity and installed data across updates. Never commit
private signing material. Release builds must fail when credentials are missing.

Verify the actual release configuration and exact commit. State incomplete
customer journeys and external account dependencies plainly; a successful build
alone does not establish store or product readiness. Use the existing shared
event presentation rules for current and future events.
