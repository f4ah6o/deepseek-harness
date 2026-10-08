---
kind: upgrade-guide
description: "The Web and Desktop interfaces now default to Japanese when no language preference is saved."
---

# Japanese first-run language

English | [中文](guide.zh.md)

## Change

The Web bundle includes the Japanese language pack. When a profile has no saved `locale.preference`, Web and Desktop open in Japanese regardless of browser or operating-system language. An explicit saved `en`, `zh`, or `ja` preference remains in effect.

## Migration

No profile migration is required. To use English or Chinese on a profile without an explicit language preference, open Settings → General → Language and select the language; the selection is saved for that profile and reused on later launches.
