import {
  createApp,
  ref,
  toRaw,
  reactive,
  computed,
  watch,
  onMounted,
  nextTick,
} from "https://unpkg.com/vue@3.6.0-alpha.6/dist/vue.esm-browser.js";
import { marked } from "https://unpkg.com/marked@17.0.1/lib/marked.esm.js";
import { install as VueMonacoEditorPlugin } from "https://unpkg.com/@guolao/vue-monaco-editor@1.6.0/lib/es/index.js";

function addStyle(href) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  return new Promise((resolve) => (link.onload = resolve));
}

const app = createApp({
  setup() {
    const isPanelCollapsed = ref(false);
    const categories = ref([]);
    const notes = ref([]);
    const currentCategory = ref(null);
    const currentNote = ref(
      window.location.pathname.includes("/note/") ? { name: "Loading" } : null,
    );
    const isEditing = ref(false);
    const isAuthenticated = ref(false);
    const editContent = ref("");
    const editTitle = ref("");
    const editor = ref(null);
    const monacoEditor = ref(null);

    const showSettings = ref(false);
    const showSetIconPopup = ref(false);
    const showCreateModal = ref(false);
    const showDeleteConfirm = ref(false);
    const showChatPanel = ref(false);
    const showPreview = ref(false);
    const showLinkModal = ref(false);
    const showFindReplace = ref(false);
    const showTranslateModal = ref(false);
    const llmPrompt = ref("");
    const llmLoading = ref(false);
    const linkSuggestions = ref([]);
    const notesLoading = ref(false);
    const forceUpdate = ref(0);
    const chatMessages = ref([]);
    const chatIncludeDoc = ref(true);
    const chatUseTools = ref(false);
    const translateLangMode = ref("en");
    const translateCustomLang = ref("");
    const translateNoteRef = ref(null);
    const searchQuery = ref("");
    const searchResults = ref([]);
    const searchLoading = ref(false);
    let searchTimeout = null;
    let translations = reactive({ en: {}, ru: {} });

    const contextMenu = reactive({
      visible: false,
      x: 0,
      y: 0,
      note: null,
      category: null,
      type: null, // 'note' or 'category'
    });

    const draftRecovery = reactive({
      show: false,
      charDiff: 0,
      content: "",
    });

    let autoSaveInterval = null;
    let originalNoteContent = "";

    const settings = reactive({
      theme: "dark",
      language: "en",
      hue_shift: 0,
      encryptionKey: "",
      saveEncryptionKey: true,
    });

    const llmSettings = reactive({
      provider: "",
      apiKey: "",
      endpoint: "",
      model: "",
    });

    const createForm = reactive({
      name: "",
      icon: "folder",
      customIcon: "",
    });

    const linkForm = reactive({
      text: "",
      url: "",
    });

    const findReplaceForm = reactive({
      find: "",
      replace: "",
      regex: false,
      caseSensitive: false,
    });

    const editorOptions = {
      minimap: { enabled: false },
      fontSize: 14,
      wordWrap: "on",
      lineNumbers: "on",
      automaticLayout: true,
      padding: { top: 16 },
    };

    const defaultLightIcons = reactive([
      "folder",
      "file-text",
      "code",
      "book",
      "bookmark",
      "star",
      "archive",
      "clipboard",
      "terminal",
      "database",
      "lock",
    ]);
    const defaultDevIcons = reactive([
      "javascript-plain",
      "typescript-plain",
      "python-plain",
      "googlecolab-plain",
    ]);

    const t = (key) =>
      translations[settings.language]?.[key] || translations?.en[key] || key;

    const isDevicon = (icon) => icon && icon.startsWith("devicon-");

    const cache = new Map();
    const __ref = Symbol();

    function setPrivateProperty(obj, prop, value) {
      const raw = toRaw(obj);
      if (!raw[__ref]) raw[__ref] = {};
      if (!raw[__ref][prop]) raw[__ref][prop] = ref(value);
      else raw[__ref][prop].value = value;
      const secretRef = raw[__ref][prop];

      Object.defineProperty(raw, prop, {
        get() {
          return secretRef.value;
        },
        set(v) {
          secretRef.value = v;
        },
        enumerable: false,
        configurable: true,
      });
    }

    async function fetchOnce(url, opts) {
      let c = cache.get(url);
      if (!c) {
        const r = await fetch(url, opts);
        const b = await r.clone().arrayBuffer();
        c = { b, h: r.headers, s: r.status, t: r.statusText };
        cache.set(url, c);
      }
      return new Response(c.b.slice(0), {
        status: c.s,
        statusText: c.t,
        headers: c.h,
      });
    }

    const logoFilter = computed(() => {
      if (settings.hue_shift === 0) return "none";
      return `hue-rotate(${settings.hue_shift}deg)`;
    });

    const loadMoreIcons = async () => {
      if (defaultLightIcons.length >= 20) return;
      let devicons = (
        await (
          await fetchOnce("https://unpkg.com/devicon@2.17.0/devicon.json")
        ).json()
      ).map((x) => x.name + "-" + x.versions.font[0]);
      let lighticons = await (
        await fetchOnce(
          "https://unpkg.com/light-icons@1.0.12/dist/light-icon_list.json",
        )
      ).json();
      defaultDevIcons.push(...devicons);
      defaultLightIcons.push(...lighticons);
    };

    // Filter notes by language suffix (only for non-authenticated/reader users)
    // Notes without suffix = English (default), notes with __xx = that language only
    const filteredNotes = computed(() => {
      // Authenticated users see all notes
      if (isAuthenticated.value) return notes.value;
      // Non-authenticated users see language-filtered notes
      return notes.value.filter((note) => {
        const name = note.name || "";
        const langMatch = name.match(/__([a-z]{2})(?:\.md)?$/i);
        if (!langMatch) {
          // No suffix = English content
          return settings.language === "en";
        }
        const noteLang = langMatch[1].toLowerCase();
        return noteLang === settings.language;
      });
    });

    const stripMd = (name) => name?.replace(/\.md$/i, "") || "";

    const displayNoteName = (name) => {
      let n = stripMd(name);
      // Remove language suffix for display
      n = n.replace(/__[a-z]{2}$/i, "");
      return n;
    };

    const getNoteLangCode = (name) => {
      if (!name) return null;
      const match = name.match(/__([a-z]{2})(?:\.md)?$/i);
      return match ? match[1].toUpperCase() : null;
    };

    const renderedMarkdown = computed(() => {
      if (!currentNote.value) return "";
      let content = currentNote.value.content || "";
      content = content.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
        const parts = name.split("/");
        return `<a class="note-link" data-note="${name}">${parts[parts.length - 1]}</a>`;
      });
      return marked.parse(content);
    });

    const previewMarkdown = computed(() => {
      if (!editContent.value) return "";
      let content = editContent.value;
      content = content.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
        const parts = name.split("/");
        return `<a class="note-link" data-note="${name}">${parts[parts.length - 1]}</a>`;
      });
      return marked.parse(content);
    });

    const formatDate = (date) => {
      if (!date) return "";
      return new Date(date).toLocaleDateString(
        settings.language === "ru" ? "ru-RU" : "en-US",
        {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
      );
    };

    const noteEncrypted = computed(
      () =>
        currentNote.value?.icon === "lock" &&
        currentNote.value?.name?.startsWith(ENC_PREFIX),
    );

    const formatChatMsg = (content) => {
      if (!content) return "";
      return (
        content
          .replace(/\[DOC\][\s\S]*?(\[\/DOC\]|$)/g, "")
          .replace(/\[\/DOC\]/g, "")
          .trim() || content
      );
    };

    const togglePanel = () => {
      isPanelCollapsed.value = !isPanelCollapsed.value;
    };

    const loadCategories = async () => {
      try {
        const res = await fetch(api("categories"));
        categories.value = await res.json();
      } catch (e) {
        console.error(e);
      }
    };

    const loadNotes = async (categoryId) => {
      try {
        const res = await fetch(api(`notes?category_id=${categoryId}`));
        const data = await res.json();
        if (settings.encryptionKey) {
          for (const n of data) {
            if (n.icon === "lock" && n.name?.startsWith("LAVA_ENC:")) {
              n.name = await decryptText(n.name, settings.encryptionKey);
            }
          }
        }
        notes.value = data;
      } catch (e) {
        console.error(e);
      }
    };

    const selectCategory = async (cat) => {
      notesLoading.value = true;
      currentCategory.value = cat;
      currentNote.value = null;
      isEditing.value = false;
      showPreview.value = false;
      await loadNotes(cat.id);
      notesLoading.value = false;
      updateURL();
    };

    const goBack = () => {
      currentCategory.value = null;
      currentNote.value = null;
      notes.value = [];
      isEditing.value = false;
      showPreview.value = false;
      updateURL();
      updatePageTitle();
    };

    const decryptNote = async (noteData) => {
      setPrivateProperty(noteData, "_decrypted", false);
      if (noteData.icon === "lock" && settings.encryptionKey) {
        let origName = noteData.name;
        noteData.name = await decryptText(
          noteData.name,
          settings.encryptionKey,
        );
        noteData.content = await decryptText(
          noteData.content || "",
          settings.encryptionKey,
        );
        setPrivateProperty(noteData, "_decrypted", origName != noteData.name);
      }
    };

    const selectNote = async (note) => {
      try {
        currentNote.value = {
          id: -1,
          name: note.name,
          content: "Loading...",
          icon: note.icon,
        };
        const res = await fetchOnce(api(`notes/${note.id}`));
        if (res.status === 404) {
          currentNote.value = null;
          alert(t("noteDeleted"));
          await loadNotes(currentCategory.value.id);
          return;
        }
        const noteData = await res.json();
        await decryptNote(noteData);
        currentNote.value = noteData;
        isEditing.value = false;
        showPreview.value = false;
        showChatPanel.value = false;
        chatMessages.value = [];
        updateURL();
        updatePageTitle();
      } catch (e) {
        console.error(e);
      }
    };

    const toggleEditMode = async () => {
      if (isEditing.value && !confirm(t("cancelEditing"))) return;
      isEditing.value = !isEditing.value;
      showPreview.value = false;
      if (isEditing.value) {
        editContent.value = currentNote.value.content || "";
        editTitle.value = displayNoteName(currentNote.value.name);
        originalNoteContent = currentNote.value.content || "";
        await nextTick();
        checkForDraft();
        startAutoSave();
      } else {
        stopAutoSave();
        showChatPanel.value = false;
        draftRecovery.show = false;
      }
    };

    const startAutoSave = () => {
      stopAutoSave();
      autoSaveInterval = setInterval(() => {
        if (
          currentNote.value &&
          editContent.value &&
          editContent.value.trim()
        ) {
          const draft = {
            noteId: currentNote.value.id,
            content: editContent.value,
            savedAt: Date.now(),
          };
          localStorage.setItem("lava-draft", JSON.stringify(draft));
        }
      }, 30000);
    };

    const stopAutoSave = () => {
      if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
        autoSaveInterval = null;
      }
    };

    const checkForDraft = () => {
      const draftStr = localStorage.getItem("lava-draft");
      if (!draftStr || !currentNote.value) return;

      try {
        const draft = JSON.parse(draftStr);
        if (draft.noteId !== currentNote.value.id) return;

        const noteUpdated = new Date(currentNote.value.updated_at).getTime();
        if (
          draft.savedAt > noteUpdated &&
          draft.content !== currentNote.value.content
        ) {
          draftRecovery.content = draft.content;
          draftRecovery.charDiff =
            draft.content.length - (currentNote.value.content || "").length;
          draftRecovery.show = true;
        }
      } catch (e) {
        console.error(e);
      }
    };

    const loadDraft = () => {
      if (!draftRecovery.content) return;
      const ed = monacoEditor.value ? toRaw(monacoEditor.value) : null;
      if (ed) {
        ed.executeEdits("load-draft", [
          {
            range: ed.getModel().getFullModelRange(),
            text: draftRecovery.content,
            forceMoveMarkers: true,
          },
        ]);
      } else {
        editContent.value = draftRecovery.content;
      }
      draftRecovery.show = false;
      localStorage.removeItem("lava-draft");
    };

    const discardDraft = () => {
      draftRecovery.show = false;
      draftRecovery.content = "";
      localStorage.removeItem("lava-draft");
    };

    const togglePreview = () => {
      showPreview.value = !showPreview.value;
    };

    let editorDecorations = null;

    const handleEditorMount = (editorInstance) => {
      monacoEditor.value = editorInstance;
      setupChangeTracking(editorInstance);
    };

    const setupChangeTracking = (ed) => {
      const updateDecorations = () => {
        if (!ed || !originalNoteContent) return;

        const originalLines = originalNoteContent.split("\n");
        const currentLines = ed.getValue().split("\n");
        const changedRanges = [];

        const maxLines = Math.max(originalLines.length, currentLines.length);
        for (let i = 0; i < maxLines; i++) {
          const orig = originalLines[i] || "";
          const curr = currentLines[i] || "";
          if (orig !== curr && i < currentLines.length) {
            changedRanges.push({
              range: new monaco.Range(i + 1, 1, i + 2, 1),
              options: {
                isWholeLine: true,
                linesDecorationsClassName: "line-changed-decoration",
              },
            });
          }
        }

        if (editorDecorations) {
          editorDecorations.clear();
        }
        editorDecorations = ed.createDecorationsCollection(changedRanges);
      };

      ed.onDidChangeModelContent(() => {
        updateDecorations();
      });

      // Initial decoration
      setTimeout(updateDecorations, 100);
    };

    // URL routing
    const getBasePath = () => {
      const path = window.location.pathname;
      const match = path.match(/^(.*?\/)note\/|^(.*?)?$/);
      return match ? match[1] || match[2] || "" : "";
    };

    const basePath = getBasePath();
    const api = (endpoint) =>
      `${basePath}api/${endpoint}`.replace(/\/+/g, "/").replace(":/", "://");
    import(`${basePath}static/locale.js`).then((module) => {
      translations = reactive(module.default);
      nextTick(() => (forceUpdate.value += 1));
    });
    addStyle(`${basePath}static/style.css`).then(() => {
      const splash = document.getElementById("splash");
      if (splash) {
        splash.classList.add("fade-out");
        setTimeout(() => splash.remove(), 300);
      }
    });
    addStyle("https://unpkg.com/light-icons@1.0.12/dist/light-icon.css");

    const updateURL = () => {
      if (currentNote.value && currentNote.value.id > 0) {
        const title = encodeURIComponent(
          displayNoteName(currentNote.value.name),
        );
        const newPath = `${basePath}note/${currentNote.value.id}/${title}`;
        window.history.pushState({ noteId: currentNote.value.id }, "", newPath);
      } else if (currentCategory.value) {
        window.history.pushState({}, "", basePath || "/");
      } else {
        window.history.pushState({}, "", basePath || "/");
      }
    };

    const updatePageTitle = () => {
      if (currentNote.value && currentNote.value.name) {
        document.title = `${displayNoteName(currentNote.value.name)} - Lava Notes`;
      } else {
        document.title = "Lava Notes";
      }
    };

    const parseURLAndNavigate = async () => {
      const path = window.location.pathname;
      const match = path.match(/\/note\/(\d+)/);
      if (match) {
        const noteId = parseInt(match[1], 10);
        try {
          const res = await fetch(api(`notes/${noteId}`));
          if (res.ok) {
            const note = await res.json();
            await decryptNote(note);
            const cat = categories.value.find((c) => c.id === note.category_id);
            if (cat) {
              currentCategory.value = cat;
              await loadNotes(cat.id);
            }
            currentNote.value = note;
            updatePageTitle();
          } else {
            currentNote.value.name = "Not found";
          }
        } catch (e) {
          console.error(e);
        }
      }
    };

    const handleBeforeMount = (monaco) => {
      // Define Dark Theme
      monaco.editor.defineTheme("lava-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#1a1a1a",
          "editor.lineHighlightBorder": "#00000000",
        },
      });

      // Define Light Theme
      monaco.editor.defineTheme("lava-light", {
        base: "vs",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#ffffff",
          "editor.lineHighlightBorder": "#00000000",
        },
      });
    };

    const toggleChatPanel = () => {
      showChatPanel.value = !showChatPanel.value;
      if (showChatPanel.value && chatMessages.value.length === 0) {
        llmPrompt.value = "";
      }
    };

    // XTEA-CTR + AES-GCM encryption
    const ENC_PREFIX = "LAVA_ENC:";
    const xtea = {
      encrypt(v, k) {
        let v0 = v[0],
          v1 = v[1],
          sum = 0,
          delta = 0x9e3779b9;
        for (let i = 0; i < 32; i++) {
          v0 += (((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + k[sum & 3]);
          v0 >>>= 0;
          sum = (sum + delta) >>> 0;
          v1 += (((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + k[(sum >>> 11) & 3]);
          v1 >>>= 0;
        }
        return [v0, v1];
      },
      ctr(data, key) {
        const k = new Uint32Array(4);
        for (let i = 0; i < 16; i++)
          k[i >> 2] |= key[i % key.length] << ((i & 3) << 3);
        const result = new Uint8Array(data.length);
        let ctr = [0, 0];
        for (let i = 0; i < data.length; i += 8) {
          const ks = this.encrypt(ctr, k);
          for (let j = 0; j < 8 && i + j < data.length; j++)
            result[i + j] =
              data[i + j] ^ ((ks[j >> 2] >>> ((j & 3) << 3)) & 0xff);
          ctr[0]++;
          if (ctr[0] === 0) ctr[1]++;
        }
        return result;
      },
    };

    async function deriveKey(pass) {
      const enc = new TextEncoder().encode(pass);
      const hash = await crypto.subtle.digest("SHA-256", enc);
      return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
    }

    async function encryptText(text, pass) {
      const enc = new TextEncoder();
      const data = enc.encode(text);
      const xteaOut = xtea.ctr(data, enc.encode(pass));
      const key = await deriveKey(pass);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        xteaOut,
      );
      const buf = new Uint8Array(iv.length + ct.byteLength);
      buf.set(iv);
      buf.set(new Uint8Array(ct), iv.length);
      return ENC_PREFIX + btoa(String.fromCharCode(...buf));
    }

    async function decryptText(str, pass) {
      if (!str.startsWith(ENC_PREFIX)) return str;
      try {
        const enc = new TextEncoder();
        const raw = Uint8Array.from(atob(str.slice(ENC_PREFIX.length)), (c) =>
          c.charCodeAt(0),
        );
        const iv = raw.slice(0, 12),
          ct = raw.slice(12);
        const key = await deriveKey(pass);
        const dec = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ct,
        );
        const xteaOut = xtea.ctr(new Uint8Array(dec), enc.encode(pass));
        return new TextDecoder().decode(xteaOut);
      } catch {
        return str;
      }
    }

    const llmTools = [
      {
        name: "find_replace",
        description: "Find and replace text using regex",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            replacement: { type: "string" },
          },
          required: ["pattern", "replacement"],
        },
      },
      {
        name: "append_end",
        description: "Append text to document end",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      {
        name: "append_after_line",
        description: "Insert text after line number",
        parameters: {
          type: "object",
          properties: { line: { type: "number" }, text: { type: "string" } },
          required: ["line", "text"],
        },
      },
      {
        name: "delete_lines",
        description: "Delete line range (1-indexed)",
        parameters: {
          type: "object",
          properties: { start: { type: "number" }, end: { type: "number" } },
          required: ["start", "end"],
        },
      },
    ];

    const execTool = (name, args) => {
      const lines = editContent.value.split("\n");
      if (name === "find_replace") {
        try {
          editContent.value = editContent.value.replace(
            new RegExp(args.pattern, "g"),
            args.replacement,
          );
        } catch {}
      } else if (name === "append_end") editContent.value += "\n" + args.text;
      else if (
        name === "append_after_line" &&
        args.line > 0 &&
        args.line <= lines.length
      ) {
        lines.splice(args.line, 0, args.text);
        editContent.value = lines.join("\n");
      } else if (
        name === "delete_lines" &&
        args.start > 0 &&
        args.end <= lines.length
      ) {
        lines.splice(args.start - 1, args.end - args.start + 1);
        editContent.value = lines.join("\n");
      }
    };

    async function callLLM(messages, systemPrompt, tools) {
      const model = llmSettings.model || getDefaultModel();
      const provider = llmSettings.provider;
      if (!provider) return "";
      const headers = { "Content-Type": "application/json" };
      if (llmSettings.apiKey) {
        if (provider === "openai")
          headers["Authorization"] = `Bearer ${llmSettings.apiKey}`;
        else if (provider === "claude") {
          headers["x-api-key"] = llmSettings.apiKey;
          headers["anthropic-version"] = "2023-06-01";
          headers["anthropic-dangerous-direct-browser-access"] = "true";
        }
      }
      let body, url;
      if (provider === "openai") {
        url =
          (llmSettings.endpoint || "https://api.openai.com/v1") +
          "/chat/completions";
        const msgs = systemPrompt
          ? [{ role: "system", content: systemPrompt }, ...messages]
          : messages;
        const req = { model, messages: msgs };
        if (tools)
          req.tools = tools.map((t) => ({ type: "function", function: t }));
        body = JSON.stringify(req);
      } else if (provider === "gemini") {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmSettings.apiKey}`;
        const parts = messages.map((m) => ({
          text: (m.role === "system" ? "[System] " : "") + m.content,
        }));
        if (systemPrompt) parts.unshift({ text: "[System] " + systemPrompt });
        body = JSON.stringify({ contents: [{ parts }] });
      } else if (provider === "claude") {
        url = "https://api.anthropic.com/v1/messages";
        const req = {
          model,
          max_tokens: 4096,
          system: systemPrompt || undefined,
          messages,
        };
        if (tools)
          req.tools = tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          }));
        body = JSON.stringify(req);
      }
      const res = await fetch(url, { method: "POST", headers, body });
      const data = await res.json();
      let text = "",
        toolCalls = [];
      if (provider === "openai") {
        const msg = data.choices?.[0]?.message;
        text = msg?.content || "";
        if (msg?.tool_calls)
          toolCalls = msg.tool_calls.map((tc) => ({
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          }));
      } else if (provider === "gemini") {
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } else if (provider === "claude") {
        for (const block of data.content || []) {
          if (block.type === "text") text += block.text;
          else if (block.type === "tool_use")
            toolCalls.push({ name: block.name, args: block.input });
        }
      }
      for (const tc of toolCalls) execTool(tc.name, tc.args);
      return (
        text ||
        (toolCalls.length
          ? `Used tools: ${toolCalls.map((t) => t.name).join(", ")}`
          : "")
      );
    }

    const saveNote = async () => {
      if (!currentNote.value) return;
      cache.delete(api(`notes/${currentNote.value.id}`));
      try {
        const oldName = currentNote.value.name || "";
        const langMatch = oldName.match(/__([a-z]{2})(?:\.md)?$/i);
        let newName = editTitle.value.trim();
        if (langMatch) newName = `${newName}__${langMatch[1]}`;
        let content = editContent.value;
        const isPrivate = currentNote.value.icon === "lock";
        if (isPrivate && settings.encryptionKey) {
          newName = await encryptText(newName, settings.encryptionKey);
          content = await encryptText(content, settings.encryptionKey);
        }
        const res = await fetch(api(`notes/${currentNote.value.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName,
            content,
            icon: currentNote.value.icon,
          }),
        });
        if (res.ok) {
          const saved = await res.json();
          await decryptNote(saved);
          currentNote.value = saved;
          isEditing.value = false;
          showPreview.value = false;
          showChatPanel.value = false;
          stopAutoSave();
          localStorage.removeItem("lava-draft");
          draftRecovery.show = false;
          await loadNotes(currentCategory.value.id);
          updateURL();
          updatePageTitle();
        }
      } catch (e) {
        console.error(e);
      }
    };

    const cancelEdit = () => {
      isEditing.value = false;
      showPreview.value = false;
      showChatPanel.value = false;
      editContent.value = "";
      editTitle.value = "";
      stopAutoSave();
      draftRecovery.show = false;
    };

    const noteToDelete = ref(null);

    const confirmDelete = () => {
      noteToDelete.value = currentNote.value;
      showDeleteConfirm.value = true;
    };

    const deleteNote = async () => {
      const note = noteToDelete.value;
      if (!note) return;
      try {
        await fetch(api(`notes/${note.id}`), { method: "DELETE" });
        cache.delete(api(`notes/${note.id}`));
        if (currentNote.value?.id === note.id) {
          currentNote.value = null;
          updatePageTitle();
          updateURL();
        }
        showDeleteConfirm.value = false;
        noteToDelete.value = null;
        await loadNotes(currentCategory.value.id);
      } catch (e) {
        console.error(e);
      }
    };

    // Context menu
    const openContextMenu = (e, note) => {
      if (!isAuthenticated.value) return;
      contextMenu.x = e.clientX;
      contextMenu.y = e.clientY;
      contextMenu.note = note;
      contextMenu.category = null;
      contextMenu.type = "note";
      contextMenu.visible = true;
    };

    const openCategoryContextMenu = (e, cat) => {
      if (!isAuthenticated.value) return;
      contextMenu.x = e.clientX;
      contextMenu.y = e.clientY;
      contextMenu.category = cat;
      contextMenu.note = null;
      contextMenu.type = "category";
      contextMenu.visible = true;
    };

    const closeContextMenu = () => {
      contextMenu.visible = false;
      contextMenu.note = null;
      contextMenu.category = null;
      contextMenu.type = null;
    };

    const deleteContextNote = () => {
      if (!contextMenu.note) return;
      noteToDelete.value = contextMenu.note;
      showDeleteConfirm.value = true;
      closeContextMenu();
    };

    const categoryToDelete = ref(null);
    const showCategoryDeleteConfirm = ref(false);

    const deleteContextCategory = () => {
      if (!contextMenu.category) return;
      categoryToDelete.value = contextMenu.category;
      showCategoryDeleteConfirm.value = true;
      closeContextMenu();
    };

    const deleteCategory = async () => {
      const cat = categoryToDelete.value;
      if (!cat) return;
      try {
        await fetch(api(`categories/${cat.id}`), { method: "DELETE" });
        showCategoryDeleteConfirm.value = false;
        categoryToDelete.value = null;
        await loadCategories();
      } catch (e) {
        console.error(e);
      }
    };

    const cloneNote = async () => {
      if (!contextMenu.note) return;
      const note = contextMenu.note;
      closeContextMenu();

      try {
        // Fetch full note content
        const res = await fetch(api(`notes/${note.id}`));
        const fullNote = await res.json();

        // Create clone with _clone suffix
        const baseName = displayNoteName(fullNote.name);
        const langMatch = (fullNote.name || "").match(
          /__([a-z]{2})(?:\.md)?$/i,
        );
        let newName = `${baseName}_clone`;
        if (langMatch) {
          newName = `${newName}__${langMatch[1]}`;
        }

        await fetch(api("notes"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_id: currentCategory.value.id,
            name: newName,
            content: fullNote.content,
            icon: fullNote.icon,
          }),
        });
        await loadNotes(currentCategory.value.id);
      } catch (e) {
        console.error(e);
      }
    };

    const insertFormat = (format) => {
      if (!monacoEditor.value) return;

      // FIX: Unwrap the proxy to get the raw Monaco instance
      const ed = toRaw(monacoEditor.value);

      const selection = ed.getSelection();
      // Use getValueInRange safely
      const selectedText = ed.getModel().getValueInRange(selection);

      let text = "";
      switch (format) {
        case "bold":
          text = `**${selectedText || "bold text"}**`;
          break;
        case "italic":
          text = `*${selectedText || "italic text"}*`;
          break;
        case "underline":
          text = `<u>${selectedText || "underlined text"}</u>`;
          break;
        case "subscript":
          text = `<sub>${selectedText || "subscript"}</sub>`;
          break;
        case "superscript":
          text = `<sup>${selectedText || "superscript"}</sup>`;
          break;
        case "image":
          text = `![${selectedText || "alt text"}](url)`;
          break;
      }

      // Now this call won't trigger Vue reactivity overhead
      ed.executeEdits("format-insert", [
        {
          range: selection,
          text: text,
          forceMoveMarkers: true,
        },
      ]);
      ed.focus();
    };

    // Link insert
    const onLinkInput = () => {
      const query = linkForm.url.toLowerCase();
      if (
        query.startsWith("[[") ||
        (!query.startsWith("http") && query.length > 1)
      ) {
        const searchTerm = query.replace(/^\[\[/, "");
        linkSuggestions.value = notes.value
          .filter((n) =>
            displayNoteName(n.name).toLowerCase().includes(searchTerm),
          )
          .slice(0, 5);
      } else {
        linkSuggestions.value = [];
      }
    };

    const selectLinkSuggestion = (note) => {
      linkForm.url = `[[${displayNoteName(note.name)}]]`;
      linkForm.text = linkForm.text || displayNoteName(note.name);
      linkSuggestions.value = [];
    };

    const insertLink = () => {
      if (!monacoEditor.value || !linkForm.url) return;

      // FIX: Unwrap here as well
      const ed = toRaw(monacoEditor.value);

      const selection = ed.getSelection();

      let text = "";
      if (linkForm.url.startsWith("[[")) {
        text = linkForm.url;
      } else {
        text = `[${linkForm.text || linkForm.url}](${linkForm.url})`;
      }

      ed.executeEdits("link-insert", [
        {
          range: selection,
          text: text,
          forceMoveMarkers: true,
        },
      ]);
      ed.focus();
      showLinkModal.value = false;
      linkForm.text = "";
      linkForm.url = "";
      linkSuggestions.value = [];
    };

    // Find & Replace
    const findNext = () => {
      if (!monacoEditor.value || !findReplaceForm.find) return;
      const editor = monacoEditor.value;
      const model = editor.getModel();

      let searchString = findReplaceForm.find;
      editor.getAction("actions.find").run();
      editor.trigger("find", "editor.actions.findWithArgs", {
        searchString: searchString,
        isRegex: findReplaceForm.regex,
        matchCase: findReplaceForm.caseSensitive,
      });
    };

    const replaceOne = () => {
      if (!monacoEditor.value || !findReplaceForm.find) return;
      const content = editContent.value;
      let flags = findReplaceForm.caseSensitive ? "" : "i";

      try {
        const regex = findReplaceForm.regex
          ? new RegExp(findReplaceForm.find, flags)
          : new RegExp(
              findReplaceForm.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              flags,
            );
        editContent.value = content.replace(regex, findReplaceForm.replace);
      } catch (e) {
        console.error("Invalid regex:", e);
      }
    };

    const replaceAll = () => {
      if (!monacoEditor.value || !findReplaceForm.find) return;
      const content = editContent.value;
      let flags = "g" + (findReplaceForm.caseSensitive ? "" : "i");

      try {
        const regex = findReplaceForm.regex
          ? new RegExp(findReplaceForm.find, flags)
          : new RegExp(
              findReplaceForm.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              flags,
            );
        editContent.value = content.replace(regex, findReplaceForm.replace);
        showFindReplace.value = false;
      } catch (e) {
        console.error("Invalid regex:", e);
      }
    };

    const translateNote = () => {
      if (!contextMenu.note) {
        closeContextMenu();
        return;
      }
      translateNoteRef.value = contextMenu.note;
      translateLangMode.value = settings.language === "en" ? "ru" : "en";
      translateCustomLang.value = "";
      closeContextMenu();
      showTranslateModal.value = true;
    };

    const publishNote = () => {
      createForm.name = currentNote.value.name;
      createForm.icon = "lock";
      showSetIconPopup.value = true;
      closeContextMenu();
    };

    const saveIcon = () => {
      currentNote.value.icon = createForm.icon || createForm.customIcon;
      showSetIconPopup.value = false;
      editTitle.value = editTitle.value || currentNote.value.name;
      editContent.value = editContent.value || currentNote.value.content;
      saveNote();
    };

    const doTranslate = async () => {
      if (!translateNoteRef.value || !llmSettings.provider) return;
      const note = translateNoteRef.value;
      const res = await fetch(api(`notes/${note.id}`));
      const fullNote = await res.json();
      let targetLang, targetCode;
      if (translateLangMode.value === "custom") {
        targetLang = translateCustomLang.value || "English";
        targetCode = targetLang.slice(0, 2).toLowerCase();
      } else {
        targetLang = translateLangMode.value === "en" ? "English" : "Russian";
        targetCode = translateLangMode.value;
      }
      const prompt = `Translate to ${targetLang}. Keep markdown formatting. Only output translated content:\n\n${fullNote.content}`;
      llmLoading.value = true;
      showTranslateModal.value = false;
      try {
        const response = await callLLM([{ role: "user", content: prompt }]);
        if (response) {
          const baseName = displayNoteName(fullNote.name);
          await fetch(api("notes"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category_id: currentCategory.value.id,
              name: `${baseName}__${targetCode}`,
              content: response,
              icon: fullNote.icon,
            }),
          });
          await loadNotes(currentCategory.value.id);
        }
      } catch (e) {
        console.error("Translation error:", e);
      }
      llmLoading.value = false;
    };

    const openSettings = () => {
      showSettings.value = true;
    };
    const closeSettings = () => {
      showSettings.value = false;
    };

    const openCreateModal = () => {
      createForm.name = "";
      createForm.icon = currentCategory.value ? "file-text" : "folder";
      createForm.customIcon = "";
      showCreateModal.value = true;
    };
    const closeCreateModal = () => {
      showCreateModal.value = false;
      showSetIconPopup.value = false;
    };

    const create = async () => {
      if (!createForm.name.trim()) return;
      const icon = createForm.customIcon || createForm.icon;
      try {
        if (currentCategory.value) {
          const res = await fetch(api("notes"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category_id: currentCategory.value.id,
              name: createForm.name,
              content: "",
              icon,
            }),
          });
          if (res.ok) {
            await loadNotes(currentCategory.value.id);
            closeCreateModal();
          }
        } else {
          const res = await fetch(api("categories"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: createForm.name, icon }),
          });
          if (res.ok) {
            await loadCategories();
            closeCreateModal();
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    const applyTheme = () => {
      // Apply theme to body
      if (settings.theme === "light") {
        document.body.classList.add("light-theme");
      } else {
        document.body.classList.remove("light-theme");
      }
      // Apply hue
      document.documentElement.style.setProperty(
        "--accent",
        `hsl(${30 + settings.hue_shift}, 70%, 65%)`,
      );
      document.documentElement.style.setProperty(
        "--accent-hover",
        `hsl(${30 + settings.hue_shift}, 75%, 70%)`,
      );
      document.documentElement.style.setProperty(
        "--accent-muted",
        `hsl(${30 + settings.hue_shift}, 55%, 55%)`,
      );
    };

    const applyHue = () => {
      applyTheme();
      saveSettings();
    };

    const computedTheme = computed(() => {
      return settings.theme === "dark" ? "lava-dark" : "lava-light";
    });

    const saveSettings = () => {
      if (!settings.saveEncryptionKey) {
        settings.encryptionKey = "";
      }
      localStorage.setItem("lava-settings", JSON.stringify(settings));
    };

    const saveAllSettings = () => {
      localStorage.setItem("lava-llm", JSON.stringify(llmSettings));
      if (currentNote && !currentNote.value?._decrypted) {
        decryptNote(currentNote.value);
      }
      saveSettings();
      closeSettings();
    };

    const loadSettingsFromStorage = () => {
      const saved = localStorage.getItem("lava-settings");
      if (saved) Object.assign(settings, JSON.parse(saved));
      const llm = localStorage.getItem("lava-llm");
      if (llm) Object.assign(llmSettings, JSON.parse(llm));
      applyTheme();
    };

    const getDefaultModel = () => {
      const defaults = {
        gemini: "gemini-pro",
        openai: "gpt-4",
        claude: "claude-3-sonnet-20240229",
      };
      return defaults[llmSettings.provider] || "";
    };

    const stripThinking = (text) => {
      if (!text) return text;
      return text.replace(/^[\s\S]*?<\/think(?:ing)?>/i, "").trim();
    };

    const clearChat = () => {
      chatMessages.value = [];
    };

    const sendChat = async () => {
      if (!llmPrompt.value.trim() || !llmSettings.provider) return;
      const userMsg = llmPrompt.value.trim();
      chatMessages.value.push({ role: "user", content: userMsg });
      llmPrompt.value = "";
      llmLoading.value = true;
      const docContent = chatIncludeDoc.value ? editContent.value : "";
      const useTools = chatUseTools.value && chatIncludeDoc.value;
      const lineCount = docContent.split("\n").length;
      const systemPrompt = useTools
        ? `You are Chicken, an editorial assistant. Match document language. Use provided tools to edit. Each newline = 1 line, total lines: ${lineCount}.`
        : "You are Chicken, an editorial assistant. Match document language." +
          (docContent
            ? " Put modified document between [DOC] and [/DOC] tags."
            : "");
      const messages = chatMessages.value
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      if (docContent)
        messages[messages.length - 1].content =
          `<doc>\n${docContent}\n</doc>\n${messages[messages.length - 1].content}`;
      try {
        let response = await callLLM(
          messages,
          systemPrompt,
          useTools ? llmTools : null,
        );
        response = stripThinking(response);
        chatMessages.value.push({
          role: "assistant",
          content: response || "(empty response)",
        });
        if (!useTools && response?.includes("[DOC]")) {
          const match = response.match(/\[DOC\]([\s\S]*?)(?:\[\/DOC\]|$)/);
          if (match?.[1]) editContent.value = match[1].trim();
        }
      } catch (e) {
        console.error("Chat error:", e);
        chatMessages.value.push({
          role: "assistant",
          content: "Error: " + (e.message || e),
        });
      }
      llmLoading.value = false;
    };

    const checkAuth = async () => {
      try {
        const res = await fetch(api("auth/check"));
        const data = await res.json();
        isAuthenticated.value = data.authenticated;
      } catch (e) {
        console.error(e);
      }
    };

    const doSearch = async () => {
      if (searchQuery.value.length < 3) {
        searchResults.value = [];
        return;
      }
      searchLoading.value = true;
      try {
        const res = await fetch(api(`notes/search?q=${encodeURIComponent(searchQuery.value)}`));
        if (res.ok) {
          searchResults.value = await res.json();
        }
      } catch (e) {
        console.error(e);
      }
      searchLoading.value = false;
    };

    const onSearchInput = () => {
      if (searchTimeout) clearTimeout(searchTimeout);
      if (searchQuery.value.length < 3) {
        searchResults.value = [];
        return;
      }
      searchTimeout = setTimeout(doSearch, 800);
    };

    const onSearchKeydown = (e) => {
      if (e.key === 'Enter') {
        if (searchTimeout) clearTimeout(searchTimeout);
        doSearch();
      }
    };

    const selectSearchResult = async (result) => {
      const cat = categories.value.find(c => c.id === result.category_id);
      if (cat) {
        currentCategory.value = cat;
        await loadNotes(cat.id);
        const note = notes.value.find(n => n.id === result.id);
        if (note) await selectNote(note);
      }
      searchQuery.value = "";
      searchResults.value = [];
    };

    const clearSearch = () => {
      searchQuery.value = "";
      searchResults.value = [];
    };

    // Syntax highlighting for code blocks using syntax-highlight-element
    let syntaxHighlightLoaded = false;
    const loadSyntaxHighlight = async () => {
      if (syntaxHighlightLoaded) return;
      try {
        // Load the theme CSS
        let sTheme = "prettylights.min.css";
        await addStyle(
          `https://cdn.jsdelivr.net/npm/syntax-highlight-element@1/dist/themes/${sTheme}`,
        );
        // Load the web component
        await import(
          "https://cdn.jsdelivr.net/npm/syntax-highlight-element@1/+esm"
        );
        syntaxHighlightLoaded = true;
      } catch (e) {
        console.error("Failed to load syntax-highlight-element", e);
      }
    };

    const applySyntaxHighlight = async () => {
      await nextTick();
      const codeBlocks = document.querySelectorAll(
        ".markdown-content pre code:not([data-highlighted])",
      );
      if (codeBlocks.length === 0) return;
      let languages = new Set();

      codeBlocks.forEach((block) => {
        const lang = block.className.match(/language-(\w+)/)?.[1] || "js";
        const code = block.textContent;
        const pre = block.parentElement;
        languages.add(lang);

        // Create syntax-highlight element and replace the pre>code structure
        const syntaxEl = document.createElement("syntax-highlight");
        syntaxEl.setAttribute("language", lang);
        syntaxEl.textContent = code;

        pre.firstChild.replaceWith(syntaxEl);
      });
      window.she = window.she || {};
      window.she.config = {
        languages: [...languages],
      };
      await loadSyntaxHighlight();
    };

    watch(
      () => renderedMarkdown.value,
      () => {
        if (!isEditing.value) applySyntaxHighlight();
      },
    );

    watch(
      () => currentNote.value,
      () => {
        if (!isEditing.value) applySyntaxHighlight();
      },
    );

    onMounted(async () => {
      loadSettingsFromStorage();
      await checkAuth();
      await loadCategories();

      // Parse URL and navigate to note if present
      await parseURLAndNavigate();

      // Close context menu on click outside
      document.addEventListener("click", () => closeContextMenu());

      // Handle browser back/forward
      window.addEventListener("popstate", async (e) => {
        if (e.state?.noteId) {
          const res = await fetchOnce(api(`notes/${e.state.noteId}`));
          if (res.ok) {
            const note = await res.json();
            await decryptNote(note);
            const cat = categories.value.find((c) => c.id === note.category_id);
            if (cat && cat.id !== currentCategory.value?.id) {
              currentCategory.value = cat;
              await loadNotes(cat.id);
            }
            currentNote.value = note;
            isEditing.value = false;
            updatePageTitle();
          }
        } else {
          currentNote.value = null;
          updatePageTitle();
        }
      });

      // Note links
      document.addEventListener("click", (e) => {
        if (e.target.classList.contains("note-link")) {
          const notePath = e.target.dataset.note;
          const parts = notePath.split("/");
          if (parts.length === 2) {
            const cat = categories.value.find((c) => c.name === parts[0]);
            if (cat) {
              selectCategory(cat).then(() => {
                const note = notes.value.find(
                  (n) => stripMd(n.name) === parts[1],
                );
                if (note) selectNote(note);
              });
            }
          } else if (currentCategory.value) {
            const note = notes.value.find((n) => stripMd(n.name) === parts[0]);
            if (note) selectNote(note);
          }
        }
      });
    });

    return {
      isPanelCollapsed,
      editContent,
      editTitle,
      editorOptions,
      handleBeforeMount,
      handleEditorMount,
      categories,
      notes,
      filteredNotes,
      currentCategory,
      currentNote,
      notesLoading,
      noteToDelete,
      isEditing,
      isAuthenticated,
      showSettings,
      showCreateModal,
      showDeleteConfirm,
      computedTheme,
      showChatPanel,
      showPreview,
      showLinkModal,
      showFindReplace,
      showTranslateModal,
      llmPrompt,
      llmLoading,
      chatMessages,
      chatIncludeDoc,
      chatUseTools,
      translateLangMode,
      translateCustomLang,
      noteEncrypted,
      formatChatMsg,
      settings,
      llmSettings,
      createForm,
      linkForm,
      findReplaceForm,
      linkSuggestions,
      defaultLightIcons,
      defaultDevIcons,
      contextMenu,
      t,
      isDevicon,
      logoFilter,
      renderedMarkdown,
      previewMarkdown,
      stripMd,
      displayNoteName,
      getNoteLangCode,
      formatDate,
      togglePanel,
      selectCategory,
      goBack,
      selectNote,
      toggleEditMode,
      togglePreview,
      saveNote,
      cancelEdit,
      confirmDelete,
      deleteNote,
      openContextMenu,
      closeContextMenu,
      deleteContextNote,
      cloneNote,
      translateNote,
      doTranslate,
      openCategoryContextMenu,
      deleteContextCategory,
      categoryToDelete,
      showCategoryDeleteConfirm,
      deleteCategory,
      draftRecovery,
      loadDraft,
      discardDraft,
      insertFormat,
      onLinkInput,
      selectLinkSuggestion,
      insertLink,
      findNext,
      replaceOne,
      replaceAll,
      showSetIconPopup,
      publishNote,
      saveIcon,
      openSettings,
      closeSettings,
      openCreateModal,
      closeCreateModal,
      create,
      applyHue,
      saveSettings,
      saveAllSettings,
      getDefaultModel,
      toggleChatPanel,
      sendChat,
      clearChat,
      loadMoreIcons,
      forceUpdate,
      searchQuery,
      searchResults,
      searchLoading,
      onSearchInput,
      onSearchKeydown,
      selectSearchResult,
      clearSearch,
    };
  },
});
app.use(VueMonacoEditorPlugin, {
  paths: {
    vs: "https://unpkg.com/monaco-editor@0.55.1/min/vs",
  },
});

app.mount("#app");
