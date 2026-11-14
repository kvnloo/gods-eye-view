### Fixed

- Guard Xweather's configured free-month tile allowance before new billable radar/lightning compositions. Concurrent requests reserve their source-tile estimates so multiple clients cannot each consume the same remaining units. Cached imagery remains available; `XWEATHER_ALLOW_OVERAGE=1` explicitly enables paid-plan overage while per-minute rate caps stay in force.
- Regression coverage for a one-unit monthly limit, paid opt-in and simultaneous budget reservations.

Credit: monwiss (Xweather source and PR #764); quanticsoul4772 (reported uncapped spend on PR #764).
