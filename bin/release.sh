#!/usr/bin/env bash
# Release: bump CalVer on main, build from a clean tree, push versioned +
# latest tags to GHCR, print the tag@digest pin line for the estate's
# compose/vps/docker-compose.yml. Same shape as colonpipe.org's bin/release.sh.
#
# The estate pins latest@digest: the digest makes the deploy immutable, the
# latest tag is what diun watches; the versioned tag is provenance/rollback.
# Push auth is owner-present and short-lived:
#   gh auth refresh -s write:packages
#   gh auth token | docker login ghcr.io -u zetlen --password-stdin
# and remove the scope afterward; no standing push credential exists anywhere.
#
# Ordering is failure-safe: the version-bump commit reaches origin/main before
# any image is pushed, so a push rejected by branch protection aborts the
# release with nothing published.
set -euo pipefail
img=ghcr.io/zetlen/spatch
cd "$(dirname "$0")/.."

git diff-index --quiet HEAD -- || { echo "release refused: working tree dirty" >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "release refused: not on main" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || { echo "release refused: main is not in sync with origin/main" >&2; exit 1; }

# CalVer YYYY.MM.MICRO, micro restarting each month (the rule the retired
# deploy.yml applied); an explicit argument overrides.
if [ $# -ge 1 ]; then
  v="$1"
else
  prefix="$(date -u +%Y.%m)"
  cur="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' package.json)"
  if [ "${cur%.*}" = "$prefix" ]; then v="$prefix.$(( ${cur##*.} + 1 ))"; else v="$prefix.1"; fi
fi
git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "release refused: tag v$v already exists" >&2; exit 1; }

sed -i "s/\"version\": \".*\"/\"version\": \"$v\"/" package.json
git commit -q -m "v$v [skip ci]" package.json
git push origin main || {
  git reset -q --hard origin/main
  echo "release aborted: push to main rejected (branch protection?); version bump reverted, nothing published" >&2
  exit 1
}

# plain single manifest: no provenance/SBOM attestations, so the pushed
# artifact has one digest and no untagged child manifests
docker build --provenance=false --sbom=false \
  --build-arg GIT_SHA="$(git rev-parse --short HEAD)" \
  -t "$img:$v" -t "$img:latest" .
docker push "$img:$v"
docker push "$img:latest"

digest="$(docker inspect "$img:$v" --format '{{range .RepoDigests}}{{println .}}{{end}}' \
  | awk -F@ -v img="$img" '$1==img {print $2; exit}')"
[ -n "$digest" ] || { echo "could not read pushed digest from docker inspect" >&2; exit 1; }

git tag -a "v$v" -m "release $v — $img@$digest"
git push origin "v$v"

echo
echo "released $img:$v ($digest)"
echo "estate pin (compose/vps/docker-compose.yml):"
echo "    image: $img:latest@$digest"
