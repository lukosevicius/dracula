#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo 'Usage: npm run commit:push -- "Commit message" <Seeker file> [<Seeker file> ...]' >&2
  echo 'Example: npm run commit:push -- "Improve event filters" client/src/events.tsx client/src/seeker.css' >&2
  exit 2
fi

message=$1
shift

if [[ -z "$message" ]]; then
  echo 'Commit message cannot be empty.' >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
seeker_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$seeker_dir" rev-parse --show-toplevel)"

paths=()
for path in "$@"; do
  case "$path" in
    ''|/*|..|../*|*/..|*/../*)
      echo "Use a path inside seeker/: $path" >&2
      exit 2
      ;;
  esac
  paths+=("seeker/$path")
done

cd "$repo_root"

if ! git diff --cached --quiet; then
  echo 'There are already staged changes. Commit or unstage them first.' >&2
  exit 1
fi

if [[ -z "$(git status --short -- "${paths[@]}")" ]]; then
  echo 'None of the selected Seeker files have changes to commit.' >&2
  exit 1
fi

git diff --check -- "${paths[@]}"
echo 'Files selected for this commit:'
git status --short -- "${paths[@]}"
printf 'Commit these files and push the current branch? [y/N] '
read -r answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo 'Cancelled; nothing was staged.'
  exit 0
fi

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo 'Cannot push from a detached HEAD.' >&2
  exit 1
fi

git add -- "${paths[@]}"
git diff --cached --check
git commit -m "$message"
git push origin "$branch"
