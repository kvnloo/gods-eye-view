# RFC — Shared Request Broker

Status: downstream experiment
Date: 2026-09-29
Parent: #103
Issue: #106

## TL;DR

GEV already has strong provider-specific caching/coalescing patterns. Extract the
small reusable contract instead of adding another bespoke cache to every source.

```
request intent
  -> stable key
  -> memory hit?
  -> join in-flight?
  -> eligible stale/last-good?
  -> upstream
  -> validate
  -> publish + bounded cache
```

Caching policy remains source-owned.

## V1 contract

A broker request provides:
- stable key;
- loader accepting an AbortSignal;
- optional freshness TTL;
- optional stale eligibility;
- optional weight/size for LRU accounting.

The broker provides:
- in-flight singleflight;
- independent caller cancellation;
- bounded memory LRU;
- explicit fresh/stale/miss result metadata;
- diagnostics for latency and joins.

## Cancellation

Joining callers do not own the shared upstream request individually.

If caller A aborts while caller B still waits, A stops waiting but the shared
request continues. The upstream is aborted only when no interested caller remains
or when the request owner explicitly supersedes the whole key/generation.

Viewport work may use a separate generation/supersession owner.

## Freshness

There is no universal TTL.

Each source decides whether stale data is:
- forbidden;
- acceptable while revalidating;
- acceptable only on provider failure;
- displayable only with an explicit stale status.

Unknown stays unknown. An error is never cached as successful data.

## HTTP reuse

Where the provider supports validators, preserve:
- ETag / If-None-Match;
- Last-Modified / If-Modified-Since.

A 304 refreshes freshness metadata without rebuilding an unchanged payload.

## Memory

The broker must support both:
- entry-count bounds;
- approximate byte/weight bounds.

Eviction is least-recently-used among non-pinned entries. Selected UI state does
not pin raw network payloads indefinitely.

## Diagnostics

Per request family:
- hit / miss / join / stale;
- upstream count;
- response bytes;
- p50/p95 loader latency;
- current entries/weight;
- eviction count;
- aborted waiters vs aborted upstreams.

## Rollout

1. Add primitive + concurrency tests.
2. Adopt one cache-safe source.
3. Measure request-count and latency delta.
4. Only then migrate additional providers.

Do not rewrite the existing Overpass cache merely to prove abstraction value.
