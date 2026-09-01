import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_KEY = "NKD Radial Menu.Categories";

// mcp/ -> NKD-Radial-Menu/ -> custom_nodes/ -> ComfyUI/
const COMFY_ROOT = resolve(__dirname, "..", "..", "..");
const DEFAULT_SETTINGS_PATH = resolve(COMFY_ROOT, "user", "default", "comfy.settings.json");

function settingsPath() {
  return process.env.NKD_RADIAL_SETTINGS || DEFAULT_SETTINGS_PATH;
}

function readCategories() {
  const all = JSON.parse(readFileSync(settingsPath(), "utf8"));
  const raw = all[SETTINGS_KEY];
  if (!raw) return [];
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function writeCategories(cats) {
  const p = settingsPath();
  const all = JSON.parse(readFileSync(p, "utf8"));
  all[SETTINGS_KEY] = JSON.stringify(cats);
  writeFileSync(p, JSON.stringify(all, null, 4) + "\n", "utf8");
}

function keyFrom(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "cat";
}

const server = new McpServer({ name: "nkd-radial-menu", version: "1.0.0" });

server.tool("get_config", "Get the radial menu categories from ComfyUI settings", {}, () => {
  const cats = readCategories();
  return { content: [{ type: "text", text: JSON.stringify(cats, null, 2) }] };
});

server.tool(
  "set_config",
  "Replace all radial menu categories (max 8)",
  { categories: z.array(z.object({
    key: z.string().optional(),
    label: z.string(),
    color: z.string(),
    icon: z.string().optional(),
    values: z.array(z.string()),
  })).max(8) },
  ({ categories }) => {
    const cats = categories.map(c => ({ ...c, key: c.key || keyFrom(c.label) }));
    writeCategories(cats);
    return { content: [{ type: "text", text: `Config replaced: ${cats.length} categories. Reload ComfyUI to see changes.` }] };
  }
);

server.tool(
  "add_category",
  "Add a new category (max 8). Returns error if full.",
  {
    label: z.string().describe("Display name"),
    color: z.string().describe("Hex color, e.g. #4ab4ff"),
    icon: z.string().optional().describe("Lucide icon name (see lucide.dev/icons)"),
    values: z.array(z.string()).optional().describe("Initial node type IDs"),
    position: z.number().int().min(0).max(7).optional().describe("Insert position (0-7), appends if omitted"),
  },
  ({ label, color, icon, values, position }) => {
    const cats = readCategories();
    if (cats.length >= 8) return { content: [{ type: "text", text: "Error: already 8 categories (max). Remove one first." }] };
    const cat = { key: keyFrom(label), label, color, icon: icon || "", values: values || [] };
    if (position !== undefined && position < cats.length) {
      cats.splice(position, 0, cat);
    } else {
      cats.push(cat);
    }
    writeCategories(cats);
    return { content: [{ type: "text", text: `Added "${label}" at position ${position ?? cats.length - 1}. Reload ComfyUI to see changes.` }] };
  }
);

server.tool(
  "update_category",
  "Update an existing category by key or index",
  {
    key: z.string().optional().describe("Category key"),
    index: z.number().int().min(0).max(7).optional().describe("Category index (0-7)"),
    label: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
    values: z.array(z.string()).optional().describe("Replaces all values if provided"),
  },
  ({ key, index, label, color, icon, values }) => {
    const cats = readCategories();
    let i = index ?? cats.findIndex(c => c.key === key);
    if (i < 0 || i >= cats.length) return { content: [{ type: "text", text: "Error: category not found." }] };
    const cat = cats[i];
    if (label) { cat.label = label; cat.key = keyFrom(label); }
    if (color) cat.color = color;
    if (icon !== undefined) cat.icon = icon;
    if (values) cat.values = values;
    writeCategories(cats);
    return { content: [{ type: "text", text: `Updated "${cat.label}". Reload ComfyUI to see changes.` }] };
  }
);

server.tool(
  "remove_category",
  "Remove a category by key or index",
  { key: z.string().optional(), index: z.number().int().min(0).max(7).optional() },
  ({ key, index }) => {
    const cats = readCategories();
    let i = index ?? cats.findIndex(c => c.key === key);
    if (i < 0 || i >= cats.length) return { content: [{ type: "text", text: "Error: category not found." }] };
    const removed = cats.splice(i, 1)[0];
    writeCategories(cats);
    return { content: [{ type: "text", text: `Removed "${removed.label}". Reload ComfyUI to see changes.` }] };
  }
);

server.tool(
  "add_value",
  "Add a node to a category",
  {
    key: z.string().optional().describe("Category key"),
    index: z.number().int().min(0).max(7).optional().describe("Category index"),
    value: z.string().describe("ComfyUI node type ID (e.g. KSampler, CLIPTextEncode)"),
  },
  ({ key, index, value }) => {
    const cats = readCategories();
    let i = index ?? cats.findIndex(c => c.key === key);
    if (i < 0 || i >= cats.length) return { content: [{ type: "text", text: "Error: category not found." }] };
    const cat = cats[i];
    if (cat.values.includes(value)) return { content: [{ type: "text", text: `"${value}" already exists in "${cat.label}".` }] };
    cat.values.push(value);
    writeCategories(cats);
    return { content: [{ type: "text", text: `Added "${value}" to "${cat.label}" (${cat.values.length} values). Reload ComfyUI to see changes.` }] };
  }
);

server.tool(
  "remove_value",
  "Remove a node from a category",
  {
    key: z.string().optional(),
    index: z.number().int().min(0).max(7).optional(),
    value: z.string().describe("Node type ID to remove"),
  },
  ({ key, index, value }) => {
    const cats = readCategories();
    let i = index ?? cats.findIndex(c => c.key === key);
    if (i < 0 || i >= cats.length) return { content: [{ type: "text", text: "Error: category not found." }] };
    const cat = cats[i];
    const vi = cat.values.indexOf(value);
    if (vi < 0) return { content: [{ type: "text", text: `"${value}" not found in "${cat.label}".` }] };
    cat.values.splice(vi, 1);
    writeCategories(cats);
    return { content: [{ type: "text", text: `Removed "${value}" from "${cat.label}". Reload ComfyUI to see changes.` }] };
  }
);

server.tool(
  "swap_categories",
  "Swap two categories by index",
  { a: z.number().int().min(0).max(7), b: z.number().int().min(0).max(7) },
  ({ a, b }) => {
    const cats = readCategories();
    if (a >= cats.length || b >= cats.length) return { content: [{ type: "text", text: "Error: index out of range." }] };
    [cats[a], cats[b]] = [cats[b], cats[a]];
    writeCategories(cats);
    return { content: [{ type: "text", text: `Swapped position ${a} and ${b}. Reload ComfyUI to see changes.` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
