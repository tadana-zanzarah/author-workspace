# Responsive workspace & mobile personalization — architecture

Status: **Stage E1.1** (E0 audit → E1 mobile shell prototype implemented and
committed → E1.1 real-phone review pass, docs-only). Baseline `f007fc7`
(branch `master`). §§1–9 are the original E0 audit; §10 records what E1
actually built; §11 records the real-phone review (accepted behavior,
confirmed-but-deferred limitations, and the explicit E3 product
requirement it surfaced); §12 is the refined E2/E3 sub-staging to preserve
until those stages start.

## Product goal (context)

The platform must become usable for writing from a phone away from a desk.
Target workflow: open site → return to last relevant project/work context →
quickly create or find a scene → open its text → write → save, with minimal
taps. Target classes: desktop, small laptop/tablet, phone portrait, phone
landscape. This is not "squeeze the desktop UI until it fits."

## 1. Breakpoint inventory (confirmed)

Five files, no unified system — width breakpoints only, no container queries:

| Width | File:line | Effect |
|---|---|---|
| 1250px | `css/layout.css:594` | only use of this value |
| 1200px | `css/base.css:299` | header gap |
| 1024px | `css/base.css:302` | header padding/button sizing |
| 900px | `css/layout.css:368,600,656,681`, `css/base.css:309` | `.app-shell` single-column collapse (see below) |
| 800px | `css/modals.css:298`, `css/profiles.css:409` | Characters profile modal collapses to 1 column |
| 760px | `css/base.css:314` | dashboard cards collapse to 1 column |
| 520px | `css/locations.css:610`, `css/modals.css:334` | Locations gallery/media stack |
| 480px | `css/modals.css:305` | small-modal tuning |

Plus one non-width query: `@media(hover:none),(pointer:coarse)` at
`css/layout.css:485` — the only touch-specific rule in the codebase (card
insert-edge "+" affordance).

**Known fragility**: the `.app-shell` single-column collapse at ≤900px is
implemented twice — an original rule (`layout.css:368-373`) and a later
"V11 — этап 1" unconditional 2-column rule (`layout.css:607`) that at equal
specificity overrides it, fixed only by a third rule re-stated at the very
end of the file (`layout.css:681-684`). It currently works (confirmed live
at 850px), but depends on file-order "last rule wins", not a robust
override — worth cleaning up in E1 rather than adding a fourth layer on top.

**Dead CSS**: `.scene-info-panel` / `.app-shell.info-collapsed` fixed/overlay
rules (`layout.css:551-565,594-599,601-603`) reference a 3-column
"right information panel" that no longer exists in the DOM or JS (grep
across `index.html`/`js/` is empty outside `reference/`). The live
scene-detail surface is `#inspectorModal`, a plain centered dialog. Treat
this CSS as historical residue; the "right info panel becomes fixed/overlay"
item in the prior static audit does not apply to the current build and
should not shape E1 planning.

## 2. Runtime findings by viewport class

Verified live via the project's own dev server (`npm run review` /
`author-workspace-static` launch config) in `?local=1` mode — no Supabase
involved, no production data touched, no source files changed during
verification.

- **Desktop (1280×720)**: 2-column shell (sidebar + main) as designed;
  Table/Matrix, Cards, Compact all render correctly; full Scene Editor and
  Text Scene modals both open normally.
- **Small laptop/tablet (850×700, below the 900px break)**: `.app-shell`
  correctly collapses to a single column; `.project-sidebar` becomes
  `position:static`, height-capped (~260px) with its own internal scroll —
  **not** a drawer/overlay, just a short scrollable block stacked above the
  main workspace. Header buttons still fit without clipping at this width.
  Filter row already reflows from its wide grid to a narrower 2-column
  stack.
- **Phone portrait (375×812)**: confirms the product brief's core complaint.
  Reaching the scene list requires scrolling past: header (partially
  clipped, see below) → full sidebar block (~260px, itself scrollable) →
  local-mode banner → stats strip → view switch → the *entire* filter row
  (6 full-width dropdowns stacked vertically) before any scene content
  appears. Cards view itself renders correctly as a clean single-column
  stack once reached. Header buttons ("Экспорт", "＋ Новая сцена", etc.) are
  clipped/pushed off the visible width — `header{overflow:hidden}` combined
  with `.header-actions{flex:none}` means at this width there is no
  consolidation (no hamburger); content is silently cut off rather than
  wrapping or causing scroll.
- **Phone landscape (667×375, worst-case short viewport)**: Text Scene
  modal's title + 2-row-wrapped toolbar already consume a large fraction of
  the 375px viewport height before reaching the editor body — vertical
  space is the binding constraint here, more than width.

No page-level horizontal scroll was observed at any tested width (Matrix's
horizontal scroll stays correctly contained inside `.viewport`, per
`css/timeline.css:1-19`; note the live test project had 0 characters, so
Matrix's per-character columns — the layout's real horizontal-scroll driver
— were not exercised beyond the sticky first column).

## 3. Scene interaction model — a finding not in the prior static audit

Runtime inspection of the live DOM surfaced a real gap for the mobile
"minimum taps" goal:

- **Table/Matrix rows** already expose two always-visible, single-tap icon
  buttons per row: `openSceneText(id)` (opens Text Scene directly) and
  `editScene(id)` (opens the full Scene Editor) — `js/render.js`
  `.row-action-icon` buttons, confirmed live (`onclick`, not hover-gated).
  They render at ~28×28px, below the ~44px touch-target guideline.
- **Cards view has no equivalent.** A card's only open path is
  `ondblclick="editScene(id)"` on the `<article class="compact-scene-card">`
  — single click only calls `selectScene(id)` (a highlight/select, not
  open). There is no single-tap "open" affordance on a card at all.

