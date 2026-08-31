// Local review badge. Renders ONLY when tools/server.mjs answers /__review-meta
// (i.e. `npm run review` / node tools/server.mjs on localhost). On any other
// origin — GitHub Pages, a plain static host, a real user — that fetch 404s or
// errors, this exits early, and nothing is added to the page.
(async () => {
  let meta;
  try {
    const response = await fetch("/__review-meta", { cache: "no-store" });
    if (!response.ok) return;
    meta = await response.json();
  } catch {
    return;
  }
  if (!meta || meta.tool !== "author-workspace-review") return;

  const branch = meta.branch || "unknown";
  const commit = meta.commit || "unknown";
  const dirtySuffix = meta.dirty ? " · DIRTY" : "";

  const badge = document.createElement("div");
  badge.id = "localReviewBadge";
  badge.textContent = `LOCAL · ${branch} · ${commit}${dirtySuffix}`;
  badge.title = `branch: ${branch}\ncommit: ${commit}${meta.dirty ? "\nworking tree has uncommitted changes" : ""}`;
  badge.setAttribute("aria-hidden", "true");
  Object.assign(badge.style, {
    position: "fixed",
    insetBlockEnd: "8px",
    insetInlineEnd: "8px",
    zIndex: "2147483647",
    background: "rgba(20,20,24,0.82)",
    color: "#e8e8ec",
    font: "11px/1.4 -apple-system,Segoe UI,sans-serif",
    padding: "3px 8px",
    borderRadius: "4px",
    pointerEvents: "none",
    maxWidth: "40vw",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    userSelect: "none"
  });
  document.body.appendChild(badge);
})();
