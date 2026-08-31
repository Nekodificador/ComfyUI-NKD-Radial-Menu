import { app } from "../../scripts/app.js"

// ─── NKD Radial Menu — ComfyUI Integration ─────────────────────────────────
//
// Opens a radial marking menu on the LiteGraph canvas. Pick a category, then
// a node type → LiteGraph.createNode + graph.add at the mouse position.
// Config lives in ComfyUI user settings. The nkdRadial standalone component
// does the rendering; this file wires it into the ComfyUI lifecycle.
// ────────────────────────────────────────────────────────────────────────────

const SETTING_PREFIX = "NKD.RadialMenu."

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
// nkd_radial.js and lucide_data.js are IIFE/UMD — they must load as classic
// scripts, not ES modules. We inject them dynamically and wait.

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
  if (!nodeType) return
  const node = LiteGraph.createNode(nodeType)
  if (!node) {
    console.warn(`[NKD Radial] Unknown node type: ${nodeType}`)
    return
  }
  const graph = app.canvas?.graph || app.graph
  graph.add(node)
  node.pos = [canvasX - node.size[0] / 2, canvasY - node.size[1] / 2]
  app.canvas?.setDirty?.(true, true)
  app.graph?.afterChange?.()
}

// ─── Radial lifecycle ───────────────────────────────────────────────────────

async function openRadial(screenX, screenY) {
  if (menuOpen) return
  await ensureScripts()
  if (typeof nkdRadial === "undefined") {
    console.warn("[NKD Radial] nkdRadial not loaded")
    return
  }
  cats = loadConfig()
  menuOpen = true
  openPos = screenToCanvas(screenX, screenY)

  let overlay = document.getElementById("nkd-radial-overlay")
  if (!overlay) {
    overlay = document.createElement("div")
    overlay.id = "nkd-radial-overlay"
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:auto;"
    document.body.appendChild(overlay)
  }
  overlay.style.display = "block"
  overlay.innerHTML = ""

  const radCanvas = document.createElement("canvas")
  radCanvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;"
  overlay.appendChild(radCanvas)

  const isDark = document.body.classList.contains("comfy-dark") ||
                 !document.body.classList.contains("comfy-light")

  nkdRadial(radCanvas, {
    categories: cats,
    centerX: screenX,
    centerY: screenY,
    style: "donut",
    gap: "normal",
    dark: isDark,
    onSelect(catKey, value) {
      closeRadial()
      addNodeAt(value, openPos[0], openPos[1])
    },
    onCancel() {
      closeRadial()
    },
  })
}

function closeRadial() {
  menuOpen = false
  const overlay = document.getElementById("nkd-radial-overlay")
  if (overlay) { overlay.style.display = "none"; overlay.innerHTML = "" }
}

// ─── Extension ──────────────────────────────────────────────────────────────

app.registerExtension({
  name: "NKD Radial Menu",

  commands: [
    {
      id: "nkd.radialMenu.open",
      label: "NKD Radial Menu: Open",
      function: () => {
        const canvas = app.canvas
        if (!canvas) return
        const rect = canvas.canvas?.getBoundingClientRect?.() || { left: 0, top: 0 }
        const mouse = canvas.graph_mouse || canvas.last_mouse || [400, 300]
        const [sx, sy] = canvasToScreen(mouse[0], mouse[1])
        openRadial(sx + rect.left, sy + rect.top)
      },
    },
  ],

  keybindings: [
    { combo: { key: "`" }, commandId: "nkd.radialMenu.open" },
  ],

  setup() {
    cats = loadConfig()
    ensureScripts()

    app.ui?.settings?.addSetting({
      id: SETTING_PREFIX + "Categories",
      name: "Radial Menu Categories",
      type: "hidden",
      defaultValue: JSON.stringify(DEFAULT_CATS),
    })

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menuOpen) {
        e.preventDefault()
        e.stopPropagation()
        closeRadial()
      }
    }, true)

    console.log("[NKD Radial Menu] Loaded — press ` (backtick) to open")
  },
})
