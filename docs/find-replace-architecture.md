# Find / Replace — architecture

Status: **Stage A** (atomic cloud persistence foundation), **Stage B**
(headless matching/replacement engine), **Stage C** (current-scene panel,
shortcuts, highlighting, Replace/Replace All, across all three rich-text
surfaces) and **Stage D1** (project-wide search, results, navigation) are
implemented. Project-wide **Replace All** is explicitly **not** implemented
yet — Stage D1's panel keeps the Replace field visible in "Весь проект" scope
but disables the replace actions with an explanation; `bulkUpdateSceneText`
remains unwired. This document records the decisions those later stages must
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
exposes `navigableMatchCount` (its length), `activeNavigableMatchIndex` (the
active match's position within it, by `matchId`, or `-1` if the active match
isn't in the domain), `offSurfaceMatchCount`
(`totalMatches - navigableMatchCount`), and `isGroupSurface`
(`typeof getNavigableSceneIds==="function"` -- true only for "Весь текст",
the one surface with a real multi-scene domain; standalone/Scene modal never
pass that dependency at all). No second "is this navigable" definition was
written anywhere -- the panel only ever reads these four snapshot fields.
`find-replace-panel.js`:
- the arrow counter now renders `activeNavigableMatchIndex+1` of
  `navigableMatchCount` (falling back to the existing "0 из 0" convention,
  and disabling ↑/↓, whenever `navigableMatchCount` is 0 -- e.g. the current
  scene/domain has no matches even though the project does elsewhere);
- the project-results summary stays entirely global (total matches, affected
  scenes, every row), and appends `· ещё N вне «Весь текст»` (N =
  `offSurfaceMatchCount`) only when `isGroupSurface` is true AND N>0 -- never
  on standalone/Scene modal, where "вне «Весь текст»" would be a category
  error (that surface isn't "Весь текст"), and never when every project
  match already lives inside the current domain.

Explicit result-row clicks (`activateProjectMatch`) are unchanged and remain
fully unrestricted, including into off-domain/excluded scenes; after such a
click opens a new destination surface, that surface's OWN (fresh) controller
instance computes its own domain/counter from scratch -- the destination
counter naturally reflects wherever the user actually landed, never the
originating surface's numbers.

Regression coverage added to `tools/find-replace-project-search-browser.test.mjs`:
a "гепард" fixture (2 mounted scenes, 3 matches total, plus 50 more in one
excluded scene) proving the "Весь текст" counter denominator is 3 (not 53),
that the summary reports "ещё 50 вне «Весь текст»", and that a full 4-press
Next cycle wraps back to its own starting numerator without ever opening the
excluded scene; the existing "тюлен" standalone/Scene-modal fixture (3
matches in one scene + 1 in an excluded sibling) proving the counter there
reads against 3 (not 4) and the off-surface suffix never appears; a "морж"
fixture matching only an excluded scene, proving both surfaces show "0 из 0"
with ↑/↓ disabled while the project result row stays present and clickable;
and a case-B click on an off-surface result (`scene-unmounted`, already used
by the D1 final fix's own modal-lifecycle regression) confirming the
destination's own counter reflects its own 3-match domain with no off-surface
suffix.

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
conventions. **Neither the RPC nor the adapter is wired into any save flow or
UI yet** — Stage A only establishes and tests the primitive itself.

The migration has **not** been applied to any database (local or production).
It has been validated via the repository's disposable-CI pattern (see
`.github/workflows/scene-text-bulk-update-ci.yml`), not against a live
Supabase project. Production apply requires the full workflow in
[supabase-workflow.md](supabase-workflow.md) plus explicit per-migration
approval, and is out of scope until a later stage actually needs the RPC live.
