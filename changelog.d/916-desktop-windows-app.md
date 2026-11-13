- Standalone Windows desktop app built by GitHub Actions: the local server
  runs on loopback only, provider keys and disk caches live in the per-user
  data directory so upgrades keep them (abiyeenzo, #916).
- Rotate the desktop log after it exceeds 2 MiB during a session, retaining
  one backup rather than growing the active log indefinitely (abiyeenzo, #916).
