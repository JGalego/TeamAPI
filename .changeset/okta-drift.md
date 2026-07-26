---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add an `okta-drift` command reconciling declared `members[]` against an Okta
directory group. Only a `deactivated` finding exits non-zero — a member whose
account is no longer active but who is still listed, and therefore still reads as
an owner to everything downstream. Joiners and leavers are reported as warnings.
Read-only: nothing is written back to `teamapi.yml`.
