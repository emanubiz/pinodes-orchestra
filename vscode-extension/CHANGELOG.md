# Changelog

All notable changes to the **PiNodes Orchestra** extension are documented here.

## 0.2.8

### Fixed

- **Windows: agent nodes failed to start** because the backend spawned the bare
  `pi` binary, which does not exist on Windows (the npm launcher is `pi.cmd`).
  PATH resolution now tries `pi.cmd`, `pi.exe`, `pi.bat`, then `pi` on Windows,
  so the `pi` CLI is found and spawned correctly. Other platforms are unchanged.

## 0.2.7

- Deterministic handoff via per-turn system prompt + intent watchdog.

## 0.2.6

- Granular node/edge CRUD, CLI wrapper, flow auto-cleanup.

## 0.2.5

- Auto-start node pi on load; mirror-terminal width fixes; self-contained
  per-platform bundle; pi prerequisite check; Open VSX publishing.
