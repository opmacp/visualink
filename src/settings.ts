import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem, TFile } from "obsidian";
import type VisualinkPlugin from "./main";
import { DEFAULT_SETTINGS, VisualinkSettings } from "./types";
import { LANGUAGE_NAMES, t } from "./i18n";

const BOOKMARKLET = "javascript:location.href='obsidian://visualink?url='+encodeURIComponent(location.href)";

export class VisualinkSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VisualinkPlugin) {
    super(app, plugin);
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof VisualinkSettings];
  }

  // Settings share data.json with the cards, so always save through persist().
  async setControlValue(key: string, value: unknown) {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    s[key] = key === "assetsFolder" ? String(value).trim() || DEFAULT_SETTINGS.assetsFolder : value;
    await this.plugin.saveSettings();
    if (key === "language") {
      this.plugin.applyLanguage();
      this.update();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("set.language"),
        aliases: ["language", "idioma", "English", "Español"],
        control: {
          type: "dropdown",
          key: "language",
          options: { auto: t("set.languageAuto"), ...LANGUAGE_NAMES },
        },
      },
      {
        name: t("set.cacheImages"),
        desc: t("set.cacheImagesDesc"),
        control: { type: "toggle", key: "cacheImages" },
      },
      {
        name: t("set.assetsFolder"),
        desc: t("set.assetsFolderDesc"),
        control: { type: "text", key: "assetsFolder", placeholder: DEFAULT_SETTINGS.assetsFolder },
      },
      {
        name: t("set.downloadMissing"),
        desc: t("set.downloadMissingDesc"),
        render: (setting) => {
          setting.addButton((b) => b.setButtonText(t("set.download")).onClick(() => void this.downloadMissing()));
        },
      },
      {
        name: t("set.defaultLayout"),
        control: {
          type: "dropdown",
          key: "defaultLayout",
          options: { grid: t("layout.grid"), list: t("layout.list"), compact: t("layout.compact") },
        },
      },
      { name: t("set.showDescriptions"), control: { type: "toggle", key: "showDescriptions" } },
      { name: t("set.confirmDelete"), control: { type: "toggle", key: "confirmDelete" } },
      {
        name: t("set.accent"),
        desc: t("set.accentDesc"),
        render: (setting) => this.renderAccent(setting),
      },
      {
        type: "group",
        heading: t("set.quickSave"),
        items: [
          {
            name: t("set.bookmarklet"),
            desc: createFragment((f) => {
              f.appendText(t("set.bookmarkletDesc"));
              f.createEl("pre", { cls: "vl-bookmarklet" }).createEl("code", { text: BOOKMARKLET });
            }),
            render: (setting) => {
              setting.addButton((b) =>
                b.setButtonText(t("set.copyBookmarklet")).onClick(async () => {
                  await navigator.clipboard.writeText(BOOKMARKLET);
                  new Notice(t("notice.copied"));
                }),
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("set.export"),
        items: [
          {
            name: t("set.exportNote"),
            desc: t("set.exportNoteDesc"),
            render: (setting) => {
              setting.addButton((b) => b.setButtonText(t("set.export")).onClick(() => void this.exportNote()));
            },
          },
        ],
      },
    ];
  }

  private renderAccent(setting: Setting) {
    const s = this.plugin.settings;
    setting
      .addColorPicker((c) =>
        c.setValue(s.accent || "#7c5cff").onChange(async (v) => {
          s.accent = v;
          await this.plugin.saveSettings();
        }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("rotate-ccw")
          .setTooltip(t("set.accentReset"))
          .onClick(async () => {
            s.accent = "";
            await this.plugin.saveSettings();
            this.update();
          }),
      );
  }

  private async downloadMissing() {
    if (!navigator.onLine) {
      new Notice(t("notice.needConnection"));
      return;
    }
    const todo = this.plugin.cards.filter((c) => (c.image && !c.imageLocal) || (c.favicon && !c.faviconLocal));
    new Notice(t("notice.downloadingImages", { n: todo.length }));
    for (const c of todo) await this.plugin.cacheAssets(c);
    await this.plugin.persist();
    new Notice(t("notice.done"));
  }

  private async exportNote() {
    const groups = new Map<string, string[]>();
    for (const c of this.plugin.cards) {
      const keys = c.tags.length ? c.tags : [t("set.untagged")];
      for (const k of keys) {
        const lines = groups.get(k) ?? [];
        lines.push(`- [${c.title.replace(/[[\]]/g, "")}](${c.url})${c.description ? ` — ${c.description}` : ""}`);
        groups.set(k, lines);
      }
    }
    let md = `# Visualink\n\n`;
    for (const [k, lines] of [...groups].sort()) md += `## ${k}\n${lines.join("\n")}\n\n`;
    const path = `Visualink/Export ${new Date().toISOString().slice(0, 10)}.md`;
    await this.plugin.ensureFolder("Visualink");
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.process(existing, () => md);
    else await this.app.vault.create(path, md);
    new Notice(t("notice.exported", { path }));
  }
}
