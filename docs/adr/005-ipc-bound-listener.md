# ADR-005: IPC Bound-Listener Abstraction Design

## Status

Accepted

## Context

Gondolin uses Unix domain sockets (UDS) for 5 host-guest communication channels
and 1 network backend. On Windows, these must use TCP sockets. The key challenge
is the startup order: TCP port numbers are not known until `listen(0)` succeeds,
but QEMU arguments must contain the port numbers at launch time.

Current flow:
1. Socket paths are generated in `server-options.ts` (random UUID in temp dir)
2. `SandboxServer` constructor creates `VirtioBridge(path)` instances
3. `SandboxController.start()` builds QEMU args using paths, spawns QEMU
4. When QEMU reports "running", bridges call `connect()` - creates UDS server

With TCP, the port is unknown at step 1. We need to bind first (at step 1/2),
then pass the discovered port to step 3.

## Decision

### IpcEndpoint type

```typescript
type IpcEndpoint =
  | { type: "unix"; path: string }
  | { type: "tcp"; host: string; port: number };
```

### Two-phase startup for TCP

1. **Bind phase**: Create TCP servers on `127.0.0.1:0`, discover ports
2. **Configure phase**: Build QEMU args using discovered ports
3. **Accept phase**: Bridge accepts connections on pre-bound server

### Changes by component

**server-options.ts**: On Windows, generate `IpcEndpoint` objects (TCP) instead
of string paths. Pre-bind TCP servers during option resolution.

**controller.ts / buildQemuArgs()**: Accept endpoints, format chardev/netdev
args based on endpoint type:
- Unix: `-chardev socket,id=X,path=PATH,server=off`
- TCP: `-chardev socket,id=X,host=HOST,port=PORT,server=off`

**server-transport.ts / VirtioBridge**: Accept either a socket path (creates
UDS server on connect) or a pre-bound TCP net.Server (accepts connections on
connect). Set `noDelay=true` on TCP sockets.

**qemu/net.ts / QemuNetworkBackend**: Same pattern - accept endpoint, adapt
server creation.

**server.ts / SandboxServer**: Thread endpoints through to bridges and
controller config.

### Security

TCP loopback has no inherent access control (unlike UDS filesystem permissions).
Mitigations in this diff:
- Bind to `127.0.0.1` only (never `0.0.0.0`)
- CBOR protocol acts as implicit validation (random connections are rejected)
- Single-connection mode (bridge accepts one QEMU connection per lifecycle)

TODO: Token-based handshake for stronger authentication in follow-up diff.

### Backward compatibility

On Unix (Linux/macOS), `IpcEndpoint` defaults to `{type: 'unix', path: ...}`.
All existing behavior is preserved. The abstraction is transparent.

## Alternatives Considered

1. **Always use TCP (even on Unix)**: Simpler abstraction but adds overhead
   and security surface on platforms where UDS works well.

2. **Windows named pipes for session IPC + TCP for chardevs**: Two different
   transport types. More complexity for marginal benefit.

3. **Defer to QEMU server mode**: Have QEMU listen and Node connect. Would
   require QEMU to run in server mode for chardevs. Inverts the current
   architecture and is harder to manage lifecycle.

## Consequences

- `SandboxConfig` type gains endpoint fields alongside existing path fields
- `VirtioBridge` constructor signature changes (backward compatible)
- `QemuNetworkBackend` options gain endpoint field
- `server-options.ts` returns pre-bound servers for TCP endpoints
- All existing tests continue to pass (Unix paths still used on Linux/macOS)
- New tests cover TCP endpoint formatting and binding
