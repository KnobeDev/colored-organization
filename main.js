/**
 * Colored Organization — per-folder styling, background opacity sliders,
 * enhanced text contrast modes, and lock icons for KNOBE files.
 */
"use strict";

const { Plugin, Modal, FuzzySuggestModal, TFolder, TFile, Notice, Setting, PluginSettingTab } = require("obsidian");

const AUTO_PALETTE = [
  "#C2593F", "#3E6B5C", "#3E5C76", "#7A5E91", "#A66E2E", "#2E7D84",
  "#8A3E5F", "#5F7A3E", "#B3543E", "#3E6B7A", "#6B3E7A", "#7A6B3E",
];

const FALLBACK_SWATCHES = [
  "#C2593F", "#E08A70", "#A66E2E", "#D9A55E", "#8A6D00", "#D3B855",
  "#3E6B5C", "#86BFA8", "#15711B", "#7FC98B", "#2E7D84", "#7CC5CE",
  "#3E5C76", "#8FB3D1", "#1857C4", "#6FA8FF", "#7A5E91", "#B9A1D9",
  "#B3261E", "#FF8A80", "#B5560A", "#EDA15F", "#5B3FA8", "#C0A8EE",
];

const EMOJI_PRESETS = ["😂", "🔥", "💀", "🚀", "📚", "🎸", "🧪", "🎨", "🏴‍☠️", "✨", "🧠", "📌"];

const PATTERNS = {
  none:      { label: "None" },
  stripes:   { label: "Stripes" },
  dots:      { label: "Dots" },
  grid:      { label: "Grid" },
  checker:   { label: "Checker" },
  zigzag:    { label: "Zigzag" },
  waves:     { label: "Waves" },
  lines:     { label: "Lines" },
  crosshatch:{ label: "Crosshatch" },
};

const COLORED_TAGS_DATA = ".obsidian/plugins/colored-tags/data.json";

const LIGHT_BG = "#EFE6CB";
const DARK_BG = "#232323";
const AA = 4.5;

const KNOBE_MARKER_RE = /-----BEGIN KNOBE B(?:64)?-----|<!--\s*KNOBE_PAYLOAD_START\s*-->/;

/* ---------- color math ---------- */
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}
function mixRgb(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}
function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function ensureContrast(hex, bgHex, target) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const bgLum = luminance(hexToRgb(bgHex));
  const src = hexToRgb(hex);
  if (contrast(luminance(src), bgLum) >= target) return hex;
  const towards = bgLum > 0.5 ? [0, 0, 0] : [255, 255, 255];
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const t = (lo + hi) / 2;
    if (contrast(luminance(mixRgb(src, towards, t)), bgLum) >= target) hi = t;
    else lo = t;
  }
  return rgbToHex(mixRgb(src, towards, hi));
}

