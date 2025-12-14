package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/glebarez/go-sqlite"
	"lava-notes/internal/models"
)

type DB struct {
	conn *sql.DB
}

func New(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Enable foreign key enforcement for CASCADE deletes
	if _, err := conn.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		return nil, fmt.Errorf("failed to migrate: %w", err)
	}

	return db, nil
}

func (d *DB) migrate() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS categories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			icon TEXT DEFAULT 'folder',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			category_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			content TEXT DEFAULT '',
			icon TEXT DEFAULT 'file-text',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
			UNIQUE(category_id, name)
		)`,
		`CREATE TABLE IF NOT EXISTS auth_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			token TEXT NOT NULL UNIQUE,
			used BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS views (
			note_id INTEGER PRIMARY KEY,
			count INTEGER DEFAULT 0
		)`,
	}

	for _, q := range queries {
		if _, err := d.conn.Exec(q); err != nil {
			return fmt.Errorf("failed to execute query: %w", err)
		}
	}
	return nil
}

func (d *DB) Close() error {
	return d.conn.Close()
}

// Categories
func (d *DB) GetCategories() ([]models.Category, error) {
	rows, err := d.conn.Query(`SELECT id, name, icon, created_at, updated_at FROM categories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var categories []models.Category
	for rows.Next() {
		var c models.Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Icon, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		categories = append(categories, c)
	}
	return categories, nil
}

func (d *DB) GetCategory(id int64) (*models.Category, error) {
	var c models.Category
	err := d.conn.QueryRow(`SELECT id, name, icon, created_at, updated_at FROM categories WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.Icon, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (d *DB) GetCategoryByName(name string) (*models.Category, error) {
	var c models.Category
	err := d.conn.QueryRow(`SELECT id, name, icon, created_at, updated_at FROM categories WHERE name = ?`, name).
		Scan(&c.ID, &c.Name, &c.Icon, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (d *DB) CreateCategory(name, icon string) (*models.Category, error) {
	if icon == "" {
		icon = "folder"
	}
	result, err := d.conn.Exec(`INSERT INTO categories (name, icon) VALUES (?, ?)`, name, icon)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return d.GetCategory(id)
}

func (d *DB) UpdateCategory(id int64, name, icon string) (*models.Category, error) {
	_, err := d.conn.Exec(`UPDATE categories SET name = ?, icon = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, name, icon, id)
	if err != nil {
		return nil, err
	}
	return d.GetCategory(id)
}

func (d *DB) DeleteCategory(id int64) error {
	_, err := d.conn.Exec(`DELETE FROM categories WHERE id = ?`, id)
	return err
}