Since the product direction (§7 of the brief) names Cards as the "likely
primary mobile browsing view," and double-tap is not a reliable/standard
mobile gesture (conflicts with double-tap-to-zoom expectations, has no
visual affordance), **Cards view needs an explicit single-tap open action
before or during E2** — this is a small, scoped interaction fix, not a
redesign; Table view's existing `row-action-icon` pattern (and its bound
`openSceneText`/`editScene` calls) can likely be reused directly.

## 4. Reusable responsive foundations already present

- `.viewport{overflow-x:auto}` already correctly contains Matrix's unbounded
  `grid-template-columns` width (`css/timeline.css:1-19`) — deliberate,
  documented, not accidental.
- Cards view (`.scene-cards-grid{grid-template-columns:repeat(auto-fill,
  minmax(260px,1fr))}`, `css/layout.css:421-424`) is fluid by construction,
  no breakpoint needed.
- Filter **state** (`js/filters.js`) is fully decoupled from filter **DOM**
  (`js/filter-controls.js`) — a compact mobile search bar with a collapsible
  "advanced filters" affordance can reuse the state/apply functions
  (`setFilter`, `toggleFilterValue`, `sceneMatches`) without touching
  filtering logic.
- Chapter navigation (`navigateToChapter`, `js/chapters.js:266-280`) is a
  generic `[data-chapter-id]` scroll-into-view, not sidebar-specific — all
  three scene views already carry `[data-chapter-id]` group markers. The
  same click handler can be reused from a mobile navigation drawer with no
  changes.
- The 3 sidebar sections (Chapters/Characters/Locations) are independently
  rendered (`renderSidebar()`, `js/render.js:78-90`) with a shared but
  generically-keyed collapse-state map (`SIDEBAR_SECTION_KEYS`,
  `js/storage.js:223`). Pulling Characters/Locations out into a separate
  project-level menu is low-risk — move the two DOM blocks, keep the
  existing per-section render calls and collapse-state plumbing.
- User-level menu (`#workspaceAccountMenu`: Мои проекты/Выйти) and
  project-level menu (`#projectMenu`: Главы/Персонажи/Локации/Теги/...) are
  **already two separate `<details>` elements**, not conflated — the
  target mobile IA split (§4 of the brief) already exists structurally in
  the header; it only needs surfacing differently on mobile, not building.
- "Return to last project" (§5 of the brief) is **already implemented**:
  `attemptLastProjectRestore()` (`js/cloud-app.js:290-310`) reads a
  per-user `localStorage` key (`getLastOpenProjectId`,
  `js/workspace-storage.js:29-43`) and opens the project directly on load,
  one-shot per session, cleared on explicit "Мои проекты". This is
  client/device-local only (no `profiles` column backs it — confirmed via
  `supabase/migrations/20260812193655_cloud_foundation.sql`); cross-device
  sync would need new server-side state, but single-device "resume last
  project" needs no new work for E1.
- Scene creation is already a decoupled two-step flow: open-modal-with-
  defaults (`openNewSceneAtNow`) vs. create-on-save
  (`saveSceneModalOnlyInner`, `js/app.js:507-620`). "Без главы" is the
  string sentinel `chapter-unassigned`, not `null`. This supports Quick
  Scene's requirement that a scene created without a chapter lands in the
  existing unassigned bucket, not a new entity type.

## 5. Major architectural risks for E3 (mobile writing mode)

This is the highest-risk area found. Two genuinely separate modal surfaces
exist (`#sceneModal`, `#textModal`, `#allScenesModal` — confirmed distinct
DOM containers, each independently mounting its own ProseMirror
`EditorView` and dirty tracker; a toolbar "⇄" button hands off live unsaved
content between the first two), with **different scroll models**:

- `#textModal` (Text Scene): fixed-height flex column, `height:92vh;
  overflow:hidden` (`css/editor.css:18-21`), only the ProseMirror body
  scrolls internally. Confirmed live: opens with cursor focus already in
  the body.
- `#sceneModal` (full Scene Editor): whole-modal scroll (`.modal{
  overflow:auto}`) with a **second, nested** fixed `320px` scroll box for
  the editor body inside it (`#sceneModal .rte-editor{height:320px;
  overflow-y:auto}`, confirmed live via computed style). At phone width,
  this means Date/Time/Status/Chapter/Location/Tags/Title all sit above the
  manuscript text, which itself then scrolls in its own small box — a
  double-nested scroll. This is explicitly documented in the CSS as
  intentional nested scrolling, but it is a materially worse mobile pattern
  than Text Scene's.

None of the `vh`-based sizing (`92vh`, `94vh`, `60vh`, plus the `320px`
fixed box) is keyboard-aware (no `dvh`, no JS visual-viewport tracking) —
on a real device the on-screen keyboard shrinking the visual viewport while
these stay at their static values is an untested, likely-problematic
interaction that **could not be verified in this environment** (no real
mobile keyboard available in the audit browser) — flagged as an open risk
for E3, not a blocker for planning it.

Toolbar wrapping is pure CSS flex-wrap (`css/editor.css:30-36`), no JS
measurement, confirmed live wrapping cleanly to 2 rows at both phone widths
tested — low risk. Find/Replace's results panel has a JS-managed
user-resizable pixel height (90–420px, `find-replace-panel.js:53-55`)
independent of viewport size — could dominate a short mobile screen; and
`revealDocPosition()` (`scene-editor-controller.js:255-265`) hardcodes
which ancestors scroll for each surface — a mobile layout that changes
which element scrolls must re-verify this, not just restyle it.

## 6. Modal manager / dirty-state contracts relevant to E4

`js/modal-manager.js` uses a single stacked `modalStack`, a capture-phase
`keydown` focus trap that live-queries `getFocusableElements()` (DOM-order
dependent), background-scroll-lock keyed off "stack has any entry" (not
per-modal), and `inert`/`aria-hidden` on background siblings. `js/
dirty-state.js` implements the AGENTS.md-mandated shared dirty-tracker
registry; baseline only updates after a successful transactional save.
Modal width is already `min(Npx,100%)`-capped (no literal overflow on
narrow viewports), but nothing converts to a bottom-sheet/full-screen
pattern yet — only two `@media` breakpoints exist in `modals.css` and
neither targets the scene-editor modals. A mobile bottom-sheet/full-screen
variant must preserve: the single shared `modalStack` scroll-lock, the
live focusable-element scan (don't reorder DOM without re-checking tab
order), and `revealDocPosition()`'s scroll-ancestor assumptions.

