---
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi": minor
---

Make the REST API safe to expose: bearer auth, CORS and rate limiting.

`serve-api` had no authentication, no CORS control and no rate limiting, which meant the only
correct place to run it was localhost — and nothing stopped anyone from binding `0.0.0.0` anyway.

Auth is opt-in (`--token`, or `TEAMAPI_API_TOKEN`) so the local workflow is unchanged, and binding
a non-loopback address without one is now refused outright rather than warned about, since an
exposed server looks exactly like a working one. `--allow-anonymous` is the deliberate escape
hatch. `/health` stays open for liveness probes and `/slack/*` keeps its own request signature.

Token comparison is constant-time, rejections never echo the presented credential, and the auth
hook runs at `preParsing` so the rate limiter counts failed attempts — at `onRequest` it could
not, leaving token guessing effectively unlimited.
