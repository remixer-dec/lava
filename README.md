<p align="center">
  <img src="https://static.wikia.nocookie.net/minecraft_gamepedia/images/f/f5/Lava_JE14.gif" height=90px>
</p>

## Lava Notes - minimal full-stack publication / knowledge managment app
Developed to provide balance between nice UI & UX, minimalism, performace and simplicity.


### Features
- Built-in editor based on monaco, supports saving state locally and restoring it from checkpoint
- Theme customization, icon customization
- Categorization, links to other notes
- Data is stored in an SQLite database
- The server is written in Go and it runs in a single 15MB distroless container that should be placed behind a reverse proxy. Supports custom subpaths.
- Authorization for editors is implemented via a join-link, similar to jupyter-notebook
- Localization of UI, and notes with translations via an LLM
- Notes with "lock" icon are not visible to unauthorized users.
- Client-side encryption for private notes (XTEA-CTR + AES-GCM)
- View stats, optional SSR
- LLM-assisted editing (optional)

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
