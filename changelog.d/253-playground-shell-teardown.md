- Preserve a single roving keyboard tab stop on focused Playground tabs while
  aria-selected remains on the mounted mode; repeat activation reclaims the tab
  stop without remounting a room. Synthetic V8 only; browser/mobile NOT RUN.
- Provide focus-only Left/Right/Home/End keyboard navigation for Playground tabs, with tablist/tabpanel semantics. Explicit Enter/Space activation still required before local-room/What-if effects. Synthetic regression only; native Node/browser QA pending.
- Prevent closed but still-connected Planet Playground tabs from mounting hidden local-room or What-if effects via scripted clicks; visible tab selection still works. Added a synthetic DOM regression; supported Node and full-app browser proof remain outstanding.
- Fix Planet Playground shell teardown: detached controls can no longer remount a mode, recreate local-room effects or leave stale listeners after host unmount. Includes a deterministic synthetic DOM regression; no real multiplayer, native browser or production-build proof is claimed.
- Keep Planet Playground shell usable if a feature's cleanup or mount throws: clear stale mode ownership, allow retry, and still revoke host controls. Synthetic fault-injection regression only; full-app browser and supported Node tests remain outstanding.
