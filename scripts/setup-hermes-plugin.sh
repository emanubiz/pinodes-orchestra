#!/usr/bin/env bash
# setup-hermes-plugin.sh — Symlink the orchestra Hermes plugin into ~/.hermes/plugins/
#
# Idempotent: if the symlink already points to the right place, exits cleanly.
# If a *different* file/dir already exists at the target, warns and exits without
# overwriting.
#
# Usage:
#   bash scripts/setup-hermes-plugin.sh
#   bash scripts/setup-hermes-plugin.sh --dry-run   # show what would happen

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_SRC="$REPO_ROOT/backend/hermes-plugins/orchestra"
HERMES_PLUGINS_DIR="$HOME/.hermes/plugins"
PLUGIN_TARGET="$HERMES_PLUGINS_DIR/orchestra"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[setup] DRY RUN — no changes will be made"
fi

# ── Pre-flight checks ───────────────────────────────────────────────────────

if [[ ! -d "$PLUGIN_SRC" ]]; then
  echo "❌ Plugin source not found: $PLUGIN_SRC"
  exit 1
fi

if [[ ! -f "$PLUGIN_SRC/plugin.yaml" ]]; then
  echo "❌ plugin.yaml not found in $PLUGIN_SRC"
  exit 1
fi

if [[ ! -f "$PLUGIN_SRC/__init__.py" ]]; then
  echo "❌ __init__.py not found in $PLUGIN_SRC"
  exit 1
fi

# ── Create ~/.hermes/plugins/ if missing ────────────────────────────────────

if [[ ! -d "$HERMES_PLUGINS_DIR" ]]; then
  if $DRY_RUN; then
    echo "[setup] Would create: $HERMES_PLUGINS_DIR"
  else
    mkdir -p "$HERMES_PLUGINS_DIR"
    echo "✅ Created $HERMES_PLUGINS_DIR"
  fi
fi

# ── Handle existing target ──────────────────────────────────────────────────

if [[ -L "$PLUGIN_TARGET" ]]; then
  # Symlink exists — check where it points
  EXISTING_TARGET="$(readlink -f "$PLUGIN_TARGET")"
  if [[ "$EXISTING_TARGET" == "$(readlink -f "$PLUGIN_SRC")" ]]; then
    echo "✅ Symlink already correct: $PLUGIN_TARGET → $PLUGIN_SRC"
    echo ""
    echo "── Next step ─────────────────────────────────────────────────"
    echo "  export PINODES_ORCHESTRA_HERMES=true"
    echo "──────────────────────────────────────────────────────────────"
    exit 0
  else
    echo "⚠️  Symlink exists but points elsewhere: $PLUGIN_TARGET → $EXISTING_TARGET"
    if $DRY_RUN; then
      echo "[setup] Would update symlink to point to $PLUGIN_SRC"
    else
      ln -sf "$PLUGIN_SRC" "$PLUGIN_TARGET"
      echo "✅ Updated symlink: $PLUGIN_TARGET → $PLUGIN_SRC"
    fi
  fi
elif [[ -e "$PLUGIN_TARGET" ]]; then
  echo "❌ A non-symlink file/dir already exists at: $PLUGIN_TARGET"
  echo "   Remove it manually first, then re-run this script."
  exit 1
else
  if $DRY_RUN; then
    echo "[setup] Would create symlink: $PLUGIN_TARGET → $PLUGIN_SRC"
  else
    ln -s "$PLUGIN_SRC" "$PLUGIN_TARGET"
    echo "✅ Created symlink: $PLUGIN_TARGET → $PLUGIN_SRC"
  fi
fi

# ── Output ──────────────────────────────────────────────────────────────────

echo ""
echo "── Next step ─────────────────────────────────────────────────"
echo "  export PINODES_ORCHESTRA_HERMES=true"
echo ""
echo "  Add to your shell rc (~/.bashrc, ~/.zshrc) or run inline."
echo "  This flag tells the backend to use HermesRuntime for nodes"
echo "  marked runtime: \"hermes\"."
echo "──────────────────────────────────────────────────────────────"
