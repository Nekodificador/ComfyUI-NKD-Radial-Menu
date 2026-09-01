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
    try {
      app.extensionManager.toast.add({
        severity: "warn",
        summary: "Missing node",
        detail: `"${nodeType}" is not installed. Search for it in ComfyUI Manager to install.`,
        life: 6000
      })
    } catch(_) { alert(`Node "${nodeType}" is not installed.`) }
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
    nodeTitle: getNodeTitle,
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

.nkd-val-wheel-wrap { display:flex; flex-direction:column; align-items:center; gap:8px; }
.nkd-val-wheel-wrap canvas { cursor:pointer; }
.nkd-val-wheel-add { font-size:12px; color:#666; cursor:pointer; padding:2px 0; }
.nkd-val-wheel-add:hover { color:#aaa; }

.nkd-val-aux { display:flex; flex-direction:column; gap:2px; }
.nkd-val-aux-head { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:0.5px;
  padding:4px 0 2px; border-top:1px solid #333; margin-top:4px; }
.nkd-val-aux-item { display:flex; align-items:center; gap:6px; cursor:pointer; border-radius:4px; padding:2px 4px; }
.nkd-val-aux-item:hover { background:rgba(255,255,255,0.05); }
.nkd-val-aux-item.active { background:rgba(255,255,255,0.1); }
.nkd-val-aux-item span { flex:1; font-size:12px; color:#999; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nkd-val-aux-item .nkd-val-btn { background:none; border:none; color:#666; cursor:pointer; font-size:14px; padding:2px 4px; }
.nkd-val-aux-item .nkd-val-btn:hover { color:#ccc; }

.nkd-val-edit { display:flex; gap:8px; align-items:flex-end; padding:6px 0; border-top:1px solid #333; position:relative; }
.nkd-val-edit .nkd-field { flex:1; }
.nkd-val-edit .nkd-field input { width:100%; }

.nkd-val-list { display:flex; flex-direction:column; gap:2px; }
.nkd-val-item { display:flex; align-items:center; gap:6px; position:relative; }
.nkd-val-item input { flex:1; background:#222; border:1px solid #333; border-radius:4px;
  padding:5px 8px; color:#ccc; font-size:12px; outline:none; }
.nkd-val-item input:focus { border-color:#7F77DD; }
.nkd-val-item .nkd-val-btn { background:none; border:none; color:#666; cursor:pointer; font-size:14px; padding:2px 4px; }
.nkd-val-item .nkd-val-btn:hover { color:#ccc; }
.nkd-val-add { font-size:12px; color:#666; cursor:pointer; padding:4px 0; }
.nkd-val-add:hover { color:#aaa; }

.nkd-autocomplete { position:absolute; left:0; right:0; bottom:100%; z-index:100002;
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
  return text.indexOf(query) >= 0
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

function valObj(v) {
  if (typeof v === "string") return { label:v, icon:"" }
  const o = { label:v.label||"", icon:v.icon||"" }
  if (typeof v.slot === "number") o.slot = v.slot
  if (v.short) o.short = v.short
  return o
}

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

// ─── Value wheel (second radial preview for values inside a category) ──────

let valCanvas = null
let valCtx = null
let valDragSlot = -1
let valDropSlot = -1
let valEditIdx = -1

const VAL_SIZE = 230
let VAL_CX = 115, VAL_CY = 115
const VAL_RIN = 36, VAL_ROUT = 90, VAL_CORNER = 6
const VAL_MAX = 7

// Back slot = opposite direction of the selected category on the parent wheel
function backSlotFill() { return (editIdx + 4) % 8 }

// Ensure every wheel value has a valid slot assignment (backward compat)
function ensureSlots(cat) {
  const bs = backSlotFill()
  const vals = cat.values.slice(0, VAL_MAX)
  const used = new Set()
  for (const v of vals) {
    if (typeof v.slot === "number" && v.slot >= 0 && v.slot < 8 && v.slot !== bs && !used.has(v.slot)) {
      used.add(v.slot)
    } else {
      delete v.slot
    }
  }
  for (const v of vals) {
    if (v.slot === undefined) {
      for (let s = 0; s < 8; s++) {
        if (s !== bs && !used.has(s)) { v.slot = s; used.add(s); break }
      }
    }
  }
}

// Build slot -> value index map for the current category
function buildSlotMap(cat) {
  const vals = cat.values.slice(0, VAL_MAX)
  const m = {}
  for (let i = 0; i < vals.length; i++) if (vals[i].slot !== undefined) m[vals[i].slot] = i
  return m
}

function drawValueWheel() {
  if (!valCtx || editIdx < 0 || editIdx >= editCats.length) return
  const ctx = valCtx, cx = VAL_CX, cy = VAL_CY
  const dk = isDark()
  const cat = editCats[editIdx]
  ensureSlots(cat)
  const vals = cat.values.slice(0, VAL_MAX)
  const n = vals.length
  const bs = backSlotFill()
  const sm = buildSlotMap(cat)
  const baseColor = cat.color

  ctx.clearRect(0, 0, VAL_SIZE, VAL_SIZE)

  for (let s = 0; s < 8; s++) {
    const slot = RAD_SLOT[RAD_FILL[s]]
    const a0 = slot - RAD_SPAN/2 + RAD_GAP/2
    const a1 = slot + RAD_SPAN/2 - RAD_GAP/2
    const isBack = s === bs
    const vi = sm[s]
    const hasVal = !isBack && vi !== undefined
    const hv = hasVal && vi === valEditIdx
    const rOut = hv ? VAL_ROUT + 4 : VAL_ROUT

    radialSector(ctx, cx, cy, VAL_RIN, rOut, a0, a1, VAL_CORNER)

    if (isBack) {
      ctx.fillStyle = dk ? "rgba(60,60,60,0.7)" : "rgba(180,180,180,0.5)"
      ctx.fill()
      ctx.strokeStyle = dk ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"
      ctx.lineWidth = 0.5
      ctx.stroke()
      const mid = slot, lr = (VAL_RIN + VAL_ROUT) / 2
      const tcx = cx + Math.cos(mid) * lr, tcy = cy + Math.sin(mid) * lr
      ctx.save()
      ctx.translate(tcx, tcy)
      ctx.rotate(mid + Math.PI)
      ctx.beginPath()
      ctx.moveTo(-6, 0); ctx.lineTo(4, -5); ctx.lineTo(4, 5); ctx.closePath()
      ctx.fillStyle = dk ? "#888" : "#666"
      ctx.fill()
      ctx.restore()
    } else if (hasVal) {
      const alpha = hv ? 1 : (dk ? 0.6 : 0.7)
      ctx.fillStyle = rgba(baseColor, alpha)
      ctx.fill()
      ctx.strokeStyle = hv ? rgba(baseColor, 0.9) : rgba(baseColor, dk ? 0.3 : 0.25)
      ctx.lineWidth = hv ? 2 : 0.5
      ctx.stroke()

      const mid = slot, lr = (VAL_RIN + VAL_ROUT) / 2
      const tcx = cx + Math.cos(mid) * lr, tcy = cy + Math.sin(mid) * lr
      const v = vals[vi]
      const ICONS = getIconData()
      if (v.icon && ICONS[v.icon]) {
        const paths = ICONS[v.icon]
        const sz = 14
        ctx.save()
        ctx.translate(tcx - sz/2, tcy - sz/2)
        ctx.scale(sz/24, sz/24)
        ctx.strokeStyle = textColor(baseColor)
        ctx.lineWidth = 2 * (24/sz)
        ctx.lineCap = "round"; ctx.lineJoin = "round"
        for (const p of paths) ctx.stroke(new Path2D(p))
        ctx.restore()
      } else {
        ctx.save()
        ctx.translate(tcx, tcy)
        let rot = mid
        if (rot > Math.PI/2 && rot < Math.PI*1.5) rot += Math.PI
        if (rot < -Math.PI/2) rot += Math.PI
        ctx.rotate(rot)
        ctx.fillStyle = textColor(baseColor)
        ctx.font = (hv ? "600 " : "400 ") + "9px system-ui,sans-serif"
        ctx.textAlign = "center"; ctx.textBaseline = "middle"
        const title = v.short || getNodeTitle(v.label)
        ctx.fillText(title.length > 6 ? title.slice(0,5) + "…" : title, 0, 0)
        ctx.restore()
      }
    } else {
      ctx.fillStyle = dk ? "rgba(40,40,40,0.4)" : "rgba(200,200,200,0.3)"
      ctx.fill()
      ctx.strokeStyle = dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"
      ctx.lineWidth = 0.5
      ctx.stroke()
    }
  }

  if (valDragSlot >= 0 && valDropSlot >= 0 && valDropSlot !== valDragSlot && valDropSlot !== bs) {
    const dslot = RAD_SLOT[RAD_FILL[valDropSlot]]
    const da0 = dslot - RAD_SPAN/2 + RAD_GAP/2
    const da1 = dslot + RAD_SPAN/2 - RAD_GAP/2
    radialSector(ctx, cx, cy, VAL_RIN - 2, VAL_ROUT + 6, da0, da1, VAL_CORNER)
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.beginPath()
  ctx.arc(cx, cy, VAL_RIN - 4, 0, Math.PI*2)
  ctx.fillStyle = dk ? "rgba(18,18,18,0.95)" : "rgba(250,250,250,0.97)"
  ctx.fill()
  ctx.strokeStyle = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
  ctx.lineWidth = 1
  ctx.stroke()
  if (valEditIdx >= 0 && valEditIdx < n) {
    const sv = vals[valEditIdx]
    const title = getNodeTitle(sv.label)
    ctx.fillStyle = baseColor
    ctx.font = "600 10px system-ui,sans-serif"
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.fillText(title.length > 12 ? title.slice(0,11) + "…" : title, cx, cy)
  } else {
    ctx.fillStyle = dk ? "#666" : "#999"
    ctx.font = "10px system-ui,sans-serif"
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.fillText(`${n}/${VAL_MAX}`, cx, cy)
  }
}

// Returns the slot fill index (0-7) hit, or -1 for miss/back
function valHitSlot(x, y) {
  if (editIdx < 0 || editIdx >= editCats.length) return -1
  const dx = x - VAL_CX, dy = y - VAL_CY
  const dist = Math.sqrt(dx*dx + dy*dy)
  if (dist < VAL_RIN || dist > VAL_ROUT + 6) return -1
  const ang = Math.atan2(dy, dx)
  const bs = backSlotFill()
  for (let s = 0; s < 8; s++) {
    const slot = RAD_SLOT[RAD_FILL[s]]
    let a = ang
    while (a < slot - Math.PI) a += Math.PI*2
    while (a > slot + Math.PI) a -= Math.PI*2
    const a0 = slot - RAD_SPAN/2 + RAD_GAP/2
    const a1 = slot + RAD_SPAN/2 - RAD_GAP/2
    if (a >= a0 && a <= a1) return s === bs ? -1 : s
  }
  return -1
}

function valCanvasXY(e) {
  const rect = valCanvas.getBoundingClientRect()
  return { x: (e.clientX - rect.left) * (VAL_SIZE / rect.width),
           y: (e.clientY - rect.top) * (VAL_SIZE / rect.height) }
}

function getNodeTitle(typeId) {
  if (!typeId) return "?"
  const idx = getNodeIndex()
  const entry = idx.find(e => e.type === typeId)
  if (entry) return entry.title
  return typeId.split("/").pop().replace(/([a-z])([A-Z])/g, "$1 $2")
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
        valEditIdx = -1
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
    valCanvas = null; valCtx = null; valEditIdx = -1
    return
  }
  const c = editCats[editIdx]
  const catIconPreview = c.icon ? iconSvg(c.icon, 16) : "&times;"
  const wheelCount = Math.min(c.values.length, VAL_MAX)
  const auxValues = c.values.slice(VAL_MAX)

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

  // Value wheel
  html += `<div class="nkd-val-wheel-wrap">`
    + `<canvas id="nkdValWheel" width="${VAL_SIZE}" height="${VAL_SIZE}"></canvas>`
  if (wheelCount < VAL_MAX) {
    html += `<div class="nkd-val-wheel-add" id="nkdValWheelAdd">+ Add to wheel (${wheelCount}/${VAL_MAX})</div>`
  } else {
    html += `<div style="font-size:11px;color:#555;">${VAL_MAX}/${VAL_MAX} wheel slots</div>`
  }
  html += `</div>`

  // Selected value editor
  if (valEditIdx >= 0 && valEditIdx < c.values.length) {
    const sv = c.values[valEditIdx]
    const isWheel = valEditIdx < wheelCount
    const svIcon = sv.icon ? iconSvg(sv.icon, 12) : `<span style="font-size:9px;color:#666">&bull;</span>`
    html += `<div class="nkd-val-edit">`
      + `<div class="nkd-val-icon-picker" data-vi="${valEditIdx}">`
      + `<div class="nkd-val-icon-btn" data-vi="${valEditIdx}">${svIcon}</div>`
      + buildIconGrid("nkdValIconGridSel")
      + `</div>`
      + `<div class="nkd-field"><label>Node</label><input type="text" id="nkdValEditInput" value="${esc(sv.label)}" autocomplete="off"></div>`
      + `<div class="nkd-autocomplete" id="nkdValAc"></div>`
      + `<div class="nkd-field" style="flex:0 0 70px"><label>Label</label><input type="text" id="nkdValShort" value="${esc(sv.short||"")}" maxlength="5" placeholder="${esc((getNodeTitle(sv.label)||"").slice(0,5))}" style="width:100%"></div>`
      + `<button class="nkd-val-btn" id="nkdValDel" title="Remove">&times;</button>`
      + (isWheel ? `<button class="nkd-val-btn" id="nkdValDemote" title="Move to auxiliary list">&darr;</button>` : ``)
      + `</div>`
  }

  // Auxiliary values (overflow beyond 8)
  if (auxValues.length > 0 || wheelCount >= VAL_MAX) {
    html += `<div class="nkd-val-aux">`
      + `<div class="nkd-val-aux-head">Auxiliary (${auxValues.length})</div>`
    for (let i = 0; i < auxValues.length; i++) {
      const ai = VAL_MAX + i
      const av = auxValues[i]
      html += `<div class="nkd-val-aux-item${valEditIdx === ai ? " active" : ""}" data-aux-select="${ai}">`
        + `<span title="${esc(av.label)}">${esc(getNodeTitle(av.label))}</span>`
        + `<button class="nkd-val-btn" data-aux-promote="${ai}" title="Move to wheel">&uarr;</button>`
        + `<button class="nkd-val-btn" data-aux-del="${ai}">&times;</button>`
        + `</div>`
    }
    html += `<div class="nkd-val-wheel-add" id="nkdValAuxAdd">+ Add auxiliary</div>`
    html += `</div>`
  }

  html += `<div style="margin-top:auto; padding-top:12px;"><button class="nkd-btn-danger" id="nkdDelCat">Delete category</button></div>`
  catEditEl.innerHTML = html

  // ─── Wire value wheel canvas ──────────────────────────────────────────────
  valCanvas = document.getElementById("nkdValWheel")
  VAL_CX = VAL_SIZE / 2; VAL_CY = VAL_SIZE / 2
  valCtx = valCanvas.getContext("2d")

  valCanvas.addEventListener("mousedown", e => {
    const p = valCanvasXY(e)
    const hs = valHitSlot(p.x, p.y)
    const sm = buildSlotMap(c)
    if (hs >= 0 && sm[hs] !== undefined) {
      valDragSlot = hs
      valDropSlot = -1
      valCanvas.style.cursor = "grabbing"
    }
  })
  valCanvas.addEventListener("mousemove", e => {
    if (valDragSlot < 0) return
    const p = valCanvasXY(e)
    const hs = valHitSlot(p.x, p.y)
    if (hs !== valDropSlot) { valDropSlot = hs; drawValueWheel() }
  })
  valCanvas.addEventListener("mouseup", e => {
    const p = valCanvasXY(e)
    const hs = valHitSlot(p.x, p.y)
    const sm = buildSlotMap(c)
    const dragVi = valDragSlot >= 0 ? sm[valDragSlot] : undefined
    const dropVi = hs >= 0 ? sm[hs] : undefined

    if (valDragSlot >= 0 && hs >= 0 && hs !== valDragSlot && dragVi !== undefined) {
      // Drag to another slot: swap slot assignments (works for empty targets too)
      if (dropVi !== undefined) {
        c.values[dropVi].slot = valDragSlot
      }
      c.values[dragVi].slot = hs
      if (valEditIdx === dragVi) { /* keep selection */ }
      else if (valEditIdx === dropVi) { /* keep selection */ }
    } else if (valDragSlot < 0 && hs >= 0) {
      // Simple click (no drag started)
      if (dropVi !== undefined) {
        valEditIdx = (valEditIdx === dropVi) ? -1 : dropVi
      } else if (wheelCount < VAL_MAX) {
        // Click empty slot → add value there
        c.values.splice(wheelCount, 0, {label:"New item", icon:"", slot: hs})
        valEditIdx = wheelCount
      }
    } else if (valDragSlot >= 0 && hs >= 0 && hs === valDragSlot) {
      // Click (no move) on occupied slot → toggle select
      if (dragVi !== undefined) valEditIdx = (valEditIdx === dragVi) ? -1 : dragVi
    }
    valDragSlot = -1; valDropSlot = -1
    valCanvas.style.cursor = "pointer"
    drawValueWheel()
    renderCatEdit()
  })
  valCanvas.addEventListener("mouseleave", () => {
    if (valDragSlot >= 0) {
      valDragSlot = -1; valDropSlot = -1
      valCanvas.style.cursor = "pointer"
      drawValueWheel()
    }
  })

  drawValueWheel()

  // ─── Wire category fields ────────────────────────────────────────────────
  document.getElementById("nkdEditName").addEventListener("input", function() {
    c.label = this.value
    c.key = this.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "cat"
    renderCatList()
  })
  document.getElementById("nkdEditColor").addEventListener("input", function() {
    c.color = this.value
    renderCatList(); drawValueWheel()
  })

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

  // ─── Wire value wheel add ────────────────────────────────────────────────
  const wheelAddBtn = document.getElementById("nkdValWheelAdd")
  if (wheelAddBtn) {
    wheelAddBtn.addEventListener("click", () => {
      ensureSlots(c)
      const bs = backSlotFill()
      const usedSlots = new Set(c.values.slice(0, wheelCount).map(v => v.slot))
      let freeSlot = 0
      for (let s = 0; s < 8; s++) { if (s !== bs && !usedSlots.has(s)) { freeSlot = s; break } }
      c.values.splice(wheelCount, 0, {label:"New item", icon:"", slot: freeSlot})
      valEditIdx = wheelCount
      renderCatEdit()
    })
  }

  // ─── Wire selected value editor ──────────────────────────────────────────
  const valInput = document.getElementById("nkdValEditInput")
  const valAc = document.getElementById("nkdValAc")
  if (valInput && valAc) {
    let acIdx = -1
    valInput.addEventListener("input", function() {
      c.values[valEditIdx].label = this.value
      drawValueWheel()
      const q = this.value.trim()
      if (q.length < 2) { valAc.classList.remove("open"); return }
      const matches = searchNodes(q, 15)
      if (!matches.length) {
        valAc.innerHTML = `<div class="nkd-ac-empty">No nodes matching "${esc(q)}"</div>`
      } else {
        valAc.innerHTML = matches.map(m =>
          `<div class="nkd-ac-item" data-type="${esc(m.type)}">${highlightMatch(m.title, q)}<span style="opacity:.4;font-size:10px;margin-left:6px">${esc(m.type)}</span></div>`
        ).join("")
      }
      acIdx = -1
      valAc.classList.add("open")
    })
    valInput.addEventListener("keydown", function(e) {
      if (!valAc.classList.contains("open")) return
      const items = valAc.querySelectorAll(".nkd-ac-item")
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
        c.values[valEditIdx].label = items[acIdx].dataset.type
        valInput.value = items[acIdx].dataset.type
        valAc.classList.remove("open")
        drawValueWheel()
      } else if (e.key === "Escape") {
        valAc.classList.remove("open")
      }
    })
    valAc.addEventListener("mousedown", function(e) {
      const item = e.target.closest(".nkd-ac-item")
      if (!item) return
      e.preventDefault()
      c.values[valEditIdx].label = item.dataset.type
      valInput.value = item.dataset.type
      valAc.classList.remove("open")
      drawValueWheel()
    })
    valInput.addEventListener("blur", () => { setTimeout(() => valAc.classList.remove("open"), 150) })
    valInput.focus()
    valInput.select()
  }
  const valShortInput = document.getElementById("nkdValShort")
  if (valShortInput) {
    valShortInput.addEventListener("input", function() {
      const v = this.value.slice(0, 5)
      this.value = v
      c.values[valEditIdx].short = v || undefined
      if (!v) delete c.values[valEditIdx].short
      drawValueWheel()
    })
  }

  // Wire value icon picker
  const valIconBtn = catEditEl.querySelector(".nkd-val-icon-btn")
  if (valIconBtn && valEditIdx >= 0) {
    valIconBtn.addEventListener("click", function(e) {
      e.stopPropagation()
      closeAllIconGrids()
      const grid = document.getElementById("nkdValIconGridSel")
      positionGrid(grid, this)
      grid.classList.toggle("open")
      renderIconCells("nkdValIconGridSel", "", "")
      wireIconGridFilters("nkdValIconGridSel")
      markActive("nkdValIconGridSel", c.values[valEditIdx].icon)
    })
    const valIconGrid = document.getElementById("nkdValIconGridSel")
    if (valIconGrid) {
      valIconGrid.addEventListener("click", function(e) {
        const cell = e.target.closest(".nkd-icon-cell")
        if (!cell) return
        c.values[valEditIdx].icon = cell.dataset.icon
        drawValueWheel(); renderCatEdit()
      })
    }
  }

  // Wire delete selected value
  const valDelBtn = document.getElementById("nkdValDel")
  if (valDelBtn) {
    valDelBtn.addEventListener("click", () => {
      const v = c.values[valEditIdx]
      const name = v ? (typeof v === "string" ? v : v.label) : ""
      if (!confirm("Remove \"" + name + "\" from this category?")) return
      c.values.splice(valEditIdx, 1)
      valEditIdx = -1
      renderCatEdit()
    })
  }

  // Wire demote (move from wheel to auxiliary)
  const valDemoteBtn = document.getElementById("nkdValDemote")
  if (valDemoteBtn) {
    valDemoteBtn.addEventListener("click", () => {
      const v = c.values.splice(valEditIdx, 1)[0]
      c.values.push(v)
      valEditIdx = -1
      renderCatEdit()
    })
  }

  // ─── Wire auxiliary list ─────────────────────────────────────────────────
  catEditEl.querySelectorAll("[data-aux-promote]").forEach(btn => {
    btn.addEventListener("click", () => {
      const ai = parseInt(btn.dataset.auxPromote)
      if (wheelCount >= VAL_MAX) return
      ensureSlots(c)
      const bs = backSlotFill()
      const usedSlots = new Set(c.values.slice(0, wheelCount).map(v => v.slot))
      let freeSlot = 0
      for (let s = 0; s < 8; s++) { if (s !== bs && !usedSlots.has(s)) { freeSlot = s; break } }
      const v = c.values.splice(ai, 1)[0]
      v.slot = freeSlot
      c.values.splice(wheelCount, 0, v)
      valEditIdx = wheelCount
      renderCatEdit()
    })
  })
  catEditEl.querySelectorAll("[data-aux-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const ai = parseInt(btn.dataset.auxDel)
      const v = c.values[ai]
      const name = v ? (typeof v === "string" ? v : v.label) : ""
      if (!confirm("Remove \"" + name + "\"?")) return
      c.values.splice(ai, 1)
      renderCatEdit()
    })
  })

  catEditEl.querySelectorAll("[data-aux-select]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return
      valEditIdx = parseInt(row.dataset.auxSelect)
      renderCatEdit()
    })
  })

  const auxAddBtn = document.getElementById("nkdValAuxAdd")
  if (auxAddBtn) {
    auxAddBtn.addEventListener("click", () => {
      c.values.push({label:"New item", icon:""})
      valEditIdx = c.values.length - 1
      renderCatEdit()
    })
  }

  // ─── Wire delete category ────────────────────────────────────────────────
  document.getElementById("nkdDelCat").addEventListener("click", (e) => {
    const cat = editCats[editIdx]
    if (!confirm("Delete category \"" + (cat ? cat.label : "") + "\"?")) return
    editCats.splice(editIdx, 1)
    if (editIdx >= editCats.length) editIdx = editCats.length - 1
    valEditIdx = -1
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
      values:c.values.map(v => {
        const o = typeof v === "string" ? {label:v} : {label:v.label}
        if (v.icon) o.icon = v.icon
        if (typeof v.slot === "number") o.slot = v.slot
        if (v.short) o.short = v.short
        return (!o.icon && o.slot === undefined && !o.short) ? o.label : o
      })
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
  valEditIdx = -1
  radialCanvas = null; radialCtx = null
  valCanvas = null; valCtx = null
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
    function clientToGraph(cx, cy) {
      const gc = app.canvas
      if (!gc) return null
      const rect = gc.canvas?.getBoundingClientRect?.()
      if (!rect) return gc.graph_mouse
      const x = (cx - rect.left) / gc.ds.scale - gc.ds.offset[0]
      const y = (cy - rect.top) / gc.ds.scale - gc.ds.offset[1]
      return [x, y]
    }
    function linkUnderCursor() {
      const gc = app.canvas
      if (!gc?.graph) return false
      const gm = clientToGraph(_lastMX, _lastMY)
      if (!gm) return false
      // Walk all links and hit-test the spline at cursor position
      const links = gc.graph.links
      if (!links) return false
      for (const id in links) {
        const link = links[id]
        if (!link) continue
        const from = gc.graph.getNodeById(link.origin_id)
        const to = gc.graph.getNodeById(link.target_id)
        if (!from || !to) continue
        const op = from.getConnectionPos(false, link.origin_slot)
        const ip = to.getConnectionPos(true, link.target_slot)
        if (!op || !ip) continue
        const d = distToSpline(gm[0], gm[1], op, ip)
        if (d < 12) return true
      }
      return false
    }
    function distToSpline(mx, my, a, b) {
      // Approximate bezier as segments and return min distance
      const cx1 = a[0] + (b[0] - a[0]) * 0.5, cy1 = a[1]
      const cx2 = a[0] + (b[0] - a[0]) * 0.5, cy2 = b[1]
      let mind = Infinity
      let px = a[0], py = a[1]
      for (let t = 0.1; t <= 1.0; t += 0.1) {
        const it = 1 - t
        const x = it*it*it*a[0] + 3*it*it*t*cx1 + 3*it*t*t*cx2 + t*t*t*b[0]
        const y = it*it*it*a[1] + 3*it*it*t*cy1 + 3*it*t*t*cy2 + t*t*t*b[1]
        // dist to segment px,py → x,y
        const dx = x - px, dy = y - py
        const len2 = dx*dx + dy*dy
        let u = len2 > 0 ? ((mx-px)*dx + (my-py)*dy) / len2 : 0
        if (u < 0) u = 0; if (u > 1) u = 1
        const sx = px + u*dx, sy = py + u*dy
        const sd = (mx-sx)*(mx-sx) + (my-sy)*(my-sy)
        if (sd < mind) mind = sd
        px = x; py = y
      }
      return Math.sqrt(mind)
    }

    // Path A: Alt already held → pointerdown opens menu
    // Let LiteGraph process the event first (reroute creation, etc.),
    // then open the menu only if nothing happened.
    document.addEventListener("pointerdown", (e) => {
      _ptrDown = true
      _lastPtrId = e.pointerId
      _lastMX = e.clientX; _lastMY = e.clientY
      if (!e.altKey || e.button !== 0 || menuOpen) return
      if (nodeUnderCursor()) { e._nkdSkip = true; return }
      const gc = app.canvas
      const nodesBefore = gc?.graph?._nodes?.length || 0
      requestAnimationFrame(() => {
        if (menuOpen) return
        const nodesAfter = gc?.graph?._nodes?.length || 0
        if (nodesAfter > nodesBefore) return
        if (gc) gc.dragging_canvas = false
        openRadial(_lastMX, _lastMY)
      })
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
      if (nodeUnderCursor() || linkUnderCursor()) return
      const gc = app.canvas
      if (gc) {
        _pendingConnect = readConnecting(gc)
        gc.dragging_canvas = false
      }
      openRadial(_lastMX, _lastMY)
    }, true)

    console.log("[NKD Radial Menu] Loaded — Alt+Click to open")
  },

  nodeCreated(node) {
    const orig = node.getExtraMenuOptions
    node.getExtraMenuOptions = function(canvas, options) {
      const r = orig?.apply(this, arguments)
      const nodeType = this.comfyClass || this.type
      if (!nodeType) return r
      options.push(null) // separator
      options.push({
        content: "Add to Radial Menu",
        has_submenu: true,
        callback: (value, opts, e, menu) => {
          new LiteGraph.ContextMenu(
            cats.map(c => c.label),
            { event: e, parentMenu: menu, callback: (catLabel) => {
              const c = cats.find(x => x.label === catLabel)
              if (!c) return
              const existing = c.values.map(v => typeof v === "string" ? v : v.label)
              if (existing.includes(nodeType)) return
              c.values.push(nodeType)
              saveConfig(cats)
              cats = loadConfig()
            }}
          )
          return false
        }
      })
      return r
    }
  },
})
