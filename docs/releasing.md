# Native Linux releases

Purple's native release is an Arch Linux package built from a versioned Git tag.
The tag workflow runs the package tests, creates an SPDX SBOM and SHA-256
checksums, attests the outputs through GitHub's OIDC identity, and publishes the
files to a GitHub Release. It does not deploy the web app or publish to the AUR.

## Prepare a release

1. Run `pnpm run check`.
2. Set the same version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `packaging/PKGBUILD`, and the newest AppStream `<release>` entry. Set the AppStream entry's release date too.
3. Refresh lockfiles if changing a manifest, review the diff, and commit the release.
4. Create a signed annotated tag such as `git tag -s v0.5.0 -m "Purple 0.5.0"`, then push that tag.

GitHub's tag source archive cannot be checksummed until the tag exists. The
release workflow therefore runs `updpkgsums` in its isolated checkout before
`makepkg`; it never uses `SKIP`. After a successful release, copy the generated
`PKGBUILD` into the separate AUR package repository and copy
`purple-music.SRCINFO` there as `.SRCINFO`. Review their tag and checksum before
pushing to the AUR.

## Verify a downloaded package

```bash
# Download every file named in SHA256SUMS, then verify the complete release set.
sha256sum --check SHA256SUMS
gh attestation verify purple-music-*.pkg.tar.zst \
  --repo ferdousbhai/purple
```

To verify the SBOM predicate as well:

```bash
gh attestation verify purple-music-*.pkg.tar.zst \
  --repo ferdousbhai/purple \
  --predicate-type https://spdx.dev/Document/v2.3
```

Install the verified package with `sudo pacman -U purple-music-*.pkg.tar.zst`.

## Repository settings

The maintainer must configure these controls in GitHub because repository files
cannot enable them:

- Protect `master`; require the Native Linux and Dependency Review checks and at least one approval.
- Require signed commits or signed tags for releases.
- Enable Dependabot security updates, private vulnerability reporting, secret scanning, and push protection.
- Make published GitHub Releases immutable when the repository setting is available.
