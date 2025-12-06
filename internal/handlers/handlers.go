package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"lava-notes/internal/auth"
	"lava-notes/internal/cache"
	"lava-notes/internal/db"
	"lava-notes/internal/models"
)

type Handlers struct {
	db    *db.DB
	cache *cache.Cache
	auth  *auth.Auth
}

func New(database *db.DB, c *cache.Cache, a *auth.Auth) *Handlers {
	return &Handlers{
		db:    database,
		cache: c,
		auth:  a,
	}
}

func (h *Handlers) respond(w http.ResponseWriter, data interface{}, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}

func (h *Handlers) error(w http.ResponseWriter, message string, status int) {
	h.respond(w, map[string]string{"error": message}, status)
}

// Categories
func (h *Handlers) GetCategories(w http.ResponseWriter, r *http.Request) {
	categories, err := h.db.GetCategories()
	if err != nil {
		h.error(w, "Failed to get categories", http.StatusInternalServerError)
		return
	}
	if categories == nil {
		categories = []models.Category{}
	}
	h.respond(w, categories, http.StatusOK)
}

func (h *Handlers) GetCategory(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/categories/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	category, err := h.db.GetCategory(id)
	if err != nil {
		h.error(w, "Category not found", http.StatusNotFound)
		return
	}

	h.respond(w, category, http.StatusOK)
}

func (h *Handlers) CreateCategory(w http.ResponseWriter, r *http.Request) {
	if !auth.IsWriter(r) {
		h.error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Name string `json:"name"`
		Icon string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		h.error(w, "Name is required", http.StatusBadRequest)
		return
	}

	category, err := h.db.CreateCategory(req.Name, req.Icon)
	if err != nil {
		h.error(w, "Failed to create category", http.StatusInternalServerError)
		return
	}

	h.respond(w, category, http.StatusCreated)
}

func (h *Handlers) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	if !auth.IsWriter(r) {
		h.error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/categories/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Name string `json:"name"`
		Icon string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	category, err := h.db.UpdateCategory(id, req.Name, req.Icon)
	if err != nil {
		h.error(w, "Failed to update category", http.StatusInternalServerError)
		return
	}

	h.cache.InvalidateByPrefix(fmt.Sprintf("note:%d:", id))
	h.respond(w, category, http.StatusOK)
}

func (h *Handlers) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	if !auth.IsWriter(r) {
		h.error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/categories/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	if err := h.db.DeleteCategory(id); err != nil {
		h.error(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}

	h.cache.InvalidateByPrefix(fmt.Sprintf("note:%d:", id))
	h.respond(w, nil, http.StatusNoContent)
}

// Notes
func (h *Handlers) GetNotes(w http.ResponseWriter, r *http.Request) {
	categoryIDStr := r.URL.Query().Get("category_id")
	if categoryIDStr == "" {
		h.error(w, "category_id is required", http.StatusBadRequest)
		return
	}

	categoryID, err := strconv.ParseInt(categoryIDStr, 10, 64)
	if err != nil {
		h.error(w, "Invalid category_id", http.StatusBadRequest)
		return
	}

	notes, err := h.db.GetNotes(categoryID)
	if err != nil {
		h.error(w, "Failed to get notes", http.StatusInternalServerError)
		return
	}
	if notes == nil {
		notes = []models.NoteListItem{}
	}
	h.respond(w, notes, http.StatusOK)
}

func (h *Handlers) GetNote(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/notes/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.error(w, "Invalid note ID", http.StatusBadRequest)
		return
	}

	cacheKey := fmt.Sprintf("note:%d", id)
	if note, ok := h.cache.Get(cacheKey); ok {
		h.respond(w, note, http.StatusOK)
		return
	}

	note, err := h.db.GetNote(id)
	if err != nil {
		h.error(w, "Note not found", http.StatusNotFound)
		return
	}

	h.cache.Set(cacheKey, note)
	h.respond(w, note, http.StatusOK)
}

func (h *Handlers) GetNoteByPath(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	name := r.URL.Query().Get("name")

	if category == "" || name == "" {
		h.error(w, "category and name are required", http.StatusBadRequest)
		return
	}

	cat, err := h.db.GetCategoryByName(category)
	if err != nil {
		h.error(w, "Category not found", http.StatusNotFound)
		return
	}

	note, err := h.db.GetNoteByName(cat.ID, name)
	if err != nil {
		h.error(w, "Note not found", http.StatusNotFound)
		return
	}

	h.respond(w, note, http.StatusOK)
}

func (h *Handlers) CreateNote(w http.ResponseWriter, r *http.Request) {
	if !auth.IsWriter(r) {
		h.error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		CategoryID int64  `json:"category_id"`
		Name       string `json:"name"`
		Content    string `json:"content"`
		Icon       string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.CategoryID == 0 || req.Name == "" {
		h.error(w, "category_id and name are required", http.StatusBadRequest)
		return
	}

	note, err := h.db.CreateNote(req.CategoryID, req.Name, req.Content, req.Icon)
	if err != nil {
		h.error(w, "Failed to create note", http.StatusInternalServerError)
		return
	}

	h.respond(w, note, http.StatusCreated)
}

func (h *Handlers) UpdateNote(w http.ResponseWriter, r *http.Request) {
	if !auth.IsWriter(r) {
		h.error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/notes/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.error(w, "Invalid note ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Name    string `json:"name"`
		Content string `json:"content"`
		Icon    string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	note, err := h.db.UpdateNote(id, req.Name, req.Content, req.Icon)
	if err != nil {
		h.error(w, "Failed to update note", http.StatusInternalServerError)
		return
	}

	h.cache.Invalidate(fmt.Sprintf("note:%d", id))
	h.respond(w, note, http.StatusOK)
}

func (h *Handlers) DeleteNote(w http.ResponseWriter, r *http.Request) {
	if !auth.IsWriter(r) {
		h.error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/notes/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.error(w, "Invalid note ID", http.StatusBadRequest)
		return
	}

	if err := h.db.DeleteNote(id); err != nil {
		h.error(w, "Failed to delete note", http.StatusInternalServerError)
		return
	}

	h.cache.Invalidate(fmt.Sprintf("note:%d", id))
	h.respond(w, nil, http.StatusNoContent)
}

// Settings
func (h *Handlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.db.GetSettings()
	if err != nil {
		h.error(w, "Failed to get settings", http.StatusInternalServerError)
		return
	}
	h.respond(w, settings, http.StatusOK)
}

func (h *Handlers) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Theme    string `json:"theme"`
		Language string `json:"language"`
		HueShift int    `json:"hue_shift"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.db.UpdateSettings(req.Theme, req.Language, req.HueShift); err != nil {
		h.error(w, "Failed to update settings", http.StatusInternalServerError)
		return
	}

	h.respond(w, map[string]string{"status": "ok"}, http.StatusOK)
}

// Auth
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		h.error(w, "Token is required", http.StatusBadRequest)
		return
	}

	jwt, err := h.auth.ValidateLoginToken(token)
	if err != nil {
		h.error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "lava_token",
		Value:    jwt,
		Path:     "/",
		MaxAge:   90 * 24 * 60 * 60, // 3 months
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})

	http.Redirect(w, r, "../../", http.StatusFound)
}

func (h *Handlers) CheckAuth(w http.ResponseWriter, r *http.Request) {
	isWriter := auth.IsWriter(r)
	h.respond(w, map[string]bool{"authenticated": isWriter}, http.StatusOK)
}

func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "lava_token",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	h.respond(w, map[string]string{"status": "ok"}, http.StatusOK)
}
