# Responsive workspace & mobile personalization — architecture

Status: **Stage E3 closed** (accepted through E3.2.11, baseline `7179400`).
**Read §50 first** — it is the consolidated, canonical description of the
accepted responsive/mobile-writing state and of what remains for E4–E6.
§§1–9 are the original E0 audit; §10 records what E1 actually built; §11
records the E1 real-phone review; §12 is the E2/E3 sub-staging; §§14–49 are
the per-stage records (E2.1 → E3.2.11) and are **historical**: several of
them describe designs later corrected or reverted (e.g. §26 unbounded
manuscript, §32 E3.2.3 shared space, the `:has()` static footer of §38), so
where a stage record disagrees with §50, §50 wins.

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

## 22. Stage E3.1.2 — project Find/Replace shared horizontal results scroll

E3.1.1 (§20) technically solved reachability — a clipped snippet was no
longer permanently unreachable — but real-phone review rejected the
interaction model it used: making each `.rte-project-result-row`
**independently** horizontally scrollable gave every row two competing
touch gestures on the same small tappable surface (tap-to-navigate vs.
swipe-to-reveal), and each row scrolled to its own independent horizontal
position, so inspecting later context across several results meant
swiping every row separately. Visually and conceptually the rows form ONE
result surface, so horizontal position should belong to that surface as a
whole, not to each row.

### Scroll ownership: before vs. after

- **E3.1.1**: each `.rte-project-result-row` was its own horizontal scroll
  owner (`overflow-x:auto`), independent of every other row.
- **E3.1.2**: `.rte-project-results` — the results LIST, already the
  *vertical* scroll owner (`overflow-y:auto`, unconditional at every
  width) — becomes the single *horizontal* scroll owner too, phone-only.
  Individual rows get `overflow:visible` (not `hidden`, not `auto`) — a
  row with `overflow:visible` is not a scroll container at all; assigning
  it a `scrollLeft` is a documented no-op in every browser, which is
  exactly the proof this stage's regression uses that rows are no longer
  independently scrollable (see below).

### How the shared coordinate space is established

No extra wrapper element or explicit width was needed. Each row's
`white-space:nowrap` text simply paints past its own box once
`overflow:visible` stops clipping it; CSS's standard "scrollable overflow"
propagation carries that painted region through any ancestor that is ALSO
`overflow:visible` (the row itself, `.rte-project-result-group`) until it
reaches the nearest actual scroll-clipping ancestor —
`.rte-project-results`. That element's own `scrollWidth` therefore
genuinely reflects the widest row's content, and a single `scrollLeft` on
it moves every row's visible position together, since all rows share its
one coordinate space by construction (they are siblings/descendants
scrolled by the same container, not separately positioned elements kept
in sync by JS). This is pure native block-overflow propagation — no
custom scroll-sync or gesture-detection code was written, per the task's
own preference for native browser scrolling over custom JS.

### Final interaction contract (phone, project/global Find/Replace results)

- **Vertical** swipe/scroll on the results surface → browse result rows
  (unchanged from before either stage).
- **Horizontal** swipe/scroll on the results surface → inspect later
  context shared across the whole visible result set — scrolling once
  shifts every visible row by the same amount.
- **Tap** a result row → navigates to that exact match (existing
  `activateProjectMatch` wiring, completely unchanged by either stage —
  native click-after-scroll suppression is what keeps a drag-to-scroll
  gesture from also firing a spurious navigation, with no extra code).

Verified in-browser with two long-line project-search results: rows report
`overflow-x:visible` and ignore `scrollLeft` assignment entirely (stays at
0); `.rte-project-results` reports `overflow-x:auto` with genuine
`scrollWidth>clientWidth` and its `scrollLeft` does move; after scrolling
it, both visible rows' `getBoundingClientRect().left` shifted by the
identical delta (200.26px in one manual check); a tap on a row after
scrolling correctly activated that row's own match; the Text Scene modal
stayed exactly fullscreen; the page gained no horizontal scroll
(`scrollWidth===clientWidth`, `window.scrollX===0`); vertical result-list
browsing and the manuscript editor's own vertical scroll were both
unaffected. Desktop is untouched: rows still compute `overflow:hidden`/
`text-overflow:ellipsis`, and `.rte-project-results` has no horizontal
overflow to scroll at all (`scrollWidth===clientWidth`), since desktop
rows still clip their own content before it could ever reach the list.

**Files changed:** `css/editor.css` (E3.1.1's phone-only rule replaced,
not left active alongside a second mechanism);
`tools/mobile-text-scene-browser.test.mjs` (fixture extended to two
long-line scenes so the regression can prove rows share one coordinate
space, not just that one row overflows; assertions rewritten for the new
contract).

**Test-methodology note** (continuing the E3.1.1 lesson): a bare
"`scrollLeft` moved" check is not proof of real scrollability — Chromium
accepts a programmatic `scrollLeft` assignment even on elements that
aren't real scroll containers in some cases. This stage's regression
instead asserts the actual governing computed property
(`overflow-x:visible` for rows, i.e. definitively *not* a scroll
container) plus the *documented no-op* behavior that follows from it
(assigning `scrollLeft` to an `overflow:visible` element must leave it at
0), and separately proves the shared owner's `scrollLeft` both moves AND
produces the identical rect shift across multiple sibling rows — geometry
proof, not just a CSS declaration check.

## 23. Explicit confirmation (E3.1.2)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E3.2 was not started. The Find/Replace panel itself was not redesigned,
no controls were collapsed for landscape, search/replace semantics and
result-navigation semantics are unchanged, and no multi-line mobile result
cards were introduced — this stage only changed which element owns
horizontal overflow for project-search results on phone.

## 24. Stage E3.1.3 — shared-scroll row geometry microfix

E3.1.2 (§22) introduced shared horizontal scrolling for project-search
results, and real-phone review confirmed the shared-scroll interaction
itself felt correct. But the same review found a geometry defect in how it
was implemented: E3.1.2 made each row's `white-space:nowrap` text paint
past its own box under `overflow:visible`, relying on that unclipped ink
propagating up to `.rte-project-results` to establish the shared scroll
width — but a row's `background`/`border` (its active-match highlight)
paints only inside that row's own BOX, which E3.1.2 left at a fixed
`width:100%`. After scrolling, the revealed text continuation had no
background under it — the same logical row visually split into a
highlighted part and a plain part at the original viewport edge.

Investigation found hit-testing was **not** actually broken by this — a
point on the unclipped, overflowing text still resolved via
`elementFromPoint` to a descendant inside the row, since nothing clipped
it — but relying on that implicit ink-hit-testing behavior instead of the
row's real box was fragile, and the painted state was visibly wrong
regardless.

**Fix**: `width:max-content` (not `100%`) on `.rte-project-result-row`,
phone-only. Each row's own box now genuinely sizes to its own content's
actual width, so background/border/hover/active states — and the box used
for hit-testing — cover the row's entire real extent. A short row's box
stays short; the longest row still governs `.rte-project-results`'s own
`scrollWidth`. No wrapper element or JS was needed:
`.rte-project-result-group` (no explicit width, default
`overflow:visible`) lets its now-wider row overflow its own box the same
way E3.1.2's ink did, propagating up to `.rte-project-results` identically
— the only change is that what overflows is now the row's real box
(background and all), not just unclipped ink.

