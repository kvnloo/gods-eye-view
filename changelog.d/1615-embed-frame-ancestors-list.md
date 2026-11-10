- `GEV_EMBED_FRAME_ANCESTORS` now accepts comma-separated lists as well as
  space-separated ones. A comma list used to be pasted into the CSP header
  verbatim, which browsers reject as an invalid source, so every embedding page
  was silently refused. Bare `self`/`none` gain their quotes, and anything that
  is not a CSP source (such as a URL with a query or fragment) is dropped with
  a warning, and `;` refuses the whole setting. Valid CSP host-source paths
  are preserved, including trailing slashes (#1615).
- Original reproduction and parser: SimonSaysGiveMeSmile.
