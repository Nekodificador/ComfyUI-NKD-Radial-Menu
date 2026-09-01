# 😺 NKD Radial Menu

A Maya-style radial marking menu for ComfyUI. Hold Alt+Click on the canvas, drag to a category, drill into it, release on the node you want. It appears where your cursor is and places the node right there.

<!-- hero video goes here -->

## How it works

**Alt + Click** on empty canvas opens the menu. Hold the mouse button, drag toward a category to expand it, then release on the node to create it. The whole interaction is one gesture.

If you're already dragging an output and press Alt, the menu opens with the link still attached. Pick a node from the menu and it gets created and auto-connected to that output.

Alt+Click on a node does nothing, so it stays out of the way of other shortcuts.

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

## License

MIT

## Credits

- [Lucide](https://lucide.dev/) for the icon set
