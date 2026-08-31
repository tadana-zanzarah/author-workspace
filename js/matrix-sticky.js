// Table-view matrix: a two-row sticky context bar (character headers, then the
// current chapter) plus a horizontal scroll rail pinned near the viewport
// bottom — both position:fixed overlays driven from here, not native CSS
// position:sticky and not a nested vertical scroll container.
//
// Why not native sticky: .viewport has overflow-x:auto (css/timeline.css) and
// no explicit overflow-y, and per the CSS Overflow spec a non-visible overflow-x
// paired with a visible overflow-y computes that other axis to auto too — so
// .viewport is *itself* a scroll container on both axes, and becomes the
// containing block for any position:sticky descendant. But .viewport never
// scrolls internally (its content never exceeds its own height — the page
// scrolls instead, by design; see the comment on .viewport in timeline.css),
// so its scrollTop never changes and a sticky child has nothing to react to —
// confirmed by measuring .board-head's rect while scrolling the page: it moves
// 1:1 with scroll instead of pinning. Reintroducing internal vertical scroll to
// fix that is explicitly out of scope (this app deliberately uses natural page
// scroll for the matrix).
//
// Why not just clone the header/chapter content: cloning risks the overlay
// silently going stale relative to the live DOM (re-renders, click handlers).
// Instead the REAL .board-head node and the REAL current chapter-divider node
// are physically relocated into the fixed overlay while pinned, and moved back
// to their original spot once no longer relevant — same element, same
// listeners, always in sync, nothing to keep in sync by hand.

let matrixOverlayEls=null;
let matrixRailEls=null;
let matrixStickySyncingScroll=false;
let pinnedHeadAnchor=null; // {node,spacer}
let pinnedChapterAnchor=null; // {node,spacer}
let matrixStickyRaf=null;

// Natural (fully in-flow) top offset of every chapter divider, relative to
// #board's own top edge — used to decide which chapter is "current" without
// remeasuring the DOM on every scroll tick. Rebuilt only when marked dirty (a
// fresh render or a resize), never on a plain scroll tick or a chapter
// transition: the previous design remeasured every divider's live
// getBoundingClientRect() on EVERY scroll frame, which first required
// restoring (reinserting) whatever divider was currently parked in the fixed
// overlay so its rect would be meaningful again — i.e. two forced
// layout-invalidating DOM writes to a several-hundred-cell CSS grid, every
// single animation frame of a scroll. That's the "jerky/sticky/jumps" scroll
// bug from local review. Pinning now leaves an exact-height spacer behind
// (see pinChapterDivider below) so removing the real node from flow never
// changes #board's total height — the cached offsets stay valid the whole
// time a chapter is pinned, and a transition is a single reparent, not a
// remeasure-the-world.
let chapterOffsetCache=[]; // [{node,top}]
let chapterOffsetsDirty=true;
// Row heights (hence divider offsets) can change on resize (text reflow at a
// new width) without any render happening — invalidate so the next tick
// rebuilds instead of trusting stale cached offsets.
window.addEventListener("resize",()=>{chapterOffsetsDirty=true});

function ensureMatrixOverlayEls(){
  if(matrixOverlayEls)return matrixOverlayEls;
  const overlay=document.createElement("div");
  overlay.className="matrix-sticky-overlay";
  overlay.hidden=true;
  const headScroll=document.createElement("div");
  headScroll.className="matrix-sticky-head-scroll";
  const chapterRow=document.createElement("div");
  chapterRow.className="matrix-sticky-chapter-row";
  overlay.append(headScroll,chapterRow);
  document.body.appendChild(overlay);
  matrixOverlayEls={overlay,headScroll,chapterRow};
  return matrixOverlayEls;
}

function ensureMatrixRailEls(){
  if(matrixRailEls)return matrixRailEls;
  const rail=document.createElement("div");
  rail.className="matrix-scroll-rail";
  rail.hidden=true;
  const spacer=document.createElement("div");
  spacer.className="matrix-scroll-rail-spacer";
  rail.appendChild(spacer);
  document.body.appendChild(rail);
  rail.addEventListener("scroll",()=>{
    if(matrixStickySyncingScroll)return;
    const viewport=document.querySelector(".viewport.workspace-viewport");
    if(!viewport)return;
    matrixStickySyncingScroll=true;
    viewport.scrollLeft=rail.scrollLeft;
    matrixStickySyncingScroll=false;
  },{passive:true});
  matrixRailEls={rail,spacer};
  return matrixRailEls;
}

