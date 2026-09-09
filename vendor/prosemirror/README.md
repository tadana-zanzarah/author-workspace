# Vendored ProseMirror ESM builds

This app has no bundler and loads ES modules directly in the browser via
`<script type="module">` (see `index.html`). npm packages that use bare
specifiers (`import {...} from "prosemirror-model"`) cannot be resolved by a
browser without either a bundler or an import map.

These files are the unmodified `dist/index.js` (ESM) build of each package,
copied from `node_modules` after `npm install`, and resolved in the browser
via the import map in `index.html`. They are committed so the app keeps
working as static files (e.g. GitHub Pages) with no build step.

| File | Package | Version |
|---|---|---|
| prosemirror-model.js | prosemirror-model | 1.25.11 |
| prosemirror-state.js | prosemirror-state | 1.4.4 |
| prosemirror-view.js | prosemirror-view | 1.42.3 |
| prosemirror-transform.js | prosemirror-transform | 1.12.1 |
| prosemirror-commands.js | prosemirror-commands | 1.7.2 |
| prosemirror-keymap.js | prosemirror-keymap | 1.2.3 |
| prosemirror-history.js | prosemirror-history | 1.5.0 |
| orderedmap.js | orderedmap | 2.1.1 |
| rope-sequence.js | rope-sequence | 1.3.4 |
| w3c-keyname.js | w3c-keyname | 2.2.8 |

`prosemirror-model`/`prosemirror-state`/`prosemirror-view`/`prosemirror-transform`/
`prosemirror-commands`/`prosemirror-keymap`/`prosemirror-history` are direct
`dependencies` in `package.json` (source of truth for the version to vendor).
`orderedmap`, `rope-sequence`, `w3c-keyname` are transitive dependencies of
the packages above, vendored here because the browser's import map needs
every bare specifier resolved directly (it does not do transitive
node_modules resolution).

## Re-vendoring after a version bump

```
npm install
cp node_modules/prosemirror-model/dist/index.js vendor/prosemirror/prosemirror-model.js
cp node_modules/prosemirror-state/dist/index.js vendor/prosemirror/prosemirror-state.js
cp node_modules/prosemirror-view/dist/index.js vendor/prosemirror/prosemirror-view.js
cp node_modules/prosemirror-transform/dist/index.js vendor/prosemirror/prosemirror-transform.js
cp node_modules/prosemirror-commands/dist/index.js vendor/prosemirror/prosemirror-commands.js
cp node_modules/prosemirror-keymap/dist/index.js vendor/prosemirror/prosemirror-keymap.js
cp node_modules/prosemirror-history/dist/index.js vendor/prosemirror/prosemirror-history.js
cp node_modules/orderedmap/dist/index.js vendor/prosemirror/orderedmap.js
cp node_modules/rope-sequence/dist/index.js vendor/prosemirror/rope-sequence.js
cp node_modules/w3c-keyname/index.js vendor/prosemirror/w3c-keyname.js
```

Then update the version table above and the import map in `index.html`.
