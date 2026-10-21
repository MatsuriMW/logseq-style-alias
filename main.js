/*
 * Logseq Style Alias（Logseq 风格别名）
 *
 * Obsidian 只按文件名解析双链：页面「Retrieval-Augmented Generation」设了别名 RAG，
 * 正文里直接写 [[RAG]] 还是断链，一点就新建一个空的 RAG.md，从此 [[RAG]] 全落到这个空页面上。
 * Logseq 不这样：别名和页面名是一回事，写哪个都进同一页。这个插件把 Obsidian 改成 Logseq 的行为：
 *
 *   · [[别名]] 没有同名文件 → 指向设了这个别名的页面（点击、悬停预览、嵌入、反链、关系图都认）
 *   · [[别名]] 有同名文件但它是空的（点断链误建出来的那种）→ 空页面让位，同样指向别名页面
 *   · 同名文件有内容 → 文件优先，不动
 *   · 两个页面抢同一个别名 → 不替你选，照原样解析；命令「列出别名冲突」能看到是哪些
 *
 * 做法只有一处：接管 metadataCache.getFirstLinkpathDest。Obsidian 自己的点击跳转、isUnresolved、
 * resolvedLinks（关系图和反链数）、getBacklinksForFile 全走它，别的插件（反链、Dataview）也是，所以不用逐个改。
 * 改名时 Obsidian 更新链接用的是 getLinkpathDest（不接管），所以给页面改名不会把 [[RAG]] 改写成新文件名。
 *
 * 大小写：默认不分（和 Obsidian 解析文件名一致）；别名页面里「大小写敏感」属性为 true 的，只认一模一样的写法。
 * 正文一个字都不改；关掉插件就回到 Obsidian 原来的解析。
 */

"use strict";

const { Plugin, PluginSettingTab, Setting, Notice, Modal, TFile, parseFrontMatterAliases } = require("obsidian");

const DEFAULTS = {
	emptyYields: true,              // 同名空页面让位给别名页面
	caseProperty: "case-sensitive", // 别名页面里这个属性为 true 时，只认大小写完全一致的写法
};

// 界面文字跟着 Obsidian 的界面语言走：中文界面显示中文，其余显示英文
const STRINGS = {
	en: {
		cmdTrash: "Delete empty pages named after an alias",
		cmdConflicts: "List alias conflicts",
		noShadows: "No empty pages share a name with an alias.",
		trashed: (n) => `Deleted ${n} empty ${n === 1 ? "page" : "pages"} named after an alias:`,
		conflictsTitle: (n) => `Alias conflicts (${n})`,
		noConflicts: "No conflicts.",
		conflictsDesc: "These names point to more than one page with content, so links to them resolve the way Obsidian normally does. Merge the pages or remove one of the aliases.",
		aliasOf: " — alias of ",
		samePage: "; page with the same name: ",
		sep: ", ",
		emptyName: "Empty pages give way to aliases",
		emptyDesc: "When [[alias]] matches an empty page (the kind created by clicking an unresolved link), open the page that has the alias instead.",
		caseName: "Case-sensitivity property",
		caseDesc: "When this property is true on a page, its aliases only match links that use exactly the same case.",
	},
	zh: {
		cmdTrash: "清理与别名同名的空页面",
		cmdConflicts: "列出别名冲突",
		noShadows: "没有与别名同名的空页面",
		trashed: (n) => `已删除 ${n} 个与别名同名的空页面：`,
		conflictsTitle: (n) => `别名冲突（${n}）`,
		noConflicts: "没有冲突。",
		conflictsDesc: "这些名字同时指向多个有内容的页面，插件照 Obsidian 原样解析，不替你选。合并页面或删掉其中一个别名即可。",
		aliasOf: " — 别名在：",
		samePage: "；同名页面：",
		sep: "、",
		emptyName: "空页面让位给别名",
		emptyDesc: "[[别名]] 碰到同名的空页面（点断链误建的那种）时，照样指向设了这个别名的页面。",
		caseName: "大小写敏感属性",
		caseDesc: "页面里这个属性为 true 时，它的别名只认大小写完全一致的写法。",
	},
};

