# Multi-Platform VSIX Publishing Guide

This document describes the build and publishing process for the PiNodes Orchestra VS Code extension, which bundles native Node.js modules (`node-pty`, `better-sqlite3`) and therefore requires **platform-specific VSIX packages**.

## Why Platform-Specific Builds?

The extension embeds a self-contained backend server under `server/` that includes:

| Native Module | Purpose | Constraint |
|---------------|---------|------------|
| `node-pty` | Pseudoterminal spawning for agent PTYs | Prebuilt binaries exist for all platforms, but `better-sqlite3` does not |
| `better-sqlite3` | Local SQLite persistence for board state | **Must be compiled natively on each target OS/arch + Node ABI** |

Because `better-sqlite3` has no prebuilt binaries on npm, the compiled `.node` artifact is bound to:
- Operating system (Linux / Windows / macOS)
- Architecture (x64 / arm64)
- Node.js ABI version (determined by Node major version)

A VSIX built on Linux **will not work** on Windows or macOS. The VS Code Marketplace requires separate `.vsix` files per platform.

## Supported Targets

| Platform | Target String | Node Version | Notes |
|----------|---------------|--------------|-------|
| Linux x64 | `linux-x64` | 24.x (ABI 137) | Primary CI target |
| Windows x64 | `win32-x64` | 24.x (ABI 137) | Requires Visual Studio Build Tools |
| macOS x64 | `darwin-x64` | 24.x (ABI 137) | Intel Macs |
| macOS arm64 | `darwin-arm64` | 24.x (ABI 137) | Apple Silicon (M-series) |

## Build Prerequisites (per machine)

### Linux (x64)
```bash
# Already satisfied on standard Ubuntu/Debian
sudo apt-get install -y build-essential python3
```

### Windows (x64)
- **Visual Studio Build Tools 2022** with "Desktop development with C++" workload
- **Python 3.x** in PATH
- Node.js 24.x installed

### macOS (x64 & arm64)
- **Xcode Command Line Tools**: `xcode-select --install`
- Node.js 24.x (via `nvm`, `fnm`, or official installer)
- For arm64 builds: run on Apple Silicon hardware (or use GitHub Actions `macos-14`/`macos-15` runners)

## Build Procedure (per machine)

Clone the repo, then run from the extension directory:

```bash
cd vscode-extension
npm ci                    # Install dependencies (including native compilation)
npm run vscode:prepublish # Compiles TS + runs bundle.mjs (assembles server/)
npx @vscode/vsce package --target <TARGET>
```

This produces:
```
pinodes-orchestra-vscode-<TARGET>-<VERSION>.vsix
```

### Example Outputs
```
pinodes-orchestra-vscode-linux-x64-0.2.1.vsix
pinodes-orchestra-vscode-win32-x64-0.2.1.vsix
pinodes-orchestra-vscode-darwin-x64-0.2.1.vsix
pinodes-orchestra-vscode-darwin-arm64-0.2.1.vsix
```

## Verification (per machine)

Before publishing, smoke-test the generated VSIX locally:

```bash
code --install-extension pinodes-orchestra-vscode-<TARGET>-<VERSION>.vsix
# Open VS Code → PiNodes Orchestra panel → Start Backend
# Verify: health endpoint returns 200, frontend loads, no native module errors
```

## Publishing

From **any one machine** (after collecting all four `.vsix` files):

```bash
# Login once (requires PAT with Marketplace:Manage scope)
npx @vscode/vsce login <PUBLISHER_ID>

# Publish each platform
npx @vscode/vsce publish -p <PAT> -i pinodes-orchestra-vscode-linux-x64-<VERSION>.vsix
npx @vscode/vsce publish -p <PAT> -i pinodes-orchestra-vscode-win32-x64-<VERSION>.vsix
npx @vscode/vsce publish -p <PAT> -i pinodes-orchestra-vscode-darwin-x64-<VERSION>.vsix
npx @vscode/vsce publish -p <PAT> -i pinodes-orchestra-vscode-darwin-arm64-<VERSION>.vsix
```

The Marketplace automatically serves the correct VSIX to users based on their platform.

## Automation (Future)

A GitHub Actions workflow (`.github/workflows/publish-extension.yml`) can automate this matrix build on tag push. See `docs/ci-cd-extension.md` for the proposed workflow.

## Versioning

Update `vscode-extension/package.json` `version` field before each release. The version must match across all four VSIX files.

## Checklist for Release

- [ ] Version bumped in `package.json`
- [ ] Linux x64 VSIX built + verified
- [ ] Windows x64 VSIX built + verified
- [ ] macOS x64 VSIX built + verified
- [ ] macOS arm64 VSIX built + verified
- [ ] All four VSIX files published to Marketplace
- [ ] GitHub Release created with changelog