// Drops any currently-relocated head/chapter node without trying to restore
// its original position — called right before the table view is about to
// throw away and rebuild #board's whole subtree (a fresh .board-head/chapter
// divider is coming in the new markup, so the old, now-orphaned one must not
// linger inside the overlay as a stale duplicate).
function discardMatrixStickyBeforeRerender(){
  if(pinnedHeadAnchor){pinnedHeadAnchor.node.remove();pinnedHeadAnchor=null}
  if(pinnedChapterAnchor){pinnedChapterAnchor.node.remove();pinnedChapterAnchor=null}
  if(matrixOverlayEls)matrixOverlayEls.overlay.hidden=true;
  if(matrixRailEls)matrixRailEls.rail.hidden=true;
  chapterOffsetCache=[];
  chapterOffsetsDirty=true;
}

// Rebuilds chapterOffsetCache from the dividers' real, natural-flow positions.
// Only called when dirty (a fresh render or a resize — see the two callers),
// never from a plain scroll tick or a pin/unpin transition. Temporarily
// restores any currently-pinned divider first: while pinned its own rect is
// meaningless (it's sitting in the fixed overlay), so this is the one place
// that still pays a restore+remeasure+re-pin round trip, and only on those
// rare triggers, not on every scroll frame.
function rebuildChapterOffsetCache(board,chapterRow,cols){
  const wasPinned=pinnedChapterAnchor?pinnedChapterAnchor.node:null;
  if(wasPinned)restorePinnedChapter();
  const boardTop=board.getBoundingClientRect().top;
  chapterOffsetCache=[...board.querySelectorAll(":scope > .insert-row[data-chapter-id]")]
    .map(node=>({node,top:node.getBoundingClientRect().top-boardTop}));
  chapterOffsetsDirty=false;
  if(wasPinned)pinChapterDivider(wasPinned,chapterRow,cols);
}

// Removes node from #board's normal flow and parks it inside chapterRow (the
// fixed overlay), leaving an exact-height spacer in its old spot so #board's
// total height — and therefore every row's position below it — never
// changes. That's what makes a chapter transition a single, isolated reparent
// instead of a layout shift the user can see mid-scroll.
function pinChapterDivider(node,chapterRow,cols){
  const height=node.getBoundingClientRect().height;
  const spacer=document.createElement("div");
  spacer.className="insert-row-spacer";
  spacer.style.height=`${height}px`;
  node.parentNode.insertBefore(spacer,node);
  chapterRow.style.setProperty("--cols",cols);
  chapterRow.appendChild(node);
  pinnedChapterAnchor={node,spacer};
}

function restorePinnedChapter(){
  if(!pinnedChapterAnchor)return;
  const {node,spacer}=pinnedChapterAnchor;
  if(spacer.parentNode)spacer.parentNode.insertBefore(node,spacer);
  spacer.remove();
  pinnedChapterAnchor=null;
}

// Same exact-height-spacer technique as pinChapterDivider, for the character
// header row: .board-head is always #board's first child, so restoring means
// putting it back before the spacer (which is sitting where it left off).
function pinBoardHead(node,headScroll){
  const height=node.getBoundingClientRect().height;
  const spacer=document.createElement("div");
  spacer.className="board-head-spacer";
  spacer.style.height=`${height}px`;
  node.parentNode.insertBefore(spacer,node);
  headScroll.appendChild(node);
  pinnedHeadAnchor={node,spacer};
}

function restorePinnedHead(){
  if(!pinnedHeadAnchor)return;
  const {node,spacer}=pinnedHeadAnchor;
  if(spacer.parentNode)spacer.parentNode.insertBefore(node,spacer);
  spacer.remove();
  pinnedHeadAnchor=null;
}

function scheduleMatrixStickyUpdate(){
  if(matrixStickyRaf)return;
  matrixStickyRaf=requestAnimationFrame(()=>{matrixStickyRaf=null;updateMatrixSticky()});
}