function lang() {
	let l = "";
	try { l = window.localStorage.getItem("language") || ""; } catch (e) { /* 读不到就用英文 */ }
	return l.startsWith("zh") ? STRINGS.zh : STRINGS.en;
}

module.exports = class LogseqStyleAlias extends Plugin {
	async onload() {
		this.t = lang();
		this.settings = Object.assign({}, DEFAULTS, await this.loadData());
		this.index = new Map();     // 小写别名 → [{ file, exact }]；exact 是开了大小写敏感时要求的原样写法，否则 null
		this.sig = "";              // 索引的指纹：别名表或空页面集合变了才重新解析全库链接
		this.active = true;

		// 接管链接解析。卸载时如果别的插件在我们之后又包了一层，没法把函数换回去，那就靠 active 让这层直接放行
		const mc = this.app.metadataCache;
		const orig = mc.getFirstLinkpathDest;
		const self = this;
		const patched = function (linkpath, sourcePath) {
			const f = orig.call(this, linkpath, sourcePath);
			if (!self.active) return f;
			if (f && !(self.settings.emptyYields && self.isEmpty(f))) return f;
			const t = self.lookup(linkpath);
			return t && t !== f ? t : f;
		};
		mc.getFirstLinkpathDest = patched;
		this.restore = () => {
			this.active = false;
			if (mc.getFirstLinkpathDest === patched) mc.getFirstLinkpathDest = orig;
		};

		const later = () => { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.rebuild(), 500); };
		this.registerEvent(mc.on("changed", later));
		this.registerEvent(mc.on("deleted", later));
		this.registerEvent(this.app.vault.on("rename", later));
		this.registerEvent(this.app.vault.on("create", later));
		this.app.workspace.onLayoutReady(() => this.rebuild());

		this.addCommand({ id: "trash-empty-alias-pages", name: this.t.cmdTrash, callback: () => this.trashEmptyShadows() });
		this.addCommand({ id: "list-alias-conflicts", name: this.t.cmdConflicts, callback: () => new ConflictModal(this, this.conflicts()).open() });
		this.addSettingTab(new AliasSettingTab(this.app, this));
	}

	onunload() {
		window.clearTimeout(this.timer);
		this.restore();
		this.reresolve();
	}

	// 空页面：除了空白什么都没有。只有属性（比如只写了 aliases）的不算空
	isEmpty(f) {
		if (!(f instanceof TFile) || f.extension !== "md") return false;
		const c = this.app.metadataCache.getFileCache(f);
		if (!c) return f.stat.size === 0;
		return !(c.sections && c.sections.length);
	}

	// 只管不带路径的写法：[[RAG]]、[[RAG.md]]；[[文件夹/RAG]] 是在指定文件，不替它改
	lookup(linkpath) {
		if (!linkpath || linkpath.includes("/")) return null;
		const name = linkpath.replace(/\.md$/i, "").trim();
		const hits = this.index.get(name.toLowerCase());
		if (!hits) return null;
		const ok = hits.filter((h) => h.exact === null || h.exact === name);
		return ok.length === 1 ? ok[0].file : null;
	}

	aliasesOf(f) {
		const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
		if (!fm) return [];
		const list = parseFrontMatterAliases(fm) || [];
		const v = fm[this.settings.caseProperty];
		const strict = v === true || v === "true";
		return list.map((a) => String(a).trim()).filter(Boolean).map((a) => ({ name: a, exact: strict ? a : null }));
	}

	rebuild() {
		const index = new Map();
		const empties = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (this.isEmpty(f)) { empties.push(f.path); continue; }
			for (const a of this.aliasesOf(f)) {
				const k = a.name.toLowerCase();
				if (k === f.basename.toLowerCase()) continue;
				const arr = index.get(k) || [];
				if (!arr.some((h) => h.file === f)) arr.push({ file: f, exact: a.exact });
				index.set(k, arr);
			}
		}
		this.index = index;
		const sig = JSON.stringify([...index].map(([k, v]) => [k, v.map((h) => h.file.path + "|" + h.exact)]).sort()) + empties.sort().join("|");
		if (sig === this.sig) return;
		this.sig = sig;
		this.reresolve();
	}

	// 别名表变了：全库链接重新解析一遍（关系图、反链数、断链样式跟着更新）
	reresolve() {
		const mc = this.app.metadataCache;
		for (const f of this.app.vault.getMarkdownFiles()) mc.resolveLinks(f.path);
		mc.trigger("resolved");
		this.app.workspace.updateOptions();
		this.app.workspace.iterateAllLeaves((l) => {
			const pm = l.view && l.view.previewMode;
			if (pm && pm.rerender) pm.rerender(true);
		});
	}

	// 和某个别名同名、内容为空、而且这个别名只归一个页面的文件（删掉后链接自动接到那个页面）
	emptyShadows() {
		const out = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (!this.isEmpty(f)) continue;
			const t = this.lookup(f.basename);
			if (t && t !== f) out.push({ file: f, target: t });
		}
		return out;
	}

	async trashEmptyShadows() {
		const list = this.emptyShadows();
		if (!list.length) { new Notice(this.t.noShadows); return; }
		for (const { file } of list) await this.app.fileManager.trashFile(file);
		new Notice(this.t.trashed(list.length) + "\n" + list.map((x) => `${x.file.basename} → ${x.target.basename}`).join("\n"), 15000);
	}

	// 冲突：一个别名归多个页面，或者别名和另一个有内容的页面同名
	conflicts() {
		const byName = new Map();
		for (const f of this.app.vault.getMarkdownFiles()) {
			const k = f.basename.toLowerCase();
			byName.set(k, (byName.get(k) || []).concat(f));
		}
		const out = [];
		for (const [k, hits] of this.index) {
			const owners = hits.map((h) => h.file);
			const named = (byName.get(k) || []).filter((f) => !this.isEmpty(f) && !owners.includes(f));
			if (owners.length > 1 || named.length) out.push({ alias: k, owners, named });
		}
		return out.sort((a, b) => a.alias.localeCompare(b.alias));
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.sig = "";
		this.rebuild();
	}
};

