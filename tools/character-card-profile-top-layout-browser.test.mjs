// Regression coverage for the fix/character-card-profile-top-layout branch:
// Character Gallery card composition (1/3 photo · 2/3 info, fixed
// stats/actions with only the info region scrolling, aligned statistics
// across cards, non-emoji chronology icon) and the Character Profile top
// area (photo strip + save-scope sharing one compact region instead of two
// stacked cards, so "Личность" fields land in the first viewport). Deep
// coverage for combobox behavior, structural links CRUD, and crop geometry
// already exists in sibling *-browser.test.mjs files — this file checks only
// what changed on this branch.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8047,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});

const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const dataUrl=`data:image/png;base64,${png}`;
const linkTargets=Array.from({length:14},(_,i)=>({id:`layout-link-target-${i}`,name:`Персонаж №${i+1}`,sortOrder:5000+i*10}));
const project={
  version:11,
  characters:[
    {id:"layout-a",name:"Рене",sortOrder:1000},
    {id:"layout-onephoto",name:"Марго",sortOrder:1200},
    {id:"layout-long",name:"Связная Идалия",sortOrder:1400},
    ...linkTargets
  ],
  profiles:{
    "layout-a":{id:"layout-a",characterId:"layout-a",name:"Рене",race:"Человек",hidden:{}},
    "layout-onephoto":{
      id:"layout-onephoto",characterId:"layout-onephoto",name:"Марго",race:"Эльф",
      photos:[{id:"photo-one",source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""}],
      primaryPhotoId:"photo-one",hidden:{}
    },
    "layout-long":{
      id:"layout-long",characterId:"layout-long",name:"Связная Идалия",race:"Человек",build:"Атлетическое",
      description:"Очень длинное описание персонажа, повторяемое несколько раз, чтобы гарантированно превысить бюджет высоты карточки и вызвать внутреннюю прокрутку информационной области. ".repeat(6),
      photos:[
        {id:"photo-long-1",source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""},
        {id:"photo-long-2",source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""}
      ],
      primaryPhotoId:"photo-long-1",hidden:{}
    },
    ...Object.fromEntries(linkTargets.map(c=>[c.id,{id:c.id,characterId:c.id,name:c.name,hidden:{}}]))
  },
  characterLinks:linkTargets.map((c,i)=>({id:`layout-link-${i}`,fromCharacterId:"layout-long",toCharacterId:c.id,category:"other",type:"custom",reverseType:"custom",customLabel:`Связь ${i+1}`,reverseCustomLabel:`Обратная связь ${i+1}`})),
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(6000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(value=>{if(sessionStorage.getItem("layout-fix-seeded"))return;sessionStorage.setItem("layout-fix-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.click("#projectMenu > summary");await page.click("#manageChars");
  await page.waitForSelector("#charsModal",{state:"visible"});

  // ================= GALLERY =================
  {
    const geometry=await page.evaluate(()=>[...document.querySelectorAll(".profile-card")].map(c=>{
      const rect=c.getBoundingClientRect(),cover=c.querySelector(".profile-cover").getBoundingClientRect();
      return {id:c.dataset.characterId,cardH:rect.height,coverH:cover.height,ratio:cover.height/rect.height};
    }));

    // 1+2. Photo reads as roughly the upper third of the card; info clearly
    // owns the majority of the remaining height (not a photo tile with a
    // cramped footer).
    for(const g of geometry){
      if(g.ratio<0.22||g.ratio>0.48)throw new Error(`Photo/card ratio not "roughly a third" for ${g.id}: ${g.ratio}`);
      if(g.coverH>=g.cardH-g.coverH)throw new Error(`Info region does not dominate card height for ${g.id}: cover=${g.coverH} info=${g.cardH-g.coverH}`);
    }

    // 3. Cards in the same row align to the same height.
    const heights=geometry.map(g=>Math.round(g.cardH));
    if(new Set(heights).size!==1)throw new Error(`Gallery cards are not the same height: ${JSON.stringify(heights)}`);

    const longCard=page.locator('.profile-card[data-character-id="layout-long"]');
    const shortCard=page.locator('.profile-card[data-character-id="layout-a"]');

    // 4. Only .profile-card-scroll scrolls on the long-content card; the
    // outer card itself does not.
    const scrollState=await longCard.evaluate(el=>{
      const scroller=el.querySelector(".profile-card-scroll");
      return {
        cardOverflowsSelf:el.scrollHeight>el.clientHeight+1,
        infoScrollable:scroller.scrollHeight>scroller.clientHeight+1
      };
    });
    if(scrollState.cardOverflowsSelf)throw new Error("The outer card itself overflows/scrolls — only .profile-card-scroll should");
    if(!scrollState.infoScrollable)throw new Error("Long-content card's info region did not need to scroll — fixture too small to exercise this check");

    // 5+6. Statistics and the action footer stay visually fixed while the
    // info region's scrollTop changes.
    const before=await longCard.evaluate(el=>({
      stats:el.querySelector(".profile-auto").getBoundingClientRect().top,
      actions:el.querySelector(".profile-card-actions").getBoundingClientRect().top
    }));
    await longCard.evaluate(el=>{el.querySelector(".profile-card-scroll").scrollTop=9999});
    const after=await longCard.evaluate(el=>({
      stats:el.querySelector(".profile-auto").getBoundingClientRect().top,
      actions:el.querySelector(".profile-card-actions").getBoundingClientRect().top
    }));
    if(Math.abs(before.stats-after.stats)>0.5)throw new Error(`Statistics moved while info scrolled: ${before.stats} -> ${after.stats}`);
    if(Math.abs(before.actions-after.actions)>0.5)throw new Error(`Action footer moved while info scrolled: ${before.actions} -> ${after.actions}`);

    // 7. Statistics sit at the same offset-from-card-top for a short card and
    // the long/overflowing card.
    const statsOffset=async locator=>locator.evaluate(el=>el.querySelector(".profile-auto").getBoundingClientRect().top-el.getBoundingClientRect().top);
    const longOffset=await statsOffset(longCard),shortOffset=await statsOffset(shortCard);
    if(Math.abs(longOffset-shortOffset)>1)throw new Error(`Statistics offset differs between short and long cards: ${shortOffset} vs ${longOffset}`);

    // 8. Long structural links remain reachable via the info scroll (last
    // link text is present once scrolled to the bottom).
    const structuralText=await longCard.locator(".profile-structural-summary").textContent();
    if(!structuralText.includes(`Обратная связь ${linkTargets.length}`))throw new Error("Last structural link not reachable in the scrolled info region");

    // 9. No nested scroller inside stats/actions/structural-links.
    const nested=await longCard.evaluate(el=>{
      const targets=[".profile-auto",".profile-card-actions",".profile-structural-summary"];
      return targets.map(sel=>{
        const node=el.querySelector(sel);
        return {sel,overflowing: node? node.scrollHeight>node.clientHeight+1 : false};
      });
    });
    for(const n of nested)if(n.overflowing)throw new Error(`Unexpected nested scroll inside ${n.sel}`);

    // 10. Chronology action uses a non-emoji inline SVG icon.
    const chronologyBtn=longCard.locator('button[aria-label^="Личная хронология"]');
    const iconInfo=await chronologyBtn.evaluate(btn=>({hasSvg:!!btn.querySelector("svg"),text:btn.textContent}));
    if(!iconInfo.hasSvg)throw new Error("Chronology action has no SVG icon");
    if(iconInfo.text.includes("\u{1F550}"))throw new Error("Chronology action still uses the old clock emoji");
    if(await chronologyBtn.getAttribute("aria-label")!=="Личная хронология: Связная Идалия")throw new Error("Chronology aria-label regressed");
    if(await chronologyBtn.getAttribute("title")!=="Личная хронология")throw new Error("Chronology title regressed");

    // 11. Chronology action still opens the character timeline.
    await chronologyBtn.click();
    await page.waitForSelector("#characterTimelineModal",{state:"visible"});
    const timelineTitle=await page.locator("#characterTimelineTitle").textContent();
    if(!timelineTitle.includes("Связная Идалия"))throw new Error(`Chronology modal did not open for the right character: ${timelineTitle}`);
    await page.click("#closeCharacterTimeline");
    await page.waitForSelector("#characterTimelineModal",{state:"hidden"});
  }

  // ================= PROFILE TOP =================
  // Superseded by the design/character-profile-resume-layout branch: the
  // photo-strip + save-scope shared header this file originally checked was
  // replaced by a character résumé header (photo + name/birth facts) with
  // save-scope moved to the sticky footer as a radio choice. See
  // tools/character-profile-resume-layout-browser.test.mjs for the dedicated
  // suite; this block keeps only what is still true (compact header region,
  // first-viewport fields, photo-tile geometry, photo-management actions).
  {
    await page.locator('.profile-card[data-character-id="layout-long"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});

    // 13. Photo + identity fields live inside one compact resume header
    // region, not stacked full-width cards; save-scope is not part of it.
    const headerInfo=await page.evaluate(()=>{
      const header=document.querySelector(".profile-resume");
      const photo=document.querySelector(".profile-resume-photo");
      return {
        hasHeader:!!header,
        display:header?getComputedStyle(header).display:null,
        photoWidth:photo.getBoundingClientRect().width,
        modalWidth:document.getElementById("profileEditorModal").getBoundingClientRect().width,
        scopeInsideHeader:!!header.querySelector("#cloudProfileScope")
      };
    });
    if(!headerInfo.hasHeader)throw new Error("Compact .profile-resume header region is missing");
    if(headerInfo.display!=="flex")throw new Error(`Resume header is not a single flex region: display=${headerInfo.display}`);
    if(headerInfo.scopeInsideHeader)throw new Error("Save-scope control is still inside the resume header — it must live in the sticky footer");

    // 15. A single/couple photos do not stretch the photo column to the
    // full modal width (no large empty space beside the portrait).
    if(headerInfo.photoWidth>headerInfo.modalWidth*0.6)throw new Error(`Photo column stretched too wide for its content: ${headerInfo.photoWidth} of ${headerInfo.modalWidth}`);

    // 12. Save-scope now lives in the sticky footer, not the resume header.
    const footerInfo=await page.evaluate(()=>{
      document.getElementById("cloudProfileScope").hidden=false;
      const footer=document.querySelector(".profile-modal-actions");
      const scope=document.getElementById("cloudProfileScope");
      return {scopeInsideFooter:footer.contains(scope),radios:[...document.querySelectorAll('input[name="profileSaveScope"]')].length};
    });
    if(!footerInfo.scopeInsideFooter)throw new Error("Save-scope control is not inside the sticky footer (.profile-modal-actions)");
    if(footerInfo.radios!==2)throw new Error(`Expected 2 save-scope radio options, found ${footerInfo.radios}`);
    await page.evaluate(()=>{document.getElementById("cloudProfileScope").hidden=true});

    // 14. First profile fields land well within the first viewport (this
    // branch's whole point — the old layout pushed "Личность" far down
    // behind two large stacked "Изменения персонажа"/"Фото и визуализации"
    // cards).
    const nameFieldTop=await page.locator("#pf_name").evaluate(el=>el.getBoundingClientRect().top);
    if(nameFieldTop>460)throw new Error(`First profile field (#pf_name) is not within the first viewport: top=${nameFieldTop}`);

    // 16. The primary portrait tile ends at its own content height: no
    // leftover space below the image + shared action row (superseded the
    // old per-thumbnail geometry check — secondary tiles are now plain
    // thumbnails with no action row of their own; see
    // character-profile-resume-layout-browser.test.mjs for the dedicated
    // photo-composition suite).
    const primaryGeometry=await page.evaluate(()=>{
      const item=document.querySelector(".photo-item-primary");
      const img=item.querySelector("img"),actions=item.querySelector(".photo-actions");
      const style=getComputedStyle(item);
      return {
        itemHeight:item.getBoundingClientRect().height,
        contentHeight:img.getBoundingClientRect().height+actions.getBoundingClientRect().height,
        borderTop:parseFloat(style.borderTopWidth),borderBottom:parseFloat(style.borderBottomWidth)
      };
    });
    const primarySlack=primaryGeometry.itemHeight-(primaryGeometry.contentHeight+primaryGeometry.borderTop+primaryGeometry.borderBottom);
    if(Math.abs(primarySlack)>1.5)throw new Error(`Primary photo tile has leftover space below its content: ${JSON.stringify(primaryGeometry)}`);

    // 17. Upload/preview/crop/make-primary/delete still work from the
    // resume photo column: selecting a thumbnail makes it the active photo,
    // then the single shared action row operates on it.
    const photosGrid=page.locator("#profilePhotosGrid");
    await page.locator('.photo-thumb[data-photo-id="photo-long-2"]').click();
    await photosGrid.getByRole("button",{name:"Сделать главным"}).click();
    if(!await page.locator('.photo-item-primary[data-photo-id="photo-long-2"] .photo-primary').count())throw new Error("Make-primary no longer works from the resume photo column");
    await page.locator('.photo-thumb[data-photo-id="photo-long-1"]').click();
    await page.locator('[data-action="crop-photo"]').click();
    await page.waitForSelector("#photoCropModal",{state:"visible"});
    await page.click("#cancelPhotoCrop");
    await page.waitForSelector("#photoCropModal",{state:"hidden"});
    await page.locator('[data-action="view-photo"]').click();
    await page.waitForSelector("#photoLightboxModal",{state:"visible"});
    await page.click("#closePhotoLightbox");
    await page.waitForSelector("#photoLightboxModal",{state:"hidden"});
    const beforeCount=await page.evaluate(()=>profileDraftPhotos.length);
    await photosGrid.getByRole("button",{name:"Удалить"}).click();
    const afterCount=await page.evaluate(()=>profileDraftPhotos.length);
    if(afterCount!==beforeCount-1)throw new Error(`Delete photo did not work from the resume photo column: ${beforeCount} -> ${afterCount}`);
    if(await page.locator(".photo-thumb").count()!==0)throw new Error("A single remaining photo should not still show rail thumbnails");

    // 18. Save-scope behavior (help text swap) is unchanged, now driven by
    // the footer radio group instead of a <select>.
    await page.evaluate(()=>{document.getElementById("cloudProfileScope").hidden=false;updateProfileScopeHelp()});
    const projectHelp=await page.locator("#profileScopeHelp").textContent();
    await page.check("#profileSaveScopeGlobal");
    await page.evaluate(()=>updateProfileScopeHelp());
    const globalHelp=await page.locator("#profileScopeHelp").textContent();
    if(!projectHelp.includes("только в этом проекте"))throw new Error(`Project-scope help text regressed: ${projectHelp}`);
    if(!globalHelp.includes("во всех проектах"))throw new Error(`Global-scope help text regressed: ${globalHelp}`);

    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  if(errors.length)throw new Error(`Console/page errors during test: ${errors.join(" | ")}`);
  console.log("Character card / profile top layout browser tests: OK");
}finally{await browser.close();server.kill()}
