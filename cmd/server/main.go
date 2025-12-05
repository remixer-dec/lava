package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"lava-notes/internal/auth"
	"lava-notes/internal/cache"
	"lava-notes/internal/db"
	"lava-notes/internal/handlers"
)

func main() {
	port := flag.Int("port", 2025, "Server port")
	dataDir := flag.String("data", "./data", "Data directory")
	generateLink := flag.Bool("generate-link", false, "Generate a new login link")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	dbPath := filepath.Join(*dataDir, "lava.db")
	database, err := db.New(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer database.Close()

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		secretBytes := make([]byte, 32)
		if _, err := rand.Read(secretBytes); err != nil {
			log.Fatalf("Failed to generate JWT secret: %v", err)
		}
		jwtSecret = hex.EncodeToString(secretBytes)
		log.Printf("Generated JWT secret (set JWT_SECRET env var to persist): %s", jwtSecret)
	}

	c := cache.New()
	a := auth.New(database, jwtSecret)
	h := handlers.New(database, c, a)

	if *generateLink {
		baseURL := os.Getenv("BASE_URL")
		if baseURL == "" {
			baseURL = fmt.Sprintf("http://localhost:%d", *port)
		}
		link, err := a.GenerateLoginLink(baseURL)
		if err != nil {
			log.Fatalf("Failed to generate login link: %v", err)
		}
		fmt.Printf("\n=== Writer Login Link (single use, valid for 24 hours) ===\n%s\n\n", link)
		return
	}

	mux := http.NewServeMux()

	// Static files
	staticDir := "./static"
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))

	// API routes
	mux.HandleFunc("/api/categories", a.Middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetCategories(w, r)
		case http.MethodPost:
			h.CreateCategory(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}, false))

	mux.HandleFunc("/api/categories/", a.Middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetCategory(w, r)
		case http.MethodPut:
			h.UpdateCategory(w, r)
		case http.MethodDelete:
			h.DeleteCategory(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}, false))

	mux.HandleFunc("/api/notes", a.Middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetNotes(w, r)
		case http.MethodPost:
			h.CreateNote(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}, false))

	mux.HandleFunc("/api/notes/by-path", a.Middleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetNoteByPath(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}, false))

	mux.HandleFunc("/api/notes/", a.Middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetNote(w, r)
		case http.MethodPut:
			h.UpdateNote(w, r)
		case http.MethodDelete:
			h.DeleteNote(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}, false))

	mux.HandleFunc("/api/settings", a.Middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetSettings(w, r)
		case http.MethodPut:
			h.UpdateSettings(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}, false))

	mux.HandleFunc("/api/auth/check", a.Middleware(h.CheckAuth, false))
	mux.HandleFunc("/api/auth/logout", h.Logout)
	mux.HandleFunc("/auth/login", h.Login)

	// Serve index.html for all other routes (SPA)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./templates/index.html")
	})

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("Starting Lava Notes server on %s", addr)
	log.Printf("Run with --generate-link to create a writer login link")

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