class ConflictModal extends Modal {
	constructor(plugin, list) { super(plugin.app); this.t = plugin.t; this.list = list; }
	onOpen() {
		const t = this.t;
		this.setTitle(t.conflictsTitle(this.list.length));
		if (!this.list.length) { this.contentEl.createEl("p", { text: t.noConflicts }); return; }
		this.contentEl.createEl("p", { text: t.conflictsDesc });
		const ul = this.contentEl.createEl("ul");
		for (const c of this.list) {
			const li = ul.createEl("li");
			li.createEl("b", { text: c.alias });
			li.appendText(t.aliasOf);
			c.owners.forEach((f, i) => { if (i) li.appendText(t.sep); this.link(li, f); });
			if (c.named.length) {
				li.appendText(t.samePage);
				c.named.forEach((f, i) => { if (i) li.appendText(t.sep); this.link(li, f); });
			}
		}
	}
	link(el, f) {
		const a = el.createEl("a", { text: f.path, href: "#" });
		a.addEventListener("click", (e) => { e.preventDefault(); this.app.workspace.getLeaf(false).openFile(f); this.close(); });
	}
	onClose() { this.contentEl.empty(); }
}

class AliasSettingTab extends PluginSettingTab {
	constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
	display() {
		const { containerEl: el, plugin } = this;
		const t = plugin.t;
		el.empty();
		new Setting(el)
			.setName(t.emptyName)
			.setDesc(t.emptyDesc)
			.addToggle((c) => c.setValue(plugin.settings.emptyYields).onChange(async (v) => { plugin.settings.emptyYields = v; await plugin.saveSettings(); }));
		new Setting(el)
			.setName(t.caseName)
			.setDesc(t.caseDesc)
			.addText((c) => c.setPlaceholder(DEFAULTS.caseProperty).setValue(plugin.settings.caseProperty).onChange(async (v) => { plugin.settings.caseProperty = v.trim() || DEFAULTS.caseProperty; await plugin.saveSettings(); }));
	}
}
