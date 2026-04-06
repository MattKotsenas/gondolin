# ADR-001: RNG Backend Selection

## Status

Accepted

## Context

Gondolin currently uses `-object rng-random,filename=/dev/urandom,id=rng0` to provide
entropy to the guest VM via virtio-rng. This depends on `/dev/urandom` existing on the
host, which is a Unix-specific assumption. Windows hosts have no `/dev/urandom`.

Issue #21 requires Windows host support, so the RNG backend must work cross-platform.

## Decision

Use `rng-builtin` everywhere, replacing `rng-random,filename=/dev/urandom`.

The `rng-builtin` backend uses QEMU's internal `getrandom()` implementation, which
works on all platforms (Linux, macOS, Windows) without any host-side dependency.

QEMU args change from:
```
-object rng-random,filename=/dev/urandom,id=rng0
```
to:
```
-object rng-builtin,id=rng0
```

## Alternatives Considered

1. **rng-random on Unix, rng-builtin on Windows only**: Minimal change, but adds a
   platform branch for no benefit. `rng-builtin` works identically on all platforms.

2. **Omit RNG device on Windows**: Guest would rely on software entropy sources.
   Less secure and unnecessary since `rng-builtin` is available.

## Consequences

- Zero behavior change on Linux/macOS - `rng-builtin` provides equivalent entropy
- Works on Windows without modification
- Simplifies the codebase (no platform conditional for RNG)
- Minimum QEMU version: 4.2 (when `rng-builtin` was introduced)
  - Gondolin's current QEMU usage already requires features from later versions
  - WSL2 default QEMU is 8.2.2, well past 4.2

## Evidence

Verified `rng-builtin` is available in:
- QEMU 8.2.2 (WSL2 Ubuntu 24.04): `qemu-system-x86_64 -object help` lists `rng-builtin`
- QEMU 10.2.0 (Windows via winget): confirmed available in object list

The `rng-builtin` backend was merged in QEMU commit series for v4.2 (2019).
