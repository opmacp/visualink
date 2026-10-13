import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon, debounce } from "obsidian";
import type VisualinkPlugin from "./main";
import { CollectionId, LinkCard, Layout, Section, SortMode } from "./types";
import { extractUrls } from "./metadata";
import { CollectionNameModal, CollectionPicker, ConfirmModal, EditCardModal } from "./modals";
import { LANGUAGE_NAMES, LanguageSetting, t } from "./i18n";

export const VIEW_TYPE_VISUALINK = "visualink-view";
export const RIBBON_ICON = "link";

const isCollection = (s: Section): s is CollectionId => s.startsWith("col_");

type DropTarget =
  | { kind: "card"; el: HTMLElement; id: string }
  | { kind: "section"; el: HTMLElement; section: Section };

export class VisualinkView extends ItemView {
  plugin: VisualinkPlugin;
  layout: Layout;
  section: Section = "all";
  activeTag: string | null = null;
  query = "";

  private boardEl!: HTMLElement;
  private sectionsEl!: HTMLElement;
  private tagsEl!: HTMLElement;
  private countsEl!: HTMLElement;
  private offlineEl!: HTMLElement;
  /** Id of the card being dragged, if any. */
  private dragId: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VisualinkPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.layout = plugin.settings.defaultLayout;
  }

  getViewType() {
    return VIEW_TYPE_VISUALINK;
  }
  getDisplayText() {
    return "Visualink";
  }
  getIcon() {
    return RIBBON_ICON;
  }

  async onOpen() {
    const root = this.contentEl;
    root.addClass("visualink-root");

    // ---------- links dropped or pasted from outside ----------
    root.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!this.dragId) root.addClass("vl-drop");
    });
    root.addEventListener("dragleave", (e) => {
      if (e.target === root) root.removeClass("vl-drop");
    });
    root.addEventListener("drop", (e) => {
      e.preventDefault();
      root.removeClass("vl-drop");
      if (this.dragId) return;
      const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
      const urls = extractUrls(text);
      if (urls.length) void this.addHere(urls);
    });
    this.registerDomEvent(root, "paste", (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const urls = extractUrls(e.clipboardData?.getData("text") ?? "");
      if (urls.length) {
        e.preventDefault();
        void this.addHere(urls);
      }
    });
    root.tabIndex = 0;

    this.registerEvent(this.plugin.events.on("changed", () => this.render()));
    this.registerDomEvent(window, "online", () => this.render());
    this.registerDomEvent(window, "offline", () => this.render());

    this.buildUi();
  }

  /** Builds the toolbar and board. Called again when the UI language changes. */
  buildUi() {
    const root = this.contentEl;
    root.empty();
    if (this.plugin.settings.accent) root.setCssProps({ "--vl-accent": this.plugin.settings.accent });

    // ---------- top bar ----------
    const top = root.createDiv({ cls: "vl-top" });
    top.createDiv({ cls: "vl-brand", text: "Visualink" });

    const addWrap = top.createDiv({ cls: "vl-add" });
    setIcon(addWrap.createSpan({ cls: "vl-add-icon" }), "plus");
    const addInput = addWrap.createEl("input", { type: "text", placeholder: t("view.addPlaceholder"), cls: "vl-add-input" });
    addInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const urls = extractUrls(addInput.value);
      if (!urls.length) {
        new Notice(t("notice.notALink"));
        return;
      }
      addInput.value = "";
      void this.addHere(urls);
    });

    this.offlineEl = top.createDiv({ cls: "vl-offline", text: t("view.offline") });
    setIcon(this.offlineEl.createSpan({ cls: "vl-offline-icon" }), "wifi-off");

    const gear = top.createEl("button", { cls: "vl-icon-btn vl-gear", attr: { "aria-label": t("view.settings") } });
    setIcon(gear, "settings");
    gear.onclick = (e) => this.quickSettings().showAtMouseEvent(e);

    // ---------- toolbar ----------
    const bar = root.createDiv({ cls: "vl-bar" });
    this.sectionsEl = bar.createDiv({ cls: "vl-sections" });

    const tools = bar.createDiv({ cls: "vl-tools" });
    const search = tools.createDiv({ cls: "vl-search" });
    setIcon(search.createSpan(), "search");
    const sInput = search.createEl("input", { type: "search", placeholder: t("view.search"), value: this.query });
    sInput.addEventListener(
      "input",
      debounce(() => {
        this.query = sInput.value.toLowerCase();
        this.render();
      }, 120),
    );

    const sortBtn = tools.createEl("button", { cls: "vl-icon-btn", attr: { "aria-label": t("view.sort") } });
    setIcon(sortBtn, "arrow-up-down");
    sortBtn.onclick = (e) => this.sortMenu().showAtMouseEvent(e);

    const layouts = tools.createDiv({ cls: "vl-layouts" });
    const mkLayout = (l: Layout, icon: string, label: string) => {
      const b = layouts.createEl("button", { cls: "vl-icon-btn", attr: { "aria-label": label, "data-layout": l } });
      setIcon(b, icon);
      b.onclick = () => {
        this.layout = l;
        this.render();
      };
    };
    mkLayout("grid", "layout-grid", t("layout.grid"));
    mkLayout("list", "rows-3", t("layout.list"));
    mkLayout("compact", "list", t("layout.compact"));

    this.tagsEl = root.createDiv({ cls: "vl-tags" });
    this.countsEl = root.createDiv({ cls: "vl-status" });
    this.boardEl = root.createDiv({ cls: "vl-board" });

    this.render();
  }

  async onClose() {
    this.contentEl.empty();
  }

  /** New links land where you are: the active tag and collection. */
  private async addHere(urls: string[]) {
    await this.plugin.addUrls(urls, this.activeTag ? [this.activeTag] : [], isCollection(this.section) ? this.section : undefined);
  }

  // ---------- menus ----------
  private sortMenu(): Menu {
    const m = new Menu();
    const opts: [SortMode, string][] = [
      ["manual", t("view.sortManual")],
      ["newest", t("view.sortNewest")],
      ["oldest", t("view.sortOldest")],
      ["title", t("view.sortTitle")],
      ["domain", t("view.sortDomain")],
    ];
    for (const [k, label] of opts)
      m.addItem((i) =>
        i.setTitle(label).setChecked(this.plugin.settings.sort === k).onClick(async () => {
          this.plugin.settings.sort = k;
          await this.plugin.saveSettings();
        }),
      );
    return m;
  }

  private quickSettings(): Menu {
    const s = this.plugin.settings;
    const m = new Menu();
    m.addItem((i) => i.setTitle(t("set.language")).setIsLabel(true));
    for (const lang of ["auto", "en", "es"] as LanguageSetting[])
      m.addItem((i) =>
        i
          .setTitle(lang === "auto" ? t("set.languageAuto") : LANGUAGE_NAMES[lang])
          .setChecked(s.language === lang)
          .onClick(() => void this.plugin.changeLanguage(lang)),
      );
    m.addSeparator();
    const toggle = (key: "showDescriptions" | "cacheImages" | "confirmDelete", label: string) =>
      m.addItem((i) =>
        i.setTitle(label).setChecked(s[key]).onClick(async () => {
          s[key] = !s[key];
          await this.plugin.saveSettings();
        }),
      );
    toggle("showDescriptions", t("set.showDescriptions"));
    toggle("cacheImages", t("set.cacheImages"));
    toggle("confirmDelete", t("set.confirmDelete"));
    return m;
  }

  private collectionMenu(id: CollectionId): Menu {
    const col = this.plugin.getCollection(id);
    const m = new Menu();
    if (!col) return m;
    m.addItem((i) =>
      i.setTitle(t("collection.rename")).setIcon("pencil").onClick(() => {
        new CollectionNameModal(this.app, t("collection.rename"), col.name, (name) => void this.plugin.renameCollection(id, name)).open();
      }),
    );
    m.addItem((i) => {
      i.setTitle(t("collection.delete")).setIcon("trash-2").setWarning(true);
      i.onClick(() => {
        new ConfirmModal(this.app, t("collection.confirmDelete", { name: col.name }), () => {
          if (this.section === id) this.section = "all";
          void this.plugin.deleteCollection(id);
        }).open();
      });
    });
    return m;
  }

  /** "Move to top / up / down / bottom", relative to what's on screen. */
  private addMoveItems(m: Menu, card: LinkCard, list: LinkCard[]) {
    const i = list.findIndex((c) => c.id === card.id);
    const moves: [string, string, LinkCard | undefined, "before" | "after"][] = [
      [t("card.moveTop"), "arrow-up-to-line", i > 0 ? list[0] : undefined, "before"],
      [t("card.moveUp"), "arrow-up", list[i - 1], "before"],
      [t("card.moveDown"), "arrow-down", list[i + 1], "after"],
      [t("card.moveBottom"), "arrow-down-to-line", i < list.length - 1 ? list[list.length - 1] : undefined, "after"],
    ];
    m.addSeparator();
    for (const [label, icon, target, place] of moves)
      m.addItem((it) =>
        it
          .setTitle(label)
          .setIcon(icon)
          .setDisabled(!target)
          .onClick(() => target && void this.reorder(card.id, target.id, place)),
      );
  }

  // ---------- ordering ----------
  private compare(sort: SortMode): ((a: LinkCard, b: LinkCard) => number) | null {
    const by: Record<Exclude<SortMode, "manual">, (a: LinkCard, b: LinkCard) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      title: (a, b) => a.title.localeCompare(b.title),
      domain: (a, b) => a.domain.localeCompare(b.domain) || b.createdAt - a.createdAt,
    };
    return sort === "manual" ? null : by[sort];
  }

  /** Reordering switches to the custom order, starting from exactly what you see so nothing jumps. */
  private freezeOrder() {
    const cmp = this.compare(this.plugin.settings.sort);
    if (!cmp) return;
    this.plugin.cards.sort(cmp);
    if (this.section === "all") this.plugin.cards.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }

  private async reorder(id: string, targetId: string, place: "before" | "after") {
    this.freezeOrder();
    await this.plugin.moveCard(id, targetId, place);
  }

  private async swap(id: string, targetId: string) {
    this.freezeOrder();
    await this.plugin.swapCards(id, targetId);
  }

  private filtered(): LinkCard[] {
    let list = this.plugin.cards.slice();
    if (this.section === "archive") list = list.filter((c) => c.archived);
    else list = list.filter((c) => !c.archived);
    if (this.section === "pinned") list = list.filter((c) => c.pinned);
    if (isCollection(this.section)) list = list.filter((c) => c.collection === this.section);
    if (this.activeTag) list = list.filter((c) => c.tags.includes(this.activeTag as string));
    if (this.query) {
      const q = this.query;
      list = list.filter((c) =>
        [c.title, c.description, c.domain, c.siteName, c.note, c.url, ...c.tags].join(" ").toLowerCase().includes(q),
      );
    }
    const cmp = this.compare(this.plugin.settings.sort);
    if (cmp) {
      list.sort(cmp);
      // Outside the custom order, pinned cards float to the top of My list (like Brace)
      if (this.section === "all") list.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    }
    return list;
  }

  // ---------- drag to reorder ----------
  // Pointer events instead of native drag-and-drop: Obsidian's own drag manager also listens
  // to native drags (files, tabs, links), which made the first drag of a card bounce back.

  private clearDropMarks() {
    this.contentEl
      .querySelectorAll(".vl-swap-target, .is-drop-target")
      .forEach((el) => el.removeClasses(["vl-swap-target", "is-drop-target"]));
  }

  /** What's under the pointer: another card to swap with, or a section button. */
  private dropTargetAt(doc: Document, x: number, y: number): DropTarget | null {
    const hit = doc.elementFromPoint(x, y);
    const cardEl = hit?.closest<HTMLElement>(".vl-board .vl-card");
    if (cardEl?.dataset.id && cardEl.dataset.id !== this.dragId)
      return { kind: "card", el: cardEl, id: cardEl.dataset.id };
    const sectionEl = hit?.closest<HTMLElement>(".vl-section");
    if (sectionEl?.dataset.section) return { kind: "section", el: sectionEl, section: sectionEl.dataset.section as Section };
    return null;
  }

  private enableDrag(el: HTMLElement, card: LinkCard) {
    el.addEventListener("pointerdown", (down) => {
      // Mouse and pen only; on touch screens the ⋯ menu has the move options.
      if (down.button !== 0 || down.pointerType === "touch") return;
      if ((down.target as HTMLElement).closest(".vl-actions")) return;
      const win = el.win;
      const doc = el.doc;
      let ghost: HTMLElement | null = null;
      let target: DropTarget | null = null;
      const box = el.getBoundingClientRect();
      const grab = { x: down.clientX - box.left, y: down.clientY - box.top };

      const move = (e: PointerEvent) => {
        if (!ghost) {
          if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 6) return;
          ghost = el.cloneNode(true) as HTMLElement;
          ghost.addClass("vl-ghost");
          ghost.setCssProps({ "--vl-ghost-w": `${box.width}px` });
          this.contentEl.appendChild(ghost);
          el.addClass("is-dragging");
          doc.body.addClass("vl-dragging");
          this.dragId = card.id;
        }
        // Obsidian panes use `contain: strict`, so position the ghost relative to the view, not the screen.
        const origin = this.contentEl.getBoundingClientRect();
        ghost.setCssProps({ "--vl-x": `${e.clientX - grab.x - origin.left}px`, "--vl-y": `${e.clientY - grab.y - origin.top}px` });
        this.autoScroll(e.clientY);
        target = this.dropTargetAt(doc, e.clientX, e.clientY);
        this.clearDropMarks();
        if (target?.kind === "card") target.el.addClass("vl-swap-target");
        if (target?.kind === "section") target.el.addClass("is-drop-target");
      };

      const up = () => {
        win.removeEventListener("pointermove", move);
        win.removeEventListener("pointerup", up);
        if (!ghost) return;
        ghost.remove();
        el.removeClass("is-dragging");
        doc.body.removeClass("vl-dragging");
        this.clearDropMarks();
        this.dragId = null;
        // The click that follows a drag must not open the link.
        const swallow = (e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
        };
        win.addEventListener("click", swallow, { capture: true, once: true });
        win.setTimeout(() => win.removeEventListener("click", swallow, { capture: true }), 0);
        if (target?.kind === "card") void this.swap(card.id, target.id);
        if (target?.kind === "section") void this.dropOnSection(target.section, card.id);
      };

      win.addEventListener("pointermove", move);
      win.addEventListener("pointerup", up);
    });
  }

  /** Scrolls the board while dragging near its top or bottom edge. */
  private autoScroll(y: number) {
    const r = this.boardEl.getBoundingClientRect();
    if (y < r.top + 48) this.boardEl.scrollTop -= 14;
    else if (y > r.bottom - 48) this.boardEl.scrollTop += 14;
  }

  /** Dropping a card on a section moves it there. */
  private async dropOnSection(section: Section, id: string) {
    const name =
      section === "all" ? t("view.sectionAll") : section === "pinned" ? t("view.sectionPinned") : section === "archive" ? t("view.sectionArchive") : this.plugin.getCollection(section)?.name ?? "";
    if (section === "all") await this.plugin.updateCard(id, { archived: false, collection: undefined });
    else if (section === "pinned") await this.plugin.updateCard(id, { pinned: true, archived: false });
    else if (section === "archive") await this.plugin.updateCard(id, { archived: true, pinned: false });
    else await this.plugin.updateCard(id, { collection: section, archived: false });
    new Notice(t("notice.movedTo", { name }));
  }

  // ---------- render ----------
  private renderSections() {
    const cards = this.plugin.cards;
    const live = cards.filter((c) => !c.archived);
    this.sectionsEl.empty();
    const mk = (section: Section, label: string, icon: string, count: number) => {
      const b = this.sectionsEl.createEl("button", { cls: "vl-section" });
      b.toggleClass("is-active", this.section === section);
      setIcon(b.createSpan(), icon);
      b.createSpan({ text: label });
      b.createSpan({ cls: "vl-count", text: String(count) });
      b.onclick = () => {
        this.section = section;
        this.render();
      };
      b.dataset.section = section;
      if (isCollection(section))
        b.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.collectionMenu(section).showAtMouseEvent(e);
        });
    };
    mk("all", t("view.sectionAll"), "inbox", live.length);
    mk("pinned", t("view.sectionPinned"), "pin", live.filter((c) => c.pinned).length);
    for (const col of this.plugin.collections) mk(col.id, col.name, "folder", live.filter((c) => c.collection === col.id).length);
    mk("archive", t("view.sectionArchive"), "archive", cards.filter((c) => c.archived).length);

    const add = this.sectionsEl.createEl("button", { cls: "vl-icon-btn vl-new-collection", attr: { "aria-label": t("collection.new") } });
    setIcon(add, "plus");
    add.onclick = () =>
      new CollectionNameModal(this.app, t("collection.new"), "", async (name) => {
        const col = await this.plugin.addCollection(name);
        this.section = col.id;
        this.render();
      }).open();
  }

  private renderTags() {
    this.tagsEl.empty();
    const tags = this.plugin.allTags();
    if (this.activeTag && !tags.includes(this.activeTag)) this.activeTag = null;
    if (!tags.length) return;
    const allChip = this.tagsEl.createEl("button", { cls: "vl-chip", text: t("view.allTags") });
    allChip.toggleClass("is-active", !this.activeTag);
    allChip.onclick = () => {
      this.activeTag = null;
      this.render();
    };
    for (const tag of tags) {
      const chip = this.tagsEl.createEl("button", { cls: "vl-chip", text: `#${tag}` });
      chip.toggleClass("is-active", this.activeTag === tag);
      chip.onclick = () => {
        this.activeTag = this.activeTag === tag ? null : tag;
        this.render();
      };
    }
  }

  render() {
    if (!this.boardEl) return;
    if (isCollection(this.section) && !this.plugin.getCollection(this.section)) this.section = "all";
    this.offlineEl.toggleClass("is-visible", !navigator.onLine);
    this.renderSections();
    this.contentEl.querySelectorAll<HTMLElement>(".vl-layouts .vl-icon-btn").forEach((b) => {
      b.toggleClass("is-active", b.dataset.layout === this.layout);
    });
    this.renderTags();

    const list = this.filtered();
    const pending = this.plugin.cards.filter((c) => c.status === "pending").length;
    this.countsEl.setText(
      t(list.length === 1 ? "view.cardCount" : "view.cardCountMany", { n: list.length }) + (pending ? t("view.pending", { n: pending }) : ""),
    );

    this.boardEl.empty();
    this.boardEl.className = `vl-board visualink-${this.layout}`;
    if (!list.length) {
      const empty = this.boardEl.createDiv({ cls: "vl-empty" });
      setIcon(empty.createDiv({ cls: "vl-empty-icon" }), this.section === "archive" ? "archive" : "bookmark-plus");
      empty.createDiv({
        cls: "vl-empty-title",
        text: this.query || this.activeTag ? t("view.noMatch") : this.section === "archive" ? t("view.archiveEmpty") : t("view.listEmpty"),
      });
      if (!this.query && this.section !== "archive") empty.createDiv({ cls: "vl-empty-sub", text: t("view.emptyHint") });
      return;
    }
    for (const c of list) {
      const el = renderCard(this.boardEl, c, this.plugin, {
        showDescription: this.plugin.settings.showDescriptions,
        menu: (m) => this.addMoveItems(m, c, list),
      });
      this.enableDrag(el, c);
    }
  }
}

