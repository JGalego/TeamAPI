---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
---

Surface `cognitiveLoad.supervision` on the three places that were still blind to it:

- **`teamapi diff`** tracks it as its own field on `CognitiveLoadSnapshot`. Because supervision
  sits outside `total` by design, a team whose supervision load doubled without touching the other
  three types previously reported no change at all — exactly the quiet growth the field exists to
  expose.
- **The Port generator** emits `supervisionLoad` beside `cognitiveLoad`. Port scores and colours
  numeric properties, so "who is carrying the most agent-supervision load" becomes a sortable
  column instead of something you read four YAML files to learn.
- **The dashboard** shows it as a separate 🤖 chip rather than widening the load bar, so the bar
  keeps meaning the same thing across teams that scored supervision and teams that didn't.
  Distinguished by glyph and border, not colour alone.

`examples/acme-org` now also demonstrates an `alignsWith[].kind` (`learns-from` on Stream
Checkout's tech lead) alongside an undecorated entry on Stream Onboarding, so the canonical example
shows both the named relation and the default.
