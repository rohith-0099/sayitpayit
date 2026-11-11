#!/usr/bin/env bash
# Push services/guardian to a Hugging Face Space (Docker SDK).
#   1. Create the Space: https://huggingface.co/new-space  (SDK: Docker, hardware: CPU basic, free)
#   2. Add a Space secret GUARDIAN_API_KEY (Settings → Variables and secrets); use the same value on Render.
#   3. HF_TOKEN=<write token> ./scripts/deploy-guardian-hf.sh <hf-username> <space-name>
set -euo pipefail
user="${1:?usage: deploy-guardian-hf.sh <hf-username> <space-name>}"
space="${2:?usage: deploy-guardian-hf.sh <hf-username> <space-name>}"
: "${HF_TOKEN:?set HF_TOKEN to a Hugging Face write token}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Tracked files only (no .venv, models or raw data), with the Space README at the root.
git -C "$root" archive HEAD services/guardian | tar -x -C "$tmp"
cd "$tmp/services/guardian"
mv SPACE_README.md README.md
git init -q -b main
git add -A
git -c user.name="SayItPayIt deploy" -c user.email="deploy@sayitpayit.invalid" commit -qm "Deploy Guardian from $(git -C "$root" rev-parse --short HEAD)"
git push -f "https://user:${HF_TOKEN}@huggingface.co/spaces/${user}/${space}" main
echo "Pushed. Build logs: https://huggingface.co/spaces/${user}/${space}  (URL for GUARDIAN_URL: https://${user}-${space}.hf.space)"
