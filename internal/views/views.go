package views

import (
	"encoding/binary"
	"net"
	"os"
	"sync"
	"time"

	"lava-notes/internal/db"
)

type Views struct {
	mu          sync.RWMutex
	counts      map[int64]int64            // noteID -> view count
	seenIPs     map[int64]map[uint32]struct{} // noteID -> set of IPv4 addresses
	db          *db.DB
	ipHeaderName string
}

func New(database *db.DB) *Views {
	v := &Views{
		counts:      make(map[int64]int64),
		seenIPs:     make(map[int64]map[uint32]struct{}),
		db:          database,
		ipHeaderName: os.Getenv("IP_HEADER"),
	}

	// Load existing views from database
	v.loadFromDB()

	// Start persistence goroutine
	go v.persistLoop()

	return v
}

func (v *Views) loadFromDB() {
	viewsData, err := v.db.GetAllViews()
	if err != nil {
		return
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	for noteID, count := range viewsData {
		v.counts[noteID] = count
	}
}

func (v *Views) persistLoop() {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		v.persist()
	}
}

func (v *Views) persist() {
	v.mu.RLock()
	countsCopy := make(map[int64]int64, len(v.counts))
	for k, val := range v.counts {
		countsCopy[k] = val
	}
	v.mu.RUnlock()

	// Silently persist without logging
	v.db.SaveViews(countsCopy)
}

// ipToUint32 converts IPv4 to uint32, returns 0 and false for IPv6
func ipToUint32(ipStr string) (uint32, bool) {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return 0, false
	}

	// Check for IPv4
	ip4 := ip.To4()
	if ip4 == nil {
		return 0, false // IPv6, ignore
	}

	return binary.BigEndian.Uint32(ip4), true
}

// RecordView records a view for a note, deduplicating by IP
func (v *Views) RecordView(noteID int64, ipHeader string) {
	if v.ipHeaderName == "" || ipHeader == "" {
		return
	}

	ipNum, ok := ipToUint32(ipHeader)
	if !ok {
		return // Ignore IPv6 or invalid IP
	}

	v.mu.Lock()
	defer v.mu.Unlock()

	// Initialize IP set for this note if needed
	if v.seenIPs[noteID] == nil {
		v.seenIPs[noteID] = make(map[uint32]struct{})
	}

	// Check if this IP already viewed this note
	if _, seen := v.seenIPs[noteID][ipNum]; seen {
		return
	}

	// Record the view
	v.seenIPs[noteID][ipNum] = struct{}{}
	v.counts[noteID]++
}

// GetViews returns the view count for a note
func (v *Views) GetViews(noteID int64) int64 {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.counts[noteID]
}

// GetIPHeaderName returns the configured IP header name
func (v *Views) GetIPHeaderName() string {
	return v.ipHeaderName
}

// Shutdown persists views before shutdown
func (v *Views) Shutdown() {
	v.persist()
}
