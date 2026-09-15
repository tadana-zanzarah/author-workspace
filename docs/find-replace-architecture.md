# Find / Replace — architecture

Status: **Stage A** (atomic cloud persistence foundation), **Stage B**
(headless matching/replacement engine), **Stage C** (current-scene panel,
shortcuts, highlighting, Replace/Replace All, across all three rich-text
surfaces), **Stage D1** (project-wide search, results, navigation),
**Stage D2.1.2** (authoritative project-wide Single Replace semantics — see
that section; it supersedes D2.1/D2.1.1's own "persists immediately"
contract), and **Stage D2.2.1** (project-wide **Replace All** — see that
section for the full fresh-plan/live-doc/conflict/atomicity contract) are
implemented. Project-wide Single Replace is still an ORDINARY, UNSAVED local
edit of the scene's active editor — it is **not** automatically persisted;
the scene's own existing Save flow is the only persistence path for it,
"Закрыть без сохранения" truly discards it, and project search always reads
the live mounted editor doc. Project-wide **Replace All** is a genuinely
different, separate operation: it commits immediately and atomically (one
`commitDataChange` locally, one `bulkUpdateSceneText` RPC call in the cloud —
**Stage D2.2.0** applied `20260910120000_scene_text_bulk_update.sql` to
production, and Stage D2.2.1 is its first and only caller), never through
Single Replace's own unsaved-edit path, and never touches any editor's own
Undo history. There is still no project-level/multi-scene Undo — Replace
All's own product brief explicitly excludes it (see Stage D2.2.1's own
"Undo" subsection). This document records the decisions later stages must
follow; it is deliberately not a full UI spec — unfinished UI details are not
documented here until they're built.

## Stage D1: project-wide search, results, navigation (this stage)

- **Mounted-scene registry** (`js/editor/mounted-scene-registry.js`):
  `sceneId -> Map<registrationId, {view,surfaceId,activate}>`, never a
  single-entry map — the same scene can have multiple simultaneous live
  registrations (e.g. the standalone editor and "Весь текст" open at once).
  Deterministic live-view preference when several registrations for one
  scene disagree: identical docs -> any of them; divergent docs -> the most
  recently `markMountedSceneActive`-marked registration (mount time counts as
  activation, so this is always resolvable today) -> only if genuinely
  unresolvable, an explicit `{status:"conflict"}` rather than arbitrary Map
  iteration order.
- **Project search** (`js/editor/find-replace-project-search.js`): headless,
  depends only on canonical project data (passed in, never imported), Stage
  B's `findMatches`, and the registry. Canonical order = `projectData.chapters`
  stored order (already includes `chapter-unassigned`) then
  `projectData.scenes` stored order within each chapter — the same walk
  `js/import-export.js`'s `openAllScenesNow` already does. Scope is every
  active scene regardless of `scene.included` (never `includedScenes()`).
  Live-vs-persisted resolution goes through the registry per scene; snippets
  are built from each match's own paragraph's real `textContent`, never the
  normalized comparison string. `reresolveMatch` re-derives a match against
  a current doc (exact from/to/text match, else same `occurrenceIndex`, else
  `null`) — the stale-navigation safety net.
