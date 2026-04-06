# ADR-002: IPC Transport - TCP on Windows, UDS on Unix

## Status

Accepted

## Context

Gondolin uses 6 Unix domain sockets (UDS) for host-guest communication:
- `virtioSocketPath` - virtio-serial control channel
- `virtioFsSocketPath` - VFS/filesystem RPC
- `virtioSshSocketPath` - SSH forwarding
- `virtioIngressSocketPath` - ingress gateway
- `netSocketPath` - QEMU network backend
- Session registry socket (per-session IPC for attach/list/snapshot)

UDS are not viable on Windows for two independent reasons:

1. **Node.js does not support AF_UNIX on Windows.** Despite Windows 10+ having
   kernel-level AF_UNIX support, Node.js's `net` module (backed by libuv) routes
   IPC through Windows named pipes, not AF_UNIX sockets. Open issues:
   nodejs/node#55979, nodejs/node#35008. This means `net.createServer` cannot
   create a UDS listener that QEMU can connect to.

2. **QEMU on Windows has AF_UNIX chardev support** (since QEMU 7.x), but since
   Node.js can't create the server-side listener, this is moot.

## Decision

Use **TCP sockets bound to 127.0.0.1** on Windows, **UDS on Unix** (Linux/macOS).

### For QEMU chardevs:
- Unix: `-chardev socket,id=X,path=/tmp/gondolin-xxx.sock,server=off`
- Windows: `-chardev socket,id=X,host=127.0.0.1,port=PORT,server=off`

### For QEMU netdev:
- Unix: `-netdev stream,...,addr.type=unix,addr.path=/tmp/gondolin-net.sock`
- Windows: `-netdev stream,...,addr.type=inet,addr.host=127.0.0.1,addr.port=PORT`

### For session registry IPC:
- Unix: UDS at `~/.cache/gondolin/sessions/<id>.sock`
- Windows: TCP on `127.0.0.1:<ephemeral-port>`, port stored in session metadata

## Security Implications

Moving from UDS to TCP changes the security model materially:

- **UDS**: Access controlled by filesystem permissions. Only processes with
  read/write access to the socket file can connect.
- **TCP loopback**: Any local process can connect to `127.0.0.1:PORT`.

For a sandboxing project, this requires mitigation:
- Per-session random nonce in a handshake after TCP connect
- Bind to `127.0.0.1` only (never `0.0.0.0`)
- Strict single-connection semantics (reject additional connections)
- Session liveness checks must verify protocol identity, not just connectivity

## Alternatives Considered

1. **Windows UDS (AF_UNIX)**: Would avoid TCP overhead, but Node.js can't create
   UDS servers on Windows. Blocked by libuv limitation.

2. **Windows named pipes**: Node.js supports named pipes natively on Windows.
   However, QEMU doesn't support named pipe chardevs for bidirectional
   communication. Would require two different IPC mechanisms (named pipes for
   session IPC, TCP for QEMU chardevs), adding complexity.

3. **TCP everywhere**: Simplest abstraction (one transport type), but adds
   overhead and security surface on Unix platforms where UDS works well.
   Not worth the tradeoff since UDS is superior on Unix.

## Consequences

- New `IpcEndpoint` type abstracting transport details
- Two-phase listener model required: bind listener first (to discover ephemeral
  port), then build QEMU args from bound endpoint
- `setNoDelay(true)` required on TCP sockets for latency parity with UDS
- Session metadata format changes to store transport-aware endpoint info
- All existing Linux/macOS behavior preserved (still uses UDS)

## Evidence

- Node.js AF_UNIX Windows issues: nodejs/node#55979, nodejs/node#35008
- QEMU TCP chardev: `-chardev socket,host=127.0.0.1,port=PORT` confirmed working
- QEMU TCP netdev: `-netdev stream,addr.type=inet` confirmed in QEMU 7.2+ docs
- Issue #21 author (mitsuhiko) recommended TCP for Windows
