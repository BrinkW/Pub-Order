#!/usr/bin/env bash
# Secret scan for the CI security job: download a pinned gitleaks release, check it against
# the release's published checksums, then scan the whole git history (all fetched branches).
# Needs a full clone (actions/checkout with fetch-depth: 0). Known false positives are listed,
# with reasons, in .gitleaksignore at the repo root. Exits non-zero if any leak is found.
set -euo pipefail

version="8.30.1"
archive="gitleaks_${version}_linux_x64.tar.gz"
base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
dir="$(mktemp -d)"

curl -fsSL -o "$dir/$archive" "$base/$archive"
curl -fsSL -o "$dir/checksums.txt" "$base/gitleaks_${version}_checksums.txt"
(cd "$dir" && grep " ${archive}\$" checksums.txt | sha256sum --check --status) || {
  echo "gitleaks download does not match its published checksum" >&2
  exit 1
}
tar -xzf "$dir/$archive" -C "$dir" gitleaks

# --redact keeps any real secret out of the CI log; --verbose lists each finding.
"$dir/gitleaks" git . --log-opts="--all" --redact --verbose --no-banner
