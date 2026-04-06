# ADR-006: Acceleration Selection Matrix

## Status

Accepted

## Context

Gondolin selects QEMU acceleration based on host platform and architecture.
Windows host support requires adding WHPX, and Hyper-V guest optimization
requires MSHV detection.

## Decision

### Selection matrix

| Host Platform | Host Arch | Target Arch | Accelerator | CPU    | Machine  |
|---------------|-----------|-------------|-------------|--------|----------|
| Linux         | same      | same        | kvm         | host   | microvm* |
| Linux         | different | different   | tcg         | max    | q35/virt |
| macOS         | same      | same        | hvf         | host   | virt/q35 |
| macOS         | different | different   | tcg         | max    | virt/q35 |
| Windows       | x64       | x64         | whpx        | max**  | q35      |
| Windows       | x64       | arm64       | tcg         | max    | virt     |
| Linux (MSHV)  | x64       | x64         | mshv        | host   | q35      |

*microvm only on Linux x64 with KVM
**WHPX does not support `-cpu host`; use `-cpu max` or a specific model

### WHPX detection

```typescript
if (process.platform === "win32") {
  // WHPX is available when Windows Hypervisor Platform feature is enabled.
  // Unlike KVM (/dev/kvm check), there's no simple file test.
  // Strategy: try a probe launch or check via WMI, fall back to tcg.
  // For v1: assume WHPX available if Hyper-V is enabled (WSL2 implies this).
  return "whpx";
}
```

### MSHV detection (separate PR)

```typescript
if (process.platform === "linux") {
  // MSHV available when running inside Hyper-V with mshv.ko loaded
  try {
    fs.accessSync("/dev/mshv", fs.constants.R_OK | fs.constants.W_OK);
    return "mshv";
  } catch {
    // Fall through to KVM/TCG
  }
}
```

### QEMU version gating

WHPX reboot bug (QEMU 9.0+): already mitigated by `-no-reboot` flag.
MSHV requires QEMU 10.2+: check version output before using.

## Consequences

- `selectAccel()` gains `win32` branch returning `whpx` (with tcg fallback)
- `selectMachineType()` returns `q35` on Windows (no microvm support)
- `selectCpu()` returns `max` on Windows (WHPX doesn't support `-cpu host`)
- MSHV handled separately to avoid blocking Windows story
