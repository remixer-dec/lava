## Lava Notes - minimal full-stack publication / knowledge managment app
Developed to provide balance between nice UI & UX, minimalism, performace and simplicity.


### Features
- Built-in editor based on monaco
- Theme customization, icon customization
- Categorization, links to other notes
- Data is stored in an SQLite database
- The server is written in Go and it runs in a single 15MB distroless container that should be placed behind a reverse proxy. Supports custom subpaths.
- Authorization for editors is implemented via a join-link, similar to jupyter-notebook
- Localization of UI, and notes with translations via an LLM
