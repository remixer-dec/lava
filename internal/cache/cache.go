package cache

import (
	"container/list"
	"sync"
	"time"

	"lava-notes/internal/models"
)

const MaxCacheSize = 150

type cacheEntry struct {
	key       string
	note      *models.Note
	timestamp time.Time
}

type Cache struct {
	mu       sync.RWMutex
	items    map[string]*list.Element
	order    *list.List
	maxSize  int
}

func New() *Cache {
	return &Cache{
		items:   make(map[string]*list.Element),
		order:   list.New(),
		maxSize: MaxCacheSize,
	}
}

func (c *Cache) Get(key string) (*models.Note, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if elem, ok := c.items[key]; ok {
		entry := elem.Value.(*cacheEntry)
		return entry.note, true
	}
	return nil, false
}

func (c *Cache) Set(key string, note *models.Note) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.items[key]; ok {
		c.order.MoveToFront(elem)
		entry := elem.Value.(*cacheEntry)
		entry.note = note
		entry.timestamp = time.Now()
		return
	}

	if c.order.Len() >= c.maxSize {
		oldest := c.order.Back()
		if oldest != nil {
			entry := oldest.Value.(*cacheEntry)
			delete(c.items, entry.key)
			c.order.Remove(oldest)
		}
	}

	entry := &cacheEntry{
		key:       key,
		note:      note,
		timestamp: time.Now(),
	}
	elem := c.order.PushFront(entry)
	c.items[key] = elem
}

func (c *Cache) Invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.items[key]; ok {
		delete(c.items, key)
		c.order.Remove(elem)
	}
}

func (c *Cache) InvalidateByPrefix(prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for key, elem := range c.items {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			delete(c.items, key)
			c.order.Remove(elem)
		}
	}
}

func (c *Cache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items = make(map[string]*list.Element)
	c.order = list.New()
}