- **Navigation adapter** (`js/editor/find-replace-navigation.js`):
  `navigateToSceneMatch(sceneId, matchRange, {query, caseSensitive,
  openSceneForEditing})`. Case A (already mounted): calls the registration's
  own `activate()`, re-resolves the match against the live doc, selects and
  reveals it (reusing `find-replace-controller.js`'s own `revealDocPosition`).
  Case B (not mounted): awaits the injected `openSceneForEditing` (the app
  wires this to `openSceneText`), then resolves case A against the freshly
  mounted registration. Knows nothing about modals/routes beyond that one
  injected function.
- **Controller/panel**: `find-replace-controller.js` gained a `scope`
  ("scene"|"project") plus project-result state, gated so every scene-scope
  code path Stage C already had is unchanged when scope is "scene" (the
  default). `find-replace-panel.js` gained the "Эта сцена"/"Весь проект"
  toggle and a compact grouped-by-scene results list. The results list is
  inserted as a DOM **sibling** of the find/replace row (after the whole
  `.rte-sticky-controls` wrapper in "Весь текст" specifically), never a
  child of it — a hidden child would corrupt Stage C's own accepted
  control-row geometry check, and in "Весь текст" a child would also join
  the sticky-pinned area and cover the manuscript.
- **Known D1 limitation**: navigating to a scene that isn't mounted anywhere
  goes through `openSceneText`, which (existing, pre-D1 behavior) enforces
  "exactly one rich-text editing surface open at a time" and closes whatever
  surface is currently open first. So cross-surface navigation to an
  unmounted scene does not preserve the *originating* panel's search
  context in that specific case — accepted per this stage's own product
  brief ("use the smallest safe behavior and report the limitation" rather
  than building new routing infrastructure). Same-surface navigation (already
  mounted, case A) and cross-surface navigation to an *already-mounted*
  scene both preserve the originating panel fully.
- **Known D1 limitation**: live project-result refresh on document edits
  (product brief section 12) only reacts to edits on the panel's own
  currently-attached `view` — it has no visibility into edits happening in a
  completely different, simultaneously-open surface/controller instance.
  A full cross-surface refresh would need a project-wide edit event bus,
  out of scope for this stage.
- **Follow-up UX debt (explicitly not solved, not to fold into Stage D2 by
  accident)**: navigating a project result to a scene mounted nowhere closes
  the originating panel/modal (see the limitation above) with no way back to
  the project result list/history afterward. A real "return to project
  search results after opening an unmounted scene" flow needs some kind of
  cross-surface search-session state or routing, which is a bigger design
  question than a fix pass should absorb silently.

## Corrective pass: manual-test regressions found after Stage D1

Manual testing of Stage D1 (base `dc5820d`) found several real defects, fixed
in place (same files, no new stage number) rather than deferred to Stage D2:

- **Decorations disappeared in project scope** — `setScope("project")`
  cleared the attached view's decorations and nothing ever replaced them.
  Root cause: project scope had no decoration story of its own at all. Fixed
  by `find-replace-controller.js`'s `applyProjectDecorations()`, the single
  place that now decorates EVERY mounted registration for every scene the
  current project result includes (via `mounted-scene-registry.js`'s
  `getMountedSceneRegistrations`), reusing the exact Stage C decoration
  primitive (`buildMatchDecorations`) — never a second highlighting system.
  A registration is only decorated when its own current doc still equals
  (`Node#eq`) the doc the search actually ran against; explicitly cleared
  when it drops out of the result set, scope changes, or the panel closes
  (`clearAllProjectDecorations`). `find-replace-navigation.js`'s own
  competing single-match decoration dispatch (the OTHER half of the same
  bug — two independent decoration dispatchers racing on one plugin key) was
  removed; navigation now only ever sets the real editor selection.
- **A "large selection" could result from navigation** — root-caused to a
  real, separate bug: a single-editor surface (Scene modal, standalone
  "Текст сцены") only ever destroys its PREVIOUS mount defensively on its
  NEXT open (existing, accepted pre-D1 pattern) — closing it just hides the
  modal, leaving its mounted-scene-registry registration alive, identical-
  doc, and (if it happened to be used/activated more recently) preferred
  over a genuinely visible mount for the same scene by
  `getPreferredLiveSceneView`'s own tie-break. Navigating a project result
  could therefore reopen a stale, hidden modal instead of acting on the
  visible one — which is what actually produced the reported symptom
  (wrong/oversized-looking target). Fixed in `mounted-scene-registry.js`:
  candidates are narrowed to VISIBLE ones (`view.dom.offsetParent!==null`)
  before any doc-equality/activation tie-break runs, falling back to the
  full usable set only if none are visible.
- **Opening Find always activated match #1** — fixed via
  `pickInitialActiveIndex`/`pickInitialProjectMatchIndex` in
  `find-replace-controller.js`: a genuinely FRESH activation (the tracked
  active index was `-1`, not merely reclamped after an edit) now prefers a
  match containing the caret, else the first match at/after it, else wraps
  to the first — for project scope, scoped to whichever scene is currently
  open in the attached view specifically. The existing "clamp after an edit
  shrinks the match list" policy is untouched.
- **Result-pane sizing/resizer** — a default ~6-row height
  (`DEFAULT_RESULTS_HEIGHT`) plus a small, local, min/max-bounded (90–420px),
  pointer- and keyboard-operable drag handle (`.rte-project-results-resizer`)
  between the results list and the editor.
- **Sticky/layout regression** — the results list is now wrapped in
  `.rte-project-results-wrapper` (`flex:none`) rather than being inserted
  bare: the standalone "Текст сцены" modal's `.modal` is a FIXED-height flex
  column whose only intended growing/shrinking child is `.rte-editor`
  (`flex:1 1 auto`); the un-wrapped results list previously had no explicit
  `flex` value and silently competed with the editor for the column's
  remaining space under the browser's default flex-shrink behavior,
  squeezing the manuscript's own visible area — this is what manual testing
  reported as "sticky behavior disappeared". `flex:none` is a harmless no-op
  for `#sceneModal`/`#allScenesModal`, which don't lay their `.modal` out as
  a flex column at all; `#allScenesModal`'s own `.rte-sticky-controls`
  itself was never actually broken (confirmed directly) but is now covered
  by regression tests alongside the standalone-surface fix.
- **Replace-lockout wording** — reworded from a promised/coming-soon-feature
  phrasing to a plain, factual "not available in this mode"; project-wide
  Replace stays out of scope and the controller-level guard
  (`replaceCurrent`/`replaceAll` refuse to run in project scope even called
  directly) is unchanged.

Regression coverage: `tools/mounted-scene-registry.test.mjs` (visibility
tie-break) and `tools/find-replace-project-search-browser.test.mjs` (all-
scene decorations, focus-loss persistence, scope-switch decoration
lifecycle, exact-range verification, caret-relative activation in both
scopes, resizer drag/clamp, sticky/layout). `tools/find-replace-current-
scene-browser.test.mjs` needed two assertions updated (not reverted) to
explicitly home the caret before checking a specific match index, since
"opening Find always selects match #1 regardless of caret" was itself one
of the behaviors this pass deliberately changed — the caret-relative
activation itself is covered by its own new assertions instead.

**Pre-existing, out-of-scope finding (not part of this pass, not introduced
by it, not introduced by Stage D1 either):** `tools/accessibility-
browser.test.mjs` fails the same way — "Полный текст не получил initial
focus" — at both `dc5820d` (Stage D1) and `455146f` (accepted Stage C base),
confirmed via clean worktrees at each exact commit with no other changes
present. Left unfixed here since it predates this entire branch and is
neither one of the seven defects this pass targets nor part of the Stage
C/D1/T1/T2 suites this pass was asked to re-run.

## Second corrective pass: live caret/selection semantics + highlight stability

Manual retest of the first corrective pass (base `a014053`) confirmed the
resizer, result pane, sticky/layout, and general cross-scene search all
worked, but found the ACTIVE-MATCH/navigation-origin state was stale and the
active-match visual treatment was unstable. Fixed in place:

- **Stale navigation origin (root cause)**: `next()`/`previous()` always
  stepped the STORED `activeIndex`/`activeProjectMatchIndex`
  (`(activeIndex+1)%matches.length`) — nothing ever re-read the live
  caret/selection once the panel was already open, so manually clicking
  elsewhere in the editor (same scene or, in "Весь проект", a genuinely
  different mounted scene) had no effect on where Next/Previous continued
  from. Fixed by `resolveSceneIndexFromCaret`/`resolveProjectIndexFromCaret`
  in `find-replace-controller.js`: both are called FRESH on every Next/
  Previous, reading `view.state.selection` at that exact moment (never
  cached/reactively tracked) — after the controller's OWN navigation, the
  live selection already sits exactly on the match it just set, so
  re-deriving "current" from it reproduces the identical index with no
  drift; when the user has moved the caret (or, in project scope, focused a
  different mounted scene — "Весь текст"'s own focus handling already
  retargets the attached `view` on every scene focus change), this picks
  that position up instead. The project-scope resolver walks the existing
  canonical-order `flat` array (contiguous per-scene blocks, from
  `find-replace-project-search.js`) so crossing a scene boundary in either
  direction is exact, not a guess. An explicit `navigation:true` marker on
  the shared `findReplacePluginKey` meta (set by both
  `dispatchNavigation()` and `find-replace-navigation.js`'s
  `selectAndReveal()`) makes "this selection change is the controller's own"
  an inspectable fact rather than a timing assumption, per the product
  brief's own explicit request — even though today's resolvers don't need to
  read it back to be correct (see the code comments for why).
- **Active-match highlight instability (root cause)**: the browser's own
  NATIVE text-selection rendering (a distinct visual layer with its own
  focused/vivid vs. unfocused/pale coloring, painted independently of an
  element's `background-color`) was competing with the `.rte-find-match{-active}`
  decoration classes wherever the real editor Selection happened to overlap
  a match — which it always does right after navigation, since
  `dispatchNavigation`/`selectAndReveal` deliberately move the real
  selection onto the active match (the accepted Stage C "the match becomes
  the actual selection" behavior, kept as-is). Fixed with scoped
  `::selection` CSS rules (`css/editor.css`) that make the native selection
  paint with the SAME colors the decoration already uses, so the visual
  result is stable regardless of focus or of whether the caret/selection
  happens to be inside the match — no decoration-side JS changes needed, no
  new highlighting system.
- **Highlight disappearing under a user selection (root cause)**: the same
  native-selection layer, this time simply obscuring a decoration's
  background wherever an ARBITRARY (non-search) user selection happened to
  overlap it — the underlying `DecorationSet` was never actually cleared by
  any code path (a pure selection-only transaction was always a no-op for
  the decorations plugin), only the browser's own default selection color
  visually painted over it. The same scoped `::selection` rules fix this
  too: text inside a decorated match keeps that match's own color even
  under an arbitrary selection, while text outside stays exactly the normal
  default color — never disabling `::selection`/user selection.
- **Result-pane default height** lowered from ~6 rows to ~4
  (`DEFAULT_RESULTS_HEIGHT` 210px → 140px in `find-replace-panel.js`); drag/
  keyboard resize and existing min/max bounds (90–420px) unchanged.

Regression coverage (all in `tools/find-replace-project-search-browser.test.mjs`,
continuing this file's own established corrective-pass sections): current-
scene manual caret reposition on all three surfaces (including a follow-up
plain Next proving the controller's own navigation selection is read back
correctly, not reinterpreted); project scope same-scene reposition; project
scope cross-scene reposition in both directions, confirming canonical order
is respected and there is no jump back to the old scene; active-match
decoration-class stability across focus loss and caret movement; an
arbitrary user selection spanning a match leaving every decoration in place,
both during and after the selection; and the scoped `::selection` rules
actually being registered. Full unit suite, `find-replace-current-
scene-browser` (Stage C), and the T1/T2 rich-text/dirty/scroll suites were
re-run and remain green with zero changes needed to any of them.

**Known limitation (pre-existing, inherited from Stage D1's own design, not
introduced by this pass)**: the project-scope "which scene is the attached
view currently showing" check (`pickInitialProjectMatchIndex`,
`resolveProjectIndexFromCaret`, `applyProjectDecorations`) identifies a
scene by comparing ProseMirror `Node#eq` (structural/content equality)
against each search result's own stored doc — not by scene id. Two
DIFFERENT scenes with byte-for-byte identical prose would be
indistinguishable to this check. This is an existing characteristic of how
Stage D1 wired live-view resolution throughout (see `find-replace-project-
search.js`'s `resolveSceneDoc`, unchanged here), not a new bug from this
pass; a robust fix would mean threading the scene id itself through
`attachView`, which is exactly the kind of broader editor-lifecycle change
this pass was explicitly told not to undertake.

## Final D1 hardening pass (before Stage D2): sticky results, destination decorations, sceneId-based identity

Manual retest of the second corrective pass (base `57d03f6`) found two
remaining UX/integration defects, and the `Node#eq` scene-identity
limitation documented above was explicitly called out as unsafe to carry
into Stage D2 (project-wide writes cannot rely on document-content equality
to know which scene they're touching). All three fixed in place:

- **Non-sticky project results in "Весь текст" (root cause)**: the results
  pane (`.rte-project-results-wrapper`) was inserted as a SIBLING of
  `.rte-sticky-controls`, in normal document flow -- so it scrolled away
  with the manuscript while the toolbar/find-replace row above it (INSIDE
  `.rte-sticky-controls`) stayed pinned. The first corrective pass had
  deliberately kept it outside the sticky region because, at the time, the
  results list had no bounded height (an unbounded `max-height:260px`
  overflow risk that could have grown tall enough to cover the manuscript).
  That concern no longer applies once the pane gained an explicit, JS-
  managed, hard-capped height (`DEFAULT_RESULTS_HEIGHT`/`MIN_RESULTS_HEIGHT`/
  `MAX_RESULTS_HEIGHT`, second corrective pass) -- so `find-replace-panel.js`
  now appends the results wrapper as `.rte-sticky-controls`'s own last child
  in "Весь текст" specifically (detected via `container.closest
  (".rte-sticky-controls")`), making the whole block (toolbar + controls +
  results + resizer) stick and scroll as one unit through ordinary CSS
  layout alone. No JS changes were needed for "resizing must update the
  sticky vertical space" -- the sticky element's own rendered height already
  includes its children's heights, and `find-replace-controller.js`'s
  existing `stickyTopObstruction()` (which measures whatever height a
  `position:sticky` child currently has) already picks that up automatically.
  Standalone "Текст сцены"/Scene modal have no `.rte-sticky-controls`
  wrapper at all, so they keep the pre-existing sibling-insertion behavior,
  entirely unchanged.
- **Destination highlight falling back to a native-selection look after
  opening an unmounted scene (root cause)**: case B of `navigateToSceneMatch`
  (`find-replace-navigation.js`) mounts a BRAND NEW surface via
  `openSceneForEditing` -- a fresh `mountSceneEditor()` call that creates its
  own independent, closed `find-replace-controller` instance with zero
  connection to the ORIGINATING controller that drove the navigation (the
  one whose `applyProjectDecorations` normally does all project-scope
  decoration work). Nothing ever told that brand-new instance about the
  query or the target match, so the destination editor's own decoration
  plugin stayed at `DecorationSet.empty` -- the only visible trace of "this
  is a match" was the real editor Selection `selectAndReveal` already sets,
  which is exactly the native-selection-only look that was reported. Fixed
  by a new `applyFallbackSceneDecorations()` in `find-replace-navigation.js`,
  called ONLY for the case-B (just-mounted-via-fallback) path -- reusing the
  exact same `findMatches`/`buildMatchDecorations`/`findReplacePluginKey`
  primitives every other surface uses (never a second highlighting system):
  every match in the destination scene gets the normal dim treatment, the
  navigated-to one gets the strong active treatment, and (via the second
  corrective pass's scoped `::selection` CSS, which needed no changes here)
  that treatment is already focus-independent and survives an arbitrary user
  selection. No lifecycle hook or `setTimeout` was needed: `openSceneForEditing`
  is only ever awaited after `openSceneText`'s own `requestEditorTransition`
  has already run `mountSceneEditor()` synchronously, so the destination view
  is always fully mounted and registered by the time the `await` resolves.
- **`Node#eq` removed as a scene-identity mechanism**: `find-replace-
  controller.js` now tracks `attachedSceneId` alongside `view`, set by
  `attachView(newView, sceneId)` -- both real call sites
  (`scene-editor-controller.js`'s `mountSceneEditor` and
  `createSceneEditorGroup`'s own `activate()`) already had the scene id in
  scope, so this required no new plumbing beyond the function signatures.
  `pickInitialProjectMatchIndex` and `resolveProjectIndexFromCaret` (the two
  places that used to compare `view.state.doc` against each project-result
  entry's own `doc` via `Node#eq` to guess "which scene is this") now compare
  `entry.sceneId===attachedSceneId` instead -- an exact identity check,
  never a content guess. **Two remaining `Node#eq` calls in the codebase are
  NOT scene-identity decisions and were deliberately left as-is**:
  `find-replace-controller.js`'s `applyProjectDecorations` uses it as a
  STALENESS check on a registration ALREADY identified by `sceneId` (via
  `getMountedSceneRegistrations(sceneResult.sceneId)`) -- "is it still safe
  to apply these computed positions to this exact live doc", never "which
  scene is this"; `mounted-scene-registry.js`'s `getPreferredLiveSceneView`
  uses it to decide whether MULTIPLE registrations already known to share
  one `sceneId` currently agree on content, again never an identity
  decision (the registry's own `Map` has always been keyed by `sceneId`, at
  every stage of D1 -- it was never part of this bug). Confirmed via a
  dedicated regression (two different scene ids, `scene-twin-a`/`scene-twin-b`,
  sharing one byte-for-byte identical document) that caret movement,
  Next/Previous, decoration targeting, and result-row clicks all correctly
  resolve to the SPECIFIC scene the user is interacting with.

Regression coverage (all in `tools/find-replace-project-search-browser.test.mjs`):
identical-document two-scene navigation/decoration targeting; destination-
scene decoration state (all matches decorated, one active, focus-independent,
survives an arbitrary user selection) immediately after opening an unmounted
scene; and the sticky-region layout contract (results stay within the
viewport after a large scroll, the sticky region's own height grows when the
pane is resized, standalone/Scene-modal gained no sticky wrapper) without any
brittle pixel-perfect assertions. Full unit suite, `find-replace-current-
scene-browser` (Stage C), and the T1/T2 rich-text/dirty/scroll suites were
re-run and remain green with zero changes needed to any of them.

**Confirmed**: as of this pass, no Find/Replace production code path uses
`Node#eq`/ProseMirror document-content comparison to determine scene
identity anywhere. The two remaining `Node#eq` call sites are staleness/
agreement checks on already-`sceneId`-identified data, documented above.

## Stage D1 final fix: modal lifecycle bug + arrow-navigation scope + sticky gap

Manual testing on top of the final D1 hardening pass (base `e1ef4d0`) found
one critical modal/navigation lifecycle defect and two UX/navigation issues.
All three fixed in place, plus a dedicated investigation into whether search/
navigation alone can dirty a clean scene (it cannot -- see below).

### Critical: repeated navigation to an unmounted scene could leave two modals open at once

**Root cause**: `mounted-scene-registry.js`'s `getPreferredLiveSceneView`
narrows candidates to VISIBLE registrations first, falling back to the full
usable set only when NONE are currently visible ("better to reveal something
than nothing" -- needed by callers like live project search, which
legitimately wants the best available content regardless of on-screen
visibility). That fallback branch, however, was also being trusted by
`find-replace-navigation.js`'s `navigateToSceneMatch` as a safe "already
mounted, just activate it" (case A) signal. Because this app's existing,
accepted "defensive destroy-before-create" pattern (standalone "Текст
сцены"/Scene modal only destroy their PREVIOUS ProseMirror mount on their
NEXT open -- closing via button/Escape/backdrop just hides the modal) leaves
a registration alive long after the surface showing it has closed, a scene
visited once via case B (e.g. "Нигде не открыта", opened from a project
result) could later be the SOLE, STALE, HIDDEN registration on record. Re-
navigating to that same scene a second time then satisfied
`getPreferredLiveSceneView`'s "only one candidate, and nothing else to
disagree with" check, reporting `status:"ok"` -- so `navigateToSceneMatch`
took case A and called that stale registration's own `activate()` directly.
`activate()` just re-shows the modal (`revealSurface()` -> `showModal()`); it
never runs `requestEditorTransition`'s own "close whichever editing surface
is currently open FIRST" step, because that step only exists in the case-B
(`openSceneForEditing`) path. Net effect: the surface that was open when the
user triggered this second navigation (e.g. "Весь текст") stayed at
`display:flex` underneath the reopened standalone modal -- two simultaneous
"open" modals, exactly the invisible-overlay/blocked-controls state manual
testing reported. Confirmed via instrumented reproduction (not assumed):
navigating to two DIFFERENT unmounted scenes never reproduced it; repeatedly
navigating to the SAME previously-opened scene reproduced it reliably on the
second visit, and `console.log` tracing inside `requestEditorTransition`
confirmed the destination's own transition call never ran at all in the
failing case (case A was taken, not case B) -- not a crash, not a z-index
issue, not a focus/inert bug.

**Fix (narrow, no modal-framework changes)**: `getPreferredLiveSceneView`
now returns an explicit `visible` boolean alongside `status`/`registration`
-- true only when the chosen registration came from the VISIBLE subset, not
the "nothing was visible, fall back to the full usable set" branch.
`navigateToSceneMatch`'s case-A gate is now `preferred.status==="ok" &&
preferred.visible`; a stale-but-technically-usable hidden registration is
treated the same as "not mounted at all" and goes through the real case-B
open flow instead, which correctly destroys the stale mount and runs the
single-surface transition (close-current-then-open-next) before showing
anything. Every other existing caller of `getPreferredLiveSceneView`
(project search's live-doc resolution) ignores the new field and is
unaffected -- it never cared about on-screen visibility, only content.

Regression: `tools/find-replace-project-search-browser.test.mjs` now
navigates to the SAME unmounted scene from "Весь текст" across **two** full
open -> close -> reopen -> re-search -> click cycles, auditing (after both
the open and the close of each round) the FULL `window.modalStack` and every
`.modal-backdrop`'s own inline `style.display` -- not just the one modal
expected to be affected -- for exactly one open modal and zero orphaned
backdrops, plus a direct check that the destination editor and its Close
control are genuinely visible/interactive each time (the literal "controls
unclickable"/"invisible overlay" symptom reported). Audits check the
inline `style.display`, not `getComputedStyle`, deliberately: closing a
modal fades it out over an intentional, pre-existing 160ms CSS transition
(`css/modals.css`'s `allow-discrete` display transition), during which
`getComputedStyle` still reports the old value -- checking inline style
avoids a false positive against that unrelated, correct animation.

### Can search/navigation/decorations alone dirty a clean scene?

Investigated directly (opening Find, changing scope, typing a query with its
resulting cross-scene decoration dispatches, clicking an already-mounted
project result, clicking an unmounted one with its fallback decorations) --
**no**. Every one of those paths only ever dispatches a selection change
and/or a `findReplacePluginKey` decoration-only transaction (both explicitly
tagged and never touching `doc`), so `handleTransaction`'s own
`tr.docChanged` guard (and thus every dirty tracker's `isDirty()`, which
diffs a normalized DOM-forms snapshot) never sees a reason to flip. Proven,
not just asserted, by a dedicated regression in
`find-replace-project-search-browser.test.mjs` asserting
`trackerFor(id).isDirty()===false` after each of those operations in
sequence, including on the DESTINATION surface after a case-B navigation.

### Arrow (Next/Previous) navigation must never leave the current visible editing context

**Problem**: in project scope ("Весь проект"), Next/Previous stepped through
the ENTIRE canonical project match list (`flattenProjectMatches`), including
matches in excluded/unmounted scenes -- so an arrow press could silently
delegate through `openSceneForEditing` and open a scene the user wasn't even
looking at, exactly like clicking a project-results row does. That conflates
two UX operations that should stay separate: an explicit result-row click is
deliberate full-project navigation (unrestricted, unchanged -- see
`activateProjectMatch`), while Next/Previous is meant to stay within
whatever the user is currently, visibly editing.

**Fix**: `find-replace-controller.js`'s factory takes an optional
`getNavigableSceneIds()` dependency -- the set of scene ids Next/Previous may
land on right now. `createSceneEditorGroup` ("Весь текст") wires its own
`sceneIds()` (exactly the scenes mounted INSIDE that one group instance,
never scenes merely open elsewhere); `mountSceneEditor` (standalone "Текст
сцены", Scene modal) never wires it at all, which makes the controller
default to "just the one attached scene" -- exactly right for a single-
editor surface, with no extra code needed at that call site.
`next()`/`previous()`'s project-scope branch now filters the canonical flat
match list down to this navigable domain (`navigableProjectMatches`) BEFORE
resolving the caret-relative origin or falling back to a modular step
(`resolveProjectDomainIndexFromCaret`/`domainIndexForMatchId`) -- so stepping
past the attached scene's own last/first match continues into the next/
previous scene *within the domain* (another mounted scene in "Весь текст";
wraps back within the one open scene for standalone/Scene modal) rather than
into the canonically-next scene in the whole project, which could be
excluded or simply not open anywhere. Because every domain match's scene is,
by construction, already mounted and visible,
`triggerProjectNavigation()`'s call into `navigateToSceneMatch` always
resolves via case A here -- it can no longer reach case B's "open a scene
that isn't currently open" fallback from an arrow press. This is achieved
entirely by restricting the candidate pool feeding the existing
caret-resolution algorithm; `navigateToSceneMatch`/`activateProjectMatch`
themselves are unchanged, and explicit result-row clicks remain fully
unrestricted (can still open an unmounted scene, with full normal + active
decorations, per the pre-existing accepted limitation that doing so closes
the originating "Весь текст"/modal).

Regression: two dedicated scene pairs were added to the fixture project --
`scene-arrow-mounted-1`/`scene-arrow-mounted-2` (both mounted) plus
`scene-arrow-unmounted` (excluded, sharing the same query) for "Весь текст";
`scene-arrow-standalone` (three matches in one scene) plus
`scene-arrow-standalone-excluded` (excluded, sharing the same query) for
standalone/Scene modal. Tests confirm: in "Весь текст", Next/Previous cycles
only between the two mounted scenes, wraps at the ends of that visible set
(first-visible + Previous -> last-visible; last-visible + Next ->
first-visible, the task's own worked example in both directions), and never
opens any other modal even though the excluded scene's result row is
genuinely present and clickable in the list; in standalone and the Scene
modal, Next/Previous wraps entirely within the one open scene's own three
matches and never reaches (or opens) the excluded sibling scene. Live-caret
redefinition of the navigation origin (moving the caret/focus into a
different MOUNTED "Весь текст" scene) is covered by the existing corrective-
pass regression (`scene-lynx-a`/`scene-lynx-b`, both mounted) plus this
pass's own mounted-pair test -- both continue to pass unchanged, confirming
the domain restriction did not disturb mounted-to-mounted caret-relative
navigation.

### Sticky search region: gap between the toolbar/Find-Replace row and the results pane

**Root cause**: "Весь текст"'s sticky region (`.rte-sticky-controls`)
zeroed only `.rte-toolbar`'s own trailing `margin-bottom:10px` (so the
toolbar and the Find/Replace row sit flush), but `.rte-find-replace` kept
its own `margin-bottom:10px` intended for "the gap before the manuscript
list that follows the WHOLE sticky wrapper" -- correct while
`.rte-find-replace` was always the sticky region's last child. Once
`.rte-project-results-wrapper` is ALSO visible inside that same sticky
region (scope="Весь проект" with a matching query -- moved inside the sticky
wrapper by the previous, final D1 hardening pass), it became a second
in-flow sibling AFTER `.rte-find-replace`, inheriting that trailing margin
as a transparent ~10px slit BETWEEN the two rows, with manuscript text
visible sliding past through it during scroll.

**Fix**: every inner row's own bottom margin is zeroed inside
`.rte-sticky-controls` (`.rte-toolbar`, `.rte-find-replace`, now also
`.rte-project-results-wrapper`), and the ONE intentional trailing gap moved
to `.rte-sticky-controls` itself via `padding-bottom:10px` -- so it always
lands after whichever row is genuinely last, regardless of which are
currently visible, with zero internal gaps for manuscript to show through
and no double borders (each row keeps its own single `border-bottom`
divider). Purely a spacing/margin change; the resizer, the 4-row default,
and the sticky-position mechanics themselves are untouched.

Regression: a new check in `find-replace-project-search-browser.test.mjs`
measures the actual layout geometry -- the Find/Replace row's bottom edge
and the results wrapper's top edge must coincide (within 1px), and the
sticky region's own bottom edge must sit ~10px past the results wrapper's
bottom edge (the one relocated trailing gap, not a doubled one).

### Registry/modal cleanup audit (item 7)

No additional registry or modal-lifecycle changes were made beyond the
`visible`-flag fix above. The existing "defensive destroy-before-create"
pattern (surfaces destroy their PREVIOUS mount on their NEXT open, not on
close) is pre-existing, accepted architecture, not something this pass
revisits -- the `visible` flag makes `navigateToSceneMatch` correctly
distinguish "genuinely reveal-able right now" from "on record but stale"
without requiring any surface to proactively unregister/destroy on close, so
multiple simultaneous, genuinely-mounted registrations of the same scene
(e.g. open in both "Весь текст" and a standalone modal at once) remain fully
supported and untouched. No broader modal-framework rewrite was needed or
attempted.

## D1.1: arrow counter is navigation-domain-relative, not project-wide

Manual testing on top of the D1 final fix (base `35f1c60`) found the arrow
counter ("N из M" next to ↑/↓) misrepresenting what the arrows could actually
reach: it read `projectResult.totalMatches` (every match in every scene the
project search found, including scenes outside the current surface's own
navigation domain) as its denominator, while Next/Previous had already been
restricted to that domain by the D1 final fix. Two conceptually distinct
things must stay distinct, and the UI must derive its numbers from whichever
one actually applies:

- **Global project result set** -- `projectResult`/`flattenProjectMatches`,
  unchanged: total match count, affected scene count, every result row
  (including off-domain/excluded scenes), and what an explicit row click can
  reach. Still project-wide on every surface.
- **Current navigation domain** -- exactly `navigableProjectMatches(flat)`
  (`find-replace-controller.js`), the SAME function `next()`/`previous()`
  already call. Used for the arrow counter and nothing else.

**Fix**: `find-replace-controller.js`'s `snapshot()` now also computes
`domainMatches=navigableProjectMatches(flat)` (scope `"project"` only) and
exposes `navigableMatchCount` (its length) and `activeNavigableMatchIndex`
(the active match's position within it, by `matchId`, or `-1` if the active
match isn't in the domain). No second "is this navigable" definition was
written anywhere -- the panel only ever reads these two snapshot fields, and
the arrow counter renders `activeNavigableMatchIndex+1` of
`navigableMatchCount` (falling back to the existing "0 из 0" convention, and
disabling ↑/↓, whenever `navigableMatchCount` is 0 -- e.g. the current
scene/domain has no matches even though the project does elsewhere).

**Superseded by the D1.1 wording follow-up below**: this pass ALSO added an
`offSurfaceMatchCount`/`isGroupSurface`-driven `· ещё N вне «Весь текст»`
suffix to the project-results summary. Manual review found that wording
miscounted (it measured off-domain MATCHES, not excluded SCENES, and could
read as reporting an ADDITIONAL scene on top of the affected-scene count
rather than a subset of it) and, being gated to "Весь текст" only, left
standalone/Scene modal without any equivalent summary at all. Replaced
entirely -- see the follow-up section immediately below for the current,
correct mechanism; `offSurfaceMatchCount`/`isGroupSurface` no longer exist.

Explicit result-row clicks (`activateProjectMatch`) are unchanged and remain
fully unrestricted, including into off-domain/excluded scenes; after such a
click opens a new destination surface, that surface's OWN (fresh) controller
instance computes its own domain/counter from scratch -- the destination
counter naturally reflects wherever the user actually landed, never the
originating surface's numbers.

Regression coverage added to `tools/find-replace-project-search-browser.test.mjs`
(counter-denominator assertions still stand as originally written; the
summary-text assertions were updated in the D1.1 wording follow-up below to
match the corrected wording): a "гепард" fixture (2 mounted scenes, 3 matches
total, plus 50 more in one excluded scene) proving the "Весь текст" counter
denominator is 3 (not 53) and that a full 4-press Next cycle wraps back to
its own starting numerator without ever opening the excluded scene; the
"тюлен" standalone/Scene-modal fixture (3 matches in one scene + 1 in an
excluded sibling) proving the counter there reads against 3 (not 4); a "морж"
fixture matching only an excluded scene, proving both surfaces show "0 из 0"
with ↑/↓ disabled while the project result row stays present and clickable;
and a case-B click on an off-domain result (`scene-unmounted`, already used
by the D1 final fix's own modal-lifecycle regression) confirming the
destination's own counter reflects its own 3-match domain.

## D1.1 wording follow-up: project-results summary is global on all three surfaces, "excluded" means the existing scene setting

Manual review of the D1.1 counter fix (base `746b9ad`) found the project-
results summary's wording semantically misleading, and missing entirely on
two of the three surfaces:

- **Wording**: `· ещё N вне «Весь текст»` read as "N matches ADDITIONAL to
  the N scenes already reported" -- easy to misread as `affectedSceneCount +
  N`, when N was actually a MATCH count (off-domain matches), not a SCENE
  count, and had no subset relationship to `affectedSceneCount` at all.
- **Missing on standalone/Scene modal**: the suffix was gated to
  `isGroupSurface` (true only for "Весь текст"), so those two surfaces never
  showed any equivalent summary, even though the underlying fact (some
  affected scenes aren't included in the general text) is just as true and
  just as relevant there.

**Fix**: the project-results summary is now defined as a single, surface-
INDEPENDENT concept -- `<totalMatches> совпадений · <affectedSceneCount>
сцены[ · <excludedSceneCount> сцен не включены в общий текст]` -- shown
identically on "Весь текст", standalone "Текст сцены", and the Scene modal.
`excludedSceneCount` is a SUBSET of `affectedSceneCount`, never added to it,
and is computed once, canonically, in `find-replace-project-search.js`'s
`searchProject()`: each `sceneResult` now also carries `included:
scene.included!==false` (the exact same "Включить сцену в общий текст и
выгрузку" flag `js/scenes.js`/`js/import-export.js`'s `includedScenes()`
already read -- no second interpretation of it), and
`excludedSceneCount=scenes.filter(s=>!s.included).length` is returned
alongside `affectedSceneCount`. The controller no longer computes anything
for this at all (the previous pass's `offSurfaceMatchCount`/`isGroupSurface`
snapshot fields were removed) -- `find-replace-panel.js` reads
`projectResult.affectedSceneCount`/`excludedSceneCount` directly, so this
is the same number on every surface by construction, never re-derived per
surface.

Terminology: `«не включена/не включены в общий текст»`, aligned with the
existing scene-settings checkbox's own wording, never "скрытая
сцена"/"hidden scene"/"вне «Весь текст»"/"off-surface" in user-facing text.
Grammar (noun `сцена/сцены/сцен` AND verb `не включена/не включены`,
including the classic mod-10/mod-100 "11-14 are always the 'many' form"
exception) is produced by two small, exported, pure helpers in
`find-replace-panel.js` (`ruPluralForm`, `pluralRu`, `excludedScenesClause`)
-- one Russian-plural-bucket implementation shared by the noun and the verb,
never two that could drift apart. This does not touch or duplicate any
existing i18n infrastructure; the app has none, and this task doesn't add
any beyond these three small functions.

The arrow counter (previous section) is UNCHANGED by this pass -- it stays
deliberately surface-relative (`navigableMatchCount`/
`activeNavigableMatchIndex`) and can legitimately differ from the now-global
summary shown right below it (e.g. "Весь текст" showing "4 из 28" next to a
"29 совпадений · 3 сцены · 1 сцена не включена в общий текст" summary that
also appears, verbatim, in a standalone modal showing "1 из 12" for that
scene's own domain).

Regression coverage: `tools/find-replace-panel-wording.test.mjs` (new, pure
unit test, no browser) exhaustively covers `ruPluralForm`/`pluralRu`/
`excludedScenesClause` for 0/1/2/5/11/21/22/25/100. Browser coverage in
`tools/find-replace-project-search-browser.test.mjs` was updated to assert
the new wording (replacing every prior "вне «Весь текст»" check) and extended
with: exact-string-equality proof that "Весь текст", standalone, and the
Scene modal render the IDENTICAL summary while their own arrow counters
differ (3 vs 1 vs 1, reflecting each surface's own domain); a 2-excluded-
scene fixture for the plural "не включены" form; and a zero-excluded-scenes
case (`scene-lynx-a`/`scene-lynx-b`, both included) proving no clause is
appended at all when nothing is excluded.

## Stage D2.1: safe single Replace in project scope

**Superseded by Stage D2.1.2 below.** This stage's central design decision —
Single Replace **persists immediately** through `updateSceneText`/
`commitDataChange` (via a mounted-state "agreement" gate,
`resolveMountedSceneAgreement`, and a synchronization fan-out,
`syncMountedRegistrations`) — was rejected by manual acceptance: it made
Replace look like an ordinary editor edit (undoable, can be discarded via
"Закрыть без сохранения") while secretly already being saved underneath.
Stage D2.1.2 replaces this with "Single Replace is an ordinary UNSAVED local
edit; only explicit Save persists it." The sections below are kept as a
historical record of what was built and why (the matcher/replacement engine,
stale-safety policy, `included` handling, and cloud/local persistence
*primitives* they describe are all still accurate and still reused) — but
`resolveMountedSceneAgreement`, `replaceProjectMatch` (the persisting
version), `syncMountedRegistrations`, and `applyUndoableReplacement` no
longer exist in the codebase; see Stage D2.1.2 for what replaced them.

Single Replace ("Заменить") now works in "Весь проект" scope, targeting
**only the currently active global match**. Project-wide **Replace All**
remains unimplemented (Stage D2.x/later — see "Project-wide Replace All
requires synchronized state" below, still accurate for what Replace All
itself will need); `bulkUpdateSceneText` and its migration are **not**
touched by this stage.

- **New module** (`js/editor/find-replace-project-replace.js`): headless,
  same DOM/modal-independence discipline as `find-replace-project-search.js`.
  - `resolveMountedSceneAgreement(sceneId)` — the pre-commit synchronization
    gate. Inspects EVERY live (non-destroyed) registration for a scene via
    `getMountedSceneRegistrations` (never `getPreferredLiveSceneView`'s own
    visible-first/activation tie-break, which is built to always resolve to
    a single answer — exactly wrong here) and compares doc CONTENT
    (`Node#eq`), never object identity — stable scene identity stays
    `sceneId` throughout, as everywhere else in this subsystem. Returns
    `{status:"none"}` (no live registration — the persisted doc is current),
    `{status:"agree",doc}` (every live registration's doc agrees, trivially
    true for exactly one), or `{status:"conflict"}` (two or more disagree —
    Replace must abort before any mutation, never pick a winner).
  - `replaceProjectMatch({sceneId,matchRange,query,caseSensitive,
    replacementText,getProjectData,saveSceneText,rebaseSceneDirtyBaseline})`
    — the full single-Replace flow: resolve agreement → if the agreed live
    doc differs from persisted, synchronize it through the SAME canonical
    single-scene save path FIRST (a plain text-only save, not a Replace) →
    re-resolve the target match against the now-current document via
    `reresolveMatch` (Stage D1's own stale-safety policy, reused verbatim,
    never a blind offset reuse) → build the replacement via `replaceOneMatch`
    (Stage B, reused verbatim — Find and Replace can never disagree on what
    "a match" is) → no effective doc change → report `changed:false`, no
    persistence, no dirty state → otherwise commit through `saveSceneText`
    and report the committed doc. `saveSceneText`/`rebaseSceneDirtyBaseline`
    are injected dependencies (never imported directly), keeping this module
    ignorant of cloud/local specifics — the same dependency-injection
    pattern `getProjectData`/`navigateToSceneMatch` already use.
  - `syncMountedRegistrations(sceneId,committedDoc,{resolvedMatch,
    replacementText})` — pushes the committed doc into EVERY mounted
    registration for the scene (never only the visible/preferred one — a
    hidden-but-mounted registration, e.g. a standalone modal closed via
    Escape/backdrop per this app's existing "destroy on next open" pattern,
    must not remain stale). Every dispatch is tagged `addToHistory:false` —
    a project-wide Replace must never become a ProseMirror undo entry;
    Ctrl/Cmd+Z keeps referring only to that editor's own ordinary history.
    Prefers REPLAYING the same localized `replaceOneMatch` transform as the
    registration's own small transaction (verified safe by checking its
    result against `committedDoc` first) over a wholesale full-document
    replace — a wholesale replace, while still correctly never becoming its
    OWN undo entry, maps every OTHER pending edit already in that view's own
    undo history through a "delete everything, reinsert everything"
    transform that `prosemirror-history` can no longer safely rebase across,
    silently losing that unrelated edit's own undo entry (confirmed by
    reproducing it in the browser suite before this fix). The wholesale
    replace is kept as a fallback for a registration that genuinely diverged
    during the one async gap in the whole flow (the `saveSceneText` await).
- **Controller integration** (`find-replace-controller.js`): new
  `replaceProjectCurrent()`, the project-scope mirror of `replaceCurrent()`
  (which still refuses to run under scope "project", unchanged) — refuses to
  run under scope "scene". Resolves the active GLOBAL match (by
  `activeProjectMatchIndex` into `flattenProjectMatches(projectResult)` —
  never navigation-domain-restricted the way Next/Previous are; an explicit
  result-row click, like this Replace action, can target ANY project result
  including an off-domain/excluded scene), delegates to
  `replaceProjectMatch`, and on a real change (`changed:true`) calls
  `syncMountedRegistrations` then the EXISTING `recomputeProject()` — never a
  manual patch of counts/offsets/snippets. `recomputeProject()`'s own
  pre-existing "keep the same numeric flat index, clamped into the new
  range, else -1" policy is what selects the next logical active match for
  free (the same trick scene-scope `replaceCurrent()` already relies on via
  ordinary `recompute()`): removing the replaced match shifts every later
  match's flat index down by one, so the unchanged `activeProjectMatchIndex`
  now names whatever took its place; if nothing remains it lands on `-1`,
  the existing zero-results state. A failure (`conflict`/`stale`/
  `sync-failed`/`persist-failed`/`not-configured`/`no-active-match`/
  `wrong-scope`) never syncs/rebases/re-searches — no fake committed state.
- **Dependency wiring** (`scene-editor-controller.js`'s `projectSearchDeps`,
  threaded through `mountSceneEditor`/`createSceneEditorGroup`'s existing
  optional-param pattern): `saveSceneText`/`rebaseSceneDirtyBaseline` are new
  optional pass-throughs, wired for real at the app layer —
  `js/import-export.js`'s `saveSceneTextCanonical(sceneId,{sceneText,
  sceneTextDoc})` (the exact same `updateSceneText`/`commitDataChange`
  branches `saveAllScenes()`'s own per-scene loop already uses, just
  addressed at one explicit sceneId — never `bulkUpdateSceneText`) and
  `js/app.js`'s `rebaseSceneTextDirtyBaseline(sceneId,sceneTextDocJSON)`
  (walks every mounted registration's own `surfaceId` for that scene and
  calls that tracker's `rebaseExtra` — see below).
- **Dirty-state addition** (`js/dirty-state.js`): `tracker.rebaseExtra
  (updater)` — rebases ONLY `baseline.extra` (never `baseline.controls`, and
  `updater` itself decides which key(s) of `extra` to replace, e.g. `doc`
  for sceneModal/textModal or one entry of `docs` for allScenesModal) so a
  programmatic, out-of-band text commit stops reporting as dirty WITHOUT
  silently accepting any other currently-pending, unrelated dirty state in
  the same open form — explicitly NOT a full `captureInitialState()`, which
  would wrongly accept it too. A no-op while the tracker isn't active.
- **UI** (`find-replace-panel.js`): "Заменить" is now enabled in project
  scope whenever there's an active global match
  (`snapshot.activeProjectMatchId!=null`) and dispatches to
  `replaceProjectCurrent()`; "Заменить все" stays disabled with its existing
  explanatory title (Replace All is still out of scope). A new, minimal
  `.rte-project-replace-status` line (inside `resultsWrapper`, never a child
  of the find/replace row itself, so it cannot disturb Stage C's own "one
  compact control row" geometry check) surfaces a plain factual message on a
  controlled failure (conflict/stale/persist failure) — cleared
  automatically on the next fresh render, never a new conflict-resolution
  UI.

Regression coverage: `tools/find-replace-project-replace.test.mjs` (headless
— real ProseMirror schema/EditorState, fake view stand-ins, injected
save/rebase callbacks) covers stale-safety (valid offset, shifted text,
unresolvable occurrence, longer/shorter/empty/identical replacement), scene
identity, `included:false`, every mounted-agreement case A–E, post-commit
synchronization (including the `addToHistory:false` + history-preserving-
replay guarantees), failure/atomicity (no fake success on a sync or commit
failure), and the full controller-level flow (active match selection after
Replace, zero-results clearing, wrong-scope guards). `tools/dirty-
state.test.mjs` covers `rebaseExtra` directly for both the single-doc and
docs-map tracker shapes.
`tools/find-replace-project-replace-browser.test.mjs` (new) proves the same
end to end against the real running app: a real click → real
`commitDataChange` persistence → fresh search → a real mounted-state
conflict (reproduced via this app's own existing "close via Escape/backdrop
leaves a hidden, still-registered surface" pattern, the same one Stage D1's
own hardening passes exercise) → `included:false` → dirty-baseline behavior
in a real Scene-modal form (an unrelated pending title edit survives the
text-only rebase).
`tools/find-replace-project-search-browser.test.mjs`'s own Replace-lockout
assertion was updated (not reverted) to match this stage's intentional
behavior change — "Заменить" is now expected enabled once a project-scope
query has an active match; "Заменить все" stays disabled.

**Superseded by Stage D2.1.1 below:** this stage's own original undo
behavior — "one Ctrl+Z after a Replace undoes an EARLIER real typed edit,
never the Replace itself" (`syncMountedRegistrations` dispatching
`addToHistory:false` into EVERY mounted registration, including the one the
user was actively looking at) — was a deliberate D2.1 decision, but manual
acceptance changed the product rule: see Stage D2.1.1 for the current,
correct behavior (the active target editor's own Replace IS now a normal,
undo-able edit). Stale-match re-resolution, `included:false` handling, and
cloud/local persistence *primitives* described above are all still accurate;
the mounted-state agreement gate specifically is **superseded by Stage
D2.1.2** below (Single Replace stopped persisting at all, so there is no
longer anything to gate a commit on).

## Stage D2.1.1: UX/Undo follow-up for project-wide Single Replace

**Superseded in part by Stage D2.1.2 below.** Goal A (session
preservation/`adoptProjectSession`/`pendingActiveTarget`/
`reresolveFlatMatchIndex`) is unchanged and still accurate. Goal B's own
mechanism — `applyUndoableReplacement` giving the ACTIVE editor a normal
transaction while `syncMountedRegistrations` pushed the SAME committed doc
into every OTHER ("secondary") mounted registration with `addToHistory:
false` — no longer exists: once Single Replace stopped persisting (D2.1.2),
there is nothing to "commit" that a secondary registration could need
synchronizing to, so secondary registrations are now left completely alone
(see D2.1.2's Finding C). The `closeHistory`-based undo-isolation technique
itself is still used, just simplified to the one dispatch that now exists.

Manual acceptance of Stage D2.1 found two gaps before it could be considered
complete — both fixed in place, same files, no new stage number beyond this
one:

**Finding 1 — the project-wide Find/Replace session was lost after
navigating to another scene.** Clicking a project result for a scene mounted
nowhere (`find-replace-navigation.js`'s case B) opened a brand-new
`mountSceneEditor()` call, which created its own, independent, EMPTY
`find-replace-controller.js` instance — the originating controller's own
query/replacement/scope/results stayed behind, hidden, on the
now-backgrounded surface. The destination showed passive highlights only,
with no way to press "Заменить" for what the user had just clicked.

**Finding 2 — project-wide Single Replace did not participate in the
scene's normal Undo history.** `syncMountedRegistrations` dispatched
`addToHistory:false` into EVERY mounted registration uniformly, including
whichever one the user was actively looking at. Manual UX review changed
the product decision: a project-wide Single Replace changes exactly one
scene and should behave like an ordinary text edit THERE — Ctrl/Cmd+Z
immediately after should undo it, like any other edit.

### Fix 1: session handoff via the existing `openSceneForEditing` hook (Goal A)

The smallest point where the current project-wide session could be handed to
a freshly-created controller turned out to be the SAME hook case B already
calls to open the destination (`openSceneForEditing`) — no new global state,
no parallel copies, one explicit object passed through the existing call
chain:

- `find-replace-controller.js`'s `triggerProjectNavigation()` now passes
  `replaceText` alongside the query/caseSensitive it already sent to
  `navigateToSceneMatch`.
- `find-replace-navigation.js`'s `navigateToSceneMatch` builds one small,
  caller-owned object — `projectSession = {query, caseSensitive,
  replaceText, target:{sceneId,from,to,text,occurrenceIndex}}` — and hands
  it as a second argument to `openSceneForEditing(sceneId, {projectSession})`
  whenever case B has to open a scene nowhere previously mounted. Case A
  (already visibly mounted) needs no handoff at all — since this app only
  ever shows one editing surface at a time, case A can only ever target a
  scene already inside the SAME controller that's searching, so it already
  preserves everything by construction (unchanged from Stage D1).
- The hook's real implementations (`openSceneText`/`openSceneTextNow` in
  `js/scenes.js`, and the `openSceneForEditing` bindings in
  `js/scenes.js`/`js/import-export.js`) now accept and forward this second
  `extra` argument unchanged — a caller that omits it (every pre-D2.1.1 call
  site) behaves exactly as before. Existing unsaved-change protection is
  untouched and runs FIRST: `openSceneText`'s own
  `requestEditorTransition`/`confirmDiscardIfDirty` dirty guard still gates
  the whole open — `projectSession` only ever reaches the destination mount
  if the transition actually proceeds, so cancelling the guard neither
  adopts a session anywhere nor perturbs the originating one.
- `scene-editor-controller.js`'s `mountSceneEditor` gained an optional
  `projectSession` parameter, forwarded straight from `openSceneTextNow`.
  Right after creating the new controller (and BEFORE `attachView`, so the
  first `recomputeAndReveal()` that `attachView` triggers already runs with
  the adopted state), it calls the controller's new
  `adoptProjectSession(session)`: sets `scope="project"`,
  `query`/`replaceText`/`caseSensitive` from the session, `open_=true`, and
  stashes `session.target` as `pendingActiveTarget` — deliberately NOT a
  copy of the originating controller's `projectResult`/active index (a
  fresh `searchProject()` runs instead, since canonical project data may
  have moved on and Find/Replace never trusts a stale result snapshot for
  anything beyond rendering/navigation).
- `recomputeProject()`'s existing "genuinely fresh activation" branch
  (`activeProjectMatchIndex` was `-1`) now prefers `pendingActiveTarget`
  (resolved against the fresh `flat` list via
  `find-replace-project-search.js`'s new `reresolveFlatMatchIndex` — the
  same exact-match-then-occurrenceIndex-fallback policy `reresolveMatch`
  already uses for a single doc, applied here to a flat project-match list)
  over the existing caret-relative `pickInitialProjectMatchIndex` guess,
  which stays the fallback for every other fresh-activation case (a plain
  `open()`, or a target that can no longer be resolved at all).
- `applyProjectDecorations()`/`applyProjectDecorations`-driven decorations
  (unchanged) then correctly highlight the destination the same way they
  already do for any project search result — `find-replace-navigation.js`'s
  own `applyFallbackSceneDecorations` (built for the pre-D2.1.1 case where
  the destination controller had no project state at all) is left in place,
  unconditionally, as a harmless, idempotent defensive backstop — it
  recomputes and dispatches the identical decoration set the destination
  controller's own `recomputeProject()` already applied a moment earlier
  (`handleTransaction`'s own `findReplacePluginKey` meta check already
  ignores it as "our own dispatch", so it never triggers a redundant
  recompute either).

This is a one-shot handoff: the object exists only for the duration of one
`navigateToSceneMatch` call, nothing retains a reference back to the
originating controller, and a controller that's never handed a session
(every non-case-B mount) behaves exactly as it did before D2.1.1.

### Fix 2: the active target editor's Replace is a normal, undo-able edit (Goal B)

**Superseded by Stage D2.1.2 below** — this whole subsection describes the
D2.1.1-era mechanism (`applyUndoableReplacement`/`syncMountedRegistrations`
with `excludeView`, and an immediate persist happening alongside the
undo-able dispatch). None of `buildSyncTransaction`/`applyUndoableReplacement`/
the `excludeView` parameter exist any more. Kept only as a historical record
of the reasoning that led to `closeHistory`-based undo isolation, which
Stage D2.1.2 still uses.

`find-replace-project-replace.js`'s synchronization internals were split
into a shared `buildSyncTransaction(view, committedDoc, {resolvedMatch,
replacementText})` (unchanged logic: prefers the verified-safe localized
`replaceOneMatch` replay, falls back to a whole-document replace only for a
genuinely diverged view — see Stage D2.1's own history-preservation
rationale, still fully in force) and two callers with different history
semantics:

- **`applyUndoableReplacement(view, committedDoc, {...})`** — for the ACTIVE
  TARGET editor only. Dispatches the built transaction wrapped in
  `prosemirror-history`'s own `closeHistory(tr)` (no `addToHistory:false`
  at all) — a normal, undo-able transaction, deliberately forced into its
  OWN undo group via `closeHistory` regardless of how little time elapsed
  since the user's last real edit (`prosemirror-history`'s own time-based
  grouping, `newGroupDelay` ≈500ms, would otherwise risk silently coalescing
  a fast Find-panel interaction with whatever the author was just typing).
  Returns `false` — doing nothing — when the replay can't be verified safe
  against this exact view (a genuine divergence during the `saveSceneText`
  await): the active editor's whole document is never replaced just to
  manufacture an undo step, which could otherwise corrupt whatever's
  already in its history.
- **`syncMountedRegistrations(sceneId, committedDoc, {resolvedMatch,
  replacementText, excludeView})`** — unchanged for every OTHER
  ("secondary") registration: always `addToHistory:false`, never an undo
  entry. `excludeView` skips whichever view `applyUndoableReplacement`
  already handled, so it's never double-dispatched.
- **Active-target identification** (`find-replace-controller.js`'s
  `replaceProjectCurrent()`): `attachedSceneId === result.sceneId &&
  isViewUsable(view)` — the controller's OWN existing attachment state,
  never a heuristic. `attachedSceneId`/`view` are already set by whatever
  navigation/activation brought the user to this exact scene (case-A
  `activate()`, or this same controller's own `adoptProjectSession` +
  `attachView` after a case-B open per Fix 1 above) — this is precisely
  "the EditorView the user is currently looking at for this Replace", with
  no new plumbing needed. If no mounted view is attached to this exact
  scene at all (e.g. the active global match's own navigation had
  previously failed/been declined), there is correctly no undo-able
  target — the commit still succeeds, every existing mounted registration
  (if any) is still synchronized (`addToHistory:false`), there is just no
  editor-local undo entry for it, exactly as the product rule requires.

**Persistence vs. undo, made explicit:** the Replace itself still persists
immediately through the same D2.1 canonical write path
(`updateSceneText`/`commitDataChange`, never `bulkUpdateSceneText`) —
nothing about WHEN or WHETHER it's saved changes. Undo only ever changes the
ACTIVE EDITOR's live, in-memory document locally; `js/dirty-state.js`'s
existing pull-based `isDirty()` (comparing current `getState()` against the
baseline `rebaseSceneDirtyBaseline` already rebased to the committed text)
then naturally reports the editor as dirty again the instant the live doc no
longer matches that baseline — no new dirty-tracking code was needed for
this. Undo never issues a persistence rollback and never triggers an
automatic re-save; the reverted text can be persisted again only through the
existing, ordinary Save flow.

Project-wide **Replace All still has no project-level Undo in D2** — this
slice only makes a SINGLE scene's own Replace an ordinary local edit in
whichever one editor represents it; nothing here introduces any
multi-scene/project-wide undo concept.

Regression coverage: `tools/find-replace-project-replace.test.mjs` gained
`applyUndoableReplacement` unit coverage (using real `prosemirror-history`-
enabled `EditorState`s, not just meta-flag inspection) — a verified-safe
replay becomes exactly one isolated undo/redo step even with an unrelated
prior edit already in the same view's history; an unverifiable replay is
correctly refused rather than forced; and a controller-level test with TWO
mounted registrations of one scene proves the active one alone gets the
undo-able transaction while the secondary one only ever gets
`addToHistory:false` updates. `tools/find-replace-project-replace-
browser.test.mjs`'s own Part 1 was rewritten (superseding its D2.1-era
"undo skips the Replace" assertion) to prove one Ctrl+Z now undoes exactly
the Replace, redo restores it, the undo makes the scene dirty, and canonical
persisted state is untouched by the undo. New Parts prove session
preservation end to end: a single case-B hop, two consecutive hops with no
duplicated/stale panel state, and the dirty guard — cancelling a guarded
navigation leaves the current scene and its Find/Replace session completely
intact, while proceeding (discard) hands the session to the destination
normally. `tools/find-replace-project-search-browser.test.mjs`'s existing
suite (Stage D1) was re-run unchanged and remains green — case-B
navigation's core mount/registry/decoration behavior it already covers was
not altered by this stage, only extended.

## Stage D2.1.2: Single Replace semantics + editor navigation/save UX correction (this stage)

Manual acceptance of D2.1.1 exposed a fundamental mismatch: project-wide
Single Replace **persisted immediately**, then presented itself as an
ordinary, undoable, dirtyable local edit — a misleading model (Save button
present, but the edit was already saved before Save was ever pressed). This
stage corrects the persistence model and fixes several related navigation/
selection defects manual testing found along the way.

### Single Replace is now an ordinary UNSAVED local edit (Findings A/B/C/K/L/M)

**Project-wide Single Replace no longer persists anything itself.** It
mutates the ACTIVE TARGET EditorView directly, as one normal
`prosemirror-history` entry, exactly like the user had typed it:

```
Single Replace → mutate active EditorView → normal history entry
  → normal dirty state → user explicitly Saves → only then persistence occurs
```

- `js/editor/find-replace-project-replace.js` shrank drastically: the entire
  mounted-state "agreement" gate (`resolveMountedSceneAgreement`), the
  persisting `replaceProjectMatch`, `syncMountedRegistrations`, and
  `applyUndoableReplacement` are all **gone**. The one thing left is
  `buildProjectReplacement(doc, matchRange, {query, caseSensitive,
  replacementText})` — pure planning, no view, no dispatch, no I/O: resolves
  `matchRange` against `doc`'s CURRENT content (`reresolveMatch`, unchanged
  stale-safety policy) and builds the replacement via `replaceOneMatch`
  (Stage B, unchanged) — the exact same two primitives Find itself already
  uses, so Find and Replace can never disagree on what "a match" is.
- `find-replace-controller.js`'s `replaceProjectCurrent()` is now
  synchronous (no more `await saveSceneText(...)`) and does everything
  itself: identifies the active target editor as `attachedSceneId===
  target.sceneId && isViewUsable(view)` (the controller's OWN existing
  attachment state — never a heuristic over the mounted-scene registry; see
  Finding D's root cause below for why this specific identity matters), asks
  `buildProjectReplacement` to plan the edit against `view.state.doc`, then
  replays the resulting steps onto `view.state.tr` and dispatches it wrapped
  in `closeHistory` (a normal, undo-able transaction, isolated into its own
  undo group regardless of typing speed — see Goal L below). If the target
  scene isn't the one this controller is actually attached to right now
  (e.g. an earlier navigation to it failed or was declined), it refuses
  safely with `{ok:false,reason:"no-active-editor"}` — it never persists
  first, never rebuilds the editor from canonical state, and never
  synchronizes the active view from anything.
- **Secondary mounted registrations of the same scene are now left
  completely alone.** D2.1/D2.1.1's whole "agreement gate + synchronize
  every other registration" apparatus existed only because Replace used to
  WRITE canonical state and needed every live copy to agree with (or be
  synced to) that write. Once Replace stopped writing anything, there is
  nothing for a secondary registration to be synchronized TO — it is simply
  left exactly as an ordinary user edit in one editor would leave every
  other, unrelated mounted copy of the same scene: untouched. This is not a
  new collaborative-synchronization gap; it is the removal of a mechanism
  that only ever existed to serve the now-removed immediate-persist
  contract.
- `saveSceneTextCanonical` (`js/import-export.js`) and
  `rebaseSceneTextDirtyBaseline` (`js/app.js`) — the D2.1 glue that
  persisted a Replace and rebased a dirty baseline out-of-band — are
  removed as dead code (`js/dirty-state.js`'s generic `rebaseExtra`
  primitive itself is kept, unused today, for a future stage that might
  need it, e.g. Replace All's own eventual pre-commit synchronization
  save). The existing PULL-based dirty trackers already report dirty
  correctly the instant a live doc differs from its baseline — no rebase
  glue is needed for an edit nobody secretly saved out from under the
  tracker.
- **`included:false` is unaffected**: Replace still never touches the
  `included` flag (it only ever edits the doc), and discard/Save both work
  identically for an excluded scene as for any other.

### Goal K: project search reads the live, unsaved editor doc

Unchanged architecture, now load-bearing rather than incidental:
`find-replace-project-search.js`'s `resolveSceneDoc` has always preferred a
scene's LIVE mounted doc over its persisted `sceneText`/`sceneTextDoc` when
one exists (`mounted-scene-registry.js`'s `getPreferredLiveSceneView`). Since
an unsaved Replace only ever changes the live doc, every subsequent project
search (typing a new query, navigating, or the fresh search triggered by
`replaceProjectCurrent()` itself) automatically reflects the unsaved edit —
counts, snippets, and highlights all read the replaced text — while
`data.scenes`/canonical persisted state stays exactly as it was until an
explicit Save. No new plumbing was needed for this; it was true before this
stage too, just never load-bearing for a Single Replace's own correctness
until now.

### Finding D/E: selection/focus bug root cause and fix

**Root cause:** neither `replaceCurrent()` (scene scope) nor the
D2.1/D2.1.1-era project Replace ever set an explicit selection after
building the replacement transform, and neither called `view.focus()`
afterward — unlike this app's OWN formatting-toolbar buttons
(`scene-editor-toolbar.js`'s `bind()`), which have always called
`view.focus()` after running a command specifically because clicking any
`<button>` moves real browser DOM focus to that button, not the
contenteditable editor. Find/Replace's own Replace button never did this,
so the ProseMirror MODEL selection could end up correctly placed while the
actual browser focus silently stayed on the panel/button — the reported
"caret disappears" symptom. Combined with the OLD "keep the same numeric
flat index" active-result policy (see Goal J below), replacing the LAST
match in a scene could also visibly jump the active project result into an
unrelated scene, compounding the confusion.

**Fix**, applied identically to scene-scope `replaceCurrent()` and the new
project-scope `replaceProjectCurrent()`:
- An explicit, deterministic caret is set after the replacement steps are
  applied — `resolvedMatch.from + replacementText.length` (exactly at the
  deletion point when `replacementText` is empty) — never left to default
  step-mapping of whatever selection happened to be set before the dispatch.
  Valid for a single-match replacement specifically: nothing to the left of
  `resolvedMatch.from` is touched by it, so that position stays valid in the
  post-replacement document.
- `view.focus()` is called after the dispatch, exactly matching the
  toolbar's own established pattern — the active editor stays the
  user-facing focus context.
- `closeHistory` (see Goal L) guarantees the Replace is deterministically
  its own undo step regardless of how little time elapsed since the
  author's last real edit.

Audited (Finding E) and fixed identically across every surface Replace
exists on: current-scene Replace in the text-only editor, current-scene
Replace in the full Scene editor, and project-wide Single Replace in both
— empty and non-empty replacement in each case (see
`tools/find-replace-project-replace-browser.test.mjs`'s dedicated
surface-matrix loop). "Весь текст" has no scene-scope Replace of its own
(only project-wide, which goes through the same `replaceProjectCurrent()`
path) — Replace All was never in scope for this stage on any surface.

### Goal J: active-result locality after Replace

`find-replace-project-search.js` gained `pickPostReplaceActiveIndex(flat,
{sceneId, position, sceneOrder})` — the LOCALITY-preferring policy used
**only** for the one recompute that immediately follows a successful
Replace (via `find-replace-controller.js`'s `pendingPostReplaceLocality`,
consumed the instant the Replace's own dispatch synchronously triggers
`handleTransaction → recompute → recomputeProject`). Every OTHER recompute
trigger (typing a query, an edit elsewhere, `Next`/`Previous`, a session
handoff) is completely unaffected — this policy activates for post-Replace
recomputes exclusively:

1. Prefer the next remaining match in the SAME scene, at/after the
   replaced location.
2. Otherwise the nearest remaining match in the SAME scene BEFORE it (the
   last one, since `flat` preserves in-scene document order).
3. Only when the scene has NO remaining matches at all: fall through to
   normal canonical project ordering (the first match at/after that scene's
   own former `sceneOrder`, wrapping to the very first overall result) —
   never an arbitrary index-0 jump as a mere byproduct of the flat list
   shrinking.

If no matches remain anywhere, the active result clears to `-1` exactly as
before (the existing, unchanged zero-results state).

### Finding H: surface-preserving project-result navigation

Project-result navigation now preserves the ORIGIN surface's type on the
destination whenever that destination supports it:

- The full Scene modal's own `openSceneForEditing` (wired in
  `js/scenes.js`'s `mountSceneModalTextEditor`) now calls `editScene`, never
  `openSceneText` — a case-B navigation FROM the full editor opens the
  destination in the full editor too.
- The standalone text-only editor's own `openSceneForEditing` (in
  `openSceneTextNow`) is unchanged — still `openSceneText`, so a case-B
  navigation FROM text-only opens text-only.
- "Весь текст"'s own case-B fallback is explicitly **unchanged** (still
  `openSceneText`) — per this stage's own product brief, "preserve its
  existing surface-specific navigation semantics rather than arbitrarily
  changing to another editor type." "Весь текст" has no per-scene "full
  editor" representation of its own to preserve into.
- `editScene`/`editSceneNow` (`js/scenes.js`) gained the same optional
  `extra`/`projectSession` threading `openSceneText`/`openSceneTextNow`
  already had (Stage D2.1.1) — mounted via the same
  `mountSceneEditor`/`adoptProjectSession` mechanism, so the project
  session (query/replacement/scope/options/target) survives a
  surface-preserving hop exactly as it already did for the text-only path.
  The existing dirty guard (`requestEditorTransition`) runs first,
  unchanged, for both surfaces.

### Finding I: explicit full-scene ⇄ text-only switch, same scene

A small new toolbar action (`scene-editor-toolbar.js`'s
`onSwitchSurface`/`switchSurfaceLabel`, rendered only when the caller
supplies them — no new modal type) lets the author jump between the full
Scene editor and the text-only editor for the SAME scene in either
direction:

- `scene-editor-controller.js`'s `mountSceneEditor` gained
  `onSwitchSurface`/`switchSurfaceLabel` — when given, the toolbar's new
  button calls `onSwitchSurface(findReplace?.exportProjectSession?.()??null)`
  on click. `exportProjectSession()` (new on `find-replace-controller.js`)
  returns `{query,replaceText,caseSensitive}` when scope is "project",
  `null` otherwise — deliberately no `target`, since a manual surface switch
  isn't aimed at any one specific match (the destination's own fresh search
  just uses its existing caret-relative default).
- `js/scenes.js` wires the actual open on both sides:
  `mountSceneModalTextEditor`'s `onSwitchSurface` calls
  `openSceneText(scene.id,{projectSession})`; `openSceneTextNow`'s calls
  `editScene(sceneId,{projectSession})`. Both go through the SAME
  `openSceneText`/`editScene` functions (and their existing
  `requestEditorTransition` dirty guard) every other transition already
  uses — cancelling the guard leaves the current surface untouched, exactly
  like any other navigation.

### Finding F/G: Save-only vs. Save-and-Close, discard unchanged

The existing Save buttons ("Сохранить", "Сохранить текст", "Сохранить все
изменения") are now **save-only** — they perform the exact same
validation/persistence as before but no longer close their modal or destroy
the mounted editor on success. A new, separate action, **"Сохранить и
закрыть"**, performs the identical save and closes only after it succeeds;
a failed save behaves exactly as it always did (modal stays open, dirty
state untouched) on either button.

- `js/app.js`'s `saveScene`/`saveText` click handlers were refactored into
  shared `saveSceneModalOnly()`/`saveTextModalOnly()` functions (every
  internal early return is a save FAILURE, unchanged validation/RPC/
  `commitDataChange` logic throughout) that stop right after
  `trackerFor(modalId).captureInitialState()` — never touching modal
  visibility or the mounted editor. `#saveScene`/`#saveText` call the save
  function alone; new `#saveSceneAndClose`/`#saveTextAndClose` call it and
  then `forceHideModal`+destroy the editor only on success. Saving a
  BRAND-NEW scene via save-only now also retargets the modal onto the
  newly-created scene id (`editingSceneId`) so a second save-only click
  updates it instead of creating a duplicate.
- `js/import-export.js`'s `saveAllScenes()` was already close-agnostic (the
  close/destroy steps lived entirely in `js/app.js`'s own button handler) —
  only the button wiring changed: `#saveAllScenes` no longer closes;
  `#saveAllScenesAndClose` is new.
- **Close/discard is completely unchanged.** "Закрыть"/"Отмена" still go
  through the existing `requestCloseModal`/`confirmDiscardIfDirty` dirty
  guard exactly as before — an unsaved Replace shows the same "Закрыть без
  сохранения" prompt any other unsaved edit would, discarding it destroys
  the mounted editor (so reopening loads the last-PERSISTED text, never the
  discarded Replace), and cancelling leaves the editor exactly as it was.

Regression coverage: `tools/find-replace-project-replace.test.mjs` was
rewritten around the simplified architecture — pure `buildProjectReplacement`
stale-safety/no-op/length-variant coverage, controller-level tests proving
zero persistence before Save, `closeHistory`-based undo/redo isolation with a
REAL `prosemirror-history`-enabled `EditorState` (not just meta-flag
inspection), a secondary registration receiving zero doc-changing
transactions, scene identity, `included:false`, the full
`pickPostReplaceActiveIndex` policy (unit + controller-integration, covering
"prefer next in scene", "fall back to previous in scene", "fall through to
the next scene only when genuinely empty"), and explicit caret-position
assertions for both empty and non-empty replacement.
`tools/find-replace-project-replace-browser.test.mjs` was rewritten in full
against the real running app: persistence-free Replace with a dirty editor,
discard truly discarding it, manual-edit-then-Replace undo/redo ordering,
live project search reflecting the unsaved doc, focus/selection correctness
for empty and non-empty replacement on both the text-only and full Scene
surfaces, active-result locality, Save-only vs. Save-and-Close on all three
surfaces, surface-preserving navigation in both directions, the explicit
full⇄text-only switch (including its own dirty-guard check), and
`included:false` under both discard and Save. `tools/find-replace-
project-search-browser.test.mjs` (Stage D1) and `tools/find-replace-
current-scene-browser.test.mjs` (Stage C) were re-run unchanged and remain
green.

## Stage D2.1.7: preserve text-editor focus on Text Scene → Scene Editor handoff

Same-scene surface handoff now preserves TEXT-EDITOR keyboard focus when the
source editing context was the text editor itself (captured as a `focusTarget`
flag on the same handoff object D2.1.4-D2.1.6 already carry, via a
`mousedown`-time snapshot -- a click on the switch-surface button itself
already moves focus to that button before its own click handler runs, so
reading focus state fresh inside the handler would always see the button,
never the editor); normal Scene Editor opens, and a handoff whose source
focus was elsewhere (e.g. the Find input), keep their ordinary default
autofocus (the title field) unchanged.

## Stage D2.1.6: center the restored position in the handoff viewport

D2.1.5's restoration landed the target right at the nearest viewport edge
(`revealDocPosition`'s existing make-visible semantics: nudge the minimum
amount needed, never re-center) -- technically visible, but with no reading
context on that side for a freshly-mounted destination with no scroll
history of its own. `revealDocPosition` gained an optional `align` parameter
("nearest", the unchanged default every ordinary Find/Replace reveal still
uses; "center", used ONLY by the same-scene Scene Editor ⇄ Text Scene
handoff in `scene-editor-controller.js`'s `applyHandoff`) that scrolls by
the delta between the target's own vertical center and the visible band's
center, on the SAME sticky-aware ancestor walk as before. `scrollTop`'s own
browser clamping to `[0, scrollHeight-clientHeight]` gives correct
boundary behavior near the document's start/end for free, with no separate
case needed. Which logical position is restored (D2.1.5's own Find-target →
selection → viewport-anchor priority) is unchanged; only its final on-screen
alignment improved.

## Stage D2.1.5: preserve editor position across the Scene Editor ⇄ Text Scene handoff

Small, final D2.1 correction: manual acceptance of D2.1.4's live-doc handoff
found the destination editor always scrolled to the end of the document,
regardless of the source's caret/viewport/active Find match. Scene Editor
⇄ Text Scene now preserves the author's working location in the text, in
addition to the unsaved live doc and the Find/Replace session D2.1.3/D2.1.4
already preserved.

### Root cause of the jump-to-end

`replaceDocJSON`'s full-document `replaceWith(0,size,newContent)`
(`js/editor/scene-editor-view.js`) never called `setSelection` explicitly.
ProseMirror's default behavior -- mapping the transaction's PRE-existing
selection through its own steps when nothing calls `setSelection` -- resolves
a position that sat inside a wholesale-replaced range according to the
mapping's own bias, which for a full-document replace lands at the very end
of the newly inserted content. Neither `focus()` nor `scrollIntoView()` nor
EditorState's own default selection was the cause (none of the first two are
called there; the third only ever applies to a brand-new `EditorState.create`
with no doc, which this method never does). The fix: `replaceDocJSON` now
always takes an explicit `{anchor,head}` and sets a deliberate selection on
the SAME transaction that installs the new doc -- never left to default
mapping.

### Restoration priority (documented per the approved UX rule)

1. **Active Find/Replace target.** If Find/Replace has an active match that
   belongs to the scene being handed off, its own `{from,to}` range becomes
   the restore selection. `find-replace-controller.js`'s `exportProjectSession`
   now includes this `target` (reusing the exact `{sceneId,from,to,text,
   occurrenceIndex}` shape D2.1.1 already built for cross-scene project-
   result navigation) -- but ONLY when the active match's `sceneId` equals
   `attachedSceneId` (the scene actually being handed off); an active match
   belonging to some OTHER scene (D2.1.4 Finding 1's own "exhausted scene"
   scenario) is deliberately left out.
2. **Caret / selection.** Otherwise, the captured ProseMirror `{anchor,head}`
   (from the source view's own `state.selection`) is restored, preserving
   directionality and collapsed-vs-range exactly -- never turning a caret
   into an arbitrary non-collapsed selection.
3. **Viewport fallback.** If the caret sits at the trivial just-mounted
   default (position ≤1) AND a viewport anchor was captured, that anchor
   becomes a collapsed restore position instead -- covers "scrolled to
   review a passage but never clicked there." The anchor is captured by a
   new `captureViewportAnchor(view)` (`find-replace-controller.js`), the
   geometric inverse of the existing `revealDocPosition`: it walks the same
   scrollable-ancestor chain (sticky-header-aware), then asks ProseMirror's
   own `view.posAtCoords` what doc position renders at the top of the
   visible area right now.
4. Whatever `selection` was captured, even if trivial, as the final
   fallback -- restoration never throws and never invents an arbitrary
   paragraph/range selection.

### Restore order and the reveal pipeline

`mountSceneEditor`'s returned wrapper gained `applyHandoff({session,liveDoc,
selection,viewportAnchor})`, replacing D2.1.4's bare `replaceDocJSON` call.
Order matters: `findReplace.adoptProjectSession(session)` runs FIRST --
resetting `activeIndex`/`activeProjectMatchIndex`/`pendingActiveTarget` for
BOTH scopes -- so the doc-swap transaction's own resulting recompute (fired
via `handleTransaction`) does a genuinely FRESH pick against the doc about to
be installed, rather than "clamping" whatever the initial mount's own
`attachView` already computed against the transient canonical doc that was
never shown to the user. Then `editor.replaceDocJSON(liveDoc,{selection})`
installs the live doc and the resolved restore selection in ONE transaction.
Finally, `revealDocPosition(view,pos)` -- the SAME sticky-aware, multi-
ancestor reveal every other Find/Replace navigation already uses, never a
second/competing scroll mechanism -- is called explicitly: the swap's own
triggered recompute never scrolls anything itself (`handleTransaction` only
ever calls `recompute()`, deliberately never `recomputeAndReveal()`, so as
not to fight a user's own typing cursor elsewhere in the doc on unrelated
edits), and relying on the browser's own implicit "scroll a focused
selection into view" behavior proved unreliable for the Scene modal's nested
scroll containers (the outer `.modal` and the inner bounded
`#sceneTextEditor`) -- only a single explicit call reveals correctly on
every surface.

### History

`replaceDocJSON`'s selection-setting transaction stays `addToHistory:false`,
unchanged from D2.1.4. Each surface owns its own independent EditorView/
`prosemirror-history` instance (pre-existing architecture -- "undo/redo can
never bleed across Scenes"); the handoff was never a transfer of an undo
STACK, only of the doc's current content, so a freshly-handed-off
destination's own history starts empty and Ctrl+Z there is correctly a
no-op until something is typed there.

### Test coverage added this stage

`tools/find-replace-project-replace-browser.test.mjs` gained Parts 21-24:
mid-document caret preserved in both directions (the reported bug, directly);
an active current-scene AND an active same-scene project Find match surviving
as the same logical occurrence, revealed via the existing pipeline; an
unsaved live doc's position restored correctly, plus the history-coherence
invariant (a real pre-switch edit stays normally undoable in ITS OWN source
editor; Undo in a fresh destination with nothing yet typed there is a safe
no-op); and a scrolled-but-never-clicked viewport landing roughly mid-
document (never start/end) plus selection sanity (collapsed stays collapsed,
a real range survives). The full unit suite and the other two D1/D2/D2.1.x
browser suites were re-run unchanged and remain green.

## Stage D2.1.4: Replace eligibility + surface-handoff UX fix

Small, final D2.1 correction: two more manual-acceptance findings on
D2.1.3's already-accepted work. No scope change.

### Finding 1: Replace eligibility is stricter than "an active global result exists"

`replaceProjectCurrent()`'s existing runtime guard (`attachedSceneId!==
target.sceneId` → refuse) was always correct -- the bug was purely that the
Replace BUTTON stayed enabled right up until that guard refused it, so
exhausting the current scene's matches (leaving the active global result in
some other scene, often an `included:false` one surfaced first by canonical
order) produced a clickable button that only ever produced
`"Эта сцена сейчас не открыта для редактирования — замена отменена."`
`js/editor/find-replace-controller.js`'s `resolveProjectReplaceTarget()` is
now the single source of truth for "may replaceProjectCurrent() run right
now" (an active match must exist, belong to the currently ATTACHED/usable
editor) -- both the runtime guard itself and the panel's new
`canReplaceProjectCurrent()`/`snapshot().projectReplaceEligible` read off it,
so the two can never drift apart. The panel's Replace button is now disabled
whenever this is false, with its `title` explaining why (reusing the exact
existing refusal message). The 4th condition in the approved rule --
"the match is currently re-resolvable" -- is deliberately NOT independently
re-verified on every render: `projectResult` is always a fresh search re-run
synchronously after every doc-changing transaction, so it's already
guaranteed true whenever the first three conditions hold; `buildProject
Replacement`'s own `reresolveMatch` stale-check remains the real defense-in-
depth for the rare remaining race.

### Automatic post-Replace fallback now prefers included scenes

Root cause: `pickPostReplaceActiveIndex`'s (find-replace-project-search.js)
final fallback branch, reached when the just-exhausted scene has no matches
left, picked the next match in plain canonical order with no regard for
`scene.included` -- an `included:false` scene sitting earlier in canonical
order than a still-matching included one could become the automatic active
result purely by chance of position. Fixed by extending `flattenProjectMatches`
to carry `included` through to each flat match entry, and reordering the
fallback: (1) the next canonical INCLUDED scene with matches, searching
forward; (2) if none, the nearest PREVIOUS canonical included scene with
matches; (3) only when no included scene has matches anywhere, the old
plain-canonical-order fallback (which may land on an `included:false` scene).
This changes ONLY the automatic fallback target -- `included:false` scenes
remain fully present in search/results/the global summary, directly
navigable by an explicit result-row click, and replaceable (locally/unsaved,
same as any other scene) once explicitly opened; arrows stay restricted to
the existing navigation-domain semantics, unchanged.

### Finding 2: Scene Editor ⇄ Text Scene is a live editing-surface handoff, not a Save

Root cause of the unnecessary Save prompt: both surfaces' `onSwitchSurface`
handlers called the generic `openSceneText`/`editScene`, which always go
through `requestEditorTransition` -- the SAME dirty-guard used for
navigating away to a genuinely different scene, with no special case for "the
user is switching editing surfaces for the SAME scene, not leaving it."

**Text Scene → Scene Editor is always seamless.** Text Scene has no
non-text dirty state at all (its modal has no other form field -- confirmed
by inspecting `index.html`'s `#textModal`, and by extension `trackerFor(
"textModal").isDirty()` is driven purely by `extra.doc`). `js/scenes.js`'s
new `switchToSceneEditorSeamless(sceneId,session,liveDocJSON)` bypasses
`requestEditorTransition` entirely: it destroys/unregisters the source view,
hides the source modal, then calls `editSceneNow` directly with the captured
live doc.

**Scene Editor → Text Scene distinguishes text-only from non-text dirty.**
`js/dirty-state.js` gained one small, local addition to `createDirtyTracker`:
`isDirtyIgnoringExtraKeys(keys)`, which reuses the tracker's own existing
baseline/getState (never a second dirty system) to answer "is this dirty for
a reason OTHER than these `extra` keys". `switchToTextSceneSeamless` calls
`trackerFor("sceneModal").isDirtyIgnoringExtraKeys(["doc"])`: if true (a real
title/tags/metadata edit is unsaved), it falls through to the EXISTING
`openSceneText`/`requestEditorTransition` guard, completely unchanged; if
false (clean, or dirty only because the scene's own text changed), it
switches seamlessly with the live doc handed off, same as the other
direction.

**The live-doc handoff mechanism.** The source's own live doc JSON is
captured by `scene-editor-controller.js`'s toolbar wiring at the moment of
the click (`editor.getDocJSON()`, a deep-cloned plain value, decoupled from
the view before anything is destroyed) and threaded through as a second
argument to `onSwitchSurface`. The destination mounts NORMALLY from the
scene's own canonical/persisted data first (`editSceneNow`/`openSceneTextNow`,
unchanged) -- populating every form field and letting `trackerFor(id).
captureInitialState()` run exactly as before, so the dirty baseline is
the scene's own PERSISTED state, matching what was just mounted/captured.
Only THEN, if a live doc was handed off, is it applied via a new
`replaceDocJSON(json)` method (`js/editor/scene-editor-view.js`, forwarded
through `mountSceneEditor`'s own return value) -- `docFromJSON`/`docToJSON`
throughout, never a plain-text round-trip, so rich-text marks/structure
survive exactly. This is a REAL transaction (`view.dispatch`, `addToHistory:
false`), never `view.updateState` directly, so it flows through the normal
`dispatchTransaction`/`onUpdate` pipeline: the toolbar, the Save button's
dirty refresh, AND Find/Replace's own `recompute()` (so a fresh search runs
against the HANDED-OFF content, not the stale persisted one, satisfying
D2.1.3's Find-session-preservation contract for the live doc too) all react
to it for free. `addToHistory:false` keeps the momentarily-mounted-but-
never-shown canonical doc out of the undo stack -- it was never visible to
the user (this all happens synchronously, before any repaint), so Undo must
never be able to revert back to it.

Because the swap happens strictly AFTER `captureInitialState()`, the
tracker's baseline never rebases to the handed-off content -- `isDirty()`
correctly reads dirty (current live doc B vs. persisted baseline A) with no
special-cased comparison logic anywhere. Save, discard, and a manual edit
back to A all resolve dirty state exactly as they would for any ordinary
edit, because none of this introduces a second dirty-tracking mechanism --
it only ever changes WHEN a real transaction is dispatched, never anything
about how dirty is computed.

No persistence call (`updateSceneText`/`commitDataChange`) is ever made
merely by switching surfaces -- confirmed by browser test assertions
checking the canonical/localStorage-backed project data stays untouched
across every switch until an explicit Save.

### Test coverage added this stage

`tools/find-replace-project-replace-browser.test.mjs` gained Parts 16-20:
Replace-eligibility + both fallback-ordering directions + explicit-hidden-
scene-click (Finding 1); the full live-doc-handoff round trip in both
directions including Save-after-handoff, discard-after-handoff, the text-
only-vs-non-text-dirty distinction, Find-session-sees-live-doc, and a rich-
text (bold mark) handoff check (Finding 2). Part 11's own "dirty guard
respected" sub-test (from D2.1.2) was corrected: a text-only edit now
switches seamlessly by design, so that assertion was replaced with a check
for the NEW seamless behavior plus a new non-text-dirty sub-case verifying
the guard still fires there. The full unit suite and the other two existing
D1/D2/D2.1.3 browser suites were re-run unchanged and remain green.

## Stage D2.1.3: interaction-state hardening

Manual acceptance of D2.1.2 raised twelve findings covering selection
artifacts, Save-button staleness, reveal/scroll correctness, and terminology.
This stage fixes the root causes rather than patching symptoms; no scope
change (still no Replace All, no `bulkUpdateSceneText`, no project-level
Undo).

### Finding 1/11: a Replace→Undo→scope-switch cycle could leave a stray, non-collapsed real selection

Root cause, traced through `prosemirror-history`'s own source
(`node_modules/prosemirror-history/dist/index.js`): a real, undo-recorded
transaction bookmarks `oldState.selection` (via `.getBookmark()`) as the
selection Undo will later restore — regardless of whether that selection
itself was ever added to history. `dispatchNavigation()` /
find-replace-navigation.js's `selectAndReveal()` intentionally set the LIVE
selection to a match's full range (`addToHistory:false`, so the selection
change itself is never an undo step) as the deliberate Stage C "the match
becomes the actual selection" design. If that range selection is still live
the instant a *later* real edit (Replace) is dispatched, Undo of that edit
restores the match-range selection verbatim — a genuine, visible,
non-collapsed selection reappearing with no current Find operation left to
justify it.

Fix: `collapseSelectionIfRange(view)` (`js/editor/find-replace-controller.js`)
dispatches a selection-only, zero-step, `addToHistory:false` transaction that
collapses any non-collapsed selection to a caret at its own `from`. It never
touches a selection the user made by dragging/shift-selecting — it only ever
runs at moments this controller itself is about to move on from a match.
Called immediately before capturing `view.state.tr` in `replaceCurrent()`,
`replaceAll()`, and `replaceProjectCurrent()` (removing the stale range from
history's own bookmark at the source, before the real edit is built — doing
this after building `tr` would be too late), at the top of `setScope()`
before switching scope, and in `recomputeAndReveal()`'s `else` branch
whenever there is no active match left to reveal. This is a pure DOM-
selection concern with nothing to verify without a real `EditorView` — the
helper (and the reveal geometry code below) explicitly no-ops when a caller
is a headless test double with no `view.dom` at all
(`tools/find-replace-project-replace.test.mjs`'s own `fakeView`), never a
silently-accepted invalid state in the running app.

This is also the concrete instance of Finding 11's "keep three visual-state
concepts distinct" requirement: decoration (`buildMatchDecorations`), active-
match controller state (`activeIndex` / `activeProjectMatchIndex`), and the
real ProseMirror/DOM selection are three different things, and only Stage C's
own intentional case (an active Find match *is* the real selection while
that match is current) is allowed to unify two of them. An audit of every
`TextSelection.create` call site in `js/editor/` at the end of this stage
found exactly five: `selectAndReveal`/`dispatchNavigation` (the intentional
active-match range, always `addToHistory:false`), `collapseSelectionIfRange`
(the fix above), and the two Replace functions' own explicit post-edit caret
placement (a *collapsed* position, safe to bookmark). No other code path
sets a real selection.

### Finding 4: Replace now reveals through the same sticky-aware pipeline as arrow navigation

`replaceCurrent()` and `replaceProjectCurrent()` used to rely solely on
ProseMirror's own `tr.scrollIntoView()` transaction flag, which has no
knowledge of a sticky-positioned header pinned over part of a scrollable
ancestor (`stickyTopObstruction`/`revealDocPosition`, both already used by
`dispatchNavigation()`/`selectAndReveal()` for arrow/click navigation —
exactly the "Весь текст" toolbar+Find/Replace strip). A Replace whose target
sat in that band could silently mutate it while leaving it visually hidden
underneath the controls. Both functions now also call the same
`revealDocPosition(view, caretPos)` right after their dispatch — reusing the
existing reveal primitive, never a second one.

### Finding 3/6: arrow-navigation reveal audited across all three surfaces, both directions, empty and non-empty replacement

No code change was needed here — `revealDocPosition`'s generic scrollable-
ancestor walk (recomputing `coordsAtPos` fresh at each ancestor, accounting
for sticky obstructions) already covers every surface's own nested scroll
container: the standalone "Текст сцены" and "Весь текст" surfaces reveal via
their outer `.modal{overflow:auto}`, and the Scene modal additionally has its
own inner `#sceneTextEditor{overflow-y:auto}` bounded editor — both already
exercised by `tools/find-replace-current-scene-browser.test.mjs`. One
practical clarification from this stage's audit: the real DOM/browser
selection (`window.getSelection()`) only reflects ProseMirror's own model
selection while the editor itself has DOM focus — `dispatchNavigation()`
(scene-scope arrow nav within the same view) deliberately does *not* call
`view.focus()`, so as not to steal focus from the Find input while a user is
actively typing/clicking in the panel. The active match's decoration and its
scroll-visibility remain correct regardless; only a plain `window.
getSelection()` read is silent about it if the panel currently holds focus.
Any test (or manual check) of "is the active match visible" should use the
`.rte-find-match-active` decoration element's own geometry, not
`window.getSelection()`, unless the editor was just explicitly refocused.

### Finding 5: repeated Replace clicks already form a visible, correct sequence

Verified, no code change: each click consumes the current active match (the
scene's occurrence order is preserved — replacing the first remaining
occurrence each time, never re-visiting an already-replaced one), the
"N из M" counter decrements, and the newly active match gets the strong
decoration and is revealed — an unambiguous progression rather than a
same-looking click repeated with only a changing count to infer success
from.

### Finding 7: cross-scene invisible Replace is already refused correctly

`replaceProjectCurrent()`'s existing guard (`attachedSceneId!==target.
sceneId` → refuse with `no-active-editor`) already prevents a Replace click
from mutating a scene the controller isn't currently attached to/navigated
into — including the race this finding worried about (Next, then
immediately Replace before an async cross-scene open resolves): the active
match index advances synchronously in `next()`/`previous()` *before*
`triggerProjectNavigation()` is even called, so `target.sceneId` already
points at the new scene while `attachedSceneId` still names the old one
until the destination view actually attaches — the guard reliably refuses in
that window rather than mutating either scene. This stage's own new browser
test coverage (Part 13's all-scenes step) independently rediscovered this
guard by tripping over it: a fresh project query's first active result can
land in a scene nothing has explicitly navigated to yet (whichever scene
mounted first is "attached" by default), and Replace correctly no-ops rather
than guessing — the realistic fix is the same one a real user would need:
navigate to the result (arrow or a result-row click) before Replace, which
is exactly what reconciles `attachedSceneId`.

### Finding 8: current-scene ("Эта сцена") sessions now also survive a Scene Editor ⇄ Text Scene surface switch

D2.1.2's `exportProjectSession()`/`adoptProjectSession()` only ever
carried a session when `scope==="project"` — switching surfaces while scope
was "Эта сцена" silently dropped query/replaceText/caseSensitive/open state
entirely. Both functions are now scope-generic: the exported object carries
its own `scope` (defaulting to `"project"` when omitted, so every
pre-existing cross-scene-navigation caller — which never set this field —
keeps its exact prior behavior) and its own `open` (panel open/closed state,
defaulting to `true` when omitted for the same reason — a session export
used to always force the destination panel open regardless of whether the
source panel actually was, its own smaller instance of this same bug). A
scene-scope session carries no cross-scene "exact result" to aim for; the
destination's own upcoming `recompute()` (unlike project-scope's
`recomputeProject()`) already re-runs the search fresh against the live
destination doc on `attachView`, and falls back to its existing caret-
relative `pickInitialActiveIndex` default — exactly the "deterministic
current-scene result" fallback this finding allows in place of re-resolving
the exact prior logical occurrence.

### Finding 9: terminology rename

"Только текст" had already been renamed to "Текст сцены" in an earlier pass;
the one remaining old label, `switchSurfaceLabel:"Полный редактор"`
(`js/scenes.js`, the text-only surface's own switch button), is now
`"Редактор сцены"`. The toolbar's tooltip/`aria-label` are derived from the
same `switchSurfaceLabel` string (`js/editor/scene-editor-toolbar.js`), so
both update automatically. No internal identifier was renamed.

### Finding 2/12: Save buttons now track dirty state live

`js/dirty-state.js`'s `createSaveButtonController` already existed and was
already used for the Character Profile modal's own single Save button, but
`sceneModal`/`textModal`/`allScenesModal` never used it — their Save/Save-
and-Close buttons never reflected dirty state at all. Each of the six
buttons (Save-only and Save-and-Close, on all three surfaces) now has its
own controller, all reading the *same* underlying tracker per modal — never
a second dirty-tracking mechanism. `beginSaving()`/`endSaving()` bracket
each surface's save function (`try`/`finally`, so a failed save still
re-enables the button rather than getting stuck showing "Сохранение…").

The existing document-level `input`/`change` listener
(`js/dirty-state.js`'s own `syncBeforeUnload`) already refreshes every
registered button on ordinary typing, but two real edit paths never fire a
native `input`/`change` event at all: Undo/Redo (prosemirror-history's own
keymap-bound commands, not the browser's native undo manager) and a Find/
Replace Replace click (a synthetic `view.dispatch()` with no real user
keystroke). `js/editor/scene-editor-controller.js`'s `onUpdate` hook — the
one choke point every doc-changing transaction already flows through
regardless of source or surface — now also calls the existing global
`syncBeforeUnload()` whenever `transaction.docChanged`, closing that gap for
every surface built through this factory. A non-text field (e.g. the Scene
modal's title input) already counted as dirty before this stage —
`serializeForm` scans every `input`/`select`/`textarea` under the tracked
root — so Finding 2's "non-text field edits must also enable Save" needed
only the button-refresh wiring, not a new dirty check.

### Test coverage added this stage

`tools/find-replace-project-replace-browser.test.mjs` gained three new
parts: Part 13 (Save-button dirty-state cycle — disabled on open, enabled on
a programmatic Replace/Undo/Redo with no native input event, re-disabled
after a successful Save — across all three surfaces, plus the non-text-field
case for the Scene modal), Part 14 (current-scene session preservation
across an explicit surface switch in both directions, including case-
sensitive, plus the renamed label), and Part 15 (the full scope-toggle
selection-sanity matrix: before Replace, after Replace, after Undo, after an
empty-string Replace, after Undo of that empty Replace, and after arrow
navigation — each followed by toggling scope both ways and asserting a
collapsed, empty real selection, then confirming arrows still work). Part
8/9's existing Scene-modal Save-and-Close assertion was corrected to make a
fresh edit before clicking it — with Save-and-Close now itself correctly
disabled while clean (Finding 2), clicking it immediately after a Save-only
click (which already cleaned the form) is no longer a valid click to expect
to succeed. The existing D1/D2 browser suites
(`find-replace-current-scene-browser.test.mjs`,
`find-replace-project-search-browser.test.mjs`) and the full unit suite
(`npm test`) were re-run unchanged and remain green.

## Stage B: the matching/replacement engine (`js/editor/find-replace-model.js`, `js/editor/find-replace-text.js`)

Pure, headless, DOM/EditorState/Supabase-independent. `findMatches(doc, query,
{caseSensitive})` returns `{from, to, text, paragraphPos}[]` against the
structured document (paragraph-scoped: matches never cross a paragraph
boundary, and non-text blocks like `sceneBreak` are never visited as search
targets). `replaceOneMatch`/`replaceAllMatches` return a plain
`prosemirror-transform` `Transform` (never an `EditorState`/`Transaction`) —
a later live-editor controller replays its `.steps` onto `view.state.tr` in
one `dispatch()` call (one `prosemirror-history` undo step regardless of how
many matches were replaced); project-wide scanning/replacement preparation
can read `.doc` directly with no `EditorState` involved at all.

**Confirmed mixed-mark replacement behavior (empirically pinned, see
`tools/find-replace-model.test.mjs`):** a replacement is built via
`ResolvedPos.marksAcross`/`.marks()` — ProseMirror's own native primitive,
never a hand-built heuristic. For this schema (no mark declares
`inclusive:false`), that primitive resolves to the marks of the text run at
the match's **start** — "leading-edge" marks, not an intersection across the
whole matched range and not "any mark present anywhere in the match wins". A
match entirely inside one marked run keeps that formatting; a match spanning
a mark change takes whichever formatting the FIRST character's run has,
regardless of what the rest of the match carries. Any later stage rendering
a Replace preview must not claim or imply "intersection" semantics — this is
the actual, tested behavior to describe to users if it's ever surfaced
(e.g. in help text), and to build Stage C/E on.

Unicode comparison (case-insensitive via `String.prototype.toLowerCase()`,
never `toLocaleLowerCase()`; NFC via per-grapheme-cluster provenance mapping,
via `Intl.Segmenter` with a deterministic fallback) is implemented exactly as
this document already specified below, including the requirement that
case-folding can itself change comparison length (confirmed and tested: the
locale-independent lowercasing of İ, U+0130, produces two code units from
one) and that this never corrupts the mapping back to real source
positions.

## Two different operations, not one mechanism

Find/Replace has two distinct kinds of "Replace All," with different
atomicity guarantees. Later stages must keep this distinction explicit in
both code and UX:

- **Current-scene Replace / Replace All** — edits one open editor's live
  ProseMirror state as a single transaction (one Undo step via the normal
  `prosemirror-history` plugin). Persistence rides whichever surface's
  existing Save flow already exists (`update_scene_text`); Find/Replace adds
  no new persistence path for this case.
- **Project-wide ("Весь проект") Replace All** — a committed, project-level
  operation with its own preview/confirmation, gated on a **synchronized**
  text state (see below), and persisted atomically via `bulk_update_scene_text`
  (cloud) or a single `commitDataChange` (local). It is **not** represented as
  an editor Undo step in any open surface — an author pressing Ctrl+Z in an
  editor afterward undoes their own last real edit before the operation, never
  the project-wide operation itself.

## Project scope = all active project scenes

**"Весь проект"** search/replace scope covers every active (non-deleted)
scene belonging to the project, **regardless of `scene.included`** — it does
not inherit `includedScenes()`/"Весь текст" export semantics. Excluded scenes
are still project content and may be re-enabled later; a project-wide rename
must be able to reach stale terms in them.

This required no new filtering/placement logic: `get_project_content` already
never returns soft-deleted scenes to the client, so `data.scenes` already *is*
"all active scenes." Every scene always carries a `chapterId` (a real chapter
or the reserved `chapter-unassigned` pseudo-chapter), so canonical project
order — chapters in stored order, then scenes within each chapter in stored
order — already covers every active scene with no unrepresented case.

## Project-wide Replace All requires synchronized state before it can commit

**Still describes Replace All specifically (not yet built).** Stage D2.1
originally implemented an analogous single-scene synchronization gate for
Single Replace (`resolveMountedSceneAgreement`/`replaceProjectMatch`), but
that gate existed only to serve D2.1's "persist immediately" contract, which
Stage D2.1.2 replaced with an ordinary UNSAVED local edit (see that section)
— there is no longer anything for Single Replace to synchronize/commit, so
that gate no longer exists in the codebase. Replace All, whenever it is
built, will need its OWN synchronization step of this shape (steps 1-3
below) across every affected scene at once, via `bulkUpdateSceneText`, which
no current stage calls.

Project-wide Replace All may commit **only** from a state where every scene it
will touch is confirmed synchronized between whatever's live in an open editor
and what's persisted. It must never write from one editor's live state via one
path while writing another scene via a different path — that reintroduces
partial-commit risk even if each individual write is itself safe.

Required flow for a later stage:

1. Compute the live preview (match/scene counts) against each affected
   scene's live doc if it's open somewhere, persisted doc otherwise.
2. Before committing, check every affected scene's **text doc specifically**
   for divergence between its live and persisted state. **This check operates
   at the ProseMirror-doc level only** — comparing `docToJSON` of the live doc
   against `docToJSON(loadSceneDocument(schema, persistedScene))`, the same
   primitive `saveAllScenes()` already uses. It never reads a whole-surface
   dirty-tracker (e.g. `trackerFor("sceneModal")`).
3. **If any affected scene's text is unsynchronized, do not proceed.** Offer
   to save first. That "save" is **text-only**:
   - persist exactly `scene_text` + `metadata.richText` through the existing
     `updateSceneText`/`update_scene_text` semantics (same narrow RPC T1
     already uses for the standalone/Scene-modal/"Весь текст" text saves);
   - **never** programmatically invoke a surface's full Save action (e.g. the
     Scene modal's Save button also persists title/chapter/participants/tags —
     Find/Replace must not silently save those to synchronize text);
   - leave every unrelated dirty form field dirty and unsaved;
   - after a successful text-only save, rebase **only** the text/doc portion
     of that surface's dirty-state baseline (a targeted patch, not a full
     `captureInitialState()`, which would wrongly clear unrelated pending
     field edits) — this needs a small, narrowly-scoped addition to
     `js/dirty-state.js` when that stage is built; it does not exist yet.
4. Re-derive the match set/preview fresh against the now-synchronized state —
   never reuse pre-save positions or counts.
5. Re-check synchronization once more, synchronously, immediately before
   building the commit payload (closing the window between step 3 and commit).
6. Capture `expected_revision` at this point (after any step-3 saves already
   advanced it), build the final per-scene values from persisted/confirmed
   data only, and send them **atomically**:
   - **Cloud:** one `bulk_update_scene_text` call.
   - **Local:** one `commitDataChange` covering every affected scene.
7. On `REVISION_CONFLICT` or any failure: zero replacement writes, no partial
   state, no auto-retry — report and require reload/redo.
8. On success: sync every mounted view of an affected scene to the committed
   result via a `tr.setMeta("addToHistory", false)` transaction (so it never
   becomes an Undo step), and rebase only that scene's text baseline the same
   way step 3 does.

## Mounted-scene registry (not built yet) must support multiple live views per scene

When a later stage builds the shared mounted-scene registry that both live
search and project-wide sync will depend on, it must **not** be
`Map<sceneId, singleEntry>`. The same scene can legitimately be open in more
than one surface/registration at once (e.g. the standalone editor and an
instance inside "Весь текст"). Use a structure keyed by scene id that holds a
**collection** of registrations, e.g. `sceneId -> Map<registrationId, {view,
surfaceId, activate()}>`. A project-level synchronization (step 8 above) must
update **every** live registration for an affected scene, never just
whichever one happened to be registered last. This is recorded here as an
accepted invariant for whichever stage implements the registry — it is not
implemented in Stage A.

## v1 case-insensitive matching: `toLowerCase()`, not `toLocaleLowerCase()`

When the matching engine is built (Stage B), case-insensitive comparison uses
`String.prototype.toLowerCase()` (Unicode default case conversion), **not**
`toLocaleLowerCase()`. The same project and the same query must not produce
different match results merely because two users' browsers report different
locales. This is a deliberate departure from `js/filters.js`'s existing
`.toLocaleLowerCase("ru")` (scene-list filtering, a different, older feature
not being changed here). A future project/scene language setting may add
locale-aware casing as an explicit, opt-in layer later — it is not part of v1
and the engine must not be built in a way that assumes it.

No ё/е folding, in v1 or later — they remain distinct characters.

## NFC comparison needs position mapping (Stage B, not built yet)

Blind whole-string `.normalize('NFC')` before searching, then reusing indices
found in the normalized string as ProseMirror positions, is rejected —
normalization can change code-unit length locally (e.g. a base letter +
combining diacritic composing into one precomposed character), desynchronizing
any such index from the original text. The matching engine must instead
normalize per grapheme cluster (e.g. via `Intl.Segmenter`) while recording,
for every output comparison character produced, the original source `[start,
end)` span that produced it — then map a found match back through that
provenance table to the real source range before touching the document. Test
coverage for this (when built) must include: precomposed vs. combining
equivalents, Cyrillic, Latin, case-sensitive vs. case-insensitive, a match
adjacent to/spanning a mark boundary, and a replacement executed via the
mapped original range.

## `bulk_update_scene_text` — what exists today (Stage A)

`supabase/migrations/20260910120000_scene_text_bulk_update.sql` adds one new
RPC:

```
bulk_update_scene_text(target_project_id uuid, expected_revision bigint, replacements jsonb)
```

It is a **generic atomic bulk writer**, not Find/Replace-aware — it has no
matching/searching logic. `replacements` is a JSON array of already-computed
final values: `{scene_id, scene_text, metadata}`. Contract:

- Auth/ownership conventions match `update_scene_text` exactly (`security
  invoker`, project row locked and ownership-checked via `auth.uid()`, `anon`
  denied execute, `authenticated` granted).
- The project's `expected_revision` is checked **once** for the whole batch.
- Every targeted scene must belong to `target_project_id` and be
  non-deleted; `metadata` must be a JSON object; `scene_id` must be a valid
  UUID; duplicate `scene_id` values in one call are rejected.
- `scene_text` + `metadata` are written together per scene (same
  set-not-merge metadata contract as `update_scene_text` — `metadata` is fully
  replaced, never deep-merged).
- `projects.revision` bumps **exactly once** if the batch produced any actual
  change; an all-semantic-no-op batch bumps nothing.
- An empty `replacements` array is a defined, safe no-op.
- **Atomicity**: implemented as two passes — pass one validates and resolves
  every element (no writes), pass two writes every row only once every
  element has already been confirmed valid. This gives specific error codes
  (`VALIDATION_ERROR`/`DUPLICATE`/`NOT_FOUND`/`REVISION_CONFLICT`) for every
  expected failure while still guaranteeing that an invalid element anywhere
  in the array — including after earlier, individually-valid elements —
  results in zero writes. The write pass still `RAISE EXCEPTION`s (aborting
  and rolling back the whole call) on a defensive backstop case that should be
  unreachable given the project row is held locked from before validation
  begins. See `supabase/tests/cloud_scene_text_bulk_update_rpc.sql`.
- `REVISION_CONFLICT` is surfaced like every other project-scoped mutation and
  must never be retried automatically by any caller.

`js/cloud-content-api.js` exposes `bulkUpdateSceneText(projectId,
expectedRevision, replacements)` following `updateSceneText`'s own adapter
conventions.

**Superseded by Stage D2.2.0/D2.2.1 below.** At Stage A, neither the RPC nor
the adapter were wired into any save flow/UI, and the migration had not been
applied to any database. Stage D2.2.0 applied it to production (read-only
pre/post-flight verified, no unrelated migrations touched — see that stage's
own completion report for the exact production-safety workflow followed) with
**zero repository changes** — the migration file itself is untouched from
what Stage A wrote. Stage D2.2.1 is the RPC's first and, as of this writing,
only real caller: `js/import-export.js`'s `commitProjectReplaceAllScenes`
(project-wide Replace All's cloud commit path — see the "Stage D2.2.1" section
below for the full contract). It was validated via the repository's
disposable-CI pattern (see `.github/workflows/scene-text-bulk-update-ci.yml`)
before the production apply, exactly as
[supabase-workflow.md](supabase-workflow.md) requires.

## Stage D2.2.0: production apply of `bulk_update_scene_text`

Backend-only prerequisite for D2.2.1 — no repository source changes, no
commits, no Find/Replace UI/controller changes, `bulkUpdateSceneText` still
not called by anything at the end of this stage. Audited the migration's
contract against actual current source (not the historical Stage A report),
ran the full local unit suite (`npm test`, 38 suites including
`cloud-scene-text-bulk-api.test.mjs`) and confirmed the migration's own
disposable-CI run (`.github/workflows/scene-text-bulk-update-ci.yml`) had
already succeeded against the exact commit whose migration/test/adapter files
are byte-identical to this branch's HEAD. Production read-only pre-flight
confirmed `20260910120000` was the *only* pending migration and
`bulk_update_scene_text` did not already exist in any conflicting form; the
target `projects`/`scenes` columns matched the migration's assumptions
exactly. Applied via the repository's `npm run
db:production:migration-apply -- --version 20260910120000` (the only write
path — refuses without an exact, explicit version, and refuses unless that
version is the only migration pending), after explicit user approval for that
one migration. Read-only post-flight confirmed the RPC now exists with the
exact expected signature/grants and that no other schema/signature changed.

## Stage D2.2.1: project-wide Replace All

Implements "Заменить все" for `scope==="project"` ("Весь проект") — the
multi-scene write path Stage A's migration/adapter were built for. Unlike
project-wide Single Replace (Stage D2.1.2, an ordinary unsaved local edit),
Replace All commits immediately and atomically. Project-level Undo is
explicitly **not** provided by this stage (see "Undo" below).

### Fresh plan, always

`js/editor/find-replace-project-replace-all.js`'s `planProjectReplaceAll
(projectData, query, {caseSensitive, replaceText})` is a **pure, synchronous**
planner — no DOM, no dispatch, no persistence. It is called by
`find-replace-controller.js`'s `replaceProjectAll()` synchronously,
immediately before any commit is attempted, from the controller's own live
`query`/`caseSensitive`/`replaceText` **strings** and a fresh
`getProjectData()` call — **never** from `projectResult`/
`flattenProjectMatches` (the currently-displayed search result), which are
navigation/display snapshots and are never trusted as a write plan. Every
scene's matches are recomputed from scratch (`find-replace-model.js`'s
`findMatches`) against that scene's own current authoritative doc at the
exact moment `replaceProjectAll()` runs, exactly like Single Replace's own
`buildProjectReplacement`/`reresolveMatch` never trust a stored `from`/`to`
for mutation.

### Project scope: every non-deleted scene, `included:false` included

The planner walks `find-replace-project-search.js`'s own
`canonicalProjectScenes(projectData)` — the exact same canonical
chapter-then-scene order Stage D1 search already uses, which already
includes every active scene regardless of `scene.included` (never
`includedScenes()`/"Весь текст" export semantics). No extra filtering is
applied — an excluded scene participates in Replace All exactly like an
included one.

### Authoritative source: live doc when singly-mounted-or-agreeing, else persisted

`resolveSceneReplacementSource(scene)` (same file) resolves, per scene:

- **No live registration** (`getMountedSceneRegistrations` returns none, or
  none usable) → the persisted doc (`loadSceneDocument`), loaded fresh.
- **One live registration, or several that agree** (ProseMirror `Node#eq`) on
  content → that agreed **live** doc, even if it differs from the persisted
  one — an author's own unsaved in-progress edits in a mounted scene are
  planned as part of the replacement, not silently discarded in favor of
  stale canonical text. This means a scene's committed result can include
  BOTH the author's own pending edits AND the replacement, in one commit —
  the explicit, intended contract (not an accident of "whatever happens to be
  on screen").
- **Two or more live registrations that disagree** → `{status:"conflict"}`.

This deliberately never uses `mounted-scene-registry.js`'s own
`getPreferredLiveSceneView` — that function is built to always resolve to
SOME single best-effort answer (correct for search/navigation, which need a
live doc regardless of agreement), which is exactly the wrong policy for a
WRITE decision.

### Conflicting registrations: whole-operation abort, before any write

If ANY scene in the project has disagreeing live registrations, planning
records it and continues scanning the rest of the project (so every conflict
can be reported at once), then — regardless of whether any of the conflicted
scenes would even have matched the query — returns `{ok:false,
reason:"conflict",conflictedSceneIds}` for the **whole** operation. Zero
scenes are committed, not even ones that were unaffected by the conflict.
This is a deliberately conservative policy: a conflict means "this scene's
current content cannot be safely determined," which makes it impossible to
know in advance whether it would have matched — so it is always
disqualifying, project-wide, never scoped down to "only scenes that matched."
The panel surfaces this as a plain factual status message (see "Failure
semantics" below); the user resolves it by saving/closing the extra open copy
and retrying.

### No-op behavior

An empty query, a query that matches nothing anywhere, or a batch whose every
individual computed replacement is itself a no-op (replacement text identical
to every matched occurrence) all return `{ok:true,changed:false,
affectedSceneCount:0,totalMatchCount:0,scenes:[]}`. The controller returns
this straight through with **no** commit call, no mounted-view sync, no
dirty-baseline rebase, and no search re-run — nothing to refresh.

### Local atomic commit

`js/import-export.js`'s `commitProjectReplaceAllScenes(plan)` is
`find-replace-controller.js`'s injected `commitProjectReplaceAll` dependency.
For a local project it commits every `plan.scenes` row's `sceneText`/
`sceneTextDoc` through **one** `commitDataChange` mutator call — never a
per-scene loop (contrast `saveAllScenes`'s own pre-existing, accepted
per-scene cloud loop for *ordinary* multi-scene Save, deliberately not reused
here). `storage.js`'s own `commitProjectChange` already makes that one
transactional copy/validate/write/swap, giving "one logical Project Replace
All = one atomic local mutation" for free.

### Cloud atomic commit

Same function's cloud branch calls `runCloudMutation("bulkUpdateSceneText",
(api,revision)=>api.bulkUpdateSceneText(cloudProjectSync.projectId,revision,
plan.scenes.map(...)))` — **exactly one** RPC call for the whole batch, using
the current confirmed project revision the existing serialized cloud mutation
queue already tracks (`getRevision()` inside `createProjectMutationQueue`),
never a manually-constructed or stale revision. `REVISION_CONFLICT` (or any
other RPC failure) surfaces as `result.ok===false` through the exact same
path every other cloud content mutation uses — the queue latches
(`blocked=true`) exactly as it does for any other conflicting mutation, is
never auto-retried, and the controller's `replaceProjectAll()` reports
`{ok:false,reason:"persist-failed",error}` rather than pretending success.

### Rich text / metadata

Each `plan.scenes` row's `sceneTextDoc` comes from `scene-doc-convert.js`'s
own `serializeSceneDocument(transform.doc)` — the SAME ProseMirror
doc→`{sceneText,sceneTextDoc}` conversion every other save path uses. The
cloud commit maps it to `metadata:{richText:sceneTextDoc}`, mirroring
`update_scene_text`/`bulk_update_scene_text`'s own set-not-merge metadata
contract (T1, `20260909120000_scene_rich_text.sql`) — `scenes.metadata` is
still fully owned by the T1 rich-text feature today, so there is no other
metadata key to preserve/merge; this is the same mapping `saveAllScenes`'s
own cloud branch already uses per scene, just batched.

### Mounted EditorView synchronization

After a successful commit, `find-replace-project-replace-all.js`'s
`syncMountedScenesAfterReplaceAll(plan.scenes)` pushes every affected scene's
**exact already-committed doc** into **every** currently live mounted
registration for that scene (never only the one used as the planning source —
several AGREEING registrations must all end synchronized, per the "F.
Equivalent multiple registrations" contract). Each dispatch prefers REPLAYING
the same `replaceAllMatches` transform the plan already computed (verified
safe by checking the replay's own resulting doc against the committed doc
first) over a wholesale whole-document swap — the same dual-strategy shape
Stage D2.1.1's own (now-superseded) `syncMountedRegistrations` used, for the
same reason: a small, localized replay lets `prosemirror-history` correctly
rebase whatever ELSE is already in that view's own undo stack, while a
wholesale swap cannot guarantee that. The wholesale swap remains the fallback
for a registration that genuinely diverged from the planned "before" doc
during the one async gap a cloud commit has (unreachable for a local commit,
which is synchronous). Every dispatch is tagged `addToHistory:false`
unconditionally — see "Undo" below for why this applies even to the view the
user is actively looking at, unlike Single Replace's own active-editor
special case. Because the committed doc already equals "the live doc the
plan was built from, plus the replacement," an author's pre-existing unsaved
edits are never lost by this step — they are already baked into the
committed content the sync brings every registration to.

Immediately after, `js/import-export.js`'s `rebaseSceneTextDirtyBaseline
(sceneId, sceneTextDoc)` is called once per committed scene (unconditionally
— a no-op wherever it doesn't apply) — it rebases exactly the relevant tracked
form's own `extra.doc`/`extra.docs[sceneId]` baseline (`dirty-state.js`'s
`rebaseExtra`, the same generic primitive the — now superseded — D2.1 design
introduced) so that scene's own open form no longer reports dirty for content
that is now genuinely persisted, without silently accepting any OTHER
unrelated pending dirty state already sitting in that same form (e.g. an
in-progress title edit in the Scene modal survives untouched).

### Fresh search / active-result after success

`replaceProjectAll()` resets `activeProjectMatchIndex` to `-1` and calls the
controller's own existing `recomputeProject()` — a genuinely fresh
`searchProject()` against the now-committed project data, exactly the same
function every other project-scope trigger already uses. No match
count/offset/snippet is ever hand-patched. The new active result falls out of
`recomputeProject()`'s own existing, unmodified "genuinely fresh activation"
policy (`resolveFreshProjectActiveIndex` → `pickInitialProjectMatchIndex`:
caret-relative within the attached scene if it still has matches — e.g. the
replacement text itself still contains the query, which is a real, correctly
reported case — else the first remaining result, else `-1`/"0 из 0" if
nothing remains anywhere). Replace All deliberately does NOT reuse Single
Replace's own `pendingPostReplaceLocality` "stay local to the scene just
edited" policy — Replace All can touch many unrelated scenes in one commit,
so "the scene just edited" has no single well-defined meaning here.

### Failure semantics

Any pre-commit planning failure (`reason:"conflict"`) or commit failure
(`reason:"persist-failed"`, carrying the underlying result/error) results in
**zero** writes/sync/rebase/search-refresh — `replaceProjectAll()` returns
before any of those steps run. `find-replace-panel.js`'s
`handleProjectReplaceAll` surfaces a plain factual status message (the same
`.rte-project-replace-status` element Single Replace's own failure path
already uses) and never fabricates a replaced count or patches the results
list itself — a failed attempt leaves the previous search result exactly as
it was. The "Заменить все" button is disabled while a commit is in flight
(`projectReplaceAllInFlight`, mirrored in the controller's own `snapshot()`
as `projectReplaceAllEligible`/`projectReplaceAllInFlight`) so a second click
can never start an overlapping commit.

### Current-scene / Single Replace: unchanged

`replaceAll()` (scene scope) and `replaceProjectCurrent()` (Single Replace)
are completely untouched by this stage — `replaceProjectAll()` is a new,
separate controller method, guarded (`scope!=="project"` refuses) exactly
like every other project-scope-only operation in this file. The panel's
"Заменить все" click handler dispatches to `replaceAll()` in scene scope and
`replaceProjectAll()` in project scope, the same shape "Заменить" already
uses for `replaceCurrent()`/`replaceProjectCurrent()`.

### Undo

Project-level Undo is explicitly **out of scope**. No ProseMirror history
transaction ever spans multiple `EditorView`s, and no project-wide mutation
journal/rollback subsystem exists. Every `syncMountedScenesAfterReplaceAll`
dispatch is `addToHistory:false` **unconditionally**, including for whichever
registration the user happens to be actively looking at (unlike Single
Replace's own Stage D2.1.1 active-editor exception, which deliberately gives
the active target a normal undo-able transaction) — there is no
"undo exactly this Replace All" product requirement to satisfy, so no
registration gets a synthesized undo entry for it. Ordinary per-editor Undo
for whatever the user typed before/after Replace All in that same view is
completely unaffected; it simply never sees Replace All itself as an entry.

### Tests

`tools/find-replace-project-replace-all.test.mjs` (headless, real
ProseMirror `EditorState`, fake view stand-ins registered in the real
mounted-scene registry — same technique as `tools/find-replace-project-
replace.test.mjs`) covers: basic multi-scene Replace All with a fresh
project-search re-run afterward; `included:false` participation;
fresh-plan protection (live content changed after the last search, before
Replace All — the plan reflects the change, never a stale offset); a mounted
scene with unsaved live text (preserved, replacement applied on top of it,
never on stale canonical text); conflicting live registrations (whole-op
abort, zero local/cloud writes, injected commit function never even called);
equivalent multiple registrations (proceeds, every registration ends
synchronized); local atomicity (exactly one injected commit call covering
every changed scene); cloud-shaped atomicity (exactly one injected
"bulk" commit call, never a per-scene loop); commit failure (no fake success,
no mounted-view sync, no dirty rebase, search state left recoverable);
no-op (zero commit calls, zero sync, zero rebase); rich-text/metadata
(`sceneTextDoc` round-trips as valid ProseMirror JSON, unrelated `included`
flag untouched); and mounted-view synchronization not itself re-triggering a
second commit. `tools/find-replace-project-replace-all-browser.test.mjs`
(new) exercises the same essentials against the real running app in local
mode: a real multi-scene Replace All click updating `localStorage` for every
affected scene in one project save, an excluded scene participating, and a
mounted-but-unsaved scene's live edits surviving into the committed text.
The full unit suite (`npm test`) and the existing `tools/find-replace-
project-search-browser.test.mjs`, `tools/find-replace-project-replace-
browser.test.mjs`, and `tools/find-replace-current-scene-browser.test.mjs`
suites were re-run and remain green with zero changes needed to any of them —
confirming current-scene Replace/Replace All, Project-wide Single Replace
(including its own Undo/Redo isolation), dirty/save/discard behavior, and the
Scene Editor ⇄ Text Scene surface handoff are all unaffected by this stage.