## 7. Per-surface solution classification

| Surface | Classification |
|---|---|
| Workspace shell / sidebar collapse | Mostly CSS (existing 900px break is already close; cleanup of the duplicate-rule fragility recommended) |
| Header user-menu vs project-menu split | CSS + interaction (menus already separate; needs mobile-specific placement/triggering, not new menus) |
| Cards view | Mostly CSS, **plus one interaction fix** (single-tap open, §3) |
| Compact view | Structural — current `<table class="compact-list">` (`css/layout.css:498-506`) needs a genuine responsive transform to a compact list, confirmed table-like with `min-width:220px` title cells; explicitly out of scope for E0/E1 per product brief (redesign deferred) |
| Matrix view | CSS only for now — horizontal-scroll containment already correct; do not let it drive shell architecture, per brief §7 |
| Chapter/scene navigation drawer | CSS + interaction/state — `navigateToChapter` and chapter markers are reusable as-is; needs a new drawer container and a trigger control |
| Scene search/filter compact bar | CSS + interaction/state — filter state/logic already reusable; needs new compact markup and a collapse toggle |
| Quick Scene | CSS + interaction/state + one new code path — no existing "create minimal scene, open Text Scene directly" entry point exists; needs a new thin orchestration function reusing `saveSceneModalOnlyInner`'s creation shape and `openSceneTextNow`, plus a save-time title-prompt derived from first non-empty line |
| Text Scene mobile writing | CSS + interaction (already closest to mobile-ready; keyboard-aware viewport handling is the open item) |
| Full Scene Editor mobile writing | Structural — nested nested-scroll model is a genuinely different, harder problem than Text Scene's; likely needs its own layout treatment, not a shared one |
| Modal manager / dirty-state | CSS + interaction for a mobile bottom-sheet/full-screen variant; underlying JS contracts (stack, dirty tracker, focus trap) stay as-is per AGENTS.md |
| Characters / Locations | Mostly CSS (each already has one working breakpoint; galleries are already fluid-grid) |
| Projects dashboard | Mostly CSS (already has the most complete breakpoint cascade of any surface) |

## 8. Recommended E1–E6 staging

The proposed staging is technically sound with one adjustment:

- **E1 — Responsive Foundation & Workspace Shell**: fix the 900px
  cascade-order fragility, remove/retire dead `.scene-info-panel` CSS,
  consolidate header actions at narrow widths (replace silent clipping),
  establish the mobile chapter/scene navigation drawer using the existing
  `navigateToChapter`/`[data-chapter-id]` mechanism.
- **E2 — Project Structure & Scene Browsing**: compact search/filter bar
  (reusing `filters.js`), Cards single-tap open fix, header user-menu vs
  project-menu mobile placement, Quick Scene's new orchestration path.
- **E3 — Mobile Writing Experience**: as staged, but confirm keyboard-aware
  viewport handling (`dvh`/visual-viewport API) needs a device or emulator
  with a real on-screen keyboard, not just viewport-size emulation — flag
  this explicitly as a research spike inside E3, not an assumed-solved CSS
  task. Full Scene Editor's nested-scroll model likely needs materially
  more work than Text Scene's; consider sequencing Text Scene's mobile
  treatment first and validating it before tackling Scene Editor.
- **E4 — Mobile Modal Foundation**: as staged; the "minimal portion before
  E4" note in the brief matches reality — Text Scene/Scene Editor are modals
  and already need bottom-sheet-capable modal-manager support inside E3.
- **E5 — Secondary Work Surfaces**: Characters/Locations/dashboard — lowest
  risk, most reusable existing responsive CSS.
- **E6 — Responsive Polish & Cross-device Regression**: as staged.

No changes to stage boundaries are needed beyond calling out the E3
keyboard-viewport spike and the Scene-Editor-vs-Text-Scene sequencing
above.

## 9. Explicit confirmation (E0)

No responsive production implementation was made in E0. All findings above
were gathered via read-only source inspection and live-browser inspection
against `?local=1` (no Supabase project touched, no production data
affected). The only repository change in E0 is this document.

## 10. Stage E1 — what was actually implemented

Branch `feature/responsive-workspace-shell`, commit `4c0decb`. Scope: the
first functional mobile shell, gated at the existing 760px breakpoint
(reused rather than adding a new one), desktop (>760px) untouched:

- Desktop sidebar hidden below 760px; replaced by a fixed "☰ Навигация"
  trigger opening `#mobileNavModal` — a plain centered modal (same
  contract as every other simple modal, no new scroll/backdrop model)
  listing chapters with their scenes nested underneath. Tapping a chapter
  calls the existing `navigateToChapter`; tapping a scene calls the
  existing `openSceneText` directly (one tap to text, no intermediate
  "find it in the scene list" step).
- `.main-workspace`'s five direct children reprioritized via CSS
  `order` (not a DOM move): search/view-switch, then scenes, then
  banner/dashboard/stats.
- Advanced filter dropdowns collapse behind a "Фильтры (N)" toggle;
  `#activeFilterChips`/`#filterSummary` stay visible regardless, so an
  active filter is never silently hidden.
- Header wraps instead of clipping (`header{overflow:hidden}` kept —
  it only clips escaping absolutely-positioned content, not normal
  wrapped flow; `.header-actions{flex:none}` alone doesn't let
  `flex-wrap` take effect for a single overflowing item, fixed with
  `flex-basis:100%` so it gets its own full wrapped line).