Verified in-browser: after the fix, six result rows spanned four distinct
widths (528–762px, matching each row's own source-text length) instead of
all being clamped to the visible ~339px; a click at a coordinate on the
revealed continuation of the widest row (well past where its box used to
end) correctly resolved to, and activated, that exact row's match, with
the point still resolving inside the now-`.active` row afterward
(background genuinely covers it). Desktop is unaffected — rows still
report `width:100%`/`overflow:hidden`/`ellipsis`, and the results list
still has no horizontal overflow to scroll.

**Final interaction contract, restated with painted/interactive geometry
now coherent**: vertical swipe on the results surface → browse rows;
horizontal swipe on the results surface → reveal each visible row's own
continuation, background and hit-area moving with the text; tap anywhere
on a row (including its revealed continuation) → navigates to that exact
match. The deferred E6 compact-mobile-Find/Replace/landscape item (§20)
is unchanged and still not implemented.

**Files changed:** `css/editor.css` (the fix — `.rte-project-result-row`'s
phone-only rule gained `width:max-content`);
`tools/mobile-text-scene-browser.test.mjs` (fixture rows given genuinely
different lengths; assertions extended to check per-row box widths differ
and to perform a real coordinate click on a row's revealed continuation).

## 25. Explicit confirmation (E3.1.3)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E3.2 was not started. Quick Scene and Text Scene itself were not touched;
the Find/Replace panel and its controls were not redesigned; no compact
search mode was implemented; desktop Find/Replace is unchanged. This
stage only corrected `.rte-project-result-row`'s phone-only box sizing so
painted and interactive geometry agree with the shared horizontal scroll
surface introduced in E3.1.2.

## 26. Stage E3.2 — mobile full Scene Editor (`#sceneModal`)

Adapted the existing full Scene Editor into a genuinely usable phone
surface: true fullscreen, and — the actual substance of this stage — a
deliberately different scroll-ownership model from Text Scene's, chosen
because the two surfaces are structurally different (Text Scene is
manuscript-only; the full editor has metadata both above AND below the
manuscript).

### Pre-fix diagnosis (phone, 375×812)

Verified live with a realistic fixture (metadata, one participant, a
100-paragraph manuscript): `#sceneModal` was an ordinary centered desktop
modal even at phone width (335×747, 14px radius, margin around it,
underlying workspace visible) — `#sceneModal .modal` had no fullscreen
treatment at all (unlike Text Scene/Quick Scene). `#sceneModal .modal`
(the base `.modal{overflow:auto}` rule, no ID-specific override) was
already the outer scroll owner for metadata/title/participants/footer —
confirmed via `resetSceneModalScroll()` in js/scenes.js, which already
scrolls exactly this element on every open. Nested inside it,
`#sceneModal .rte-editor{height:320px;overflow-y:auto}` (css/editor.css)
was a SECOND, independently-scrolling box: for the 100-paragraph fixture,
`scrollHeight:25324` vs `clientHeight:319` — a real manuscript needed
~79 "screens" of internal scroll inside a box a phone thumb could barely
distinguish from the surrounding form. This is the nested-scroll trap the
brief anticipated.

### Fullscreen (reused primitive, no new architecture)

`#sceneModal` gained the `mobile-fullscreen-modal` class (index.html) —
the exact same primitive Quick Scene and Text Scene already use
(css/editor.css). Unlike those two surfaces, `#sceneModal .modal` sets no
width/height of its own beyond the generic `.modal` base rule, so the
primitive's existing phone-only `!important` overrides took effect with
**zero additional CSS** for the shell itself. Verified: fullscreen
geometry exact on all four edges, no border-radius, no margin, underlying
workspace unreachable (`elementFromPoint` probe), no page-level horizontal
overflow, in both portrait (375×812) and landscape (667×375, the same
phone-landscape reference size E3.1 used — note a WIDER landscape size
like 844×390 exceeds the 760px breakpoint entirely and is correctly NOT
fullscreen, a viewport-choice detail worth remembering for future tests
of this surface).

### Scroll ownership — the core decision, and why it differs from Text Scene

**Chosen model: `#sceneModal .modal` remains the single primary vertical
scroll surface for the WHOLE form on phone — metadata → title →
manuscript → participants → footer, one continuous swipe gesture — and
the manuscript no longer has its own independently-scrolling nested box.**

This is deliberately NOT Text Scene's model (a flex column with the
manuscript as a `flex:1` region filling remaining space after fixed
toolbar/footer children). That model doesn't fit here: Text Scene has
nothing besides the manuscript, so "give the editor all remaining flex
space" is unambiguous. The full editor has substantial content both
ABOVE (primary metadata, title) and BELOW (participants, which can itself
be long — multiple characters, each with an action field and a relations
editor) the manuscript. A flex-column-with-flex:1-editor model would
still leave participants needing its OWN separate scroll region below the
fixed-remaining-space editor — reintroducing exactly the competing-scroll-
region problem this stage exists to remove, just relocated.

Treating the whole form as ONE linear scroll — the manuscript flowing as
normal content (`height:auto`, `overflow-y:visible`, phone-only) instead
of a second scrolling box — means any touch swipe anywhere in the visible
content (metadata, manuscript text, participants) scrolls the same one
thing, with zero ambiguity about which region a gesture will affect. The
existing `#sceneModal .rte-editor{height:320px;overflow-y:auto}` rule's
own comment explains why a bounded box was originally chosen: an
unbounded editor "made a long scene's Save/Close/other fields scroll
arbitrarily far away." **That concern is already solved by something
added later and unrelated to this stage**: `.sticky-modal-footer`
(css/modals.css, `position:sticky;bottom:-18px`) already pins Save/Cancel
to the bottom of `#sceneModal .modal`'s own scroll viewport regardless of
manuscript length, on every width — confirmed live: it stays visible even
scrolled to the very top of a 26,854px-tall form. The one genuine
trade-off is that reaching participants (below a very long manuscript)
now takes a longer single scroll instead of "exhaust the small nested box,
then continue the outer scroll" — a wash at best, arguably simpler, since
it's one continuous gesture instead of two different ones.

`min-height:40vh` (not the removed `height:320px`) keeps a comfortable
initial writing area for a short/empty scene instead of collapsing to one
or two visible lines.

Verified live: typing at a point genuinely deep in a 100-paragraph
manuscript (paragraph ~60) reaches the live ProseMirror doc correctly,
does not move `window.scrollY` (only the modal's own scroll moves), and
the manuscript's own box has `scrollHeight === clientHeight` (no residual
internal overflow) while `#sceneModal .modal` itself is the one with
`scrollHeight > clientHeight`.

### Legacy 320px height — exact treatment

`#sceneModal .rte-editor{height:320px;overflow-y:auto}` (css/editor.css)
is **completely unchanged for desktop**. A new phone-only
(`@media(max-width:760px)`) rule using the SAME selector, placed later in
the file, overrides it to `height:auto;min-height:40vh;overflow-y:visible`
— normal cascade order (not `!important`) decides the winner, since both
rules share identical specificity, avoiding the ID-vs-class specificity
trap Quick Scene's own fullscreen fix had to work around with `!important`
(css/editor.css's own §17 comment).

### Metadata / toolbar

No new responsive work was needed: `.modal-grid`/`.modal-grid-4`/
`.relation-row` already had phone-appropriate stacking rules from before
this stage (css/modals.css, `@media(max-width:800px)`/`@media(max-width:
480px)`) — verified live that the 4-column metadata row correctly renders
as a single column at 375px width with no control overflowing the
viewport. The rich-text toolbar reuses `.rte-toolbar`'s existing
`flex-wrap` behavior, proven in Quick Scene/Text Scene — verified
reachable (formatting, alignment, undo/redo, scene-break, POV insert,
Find/Replace entry, and the Text Scene switch-surface control) after
scrolling/editing a long manuscript.

### Keyboard / focus

No focus-lifecycle change was made or needed. A normal open (`+ Новая
сцена`, editing an existing scene) keeps its existing default: the title
field (`data-initial-focus`) autofocuses, unchanged — this stage did not
touch or need to touch that. The Text Scene → Scene Editor handoff's
existing `focusTarget==="editor"` mechanism (mousedown-based capture, see
js/editor/scene-editor-controller.js's `captureFocusAtMousedown`) is
unchanged and confirmed still working with a genuine tap. One test-
methodology finding worth recording: this mousedown-based capture does
NOT engage from a synthetic `element.click()` call (which fires only the
`click` event, not `mousedown`) — automated verification of this handoff
must use a real tap/click (Playwright's `page.tap()`/`page.click()`, or a
real OS-level click), not a raw DOM `.click()` call, or the check silently
observes the wrong (non-)behavior. As with Text Scene, real Android
on-screen-keyboard-visible layout remains a real-device-only
confirmation — Playwright cannot drive it.

### Portrait / landscape / desktop

Portrait: verified full metadata → manuscript → participants → footer
flow reachable, long-text editing/save works, no page-level scroll, no
horizontal overflow. Landscape (667×375): fullscreen holds, no clipping,
no horizontal overflow. Desktop: completely unaffected — ordinary
centered/rounded modal, `#sceneModal .rte-editor` keeps its exact
pre-existing `height:320px;overflow-y:auto` nested scroll.

### Deferred (unchanged from earlier stages)

E6 compact mobile Find/Replace / landscape (§20), E4 broader modal work,
Characters/Locations redesign — none touched. Quick Scene and Text Scene
were not modified.

## 27. Explicit confirmation (E3.2)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
Quick Scene, Text Scene, and Find/Replace were not changed. E4/E6 were not
started. Scene Editor's information architecture, metadata semantics/
defaults, and field taxonomy are unchanged — only phone-only fullscreen
geometry and manuscript scroll ownership were adapted; desktop is
byte-for-byte behaviorally identical to before this stage.

## 28. Stage E3.2.1 — real-phone corrections (manuscript scroll hybrid + crypto.randomUUID fallback)

Real Android validation of E3.2 found two independent issues: one UX
regression in the Scene Editor's scroll model, and one functional bug
(`crypto.randomUUID` unavailable) affecting character/location image and
history-event id generation. Both are corrected here; both are unrelated
to each other and touch different files.

### Full Scene Editor — hybrid scroll model (corrects E3.2 §26)

E3.2's conclusion — "nested manuscript scrolling is inherently a
touch-scroll trap, remove it" — was too broad. Real-device use of a
realistically long scene showed the opposite failure mode just as clearly:
with the manuscript flowing unbounded inline in the outer modal scroll,
reaching Characters/participants (below the manuscript) meant scrolling
through the ENTIRE scene text first — for a novel-length scene, many
screens. **Nested scrolling itself was never the defect; an unbounded
nested-in-the-page manuscript is just as much a trap in the other
direction.** The real requirement was always "make the inner scroll region
deliberate and usable," not "eliminate the inner scroll region."

**Corrected model (hybrid)**: the outer `#sceneModal .modal` remains the
scroll owner for metadata/title/participants/footer (unchanged from E3.2).
The manuscript editor (`#sceneModal .rte-editor`) becomes bounded and
independently vertically scrollable again on phone —
`height:45vh;height:45dvh;overflow-y:auto` (phone-only, same selector as
the desktop rule, cascade order decides the winner, no `!important`) —
but sized for phone, not the desktop-derived `320px` constant. `vh`/`dvh`
was chosen deliberately over a fixed pixel value, consistent with this
file's own `92vh`/`100vh`+`100dvh` precedent: it scales sensibly across
phone screen sizes instead of being hardcoded, while still landing at a
similar *absolute* size to the original 320px box on a typical phone
viewport (measured: 365px at 812px viewport height) — generous enough to
be a genuinely useful writing surface, deliberately small enough to leave
participants/other fields visibly close by.

Measured pre-fix (E3.2, unbounded): outer modal `scrollHeight:26854` for
a 100-paragraph fixture — proportional to manuscript length, the actual
defect. Measured post-fix (E3.2.1, hybrid): outer modal `scrollHeight:1785`
(bounded, independent of manuscript length); manuscript editor
`height:365px`, own `scrollHeight:31665`/`clientHeight:363` (genuinely
bounded and independently scrollable). **Core proof**: scrolling the outer
modal to its very end reaches the participants section and the sticky
footer while the manuscript's own `scrollTop` remains exactly `0` — the
user never has to advance the manuscript's internal scroll to reach
content below it. Editing at a point deep in the manuscript (paragraph
~60/100, reached via the manuscript's own internal scroll) still works
correctly and does not move `window.scrollY`. Desktop is completely
unaffected (unchanged `320px`/`overflow-y:auto`).

### Landscape — documented, not solved (deferred to E6)

Real Android landscape review found the interface not yet genuinely
mobile-optimized in that orientation: at ~667px wide the Scene Editor's
metadata starts resembling the desktop two-column form (confirmed here
too: `.modal-grid-4` renders 2 columns, not 1, at 667px — the existing
`@media(max-width:800px)` stacking rule engages at that width, but
`@media(max-width:480px)`'s further single-column collapse does not), and
with the Android on-screen keyboard open, browser chrome + keyboard leave
a very shallow usable viewport — the editor is technically reachable but
the writing area becomes extremely small. This is **now a concrete E6
requirement**, explicitly recorded rather than patched here: **future
mobile/responsive classification cannot rely on viewport WIDTH alone** —
short-height, landscape, and keyboard-constrained viewport behavior need
their own consideration, not an assumption that "phone" only ever means
"narrow and tall." No landscape redesign was attempted in E3.2.1. The one
change this stage DID make (the manuscript's `vh`-relative height) was
checked specifically to confirm it does not make landscape worse: at
667×375 the editor computes to `168.9px` (45% of the shorter landscape
viewport) — smaller in absolute terms than portrait, but still a bounded,
genuinely scrollable region, and strictly better than E3.2's unbounded
model would have been in the same cramped landscape height. No further
landscape-specific change was made.

### `crypto.randomUUID` unavailable on real Android/LAN-HTTP (unrelated bug, same stage)

**Root cause**: `crypto.randomUUID()` is part of the Web Crypto API's
secure-context-gated surface — browsers only expose it on `https`,
`localhost`, and `file://` origins. The phone reached this dev server over
plain LAN HTTP (`http://172.22.x.x:8000`, not `localhost`), which is NOT a
secure context, so `crypto.randomUUID` was simply `undefined` there,
throwing "crypto.randomUUID is not a function" the moment character image
upload (`js/characters.js`'s `readOriginalImage`, the `isCloudWorkspace()`
branch) ran. Desktop testing never caught this because
`http://localhost:8000` IS special-cased as a secure context by every
major browser even without TLS — the exact same code, unmodified, behaves
differently purely because of the origin.

**Other call sites found with the same fragile pattern** (grepped for
every `crypto.randomUUID()` call in `js/`): `js/locations.js`'s location
media upload (`createDraftMediaItem`) and location history event creation
(`addLocationHistoryEventDraft`) — both would fail identically on the same
real-device condition; and `js/local-to-cloud-migration-ui.js`'s migration
attempt id. All four were routed through one new centralized helper rather
than four separate ad-hoc fixes.

**Fix**: new `js/id-generator.js`, exporting `generateUuid()`:
1. Uses `crypto.randomUUID()` when available (unchanged native behavior).
2. Otherwise, if `crypto.getRandomValues()` is available — the OLDER,
   broader-support half of the Web Crypto API, NOT secure-context-gated,
   and present on the exact same insecure origin where `randomUUID` is
   missing — builds a proper RFC 4122 version-4 UUID by hand from 16
   cryptographically random bytes (the standard, well-known technique).
3. Only if `crypto`/`getRandomValues` is entirely absent (no known case in
   this app's supported browsers, a defensive last resort only) falls back
   further to a `Math.random()`-seeded but still properly v4-SHAPED
   (versioned/varianted) UUID string — never a bare timestamp or raw
   random number, since these ids become actual storage path segments /
   database keys (see `js/locations.js`'s own existing comment on
   `createDraftMediaItem`), so collision-resistance matters even in this
   last-resort tier.

All four existing call sites now call `generateUuid()` instead of
`crypto.randomUUID()` directly; no other behavior changed.

**Tests**: `tools/id-generator.test.mjs` (new, added to the `npm run
test:unit` chain) — pure unit test proving `generateUuid()` delegates to
the native function when present, produces a correctly-shaped, collision-
free (500 calls, no duplicates) v4 UUID via the `getRandomValues` fallback
when `randomUUID` is explicitly stubbed absent, and still produces a valid
v4-shaped id in the defensive last-resort tier with `crypto` itself
removed entirely. `tools/character-image-uuid-fallback-browser.test.mjs`
(new) drives the REAL reported user flow end-to-end: opens a character's
profile editor, stubs `crypto.randomUUID` absent (shadowing the inherited
`Crypto.prototype` method with an own `undefined` property, since a plain
`delete` silently no-ops on an inherited property), stubs
`cloudProjectSync.projectId` to reach the affected `isCloudWorkspace()`
branch without needing real Supabase credentials (that branch is pure
client-side — object URL + id generation only; the actual upload RPC
happens later, at Save, which this test does not reach), and drives a real
file selection through `#profilePhotosInput`'s actual `onchange` handler.
Confirmed via reverting only `js/characters.js` that this test correctly
times out/fails against the original bug (the photo is never added, since
the unhandled exception is caught and surfaces only as an `alert()`).
With the fix: no error dialog, the photo is added, and its id matches a
proper v4 UUID shape. A second scenario in the same file confirms the
native `crypto.randomUUID()` path is unaffected when actually available.

## 29. Explicit confirmation (E3.2.1)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E4 and E6 were not started — the landscape finding is recorded as a
requirement for E6, not implemented. Quick Scene and Text Scene were not
modified (their own regressions re-run and confirmed green). Characters
and location media/history architecture were not redesigned — only the
id-generation call itself was made robust, routed through one new small
helper, with normal native behavior fully preserved when available.

## 30. Stage E3.2.2 — real-phone writing microfix (manuscript height + splitter touch drag)

Real Android phone testing of E3.2.1 (over LAN HTTP) accepted the hybrid
scroll model, participants reachability, sticky footer, and the
`crypto.randomUUID` fallback. Two smaller issues remained.

### Full Scene Editor manuscript height: 45vh/45dvh → 50vh/50dvh

Real-device feedback: the bounded manuscript felt slightly too short.
Bumped `#sceneModal .rte-editor`'s phone-only height from `45vh`/`45dvh`
to `50vh`/`50dvh` (css/editor.css) — same mechanism, same tradeoffs
described in §28, just a larger fraction of the viewport. Measured at the
existing 375×812 portrait test viewport: rendered editor height is
**406px** (exactly 50% of 812px), `overflow-y:auto` unchanged. All E3.2.1
guarantees reverified unchanged at the new height: independent manuscript
scroll, outer-modal scroll for metadata/title/participants/footer,
participants reachable without traversing manuscript text, sticky footer,
portrait fullscreen geometry, desktop's unmodified 320px behavior.

### Project/global Find/Replace results-resizer: touch drag did not work

**Symptom**: the draggable splitter between the project-search result list
and the manuscript visibly reacted to a press on a real Android
touchscreen, but dragging the finger did not resize it.

**Pre-fix event model**: already Pointer Events end-to-end
(`pointerdown`/`pointermove`/`pointerup`/`pointercancel` with
`resizer.setPointerCapture(event.pointerId)`,
js/editor/find-replace-panel.js) — NOT a mouse-only or touch-only
implementation, and not something needing unification; the interaction
model was already the single coherent one this stage would otherwise have
had to introduce.

**Actual root cause**: `.rte-project-results-resizer` had no `touch-action`
declared (default `auto`), so the browser was free to interpret the
vertical drag as a native scroll/pan gesture on the handle instead of
delivering it as continuous `pointermove` events to the JS handler.
`event.preventDefault()` inside the existing `pointerdown` listener is
*not* a reliable substitute for this — `touch-action` is resolved by the
browser's compositor before the touch's scroll-vs-gesture role is
committed, independent of JS handler timing. This is the exact same class
of problem this codebase already has one precedent for:
`.photo-crop-viewport` (css/profiles.css) sets `touch-action:none` for the
identical reason on its own custom drag surface.

**Fix**: `touch-action:none` added to `.rte-project-results-resizer` only
(css/editor.css) — scoped to the narrow handle itself, not the results
list, not the page. No JS changes were needed: `setPointerCapture` and the
`pointermove`-based resize math were already correct and needed no pointer
capture/pointercancel handling added, since both were already present.
Keyboard operability (`ArrowUp`/`ArrowDown` on the resizer, already
present) is untouched.

**Verification fidelity, and why**: a plain
`element.dispatchEvent(new TouchEvent(...))` only fires JS listeners and
does not exercise the browser's real touch/gesture/scroll pipeline that
`touch-action` governs — it would pass identically with or without the
fix, proving nothing about the actual defect. Instead, this stage used
Chromium DevTools Protocol's `Input.dispatchTouchEvent` (via
`page.context().newCDPSession(page)`) to drive a genuine synthetic touch
sequence through the browser's real touch input pipeline — the same one a
physical touchscreen feeds, and the closest this sandboxed environment can
get to a real device without one. Confirmed this CDP-driven drag produces
the correct ~100px resize with the fix present, and — reverting only the
CSS fix — the identical sequence produces just 140→160px (a 20px change,
mostly scroll-intercepted) instead of the expected ~240px, precisely
reproducing the reported "responds to press but doesn't drag" symptom.
Final acceptance nonetheless remains a real Android device, as it has for
every other Stage E geometry/interaction fix in this doc.

**Confirmed unaffected**: min/max clamping (`MIN_RESULTS_HEIGHT=90`,
`MAX_RESULTS_HEIGHT=420`) still applies to a touch-driven drag; the shared
horizontal project-results scroll model from §22/§24 (E3.1.2/E3.1.3) is
completely unaffected after a resize (`.rte-project-result-row` still
`overflow-x:visible`, `.rte-project-results` still the shared horizontal
scroll owner); vertical result-list browsing still works after a resize;
desktop mouse dragging is unaffected (`touch-action` governs touch/pen
input only, never mouse) — confirmed with a real `page.mouse` down/move/up
sequence at desktop viewport, resizing by the expected ~80px.

**Files changed**: `css/editor.css` (both fixes — manuscript height bump,
resizer `touch-action:none`); `tools/mobile-text-scene-browser.test.mjs`
(new splitter assertions, added to the existing project-search test block
rather than new test infrastructure, per this stage's own scope
guidance).

## 31. Explicit confirmation (E3.2.2)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E4 and E6 were not started. Landscape and tablet behavior were not
redesigned. Find/Replace search/replace semantics are unchanged — only the
existing resizer's touch responsiveness and the manuscript's phone height
were adjusted. Quick Scene was not touched; Text Scene's own unrelated
behavior was not changed (only the shared results-resizer it hosts).

## 32. Stage E3.2.3 — mobile Find/Replace splitter geometry correction (shared vertical space)

E3.2.2 fixed the splitter's touch-drag responsiveness, but real-phone
testing exposed a deeper geometry bug underneath: growing the results pane
did not correspondingly shrink the manuscript.

### Which surface is actually affected (inspected, not assumed)

The report described "the mobile Text Scene / project-global Find/Replace
surface," but **the two surfaces that host this same results+resizer
component behave completely differently**, and only one of them was
broken:

- **Text Scene (`#textModal`)**: already correct, unconditionally. Its
  modal is `display:flex;flex-direction:column` (E3.1's own model), and
  the manuscript editor already has `flex:1 1 auto;min-height:0` from the
  shared base `.rte-editor` rule — dragging the splitter there already
  redistributes space correctly, confirmed live: results 140→240px,
  manuscript 244.09→144.09px, combined stayed exactly 384.09px before and
  after. **This stage made zero changes to Text Scene's behavior.**
- **Full Scene Editor (`#sceneModal`)**: genuinely broken. `#sceneModal
  .modal` is NOT a flex column (E3.2.1's own linear-scroll model, by
  design, for metadata/title/participants/footer reachability) — the
  manuscript had a plain, independent `height:50vh;50dvh` (E3.2.2) with no
  relationship whatsoever to the results pane's own JS-managed height.
  Confirmed live: dragging the splitter +100px grew results 240→340px
  while the manuscript stayed at EXACTLY 406px, unchanged — the two
  regions' combined content simply grew taller, which the outer modal's
  own scroll (E3.2.1) absorbed, reading as "the modal gets pushed."

**Only `#sceneModal` needed a fix.** Text Scene's own resizer/test
(E3.2.2, §30) is unaffected and still passes unchanged.

### The shared-space layout model

`.scene-section:has(#sceneTextEditor)` (the `<section>` that already
contains the title, rich-text toolbar, Find/Replace row, and manuscript —
no new wrapper element needed) becomes its own small bounded flex column
on phone: `display:flex;flex-direction:column;height:50vh;height:50dvh;
overflow:hidden`. This is **the exact same mechanism Text Scene already
uses**, just scoped to a sub-region instead of the whole modal — the
outer `#sceneModal .modal` keeps its own separate, unrelated linear scroll
for metadata/title/participants/footer, E3.2.1's decision, completely
unchanged. `#sceneModal .rte-editor` changes from a fixed `50vh`/`50dvh`
to `flex:1 1 auto;min-height:20px;overflow-y:auto` (phone-only) — the
manuscript now absorbs/gives back space exactly as the results pane's own
explicit height changes, bounded by the section's fixed total.

### Why the editor's floor is only 20px (measured, not guessed)

Live measurement on a 390px-wide phone column: the rich-text toolbar
wraps to ~3 rows (115px) and the Find/Replace row (scope toggle, find/
replace inputs, prev/next, case toggle, close) wraps to several rows of
its own (114px); together with the title (24px), fixed overhead alone is
~253px — **more than half** of the 422px (50dvh) budget — before the
results pane or manuscript get anything. With results at its own
`MIN_RESULTS_HEIGHT` (90px), the manuscript's true natural leftover space
measured only ~21-29px. A taller floor would force the flex layout to
need more than the section's fixed height, with no safe place for the
overflow to go (`overflow:hidden` would clip the editor's own bottom edge;
`overflow:visible` would let it bleed into Participants below) — so the
floor is deliberately kept at/under that measured true minimum (`20px`)
instead of inventing more room that doesn't exist. This is this stage's
own concrete instance of "must fail gracefully at short height": opening
project-wide Find/Replace while editing is a deliberate, occasional
action (Find/Replace closed or scene-only scope still gives the editor
nearly the whole 50dvh, completely unchanged), and in that one deliberate
state the manuscript genuinely has very little room to spare — this floor
keeps it a real, still-interactive sliver rather than 0/clipped/
overflowing. `#sceneModal .rte-editor`'s results pane was also changed to
start at `MIN_RESULTS_HEIGHT` (not the taller shared `DEFAULT_RESULTS_
HEIGHT`) the moment project scope activates, specifically for this one
surface — starting at the taller default would leave the manuscript
already crushed to its floor before the user ever touches the resizer.

### The dynamic max-height clamp (why not a fixed arithmetic guess)

`js/editor/find-replace-panel.js`'s `effectiveMaxResultsHeight` computes,
live on every resize call, "however much slack the manuscript currently
has above its own floor is exactly how much more the results pane may
take" — deliberately NOT a fixed guess at "how much is reserved for
title/toolbar/find-row" (fragile, and would drift the moment that
content's own height changes for any reason). `createFindReplacePanel`
now accepts an optional `manuscriptElement` — passed ONLY by the full
Scene Editor's own `mountSceneEditor` call (`surfaceId==="sceneModal"`),
never by Text Scene's or "Весь текст"'s, so this entire mechanism is a
complete no-op for both of them, at every width, exactly preserving their
existing behavior. The clamp itself is gated on the manuscript's *parent*
currently being the phone-only flex column (`getComputedStyle(...).
display==="flex"`), not a duplicated width-breakpoint number in JS — on
desktop, `#sceneModal .rte-editor` still participates in the same shared
base `.rte-editor{flex:1 1 auto}` rule, but its parent stays an ordinary
block there (this bounded-flex model is phone-only), so the clamp
correctly falls through to the unchanged flat `MAX_RESULTS_HEIGHT`
constant, preserving desktop exactly as before. One real bug found and
fixed during this stage's own verification: the very first `setResults
Height(...)` call happens synchronously while the modal is still
`display:none` (before `showModal()`), so every geometry read at that
instant reports 0 — without an explicit guard, this computed a bogus
negative "slack" and wrongly floored the very first open at
`MIN_RESULTS_HEIGHT`; fixed by falling back to the flat constant whenever
the manuscript isn't actually laid out yet.

### Verified

Live, with a genuine CDP touch drag (Chromium's real touch input
pipeline, per the E3.2.2 test lesson): dragging down grows results and
shrinks the manuscript in the *opposite* direction (confirmed both ways:
grow then shrink back); the section's own rendered height stays exactly
50dvh throughout every state tested (no overflow, no clipping); the
manuscript never drops below its `min-height` floor even under an
extreme drag; results never drops below its existing `MIN_RESULTS_HEIGHT`
(90) floor; metadata controls above this region do not move as a result
of resizing it; the drag itself does not scroll the outer modal; the
manuscript remains editable and results remain independently vertically
scrollable after a resize; the shared horizontal project-results scroll
model (§22/§24, E3.1.2/E3.1.3) is completely unaffected. Short landscape
(667×375): the bounded region still holds its own 50dvh height with
project results open, no page-level horizontal overflow. Desktop:
untouched (`#sceneModal .rte-editor` keeps its exact 320px/`overflow-y:
auto` box; the dynamic clamp never engages there).

**Files changed:** `css/editor.css` (the bounded flex region + editor
floor); `js/editor/find-replace-panel.js` (dynamic max clamp + smaller
initial default for the bounded surface); `js/editor/scene-editor-
controller.js` (threads `manuscriptElement` through only for
`surfaceId==="sceneModal"`); `tools/mobile-scene-editor-browser.test.mjs`
(new shared-space geometry regression — added here, not to `tools/
mobile-text-scene-browser.test.mjs` as originally suggested, once
inspection proved the defect is specific to the Scene Editor surface that
file already covers; confirmed to fail against the pre-fix E3.2.2 state
for the exact reported symptom — results grew while the manuscript stayed
at an unchanged, unrelated height — both via an early fixture-sanity
check and, with that check disabled, via the deeper "manuscript must
shrink" assertion independently).

## 33. Explicit confirmation (E3.2.3)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E4 and E6 were not started; landscape and tablet were not redesigned
beyond the graceful-degradation check above. Find/Replace semantics
(search/replace logic) are completely unchanged — only shared vertical
layout geometry. Quick Scene was not touched. Text Scene's own behavior
was not changed — inspection proved it was never broken, so nothing there
needed fixing.

## 34. Stage E3.2.4 — E3.2.3 REJECTED; independent manuscript height restored

Real-phone testing of E3.2.3 rejected its entire premise. Observed: with
Find/Replace closed, the manuscript had its useful ~50dvh height as
expected — but simply *opening* Find/Replace (even current-scene mode,
with no results pane visible at all) already collapsed the manuscript to
a few lines, and project mode could make it disappear almost entirely.
This is unacceptable, and traces directly to §32's own design: E3.2.3
made the manuscript and the results pane trade space within one bounded
50dvh region, so *any* Find/Replace UI taking up room — not just a grown
results pane — ate directly into the manuscript's share.

**Corrected product requirement, restated:** the project-results splitter
was never supposed to redistribute height between results and the
manuscript. Its only job is resizing the results pane. The manuscript
keeps its own independently-bounded ~50dvh phone height regardless of
whether Find/Replace is open, current-scene, or project-scope.

### What was reverted

`.scene-section:has(#sceneTextEditor){display:flex;flex-direction:column;
height:50vh;height:50dvh;overflow:hidden}` (§32's bounded flex
sub-region) — removed entirely. `#sceneModal .rte-editor` reverts from
`flex:1 1 auto;min-height:20px;overflow-y:auto` back to its exact E3.2.2
form: `height:50vh;height:50dvh;overflow-y:auto` (a plain, independent
height, not flex-based, not sharing anything). `js/editor/find-replace-
panel.js`'s `effectiveMaxResultsHeight` (the dynamic geometry-aware
clamp) and the `manuscriptElement`-based "start results at MIN instead of
DEFAULT for Scene Editor" logic — both removed; `clampResultsHeight` is
back to the plain `Math.min(MAX_RESULTS_HEIGHT,Math.max(
MIN_RESULTS_HEIGHT,height))` used everywhere. `js/editor/scene-editor-
controller.js`'s conditional `manuscriptElement:editorContainer` argument
to `createFindReplacePanel` — removed; the call is back to
`createFindReplacePanel(findReplaceContainer,findReplace)`, exactly as
before E3.2.3, for every surface. All three files were reverted to their
exact E3.2.2 (`7defb47`) content via `git checkout 7defb47 -- <file>`,
confirmed identical (zero remaining `manuscriptElement` references
anywhere), then a historical-record comment was added explaining what was
tried and why it was rejected, so the same idea isn't attempted again.

**Explicitly preserved, unchanged:** phone fullscreen Scene Editor;
`#sceneModal` manuscript's own `~50dvh` independent height;
`overflow-y:auto`; the outer `#sceneModal .modal` scroll model (E3.2.1);
sticky footer; E3.2.2's `touch-action:none` splitter fix (still present,
untouched by this revert — confirmed the resizer's own CSS rule is
identical to the pre-E3.2.3 state plus the new fix, not the E3.2.2
state alone); Pointer Events/pointer capture/`pointercancel` (unchanged,
was never part of E3.2.3's change); `MIN_RESULTS_HEIGHT`(90)/
`MAX_RESULTS_HEIGHT`(420) (back to their original flat, unconditional
values everywhere); the shared horizontal project-results scroll model
(E3.1.2/E3.1.3, untouched by any of E3.2.2/E3.2.3/E3.2.4); Text Scene;
Quick Scene; the `crypto.randomUUID` fallback (E3.2.1); desktop's
`320px`/`overflow-y:auto` manuscript.

### Verified geometry (375×812 portrait)

Measured live, fresh scene, fresh mount:
- **Find/Replace closed**: manuscript `406px` (exactly 50% of 812px).
- **Find/Replace open, current-scene mode** (no results pane at all):
  manuscript still `406px` — unchanged.
- **Switched to project mode** (results pane now exists at its default
  `140px`): manuscript still `406px` — unchanged. The outer
  `#sceneModal .modal`'s own `scrollHeight` grew from `1903` to
  account for the newly-visible Find/Replace UI, as expected — the outer
  form got taller, exactly the accepted "these elements may make the
  outer form taller, that's fine" contract.
- **Touch-dragging the splitter +100px**: results grew `140→240px`
  (matches the drag distance); manuscript stayed at **exactly `406px`,
  unchanged**; the outer modal's own `scrollHeight` grew a further
  `1903→2003px` (+100, absorbing the results growth) — confirming growth
  is redirected to the outer scroll, never taken from the manuscript.
- **Outer scroll to the very end**: participants became visible in the
  viewport while the manuscript's own `scrollTop` stayed exactly `0` —
  participants are reached without ever traversing the manuscript.
- **Desktop**: `#sceneModal .rte-editor` computed exactly `320px`/
  `overflow-y:auto`, fully unaffected.

**Baseline-failure proof**: temporarily restoring E3.2.3's rejected code
(`css/editor.css`/`find-replace-panel.js`/`scene-editor-controller.js`
from `b14c44d`) and re-running the new regression fails immediately —
even with Find/Replace closed, the manuscript's own rendered height
(`261px`) falls below the required useful-height threshold, reproducing
the exact real-device collapse. Restoring the E3.2.4 fix passes cleanly.

### Automated vs. real-device scope

This is geometry proof, not final UX acceptance — as with every other
Stage E geometry fix, real-phone review remains the actual acceptance
gate. Landscape (667×375) was re-verified for basic sanity only (opening
project Find/Replace there does not materially change the manuscript's
own height either) — no landscape redesign was attempted, matching this
stage's explicit scope guard.

**Files changed:** `css/editor.css` (revert + historical-record
comments), `js/editor/find-replace-panel.js` (revert),
`js/editor/scene-editor-controller.js` (revert),
`tools/mobile-scene-editor-browser.test.mjs` (E3.2.3's shared-space
assertions replaced with the corrected independent-height contract;
confirmed the new assertions fail against `b14c44d` and pass with the
fix).

## 35. Explicit confirmation (E3.2.4)

No Supabase changes, no migrations, `reference/` and `backup/`
untouched. E4, E6, and tablet work were not started. No landscape
redesign was attempted (sanity-checked only). Find/Replace semantics,
search/replace logic, and project-results horizontal scrolling
(E3.1.2/E3.1.3) are unchanged. Quick Scene was not touched. Text Scene
was not touched (it was never affected by E3.2.3 in the first place).

## 36. Stage E3.2.5 — results-splitter resizer born occluded under the sticky footer

E3.2.4's independent-manuscript model was partially accepted on real-
phone testing: manuscript height/scroll behavior, the results-only
splitter, and the `crypto.randomUUID` fallback were all confirmed good
and preserved unchanged by this stage. One remaining defect was
reported: enlarging the project-results pane with the splitter appeared
to push the upper Find/Replace area upward/out of the viewport.

### Diagnosis (measured, not guessed)

Synthetic `PointerEvent` dispatch (used to sanity-check the resizer
element directly) reproduced *nothing* — zero scroll/anchor movement —
confirming again (as in E3.2.2/E3.2.3) that it does not exercise the
same native touch/scroll/gesture pipeline as a real touch. Switching to
genuine CDP `Input.dispatchTouchEvent` drags (a fresh Playwright/CDP
session, not the shared browser pane) did reproduce scroll changes, but
`document.elementFromPoint()` hit-testing at the exact computed resizer
coordinates revealed the touch was landing on
`.modal-actions.sticky-modal-footer`, not the resizer, at the scroll
position the Scene Editor lands on immediately after opening
Find/Replace and switching to project scope — **before the user ever
touches the resizer, with no resize attempted yet**. Direct rect
comparison confirmed physical overlap: resizer `top:738/bottom:746` vs.
footer `top:737/bottom:812` (`position:sticky;z-index:5`, pre-existing
`css/modals.css` rule, unrelated to any Stage E CSS). `#textModal`
(Text Scene) overrides this footer to `position:static` (see
`editor.css`'s own comment on `#textModal .modal-actions.sticky-modal-
footer`), so it was never exposed to this defect; `#sceneModal` and
`#allScenesModal` both still use the single-big-scroll pattern with the
genuinely sticky footer, so both were exposed to it.

A second, cleaner reproduction — first manually scrolling the resizer
clear of the footer, confirmed via `elementFromPoint` — showed a
touch that genuinely lands on and drives the resizer (12 pointer events
fired, results correctly grew `140→240px` matching the drag) produces
**zero** change in the outer modal's `scrollTop` or in a stable anchor's
viewport position. This directly contradicts the originally-hypothesized
mechanism ("a successful resize itself causes scroll-anchor drift, needs
compensation") and instead confirms: the resizer starting life hidden
under the sticky footer, causing the touch to miss it entirely and fall
through to an ordinary native scroll of the outer modal, **is** the
mechanism — not anything to compensate for during a genuinely successful
drag.

### Fix

`js/editor/find-replace-panel.js`'s `revealResizerPastStickyFooter()`:
called once, from `renderProjectResults`, exactly on the
`resultsWrapper.hidden` **true→false** transition (i.e. the first time
project-scope results appear for this open/scope-switch), and only
under the phone shell breakpoint (`matchMedia("(max-width:760px)")`) —
desktop gains no new scroll behavior at all, per the explicit no-desktop-
jumps requirement. It calls `resizer.scrollIntoView({block:"nearest"})`
on the next animation frame. `css/editor.css` adds
`.rte-project-results-resizer{scroll-margin-bottom:84px}` (phone-only,
rounded up from the measured ~75px footer height) so the browser's own
native `scrollIntoView` algorithm treats the footer's reserved strip as
"not sufficiently visible," rather than requiring any manual pixel-
compensation logic here.

Deliberately **not** also re-run after a completed resize: growing the
results pane can itself push the resizer below the fold (confirmed: a
single +100px grow was enough), but re-revealing it there would require
scrolling the outer modal further, which would disturb the very anchor-
stability contract this fix exists to guarantee. A resizer that ends up
off-screen after a resize is not something this stage needed to solve —
like any other control that scrolls out of view, the user scrolls a
little to reach it again.

### Verified geometry (measured live, genuine CDP touch drag)

Before fix (unmodified `9c5ef64`, out-of-the-box: open scene, open
Find/Replace, switch to project, type a query, no manual scroll):
resizer `top:738/bottom:746` fully inside the footer's `737–812` strip;
`elementFromPoint` at the resizer's own center resolves to the footer,
not the resizer. A genuine CDP touch drag of `+100` there: 0 pointer
events reached the resizer, results height unchanged (`140→140`), but
the outer modal's `scrollTop` still moved substantially (`475→385`,
Δ90) and the anchor (`#sceneTextFindReplace`'s own viewport top) shifted
by the same ~90px — a real, severe break: the drag fails silently and
the view reflows unexpectedly, which is what real-phone testing
described as the Find/Replace area shifting.

After fix: at the same starting point, the reveal nudges the outer
modal's `scrollTop` from `475→493` (an 18px settle, run once, before the
user's first touch), leaving the resizer clear of the footer
(`elementFromPoint` now resolves to the resizer itself). A genuine CDP
`+100` touch drag from there: `modalScrollTop` unchanged (`493→493`),
anchor viewport top unchanged (Δ0), results height `140→240` (matches
the drag exactly), manuscript height unchanged (`406→406`px), manuscript
top moved down by exactly the results growth (Δ100, matching Δresults).
A `-60` reverse drag (after `scrollIntoViewIfNeeded()` re-locates the
now-lower resizer, itself a settle step, not part of the drag) proved
the exact inverse: results `240→180`, anchor Δ0, manuscript height
unchanged, manuscript top moved back up by the shrink amount. `+2000`/
`-2000` extreme drags still clamp to `MAX_RESULTS_HEIGHT`(420)/
`MIN_RESULTS_HEIGHT`(90) with the anchor still stable at each extreme.
`window.scrollY` stayed exactly `0` throughout every drag in both
directions — the outer `#sceneModal .modal` remained the sole scroll
owner, never the page itself.

**Baseline-failure proof**: `tools/mobile-scene-editor-browser.test.mjs`
now asserts (a) the resizer is genuinely hit-testable
(`elementFromPoint` resolves to it, not the footer) as soon as it first
appears, and (b) the anchor's viewport position stays stable (±4px)
across a grow drag, a shrink drag, and both extreme clamped drags —
plus that content below the results pane (the manuscript's own top)
moves down/up roughly matching the results' growth/shrinkage. Confirmed
by temporarily stashing only the `css/editor.css`/`find-replace-
panel.js` fix (keeping the extended test) and re-running: it fails at
the `elementFromPoint` assertion, for the real measured reason above —
not a fabricated one. Restoring the fix passes cleanly. Note: at this
test's normal `390×844` phone viewport, this specific fixture's own
content happens to leave a ~7px gap that narrowly avoids the defect (the
exact overlap is inherently viewport/content-height sensitive, which is
also why the fix targets "never born occluded" generically rather than
one fixed geometry) — the Find/Replace sub-test temporarily uses
`390×812` instead (still comfortably phone-width, confirmed by direct
measurement to reproduce the overlap with this exact fixture), restored
to `390×844` immediately after that sub-test closes.

### Text Scene / desktop / landscape

Text Scene's own splitter regression
(`tools/mobile-text-scene-browser.test.mjs`) passes unchanged — its
footer is `position:static` (not sticky), so it was never exposed to
this defect, and nothing in this stage's fix touches `#textModal`-
specific code (the fix lives in the shared `find-replace-panel.js`
function used by all three surfaces, gated purely by whether the
resizer is actually hidden-under-the-footer at reveal time — a no-op
where it already isn't). Desktop: `#sceneModal .rte-editor` remains
exactly `320px`/`overflow-y:auto`; `revealResizerPastStickyFooter()`'s
`matchMedia` guard means it never runs at desktop widths at all, so no
new scroll behavior was introduced there. Landscape (667×375): sanity-
checked only via the existing landscape assertions in `tools/mobile-
scene-editor-browser.test.mjs`, unchanged from E3.2.4 — no landscape
redesign attempted.

**Files changed:** `js/editor/find-replace-panel.js`
(`revealResizerPastStickyFooter()` + the `wasHidden` reveal-trigger in
`renderProjectResults`), `css/editor.css` (phone-only `scroll-margin-
bottom` on the resizer), `tools/mobile-scene-editor-browser.test.mjs`
(anchor-stability + resizer-reachability assertions for grow/shrink/
min/max, baseline-failure-proof confirmed).

## 37. Explicit confirmation (E3.2.5)

No Supabase changes, no migrations, `reference/` and `backup/`
untouched. E4, E6, and tablet work were not started. No landscape
redesign was attempted (sanity-checked only, unchanged from E3.2.4).
Find/Replace search/replace semantics, the toolbar, and project-results
horizontal scrolling (E3.1.2/E3.1.3) are unchanged. Quick Scene was not
touched (it has no Find/Replace panel at all). Text Scene's own code was
not touched — inspection proved its footer is not sticky, so it was
never exposed to this defect. The manuscript's independent ~50dvh phone
height and desktop's 320px height (E3.2.4's accepted model) are
unchanged; this stage did not touch manuscript geometry at all, per its
explicit guard.

## 38. Stage E3.2.6 — restore desktop splitter semantics on mobile

Real-phone validation REJECTED E3.2.5. Even with the sticky-footer
occlusion fixed, the underlying model — the outer `#sceneModal .modal`
absorbing results growth while the manuscript stayed at an independent
fixed ~50dvh — was itself the problem: it meant the outer modal's own
scrollable length (and therefore where focusing the find input naturally
scrolled to) changed unpredictably every time Find/Replace opened or the
splitter moved, which read on a real phone as content shifting/expanding/
collapsing for no clear reason. The user clarified the intended contract
by reference to DESKTOP's own already-working behavior: results,
splitter, and manuscript share ONE bounded region; dragging the splitter
exchanges height between results and manuscript in opposite directions;
the region's own total stays stable; the outer modal never moves.

### A. Desktop splitter model, as actually measured (not assumed)

Two candidate desktop surfaces exist. Direct measurement (real mouse
drag, `#sceneModal` vs `#textModal`, both centered 1280×800 modals) found
they behave DIFFERENTLY:

- **`#sceneModal` (Full Scene Editor) desktop**: `.rte-editor{height:
  320px}` is a flat, non-flex height; `#sceneModal .modal{overflow:auto}`
  is NOT a flex container. Dragging the splitter +100px: `editorHeight`
  stayed exactly `320→320`; `resultsHeight` grew `140→240`; the outer
  `.modal`'s own `scrollHeight` grew `1356→1456` to absorb it. Desktop
  Scene Editor does NOT exchange height with the manuscript at all — it
  behaves exactly like E3.2.4/E3.2.5's mobile model (outer scroll
  absorbs growth). This is NOT the "already-working" behavior the user
  was describing.
- **`#textModal` (Text Scene) desktop**: `.modal{display:flex;
  flex-direction:column;height:92vh;overflow:hidden}` (a FIXED-height
  flex column) + `.rte-editor{flex:1 1 auto;min-height:0;overflow-y:
  auto}` (the SAME generic rule, but now inside an actual flex parent).
  Dragging the splitter +100px: `editorHeight` shrank exactly
  `320.09→220.09` (−100, matching the drag); `resultsHeight` grew
  `140→240`; the modal's own height never changed (`736px` before and
  after). This IS the desktop mechanism the user meant — pure CSS
  flexbox, zero JS coupling between the resizer and the editor: the
  resizer's existing JS only ever sets `resultsRoot.style.height`; the
  editor's shrink/grow is a flexbox side effect of a fixed-size column
  redistributing space among its children.

### B. Mobile DOM relationship (before this stage)

`#sceneModal`'s "Текст сцены" section (index.html): `<h3>`, `#sceneText
Toolbar`, `#sceneTextFindReplace` (the compact Find/Replace control row),
then `#sceneTextEditor.rte-editor` — all plain siblings inside one
`<section class="scene-section">`, itself a plain (non-flex) block.
`find-replace-panel.js` inserted the project-results wrapper (`.rte-
project-results-wrapper`, containing the results list + resizer) as
`#sceneTextFindReplace`'s own next DOM sibling — i.e. also a plain
sibling of the toolbar/find-replace row AND of the editor, all four
elements flat in the same non-flex parent. `.sticky-modal-footer`
(css/modals.css) sits at the very end of `#sceneModal .modal`, pinned via
`position:sticky` over roughly the last 75px of the modal's own scroll
viewport.

### C. Why desktop `#textModal` can exchange height with zero outer movement

Because its flex column has a FIXED total height (`92vh`, `overflow:
hidden` — the column itself never grows or scrolls) and the editor is
the ONLY child with `flex-grow:1` and `min-height:0` (opting out of the
browser's default "never shrink below my own content size" flex
protection) — every OTHER sibling (toolbar `flex:none`, the results
wrapper `flex:none`) keeps its own natural/explicit size, so ANY space
those siblings claim is taken directly and ENTIRELY from the editor's
own share, automatically, via the flex algorithm alone. Nothing about the
outer modal (its own fixed 92vh box) is aware this redistribution is even
happening.

### D. Why E3.2.3's attempt at the same idea on mobile was rejected, and the corrected boundary

E3.2.3 (see §32 for the full historical record) tried to reproduce this
same mechanism on `#sceneModal` phone, but bounded the WRONG scope:
`.scene-section:has(#sceneTextEditor){display:flex;height:50dvh}`,
i.e. toolbar + Find/Replace controls + results + editor ALL sharing one
50dvh budget. On a real phone, subtracting the toolbar's and Find/
Replace row's own chrome left only ~20-30px for the manuscript —
rejected. Measured directly THIS stage: even `#textModal`'s own EXISTING
(never-reported-broken, currently accepted) desktop-proven mechanism has
this same latent risk on mobile if dragged to `MAX_RESULTS_HEIGHT` — its
own toolbar+Find/Replace DO live inside the SAME shared flex column,
and at 375×812 its editor measured **26px** at max results height (worse
than E3.2.3's reported 20-30px). This is flagged separately as an
out-of-scope finding (`#textModal` is intentionally NOT touched by this
stage — no task instruction named it as an implementation target, only
Text Scene's EXISTING regression, which this stage must not break).

The corrected boundary (this stage): reproduce the SAME desktop
mechanism, but scope the bounded flex column to ONLY [project-results
pane, splitter, manuscript] — never the toolbar or Find/Replace controls,
which stay completely outside it and never compete for its budget at
all. Smallest structural change to achieve this: a new wrapper element,
`.rte-manuscript-region` (index.html, wraps ONLY `#sceneTextEditor`),
with `find-replace-panel.js` inserting the results wrapper as ITS first
child (ahead of the manuscript) instead of as `#sceneTextFindReplace`'s
sibling, via a new optional `manuscriptRegion` parameter to
`createFindReplacePanel` (`js/editor/scene-editor-controller.js`'s
`mountSceneEditor` derives it from `editorContainer.parentElement`,
`null` everywhere else — `#textModal`/"Весь текст" keep their exact
pre-existing insertion behavior, completely untouched).

### E. E3.2.5 auto-scroll workaround: removed, and why

`revealResizerPastStickyFooter()` (E3.2.5) proactively `scrollIntoView`-d
the resizer clear of the sticky footer the first time results appeared.
Real-phone verdict on E3.2.5 was explicit: automatic outer-modal
repositioning is itself undesirable. With `.rte-manuscript-region`'s
total height now invariant across all Find/Replace states, the
motivating SYMPTOM (outer scrollHeight shifting unpredictably) is gone —
but measured directly, the sticky-footer occlusion ITSELF was NOT fixed
by that alone: the scroll position that lands the resizer under the
footer is driven entirely by the browser's native "scroll the newly-
focused find input into view" behavior, which depends only on content
ABOVE the region (title/metadata/toolbar), completely unrelated to
anything the region itself changed. Reproduced directly: hit-testing the
resizer at the exact post-focus-scroll position resolved to `.modal-
actions.sticky-modal-footer`, not the resizer — same defect, unrelated to
and unfixed by the region change alone.

The REAL structural fix, in place of any auto-scroll compensation
(`css/editor.css`, phone-only):
```css
#sceneModal:has(.rte-project-results-wrapper:not([hidden]))
  .modal-actions.sticky-modal-footer{position:static;bottom:auto}
```
This is the EXACT SAME precedent `#textModal` already uses
UNCONDITIONALLY (`#textModal .modal-actions.sticky-modal-footer{
position:static}`, present since before Stage E) — while project results
are visible, the footer simply stops being sticky, so there is nothing
left for the resizer to ever be occluded BY, regardless of scroll
position, viewport width, or how many rows the Find/Replace controls
wrap to. Save/Cancel remain reachable at the natural end of the outer
scroll. `:has()` is an already-established technique in this codebase
(css/modals.css, css/profiles.css, css/timeline.css), not introduced
here. Verified via a genuine CDP touch reproduction: `elementFromPoint`
at the resizer's exact rendered center resolves to the resizer itself,
with zero auto-scroll involved at any point.

Both `revealResizerPastStickyFooter()` (js/editor/find-replace-panel.js)
and its paired `scroll-margin-bottom` CSS rule were REMOVED entirely (not
kept as dead/defensive code), per the explicit "don't keep dead
corrective machinery" instruction.

### F. Corrected shared-space architecture

```css
@media(max-width:760px){
  #sceneModal .rte-manuscript-region{
    display:flex;flex-direction:column;
    height:50vh;height:50dvh;
    overflow:hidden;
  }
  #sceneModal .rte-manuscript-region .rte-editor{height:auto;min-height:140px}
  #sceneModal:has(.rte-project-results-wrapper:not([hidden]))
    .modal-actions.sticky-modal-footer{position:static;bottom:auto}
}
```
`flex:1 1 auto` for `.rte-editor` already comes from its own generic base
rule (shared with `#textModal`); only `height`/`min-height` needed
overriding for the region context. `.rte-project-results-wrapper{flex:
none}` (unconditional, pre-existing) means it never grows/shrinks beyond
its own JS-managed height — exactly mirroring `#textModal`'s `.rte-
toolbar{flex:none}`. The results-height clamp
(`js/editor/find-replace-panel.js`) became geometry-aware:
`effectiveMaxResultsHeight()` reads the region's live height and the
editor's own CSS `min-height` (a single source of truth, read via
`getComputedStyle` rather than duplicated as a second JS constant) to
cap how tall results can be dragged, falling back to the flat
`MAX_RESULTS_HEIGHT`(420) whenever there is no `manuscriptRegion` (every
other surface) or at desktop widths (desktop keeps its own separate,
untouched, flat-320px geometry).

`MANUSCRIPT_MIN_HEIGHT=140` (find-replace-panel.js): the practical
mobile floor, replacing E3.2.3's rejected 20px "technical floor." 140px
minus `.rte-editor`'s own 12px+12px vertical padding leaves ~116px of
visible text at this app's manuscript line-height (1.55×16px ≈ 24.8px/
line) — roughly 4-5 whole lines, genuinely readable/editable, not a
sliver. Deliberately the SAME number as `DEFAULT_RESULTS_HEIGHT`: when
both panes contend for the same budget, neither pane's own comfortable
default is allowed to crush the other below ITS comfortable default.

### G. Measured geometry (375×812 portrait, genuine CDP touch drags)

- **Find/Replace closed**: `editorHeight=406`, `regionHeight=406` — the
  manuscript claims the entire shared-region budget (no results pane to
  share it with).
- **Find/Replace open, current-scene mode**: `editorHeight=406`
  unchanged — the toolbar/Find/Replace row is outside the region and
  never consumes its budget, exactly the required boundary.
- **Project mode, before a query is typed**: `editorHeight=248`,
  `regionHeight=406` (unchanged) — the results pane (default 140px)
  already claims its share; the manuscript already shrank correspondingly
  even before any query/results content exists.
- **Project mode, with results populated**: identical to the pre-query
  state (`editorHeight=248`, `resultsHeight=140`) — resultsRoot's
  explicit JS-managed height doesn't depend on content, so typing a query
  changes nothing about the split.
- **Resizer reachability**: `elementFromPoint` at the resizer's exact
  rendered center resolves to the resizer itself the very first time it
  appears — no occlusion, no auto-scroll performed.

### H. Measured geometry after grow/shrink drags

A genuine CDP touch drag `+100px`: `resultsHeight` `140→240` (+100);
`editorHeight` `248→148` (−100, the exact desktop-style exchange);
`regionHeight` `406→406` (**exactly unchanged**); `modalScrollTop`
`475→475` (**exactly unchanged**, no compensation needed at all);
`windowScrollY` stayed `0`; the anchor ABOVE the region
(`#sceneTextFindReplace`'s own viewport top) stayed exactly unchanged;
the anchor BELOW the region (`.scene-participant-selector`'s own
viewport top) also stayed exactly unchanged, since the region's total
footprint in the document never changed at all.

A reverse `-60px` drag (after `scrollIntoViewIfNeeded()` — a realistic
"the user scrolls a little to find the now-lower handle again" step,
since growing pushed the resizer below the fold; this settle step is
NOT part of the drag contract, and itself caused zero anchor drift once
settled) proved the exact inverse: `resultsHeight` `240→180` (−60);
`editorHeight` `148→208` (+60, returned to the manuscript); region/
scrollTop/window-scroll/both anchors all unchanged again.

Five repeated `+50/-50` grow-then-shrink cycles returned to EXACTLY the
same `resultsHeight`/`editorHeight`/`regionHeight` every single cycle —
zero accumulated drift, directly disproving the real-phone "results
sometimes expand/collapse in ways that don't correspond to the finger
drag" symptom for this reproduction.

### I. Proof: total shared height stable; manuscript/results exchange in opposite directions

Every measurement above: `regionHeight` invariant at `406px` across
closed/current-scene/project-before-query/project-with-results/grow/
shrink/5 repeated cycles/scope-toggling/close-reopen — never drifted by
more than floating-point/border rounding (<1px). `editorHeight +
resultsHeight` (+ the fixed resizer/margin chrome) always sums back to
the same region total; every `+N` results delta paired with an
`-N` editor delta (and vice versa) within a 4px tolerance across every
drag tested, including the extreme `MAX`/`MIN` clamp cases.

### J. Practical manuscript minimum and rationale

`MANUSCRIPT_MIN_HEIGHT=140px` (see §F above for the full line-count
derivation). Verified live: dragging to an extreme `+2000px` clamps
`resultsHeight` to `258px` (NOT the flat 420 max — the dynamic clamp
correctly stopped short to protect the floor) and `editorHeight` to
exactly `140px`, never below it. A naive hand-computed estimate
(`406(region) − 140(editorMin) − 8(resizer) − 10(wrapper margin) = 248`)
undershoots the measured `258` by 10px — the actual overhead the resizer
+margin+padding claim is a few pixels less than that estimate assumes,
which is exactly why `effectiveMaxResultsHeight()` reads `chromeOverhead`
live from the DOM (`resultsWrapper` minus `resultsRoot`'s own rendered
height) instead of hardcoding a second, easily-stale copy of this
arithmetic.

### K. Outer modal / window scroll / anchor measurements

`modalScrollTop`: **unchanged** (not merely "stable within tolerance" —
literally identical before/after) across every single drag tested: the
initial +100 grow, the -60 reverse, all 5 repeated cycles, the extreme
MAX drag, and the extreme MIN drag. `window.scrollY`: `0` throughout,
confirmed via both per-drag checks and one final whole-sequence check.
Anchor above (`#sceneTextFindReplace`) and anchor below (`.scene-
participant-selector`): both within 4px (effectively 0px) of their
pre-drag position across every drag, including both extreme clamped
drags.

### L. Splitter hit-testing / sticky-footer result

`elementFromPoint` at the resizer's exact center resolves to the resizer
itself (not `.sticky-modal-footer` or anything else) as soon as it first
becomes visible in project mode — with genuinely zero auto-scroll
performed at any point (confirmed by removing E3.2.5's
`revealResizerPastStickyFooter()` entirely and re-measuring). Root cause
fully resolved structurally via the `:has()`-based conditional
`position:static` on the footer (§E above), not by chasing the
occlusion with scroll compensation.

### M. Repeated state-transition results

current-scene → project → current-scene → project: each transition
restores the manuscript to its full shared-region height on leaving
project scope, and to the identical previous split on re-entering it
(no drift). Close Find/Replace entirely, then reopen: manuscript
restores to full height on close, and the previously-active project
scope (with its results pane) is correctly restored on reopen, region
total unchanged throughout. Combined with the 5-cycle grow/shrink drift
check (§H), this directly addresses the real-phone "results sometimes
appear to expand/collapse in ways that do not correspond to the finger
drag" report: no such divergence was reproduced anywhere in this
instrumented sequence.

### N. Portrait / short-landscape / desktop

**Portrait** (375×812): all invariants above hold exactly. **Short
landscape** (667×375, sanity only, no redesign attempted): the shared
region's own budget there is only `~187.5px` (50dvh of 375px) — smaller
than results' own default (140px, `flex:none`, never shrinks) plus the
manuscript's practical 140px floor combined (~298px+chrome). Measured
directly: both the results pane and the manuscript still each claim
their own full requested height from the flex algorithm; `.rte-
manuscript-region{overflow:hidden}` clips whatever doesn't fit rather
than forcing an ugly negative/zero size. This is a genuine, honest
degraded state in this one cramped orientation — NOT a crash (zero page
errors), NOT a horizontal-overflow regression, and the manuscript
remains genuinely editable throughout (confirmed live). Explicitly NOT
redesigned for this stage, matching the scope guard; landscape/tablet
work remains deferred to E6 (consistent with every earlier stage's own
landscape notes).

**Desktop** (1280×800): re-measured `#sceneModal` after this stage's
changes — byte-identical to before: `editorHeight` stays exactly `320px`
before and after a +100px drag; `.modal`'s own `scrollHeight` still
absorbs the growth (`1356→1456`); `elementFromPoint` still resolves to
the resizer. `effectiveMaxResultsHeight()`'s `matchMedia("(max-width:
760px)")` guard means the dynamic clamp never runs at desktop widths at
all. `#textModal` desktop: untouched, unmeasured-as-changed (out of
scope for this stage's edits).

### O. Out-of-scope finding (flagged, not fixed)

`#textModal` (Text Scene) shares the SAME "everything in one flex
column, including toolbar+Find/Replace" structure as desktop's own
accepted mechanism, and measured directly to also collapse its editor to
~26px at `MAX_RESULTS_HEIGHT` on phone (375×812) — a latent instance of
the same class of defect E3.2.3 was rejected for, never yet reported
because (evidently) no real-device test dragged its results pane all the
way to its max. This stage does not touch `#textModal` at all — no task
instruction named it as an implementation target, and Text Scene's own
existing regression (`tools/mobile-text-scene-browser.test.mjs`) passes
unchanged, confirming this stage introduced no NEW regression there.
Flagged as a separate follow-up rather than fixed inline, per scope
discipline.

**Files changed:** `index.html` (`.rte-manuscript-region` wrapper around
`#sceneTextEditor`), `js/editor/scene-editor-controller.js`
(`manuscriptRegion` derivation + threading into `createFindReplacePanel`),
`js/editor/find-replace-panel.js` (`manuscriptRegion` parameter,
region-aware insertion point, `MANUSCRIPT_MIN_HEIGHT` constant,
geometry-aware `effectiveMaxResultsHeight()`, removed
`revealResizerPastStickyFooter()`), `css/editor.css`
(`.rte-manuscript-region` flex rules, `:has()`-based sticky-footer fix,
removed `scroll-margin-bottom` workaround), `tools/mobile-scene-editor-
browser.test.mjs` (full rewrite of the Find/Replace resizer section:
shared-region invariants, opposite-direction exchange, repeated-cycle
drift check, state-transition checks, reachability, extreme-drag
practical-minimum checks, updated landscape sanity; baseline-failure
proof confirmed against unmodified `c2dcc39`).

## 39. Explicit confirmation (E3.2.6)

No Supabase changes, no migrations, `reference/` and `backup/`
untouched. E4, E6, and tablet work were not started. No landscape
redesign was attempted (sanity-checked only, per §N above). Find/Replace
search/replace semantics, the toolbar, and project-results horizontal
scrolling (E3.1.2/E3.1.3) are unchanged. Quick Scene was not touched (it
has no Find/Replace panel at all). Text Scene's own regression
(`tools/mobile-text-scene-browser.test.mjs`) passes unchanged, confirming
no new regression was introduced there — its own existing latent
collapse-at-MAX defect (§O) was found, not fixed, and is flagged
separately. Desktop's existing `#sceneModal` geometry (flat 320px,
outer-modal-absorbs-growth model) is fully preserved, confirmed via
direct before/after measurement.

## 40. Stage E3.2.7 — unify mobile splitter contract + two visual follow-ups

Real-phone validation ACCEPTED E3.2.6's core `#sceneModal` splitter
mechanism (results/manuscript share a stable budget, no outer-modal
jumping). Three follow-ups: (1) the manuscript's bottom border/rounded
corners could get clipped at some splitter positions; (2) the active
project-search result row's outline/background only wrapped the
intrinsic snippet text, not the full row width; (3) `#textModal` (Text
Scene)'s latent collapse-at-MAX defect (flagged, not fixed, in E3.2.6 §O)
was confirmed on a real device — the splitter could travel far enough
that the manuscript effectively disappeared and the sticky footer left
the composition.

### Cause 1: manuscript bottom-border clipping

`effectiveMaxResultsHeight()`'s `chromeOverhead` calculation (find-
replace-panel.js) read `resultsWrapper.getBoundingClientRect().height`,
which — like every `getBoundingClientRect()` call — never includes an
element's own MARGIN. `.rte-project-results-wrapper{margin:0 -18px
10px}`'s 10px bottom margin still consumes real space in the flex column
(margins affect flex layout even though they sit outside the border box),
but the old calculation silently dropped it, letting results grow 10px
taller than the region could actually hold. Measured directly: at MAX
drag, the manuscript's own rendered bottom edge sat exactly 10px past
`.rte-manuscript-region`'s own bottom edge — `overflow:hidden` on the
region clipped that 10px, taking the manuscript's own bottom border and
rounded corners with it. **Fix:** read the wrapper's own `margin-top`/
`margin-bottom` via `getComputedStyle` and add them to `chromeOverhead`,
so the true flex-column footprint is measured correctly (find-replace-
panel.js). Verified: `editorBottomOverflow` (editor's own bottom minus
the region's own bottom) is exactly `0` at every measured splitter
position, including both extremes, for both `#sceneModal` and
`#textModal`.

A SECOND, previously-undetected clipping bug was found while fixing
this: `.rte-manuscript-region{overflow:hidden}` also clips HORIZONTALLY
by default, which broke `.rte-project-results-wrapper`'s own `margin:0
-18px` full-bleed technique (E3.1.2/E3.1.3) — the wrapper, now nested one
level deeper inside the region (since E3.2.6), bled 18px past the
region's own un-bled edge and got silently clipped there: invisible and
unreachable via `elementFromPoint`. Discovered via Text Scene's existing
E3.1.3 horizontal-scroll-hit-test regression, which failed for exactly
this reason once the region existed. **Fix:** `.rte-manuscript-region
{margin:0 -18px;padding:0 18px}` (css/editor.css, unconditional) — the
region's own border-box now extends to the same outer edge the wrapper
already bleeds to, and the matching padding shifts its content box back
in by that same 18px, so ordinary (non-bled) children like the
manuscript still render at their original position, while the wrapper's
bleed now lands exactly at the region's (extended) edge instead of past
it. This was a real, latent E3.2.6 regression in `#sceneModal` too (not
new to this stage) — its own existing tests didn't do the rigorous
coordinate-click-after-scroll check Text Scene's does, so it went
undetected until this stage's Text Scene generalization surfaced it via
that stricter regression.

### Cause 2: intrinsic-width active result row

`.rte-project-result-row{width:max-content;overflow:visible}` (E3.1.3,
phone-only) sized each row's box to its OWN content — correct for a long
snippet (its background/border must cover its full overflowing text,
not clip at the viewport edge, which was E3.1.3's original fix), but for
a SHORT snippet this also shrank the box down to that snippet's own
intrinsic width, so the active-row outline/background only wrapped the
text, not the row's actual available width. **Fix:** `.rte-project-
result-row{width:max-content;min-width:100%;overflow:visible}` — adds a
floor: the box is the LARGER of its own content width and the full row
width (`min-width:100%` resolves against `.rte-project-result-group`'s
own default block width, itself the results list's full width). A short
row's box now spans the whole row (this stage's fix); a long row's box
still grows past 100% to cover its full text (E3.1.3's fix, unaffected).
Verified live: a short snippet's active row now measures ~90% of the
results list's own width (matching its padding), and a long snippet
(deliberately constructed with the shared `SNIPPET_CONTEXT_CHARS=42`
context window on both sides of the match) still renders a background-
covered box hundreds of pixels wider than the viewport, horizontal
scroll still moves it, and no page-level horizontal overflow appears.

### Cause 3: Text Scene splitter collapse

Exactly the mechanism E3.2.6 §O already identified: `#textModal`'s
toolbar, Find/Replace controls, results pane, and manuscript editor all
shared ONE fixed-height flex column (`#textModal .modal{display:flex;
flex-direction:column;height:92vh/100dvh;overflow:hidden}`), with the
editor as the column's only `flex:1 1 auto;min-height:0` child — so
ANY sibling claiming more space (chiefly the results pane, up to its
flat `MAX_RESULTS_HEIGHT=420`) squeezed the editor arbitrarily close to
zero, with nothing structurally stopping it. Measured pre-fix: editor
`~26px` at `MAX_RESULTS_HEIGHT` on a 375×812 viewport.

### E3.2.6 structure reused, not reinvented

Per the task's explicit preference, `#textModal` now uses the EXACT same
`.rte-manuscript-region`/`manuscriptRegion` mechanism E3.2.6 built for
`#sceneModal` — no second, parallel splitter architecture:

- **HTML** (index.html): `#fullSceneTextEditor` wrapped in `<div
  class="rte-manuscript-region">`, identical in spirit to `#sceneModal`'s
  own wrapper.
- **JS**: zero changes needed beyond what E3.2.6 already built.
  `scene-editor-controller.js`'s `manuscriptRegion` derivation
  (`editorContainer.parentElement?.classList.contains(
  "rte-manuscript-region")`) is already fully generic — wrapping
  `#fullSceneTextEditor` in HTML was sufficient for `mountSceneEditor`
  (reused for both surfaces) to thread it through to
  `createFindReplacePanel` automatically. `effectiveMaxResultsHeight()`'s
  dynamic clamp is likewise already generic (gated only by "is there a
  `manuscriptRegion`" and the phone `matchMedia` check, never by which
  modal it's in).
- **CSS is where the two surfaces genuinely differ**, because their outer
  modals differ: `#sceneModal .modal` is a non-flex, linear-scroll modal,
  so its region needs an explicit `height:50dvh`. `#textModal .modal` is
  ALREADY a fixed-height flex column — `.rte-manuscript-region` there
  instead becomes `flex:1 1 auto;min-height:0`, taking over the exact
  role `.rte-editor`'s own generic rule used to provide directly (since
  the editor is no longer a direct child of that outer column). This is
  UNCONDITIONAL (not phone-only), because it is also needed to keep
  `#textModal`'s OWN already-accepted desktop exchange (E3.2.6 §A)
  working with the new DOM nesting — verified byte-identical to before.
  `MANUSCRIPT_MIN_HEIGHT=140px` (find-replace-panel.js, unchanged number,
  single source of truth) is applied to `#textModal .rte-manuscript-
  region .rte-editor` phone-only, exactly mirroring `#sceneModal`'s own
  treatment; desktop deliberately keeps `min-height:0` (unchanged from
  before this stage — its own much larger budget makes near-zero
  collapse impractical in ordinary use, and nothing reported desktop
  Text Scene as broken).

### Text Scene shared-region height (375×812 portrait, genuine CDP touch drags)

Find/Replace closed: not separately re-measured this stage (unchanged
from E3.2.6's own finding that `#textModal`'s generic flex rule already
worked correctly there). Project mode, default results: `editorHeight=
244.09`, `regionHeight=402.09`, `resultsHeight=140`. `regionHeight`
(402.09, not exactly 406 like `#sceneModal`'s dvh-based region) is
whatever's left in `#textModal`'s own fixed flex column after its own
toolbar/Find/Replace/h2/footer claim their share — this is expected and
intentional: unlike `#sceneModal`, `#textModal`'s region total is
externally determined by the outer column, not a hardcoded constant; the
CORE, universally-required invariant (proven below) is that this total
stays STABLE DURING a drag, not that it equals `#sceneModal`'s own
number or stays identical across every Find/Replace open/closed
transition (a property `#textModal`'s pre-existing, already-accepted
architecture never had either, even before this stage, and which this
stage was not asked to add).

### Results/editor heights after grow/shrink

Genuine CDP touch `+100px`: `resultsHeight` `140→240` (+100);
`editorHeight` `244.09→144.09` (−100, the desktop-style exchange);
`regionHeight` unchanged (`402.09→402.09`); `#textModal .modal`'s own
height unchanged (`812→812`, the fixed 100dvh — it never scrolls);
`.sticky-modal-footer`'s own `top` unchanged (`737→737`); footer stayed
visible throughout. `-60px` reverse drag: `resultsHeight` `240→180`
(−60), `editorHeight` `144.09→204.09` (+60, returned to the manuscript),
region/modal/footer all unchanged again. Extreme `+3000` drag: `results
Height` clamps to `244.09` (well under the flat 420 max — the dynamic
clamp correctly protects the floor), `editorHeight` clamps to exactly
`140` (the practical minimum — NOT the previously-measured ~26px
collapse). Extreme `-4000` drag: `resultsHeight` clamps to flat
`MIN_RESULTS_HEIGHT=90`, `editorHeight` returns to `294.09` (`402.09 −
90 − ~18px chrome`).

### Manuscript minimum

`MANUSCRIPT_MIN_HEIGHT=140px` — the SAME canonical value used for
`#sceneModal` (find-replace-panel.js remains the single source of truth
for both), per the task's own explicit preference to reuse rather than
invent a second magic number. Verified it fits Text Scene's actual phone
geometry comfortably (portrait region ~402px, leaving ~250+px of
headroom for results even at the manuscript's floor) — no viewport-
specific reduction was needed in portrait.

### Extreme-drag measurements

See "Results/editor heights after grow/shrink" above — both extremes
measured with the manuscript never crossing below 140px and results
never exceeding its (flat or dynamic) ceiling.

### Footer behavior before/after

Before this stage (measured against unmodified `fcf92df`): no
`.rte-manuscript-region` existed for `#textModal` at all, so nothing
structurally prevented the editor from being squeezed toward zero by
results growth, which is the same mechanism that let the splitter
"travel far downward" and the footer "disappear from the expected
working composition" per the real-phone report — with the editor able
to shrink to ~26px, the visual composition would read as almost entirely
results, with comparatively little room left for the footer's own
neighborhood to feel present/reachable in the same view. After this
stage: `.sticky-modal-footer`'s own `top` position is measured
completely unchanged (`737px`, exact equality, not just within
tolerance) across every drag tested, in both directions, at both
extremes — because `.rte-manuscript-region` is now a flex:1 sibling of
the (always fully-sized, `flex:none`) footer within the SAME fixed-height
outer column, the footer's own space was never at risk in the first
place once the region correctly bounds its own internal exchange.

### Repeated-cycle / scope-toggle drift

Three repeated `+50/-50` grow-then-shrink cycles returned to the exact
same `resultsHeight`/`editorHeight`/`regionHeight` every cycle (zero
drift). Scope toggling (Эта сцена → Весь проект → Эта сцена → Весь
проект): region height stayed within tolerance of its pre-toggle value
at each step; re-entering project scope correctly re-showed the results
pane.

### Portrait / landscape / desktop

**Portrait** (375×812): all invariants above hold. **Short landscape**
(667×375, sanity only, no redesign attempted, matching `#sceneModal`'s
own E3.2.6 landscape note): editor and results both clamp to their
practical/flat minimums (`140`/`140` respectively) rather than crashing
or overflowing; no page-level horizontal overflow; the manuscript
remains genuinely editable (confirmed live); no page errors. **Desktop**
(1280×800): re-measured both surfaces after this stage's changes —
byte-identical to before. `#sceneModal`: `editorHeight` stays exactly
`320px` before/after a mouse drag, `.modal`'s own `scrollHeight` absorbs
the growth, unaffected by the new `.rte-manuscript-region{margin:0
-18px;padding:0 18px}` rule (confirmed via direct rect measurement:
`left`/`right`/`height` identical). `#textModal`: `editorHeight
320.09→220.09` for a +100px drag (unchanged from E3.2.6's own
measurement), `.modal`'s own height stays exactly `736px`.

### Stop-condition check

Fixing `#textModal` did NOT require redesigning the whole modal: the
existing `.rte-manuscript-region`/`manuscriptRegion` mechanism, built
for a different (non-flex) outer-modal shape in E3.2.6, generalized
cleanly to a flex outer-modal shape with only a CSS-level difference in
how the region itself claims its height (explicit `dvh` vs. `flex:1`) —
no JS changes, no second workaround, no scrollIntoView/reveal-resizer/
scroll-compensation hack introduced anywhere in this stage.

**Files changed:** `index.html` (`.rte-manuscript-region` wrapper around
`#fullSceneTextEditor`), `css/editor.css` (`#textModal .rte-manuscript-
region` flex rules, shared `.rte-manuscript-region` bleed-compensation
rule, active-result-row `min-width:100%` fix), `js/editor/find-replace-
panel.js` (`chromeOverhead` margin-accounting fix), `tools/mobile-scene-
editor-browser.test.mjs` (bottom-clipping + active-row-width
assertions), `tools/mobile-text-scene-browser.test.mjs` (full shared-
region splitter regression: opposite-direction exchange, region/footer/
modal invariance, practical minimum, repeated-cycle and scope-toggle
drift checks, reachability; baseline-failure proof confirmed against
unmodified `fcf92df`), `tools/find-replace-project-replace-all-browser
.test.mjs` (fixed 4 sibling-combinator selectors — `#…FindReplace ~
.rte-project-results-wrapper` — that assumed the pre-E3.2.6/E3.2.7 flat
DOM structure; 3 of the 4 had been silently vacuous, null-safe checks
that never actually matched anything since E3.2.6, not caught as
failures until this stage's stricter Text Scene assertion surfaced the
pattern).

## 41. Explicit confirmation (E3.2.7)

No Supabase changes, no migrations, `reference/` and `backup/`
untouched. E4, E6, and tablet work were not started. No landscape
redesign was attempted (sanity-checked only, per the Portrait/landscape/
desktop section above). Find/Replace search/replace semantics, Replace/
Replace All logic, project search logic, and shared horizontal project-
results scrolling (E3.1.2/E3.1.3) are unchanged — the only project-
results CSS change (`min-width:100%` on the row) was verified not to
disturb the E3.1.2/E3.1.3 horizontal-scroll/hit-test contract, and the
project-replace-all test's selector fixes are DOM-structure-only, not
behavioral. Editor content behavior and save behavior are unchanged.
Quick Scene was not touched (it has no Find/Replace panel at all).
`#allScenesModal` ("Весь текст") was not touched — out of scope for this
stage, unaffected by any of these changes (its own `.rte-sticky-
controls`-based results insertion path never passes a `manuscriptRegion`
and is untouched). Desktop behavior for both `#sceneModal` and
`#textModal` is confirmed unchanged via direct before/after measurement.

## 42. Stage E3.2.8 — stabilize the splitter scroll context + repair project-results horizontal containment

Real-phone validation REJECTED E3.2.7 while confirming its core: the
bounded [results + splitter + manuscript] region, the opposite-direction
exchange, Text Scene no longer collapsing, and the 140px manuscript floor
are all accepted and were **not** touched (`50dvh`, `140px`, default/MIN/
MAX result heights unchanged). Four remaining defects, each diagnosed by
measurement before any change. No reveal/`scrollIntoView` workaround was
added.

### The three invariants this stage defines

1. **Bounded vertical region invariant.** The region's total height never
   changes during a drag AND its contents never exceed it: results yields
   before the manuscript can be pushed past its own box (§B).
2. **Outer-scroll / anchor invariant.** A splitter drag changes nothing
   *outside* the region: outer `scrollTop`, `window.scrollY`, and the
   viewport position of anything above or below the region are unchanged,
   and no scroll event fires on an ancestor (§A).
3. **Horizontal ownership invariant.** Exactly ONE element scrolls
   horizontally — `.rte-project-results` — and no other container in the
   chain can be scrolled sideways at all (§C, §D).

### A. Splitter drag moved the outer modal (Scene Editor)

Reproduced with genuine CDP touch input, sampling every touchmove. The
precondition that matters is **the manuscript holds focus** (the user has
been typing): with nothing focused, or the Find input focused, a +100px drag
moved nothing. With the editor focused, a +100px drag scrolled
`#sceneModal .modal` by exactly **+100px** (scroll event on `modal`; content
above the region −100px, below −100px; `window.scrollY` 0; region height,
`visualViewport` and the editor's own scroll all unchanged). Text Scene never
showed it because its modal does not scroll.

Mechanism (measured, not assumed): **Chrome scroll anchoring.** It prefers
the focused element as its anchor. Growing results pushes the manuscript's
top down, so the browser "compensates" by scrolling the outer scroller.
Confirmed by toggling only `overflow-anchor`: unchanged baseline +100;
`overflow-anchor:none` on the region → 0; on the outer modal → 0; on the
editor → 0.

Fix (structural, CSS-only): `overflow-anchor:none` on `.rte-manuscript-region`.
Its contents exchange height internally *by design*, so none of them may act
as a scroll anchor; the exclusion covers the whole subtree (results and
manuscript). After: outer `scrollTop` unchanged (baseline in the regression:
475 → 575), no scroll event on any ancestor, anchors above/below within 1px,
in both directions, at both extremes, over repeated cycles and scope toggles.

### B. Bottom border/radius still missing (measured clipping ancestor)

E3.2.7's margin accounting was correct but insufficient: the actual clipper
was always the **region itself** (`overflow:hidden`), and the underlying
problem is that the region's height is *externally determined* (`50dvh`; or
leftover flex space in Text Scene) while results was a non-shrinking
`flex:none` 140px and the manuscript has a 140px floor. Whenever the budget
is below `140 + 18 (splitter 8 + margin 10) + 140 = 298` the manuscript is
pushed past the region's bottom edge and the clip cuts its bottom border and
both radii. Measured on the OLD code (`editor bottom − region bottom`, and
region `scrollHeight − clientHeight`): Scene Editor 360×640 after a `dvh`
shrink of 56px (browser chrome reappearing) **6px**; Text Scene 375×667 by
default **41px**. (A clip line coinciding *exactly* with the editor's border
also makes the border fragile under sub-pixel snapping while the outer modal
scrolls; removing the clip removes that fragility too — not separately
provable on desktop CDP.) Ancestor overflow modes, editor upward: `.rte-
manuscript-region` (`hidden` — the clipper), then `.scene-section` (`visible`)
and `.modal` (`auto` in Scene Editor: a scroller, not a clipper; `hidden` in
Text Scene: clips at the modal, with the footer below the region), backdrop
`hidden`.

Fix, without subtracting arbitrary pixels:
- The region no longer clips vertically (`overflow-y:visible`).
- Overflow is prevented at the source: inside a region the results wrapper is
  a shrinkable column-flex item (`flex:0 1 auto`, floor `98px` = results
  floor 90 + splitter 8), so it yields only *after* the manuscript reaches its
  140px floor. Priority is expressed as shrink weights (`.rte-editor
  {flex-shrink:1000}`): equal weights measurably shrank results 140→115px at
  375×812 (changing the approved default), and a tiny wrapper weight does not
  work because Chrome only distributes the weight-sum fraction while the
  unfrozen weights sum < 1.
- The `#sceneModal` region also gets `min-height:248px` (=90+18+140) so on
  landscape/tiny viewports its OUTER scroll absorbs the difference instead of
  the region overflowing. Text Scene's region stays externally determined (its
  footer must stay pinned); below ~248px its column can still be short —
  landscape/tablet remain out of scope.

After: overflow 0 at default / MIN / MAX / after repeated cycles / 360×640 /
dvh-shrink / 375×667, both surfaces; defaults preserved (`resultsH≈139.97`,
editor 248 at 375×812).

### C. Project results escaping horizontally (structural; see limitation)

Measured per ancestor (`scrollWidth − clientWidth`, `scrollLeft`): row →
`.rte-project-result-group` (overflow visible, sw 683 vs 339) → **`.rte-
project-results` (overflow-x:auto, sw 701 vs 375 — the one intended
scroller)** → wrapper (375/375) → `.rte-manuscript-region` (`hidden`, 375/375)
→ `.scene-section` (sw 357 vs cw 339: the 18px full-bleed of the region; not a
scroll container) → `.modal` (375/375) → backdrop (375/375) → body/html
(375/375; `visualViewport.pageLeft` 0). At rest, and on a genuine touch pan,
overpan, tap, focus and Enter-navigation, desktop Chromium **could not
reproduce** the phone's whole-modal sideways shift. What was measurable is its
enabling condition: `overflow:hidden` is still a *scroll container* — focusing
wide content inside the region scrolled the region sideways by **843px** on
the old code (both surfaces), and anything wider than the region that ever
escapes the results list can shift the modal the same way.

Fix (structural): `.rte-manuscript-region{overflow-x:clip}` — clips
identically but is **not a scroll container**, so it (and everything in it)
can never be scrolled off-axis; the results scrollport keeps
`overscroll-behavior-x:contain`. After: the same probe leaves region/modal/
backdrop/document `scrollLeft` at 0. Limitation stated plainly: the exact
Chrome-Android trigger was not reproduced here. The regression asserts the
measured cause (the clipping ancestor is not scrollable; wide focusable
content inside the region cannot shift any container) plus the observable
outcome (only the results scrollport has `scrollWidth > clientWidth`;
`documentElement` `scrollWidth ≤ clientWidth`; a touch pan and
focus/scroll-into-view on a long row move only the scrollport).

### D. Short active row border ended after its text (horizontal ownership)

Audit: the shared horizontal scrollport is `.rte-project-results`, but there
was no shared scroll-content element. `.rte-project-result-group` was a plain
block exactly as wide as the scrollport's content box (339px), so E3.2.7's
`min-width:100%` on a row resolved against a box that stops at the scrollport's
edge — a short row was 339px while a long sibling was 683px, so once the list
scrolled sideways the short row's border ended a few px after its text.

Implemented model (phone; desktop keeps plain block flow + ellipsis):

    .rte-project-results            ONE visible scrollport (overflow-x:auto, no side padding)
      .rte-project-results-canvas   shared canvas: min-width:100%; width:max-content; padding 0 18px
        .rte-project-result-group   plain blocks
          .rte-project-result-row   width:100% OF THE CANVAS

`find-replace-panel.js` renders all results content into that one canvas
(shared by Scene Editor, Text Scene and "Весь текст"). The canvas is never
narrower than the scrollport and grows to the widest row; every row spans it,
so a short selected row's border/background/hit area covers the whole
scrollable width, and the horizontal gutters scroll with the content (scrolled
to the end every row ends exactly 18px from the scrollport edge). Rows are
still not scroll owners. Before/after (375px phone, short + long result): row
widths `[339, 693, 339]` → `[683, 683, 683]`; scrolled to the end the short
row's right edge now equals the longest row's. The E3.1.3 assertion
"different-length rows must have different box widths" encoded the old hugging
model and was replaced by "every row spans the canvas".

### E. Text Scene

Vertical splitter untouched. The shared Find/Replace component carries all
horizontal fixes (canvas, region `overflow-x:clip`), so Text Scene gets them
without a separate hack; its clipping numbers are in §B. Class A (scroll
anchoring) cannot occur there (no outer scroller) — the regression passes on
the old code there by design.

### Tests and baseline-failure proof

`tools/mobile-splitter-contract.mjs` is one shared contract run by both
`mobile-scene-editor-browser` and `mobile-text-scene-browser` (genuine CDP
touch for every drag/pan; a long AND a short project result in a fixture
scene). Classes can be run in isolation (`checks:`); against unmodified
`2e0aec4` CSS/JS: **A** scene FAIL "the outer modal scrolled during the
splitter drag … scrollTop 475 -> 575" (text passes, as expected); **B** both
FAIL (region `overflow-y:hidden`; behavioral 6px / 41px overflow); **C** both
FAIL (region is a scroll container, `overflow-x:hidden`; wide content shifted
it 843px); **D** both FAIL "every result row must span the shared scroll
canvas … [339, 692.5, 339]". All pass with the fix. Desktop 1280×800 measured
identical before/after on both surfaces (`#sceneModal` editor 320px with the
outer scroll absorbing growth; `#textModal` editor 320.1→220.1, modal 736px;
row widths/overflow unchanged).

### Real-device validation status

Automated: complete as above. **Not yet validated on a real phone** — in
particular §C's exact Chrome-Android trigger, and §A's behaviour with the real
on-screen keyboard (`visualViewport`), neither of which desktop CDP can drive.
Pending user validation.

**Files changed:** `css/editor.css`, `js/editor/find-replace-panel.js`
(canvas; comments), `tools/mobile-splitter-contract.mjs` (new, shared),
`tools/mobile-scene-editor-browser.test.mjs`, `tools/mobile-text-scene-
browser.test.mjs` (call the contract; E3.1.3 row-width assertion updated),
this doc.

## 43. Explicit confirmation (E3.2.8)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E4, E6 and tablet/landscape work were not started. Toolbar, Find/Replace
semantics, Replace/Replace All behavior, manuscript typography, scene
metadata/participants and Quick Scene were not changed. The E3.2.6 bounded
region, the 50dvh / 140px / default-result-height numbers, MIN/MAX results
constraints and the shared horizontal project-results scrolling model are
preserved. Nothing was pushed or merged.

## 44. Stage E3.2.9 — Full Scene Editor sticky footer restored

Real-phone validation of E3.2.8 accepted every E3.2.8 fix and found one
regression: in the Full Scene Editor, Закрыть / Сохранить и закрыть /
Сохранить текст were not sticky — scrolled to Find/Replace → results →
manuscript → «ПЕРСОНАЖИ» the footer was absent below the viewport.

### Exact cause and first bad stage (runtime geometry, not CSS reading)

The footer's outer-modal viewport gap (`modal bottom − footer bottom`) was
sampled at five outer-scroll positions per state on archived copies of each
commit (`git archive`, no repo changes):

| state | c2dcc39 (E3.2.5) | fcf92df (E3.2.6) | 2e0aec4 (E3.2.7) | 2fcaee4 (E3.2.8) |
|---|---|---|---|---|
| Find/Replace closed | sticky, gap 0 | sticky, gap 0 | sticky, gap 0 | sticky, gap 0 |
| current-scene | sticky, gap 0 | sticky, gap 0 | sticky, gap 0 | sticky, gap 0 |
| project results visible | sticky, gap 0 | **static, gap −1113…−259 (off-screen)** | **static** | **static** |

* **First bad stage: E3.2.6 (`fcf92df`).** Last good: E3.2.5 (`c2dcc39`).
  E3.2.8 did **not** cause it — its `overflow-x:clip`, removed vertical clip
  and canvas changes leave the footer sticky (gap 0) in the closed and
  current-scene states, and the broken state is byte-identical at all three
  later commits.
* **Cause:** E3.2.6 added
  `#sceneModal:has(.rte-project-results-wrapper:not([hidden])) .modal-actions
  .sticky-modal-footer{position:static;bottom:auto}` so the splitter could
  never sit under the footer. Whenever results were visible — exactly the state
  where users are editing — the footer stopped being sticky and scrolled away
  with the content. It never affected the sticky containing block or scroll
  owner: the footer is a child of `#sceneModal .modal`, which is the scroller
  (`overflow:auto`), before and after.
* It also never delivered its promise: with the static footer the splitter was
  *still* not immediately reachable on short phones (375×667, 360×640: the
  splitter was off-screen), because the real cause of the original occlusion
  was never the footer (below).

### What actually hid the splitter (E3.2.5 diagnosis, re-measured)

Opening Find/Replace focuses the find input and the browser's *native*
focus-scroll lands just far enough to show the **input** — with no awareness
of the results pane and splitter beneath it (nor of the sticky footer's
strip). On a tall phone that put the splitter under the footer's strip; on a
short one, off-screen. Measured with only the `:has()` rule removed:
375×812 splitter covered by the footer; 375×667 / 360×640 off-screen.

### Final model — footer sticky in every state, splitter clear of it, as geometry

Phone media block, `css/editor.css` (no JS, no auto-scroll, `:has()` removed):

```
#sceneModal .modal                    { scroll-padding-bottom:80px }
#sceneModal .rte-find-replace input   { scroll-margin-bottom:50dvh }
```

* **Sticky ownership / containing block (unchanged, restored to always-on):**
  `.modal-actions.sticky-modal-footer` (`css/modals.css`,
  `position:sticky;bottom:-18px;z-index:5`) sticks to the bottom of its scroll
  container `#sceneModal .modal`; nothing between them creates another scroller
  (`.scene-section`/`.rte-manuscript-region` are not its ancestors).
* `scroll-padding-bottom:80px` on the scroller makes native scroll-into-view of
  *any* control treat the footer's strip as obscured (footer height measured
  75px at 320–375px wide, 59px at 412px — its buttons wrap — so 80px covers it).
* `scroll-margin-bottom:50dvh` on the Find/Replace inputs makes revealing the
  input also reveal the region beneath it (that region's own budget is 50dvh),
  so the results pane and splitter land above the footer. If the box is taller
  than the viewport (on-screen keyboard) the browser aligns the input to the top,
  which is still visible.
* Verified across 320×568, 360×640, 375×667, 360×780, 375×812, 393×851,
  390×844, 414×896, 412×915: the splitter is the hit-test target immediately
  after opening project search. Tried and rejected: removing the `:has()` rule
  alone (footer covers the splitter at 375×812); adding only `scroll-padding`
  (small phones still under the footer).
* After every splitter drag (grow, shrink, MIN, MAX) at 375×812, 360×640 and
  412×915 — with no settling scroll — the splitter remains the hit-test
  target, the footer's `top` is unchanged, and outer `scrollTop` is unchanged.

Phone-only: desktop computed `scroll-padding-bottom`/`scroll-margin-bottom`
stay `auto`/`0px`; desktop and Text Scene numbers are identical before/after
(Text Scene's footer is, and remains, `position:static` in its own flex column).

### Preserved E3.2.8 invariants (all re-verified by the shared contract)

Outer `scrollTop`/`window.scrollY` unchanged by a splitter drag with the
manuscript focused (`overflow-anchor:none`); region total height invariant and
opposite-direction exchange; 140px manuscript floor; bottom border/radii intact
(`overflow-y:visible`, shrinkable results wrapper); `overflow-x:clip` region;
`.rte-project-results` the only horizontal scrollport; shared canvas with
full-width rows. None was reverted or reworked.

### Regression (`tools/mobile-splitter-contract.mjs`, `runStickyFooterContract`,
run by `mobile-scene-editor-browser`)

Observed geometry, never just `position:sticky`: for each state the outer modal
is genuinely scrolled to 0/25/50/75/100% (each position must be reached, the
range must be ≥400px and the sampled positions must differ by ≥300px, so the
test cannot pass vacuously), and at each the footer must lie inside the
modal's viewport, be flush to its bottom (≤1px, or within its 0–26px natural
resting range in the last 40px), and be the hit-test target of its own button.
States: closed, current-scene, project default, after grow, after shrink, MIN,
MAX — at 375×812 and 360×640. Splitter checks: hit-testable and clear of the
footer before each drag and straight after it; footer `top` and outer
`scrollTop` unchanged by the drag. Baseline proof (contract run against each
commit's archived code): `fcf92df`, `2e0aec4`, `2fcaee4` FAIL at "project
results, default splitter — footer left the modal's visible viewport at
scrollTop 0/933 (gap below viewport bottom: −932.7px)"; the closed and
current-scene states pass there, confirming E3.2.8 is not the cause.
`c2dcc39` (footer sticky, pre-E3.2.6) instead fails on the E3.2.8 scroll-
anchoring invariant (outer modal scrolled 493→593 on a splitter drag),
independently confirming the footer was last good there. Fix: PASS.
Phone landscape (667×375, sanity only): footer pinned (HEAD: static, gap
−964px), splitter reachable after a user scroll; no redesign.

### Real-device validation status

Automated: complete as above. Not yet validated on a real phone — in
particular the exact focus-scroll landing with the real on-screen keyboard
(`visualViewport`), which desktop CDP cannot drive.

### Pre-existing failures noted, not touched

`scene-rich-text-editor`, `scene-modal-rich-text`, `all-scenes-rich-text`,
`scene-surfaces-visual-system` and `dirty` browser suites fail with "modal did
not close after Save"/click timeouts identically on `2fcaee4` and on `master`;
unrelated to this stage. (The three rich-text suites were later shown to be
stale tests, not defects, and updated — see §50.5.)

**Files changed:** `css/editor.css`, `tools/mobile-splitter-contract.mjs`,
`tools/mobile-scene-editor-browser.test.mjs`, this doc.

## 45. Explicit confirmation (E3.2.9)

No Supabase changes, no migrations, `reference/` and `backup/` untouched.
E4, E6 and tablet work were not started; landscape was sanity-checked only.
The splitter, results, manuscript, horizontal-ownership and result-row-canvas
architecture of E3.2.8 was not reworked. Text Scene and desktop are unchanged.
Nothing was pushed or merged.

## 46. Stage E3.2.10 — footer wording consistency + "Весь текст" phone width

Real-phone validation of E3.2.9 **passed**: the whole E3.2 splitter /
project-results / sticky-footer sequence (E3.2.6–E3.2.9) is now accepted. This
stage is a two-item UI consistency task and reopens none of it (no splitter,
Find/Replace geometry, region height exchange or sticky-footer change).

### Footer wording

Rendered labels, measured (not read from markup):

| surface | before | after |
|---|---|---|
| Full Scene Editor | Отмена / Сохранить и закрыть / Сохранить | unchanged |
| Text Scene | Закрыть / Сохранить и закрыть / **Сохранить текст** | Закрыть / Сохранить и закрыть / **Сохранить** |
| Весь текст | Закрыть / Сохранить и закрыть / Сохранить все изменения | unchanged (multi-scene action deliberately keeps its wording) |

Only `#saveText`'s text changed (index.html). Ids, handlers
(`saveTextModalOnly`), `primary` class, dirty/enabled logic and semantics are
untouched; no `aria-label` added (the dialog is already labelled «Текст сцены»).
Note for future wording work: the Full Scene Editor's cancel button reads
«Отмена» (its `#cancelScene` is a cancel-with-discard-guard), not «Закрыть» —
left as is. At 412px wide all three Text Scene labels sit on one line (34px
buttons, identical to the Scene Editor); at 360–390px both surfaces wrap
«Сохранить и закрыть» to two lines (50px buttons) exactly as the Scene Editor
already did — pre-existing, shared, not addressed here.

### "Весь текст" — phone width only

Width owner (measured): the modal's inline `width:min(1180px,100%)` resolves
against the **backdrop's content box**, and the generic `.modal-backdrop
{padding:20px}` (css/modals.css) took 20px per side (375px viewport → 335px
modal); with the modal's own 18px padding and the scene card's inset the editor
sat 57px from each screen edge. Fix at the owner, in `css/editor.css`, on the
existing 760px phone breakpoint: `#allScenesModal.modal-backdrop{padding-left:
8px;padding-right:8px}`. The modal's 18px padding is deliberately unchanged
(sticky footer, toolbar and results rely on its `-18px` full-bleed).

| viewport | modal width / gutters before → after | editor edge gap before → after |
|---|---|---|
| 375×812 | 335 (20/20) → 359 (8/8) | 57 → 45 |
| 360×780 | 320 → 344 | 57 → 45 |
| 412×915 | 372 → 396 | 57 → 45 |

Unchanged: 768×1024 (modal 728, gutters 20) and 1280×800 (modal 1180) — above
the breakpoint; scrolling, `max-height:94vh`, the sticky footer (pinned, gap 0
while scrolled), card order/layout, rich text and Find/Replace. No page, modal
or backdrop horizontal overflow at any measured size.

Regression: a small block in `tools/mobile-text-scene-browser.test.mjs` pins
the exact Text Scene label triple + ids, one-line footer at 412px, the "Весь
текст" final-action wording, phone gutter 4–12px with modal ≥95% of the
viewport, no horizontal overflow, footer sticky after a genuine scroll (≥100px,
non-vacuous), and unchanged 1280/768 widths. Each half fails against `38d8636`
for its own reason (label; 20px gutters).

**Files changed:** `index.html`, `css/editor.css`,
`tools/mobile-text-scene-browser.test.mjs`, this doc.

## 47. Explicit confirmation (E3.2.10)

No Supabase changes, no migrations, `reference/` and `backup/` untouched. E4,
E6 and tablet work were not started. "Весь текст" was NOT redesigned — only its
phone-width gutter changed. Nothing was pushed or merged.

## 48. Stage E3.2.11 — "Весь текст" true edge-to-edge on phone + post-search bottom band

Real-phone validation overrode the E3.2.10 reading: the user wants **no outer
gutter at all** on the "Весь текст" shell (reading width matters more than a
decorative frame), and found a blank band above the sticky footer after a
cross-scene search navigation. Scope: those two things only; Text Scene, Full
Scene Editor, the splitter architecture, footer labels, toolbar, cards and
desktop/tablet were not touched.

### A. Edge-to-edge (outer gutter vs internal padding)

Measured owner of E3.2.10's remaining 8px: the **backdrop's horizontal
padding** (`.modal-backdrop{padding:20px}`, css/modals.css, reduced to 8px for
this modal by E3.2.10). The modal has no border, its inline
`width:min(1180px,100%)` resolves against the backdrop's content box, so the
backdrop padding is the sole owner of the outer strip. Fix (css/editor.css,
existing 760px breakpoint, scoped to `#allScenesModal` — the generic
`.modal-backdrop` padding is shared with other modals and is not touched):
`#allScenesModal.modal-backdrop{padding-left:0;padding-right:0}`.

Outer gutter ≠ content padding: the modal's own 18px padding and the scene
card's inset are **internal** content padding and were deliberately not
changed (the sticky footer, toolbar and results bleed via `-18px` margins
against that padding, so the footer now spans exactly the full-width shell, and
it is what keeps cards off the screen edge). Vertical padding, the 94vh cap and
the 14px corner radius are unchanged.

| viewport | E3.2.10 (backdrop pad / modal / gutters) | E3.2.11 | editor left inset |
|---|---|---|---|
| 360×780 | 8 / 344 / 8 | 0 / **360** / **0** | 45 → 37 |
| 375×812 | 8 / 359 / 8 | 0 / **375** / **0** | 45 → 37 |
| 412×915 | 8 / 396 / 8 | 0 / **412** / **0** | 45 → 37 |

Document, modal and backdrop horizontal overflow: 0 at every size (also 667×375).
768×1024 (modal 728, gutters 20) and 1280×800 (modal 1180) unchanged.

### B. Post-search bottom band (measured owner)

Real sequence exercised, not a synthetic final DOM: open All Text → Find →
«Весь проект» → tap a result in a later scene → the last scene → ↑/↓ buttons →
close Find (a key press after navigating would type into the focused editor).
Instrumented: modal scrollport, list, target card, editor, sticky controls,
footer, and every spacing declaration that could reserve space.

* The band is exactly **`.sticky-modal-footer{margin-top:16px}`**
  (css/modals.css): at the end of the list the last card ends, then 16px of
  modal background, then the footer. A navigation to the LAST scene scrolls to
  that end and exposes it (measured 15–16px blank run directly above the
  footer). Every other candidate is 0/`auto`: list margin/padding/min-height,
  last-card margin-bottom, modal `scroll-padding-bottom` — so **E3.2.9's
  Scene-Editor `scroll-padding`/`scroll-margin` rules do not leak into All Text**
  (they are `#sceneModal`-scoped; computed `auto`/`0`).
* It is not a Stage E regression: bisected on archived copies of `f007fc7b`
  (master, before Stage E), `9c5ef64`, `c2dcc39`, `fcf92df`, `2e0aec4`,
  `2fcaee4`, `d51a428` — identical (active card `[99,680]`, blank run 15) in
  every one. Nothing between the list and the footer changes with a global
  search; the same strip appears when the list is scrolled to its end by hand.
* The reveal path was checked, not changed: `revealDocPosition`/
  `scrollIntoView({block:"center"})` place the target match inside the visible
  window between the sticky controls and the footer (match 577–596 within
  411–696 on 375×812), so no reveal change was needed.

Fix (phone, this modal only): `#allScenesModal .modal-actions.sticky-modal-footer
{margin-top:0}`, so the last card meets the footer with no reserved band (the
footer stays sticky). Verified: blank run 0 before search, after navigation to a
non-last scene, after the last scene, after prev/next/wrap, after closing Find;
last card bottom == footer top; footer sticky and pinned; match revealed.
Scene Editor / Text Scene footers keep `margin-top:16px` (asserted).

**Limitation, stated plainly:** desktop Chromium cannot drive the Android
on-screen keyboard / `visualViewport` behaviour. An emulated keyboard (viewport
shrink) shows a different, larger problem — with the keyboard up the sticky
controls (toolbar + Find row + results pane) are taller than the whole modal
(`visibleForScene` −34px) — which is not the band reported and is out of scope
here. The regression therefore asserts the measured cause (the 16px footer
margin at the end of the list) and the resulting geometry; the exact phone
appearance still needs real-device validation.

### Tests

`tools/mobile-text-scene-browser.test.mjs` (existing E3.2.10 block, rewritten for
the new contract + extended): edge-to-edge (outer gutters ≤1px, modal width ==
viewport, no document/modal/backdrop overflow) at 360/375/412; internal 18px
padding preserved; the real search sequence above with a per-step assertion of
zero blank run, footer sticky/pinned and the target match inside the visible
window; non-vacuity checks (the list must genuinely reach its end; scenes must
actually change); Scene Editor footer margin unchanged. Baseline-failure proof:
on the `d51a428` CSS the edge-to-edge assertion fails with 8px gutters
(`modalW 396` at 412); with only the footer-margin rule removed the band
assertion fails with `blankRun 15`, `atEnd true`, `footerMarginTop 16px`.
Text Scene and Scene Editor shell/footer/editor rects identical between
`d51a428` and this stage (375×812).

### Real-device validation status

Pending: the exact Android band (see limitation) and edge-to-edge look on the
real phone.

**Files changed:** `css/editor.css`, `tools/mobile-text-scene-browser.test.mjs`,
this doc.

## 49. Explicit confirmation (E3.2.11)

No Supabase changes, no migrations, `reference/` and `backup/` untouched. E4, E6
and tablet work were not started. "Весь текст" was not redesigned: only its
phone outer gutter and its footer's top margin changed. Nothing was pushed or
merged.

## 50. Stage E3 closeout — canonical accepted state (E1 → E3.2.11)

This section consolidates what §§10–49 built, corrected and reverted into the
one description that is true **now**. It is not a diary: dead ends are listed
only as "do not re-try" boundaries. Where an older section disagrees, this one
wins. Phone means `max-width:760px` (the single breakpoint E1 reused; no new
breakpoint was introduced in E1–E3). Desktop (>760px) is behaviorally
unchanged by all of Stage E except where stated.

### 50.1 Accepted architecture, by stage

* **E1 — shell.** Desktop sidebar replaced by the `#mobileNavModal` drawer
  (tap chapter → `navigateToChapter`, tap scene → `openSceneText`); filter
  progressive disclosure; wrapped (never clipped) header; `.main-workspace`
  children reprioritized with CSS `order` (see 50.6).
* **E2.1 — Cards.** Single column on phone; card tap opens Text Scene
  (`handleCardPrimaryTap`), double-click still opens the Scene Editor;
  `.board.view-cards{min-width:0}` so Cards has no internal horizontal pan
  (Matrix keeps its own).
* **E2.2 — Quick Scene.** Text-first capture into a normal Scene
  (`chapter-unassigned`, `floating`, `draft`), title derived from the first
  line; no schema/RPC change. Introduced `.mobile-fullscreen-modal`, the one
  shared phone-fullscreen primitive (100dvh, no radius/margin; centered modal
  on desktop). Quick Scene, Text Scene and the Scene Editor all reuse it.
* **E3.1 — Text Scene (`#textModal`).** Fullscreen on phone; flex column with
  `flex:none` toolbar/footer and the manuscript as the single scrolling
  region. Footer, left to right: Закрыть / Сохранить и закрыть / Сохранить.
* **E3.2 — Full Scene Editor (`#sceneModal`).** Fullscreen on phone; the
  **hybrid** scroll model: the outer `#sceneModal .modal` scrolls metadata →
  title → participants; the manuscript is a bounded, independently scrolling
  box (`50dvh`). Footer: Отмена / Сохранить и закрыть / Сохранить.
* **"Весь текст" (`#allScenesModal`).** Phone: true edge-to-edge (backdrop
  horizontal padding 0, scoped to this modal; the modal's internal 18px
  padding stays because the sticky footer/toolbar/results bleed against it),
  and the sticky footer has `margin-top:0` so no blank band sits above it.
  Final actions: Закрыть / Сохранить и закрыть / Сохранить все изменения.

### 50.2 Find/Replace responsive contract (Text Scene and Scene Editor)

* Current-scene Find/Replace controls (toolbar + find row) live **outside**
  the manuscript budget: opening Find/Replace, in any scope, never shrinks the
  manuscript by itself. (E3.2.3 tried the opposite and was rejected on a real
  phone.)
* Project/global results share ONE bounded `.rte-manuscript-region` with the
  manuscript on **both** surfaces (Scene Editor `50dvh` box; Text Scene
  `flex:1` region). The splitter (`.rte-project-results-resizer`, Pointer
  Events + `setPointerCapture`, `touch-action:none`) moves height between
  results and manuscript in opposite directions with the region total
  invariant. Constants live in `js/editor/find-replace-panel.js`: results
  90/140/420 (min/default/max), `MANUSCRIPT_MIN_HEIGHT=140`;
  `effectiveMaxResultsHeight()` reads the region live (including the results
  wrapper's own margins — `getBoundingClientRect()` excludes margins) so the
  manuscript is never pushed below its 140px floor.
* Results horizontal scroll: exactly ONE element scrolls sideways,
  `.rte-project-results`; rows are `overflow:visible` and share one scroll
  canvas, every row spans the full canvas width, and the active row's
  outline/background covers the whole row. Tap on a row navigates; a drag that
  scrolls does not.
* Result navigation between scenes works on every surface (verified on the
  real phone, including project/global search across scenes).

### 50.3 Canonical principles (the "why" behind the CSS)

1. **Bounded region.** The [results + splitter + manuscript] region's height
   never changes during a drag and its contents never exceed it.
2. **Anchor invariance.** A splitter drag changes nothing outside the region:
   outer `scrollTop`, `window.scrollY` and the viewport position of anything
   above/below are unchanged (`overflow-anchor:none` on the scroller).
3. **Horizontal ownership.** One horizontal scroller in the results chain
   (above); the region itself is `overflow-x:clip`, not a scroll container.
4. **Scroll ownership per surface.** Text Scene: fixed-height flex column,
   the manuscript region is the only scroller. Scene Editor: the outer modal
   is the scroller, the manuscript a bounded inner scroller. "Весь текст": the
   modal scrolls the scene list. Never two competing scrollers for the same
   axis on the same gesture.
5. **Sticky footer is unconditional.** `.modal-actions.sticky-modal-footer`
   (`css/modals.css`, `position:sticky;bottom:-18px`) stays sticky in every
   Find/Replace state of the Scene Editor (Text Scene's footer is a static
   flex child of its own fixed column). Do not switch it to `static` to
   "make room" for anything; instead the phone rules
   `#sceneModal .modal{scroll-padding-bottom:80px}` and
   `#sceneModal .rte-find-replace input{scroll-margin-bottom:50dvh}` make the
   browser's own focus-scroll land the results/splitter clear of it.
6. **Save semantics (D2.1.2).** "Сохранить" is save-only — it persists,
   re-baselines the dirty tracker and keeps the modal open; only
   "Сохранить и закрыть" closes, and only after a successful save. Both are
   disabled while the surface is clean (`createSaveButtonController`). Close/
   discard still goes through the guarded `requestCloseModal` path.
7. **Fix at the owner, measured.** Every E3.2.x fix followed a runtime
   measurement of the actual owner (bisecting archived copies of earlier
   commits where needed), not a reading of the CSS. Phone rules that must beat
   an ID-scoped rule use cascade order on the same selector inside the phone
   media block; only the fullscreen primitive uses `!important`.

### 50.4 Implementation boundaries discovered during E3 (do not re-try)

* Do not make the manuscript and Find/Replace chrome share one budget (E3.2.3);
  only the results pane trades height with the manuscript.
* Do not auto-scroll to reveal the splitter (E3.2.5) and do not make the footer
  `static` while results are visible (`:has()` rule of E3.2.6, removed in
  E3.2.9) — both were shown not to fix, or to cause, the defects they targeted.
* Do not give result rows their own horizontal scrollers (E3.1.1 → E3.1.2).
* Do not leave the manuscript unbounded inside the Scene Editor's outer scroll
  (E3.2 → E3.2.1): it makes reaching the participants a novel-length scroll.
* Desktop CDP/Playwright cannot drive the Android on-screen keyboard or
  `visualViewport`; keyboard-open layout is confirmable only on a device. A
  synthetic `element.click()` does not fire `mousedown` (the focus-target
  capture in `scene-editor-controller.js`); tests must use real taps/clicks.
* `crypto.randomUUID` is absent on insecure (LAN-HTTP) origins; the fallback
  from E3.2.1 is required for on-device testing.

### 50.5 Real-device status and test status at closeout

The product owner verified the final behavior on a real Android phone: Scene
Editor, Text Scene, Find/Replace, the splitter, the sticky footer, "Весь
текст" and its edge-to-edge layout, project/global search navigation between
scenes, and the absence of the bottom blank band. This supersedes the
"pending real-device validation" notes in §§42–48.

Editor browser-test debt closed in this closeout: `scene-rich-text-editor`,
`scene-modal-rich-text` and `all-scenes-rich-text` had been failing since the
D2.1.2 save-only change (and the disabled-when-clean Save buttons) because
they still asserted that "Сохранить" closes the modal and that a no-edit Save
can be clicked. They were **stale tests, not application defects**; they now
assert the current contract (save-only keeps the modal open, re-baselines the
tracker, disables Save, and Close afterwards needs no discard prompt;
"Сохранить и закрыть" closes; a no-edit `saveAllScenes()` writes nothing).
No production code changed.

Every other browser suite that exercises an E3 surface passes
(`mobile-*`, `quick-scene`, `find-replace-*`, `scene-participants`,
`scene-modal-scroll`, and the three above). Of 69 browser suites, 15 remain
red at closeout; **all 15 fail identically against the pre-Stage-E baseline
`f007fc7`** and none tests an E3 contract. They are historical debt, left
untouched:

* Cloud/real-login suites (`cloud-browser`, `cloud-project-structure`,
  `scene-search-filter-cloud`, `scene-chronology-cloud`, `stale-warning-clear`,
  `location-media-profile`) need a live backend/credentials.
* Location suites: `location-manual-review-layout-stability` (page closes
  mid-run).
* Other stale-contract suites in unrelated feature areas:
  `character-surfaces-visual-system`, `scene-position-*` (×2), `blocking`,
  `scene-chronology`.
* Several share the save-only / disabled-when-clean root cause of 50.5 (a
  save click is expected to close a modal that no longer closes, or a disabled
  Save is focused): `dirty-browser` («Весь текст» step), `scene-chronology*`,
  `scene-surfaces-visual-system`, and the focus-trap step of
  `accessibility-browser`. A single mechanical pass over them is a sensible
  future chore; it is not E3 work.
* `accessibility-browser` also has one Stage-E-introduced first failure:
  `#quickSceneModal` names itself with `aria-label` where the suite (and every
  other modal) uses `aria-labelledby`. It has an accessible name, so AGENTS.md
  is satisfied; making it consistent (`aria-labelledby="quickSceneModalTitle"`)
  belongs to E4's modal work. The suite would stay red regardless (it already
  fails at the focus-trap step on `f007fc7`).

Note: many browser suites expect a dev server already listening on
`127.0.0.1:8000` (`node tools/server.mjs`); without one they fail with
`ERR_CONNECTION_REFUSED`, which is an environment artifact, not debt.

### 50.6 Remaining responsive debt — belongs to later stages

* **E4 — Mobile modal foundation & remaining modals.** The fullscreen
  primitive exists only for Quick Scene / Text Scene / Scene Editor; every
  other modal is still an ordinary centered desktop modal on phone
  (bottom-sheet/fullscreen policy, modal-manager support). Also: give
  `#quickSceneModal` `aria-labelledby` like every other modal (50.5).
* **E5 — Secondary work surfaces.** Characters, Locations, Projects/management
  surfaces; Table and Compact views (still desktop-shaped); header
  information density and empty-project onboarding (§11).
* **E6 — Responsive polish & cross-device regression.**
  * Visual order vs DOM/tab order: parts of the mobile workspace reorder with
    CSS `order` (E1's `.main-workspace` children). At E1.1 the three moved
    regions contained no focusable elements (no tab-order effect, only a
    linear screen-reader sequence nicety, §11); re-check whenever a reordered
    region gains interactive content and settle it with the final mobile IA.
  * Landscape / short-height / keyboard-constrained viewports: classification
    by width alone is insufficient (§28); `.modal-grid-4` is still two columns
    at 667px, and an expanded project Find/Replace leaves very little
    manuscript height in landscape (§20 — a compact Find/Replace state is
    the likely direction, not yet designed).
  * "Весь текст" with an emulated on-screen keyboard: the sticky stack
    (toolbar + Find row + results) can exceed the shrunken modal (§48-B
    limitation). Seen only in desktop viewport emulation, **not reproduced on
    the real phone**; not treated as a defect — revisit only with real-device
    evidence.
  * At 360–390px «Сохранить и закрыть» wraps to two lines in the footers (§46).
* **E7–E9 — personalization.** Later; nothing in E1–E3 anticipates it.

### 50.7 Explicit confirmation (E3 closeout)

Documentation and test-only change. No production JS/CSS/HTML changed, no
Supabase/migration/persistence changes, `reference/` and `backup/` untouched,
E4 not started, nothing pushed or merged.
