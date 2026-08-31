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
let pinnedHeadAnchor=null; // {node}
let pinnedChapterAnchor=null; // {node,parent,nextSibling}
let matrixStickyRaf=null;

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
}

function restorePinnedChapter(){
  if(!pinnedChapterAnchor)return;
  const {node,parent,nextSibling}=pinnedChapterAnchor;
  if(parent&&parent.isConnected){
    if(nextSibling&&nextSibling.parentNode===parent)parent.insertBefore(node,nextSibling);
    else parent.appendChild(node);
  }
  pinnedChapterAnchor=null;
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
    if(pinnedHeadAnchor&&board){board.prepend(pinnedHeadAnchor.node);pinnedHeadAnchor=null}
    restorePinnedChapter();
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
    if(pinnedHeadAnchor){board.prepend(pinnedHeadAnchor.node);pinnedHeadAnchor=null}
    restorePinnedChapter();
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
    headScroll.appendChild(realHead);
    pinnedHeadAnchor={node:realHead};
  }
  if(!matrixStickySyncingScroll&&headScroll.scrollLeft!==viewport.scrollLeft)headScroll.scrollLeft=viewport.scrollLeft;

  // Current chapter = last divider whose natural (in-flow) position has
  // already scrolled above the header row's bottom edge. Restore whichever
  // divider is currently parked before remeasuring — its own rect isn't
  // meaningful while it's sitting inside the fixed overlay.
  restorePinnedChapter();
  const headRowHeight=headScroll.getBoundingClientRect().height;
  const chapterThreshold=threshold+headRowHeight;
  const dividers=[...board.querySelectorAll(":scope > .insert-row[data-chapter-id]")];
  let current=null;
  for(const div of dividers){
    if(div.getBoundingClientRect().top<=chapterThreshold)current=div;
    else break;
  }
  if(current){
    pinnedChapterAnchor={node:current,parent:current.parentElement,nextSibling:current.nextSibling};
    chapterRow.style.setProperty("--cols",cols);
    chapterRow.appendChild(current);
    chapterRow.hidden=false;
  }else{
    chapterRow.hidden=true;
  }
}

Object.assign(globalThis,{updateMatrixSticky,scheduleMatrixStickyUpdate,discardMatrixStickyBeforeRerender});
export {updateMatrixSticky,scheduleMatrixStickyUpdate,discardMatrixStickyBeforeRerender};
