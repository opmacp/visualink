import { App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type VisualinkPlugin from "./main";
import { CollectionId, LinkCard } from "./types";
import { extractUrls } from "./metadata";
import { t } from "./i18n";

function parseTags(s: string): string[] {
  return [...new Set(s.split(/[,\s]+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
}

export class AddLinkModal extends Modal {
  constructor(app: App, private plugin: VisualinkPlugin) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(t("modal.addTitle"));
    this.contentEl.addClass("visualink-modal");
    let urlText = "";
    let tags = "";

    new Setting(this.contentEl)
      .setName(t("modal.links"))
      .setDesc(t("modal.linksDesc"))
      .addTextArea((field) => {
        field.setPlaceholder("https://…").onChange((v) => (urlText = v));
        field.inputEl.rows = 3;
        field.inputEl.addClass("vl-modal-wide");
        navigator.clipboard
          .readText()
          .then((c) => {
            if (extractUrls(c).length && !urlText) {
              field.setValue(c.trim());
              urlText = c.trim();
            }
          })
          .catch(() => {});
        window.setTimeout(() => field.inputEl.focus(), 10);
      });

    new Setting(this.contentEl)
      .setName(t("modal.tags"))
      .setDesc(t("modal.tagsDesc"))
      .addText((field) => field.setPlaceholder(t("modal.tagsPlaceholder")).onChange((v) => (tags = v)));

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText(t("modal.save"))
        .setCta()
        .onClick(async () => {
          const urls = extractUrls(urlText);
          if (!urls.length) return new Notice(t("notice.noValidLink"));
          this.close();
          await this.plugin.addUrls(urls, parseTags(tags));
          new Notice(urls.length === 1 ? t("notice.linkSaved") : t("notice.linksSaved", { n: urls.length }));
        }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Se abre al guardar un link sin conexión: tú pones el título. */
export class OfflineTitleModal extends Modal {
  private value: string;
  private resolve: ((t: string) => void) | null = null;

  constructor(app: App, private url: string, private suggestion: string) {
    super(app);
    this.value = suggestion;
  }

  /** Devuelve el título elegido. Si cierras la ventana, se usa la sugerencia: el link nunca se pierde. */
  ask(): Promise<string> {
    return new Promise((res) => {
      this.resolve = res;
      this.open();
    });
  }

  onOpen() {
    this.titleEl.setText(t("modal.offlineTitle"));
    this.contentEl.addClass("visualink-modal");
    this.contentEl.createEl("p", { cls: "vl-offline-url", text: this.url });
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t("modal.offlineDesc"),
    });
    new Setting(this.contentEl).setName(t("modal.title")).addText((field) => {
      field.setValue(this.value).onChange((v) => (this.value = v));
      field.inputEl.addClass("vl-modal-wide");
      field.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.close();
        }
      });
      window.setTimeout(() => {
        field.inputEl.focus();
        field.inputEl.select();
      }, 10);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(t("modal.save")).setCta().onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
    this.resolve?.(this.value.trim() || this.suggestion);
    this.resolve = null;
  }
}

export class EditCardModal extends Modal {
  private draft: LinkCard;
  constructor(app: App, private plugin: VisualinkPlugin, card: LinkCard) {
    super(app);
    this.draft = { ...card, tags: [...card.tags] };
  }

  onOpen() {
    const d = this.draft;
    this.titleEl.setText(t("modal.editTitle"));
    this.contentEl.addClass("visualink-modal");

    new Setting(this.contentEl).setName(t("modal.title")).addText((field) => {
      field.setValue(d.title).onChange((v) => (d.title = v));
      field.inputEl.addClass("vl-modal-wide");
    });
    new Setting(this.contentEl).setName(t("modal.description")).addTextArea((field) => {
      field.setValue(d.description).onChange((v) => (d.description = v));
      field.inputEl.rows = 3;
      field.inputEl.addClass("vl-modal-wide");
    });
    new Setting(this.contentEl).setName(t("modal.tags")).addText((field) => {
      field.setValue(d.tags.join(", ")).onChange((v) => (d.tags = parseTags(v)));
      field.inputEl.addClass("vl-modal-wide");
    });
    new Setting(this.contentEl).setName(t("modal.note")).addTextArea((field) => {
      field.setValue(d.note).onChange((v) => (d.note = v));
      field.inputEl.rows = 2;
      field.inputEl.addClass("vl-modal-wide");
    });
    new Setting(this.contentEl)
      .setName(t("modal.image"))
      .setDesc(t("modal.imageDesc"))
      .addText((field) => {
        field.setValue(d.image ?? "").onChange((v) => (d.image = v.trim() || undefined));
        field.inputEl.addClass("vl-modal-wide");
      });

    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("modal.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(t("modal.save"))
          .setCta()
          .onClick(async () => {
            const original = this.plugin.getCard(d.id);
            const imageChanged = original && original.image !== d.image;
            await this.plugin.updateCard(d.id, {
              title: d.title.trim() || d.domain,
              description: d.description,
              tags: d.tags,
              note: d.note,
              image: d.image,
              ...(imageChanged ? { imageLocal: undefined } : {}),
            });
            if (imageChanged && d.image && this.plugin.settings.cacheImages && navigator.onLine) {
              const c = this.plugin.getCard(d.id);
              if (c) {
                await this.plugin.cacheAssets(c);
                await this.plugin.persist();
              }
            }
            this.close();
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private onConfirm: () => void) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText("Visualink");
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("modal.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(t("card.delete"))
          .setDestructive()
          .onClick(() => {
            this.close();
            this.onConfirm();
          }),
      );
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Name prompt used to create or rename a collection. */
export class CollectionNameModal extends Modal {
  constructor(app: App, private heading: string, private value: string, private onSubmit: (name: string) => void | Promise<void>) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    this.contentEl.addClass("visualink-modal");
    const submit = () => {
      const name = this.value.trim();
      if (!name) return;
      this.close();
      void this.onSubmit(name);
    };
    new Setting(this.contentEl).setName(t("collection.name")).addText((field) => {
      field.setPlaceholder(t("collection.namePlaceholder")).setValue(this.value).onChange((v) => (this.value = v));
      field.inputEl.addClass("vl-modal-wide");
      field.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => field.inputEl.focus(), 10);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(t("collection.save")).setCta().onClick(submit));
  }

  onClose() {
    this.contentEl.empty();
  }
}

type PickerItem = { label: string; target: CollectionId | "none" | "new" };

/** "Move to collection…": pick one, go back to My list, or create a new one. */
export class CollectionPicker extends FuzzySuggestModal<PickerItem> {
  constructor(private plugin: VisualinkPlugin, private card: LinkCard) {
    super(plugin.app);
    this.setPlaceholder(t("collection.pick"));
  }

  getItems(): PickerItem[] {
    return [
      { label: t("collection.none"), target: "none" },
      ...this.plugin.collections.filter((c) => c.id !== this.card.collection).map((c) => ({ label: c.name, target: c.id })),
      { label: t("collection.newItem"), target: "new" },
    ];
  }

  getItemText(item: PickerItem): string {
    return item.label;
  }

  onChooseItem(item: PickerItem) {
    const move = async (id: CollectionId | undefined, name: string) => {
      await this.plugin.updateCard(this.card.id, { collection: id, archived: false });
      new Notice(t("notice.movedTo", { name }));
    };
    if (item.target === "new")
      new CollectionNameModal(this.app, t("collection.new"), "", async (name) => {
        const col = await this.plugin.addCollection(name);
        await move(col.id, col.name);
      }).open();
    else if (item.target === "none") void move(undefined, t("view.sectionAll"));
    else void move(item.target, item.label);
  }
}
