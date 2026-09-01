# 😺 NKD Radial Menu

A radial marking menu for ComfyUI. Hold Alt+Click on the canvas, drag to a category, drill into it, release on the node you want. It appears where your cursor is and places the node right there.

https://github.com/user-attachments/assets/19ea8fed-8255-4100-b075-65afda3a2ddc

## How it works

**Alt + Click** on empty canvas opens the menu. Hold the mouse button, drag toward a category to expand it, then release on the node to create it. The whole interaction is one gesture.

If you're already dragging an output and press Alt, the menu opens with the link still attached. Pick a node from the menu and it gets created and auto-connected to that output.

And don't worry about duplicating nodes. Alt+Click on a node does nothing, so it stays out of the way of other shortcuts.

## Install

### ComfyUI Manager

Search for **NKD Radial Menu** in the Manager and install.

### Manual

Clone into your `custom_nodes` folder and restart ComfyUI:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Nekodificador/NKD-Radial-Menu.git
```

## Configuration

<img width="709" height="504" alt="image" src="https://github.com/user-attachments/assets/15ea6fa8-8fb8-4071-92ea-de4a5032f809" />

Open **Settings** in ComfyUI. You'll find two entries under NKD Radial Menu:

**Color Palette** chooses the look of the menu. Five built-in palettes: `nkd` (colorful), `ink` (dark monochrome, the default), `paper` (light monochrome), `warm`, and `cool`.

**Configure Radial Menu** opens a modal where you can:

- Add, remove and reorder categories (up to 8)
- Drag categories on the radial preview to rearrange them
- Add nodes to each category with fuzzy search (searches by display name, the same names you see in ComfyUI's native search)
- Pick icons for categories and individual nodes
- Export and import the full configuration as JSON

## Default categories

The menu ships with 8 categories pre-configured:

| Category | Nodes |
|---|---|
| Loaders | Load Checkpoint, Load LoRA, CLIP Loader, VAE Loader, Load Image, Load Video |
| Preview | Preview Image, Save Image, Preview Audio |
| Samplers | KSampler, KSampler Advanced, Sampler Custom, Sampler Custom Advanced |
| Conditioning | CLIP Text Encode, Conditioning Combine, Conditioning Set Area, unCLIP Conditioning |
| Mask | Mask Composite, Invert Mask, Image to Mask, Mask to Image |
| Image | Image Scale, Image Scale By, Image Composite Masked, Image Crop, Image Batch |
| Latent | Empty Latent Image, Latent Upscale, Latent Upscale By, Latent Composite, VAE Decode, VAE Encode |
| Advanced | Reroute, Note, Primitive, Set, Get |

All of them are fully customizable.

## MCP Server (configure with an AI agent)

The extension includes an MCP server that lets any MCP-compatible agent (Claude Code, Claude Desktop, etc.) read and edit your radial menu configuration.

### Setup

```bash
cd ComfyUI/custom_nodes/NKD-Radial-Menu/mcp
npm install
```

Then add the server to your MCP client config:

**Claude Code** (run from your project directory):

```bash
claude mcp add nkd-radial-menu -- node ComfyUI/custom_nodes/NKD-Radial-Menu/mcp/mcp_server.mjs
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nkd-radial-menu": {
      "command": "node",
      "args": ["C:/path/to/ComfyUI/custom_nodes/NKD-Radial-Menu/mcp/mcp_server.mjs"]
    }
  }
}
```

The server reads and writes directly in ComfyUI's settings file (`user/default/comfy.settings.json`). Changes from the MCP and changes from the ComfyUI UI end up in the same place. Reload ComfyUI after editing via the MCP to pick up the new configuration.

If your ComfyUI installation is not at the default relative path, set `NKD_RADIAL_SETTINGS` to the full path of your `comfy.settings.json`.

### Available tools

| Tool | What it does |
|---|---|
| `get_config` | Read the full menu configuration |
| `set_config` | Replace the entire configuration |
| `add_category` | Add a new category (max 8) |
| `update_category` | Update a category by key or index |
| `remove_category` | Remove a category |
| `add_value` | Add a node to a category |
| `remove_value` | Remove a node from a category |
| `swap_categories` | Swap two categories by index |

Values are ComfyUI node type IDs (e.g. `KSampler`, `CLIPTextEncode`, `CheckpointLoaderSimple`). Icons are Lucide icon names from [lucide.dev/icons](https://lucide.dev/icons).

## License

MIT

## Credits

- [Lucide](https://lucide.dev/) for the icon set