/* ------------------------------------------------------------------ */

interface CardOpts {
  compactActions?: boolean;
  showDescription?: boolean;
  /** Extra items the view adds to the card's menu. */
  menu?: (m: Menu) => void;
}

/** Calm, solid colors for cards without a cover. */
const PLACEHOLDER_COLORS = ["#e0625a", "#e98a4b", "#d3a53a", "#58a370", "#3a9b97", "#4a87cc", "#6c68d1", "#9c64c2", "#c95c8e", "#7b8592"];

function colorFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PLACEHOLDER_COLORS[h % PLACEHOLDER_COLORS.length];
}

export function openCard(plugin: VisualinkPlugin, card: LinkCard) {
  window.open(card.url, plugin.settings.openInNewTab ? "_blank" : "_self");
}

export function renderCard(parent: HTMLElement, card: LinkCard, plugin: VisualinkPlugin, opts: CardOpts = {}) {
  const el = parent.createDiv({ cls: "vl-card", attr: { "data-id": card.id } });
  el.toggleClass("is-pinned", card.pinned);
  el.toggleClass("is-pending", card.status === "pending");
  el.toggleClass("is-error", card.status === "error");
  el.toggleClass("is-manual", card.status === "manual");
  el.setAttr("title", card.url);

  // --- cover ---
  const cover = el.createDiv({ cls: "vl-cover" });
  const imgSrc = plugin.resource(card.imageLocal, card.image);
  const placeholder = () => {
    cover.empty();
    cover.addClass("is-placeholder");
    cover.setCssProps({ "--vl-ph": colorFor(card.domain) });
    cover.createSpan({ cls: "vl-ph-letter", text: (card.siteName || card.domain).charAt(0).toUpperCase() });
  };
  if (imgSrc) {
    const img = cover.createEl("img", { attr: { src: imgSrc, loading: "lazy", alt: "", draggable: "false" } });
    img.onerror = placeholder;
  } else if (card.status === "manual") {
    // Saved offline: a card without a cover (compact layout keeps a small initial to stay aligned).
    el.addClass("no-cover");
    placeholder();
  } else placeholder();
  if (card.status === "pending") cover.createDiv({ cls: "vl-shimmer" });
  if (card.pinned) setIcon(cover.createDiv({ cls: "vl-pin-badge" }), "pin");

  // --- body ---
  const body = el.createDiv({ cls: "vl-body" });
  const site = body.createDiv({ cls: "vl-site" });
  const fav = plugin.resource(card.faviconLocal, card.favicon);
  if (fav) {
    const fi = site.createEl("img", { cls: "vl-favicon", attr: { src: fav, alt: "", draggable: "false" } });
    fi.onerror = () => fi.remove();
  }
  site.createSpan({ text: card.siteName || card.domain });
  if (card.status === "manual") {
    const off = site.createSpan({ cls: "vl-manual", attr: { "aria-label": t("card.savedOffline") } });
    setIcon(off, "wifi-off");
  }
  if (card.status === "error") {
    const warn = site.createSpan({ cls: "vl-warn", attr: { "aria-label": t("card.readError") } });
    setIcon(warn, "alert-triangle");
  }

  body.createDiv({ cls: "vl-title", text: card.title || card.domain });
  if (opts.showDescription !== false && card.description) body.createDiv({ cls: "vl-desc", text: card.description });
  if (card.note) body.createDiv({ cls: "vl-note", text: card.note });

  if (card.tags.length) {
    const tg = body.createDiv({ cls: "vl-card-tags" });
    card.tags.forEach((tag) => tg.createSpan({ cls: "vl-tag", text: `#${tag}` }));
  }

  // --- actions ---
  const actions = el.createDiv({ cls: "vl-actions" });
  const act = (icon: string, label: string, fn: (e: MouseEvent) => void) => {
    const b = actions.createEl("button", { cls: "vl-act", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.onclick = (e) => {
      e.stopPropagation();
      fn(e);
    };
  };
  const showMenu = (e: MouseEvent) => cardMenu(plugin, card, opts.menu).showAtMouseEvent(e);
  if (!opts.compactActions) {
    act(card.pinned ? "pin-off" : "pin", card.pinned ? t("card.unpin") : t("card.pin"), () => void plugin.updateCard(card.id, { pinned: !card.pinned }));
    act(card.archived ? "archive-restore" : "archive", card.archived ? t("card.unarchive") : t("card.archive"), () =>
      void plugin.updateCard(card.id, { archived: !card.archived, pinned: card.archived ? card.pinned : false }),
    );
    act("pencil", t("card.edit"), () => new EditCardModal(plugin.app, plugin, card).open());
  }
  act("more-horizontal", t("card.more"), showMenu);

  el.addEventListener("click", () => openCard(plugin, card));
  el.addEventListener("auxclick", (e) => {
    if (e.button === 1) window.open(card.url, "_blank");
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showMenu(e);
  });
  return el;
}

function cardMenu(plugin: VisualinkPlugin, card: LinkCard, extra?: (m: Menu) => void): Menu {
  const m = new Menu();
  m.addItem((i) => i.setTitle(t("card.open")).setIcon("external-link").onClick(() => openCard(plugin, card)));
  m.addItem((i) =>
    i.setTitle(t("card.copyLink")).setIcon("copy").onClick(async () => {
      await navigator.clipboard.writeText(card.url);
      new Notice(t("notice.linkCopied"));
    }),
  );
  m.addItem((i) =>
    i.setTitle(t("card.copyMarkdown")).setIcon("file-text").onClick(async () => {
      await navigator.clipboard.writeText(`[${card.title}](${card.url})`);
      new Notice(t("notice.copiedMarkdown"));
    }),
  );
  m.addSeparator();
  m.addItem((i) => i.setTitle(t("card.editMenu")).setIcon("pencil").onClick(() => new EditCardModal(plugin.app, plugin, card).open()));
  m.addItem((i) =>
    i.setTitle(card.pinned ? t("card.unpin") : t("card.pin")).setIcon("pin").onClick(() => void plugin.updateCard(card.id, { pinned: !card.pinned })),
  );
  m.addItem((i) =>
    i
      .setTitle(card.archived ? t("card.unarchive") : t("card.archive"))
      .setIcon("archive")
      .onClick(() => void plugin.updateCard(card.id, { archived: !card.archived })),
  );
  m.addItem((i) => i.setTitle(t("card.moveToCollection")).setIcon("folder-input").onClick(() => new CollectionPicker(plugin, card).open()));
  m.addItem((i) =>
    i
      .setTitle(card.status === "manual" ? t("card.fetchCover") : t("card.refetch"))
      .setIcon(card.status === "manual" ? "image-plus" : "refresh-cw")
      .onClick(() => {
        if (!navigator.onLine) {
          new Notice(t("notice.needConnection"));
          return;
        }
        // Offline cards keep your title; only the cover and description are added.
        void plugin.enrich(card.id, { force: card.status !== "manual" });
      }),
  );
  extra?.(m);
  m.addSeparator();
  m.addItem((i) => {
    i.setTitle(t("card.delete")).setIcon("trash-2");
    i.setWarning(true);
    i.onClick(() => {
      if (!plugin.settings.confirmDelete) {
        void plugin.deleteCard(card.id);
        return;
      }
      new ConfirmModal(plugin.app, t("card.confirmDelete", { title: card.title }), () => void plugin.deleteCard(card.id)).open();
    });
  });
  return m;
}
