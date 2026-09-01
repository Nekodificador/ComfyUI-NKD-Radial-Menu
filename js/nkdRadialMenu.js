import { app } from "../../scripts/app.js"

const SETTING_PREFIX = "NKD Radial Menu."

const DEFAULT_CATS = [
  { key:"loaders", label:"Loaders", color:"#4ab4ff", icon:"upload",
    values:["CheckpointLoaderSimple","LoraLoader","CLIPLoader","VAELoader","LoadImage","LoadVideo"] },
  { key:"preview", label:"Preview", color:"#51cf66", icon:"eye",
    values:["PreviewImage","SaveImage","PreviewAudio"] },
  { key:"samplers", label:"Samplers", color:"#cc5de8", icon:"sparkles",
    values:["KSampler","KSamplerAdvanced","SamplerCustom","SamplerCustomAdvanced"] },
  { key:"conditioning", label:"Conditioning", color:"#e8c547", icon:"text",
    values:["CLIPTextEncode","ConditioningCombine","ConditioningSetArea","unCLIPConditioning"] },
  { key:"mask", label:"Mask", color:"#d97a47", icon:"square-dashed-bottom",
    values:["MaskComposite","InvertMask","ImageToMask","MaskToImage"] },
  { key:"image", label:"Image", color:"#7fd4e8", icon:"image",
    values:["ImageScale","ImageScaleBy","ImageCompositeMasked","ImageCrop","ImageBatch"] },
  { key:"latent", label:"Latent", color:"#ff6b6b", icon:"layers",
    values:["EmptyLatentImage","LatentUpscale","LatentUpscaleBy","LatentComposite","VAEDecode","VAEEncode"] },
  { key:"advanced", label:"Advanced", color:"#f0a64f", icon:"settings",
    values:["Reroute","Note","PrimitiveNode","SetNode","GetNode"] },
]

// ─── Dynamic script loader ─────────────────────────────────────────────────