// Notes
func (d *DB) GetNotes(categoryID int64) ([]models.NoteListItem, error) {
	rows, err := d.conn.Query(`SELECT id, category_id, name, icon, updated_at FROM notes WHERE category_id = ? ORDER BY name`, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []models.NoteListItem
	for rows.Next() {
		var n models.NoteListItem
		if err := rows.Scan(&n.ID, &n.CategoryID, &n.Name, &n.Icon, &n.UpdatedAt); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, nil
}

func (d *DB) GetNote(id int64) (*models.Note, error) {
	var n models.Note
	err := d.conn.QueryRow(`SELECT id, category_id, name, content, icon, created_at, updated_at FROM notes WHERE id = ?`, id).
		Scan(&n.ID, &n.CategoryID, &n.Name, &n.Content, &n.Icon, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func (d *DB) GetNoteByName(categoryID int64, name string) (*models.Note, error) {
	var n models.Note
	err := d.conn.QueryRow(`SELECT id, category_id, name, content, icon, created_at, updated_at FROM notes WHERE category_id = ? AND name = ?`, categoryID, name).
		Scan(&n.ID, &n.CategoryID, &n.Name, &n.Content, &n.Icon, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func (d *DB) CreateNote(categoryID int64, name, content, icon string) (*models.Note, error) {
	if icon == "" {
		icon = "file-text"
	}
	result, err := d.conn.Exec(`INSERT INTO notes (category_id, name, content, icon) VALUES (?, ?, ?, ?)`, categoryID, name, content, icon)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return d.GetNote(id)
}

func (d *DB) UpdateNote(id int64, name, content, icon string) (*models.Note, error) {
	_, err := d.conn.Exec(`UPDATE notes SET name = ?, content = ?, icon = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, name, content, icon, id)
	if err != nil {
		return nil, err
	}
	return d.GetNote(id)
}

func (d *DB) DeleteNote(id int64) error {
	_, err := d.conn.Exec(`DELETE FROM notes WHERE id = ?`, id)
	return err
}

// Auth Tokens
func (d *DB) CreateAuthToken(token string, expiresAt time.Time) error {
	_, err := d.conn.Exec(`INSERT INTO auth_tokens (token, expires_at) VALUES (?, ?)`, token, expiresAt)
	return err
}

func (d *DB) GetAuthToken(token string) (*models.AuthToken, error) {
	var t models.AuthToken
	err := d.conn.QueryRow(`SELECT id, token, used, created_at, expires_at FROM auth_tokens WHERE token = ?`, token).
		Scan(&t.ID, &t.Token, &t.Used, &t.CreatedAt, &t.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (d *DB) MarkTokenUsed(token string) error {
	_, err := d.conn.Exec(`UPDATE auth_tokens SET used = TRUE WHERE token = ?`, token)
	return err
}

// Views
func (d *DB) GetAllViews() (map[int64]int64, error) {
	rows, err := d.conn.Query(`SELECT note_id, count FROM views`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	views := make(map[int64]int64)
	for rows.Next() {
		var noteID, count int64
		if err := rows.Scan(&noteID, &count); err != nil {
			return nil, err
		}
		views[noteID] = count
	}
	return views, nil
}

func (d *DB) SaveViews(views map[int64]int64) error {
	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT OR REPLACE INTO views (note_id, count) VALUES (?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for noteID, count := range views {
		if _, err := stmt.Exec(noteID, count); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// SearchNotes searches notes by query in title and content
// includePrivate controls whether to include notes with lock icon
// Encrypted notes (content starting with LAVA_ENC:) are excluded from search
func (d *DB) SearchNotes(query string, includePrivate bool, limit int) ([]models.SearchResult, error) {
	q := "%" + query + "%"
	var rows *sql.Rows
	var err error

	baseQuery := `
		SELECT n.id, n.category_id, c.name as category_name, n.name, n.icon, n.content
		FROM notes n
		JOIN categories c ON n.category_id = c.id
		WHERE (n.name LIKE ? OR n.content LIKE ?)
		AND n.content NOT LIKE 'LAVA_ENC:%'
		AND n.name NOT LIKE 'LAVA_ENC:%'
	`

	if !includePrivate {
		baseQuery += ` AND n.icon != 'lock' AND c.icon != 'lock'`
	}
	baseQuery += ` ORDER BY n.updated_at DESC LIMIT ?`

	rows, err = d.conn.Query(baseQuery, q, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []models.SearchResult
	for rows.Next() {
		var r models.SearchResult
		var content string
		if err := rows.Scan(&r.ID, &r.CategoryID, &r.CategoryName, &r.Name, &r.Icon, &content); err != nil {
			return nil, err
		}
		r.Snippet = extractSnippet(content, query, 100)
		results = append(results, r)
	}
	return results, nil
}

func extractSnippet(content, query string, maxLen int) string {
	runes := []rune(content)
	lowerContent := strings.ToLower(content)
	lowerQuery := strings.ToLower(query)
	byteIdx := strings.Index(lowerContent, lowerQuery)

	if byteIdx == -1 {
		if len(runes) > maxLen {
			return string(runes[:maxLen]) + "..."
		}
		return content
	}

	runeIdx := len([]rune(content[:byteIdx]))
	queryRuneLen := len([]rune(query))

	start := runeIdx - maxLen/2
	if start < 0 {
		start = 0
	}
	end := runeIdx + queryRuneLen + maxLen/2
	if end > len(runes) {
		end = len(runes)
	}

	snippet := string(runes[start:end])
	if start > 0 {
		snippet = "..." + snippet
	}
	if end < len(runes) {
		snippet = snippet + "..."
	}
	return snippet
}

// IsCategoryPrivate checks if a category has lock icon
func (d *DB) IsCategoryPrivate(categoryID int64) (bool, error) {
	var icon string
	err := d.conn.QueryRow(`SELECT icon FROM categories WHERE id = ?`, categoryID).Scan(&icon)
	if err != nil {
		return false, err
	}
	return icon == "lock", nil
}
