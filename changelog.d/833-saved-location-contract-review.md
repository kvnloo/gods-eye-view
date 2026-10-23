## Saved locations: strict typed persistence

- Align saved `fly_to_location` coordinates and range with the action's numeric schema instead of accepting coercible strings, booleans, or null coordinates.
- Normalize stored records to unique ids before the 24-record cap, including load, save, upsert and delete, retaining the first valid occurrence.
- Storage-only review repair for existing origin PR #833. The initial request is origin issue #335 (gek0kuj0); related LOCATION UI work is origin PR #358 (gietabhi10); independent review was provided by quanticsoul4772. No navigation UI or execution was introduced.
