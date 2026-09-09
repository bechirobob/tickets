# Owner password recovery

This normally restores an existing, explicitly authorised owner account. Creating
a new owner requires separate explicit approval and `createOwner: true` in the
reviewed issuance request. There is no public issuance API; MFA is never removed.

For approved new-owner creation, issuance first checks that no staff account uses
the approved email fingerprint. It creates an idempotent, disabled pending owner
with an unusable password record and a reserved internal email. The grant binds
the approved real email by SHA-256 hash; no real email or bearer token is committed.
Deliver `/admin/recover#token=…&email=…` privately. Activation verifies that email
against the grant and atomically sets it with the chosen password. A uniqueness
conflict rolls back the whole transaction, leaving all existing accounts intact.
Never roll back to code older than migration 0031 while a new-owner grant is live;
revoke those grants first, since older claim code does not enforce email binding.

1. Verify the requester’s authority and exact existing owner email. Obtain explicit
   authorisation to restore this account before preparing a recovery request.
2. Generate a private 32-byte random base64url bearer token outside the repository.
   Put only its SHA-256 base64url hash in `scripts/owner-recovery-request.json`,
   together with a new UUID, the SHA-256 hex hash of the normalised owner email,
   and a short UTC `issueBefore` deadline. Never commit or log the actual token.
3. Review and release through the normal checks. After successful deployment, the
   release uses its existing D1 credential to match exactly one existing owner and
   issue a grant. Issuance does not change account access or existing credentials.
   Missing, demoted or ambiguous accounts fail closed. Repeated deployments do not
   renew an issued grant or its expiry; old requests stop issuing after the deadline.
4. Confirm the release reports `ownerRecovery: issued`. Deliver the private link
   `/admin/recover#token=…` through the requester’s trusted private channel. It
   expires one hour after issuance. Do not open or submit it on the user’s behalf.
5. The owner confirms a new password on that page. The token is stripped from
   browser history, kept in component memory only, and sent in a same-origin POST.
   Inspection does not consume it. Claiming atomically consumes it, restores the
   same owner, replaces the password, clears lockouts and revokes all sessions,
   pending authentication challenges and other password grants. MFA stays intact.
For an expired, unclaimed new-owner setup, a fresh issuance request may specify
`renewSetupFrom` with the original setup request UUID, the same approved email
hash, a fresh request UUID and token hash. Do not set `createOwner`. The issuer
first matches an existing owner at the real email; otherwise it verifies the
original unused email-bound grant and the unchanged disabled pending account.
It issues a fresh one-hour grant for that same account without creating staff.

6. Sign in normally after setting the password. Do not claim authenticated access
   was verified unless the owner has completed this step.

Security checks cover expiry, replay, concurrent claims, changed/demoted accounts,
retained MFA, old-password rejection, invalid input and cross-origin requests.
Account edits after issuance invalidate the grant. A lost/expired link needs new
explicit issuance, never a widened bootstrap route or a reusable access key.

Rollback: migration is additive and previous Worker code ignores its table. A
code rollback does not undo a password the owner already chose. Revoke an unused
grant by setting its `used_at` through authorised operations if recovery is cancelled.
The release retains the normal pre-migration D1 bookmark and previous Worker ID.