async function loadClassicScript(src) {
  const url = new URL(src, import.meta.url).href
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Failed to load ${src}: ${r.status}`)
  const code = await r.text()
  new Function(code)()
}

let scriptsReady = null
function ensureScripts() {
  if (!scriptsReady) {
    scriptsReady = loadClassicScript("lib/nkd_radial.dat")
      .then(() => loadClassicScript("lib/lucide_data.dat"))
  }
  return scriptsReady
}

// ─── State ──────────────────────────────────────────────────────────────────

let cats = null
let menuOpen = false
let openPos = [0, 0]

// ─── Helpers ────────────────────────────────────────────────────────────────

const PALETTES = ["nkd", "ink", "paper", "warm", "cool"]

function loadPalette() {
  return app.ui?.settings?.getSettingValue(SETTING_PREFIX + "Palette") || "ink"
}

function loadConfig() {
  try {
    const raw = app.ui?.settings?.getSettingValue(SETTING_PREFIX + "Categories")
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch { /* fall through */ }
  return JSON.parse(JSON.stringify(DEFAULT_CATS))
}

function saveConfig(data) {
  app.ui?.settings?.setSettingValue(SETTING_PREFIX + "Categories", JSON.stringify(data))
}


function isDark() {
  return document.body.classList.contains("comfy-dark") ||
         !document.body.classList.contains("comfy-light")
}

function canvasToScreen(canvasX, canvasY) {
  const canvas = app.canvas
  if (!canvas) return [canvasX, canvasY]
  const scale = canvas.ds?.scale || 1
  const offset = canvas.ds?.offset || [0, 0]
  return [
    (canvasX + offset[0]) * scale,
    (canvasY + offset[1]) * scale,
  ]
}

function screenToCanvas(screenX, screenY) {
  const canvas = app.canvas
  if (!canvas) return [screenX, screenY]
  const scale = canvas.ds?.scale || 1
  const offset = canvas.ds?.offset || [0, 0]
  return [
    screenX / scale - offset[0],
    screenY / scale - offset[1],
  ]
}

function addNodeAt(nodeType, canvasX, canvasY) {
  if (!nodeType) return null
  const node = LiteGraph.createNode(nodeType)
  if (!node) {
    console.warn(`[NKD Radial] Unknown node type: ${nodeType}`)
    return null
  }
  const graph = app.canvas?.graph || app.graph
  graph.add(node)
  node.pos = [canvasX - node.size[0] / 2, canvasY - node.size[1] / 2]
  app.canvas?.setDirty?.(true, true)
  app.graph?.afterChange?.()
  return node
}

// ─── Link auto-connect (from quickConnect pattern in NKD-Reroutes) ─────────

function readConnecting(canvas) {
  if (!canvas) return null
  if (canvas.connecting_links) {
    const l = canvas.connecting_links[0]
    const sock = l?.output || l?.input
    const side = l?.output ? "output" : l?.input ? "input" : null
    if (!l || !side || !sock) return null
    return { node: l.node, slot: l.slot, side, type: sock.type }
  }
  if (canvas.connecting_node) {
    const sock = canvas.connecting_output || canvas.connecting_input
    const side = canvas.connecting_output ? "output" : canvas.connecting_input ? "input" : null
    if (!side || !sock) return null
    return { node: canvas.connecting_node, slot: canvas.connecting_slot, side, type: sock.type }
  }
  return null
}

function endDrag(canvas) {
  // Suppress native search menu before clearing state
  const LG = globalThis.LiteGraph
  const prevFlag = LG ? LG.release_link_on_empty_shows_menu : undefined
  const prevShow = canvas.showConnectionMenu
  if (LG) LG.release_link_on_empty_shows_menu = false
  canvas.showConnectionMenu = () => {}

  canvas.linkConnector?.reset?.()
  canvas.connecting_links = null
  canvas.connecting_node = null
  canvas.connecting_output = null
  canvas.connecting_input = null
  canvas.connecting_slot = null
  canvas.connecting_pos = null

  setTimeout(() => {
    if (LG && prevFlag !== undefined) LG.release_link_on_empty_shows_menu = prevFlag
    if (prevShow) canvas.showConnectionMenu = prevShow
  }, 0)
}

function autoConnect(origin, newNode) {
  if (!origin || !newNode) return
  const LG = globalThis.LiteGraph
  if (origin.side === "output") {
    const inputs = newNode.inputs || []
    for (let i = 0; i < inputs.length; i++) {
      if (!LG || LG.isValidConnection(origin.type, inputs[i].type)) {
        origin.node.connect(origin.slot, newNode, i)
        return
      }
    }
  } else {
    const outputs = newNode.outputs || []
    for (let i = 0; i < outputs.length; i++) {
      if (!LG || LG.isValidConnection(outputs[i].type, origin.type)) {
        newNode.connect(i, origin.node, origin.slot)
        return
      }
    }
  }
}

// ─── Radial lifecycle ───────────────────────────────────────────────────────

let radialTeardown = null

let _pendingConnect = null
let _cleanupFwd = null

// ponytail: must be synchronous — async delays overlay creation, and
// preventDefault on pointerdown kills mouseup (which nkdRadial needs).
function openRadial(clientX, clientY) {
  if (menuOpen || typeof nkdRadial === "undefined") return
  cats = loadConfig()
  menuOpen = true
  openPos = screenToCanvas(clientX, clientY)

  radialTeardown = nkdRadial({ clientX, clientY }, {
    categories: cats,
    style: "donut",
    gap: 0.06,
    palette: loadPalette(),
    dark: isDark(),
    onSelect(catKey, value) {
      _cleanupFwd?.()
      menuOpen = false
      radialTeardown = null
      const node = addNodeAt(value, openPos[0], openPos[1])
      if (_pendingConnect && node) {
        autoConnect(_pendingConnect, node)
      }
      if (_pendingConnect) { endDrag(app.canvas); _pendingConnect = null }
    },
    onCancel() {
      _cleanupFwd?.()
      menuOpen = false
      radialTeardown = null
      if (_pendingConnect) { endDrag(app.canvas); _pendingConnect = null }
    },
  })

  // When opening from a link drag (Path B), LiteGraph has setPointerCapture on
  // the canvas — the overlay never gets mousemove/mouseup. Forward pointer
  // events from document to the overlay as synthetic mouse events.
  if (_pendingConnect) {
    const ov = document.body.lastElementChild
    if (ov) {
      const fwd = (type) => (e) => {
        ov.dispatchEvent(new MouseEvent(type, {
          clientX: e.clientX, clientY: e.clientY,
          button: e.button, bubbles: true, cancelable: true,
        }))
      }
      const onMove = fwd("mousemove")
      const onUp = fwd("mouseup")
      const cleanup = () => {
        document.removeEventListener("pointermove", onMove, true)
        document.removeEventListener("pointerup", onUp, true)
        _cleanupFwd = null
      }
      document.addEventListener("pointermove", onMove, true)
      document.addEventListener("pointerup", onUp, true)
      _cleanupFwd = cleanup
    }
  }
}

function closeRadial() {
  menuOpen = false
  if (radialTeardown) { radialTeardown(); radialTeardown = null }
}

// ─── Config modal ──────────────────────────────────────────────────────────

let cssInjected = false
function injectModalCSS() {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement("style")
  style.textContent = `
.nkd-modal-bg { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:none;
  align-items:center; justify-content:center; z-index:100000; }
.nkd-modal-bg.open { display:flex; }

.nkd-modal { background:#1a1a1a; border:1px solid #333; border-radius:12px;
  width:680px; max-height:80vh; display:flex; flex-direction:column; overflow:hidden;
  color:#ccc; font-family:system-ui,sans-serif; font-size:13px; }

.nkd-modal-head { padding:16px 20px; border-bottom:1px solid #333; display:flex;
  align-items:center; justify-content:space-between; flex-shrink:0; }
.nkd-modal-head h2 { font-size:15px; font-weight:600; margin:0; }
.nkd-modal-close { background:none; border:none; color:#666; cursor:pointer; font-size:18px; padding:4px 8px; }
.nkd-modal-close:hover { color:#ccc; }

.nkd-modal-body { display:flex; flex:1; overflow:hidden; min-height:0; }

.nkd-cat-list { width:260px; border-right:1px solid #333; flex-shrink:0;
  display:flex; flex-direction:column; align-items:center; justify-content:center; }
.nkd-cat-list canvas { cursor:pointer; }
.nkd-cat-add { padding:10px 14px; font-size:12px; color:#666; cursor:pointer; border-top:1px solid #222;
  align-self:stretch; text-align:center; }
.nkd-cat-add:hover { color:#aaa; background:#222; }

.nkd-cat-edit { flex:1; padding:16px 20px; overflow-y:auto; display:flex; flex-direction:column; gap:14px; }
.nkd-cat-edit .nkd-field { display:flex; flex-direction:column; gap:4px; }
.nkd-cat-edit .nkd-field label { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:0.5px; }
.nkd-cat-edit .nkd-field input[type=text] { background:#222; border:1px solid #444; border-radius:6px;
  padding:6px 10px; color:#ccc; font-size:13px; outline:none; }
.nkd-cat-edit .nkd-field input[type=text]:focus { border-color:#7F77DD; }
.nkd-cat-edit .nkd-field input[type=color] { width:36px; height:28px; border:1px solid #444; border-radius:6px;
  background:#222; cursor:pointer; padding:2px; }
.nkd-name-color { display:flex; gap:12px; align-items:flex-end; }
.nkd-name-color .nkd-field:first-child { flex:1; }

.nkd-val-list { display:flex; flex-direction:column; gap:2px; }
.nkd-val-item { display:flex; align-items:center; gap:6px; position:relative; }
.nkd-val-item input { flex:1; background:#222; border:1px solid #333; border-radius:4px;
  padding:5px 8px; color:#ccc; font-size:12px; outline:none; }
.nkd-val-item input:focus { border-color:#7F77DD; }
.nkd-val-item .nkd-val-btn { background:none; border:none; color:#666; cursor:pointer; font-size:14px; padding:2px 4px; }
.nkd-val-item .nkd-val-btn:hover { color:#ccc; }
.nkd-val-add { font-size:12px; color:#666; cursor:pointer; padding:4px 0; }
.nkd-val-add:hover { color:#aaa; }

.nkd-autocomplete { position:absolute; left:32px; right:80px; top:100%; z-index:100002;
  background:#1e1e1e; border:1px solid #444; border-radius:6px; max-height:200px;
  overflow-y:auto; box-shadow:0 4px 12px rgba(0,0,0,0.5); display:none; }
.nkd-autocomplete.open { display:block; }
.nkd-ac-item { padding:5px 10px; font-size:12px; color:#ccc; cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.nkd-ac-item:hover, .nkd-ac-item.active { background:#333; color:#fff; }
.nkd-ac-item .nkd-ac-match { color:#7F77DD; font-weight:600; }
.nkd-ac-empty { padding:8px 10px; font-size:11px; color:#666; font-style:italic; }

.nkd-modal-foot { padding:12px 20px; border-top:1px solid #333; display:flex; gap:8px;
  justify-content:space-between; align-items:center; flex-shrink:0; }
.nkd-modal-foot .nkd-left { display:flex; gap:8px; }
.nkd-modal-foot button { padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px; }
.nkd-btn-primary { background:#7F77DD; border:none; color:#fff; }
.nkd-btn-primary:hover { background:#6e65cc; }
.nkd-btn-ghost { background:none; border:1px solid #444; color:#aaa; }
.nkd-btn-ghost:hover { border-color:#666; color:#ccc; }
.nkd-btn-danger { background:none; border:1px solid #633; color:#c66; }
.nkd-btn-danger:hover { background:#2a1515; border-color:#944; color:#e88; }

.nkd-empty-hint { color:#555; font-size:13px; padding:20px; text-align:center; }

.nkd-icon-picker { position:relative; display:inline-block; }
.nkd-icon-picker-btn { width:36px; height:28px; background:#222; border:1px solid #444; border-radius:6px;
  cursor:pointer; display:flex; align-items:center; justify-content:center; }
.nkd-icon-picker-btn:hover { border-color:#666; }
.nkd-icon-picker-btn svg { width:16px; height:16px; }
.nkd-icon-grid { position:fixed; background:#1e1e1e; border:1px solid #444; border-radius:10px;
  display:none; flex-direction:column; z-index:100001; width:320px;
  box-shadow:0 4px 20px rgba(0,0,0,0.6); max-height:380px; overflow:hidden; }
.nkd-icon-grid.open { display:flex; }
.nkd-icon-search { padding:6px 8px; border-bottom:1px solid #333; flex-shrink:0; }
.nkd-icon-search input { width:100%; background:#2a2a2a; border:1px solid #444; border-radius:6px;
  padding:5px 8px; color:#ccc; font-size:12px; outline:none; }
.nkd-icon-search input:focus { border-color:#7F77DD; }
.nkd-icon-cat-bar { display:flex; gap:4px; padding:4px 8px; overflow-x:auto; flex-shrink:0;
  border-bottom:1px solid #333; scrollbar-width:none; }
.nkd-icon-cat-bar::-webkit-scrollbar { display:none; }
.nkd-icon-cat-tab { padding:3px 8px; border-radius:4px; font-size:10px; cursor:pointer;
  white-space:nowrap; color:#888; background:none; border:none; }
.nkd-icon-cat-tab:hover { background:#333; color:#ccc; }
.nkd-icon-cat-tab.active { background:#7F77DD; color:#fff; }
.nkd-icon-cells { display:grid; grid-template-columns:repeat(auto-fill,36px); justify-content:center;
  gap:2px; padding:6px; overflow-y:auto; overflow-x:hidden; flex:1; min-height:0; }
.nkd-icon-cell { height:32px; display:flex; align-items:center; justify-content:center;
  border-radius:4px; cursor:pointer; border:2px solid transparent; }
.nkd-icon-cell:hover { background:#333; }
.nkd-icon-cell.active { border-color:#7F77DD; background:#2a2a3a; }
.nkd-icon-cell svg { width:18px; height:18px; }
.nkd-icon-cell.nkd-none-cell { font-size:10px; color:#666; }
.nkd-icon-empty { padding:20px; text-align:center; color:#666; font-size:12px; }

.nkd-val-icon-picker { flex-shrink:0; }
.nkd-val-icon-btn { width:26px; height:24px; background:#222; border:1px solid #333; border-radius:4px;
  cursor:pointer; display:flex; align-items:center; justify-content:center; }
.nkd-val-icon-btn:hover { border-color:#555; }
.nkd-val-icon-btn svg { width:12px; height:12px; }
`
  document.head.appendChild(style)
}

// ─── Icon helpers ───────────────────────────────────────────────────────────

function getIconData() { return (typeof nkdRadial !== "undefined" && nkdRadial.ICONS) || {} }
function getIconCats() { return (typeof nkdRadial !== "undefined" && nkdRadial.ICON_CATS) || {} }
function getIconTags() { return (typeof nkdRadial !== "undefined" && nkdRadial.ICON_TAGS) || {} }

function esc(s) { return s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;") }

function iconSvg(name, size) {
  const s = size || 18
  const paths = getIconData()[name]
  if (!paths) return ""
  let d = ""
  for (let i = 0; i < paths.length; i++) d += `<path d="${paths[i]}"/>`
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
}

// ─── Node type search (for autocomplete) ────────────────────────────────────

// Node type index: maps display title → internal type, searchable by both
let _nodeIndex = null
function getNodeIndex() {
  if (_nodeIndex) return _nodeIndex
  if (typeof LiteGraph === "undefined" || !LiteGraph.registered_node_types) return []
  const entries = []
  for (const [type, cls] of Object.entries(LiteGraph.registered_node_types)) {
    const title = cls.title || type.split("/").pop()
    entries.push({ type, title, search: (title + " " + type).toLowerCase() })
  }
  entries.sort((a, b) => a.title.localeCompare(b.title))
  if (entries.length) _nodeIndex = entries
  return entries
}

function searchNodes(query, limit) {
  if (!query) return []
  const index = getNodeIndex()
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results = []
  for (const entry of index) {
    if (tokens.every(t => entry.search.includes(t))) {
      results.push(entry)
      if (results.length >= (limit || 20)) break
    }
  }
  return results
}

function highlightMatch(text, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  let result = ""
  let i = 0
  while (i < text.length) {
    let matched = false
    for (const t of tokens) {
      if (text.toLowerCase().startsWith(t, i)) {
        result += `<span class="nkd-ac-match">${esc(text.slice(i, i + t.length))}</span>`
        i += t.length
        matched = true
        break
      }
    }
    if (!matched) { result += esc(text[i]); i++ }
  }
  return result
}

function fuzzyMatch(query, text) {
  query = query.toLowerCase(); text = text.toLowerCase()
  if (text.indexOf(query) >= 0) return true
  let qi = 0
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++
  }
  return qi === query.length
}

function filterIcons(query, category) {
  const ICON_DATA = getIconData()
  const ICON_CATS = getIconCats()
  const ICON_TAGS = getIconTags()
  const ICON_NAMES = Object.keys(ICON_DATA)
  const list = category && ICON_CATS[category] ? ICON_CATS[category] : ICON_NAMES
  if (!query) return list
  return list.filter(name => {
    if (fuzzyMatch(query, name)) return true
    const tags = ICON_TAGS[name] || ""
    return fuzzyMatch(query, tags)
  })
}

function valObj(v) { return typeof v === "string" ? { label:v, icon:"" } : { label:v.label||"", icon:v.icon||"" } }

// ─── Modal state ────────────────────────────────────────────────────────────

let modalBg = null
let catListEl = null
let catEditEl = null
let editCats = null
let editIdx = -1
let radialCanvas = null
let radialCtx = null
let radialDragIdx = -1
let radialDropIdx = -1

const RAD_SIZE = 230
let RAD_CX = 115, RAD_CY = 115
const RAD_RIN = 40, RAD_ROUT = 90, RAD_CORNER = 6
const RAD_SLOT = [
  -Math.PI/4, 0, Math.PI/4, Math.PI/2,
  3*Math.PI/4, Math.PI, -3*Math.PI/4, -Math.PI/2
]
const RAD_SPAN = Math.PI/4, RAD_GAP = 0.06
const RAD_FILL = [0,1,2,3,4,5,6,7]

function hexRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)] }
function rgba(hex, a) { const c = hexRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})` }
function textColor(hex) { const c = hexRgb(hex); return (c[0]*0.299+c[1]*0.587+c[2]*0.114)>150?"#111":"#fff" }

function radialSector(ctx, cx, cy, rIn, rOut, a0, a1, cr) {
  const da = a1-a0; if (da < 0.01) { ctx.beginPath(); return }
  const c = Math.min(cr, (rOut-rIn)/3, da*rIn/3, da*rOut/3)
  const oOff = c/rOut, iOff = c/rIn
  ctx.beginPath()
  ctx.moveTo(cx+Math.cos(a0+oOff)*rOut, cy+Math.sin(a0+oOff)*rOut)
  ctx.arc(cx, cy, rOut, a0+oOff, a1-oOff)
  const p1x=cx+Math.cos(a1)*rOut, p1y=cy+Math.sin(a1)*rOut
  const p2x=cx+Math.cos(a1)*rIn, p2y=cy+Math.sin(a1)*rIn
  ctx.arcTo(p1x,p1y,p2x,p2y,c)
  ctx.arcTo(p2x,p2y,cx+Math.cos(a1-iOff)*rIn,cy+Math.sin(a1-iOff)*rIn,c)
  ctx.arc(cx,cy,rIn,a1-iOff,a0+iOff,true)
  const p3x=cx+Math.cos(a0)*rIn, p3y=cy+Math.sin(a0)*rIn
  const p4x=cx+Math.cos(a0)*rOut, p4y=cy+Math.sin(a0)*rOut
  ctx.arcTo(p3x,p3y,p4x,p4y,c)
  ctx.arcTo(p4x,p4y,cx+Math.cos(a0+oOff)*rOut,cy+Math.sin(a0+oOff)*rOut,c)
  ctx.closePath()
}

function drawRadialPreview() {
  if (!radialCtx) return
  const ctx = radialCtx, cx = RAD_CX, cy = RAD_CY
  const dk = isDark()
  ctx.clearRect(0, 0, RAD_SIZE, RAD_SIZE)

  const n = Math.min(editCats.length, 8)
  for (let i = 0; i < n; i++) {
    const c = editCats[i]
    const slot = RAD_SLOT[RAD_FILL[i]]
    const a0 = slot - RAD_SPAN/2 + RAD_GAP/2
    const a1 = slot + RAD_SPAN/2 - RAD_GAP/2
    const hv = i === editIdx
    const rOut = hv ? RAD_ROUT + 4 : RAD_ROUT

    radialSector(ctx, cx, cy, RAD_RIN, rOut, a0, a1, RAD_CORNER)
    ctx.fillStyle = hv ? c.color : rgba(c.color, dk ? 0.85 : 0.92)
    ctx.fill()
    ctx.strokeStyle = hv ? rgba(c.color, 0.9) : rgba(c.color, dk ? 0.4 : 0.3)
    ctx.lineWidth = hv ? 2 : 0.5
    ctx.stroke()

    const mid = slot, lr = (RAD_RIN + RAD_ROUT) / 2
    const tcx = cx + Math.cos(mid) * lr, tcy = cy + Math.sin(mid) * lr

    const iconName = c.icon
    const ICONS = getIconData()
    if (iconName && ICONS[iconName]) {
      const paths = ICONS[iconName]
      const sz = 16
      ctx.save()
      ctx.translate(tcx - sz/2, tcy - sz/2)
      ctx.scale(sz/24, sz/24)
      ctx.strokeStyle = textColor(c.color)
      ctx.lineWidth = 2 * (24/sz)
      ctx.lineCap = "round"; ctx.lineJoin = "round"
      for (let pi = 0; pi < paths.length; pi++) ctx.stroke(new Path2D(paths[pi]))
      ctx.restore()
    } else {
      ctx.save()
      ctx.translate(tcx, tcy)
      let rot = mid
      if (rot > Math.PI/2 && rot < Math.PI*1.5) rot += Math.PI
      if (rot < -Math.PI/2) rot += Math.PI
      ctx.rotate(rot)
      ctx.fillStyle = textColor(c.color)
      ctx.font = (hv ? "600 " : "400 ") + "10px system-ui,sans-serif"
      ctx.textAlign = "center"; ctx.textBaseline = "middle"
      ctx.fillText(c.label.length > 5 ? c.label.slice(0,5) : c.label, 0, 0)
      ctx.restore()
    }
  }

  if (radialDragIdx >= 0 && radialDropIdx >= 0 && radialDropIdx !== radialDragIdx) {
    const di = radialDropIdx
    const dslot = RAD_SLOT[RAD_FILL[di]]
    const da0 = dslot - RAD_SPAN/2 + RAD_GAP/2
    const da1 = dslot + RAD_SPAN/2 - RAD_GAP/2
    radialSector(ctx, cx, cy, RAD_RIN - 2, RAD_ROUT + 6, da0, da1, RAD_CORNER)
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.beginPath()
  ctx.arc(cx, cy, RAD_RIN - 4, 0, Math.PI*2)
  ctx.fillStyle = dk ? "rgba(18,18,18,0.95)" : "rgba(250,250,250,0.97)"
  ctx.fill()
  ctx.strokeStyle = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
  ctx.lineWidth = 1
  ctx.stroke()
  if (editIdx >= 0 && editIdx < editCats.length) {
    const sel = editCats[editIdx]
    ctx.fillStyle = sel.color
    ctx.font = "600 11px system-ui,sans-serif"
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.fillText(sel.label.length > 10 ? sel.label.slice(0,10) : sel.label, cx, cy)
  }
}

function radialHitTest(x, y) {
  const dx = x - RAD_CX, dy = y - RAD_CY
  const dist = Math.sqrt(dx*dx + dy*dy)
  if (dist < RAD_RIN || dist > RAD_ROUT + 6) return -1
  const ang = Math.atan2(dy, dx)
  const n = Math.min(editCats.length, 8)
  for (let i = 0; i < n; i++) {
    const slot = RAD_SLOT[RAD_FILL[i]]
    const a0 = slot - RAD_SPAN/2 + RAD_GAP/2
    const a1 = slot + RAD_SPAN/2 - RAD_GAP/2
    let a = ang
    while (a < slot - Math.PI) a += Math.PI*2
    while (a > slot + Math.PI) a -= Math.PI*2
    if (a >= a0 && a <= a1) return i
  }
  return -1
}

function radialCanvasXY(e) {
  const rect = radialCanvas.getBoundingClientRect()
  return { x: (e.clientX - rect.left) * (RAD_SIZE / rect.width),
           y: (e.clientY - rect.top) * (RAD_SIZE / rect.height) }
}

// ─── Icon grid builder ──────────────────────────────────────────────────────

function buildIconGrid(id) {
  const CAT_NAMES = Object.keys(getIconCats()).sort()
  let catTabs = `<button class="nkd-icon-cat-tab active" data-cat="">All</button>`
  for (const cn of CAT_NAMES) {
    catTabs += `<button class="nkd-icon-cat-tab" data-cat="${cn}">${cn}</button>`
  }
  return `<div class="nkd-icon-grid" id="${id}">`
    + `<div class="nkd-icon-search"><input type="text" placeholder="Search icons..." data-grid="${id}"></div>`
    + `<div class="nkd-icon-cat-bar">${catTabs}</div>`
    + `<div class="nkd-icon-cells"></div></div>`
}

const ICON_RENDER_CAP = 120
function renderIconCells(gridId, query, category) {
  const grid = document.getElementById(gridId)
  if (!grid) return
  const container = grid.querySelector(".nkd-icon-cells")
  const list = filterIcons(query || "", category || "")
  const capped = list.length > ICON_RENDER_CAP
  const show = capped ? list.slice(0, ICON_RENDER_CAP) : list
  let html = `<div class="nkd-icon-cell nkd-none-cell" data-icon="">&times;</div>`
  for (const name of show) {
    html += `<div class="nkd-icon-cell" data-icon="${name}" title="${name}">${iconSvg(name, 18)}</div>`
  }
  if (!list.length) html += `<div class="nkd-icon-empty">No icons found</div>`
  if (capped) html += `<div class="nkd-icon-empty">Showing ${ICON_RENDER_CAP} of ${list.length} — search or pick a category</div>`
  container.innerHTML = html
}

function wireIconGridFilters(gridId) {
  const grid = document.getElementById(gridId)
  if (!grid || grid._wired) return
  grid._wired = true
  const searchInput = grid.querySelector(".nkd-icon-search input")
  const catBar = grid.querySelector(".nkd-icon-cat-bar")
  let activeCat = ""
  searchInput.addEventListener("input", () => renderIconCells(gridId, searchInput.value, activeCat))
  searchInput.addEventListener("click", e => e.stopPropagation())
  catBar.addEventListener("click", e => {
    const tab = e.target.closest(".nkd-icon-cat-tab")
    if (!tab) return
    e.stopPropagation()
    activeCat = tab.dataset.cat
    catBar.querySelectorAll(".nkd-icon-cat-tab").forEach(t => t.classList.remove("active"))
    tab.classList.add("active")
    renderIconCells(gridId, searchInput.value, activeCat)
  })
}

function closeAllIconGrids() {
  document.querySelectorAll(".nkd-icon-grid.open").forEach(g => g.classList.remove("open"))
}

function positionGrid(grid, btn) {
  const r = btn.getBoundingClientRect()
  const gw = 320, gh = 380
  let left = r.left + r.width / 2 - gw / 2
  if (left + gw > window.innerWidth - 8) left = window.innerWidth - gw - 8
  if (left < 8) left = 8
  let top = r.bottom + 4
  if (top + gh > window.innerHeight - 8) top = r.top - gh - 4
  if (top < 8) top = 8
  grid.style.left = left + "px"
  grid.style.top = top + "px"
}

function markActive(gridId, current) {
  const grid = document.getElementById(gridId)
  if (!grid) return
  grid.querySelectorAll(".nkd-icon-cell").forEach(cell => {
    cell.classList.toggle("active", cell.dataset.icon === (current || ""))
  })
}

// ─── Category list (radial preview + add button) ───────────────────────────

function renderCatList() {
  if (!radialCanvas) {
    catListEl.innerHTML = `<canvas id="nkdRadialPreview" width="${RAD_SIZE}" height="${RAD_SIZE}"></canvas>`
      + `<div class="nkd-cat-add" id="nkdCatAdd">+ Add category</div>`
    radialCanvas = document.getElementById("nkdRadialPreview")
    RAD_CX = RAD_SIZE / 2; RAD_CY = RAD_SIZE / 2
    radialCtx = radialCanvas.getContext("2d")

    radialCanvas.addEventListener("mousedown", e => {
      const p = radialCanvasXY(e)
      const hit = radialHitTest(p.x, p.y)
      if (hit >= 0) {
        radialDragIdx = hit
        radialDropIdx = -1
        radialCanvas.style.cursor = "grabbing"
      }
    })
    radialCanvas.addEventListener("mousemove", e => {
      if (radialDragIdx < 0) return
      const p = radialCanvasXY(e)
      const hit = radialHitTest(p.x, p.y)
      if (hit !== radialDropIdx) { radialDropIdx = hit; drawRadialPreview() }
    })
    radialCanvas.addEventListener("mouseup", e => {
      if (radialDragIdx < 0) return
      const p = radialCanvasXY(e)
      const hit = radialHitTest(p.x, p.y)
      if (hit >= 0 && hit !== radialDragIdx) {
        const tmp = editCats[radialDragIdx]
        editCats[radialDragIdx] = editCats[hit]
        editCats[hit] = tmp
        if (editIdx === radialDragIdx) editIdx = hit
        else if (editIdx === hit) editIdx = radialDragIdx
      } else if (hit >= 0) {
        editIdx = hit
      }
      radialDragIdx = -1; radialDropIdx = -1
      radialCanvas.style.cursor = "pointer"
      drawRadialPreview(); renderCatEdit()
    })
    radialCanvas.addEventListener("mouseleave", () => {
      if (radialDragIdx >= 0) {
        radialDragIdx = -1; radialDropIdx = -1
        radialCanvas.style.cursor = "pointer"
        drawRadialPreview()
      }
    })
  }

  const addBtn = document.getElementById("nkdCatAdd")
  if (editCats.length >= 8) {
    addBtn.style.opacity = "0.3"
    addBtn.style.cursor = "default"
    addBtn.textContent = "8/8 slots used"
    addBtn.onclick = null
  } else {
    addBtn.textContent = `+ Add category (${editCats.length}/8)`
    addBtn.onclick = () => {
      const n = editCats.length + 1
      editCats.push({ key:"category_"+n, label:"Category "+n, color:"#8c93a0", icon:"", values:[{label:"Item 1",icon:""}] })
      editIdx = editCats.length - 1
      drawRadialPreview(); renderCatEdit()
    }
  }
  drawRadialPreview()
}

// ─── Category editor ────────────────────────────────────────────────────────

function renderCatEdit() {
  if (editIdx < 0 || editIdx >= editCats.length) {
    catEditEl.innerHTML = `<div class="nkd-empty-hint">Select a category to edit</div>`
    return
  }
  const c = editCats[editIdx]
  const catIconPreview = c.icon ? iconSvg(c.icon, 16) : "&times;"
  let html = `<div class="nkd-name-color">`
    + `<div class="nkd-field"><label>Name</label><input type="text" id="nkdEditName" value="${esc(c.label)}"></div>`
    + `<div class="nkd-field"><label>Color</label><input type="color" id="nkdEditColor" value="${c.color}"></div>`
    + `</div>`
    + `<div class="nkd-name-color">`
    + `<div class="nkd-field"><label>Icon</label>`
    + `<div class="nkd-icon-picker" id="nkdCatIconPicker">`
    + `<div class="nkd-icon-picker-btn" id="nkdCatIconBtn">${catIconPreview}</div>`
    + buildIconGrid("nkdCatIconGrid")
    + `</div></div>`
    + `</div>`
    + `<div class="nkd-field"><label>Values (${c.values.length})</label><div class="nkd-val-list" id="nkdValList">`
  for (let i = 0; i < c.values.length; i++) {
    const v = c.values[i]
    const vIconPreview = v.icon ? iconSvg(v.icon, 12) : `<span style="font-size:9px;color:#666">&bull;</span>`
    html += `<div class="nkd-val-item" data-vi="${i}">`
      + `<div class="nkd-val-icon-picker" data-vi="${i}">`
      + `<div class="nkd-val-icon-btn" data-vi="${i}">${vIconPreview}</div>`
      + buildIconGrid("nkdValIconGrid" + i)
      + `</div>`
      + `<input type="text" value="${esc(v.label)}" data-vi="${i}" autocomplete="off">`
      + `<div class="nkd-autocomplete" id="nkdAc${i}"></div>`
      + `<button class="nkd-val-btn" data-vmove="up" data-vi="${i}">&uarr;</button>`
      + `<button class="nkd-val-btn" data-vmove="down" data-vi="${i}">&darr;</button>`
      + `<button class="nkd-val-btn" data-vdel="${i}">&times;</button>`
      + `</div>`
  }
  html += `</div><div class="nkd-val-add" id="nkdValAdd">+ Add value</div></div>`
    + `<div style="margin-top:auto; padding-top:12px;"><button class="nkd-btn-danger" id="nkdDelCat">Delete category</button></div>`
  catEditEl.innerHTML = html

  // Wire events
  document.getElementById("nkdEditName").addEventListener("input", function() {
    c.label = this.value
    c.key = this.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "cat"
    renderCatList()
  })
  document.getElementById("nkdEditColor").addEventListener("input", function() { c.color = this.value; renderCatList() })

  document.getElementById("nkdCatIconBtn").addEventListener("click", function(e) {
    e.stopPropagation()
    closeAllIconGrids()
    const grid = document.getElementById("nkdCatIconGrid")
    positionGrid(grid, this)
    grid.classList.toggle("open")
    renderIconCells("nkdCatIconGrid", "", "")
    wireIconGridFilters("nkdCatIconGrid")
    markActive("nkdCatIconGrid", c.icon)
  })
  document.getElementById("nkdCatIconGrid").addEventListener("click", function(e) {
    const cell = e.target.closest(".nkd-icon-cell")
    if (!cell) return
    c.icon = cell.dataset.icon
    renderCatList(); renderCatEdit()
  })

  catEditEl.querySelectorAll(".nkd-val-icon-btn").forEach(btn => {
    btn.addEventListener("click", function(e) {
      e.stopPropagation()
      const vi = parseInt(btn.dataset.vi)
      closeAllIconGrids()
      const grid = document.getElementById("nkdValIconGrid" + vi)
      positionGrid(grid, this)
      grid.classList.toggle("open")
      renderIconCells("nkdValIconGrid" + vi, "", "")
      wireIconGridFilters("nkdValIconGrid" + vi)
      markActive("nkdValIconGrid" + vi, c.values[vi].icon)
    })
  })
  catEditEl.querySelectorAll(".nkd-val-icon-picker .nkd-icon-grid").forEach(grid => {
    grid.addEventListener("click", function(e) {
      const cell = e.target.closest(".nkd-icon-cell")
      if (!cell) return
      const vi = parseInt(grid.id.replace("nkdValIconGrid",""))
      c.values[vi].icon = cell.dataset.icon
      renderCatEdit()
    })
  })

  catEditEl.querySelectorAll(".nkd-val-list > .nkd-val-item > input[data-vi]").forEach(inp => {
    const vi = parseInt(inp.dataset.vi)
    const acEl = document.getElementById("nkdAc" + vi)
    let acIdx = -1

    inp.addEventListener("input", function() {
      c.values[vi].label = this.value
      const q = this.value.trim()
      if (q.length < 2) { acEl.classList.remove("open"); return }
      const matches = searchNodes(q, 15)
      if (!matches.length) {
        acEl.innerHTML = `<div class="nkd-ac-empty">No nodes matching "${esc(q)}"</div>`
      } else {
        acEl.innerHTML = matches.map(m =>
          `<div class="nkd-ac-item" data-type="${esc(m.type)}">${highlightMatch(m.title, q)}<span style="opacity:.4;font-size:10px;margin-left:6px">${esc(m.type)}</span></div>`
        ).join("")
      }
      acIdx = -1
      acEl.classList.add("open")
    })

    inp.addEventListener("keydown", function(e) {
      if (!acEl.classList.contains("open")) return
      const items = acEl.querySelectorAll(".nkd-ac-item")
      if (e.key === "ArrowDown") {
        e.preventDefault()
        acIdx = Math.min(acIdx + 1, items.length - 1)
        items.forEach((el, i) => el.classList.toggle("active", i === acIdx))
        if (items[acIdx]) items[acIdx].scrollIntoView({ block: "nearest" })
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        acIdx = Math.max(acIdx - 1, 0)
        items.forEach((el, i) => el.classList.toggle("active", i === acIdx))
        if (items[acIdx]) items[acIdx].scrollIntoView({ block: "nearest" })
      } else if (e.key === "Enter" && acIdx >= 0 && items[acIdx]) {
        e.preventDefault()
        c.values[vi].label = items[acIdx].dataset.type
        inp.value = items[acIdx].dataset.type
        acEl.classList.remove("open")
      } else if (e.key === "Escape") {
        acEl.classList.remove("open")
      }
    })

    acEl.addEventListener("mousedown", function(e) {
      const item = e.target.closest(".nkd-ac-item")
      if (!item) return
      e.preventDefault()
      const type = item.dataset.type
      c.values[vi].label = type
      inp.value = type
      acEl.classList.remove("open")
    })

    inp.addEventListener("blur", () => { setTimeout(() => acEl.classList.remove("open"), 150) })
  })
  catEditEl.querySelectorAll("[data-vmove]").forEach(btn => {
    btn.addEventListener("click", function() {
      const i = parseInt(btn.dataset.vi)
      const dir = btn.dataset.vmove === "up" ? -1 : 1
      const j = i + dir
      if (j < 0 || j >= c.values.length) return
      const tmp = c.values[i]; c.values[i] = c.values[j]; c.values[j] = tmp
      renderCatEdit()
    })
  })
  catEditEl.querySelectorAll("[data-vdel]").forEach(btn => {
    btn.addEventListener("click", function() {
      c.values.splice(parseInt(btn.dataset.vdel), 1)
      renderCatEdit()
    })
  })
  document.getElementById("nkdValAdd").addEventListener("click", () => {
    c.values.push({label:"New item", icon:""})
    renderCatEdit()
    const inputs = catEditEl.querySelectorAll(".nkd-val-list input")
    const last = inputs[inputs.length - 1]
    if (last) { last.focus(); last.select() }
  })
  document.getElementById("nkdDelCat").addEventListener("click", () => {
    editCats.splice(editIdx, 1)
    if (editIdx >= editCats.length) editIdx = editCats.length - 1
    renderCatList(); renderCatEdit()
  })
}

// ─── Open / close modal ────────────────────────────────────────────────────

function buildModalDOM() {
  if (modalBg) return
  injectModalCSS()

  modalBg = document.createElement("div")
  modalBg.className = "nkd-modal-bg"
  modalBg.innerHTML = `
<div class="nkd-modal">
  <div class="nkd-modal-head">
    <h2>Radial Menu Configuration</h2>
    <button class="nkd-modal-close" id="nkdModalClose">&times;</button>
  </div>
  <div class="nkd-modal-body">
    <div class="nkd-cat-list" id="nkdCatList"></div>
    <div class="nkd-cat-edit" id="nkdCatEdit">
      <div class="nkd-empty-hint">Select a category to edit</div>
    </div>
  </div>
  <div class="nkd-modal-foot">
    <div class="nkd-left">
      <button class="nkd-btn-ghost" id="nkdExportBtn">Export JSON</button>
      <button class="nkd-btn-ghost" id="nkdImportBtn">Import JSON</button>
    </div>
<button class="nkd-btn-primary" id="nkdApplyBtn">Apply</button>
  </div>
</div>
<input type="file" id="nkdImportFile" accept=".json" style="display:none">`
  document.body.appendChild(modalBg)

  catListEl = document.getElementById("nkdCatList")
  catEditEl = document.getElementById("nkdCatEdit")

  document.getElementById("nkdModalClose").addEventListener("click", closeConfigModal)
  modalBg.addEventListener("click", e => { if (e.target === modalBg) closeConfigModal() })

  document.getElementById("nkdApplyBtn").addEventListener("click", () => {
    cats = editCats.map(c => ({
      key:c.key, label:c.label, color:c.color, icon:c.icon||"",
      values:c.values.map(v => v.icon ? {label:v.label, icon:v.icon} : v.label)
    }))
    saveConfig(cats)
    closeConfigModal()
  })

  document.getElementById("nkdExportBtn").addEventListener("click", () => {
    const json = JSON.stringify(editCats, null, 2)
    const blob = new Blob([json], { type:"application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "nkdRadial_config.json"
    a.click()
    URL.revokeObjectURL(a.href)
  })

  document.getElementById("nkdImportBtn").addEventListener("click", () => {
    document.getElementById("nkdImportFile").click()
  })
  document.getElementById("nkdImportFile").addEventListener("change", function() {
    const file = this.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (Array.isArray(data) && data.length) {
          editCats = data.map(c => ({
            key:c.key||"", label:c.label||"", color:c.color||"#888", icon:c.icon||"",
            values:(c.values||[]).map(v => valObj(v))
          }))
          editIdx = 0
          renderCatList(); renderCatEdit()
        }
      } catch { alert("Invalid JSON") }
    }
    reader.readAsText(file)
    this.value = ""
  })

  document.addEventListener("click", closeAllIconGrids)
}

async function openConfigModal() {
  await ensureScripts()
  buildModalDOM()
  cats = loadConfig()
  editCats = cats.map(c => ({
    key:c.key, label:c.label, color:c.color, icon:c.icon||"",
    values:(c.values||[]).map(v => valObj(v))
  }))
  editIdx = editCats.length ? 0 : -1
  radialCanvas = null; radialCtx = null
  catListEl.innerHTML = ""
  modalBg.classList.add("open")
  renderCatList()
  renderCatEdit()
}

function closeConfigModal() {
  if (modalBg) modalBg.classList.remove("open")
  editCats = null; editIdx = -1
}

// ─── Extension ──────────────────────────────────────────────────────────────

app.registerExtension({
  name: "NKD Radial Menu",

  setup() {
    cats = loadConfig()
    ensureScripts()

    app.ui?.settings?.addSetting({
      id: SETTING_PREFIX + "Categories",
      name: "Radial Menu Categories",
      type: "hidden",
      defaultValue: JSON.stringify(DEFAULT_CATS),
    })

    app.ui?.settings?.addSetting({
      id: SETTING_PREFIX + "Palette",
      name: "Radial Menu Color Palette",
      type: "combo",
      defaultValue: "ink",
      options: PALETTES,
    })

    app.ui?.settings?.addSetting({
      id: SETTING_PREFIX + "Config",
      defaultValue: null,
      name: "NKD Radial Menu settings",
      type: () => {
        const tr = document.createElement("tr")
        const tdLabel = document.createElement("td")
        tdLabel.innerHTML = "<div>NKD Radial Menu — configure categories</div>"
        const tdBtn = document.createElement("td")
        const btn = document.createElement("button")
        btn.textContent = "Configure Radial Menu"
        btn.style.cssText = "padding:4px 12px;border-radius:6px;background:#7F77DD;color:#fff;border:none;cursor:pointer;"
        btn.addEventListener("click", () => openConfigModal())
        tdBtn.appendChild(btn)
        tr.appendChild(tdLabel)
        tr.appendChild(tdBtn)
        return tr
      },
    })

    // ── Alt+Click trigger (Maya-style, order-independent) ──
    //
    // pointerdown (capture) — catches Alt+Click before LiteGraph.
    // NO preventDefault: that kills compatibility mouseup, which nkdRadial
    // needs on its overlay. A second mousedown handler swallows the
    // compatibility mousedown so LiteGraph doesn't start panning.
    let _swallowMouseDown = false
    let _ptrDown = false
    let _lastPtrId = -1
    let _lastMX = 0, _lastMY = 0

    function nodeUnderCursor() {
      const gc = app.canvas
      if (!gc?.graph) return true // conservative: assume yes
      const gm = gc.graph_mouse
      return gm ? !!gc.graph.getNodeOnPos(gm[0], gm[1]) : false
    }

    // Path A: Alt already held → pointerdown opens menu
    document.addEventListener("pointerdown", (e) => {
      _ptrDown = true
      _lastPtrId = e.pointerId
      _lastMX = e.clientX; _lastMY = e.clientY
      if (!e.altKey || e.button !== 0 || menuOpen) return
      if (nodeUnderCursor()) return
      _swallowMouseDown = true
      e.stopImmediatePropagation()
      openRadial(e.clientX, e.clientY)
    }, true)

    // Swallow the compatibility mousedown so LiteGraph doesn't see it
    document.addEventListener("mousedown", (e) => {
      if (_swallowMouseDown) {
        _swallowMouseDown = false
        e.stopImmediatePropagation()
      }
    }, true)

    document.addEventListener("pointerup", () => { _ptrDown = false }, true)
    document.addEventListener("pointermove", (e) => {
      if (_ptrDown) { _lastMX = e.clientX; _lastMY = e.clientY }
    }, true)

    // Path B: mouse already held → Alt pressed opens menu
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menuOpen) {
        e.preventDefault(); e.stopPropagation()
        closeRadial()
        return
      }
      if (e.key !== "Alt" || !_ptrDown || menuOpen) return
      if (nodeUnderCursor()) return
      const gc = app.canvas
      if (gc) {
        _pendingConnect = readConnecting(gc)
        gc.dragging_canvas = false
      }
      openRadial(_lastMX, _lastMY)
    }, true)

    console.log("[NKD Radial Menu] Loaded — Alt+Click to open")
  },
})