- `setupOverflowSafeMenu`'s panel repositioning (`js/app.js`) hardened
  with an on-screen clamp, needed once the wrapped header could put the
  "Меню" trigger near the left edge instead of always near the right.
- "+ Новая сцена" unchanged (still opens the full Scene Editor);
  Characters/Locations reachable via the existing header "Меню", not a
  new menu.

Two real regressions were found and fixed during E1 itself via live-browser
testing (not assumption): `header{overflow:visible}` broke horizontal
containment (reverted), and `.header-actions{flex:none}` silently defeated
the wrap fix (fixed with `flex-basis:100%`). Both are in the E1 commit
message.

## 11. Stage E1.1 — real-phone review (Android, real cloud project data)

E1 was manually tested on a real Android phone against real cloud project
data over the local network — not `?local=1`/emulated-viewport, the first
real-device pass. No production code changes resulted from this review;
see the E1.1 commit for the reasoning.

### Accepted — do not redesign

- **Mobile Navigation** (§10): tested against a chapter with 28 scenes —
  the trigger was easy to reach, the drawer read clearly, the scene list
  scrolled, and a scene was reachable quickly with the tap-to-text
  behavior working as designed. The drawer/modal-based approach is
  validated; visual sheet/fullscreen polish is a later, optional
  refinement, not a rebuild.
- **Filter progressive disclosure**: compact when collapsed, usable at
  phone width when expanded, active-filter state stayed understandable.
- **Header wrap**: actions wrap instead of silently disappearing, as
  designed — the real device did not surface a case E1's own testing
  missed.
- **No page-level horizontal overflow** from the E1 shell itself.

### Confirmed limitations — deferred, not E1 defects

These are real, but describe surfaces E1 never touched (Table/Cards/
Compact/Text Scene/deeper header IA/onboarding) — none is a regression in
what E1 actually shipped (the shell/navigation/filter/header-wrap
mechanics), so none justifies an E1 production change:

- **Table view**: still desktop-width; columns extend past the useful
  viewport. → E2 (view-specific responsive work), not E1.1.
- **Cards view**: still reads as a desktop multi-column surface at phone
  width (~1.something cards visible per row) and still has no single-tap
  "open Text Scene" action (double-tap only — see §3). Not blocking today
  because Navigation already provides a single-tap path to any scene's
  text; Cards' own tap gap is real but not an E1-completeness problem.
  → E2.1.
- **Compact view**: still table-like — date column wide, title truncated,
  controls own their own column. → deferred past the responsive
  foundation stages, unchanged from the E0 classification.
- **Text Scene**: functions well enough on a real device (including the
  Android on-screen keyboard) to validate the Navigation flow end-to-end,
  but its geometry is still desktop-modal-derived — doesn't fill the
  available mobile viewport, toolbar still wraps into multiple
  desktop-proportioned rows, and keyboard/viewport behavior needs
  dedicated work. → E3.1; see the explicit product requirement below.
- **Header information density**: "+ Новая сцена / Весь текст / Выгрузить
  текст / Экспорт / Меню / account" wrapping to multiple visible rows
  costs real vertical space on the first screen. E1's job was "reachable,
  not silently clipped" — it did that; it was never asked to also
  reprioritize which actions get first-screen real estate. A later pass
  should move secondary operations (export/download) out of premium
  first-screen space. → deferred, not an E1.1 fix (would be header-IA
  redesign, explicitly out of scope for this follow-up).
- **Empty-project onboarding**: the empty-state block duplicates
  scene-creation affordances and consumes significant mobile space on a
  fresh project. → deferred.

### Explicit E3 product requirement — Text Scene must become fullscreen on phone

Confirmed and elevated during this review as a firm requirement for E3.1,
not just an observation, recorded here so it survives until that stage:

> On phones, Text Scene must become a **true fullscreen writing surface**.
> It must not look like a large centered desktop modal. When open on
> phone: no underlying workspace pixels intentionally visible at the top,
> bottom, or left/right edges; the surface occupies the available mobile
> viewport; writing space is treated as expensive and maximized; when the
> on-screen keyboard appears, the remaining usable viewport is used
> efficiently. Desktop Text Scene does **not** need to become fullscreen
> because of this requirement — phone-only.

This sits on top of, and does not contradict, the E0 §5 finding that
`#textModal` (`height:92vh;overflow:hidden`) is already the closer of the
two editor surfaces to mobile-ready and that none of its `vh`-based sizing
is currently keyboard-aware (`dvh`/visual-viewport API still unverified
against a real keyboard at the time of E0). E3.1 implementation must
satisfy both: fullscreen geometry, and correct behavior under a real
on-screen keyboard.

### CSS visual-order vs DOM/tab-order — conclusion

E1's mobile reorder of `.main-workspace`'s children (`#storageBanner`,
`#projectDashboard`, `#statsStrip`, pushed visually below the
toolbar/board via flex `order`, §10) was flagged in the E1 report as a
known tradeoff: DOM order stays banner → dashboard → stats → toolbar →
viewport, so a keyboard/screen-reader user's linear order differs from
the sighted visual order.

Re-examined here against the actual markup (`js/render.js`
`renderDashboard`/`renderStats`, and every writer of `#storageBanner` —
`js/storage.js`, `js/cloud-app.js`): **none of the three reordered
regions contains a single focusable element.** `#statsStrip` is
`<span class="stat-pill">` text pills; `#projectDashboard` is
`<span>`/`<div>`/`<strong>` pipeline stages and a progress bar;
`#storageBanner` only ever receives `.textContent` (never markup with
controls). Tab-key navigation only stops on focusable elements, so this
reorder has **zero effect on keyboard tab order** — there is nothing in
these regions to tab to out of sequence.

