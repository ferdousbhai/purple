# Third-party notices

Purple-authored source code is licensed under the MIT License in `LICENSE`.
The application bundles separately copyrighted dependencies under their own
licenses; those license grants are not replaced by Purple's MIT license.

## GNU Affero General Public License components

The distributed application bundle incorporates the following packages under
the GNU Affero General Public License, version 3 or later:

- `@kabelsalat/core`, `@kabelsalat/lib`, and `@kabelsalat/web`
- `@strudel/core`, `@strudel/draw`, `@strudel/mini`, `@strudel/tonal`,
  `@strudel/transpiler`, `@strudel/web`, and `@strudel/webaudio`
- `superdough` and `supradough`

The complete AGPL text is in `LICENSE-AGPL-3.0-or-later`. The exact dependency
versions are recorded in `pnpm-lock.yaml`. Source for the corresponding Purple
release, including the build instructions and lockfile, is available from the
[Purple repository](https://github.com/ferdousbhai/purple). Upstream Strudel
source is available from the
[Strudel repository](https://codeberg.org/uzu/strudel).

The packaged application's license metadata lists both MIT and
AGPL-3.0-or-later to reflect this combination. This does not relicense
separately identifiable Purple-authored MIT files; redistributors remain
responsible for satisfying the licenses of the combined artifact.

## Other dependencies

Other JavaScript dependencies retain the licenses declared in their package
metadata. Their exact versions and resolved sources are fixed by
`pnpm-lock.yaml`.
