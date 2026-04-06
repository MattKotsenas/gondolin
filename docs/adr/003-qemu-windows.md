# ADR-003: QEMU on Windows - Installation, Acceleration, and Chardev Transport

## Status

Accepted

## Context

Issue #21 requires native Windows host support. We need to validate that QEMU
works on Windows with the full Gondolin device topology: 4 virtio serial ports
(control, fs, ssh, ingress), 1 netdev stream, and virtio-rng.

## Decision

Use QEMU for Windows installed via `winget`, with WHPX acceleration and TCP
sockets for all chardevs/netdev.

### Installation
- `winget install SoftwareFreedomConservancy.QEMU` installs to `C:\Program Files\qemu`
- QEMU 10.2.0 confirmed working
- Binary: `C:\Program Files\qemu\qemu-system-x86_64.exe`

### Acceleration
- WHPX (Windows Hypervisor Platform) confirmed operational
- QEMU reports: "Windows Hypervisor Platform accelerator is operational"
- Requires: Hyper-V enabled (which is already the case if WSL2 is installed)
- Fallback to TCG when WHPX unavailable

### Chardev/Netdev Transport
All 5 Gondolin sockets work over TCP on Windows WHPX:
- `-chardev socket,id=X,host=127.0.0.1,port=PORT,server=off` (4 chardevs)
- `-netdev stream,id=net0,server=off,addr.type=inet,addr.host=127.0.0.1,addr.port=PORT`

### Machine/CPU
- Machine type: `q35` (no microvm on Windows)
- CPU: to be determined (need to test `-cpu max` vs specific models)

## Alternatives Considered

1. **Chocolatey/Scoop QEMU**: Available but winget is the most standard
   Windows package manager and provides the latest QEMU.

2. **MSYS2 QEMU build**: More control over build options but unnecessary
   complexity since the winget package includes everything needed.

## Consequences

- QEMU binary path on Windows needs to be discovered (not on PATH by default)
- Windows Defender may prompt on first use (not observed in testing, but possible)
- The `whpx` reboot bug (QEMU 9.0+) means `-no-reboot` is important (already used)
- `-cpu max` on Ryzen has known issues - may need `-cpu qemu64` or similar fallback

## Evidence

### Experiment: Single TCP chardev on Windows
```
TCP listener on 127.0.0.1:55112
SUCCESS: QEMU connected to TCP chardev on Windows
EXPERIMENT PASSED: Windows WHPX + TCP chardev works
```

### Experiment: Full Gondolin QEMU shape (5 sockets)
```
5 TCP listeners created:
  virtio-control: 127.0.0.1:61107
  virtio-fs: 127.0.0.1:61108
  virtio-ssh: 127.0.0.1:61109
  virtio-ingress: 127.0.0.1:61110
  netdev: 127.0.0.1:61111

  virtio-control: QEMU connected
  virtio-fs: QEMU connected
  virtio-ssh: QEMU connected
  virtio-ingress: QEMU connected
  netdev: QEMU connected

5/5 chardevs connected
EXPERIMENT PASSED: Full Gondolin QEMU shape works on Windows WHPX
```

### Experiment: TCP chardev on Linux (control - same QEMU args)
```
TCP listener on 127.0.0.1:36265
SUCCESS: QEMU connected to TCP chardev
EXPERIMENT PASSED: TCP chardev works with QEMU
```

### Experiment: TCP netdev on Linux
```
TCP netdev listener on 127.0.0.1:38737
SUCCESS: QEMU connected to TCP netdev stream
EXPERIMENT PASSED: TCP netdev stream works with QEMU
```

### Experiment: Port churn (100 rapid cycles + 5 concurrent)
```
Testing 100 rapid start/stop cycles...
Completed: 100 cycles, Successes: 100, Failures: 0
Unique ports used: 100
5 concurrent listeners: all unique ports, no conflicts
EXPERIMENT PASSED
```
