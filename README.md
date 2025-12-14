<p align="center">
  <img src="https://static.wikia.nocookie.net/minecraft_gamepedia/images/f/f5/Lava_JE14.gif" height=90px>
</p>

## Lava Notes - minimal full-stack publication / knowledge managment app
Developed to provide balance between nice UI & UX, minimalism, performace and simplicity.

<p align="center">
  <img height="300" alt="screenshot" src="https://github.com/user-attachments/assets/d33a9833-afbd-46b4-991f-d93647429a83" />
</p>

### Features
*   **15MB Footprint:** The entire backend is a Go binary running in a tiny distroless container, intended for self-hosting.
*   **Reliable Drafting:** Built on the Monaco editor, supports markdown and HTML. Periodically saves state locally and suggests restoring it from checkpoint when there is a difference.
*   **Sinlge-user:** Designed for a single human editor, possibly on multiple devices. Self-host, set keys, modify as you wish, generate a join-link with `./lava-notes --generate-link` and log-in.
*   **Privacy features:** Select a 'lock' icon to create a private note or category. Optionally, if a key is set, private notes will be encrypted and decrypted client-side with (XTEA-CTR + AES-GCM).
*   **Contextual Organization:** Notes can be linked together and categorized, to better organize your thoughts.
*   **Flexible minimalistic UI:** Dark and light themes and large pool of custom icons. Optionally supports SSR `(--ssr)` for SEO indexing.
*   **Regional content separation** You can create notes with `__{language_code}` postfix in name to make them visible for other languages.
*   **AI Integration:** Optional LLM connections can be used for translation, editing and writing assistance. LLM have access to the content that you are editing when using a built-in chat.
*   **Portable Data:** Everything lives in a single SQLite file

Most of the code was implemented with assistance of Claude Code, I guided it to implement requested features in a way that aligns with my vision of the project and fixed the bugs that it made.


### Stack
#### Frontend:
- [Vue.JS](https://www.npmjs.com/package/vue) v3
- Editor: [Vue Monaco Editor](https://www.npmjs.com/package/@guolao/vue-monaco-editor) ([Monaco Editor](https://github.com/microsoft/monaco-editor) + [state-local](https://www.npmjs.com/package/state-local) + [monaco loader](https://www.npmjs.com/package/@monaco-editor/loader))  
- Markdown support: [Marked](https://www.npmjs.com/package/marked)
- Syntax highlighting: [Syntax-highlight-element](https://www.npmjs.com/package/syntax-highlight-element)
- Icons: [Devicon](github.com/devicons/devicon/), [Light icons](https://github.com/lightvue/light-icons)

#### Backend:
- [go-sqlite](https://github.com/glebarez/go-sqlite)
- [golang-jwt](https://github.com/golang-jwt/jwt/)
