package ssr

import (
	"html"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"lava-notes/internal/db"
)

var noteURLPattern = regexp.MustCompile(`/[^/]+/note/(\d+)`)

type SSR struct {
	db           *db.DB
	templatePath string
	template     string
}

func New(database *db.DB, templatePath string) *SSR {
	return &SSR{
		db:           database,
		templatePath: templatePath,
	}
}

func (s *SSR) loadTemplate() string {
	if s.template != "" {
		return s.template
	}
	data, err := os.ReadFile(s.templatePath)
	if err != nil {
		return ""
	}
	s.template = string(data)
	return s.template
}

// ExtractNoteID extracts note ID from URL like /anything/note/123/title
func ExtractNoteID(path string) (int64, bool) {
	matches := noteURLPattern.FindStringSubmatch(path)
	if len(matches) < 2 {
		return 0, false
	}
	id, err := strconv.ParseInt(matches[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

// stripHTML removes HTML tags for plain text SEO content
func stripHTML(content string) string {
	re := regexp.MustCompile(`<[^>]*>`)
	return re.ReplaceAllString(content, "")
}

func (s *SSR) ServeHTTP(w http.ResponseWriter, r *http.Request) bool {
	noteID, ok := ExtractNoteID(r.URL.Path)
	if !ok {
		return false
	}

	note, err := s.db.GetNote(noteID)
	if err != nil {
		return false
	}

	// Don't SSR locked notes
	if note.Icon == "lock" {
		return false
	}

	template := s.loadTemplate()
	if template == "" {
		return false
	}

	// Create SEO content
	title := html.EscapeString(note.Name)
	content := html.EscapeString(stripHTML(note.Content))
	ssrContent := "<h1>" + title + "</h1><article>" + content + "</article>"

	// Replace placeholder
	output := strings.Replace(template, "__SSR_CONTENT__", ssrContent, 1)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(output))
	return true
}