What remains is a narrower, non-blocking concern: a screen reader
browsing linearly (not tabbing) would still encounter the banner/
dashboard/stats text before the search box and scene list, opposite the
sighted visual order — a WCAG 1.3.2 "meaningful sequence" nicety, not a
functional or correctness defect (nothing is mislabeled, hidden from, or
inaccessible to assistive tech, just sequenced differently). **Conclusion:
not a blocking E1 accessibility/correctness problem — no fix in E1.1.**
Track it for a later responsive/accessibility cleanup pass, where the
options are (a) leave it, given the practical impact is low, or (b) move
the three containers' static markup later in `index.html` once their
final mobile treatment (§ "Confirmed limitations" above — onboarding/
header IA work) is settled, rather than patching DOM order twice.

## 12. Refined E2/E3 sub-staging (preserve — do not implement yet)

Refines §8's E2/E3 boxes into the sequencing agreed after the E1.1 review;
stage boundaries elsewhere in §8 are unchanged.

- **E2.1 — Mobile Cards + scene access**: true single-column phone Cards
  using phone width efficiently; scene title stays primary, secondary
  metadata becomes compact; a clear single-tap action opens Text Scene
  (reusing Table's existing `openSceneText`/`row-action-icon` pattern,
  §3). Do not attempt Table or Compact in the same pass.
- **E2.2 — Quick Scene**: a second, fast-capture creation path, distinct
  from and additional to the existing "+ Новая сцена" (which must keep
  opening the full Scene Editor unchanged). Enters text immediately, no
  upfront metadata form; on Save, derives a default title from the first
  non-empty line, shown prefilled and immediately editable (accept as-is
  or type over it without first clearing a placeholder); saves into the
  existing unplaced/"Без главы" semantics with an appropriate default
  status. §4 already confirms the reusable pieces: `openNewSceneAtNow`
  vs. create-on-save are already decoupled, and `chapter-unassigned` is
  already the correct landing bucket.
- **E3.1 — Mobile Text Scene**: the fullscreen requirement above, real
  on-screen-keyboard/viewport behavior, maximized writing area, mobile
  toolbar treatment, phone-appropriate Save/Close.
- **E3.2 — Full Scene Editor mobile adaptation**: follows E3.1; harder,
  per §5's nested-scroll finding (double-nested vs. Text Scene's single
  fixed-height model).

## 13. Explicit confirmation (E1.1)

E1.1 made no production CSS/DOM/JS changes — see the E1.1 commit for why
none was justified. E2, E3, Quick Scene, and fullscreen Text Scene were
not implemented. Supabase, migrations, `reference/`, and `backup/` were
not touched. The only repository change in E1.1 is this document.

## 14. Stage E2.1 — Mobile Cards + single-tap scene access

Scope: Cards only, gated at the same 760px mobile-shell breakpoint as E1;
no new breakpoint. Table/Compact/Text Scene/header IA/Quick Scene
untouched, per the E1.1 real-phone findings above.

- **Single column**: `.scene-cards-grid`'s desktop `grid-template-columns:
  repeat(auto-fill,minmax(260px,1fr))` (§7) was, at real phone widths,
  fitting a partially-visible second column instead of one true column —
  exactly the E1.1-confirmed defect. Fixed with one override inside the
  existing mobile media query: `grid-template-columns:minmax(0,1fr)`. The
  card itself (`.compact-scene-card`) needed no changes — it already
  filled its own grid cell at 100% width/height, so a wider single cell is
  enough; no new metadata model, no restructured card markup.
- **Single-tap to Text Scene**: the card's own `onclick` (previously
  `selectScene(id)` directly) now routes through a new
  `handleCardPrimaryTap(id)` (`js/scenes.js`) that branches on the same
  760px `matchMedia` query used for the CSS: below it, calls the existing
  `openSceneText(id)`; at/above it, calls `selectScene(id)` exactly as
  before. No second editor-opening implementation, no new permanent
  "Открыть текст" button — the card surface itself stays the tap target,
  per the product requirement. `ondblclick="editScene(id)"` (full Scene
  Editor) is unchanged on both tiers.
- **Nested-control protection**: every interactive element already inside
  a card — location/character/tag chips, the two reorder buttons, the
  title's own quick-rename `ondblclick` — already called
  `event.stopPropagation()` in its own handler before E2.1. That existing
  protection is what makes routing the card's primary tap through
  `openSceneText` safe with zero additional event-handling code: a tap
  that starts on any of those controls never reaches the card's own
  `onclick` at all, regardless of what that handler does. Confirmed live
  (and in `tools/mobile-cards-browser.test.mjs`) rather than assumed.
- **Desktop unchanged**: verified live — at desktop width
  `.scene-cards-grid` keeps its multi-column auto-fill grid, a single
  click still only selects (`.selected-scene` class, no modal), and
  double-click still opens the full Scene Editor.

Deferred to real-phone review (expected, not a completeness gap for this
stage): exact card padding/typography/touch-target sizing ("early
functional layout, not final visual polish", per the task); a real
device's own default zoom/density may make the single column read
differently than the emulated-viewport checks here; Table and Compact
remain untouched and still desktop-shaped, as intended for this stage.

### E2.1 real-phone microfix — internal horizontal scroll

Real-phone testing (single-tap and single-column geometry both accepted)
found a bug the above missed: a horizontal swipe could still pan Cards
content left/right, clipping titles/metadata on the left. Root cause:
`#board{min-width:max-content}` (`css/timeline.css:21`) is unconditional —
it exists so Matrix's grid never gets squeezed below its natural column
widths, but the same rule also floors Cards' board at its content's
*unwrapped* intrinsic width (long titles/metadata can exceed the phone
viewport this way even though everything still visually wraps normally).
`.viewport{overflow-x:auto}` correctly contained that oversized board
*within itself* — so `document.documentElement.scrollWidth` stayed clean,
which is exactly why the original E2.1 check (page-level overflow only)
missed it — but the internal container itself was genuinely scrollable,
and a real touch swipe could pan it.