function updateMatrixSticky(){
  const viewport=document.querySelector(".viewport.workspace-viewport");
  const board=document.getElementById("board");
  const {overlay,headScroll,chapterRow}=ensureMatrixOverlayEls();
  const {rail,spacer}=ensureMatrixRailEls();
  if(currentView!=="table"||!viewport||!board){
    overlay.hidden=true;rail.hidden=true;
    if(pinnedHeadAnchor)restorePinnedHead();
    restorePinnedChapter();
    chapterOffsetCache=[];chapterOffsetsDirty=true;
    return;
  }
  const header=document.querySelector("header");
  const threshold=header?header.getBoundingClientRect().bottom:0;
  const vpRect=viewport.getBoundingClientRect();
  const inView=vpRect.top<window.innerHeight&&vpRect.bottom>0;
  const cols=String(data.characters.length);

  // ---- horizontal scroll rail ----
  const hasOverflow=board.scrollWidth-viewport.clientWidth>2;
  const railVisible=inView&&hasOverflow&&vpRect.bottom>threshold+20&&vpRect.top<window.innerHeight;
  rail.hidden=!railVisible;
  if(railVisible){
    rail.style.left=`${Math.round(vpRect.left)}px`;
    rail.style.width=`${Math.round(vpRect.width)}px`;
    rail.style.bottom="0px";
    spacer.style.width=`${board.scrollWidth}px`;
    if(!matrixStickySyncingScroll&&Math.abs(rail.scrollLeft-viewport.scrollLeft)>1){
      matrixStickySyncingScroll=true;rail.scrollLeft=viewport.scrollLeft;matrixStickySyncingScroll=false;
    }
  }

  // ---- sticky head + chapter overlay ----
  const shouldPin=inView&&vpRect.top<threshold&&vpRect.bottom>threshold;
  if(!shouldPin){
    overlay.hidden=true;
    if(pinnedHeadAnchor)restorePinnedHead();
    // No need to mark the offset cache dirty here: pinChapterDivider leaves an
    // exact-height spacer behind, so the cached natural-flow offsets stay
    // accurate the whole time anything is pinned/unpinned — restoring is just
    // a plain reparent, not a remeasure trigger.
    if(pinnedChapterAnchor)restorePinnedChapter();
    return;
  }
  overlay.hidden=false;
  overlay.style.left=`${Math.round(vpRect.left)}px`;
  overlay.style.width=`${Math.round(vpRect.width)}px`;
  overlay.style.top=`${Math.round(threshold)}px`;
  headScroll.style.width=`${Math.round(vpRect.width)}px`;
  headScroll.style.setProperty("--cols",cols);

  const realHead=pinnedHeadAnchor?pinnedHeadAnchor.node:board.querySelector(":scope > .board-head");
  if(realHead&&headScroll!==realHead.parentElement){
    pinBoardHead(realHead,headScroll);
  }
  if(!matrixStickySyncingScroll&&headScroll.scrollLeft!==viewport.scrollLeft)headScroll.scrollLeft=viewport.scrollLeft;

  // Current chapter = last divider whose natural (in-flow) position has
  // already scrolled above the header row's bottom edge. Looked up against
  // chapterOffsetCache (cheap arithmetic against a live boardTop read) rather
  // than by remeasuring every divider's own rect each frame — see the cache's
  // declaration comment above for why that used to cause scroll jitter.
  if(chapterOffsetsDirty)rebuildChapterOffsetCache(board,chapterRow,cols);
  const headRowHeight=headScroll.getBoundingClientRect().height;
  const chapterThreshold=threshold+headRowHeight;
  const boardTop=board.getBoundingClientRect().top;
  let current=null;
  for(const entry of chapterOffsetCache){
    if(boardTop+entry.top<=chapterThreshold)current=entry;
    else break;
  }
  if(current){
    if(!pinnedChapterAnchor||pinnedChapterAnchor.node!==current.node){
      if(pinnedChapterAnchor)restorePinnedChapter();
      pinChapterDivider(current.node,chapterRow,cols);
    }
    chapterRow.hidden=false;
  }else{
    if(pinnedChapterAnchor)restorePinnedChapter();
    chapterRow.hidden=true;
  }
}

Object.assign(globalThis,{updateMatrixSticky,scheduleMatrixStickyUpdate,discardMatrixStickyBeforeRerender});
export {updateMatrixSticky,scheduleMatrixStickyUpdate,discardMatrixStickyBeforeRerender};
