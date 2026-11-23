#!/usr/bin/env bash
# Upload to a draft first so an interrupted run cannot publish a partial release.
set -euo pipefail
mode=${1:?Missing release action}
tag=${2:?Missing pilot tag}
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+-build\.[1-9][0-9]*$ ]] || { echo "Invalid pilot tag" >&2; exit 2; }
name="angler-to-angler-${tag#v}.apk"
repo=${GITHUB_REPOSITORY:?}
fields=isDraft,isPrerelease,targetCommitish,assets
view() { gh release view "$tag" --repo "$repo" --json "$fields"; }
check_assets() {
  jq -e --arg apk "$name" '([.assets[] | select(.size > 0) | .name] | sort) == [$apk, ($apk + ".sha256")]' >/dev/null
}

case "$mode" in
  publish)
    sha=${GITHUB_SHA:?}
    cd build/release
    sha256sum -c "$name.sha256"
    # Never claim an existing tag that points to a different commit.
    ref=$(gh api "repos/$repo/git/matching-refs/tags/$tag" | jq -r --arg tag "refs/tags/$tag" '.[] | select(.ref == $tag) | .object.sha')
    [[ -z $ref || $ref == "$sha" ]] || { echo "Tag belongs to a different commit" >&2; exit 1; }
    if release=$(view); then
      [[ $(jq -r .targetCommitish <<< "$release") == "$sha" ]] || { echo "Release target differs" >&2; exit 1; }
      if [[ $(jq -r .isDraft <<< "$release") == false ]]; then
        check_assets <<< "$release"
        echo "Already published: $tag"
        exit 0
      fi
    else
      gh release create "$tag" --repo "$repo" --target "$sha" --draft --prerelease \
        --title "Rybáři sobě ${tag#v}" --notes "Android pilot for testing. Download the APK under Assets. Build commit: $sha."
    fi
    gh release upload "$tag" "$name" "$name.sha256" --repo "$repo" --clobber
    release=$(view)
    check_assets <<< "$release"
    gh release edit "$tag" --repo "$repo" --draft=false --prerelease --latest=false
    ;;
  promote)
    release=$(view)
    [[ $(jq -r .isDraft <<< "$release") == false ]] || { echo "Finish publishing the draft first" >&2; exit 1; }
    check_assets <<< "$release"
    if [[ $(jq -r .isPrerelease <<< "$release") == true ]]; then
      gh release edit "$tag" --repo "$repo" --prerelease=false --latest
    fi
    ;;
  *) echo "Expected publish or promote" >&2; exit 2 ;;
esac