Fix: `.board.view-cards{min-width:0}`, scoped inside the same mobile media
query, touching only the Cards board at phone width. Matrix
(`.view-table`) and desktop Cards are unaffected — verified live and in
`tools/mobile-cards-browser.test.mjs`, which now checks `.viewport`'s own
`scrollWidth`/`clientWidth` and that it cannot be panned to a non-zero
`scrollLeft`, not just page-level overflow (and confirms Matrix still can
be panned at the same phone width). Confirmed this new check actually
catches the bug by re-running it with the fix temporarily reverted before
restoring it.

## 15. Stage E2.2 — Quick Scene

Fast, text-first scene capture (`#quickSceneBtn`, "Быстрая сцена"), a
second header action distinct from and alongside "+ Новая сцена"
(`#addFirst`, unchanged — still opens the full Scene Editor with its full
metadata form). Creates a normal Scene, never a second entity type.

**Reuse decisions** (see `js/scenes.js`'s own "Stage E2.2" section for the
full comments):

- **Editor**: the same `mountSceneEditor()` (`js/editor/scene-editor-
  controller.js`) every other rich-text surface already uses, mounted with
  `scene:null` — the same pattern `openNewSceneAtNow` already uses for
  `#sceneModal`'s own inline editor before a scene exists. No second
  ProseMirror integration. `findReplaceContainer`/`surfaceId`/
  `onSwitchSurface`/etc. are all omitted — every one of them degrades
  safely when absent (per that function's own doc comments), and none
  makes sense for a scene that doesn't exist in `data.scenes` yet.
- **Two steps, one modal**: `#quickSceneWriteStep` and
  `#quickSceneTitleStep` toggle via the native `hidden` attribute inside
  ONE `#quickSceneModal` — the mounted editor/typed doc is never
  destroyed or serialized across the step change, and modal-manager's
  existing focus-trap already excludes hidden content (`getFocusableElements`
  checks `hidden`) with no extra code.
- **Title generation**: reuses the canonical plain-text extraction every
  editor's own `serialize()` already produces (`docToPlainText`,
  `js/editor/scene-doc-convert.js` — the same helper word count/full-text
  search/.doc export already rely on) and the canonical grapheme-safe
  segmentation Find/Replace already uses (`segmentGraphemeClusters`,
  `js/editor/find-replace-text.js`) for truncation, so a generated title
  is never cut mid-character. First non-blank line, internal whitespace
  collapsed, capped at 60 grapheme clusters. No new text-processing
  utility was invented.
- **Persistence**: mirrors only the NEW-scene subset of `js/app.js`'s
  `saveSceneModalOnlyInner` (create + always-empty tags/participants/
  relations + text) at the primitive level — `commitDataChange` for
  local, `runCloudMutation` + the same `api.createScene`/`setSceneTags`/
  `setSceneCharacters`/`cloudState.characterApi.setSceneRelationChanges`/
  `updateSceneText` calls for cloud, same `sceneToCloud`/append-position
  math — rather than calling that function directly (it reads
  `#sceneModal`'s own DOM directly, no seam for a different caller) or
  refactoring it (sensitive, well-tested, shared production code; a
  broad extraction was judged out of scope for this stage). **No schema
  or RPC change was needed or made.**
- **Fullscreen mobile writing surface**: `.mobile-fullscreen-modal`
  (`css/editor.css`) is a new, deliberately generic primitive — true
  fullscreen on phone (`100dvh`, no border-radius/margin), an ordinary
  centered modal on desktop. Introduced now because Quick Scene needed it,
  consistent with the firm E3.1 requirement recorded in §11 above.
  **`#textModal` itself was not touched** — adapting existing Text Scene
  to this same shell is still E3.1's job.

**Default scene semantics** (all read from the existing "+ Новая сцена"
contract, not invented): `chapterId:"chapter-unassigned"`,
`status:"floating"` (unplaced), `writingStatus:"draft"`, empty
`locationId`/`tags`/`people`, `dateReview:false` — exactly what
`openNewSceneAtNow` already uses when opened with no explicit position
(header button, empty-project "Создать сцену").

**Safety**: a shared `quickSceneSaving` flag + disabled confirm button
guard against double/repeated taps creating duplicate scenes (verified:
two concurrent `handleQuickSceneConfirm()` calls produce exactly one
scene); the modal/editor are only closed/destroyed after creation
resolves `ok:true` — a failure leaves the modal open with the typed text
and confirmed title intact (verified with a monkey-patched
`commitDataChange` forced to fail); whitespace-only content cannot
advance past the writing step or create a scene; `quickSceneModal` is a
fully AGENTS.md-compliant tracked/guarded modal (dirty-tracker
registration in `js/app.js`'s `editorTrackers`, guarded close via
`requestCloseModal` on the close button/backdrop, generic Escape handling
via modal-manager).

**A real bug found and fixed while implementing this** (not shipped):
`quickSceneEditor` was first written as a module-local `let` in
`js/scenes.js`. Since `js/app.js`'s dirty tracker needs to read it too
(same reasoning as its existing `sceneModalTextEditor`/`sceneTextEditor`
extras), a module-local binding is invisible outside `scenes.js` — the
tracker would have silently always seen `doc:null`. Fixed by declaring it
in `js/state.js`'s shared `initialState` (the codebase's existing
convention for exactly this kind of cross-module mutable editor-instance
state), alongside `sceneTextEditor`/`sceneModalTextEditor`.

**Deferred to E3.1** (not touched here): full Text Scene mobile
adaptation (`#textModal` itself), mobile toolbar treatment, on-screen-
keyboard/visual-viewport behavior, Find/Replace integration on phone, POV
controls on phone, full Scene Editor mobile adaptation.

## 16. Explicit confirmation (E2.2)

Quick Scene creates a normal Scene through the existing canonical
persistence path (local `commitDataChange` / cloud RPCs) — no new
database entity, no schema change, no migration. E3.1 (fullscreen Text
Scene adaptation, mobile toolbar/keyboard), Table/Compact/Characters/
Locations/header-IA redesign were not implemented. Supabase itself,
migrations, `reference/`, and `backup/` were not touched.