function cssEscapePath(p) {
  return p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function cssEscapeContent(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function patternCss(kind) {
  const C = "rgb(from var(--folder-color, #888) r g b / 0.13)";
  switch (kind) {
    case "stripes":
      return `background-image: repeating-linear-gradient(45deg, ${C} 0 6px, transparent 6px 14px);`;
    case "dots":
      return `background-image: radial-gradient(${C} 1.3px, transparent 1.4px); background-size: 11px 11px;`;
    case "grid":
      return `background-image: linear-gradient(${C} 1px, transparent 1px), linear-gradient(90deg, ${C} 1px, transparent 1px); background-size: 13px 13px;`;
    case "checker":
      return `background-image: repeating-conic-gradient(${C} 0% 25%, transparent 0% 50%); background-size: 16px 16px;`;
    case "zigzag":
      return `background-image: linear-gradient(135deg, ${C} 25%, transparent 25%), linear-gradient(225deg, ${C} 25%, transparent 25%), linear-gradient(45deg, ${C} 25%, transparent 25%), linear-gradient(315deg, ${C} 25%, transparent 25%); background-position: 7px 0, 7px 0, 0 0, 0 0; background-size: 14px 14px;`;
    case "waves":
      return `background-image: radial-gradient(circle at 100% 50%, transparent 20%, ${C} 21%, ${C} 30%, transparent 31%), radial-gradient(circle at 0% 50%, transparent 20%, ${C} 21%, ${C} 30%, transparent 31%); background-size: 22px 32px; background-position: 0 0, 0 16px;`;
    case "lines":
      return `background-image: repeating-linear-gradient(0deg, ${C} 0 1px, transparent 1px 7px);`;
    case "crosshatch":
      return `background-image: repeating-linear-gradient(45deg, ${C} 0 1px, transparent 1px 8px), repeating-linear-gradient(-45deg, ${C} 0 1px, transparent 1px 8px);`;
    default:
      return "";
  }
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

class ImagePickModal extends FuzzySuggestModal {
  constructor(app, onPick) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder("Pick an image from your vault (png, gif, webp…)");
  }
  getItems() {
    return this.app.vault.getFiles().filter((f) => IMAGE_EXTS.has(f.extension.toLowerCase()));
  }
  getItemText(f) {
    return f.path;
  }
  onChooseItem(f) {
    this.onPick(f.path);
  }
}

class FolderStyleModal extends Modal {
  constructor(app, plugin, folder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
    this.cfg = Object.assign({}, plugin.data.folders[folder.path]);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("folder-palette-modal");
    this.titleEl.setText(`Folder style — ${this.folder.path}`);

    /* --- Color --- */
    this.section(contentEl, "Folder color", "Auto-adjusted per light/dark mode so it always reads.");
    const swatches = await this.plugin.getSwatches();
    const grid = contentEl.createDiv({ cls: "folder-palette-grid", attr: { role: "group", "aria-label": "Color swatches" } });
    this.swatchEls = [];
    for (const hex of swatches) {
      const b = grid.createEl("button", { cls: "folder-palette-swatch", attr: { "aria-label": `Color ${hex}`, title: hex } });
      b.style.setProperty("--swatch", hex);
      b.dataset.hex = hex.toLowerCase();
      b.onclick = () => { this.cfg.color = hex; this.refreshSelection(); };
      this.swatchEls.push(b);
    }
    const row = contentEl.createDiv({ cls: "folder-palette-custom" });
    row.createEl("label", { text: "Custom", attr: { for: "fp-color" } });
    this.colorInput = row.createEl("input", { attr: { type: "color", id: "fp-color", value: this.cfg.color ?? "#C2593F" } });
    const use = row.createEl("button", { text: "Use" });
    use.onclick = () => { this.cfg.color = this.colorInput.value; this.refreshSelection(); };
    this.previewEl = row.createSpan({ cls: "folder-palette-preview" });

    /* --- Dark-mode override --- */
    const darkRow = contentEl.createDiv({ cls: "folder-palette-custom" });
    const darkChk = darkRow.createEl("input", { attr: { type: "checkbox", id: "fp-dark-auto" } });
    darkChk.checked = !this.cfg.darkColor;
    darkRow.createEl("label", { text: "Auto dark-mode color", attr: { for: "fp-dark-auto" } });
    this.darkInput = darkRow.createEl("input", { attr: { type: "color", id: "fp-dark", value: this.cfg.darkColor ?? "#D9A55E" } });
    this.darkInput.disabled = darkChk.checked;
    darkChk.onchange = () => {
      this.darkInput.disabled = darkChk.checked;
      if (darkChk.checked) delete this.cfg.darkColor;
      else this.cfg.darkColor = this.darkInput.value;
      this.refreshSelection();
    };
    this.darkInput.oninput = () => { this.cfg.darkColor = this.darkInput.value; this.refreshSelection(); };

    /* --- Font color --- */
    this.section(contentEl, "Font color", "Default: controlled by global setting.");
    const fontRow = contentEl.createDiv({ cls: "folder-palette-custom" });
    const fontChk = fontRow.createEl("input", { attr: { type: "checkbox", id: "fp-font-custom" } });
    fontChk.checked = !!this.cfg.textColor;
    fontRow.createEl("label", { text: "Custom font color", attr: { for: "fp-font-custom" } });
    this.fontInput = fontRow.createEl("input", { attr: { type: "color", id: "fp-font", value: this.cfg.textColor ?? "#2C261F" } });
    this.fontInput.disabled = !fontChk.checked;
    fontChk.onchange = () => {
      this.fontInput.disabled = !fontChk.checked;
      if (fontChk.checked) this.cfg.textColor = this.fontInput.value;
      else delete this.cfg.textColor;
    };
    this.fontInput.oninput = () => { this.cfg.textColor = this.fontInput.value; };

    /* --- Pattern --- */
    this.section(contentEl, "Background pattern", "Drawn from the folder's color.");
    const pats = contentEl.createDiv({ cls: "folder-palette-patterns", attr: { role: "group", "aria-label": "Background patterns" } });
    this.patternEls = {};
    for (const [key, meta] of Object.entries(PATTERNS)) {
      const b = pats.createEl("button", { cls: "folder-palette-pattern", text: meta.label, attr: { "aria-pressed": "false" } });
      if (key !== "none") b.style.cssText += patternCss(key).replace(/var\(--folder-color, #888\)/g, this.cfg.color ?? "#C2593F");
      b.onclick = () => {
        this.cfg.pattern = key === "none" ? undefined : key;
        if (!this.cfg.pattern) delete this.cfg.pattern;
        this.refreshSelection();
      };
      this.patternEls[key] = b;
    }

    /* --- Emoji --- */
    this.section(contentEl, "Emoji", "Shown before the folder name. Any emoji or short text.");
    const emRow = contentEl.createDiv({ cls: "folder-palette-custom" });
    this.emojiInput = emRow.createEl("input", {
      cls: "folder-palette-emoji-input",
      attr: { type: "text", placeholder: "🎸", maxlength: "8", "aria-label": "Folder emoji", value: this.cfg.emoji ?? "" },
    });
    this.emojiInput.oninput = () => {
      const v = this.emojiInput.value.trim();
      if (v) { this.cfg.emoji = v; delete this.cfg.icon; this.iconLabel?.setText("(none)"); }
      else delete this.cfg.emoji;
    };
    const presets = contentEl.createDiv({ cls: "folder-palette-emoji-presets" });
    for (const e of EMOJI_PRESETS) {
      const b = presets.createEl("button", { text: e, cls: "folder-palette-emoji-preset", attr: { "aria-label": `Use ${e}` } });
      b.onclick = () => {
        this.emojiInput.value = e;
        this.cfg.emoji = e;
        delete this.cfg.icon;
        this.iconLabel?.setText("(none)");
      };
    }

    /* --- Custom image icon --- */
    this.section(contentEl, "Custom image icon", "Your own vault image. Replaces the emoji.");
    const iconRow = contentEl.createDiv({ cls: "folder-palette-custom" });
    this.iconLabel = iconRow.createSpan({ cls: "folder-palette-icon-path", text: this.cfg.icon ?? "(none)" });
    const pick = iconRow.createEl("button", { text: "Choose image…" });
    pick.onclick = () =>
      new ImagePickModal(this.app, (path) => {
        this.cfg.icon = path;
        delete this.cfg.emoji;
        this.emojiInput.value = "";
        this.iconLabel.setText(path);
      }).open();
    const rmIcon = iconRow.createEl("button", { text: "Remove icon" });
    rmIcon.onclick = () => {
      delete this.cfg.icon;
      this.iconLabel.setText("(none)");
    };

    /* --- Actions --- */
    const actions = contentEl.createDiv({ cls: "folder-palette-actions" });
    const save = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    save.onclick = async () => {
      await this.plugin.setFolder(this.folder.path, Object.keys(this.cfg).length ? this.cfg : null);
      this.close();
    };
    if (this.plugin.data.folders[this.folder.path]) {
      const clear = actions.createEl("button", { text: "Clear styling (back to automatic)" });
      clear.onclick = async () => { await this.plugin.setFolder(this.folder.path, null); this.close(); };
    }
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();

    this.refreshSelection();
  }

  section(parent, title, hint) {
    const h = parent.createDiv({ cls: "folder-palette-section" });
    h.createEl("strong", { text: title });
    if (hint) h.createSpan({ cls: "folder-palette-hint", text: " — " + hint });
  }

  refreshSelection() {
    const cur = (this.cfg.color ?? "").toLowerCase();
    for (const b of this.swatchEls) b.toggleClass("is-current", b.dataset.hex === cur);
    for (const [key, b] of Object.entries(this.patternEls)) {
      b.setAttr("aria-pressed", String((this.cfg.pattern ?? "none") === key));
      b.toggleClass("is-current", (this.cfg.pattern ?? "none") === key);
    }
    if (this.cfg.color) {
      const lightC = ensureContrast(this.cfg.color, LIGHT_BG, AA);
      const darkC = this.cfg.darkColor ?? ensureContrast(this.cfg.color, DARK_BG, AA);
      this.previewEl.empty();
      const l = this.previewEl.createSpan({ cls: "folder-palette-chip", text: "day" });
      l.style.cssText = `background:${LIGHT_BG};color:${lightC};`;
      const d = this.previewEl.createSpan({ cls: "folder-palette-chip", text: "night" });
      d.style.cssText = `background:${DARK_BG};color:${darkC};`;
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ColoredOrganizationSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Colored Organization Settings" });

    new Setting(containerEl)
      .setName("Background mix / opacity strength")
      .setDesc("Control the intensity of the colored background tint mixed into folders (0% to 50%). Default: 5% light, 8% dark.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 50, 1)
          .setValue(this.plugin.data.bgOpacity ?? 5)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.data.bgOpacity = value;
            await this.plugin.persist();
          })
      );

    new Setting(containerEl)
      .setName("Text contrast mode")
      .setDesc("Choose how the title and text colors of custom-colored folders and child files are determined.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("match", "Match Folder Color (contrast adjusted)")
          .addOption("high-contrast", "High Contrast (pure White / Black)")
          .addOption("default", "Default Theme Text Color")
          .setValue(this.plugin.data.textColorMode ?? "match")
          .onChange(async (value) => {
            this.plugin.data.textColorMode = value;
            await this.plugin.persist();
          })
      );

    new Setting(containerEl)
      .setName("Show Knobe lock icon")
      .setDesc("Display a lock icon next to files that are cryptographically verified or marked as Knobe files.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.showKnobeLock ?? true)
          .onChange(async (value) => {
            this.plugin.data.showKnobeLock = value;
            await this.plugin.persist();
            this.plugin.decorateFileExplorer();
          })
      );

    new Setting(containerEl)
      .setName("Auto-color new folders")
      .setDesc("Automatically assign a color to newly created folders.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.autoColorNew ?? true)
          .onChange(async (value) => {
            this.plugin.data.autoColorNew = value;
            await this.plugin.persist();
          })
      );
  }
}

module.exports = class ColoredOrganizationPlugin extends Plugin {
  async onload() {
    const raw = (await this.loadData()) ?? {};
    
    // Migration from old Folder Palette data format
    if (raw.colors && !raw.folders) {
      raw.folders = {};
      for (const [p, c] of Object.entries(raw.colors)) raw.folders[p] = { color: c };
      delete raw.colors;
    }

    this.data = Object.assign({ 
      folders: {}, 
      autoIndex: 0, 
      autoColorNew: true,
      bgOpacity: 5,
      textColorMode: "match",
      showKnobeLock: true
    }, raw);

    this.knobeFilePaths = new Set();

    // Style elements for dynamic CSS
    this.styleEl = document.head.createEl("style", { attr: { id: "colored-organization-css" } });
    this.applyCss();

    // Context menu registry
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) =>
          item
            .setTitle("Set folder style…")
            .setIcon("palette")
            .onClick(() => new FolderStyleModal(this.app, this, file).open()),
        );
      }),
    );

    // Auto-color new folders
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (!this.data.autoColorNew) return;
          if (!(file instanceof TFolder) || file.path in this.data.folders) return;
          const color = this.nextAutoColor();
          this.data.folders[file.path] = { color };
          void this.persist();
          new Notice(`Folder colored ${color} — right-click to change.`);
        }),
      );

      // Start Knobe file scanner and explorer observers
      void this.initKnobeScanner();
      this.startFileExplorerObserver();
    });

    // Vault events for custom style persistence and Knobe file detection
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        let dirty = false;
        if (file instanceof TFolder && oldPath in this.data.folders) {
          this.data.folders[file.path] = this.data.folders[oldPath];
          delete this.data.folders[oldPath];
          dirty = true;
        }
        for (const cfg of Object.values(this.data.folders)) {
          if (cfg && cfg.icon === oldPath) {
            cfg.icon = file.path;
            dirty = true;
          }
        }
        // Sync Knobe file path rename
        if (file instanceof TFile && file.extension === "md") {
          if (this.knobeFilePaths.has(oldPath)) {
            this.knobeFilePaths.delete(oldPath);
            this.knobeFilePaths.add(file.path);
            this.decorateFileExplorer();
          }
        }
        if (dirty) void this.persist();
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        let dirty = false;
        if (file instanceof TFolder && file.path in this.data.folders) {
          delete this.data.folders[file.path];
          dirty = true;
        }
        if (file instanceof TFile && file.extension === "md") {
          if (this.knobeFilePaths.has(file.path)) {
            this.knobeFilePaths.delete(file.path);
            this.decorateFileExplorer();
          }
        }
        if (dirty) void this.persist();
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          try {
            const content = await this.app.vault.cachedRead(file);
            const isKnobe = this.hasKnobeMarker(content);
            const wasKnobe = this.knobeFilePaths.has(file.path);
            if (isKnobe !== wasKnobe) {
              if (isKnobe) this.knobeFilePaths.add(file.path);
              else this.knobeFilePaths.delete(file.path);
              this.decorateFileExplorer();
            }
          } catch (e) {}
        }
      }),
    );

    // Commands
    this.addCommand({
      id: "color-all-folders",
      name: "Color all folders now",
      callback: () => void this.colorAllFolders(),
    });
    
    this.addCommand({
      id: "clear-all-folder-colors",
      name: "Clear all folder styling (back to automatic cycle)",
      callback: async () => {
        const n = Object.keys(this.data.folders).length;
        this.data.folders = {};
        await this.persist();
        new Notice(`Cleared styling on ${n} folder${n === 1 ? "" : "s"}.`);
      },
    });

    this.addSettingTab(new ColoredOrganizationSettingsTab(this.app, this));
  }

  onunload() {
    this.styleEl?.remove();
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  nextAutoColor() {
    const color = AUTO_PALETTE[this.data.autoIndex % AUTO_PALETTE.length];
    this.data.autoIndex += 1;
    return color;
  }

  async colorAllFolders() {
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f) => f instanceof TFolder && f.path !== "/")
      .sort((a, b) => a.path.localeCompare(b.path));
    let assigned = 0;
    for (const f of folders) {
      if (this.data.folders[f.path]?.color) continue;
      this.data.folders[f.path] = Object.assign({}, this.data.folders[f.path], { color: this.nextAutoColor() });
      assigned += 1;
    }
    await this.persist();
    new Notice(
      assigned
        ? `Colored ${assigned} folder${assigned === 1 ? "" : "s"}. Right-click any folder to adjust.`
        : "Every folder already has a color. Right-click a folder to change it.",
    );
  }

  async setFolder(path, cfgOrNull) {
    if (cfgOrNull === null) delete this.data.folders[path];
    else this.data.folders[path] = cfgOrNull;
    await this.persist();
  }

  async persist() {
    await this.saveData(this.data);
    this.applyCss();
  }

  applyCss() {
    const rules = [];
    
    // Global background mix/opacity overrides
    const opacity = this.data.bgOpacity ?? 5;
    rules.push(`body { --folder-bg-mix: ${opacity}% !important; }`);

    for (const [p, cfg] of Object.entries(this.data.folders)) {
      if (!cfg || typeof cfg !== "object") continue;
      const sel = `.nav-folder:has(> .nav-folder-title[data-path="${cssEscapePath(p)}"])`;
      
      if (cfg.color) {
        const lightC = ensureContrast(cfg.color, LIGHT_BG, AA);
        const darkC = cfg.darkColor ?? ensureContrast(cfg.color, DARK_BG, AA);
        rules.push(`body.theme-light ${sel} { --folder-color: ${lightC} !important; }`);
        rules.push(`body.theme-dark ${sel} { --folder-color: ${darkC} !important; }`);
      }

      // Font color styling logic
      if (cfg.textColor) {
        // Folder style overrides text color explicitly
        rules.push(`body.theme-light ${sel} > .nav-folder-title { color: ${ensureContrast(cfg.textColor, LIGHT_BG, AA)} !important; }`);
        rules.push(`body.theme-dark ${sel} > .nav-folder-title { color: ${ensureContrast(cfg.textColor, DARK_BG, AA)} !important; }`);
      } else if (this.data.textColorMode === "high-contrast") {
        // High contrast mode: force clear black/white text
        rules.push(`body.theme-light ${sel} > .nav-folder-title { color: #1b1b1b !important; }`);
        rules.push(`body.theme-light ${sel} > .nav-folder-children .nav-file-title { color: #2c261f !important; }`);
        rules.push(`body.theme-dark ${sel} > .nav-folder-title { color: #ffffff !important; }`);
        rules.push(`body.theme-dark ${sel} > .nav-folder-children .nav-file-title { color: #e6e3dc !important; }`);
      } else if (this.data.textColorMode === "default") {
        // Let Obsidian default text colors apply
        rules.push(`body.theme-light ${sel} > .nav-folder-title { color: var(--text-normal) !important; }`);
        rules.push(`body.theme-light ${sel} > .nav-folder-children .nav-file-title { color: var(--text-muted) !important; }`);
        rules.push(`body.theme-dark ${sel} > .nav-folder-title { color: var(--text-normal) !important; }`);
        rules.push(`body.theme-dark ${sel} > .nav-folder-children .nav-file-title { color: var(--text-muted) !important; }`);
      } else {
        // Default (match folder color with contrast safety)
        if (cfg.color) {
          const lightText = ensureContrast(cfg.color, LIGHT_BG, AA);
          const darkText = cfg.darkColor ?? ensureContrast(cfg.color, DARK_BG, AA);
          rules.push(`body.theme-light ${sel} > .nav-folder-title { color: ${lightText} !important; }`);
          rules.push(`body.theme-dark ${sel} > .nav-folder-title { color: ${darkText} !important; }`);
          rules.push(`body.theme-light ${sel} > .nav-folder-children .nav-file-title { color: ${lightText} !important; }`);
          rules.push(`body.theme-dark ${sel} > .nav-folder-children .nav-file-title { color: ${darkText} !important; }`);
        }
      }

      if (cfg.pattern && PATTERNS[cfg.pattern]) {
        rules.push(`${sel} { ${patternCss(cfg.pattern)} }`);
      }

      if (cfg.icon && this.app.vault.getAbstractFileByPath(cfg.icon)) {
        const url = this.app.vault.adapter.getResourcePath(cfg.icon).replace(/"/g, '\\"');
        rules.push(
          `${sel} > .nav-folder-title .tree-item-inner::before { content: ""; display: inline-block; ` +
          `width: 1.15em; height: 1.15em; margin-right: 4px; vertical-align: -0.18em; ` +
          `background: url("${url}") center / contain no-repeat; }`,
        );
      } else if (cfg.emoji) {
        rules.push(`${sel} > .nav-folder-title .tree-item-inner::before { content: "${cssEscapeContent(cfg.emoji)} "; }`);
      }
    }
    this.styleEl.textContent = rules.join("\n");
  }

  async getSwatches() {
    try {
      const raw = await this.app.vault.adapter.read(COLORED_TAGS_DATA);
      const custom = JSON.parse(raw)?.palette?.custom;
      if (typeof custom === "string" && custom.length) {
        return custom.split(",").map((s) => s.trim()).filter((s) => /^#[0-9a-fA-F]{6}$/.test(s));
      }
    } catch (e) {}
    return FALLBACK_SWATCHES;
  }

  /* ---------- Knobe lock decoration & scanning logic ---------- */

  hasKnobeMarker(raw) {
    return KNOBE_MARKER_RE.test(raw);
  }

  async initKnobeScanner() {
    this.knobeFilePaths.clear();
    const files = this.app.vault.getMarkdownFiles();
    
    // Process markdown files incrementally to prevent UI freeze
    const CHUNK_SIZE = 50;
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (file) => {
          try {
            const raw = await this.app.vault.cachedRead(file);
            if (this.hasKnobeMarker(raw)) {
              this.knobeFilePaths.add(file.path);
            }
          } catch (e) {}
        })
      );
    }
    this.decorateFileExplorer();
  }

  startFileExplorerObserver() {
    // Observe left-split layout changes where file explorers reside
    const container = document.querySelector(".workspace-split.mod-left-split");
    if (!container) return;

    this.observer = new MutationObserver(() => {
      this.debouncedDecorate();
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true
    });

    this.debouncedDecorate = this.debounce(this.decorateFileExplorer.bind(this), 100);
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  decorateFileExplorer() {
    if (!this.data.showKnobeLock) {
      // Remove any existing lock elements if toggle is turned off
      document.querySelectorAll(".knobe-lock-icon").forEach((el) => el.remove());
      return;
    }

    const fileExplorerLeaves = this.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of fileExplorerLeaves) {
      const fileExplorer = leaf.view;
      if (!fileExplorer || !fileExplorer.fileItems) continue;

      for (const [path, item] of Object.entries(fileExplorer.fileItems)) {
        if (!item.titleEl) continue;

        const isKnobe = this.knobeFilePaths.has(path);
        let lockEl = item.titleEl.querySelector(".knobe-lock-icon");

        if (isKnobe) {
          if (!lockEl) {
            lockEl = document.createElement("span");
            lockEl.className = "knobe-lock-icon";
            lockEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
            
            const inner = item.titleEl.querySelector(".tree-item-inner") || item.titleEl;
            inner.prepend(lockEl);
          }
        } else {
          if (lockEl) {
            lockEl.remove();
          }
        }
      }
    }
  }
};
