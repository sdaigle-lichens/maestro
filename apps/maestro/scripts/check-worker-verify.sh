#!/usr/bin/env bash
# Real-Docker, shell-only check (`179`): build this project's worker image and run its verify_command
# inside the container against the bind-mounted repo. Nothing of claude runs and no token is used.
#
#   ! bash apps/maestro/scripts/check-worker-verify.sh        (from the repository root)
#
# Checks: python3 present, the pinned package manager present, git identity passed at launch is used for
# a commit, verify_command exits 0, and neither `docker history` nor the image filesystem holds the
# identity or a token-looking string. Needs docker and a green tree with node_modules installed.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
runtime="$root/plugins/maestro/scripts/maestro-worker-runtime.cjs"
verify="$(node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).verify_command;process.stdout.write(typeof v==="string"?v:"")}catch{}' "$root/.claude/maestro.json")"
[[ -n "$verify" ]] || { echo "no verify_command in .claude/maestro.json" >&2; exit 2; }

export CLAUDE_PROJECT_DIR="$root"
node "$runtime" image
tag="$(node "$runtime" image --print-tag)"
name="$(git -C "$root" config user.name)"
email="$(git -C "$root" config user.email)"
echo "== image $tag, verify_command: $verify"
# The last line always names the image and the result, so pasting only the tail is enough for a report.
trap 'rc=$?; [[ $rc -eq 0 ]] || echo "RESULT: FAILED (exit $rc), image $tag" >&2' EXIT

run() {
  docker run --rm --init --entrypoint bash \
    -e "GIT_AUTHOR_NAME=$name" -e "GIT_COMMITTER_NAME=$name" \
    -e "GIT_AUTHOR_EMAIL=$email" -e "GIT_COMMITTER_EMAIL=$email" \
    -v "$root:$root" -v "$root/.claude/scripts:$root/.claude/scripts:ro" -v "$root/.claude/settings.json:$root/.claude/settings.json:ro" \
    -w "$root" "$tag" -c "$1"
}

echo "== python3 / package manager"
run 'python3 --version && node --version && corepack --version'
echo "== verify_command"
run "$verify"
echo "== commit identity"
run 'rm -rf /tmp/idrepo && git init -q /tmp/idrepo && cd /tmp/idrepo && git commit -q --allow-empty -m probe && git log -1 --format="%an <%ae> / %cn <%ce>"' |
  tee /dev/stderr | grep -qF "$name <$email> / $name <$email>"

echo "== no identity or secret in the image"
# Real token shapes only. A bare word such as "oauth_token" or "sk-ant-" appears in fixtures, reports
# and third-party sources; these need a real-looking value after the prefix.
token_re='sk-ant-[A-Za-z0-9_-]{20,}|CLAUDE_CODE_OAUTH_TOKEN=[^[:space:]]{20,}'
# The identity as the launcher could leave it: a git config line (`email = <addr>`, `name = <name>`) or
# an exported GIT_AUTHOR_/GIT_COMMITTER_ variable. The address also sits, legitimately, in a plugin
# manifest's `author` field (the marketplace copy baked into the image), so a bare occurrence is not a leak.
esc() { printf '%s' "$1" | sed 's/[][\.*^$+?(){}|/]/\\&/g'; }
identity_re="(email|GIT_(AUTHOR|COMMITTER)_EMAIL)[[:space:]]*=[[:space:]]*\"?$(esc "$email")|(name|GIT_(AUTHOR|COMMITTER)_NAME)[[:space:]]*=[[:space:]]*\"?$(esc "$name")"

history="$(docker history --no-trunc "$tag")"
if grep -qE -e "$token_re" <<<"$history"; then echo "token found in docker history" >&2; exit 1; fi
# History holds only build commands, so the plain identity strings are checked there.
if [[ -n "$email" ]] && grep -qF -e "$email" <<<"$history"; then echo "identity found in docker history" >&2; exit 1; fi

scan() { # scan <pattern> <what>
  docker run --rm -e "SCAN_RE=$1" --entrypoint bash "$tag" -c '
    ! grep -rIlE --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev -e "$SCAN_RE" / 2>/dev/null | grep .
  ' || { echo "$2 in the image filesystem" >&2; exit 1; }
}
scan "$token_re" "token-looking string"
if [[ -n "$email" ]]; then scan "$identity_re" "git identity"; fi
echo "RESULT: OK, image $tag: verify_command ran green in the container; image clean"