## 17. Quick Scene real-phone fullscreen microfix (post-E2.2)

Real-device review of E2.2 found two issues, fixed as small, scoped
corrections rather than reopening E2.2 itself:

- **Open-path blocker** (unreproduced): a real Android tap showed the
  button's pressed state but no modal ever opened. Extensive investigation
  (desktop click, phone-width click, genuine touch+Android UA, simulated
  cloud mode with a large project, actual cloud-mode header DOM state) could
  not reproduce it through any faithful local/mobile/touch/simulated-cloud
  path. The one concrete, provable gap found: the `openQuickScene` ->
  `requestEditorTransition` -> `mountSceneEditor` chain had no error
  handling at all — any exception anywhere in it would previously fail
  completely silently (the tap shows its normal pressed CSS state and
  nothing else ever happens), exactly matching the symptom. Fixed with a
  `.catch()` that logs and shows a user-facing message — a diagnostic safety
  net, explicitly **not** a proven root-cause fix.
- **Fullscreen geometry defect**: on phone, a strip of the underlying
  workspace stayed visible below the "fullscreen" surface. Root cause was a
  CSS specificity clash, not a missing rule — this is the important, general
  finding for E3.1 below.

### The specificity finding (load-bearing for E3.1)

`.mobile-fullscreen-modal .modal{height:100dvh...}` (two classes,
specificity `0,2,0`) was silently losing to the per-modal shell's own ID
rule, e.g. `#quickSceneModal .modal{height:min(80vh,640px)}` (ID + class,
specificity `1,1,0`) — an ID selector always outranks any number of
classes, regardless of source order, so the "fullscreen" override was
present in the stylesheet and still never won. Fixed by marking the
primitive's four sizing properties (`width`, `max-width`, `margin`,
`border-radius`, `height`, `max-height`) `!important`, scoped to the
`@media(max-width:760px)` block for exactly this one class — the
primitive's whole contract is "no matter what a consuming modal declares
for its own desktop sizing, phone gets true fullscreen," which is exactly
what `!important` is for here. Confirmed in-browser: rendered geometry
exactly matches the viewport, no border-radius, no margin; desktop
unaffected. **This is why E3.1 below verifies actual rendered geometry via
`getBoundingClientRect()`, not the presence of a fullscreen rule** — a
declared rule losing the cascade is invisible to anything that only checks
for the rule's existence.

## 18. Stage E3.1 — Mobile Text Scene fullscreen writing experience

Adapted the existing `#textModal` (Text Scene) into a true phone-fullscreen
writing surface, reusing the exact same `.mobile-fullscreen-modal`
primitive Quick Scene already uses (css/editor.css) — no second fullscreen
implementation, no new editor, no new modal.

### What changed

- `index.html`: `#textModal` gained the `mobile-fullscreen-modal` class
  (same as `#quickSceneModal`). Its old inline `style="width:min(1100px,
  100%)"` was removed and folded into `#textModal .modal`'s own CSS rule
  instead, so the primitive's phone-only `!important` overrides only have
  one thing to beat (the ID rule), not an inline style too — keeping the
  same mechanism §17 already established, not a second one.
- `css/editor.css`: `#textModal .modal` gained an explicit `width` (moved
  from the inline style above); the `.mobile-fullscreen-modal` primitive's
  own comment was updated to note both Quick Scene and Text Scene now share
  it.
- `tools/mobile-text-scene-browser.test.mjs` (new): genuine-touch mobile
  regression, modeled directly on `tools/quick-scene-browser.test.mjs`'s
  own E2.2.1 lesson (`isMobile:true, hasTouch:true`, Android UA,
  `page.tap()`).

No JS changes were required. `openSceneText`/`openSceneTextNow`
(js/scenes.js), the modal-manager `showModal(..., {initialFocus:...})`
call, and the dirty-state guard were already correct and already shared
with Quick Scene — the defect (and the fix) were entirely in CSS/markup.

### Mobile scroll ownership

Already correct before this stage and unchanged: `#textModal .modal` is a
fixed-height flex column (`display:flex;flex-direction:column`, height now
resolved via the fullscreen primitive instead of the old plain `92vh`);
`.rte-toolbar`/footer are `flex:none` (consume only their required height);
`.rte-editor` is `flex:1 1 auto;min-height:0;overflow-y:auto` — the single
scrolling region. This is the *opposite* of `#sceneModal .rte-editor`'s own
fixed `height:320px` (T2's legacy pattern for the modal that scrolls as a
whole) — Text Scene was already built around "the manuscript is the
primary scroll," which is exactly what the phone contract in this stage's
brief asked for. Verified in-browser with a 120-paragraph scene: the editor
scrolls internally from 0 to its full `scrollHeight`, `window.scrollY`
stays `0` throughout, and `document.documentElement.scrollWidth` never
exceeds the viewport width.

### Keyboard / viewport — what's proven and what isn't

Text Scene's `showModal("textModal",{initialFocus:sceneTextEditor.view.dom})`
call is the identical modal-manager initial-focus mechanism Quick Scene
already uses, which the latest real-phone review (immediately preceding
this stage) confirmed now reliably opens the Android on-screen keyboard.
No focus-lifecycle change was made or needed for Text Scene — same
mechanism, same expected behavior. This is an inference from a shared code
path, not something this stage's automated tests can verify: **Playwright
cannot drive a real Android on-screen keyboard or its visual-viewport
resize**, so no automated test here asserts keyboard-open behavior or
proves the manuscript remains usable *while the keyboard covers part of the
screen*. What the automated regression does prove is the geometry Playwright
can control: fullscreen `getBoundingClientRect()` against the page
viewport, genuine DOM focus after a real touch-tap open path, and internal
(not page-level) scroll for a long manuscript. Real-phone review is the
only way to confirm keyboard-open behavior and on-screen-keyboard-visible
layout — this is an explicit, named limitation, not an oversight.

