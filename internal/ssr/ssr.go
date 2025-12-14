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

var noteURLPattern = regexp.MustCompile(`/note/(\d+)`)

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

// renderMarkdown converts markdown to HTML for SSR
func renderMarkdown(content string) string {
	lines := strings.Split(content, "\n")
	var result strings.Builder
	inCodeBlock := false
	inList := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Code blocks
		if strings.HasPrefix(trimmed, "```") {
			if inCodeBlock {
				result.WriteString("</code></pre>\n")
				inCodeBlock = false
			} else {
				if inList {
					result.WriteString("</ul>\n")
					inList = false
				}
				result.WriteString("<pre><code>")
				inCodeBlock = true
			}
			continue
		}

		if inCodeBlock {
			result.WriteString(html.EscapeString(line))
			result.WriteString("\n")
			continue
		}

		// Empty line
		if trimmed == "" {
			if inList {
				result.WriteString("</ul>\n")
				inList = false
			}
			continue
		}

		// Headers
		if strings.HasPrefix(trimmed, "### ") {
			if inList {
				result.WriteString("</ul>\n")
				inList = false
			}
			result.WriteString("<h3>")
			result.WriteString(html.EscapeString(strings.TrimPrefix(trimmed, "### ")))
			result.WriteString("</h3>\n")
			continue
		}
		if strings.HasPrefix(trimmed, "## ") {
			if inList {
				result.WriteString("</ul>\n")
				inList = false
			}
			result.WriteString("<h2>")
			result.WriteString(html.EscapeString(strings.TrimPrefix(trimmed, "## ")))
			result.WriteString("</h2>\n")
			continue
		}
		if strings.HasPrefix(trimmed, "# ") {
			if inList {
				result.WriteString("</ul>\n")
				inList = false
			}
			result.WriteString("<h1>")
			result.WriteString(html.EscapeString(strings.TrimPrefix(trimmed, "# ")))
			result.WriteString("</h1>\n")
			continue
		}

		// List items
		if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
			if !inList {
				result.WriteString("<ul>\n")
				inList = true
			}
			result.WriteString("<li>")
			result.WriteString(renderInline(strings.TrimPrefix(strings.TrimPrefix(trimmed, "- "), "* ")))
			result.WriteString("</li>\n")
			continue
		}

		// Regular paragraph
		if inList {
			result.WriteString("</ul>\n")
			inList = false
		}
		result.WriteString("<p>")
		result.WriteString(renderInline(trimmed))
		result.WriteString("</p>\n")
	}

	if inCodeBlock {
		result.WriteString("</code></pre>\n")
	}
	if inList {
		result.WriteString("</ul>\n")
	}

	return result.String()
}

// renderInline handles inline markdown: bold, italic, code, links
func renderInline(text string) string {
	// Escape HTML first
	text = html.EscapeString(text)

	// Inline code `code`
	codeRe := regexp.MustCompile("`([^`]+)`")
	text = codeRe.ReplaceAllString(text, "<code>$1</code>")

	// Bold **text** or __text__
	boldRe := regexp.MustCompile(`\*\*([^*]+)\*\*|__([^_]+)__`)
	text = boldRe.ReplaceAllStringFunc(text, func(match string) string {
		inner := strings.TrimPrefix(strings.TrimSuffix(match, "**"), "**")
		if strings.HasPrefix(match, "__") {
			inner = strings.TrimPrefix(strings.TrimSuffix(match, "__"), "__")
		}
		return "<strong>" + inner + "</strong>"
	})

	// Italic *text* or _text_
	italicRe := regexp.MustCompile(`\*([^*]+)\*|_([^_]+)_`)
	text = italicRe.ReplaceAllStringFunc(text, func(match string) string {
		inner := strings.TrimPrefix(strings.TrimSuffix(match, "*"), "*")
		if strings.HasPrefix(match, "_") {
			inner = strings.TrimPrefix(strings.TrimSuffix(match, "_"), "_")
		}
		return "<em>" + inner + "</em>"
	})

	// Links [text](url)
	linkRe := regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	text = linkRe.ReplaceAllString(text, `<a href="$2">$1</a>`)

	return text
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

	// Render markdown to HTML for SEO
	title := html.EscapeString(note.Name)
	content := renderMarkdown(note.Content)
	ssrContent := "<h1>" + title + "</h1><article>" + content + "</article>"

	// Replace placeholder
	output := strings.Replace(template, "__SSR_CONTENT__", ssrContent, 1)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(output))
	return true
}
