- Let built standalone apps read the three intentional browser credentials at
  startup, with bounded keyless/build-time fallback and separately restricted
  MCP panel credentials preserved (jeff-jeffrolc, #1465).

- Treat whitespace-only runtime browser credentials as absent and trim usable
  runtime values before replacing embedded keys (follow-up to jeff-jeffrolc, #1465).