### Functionality preserved

Verified live (in-browser) and via the new regression: rich-text editing,
formatting toolbar (bold/italic/strike/alignment/undo/redo/scene-break),
POV/text insertion control, Find/Replace entry (`a→z` opens the panel
inline, still reachable inside the fullscreen shell), "Редактор сцены"
handoff (round-trip, carries the live unsaved doc both directions), Save,
Save-and-close, Close/discard guard (existing dirty-state semantics,
unchanged), and landscape phone sanity (667×375: fullscreen, no clipping,
toolbar fits one row, footer reachable, no horizontal overflow). No
controls were removed, hidden, or redesigned — the existing `.rte-toolbar`
`flex-wrap` already handles narrower widths (same mechanism Quick Scene's
own toolbar already relies on).

### Deferred (not this stage)

Full Scene Editor mobile adaptation (`#sceneModal`) — confirmed still an
ordinary non-fullscreen modal on phone during this stage's testing, exactly
as intended; per §7/§12's own nested-scroll finding this is a genuinely
harder, structurally different problem, still E3.2's job. Table/Compact
redesign, new metadata, Supabase/schema changes — none touched. Real
on-screen-keyboard-visible layout verification — real-phone only, see
above. Landscape polish beyond the basic sanity check above — E6.

## 19. Explicit confirmation (E3.1)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E3.2 (full Scene Editor mobile adaptation) was not started — `#sceneModal`
was not touched. Cards/Table/Compact and the mobile header were not
redesigned. No new metadata fields were added.

## 20. Real-phone E3.1 acceptance + Stage E3.1.1 result-row horizontal-scroll microfix

Real Android phone review **accepted** Stage E3.1 in full: Cards tap and
Navigation tap both reach Text Scene, true fullscreen holds, the Android
keyboard opens automatically, portrait writing/editing/long-text scrolling
all work, save/footer stay usable, the Scene Editor handoff works, and
Find/Replace opens and functions. Landscape Text Scene itself does not
catastrophically break (see the deferred item below for the one real
landscape usability issue found). The general E3.1 fullscreen architecture
was not reopened.

One concrete defect was found: in project/global Find/Replace result mode,
a result snippet wider than the phone viewport was genuinely unreachable —
not just visually truncated, but **inaccessible**. Root cause:
`.rte-project-result-row{overflow:hidden;text-overflow:ellipsis}`
(css/editor.css) clips each result row's own snippet to its box exactly as
intended on desktop, but `overflow:hidden` also blocks any user-initiated
scroll of the clipped content — there was no way to swipe to the rest of
the snippet, on any viewport width. `.rte-project-results` (the row's own
scroll-parent, the vertically-scrolling list of rows) was never the actual
overflow boundary — each row already clips its own content to its own box
before the overflow could ever reach the list — so making the *list*
scroll further would not have fixed anything; the row itself is the
narrowest correct scroll owner.

Fixed with a phone-only (`@media(max-width:760px)`) override: each
`.rte-project-result-row` gets `overflow-x:auto` (replacing `hidden`) and
`text-overflow:clip` (`ellipsis` requires `overflow:hidden` to render at
all, so it's incompatible with genuine scroll and was dropped on phone
only), plus `overscroll-behavior-x:contain` as a defensive measure against
scroll-chaining. `white-space:nowrap` (already present) is what keeps each
snippet on one line rather than wrapping. The list's own vertical scroll
and each row's horizontal scroll are independent axes on different
elements, so this does not create the kind of same-axis scroll conflict
Stage E2.1's Cards/`.board` microfix had to fix. Desktop is completely
unaffected (`overflow-x:hidden`/`ellipsis` unchanged, verified at
1280×800).

Verified in-browser: a seeded scene with a long single-line sentence
containing a unique keyword produces a project-search result row with
`scrollWidth` (727px) genuinely exceeding `clientWidth` (338px);
`scrollLeft` moves and reveals previously-clipped text; the results list,
the Text Scene modal's own fullscreen geometry, and
`document.documentElement`'s width are all unaffected. The automated
regression (below) initially only checked that `scrollLeft` could be set
and moved — that check passed even against the **unfixed** CSS, because
Chromium accepts a programmatic `scrollLeft` assignment on an
`overflow:hidden` element (the same mechanism that makes
`scrollIntoView()` work on hidden-overflow containers) even though a real
touch drag could never reach it. The regression was corrected to assert
the actual computed `overflow-x` value instead (must not be `hidden`),
confirmed to fail against the unfixed CSS and pass with the fix — the same
"prove it reproduces the real defect" discipline this stage has followed
since the E2.2.1 Quick Scene investigation.

**Files changed:** `css/editor.css` (the fix);
`tools/mobile-text-scene-browser.test.mjs` (new project-search scene
fixture + horizontal-scroll assertions, inserted into the existing phone
regression rather than a new file, since it exercises the same Text Scene
Find/Replace surface already under test there).

### Deferred to E6 — compact mobile Find/Replace / landscape

Real-phone landscape review found that with the Android keyboard, browser
chrome, and an *expanded* project Find/Replace panel all present
simultaneously, very little manuscript height remains — Text Scene itself
does not break, but the writing area becomes impractically short. This
microfix intentionally does **not** address it (no Find/Replace redesign,
no hidden controls, no keyboard hacks, no landscape redesign). Recorded as
a deferred E6 mobile UX item: Find/Replace should eventually support a
compact/collapsed mobile state so an expanded project-results list doesn't
consume most of the usable landscape writing viewport. A likely direction
is a compact active-search strip (e.g. current-match count + previous/next
+ an explicit expand-results affordance) — the exact design is
intentionally **not** decided here.

## 21. Explicit confirmation (E3.1.1)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E3.2 was not started. Find/Replace itself was not redesigned — only
`.rte-project-result-row`'s overflow behavior changed, phone-only. Matrix's
own horizontal-scroll behavior (Stage E2.1) was not touched or altered.
