package auth

import (
	"sync"
	"time"
)

type BanEntry struct {
	Namespace   string    `json:"namespace"`
	IP          string    `json:"ip"`
	FailCount   int       `json:"failCount"`
	BannedUntil time.Time `json:"bannedUntil"`
}

type ipRecord struct {
	attempts    []time.Time
	bannedUntil time.Time
}

type RateLimiter struct {
	mu          sync.Mutex
	maxFailures int
	window      time.Duration
	banDuration time.Duration
	records     map[string]*ipRecord // key: namespace + "|" + ip
}

func NewRateLimiter(maxFailures int, window, banDuration time.Duration) *RateLimiter {
	if maxFailures <= 0 {
		maxFailures = 5
	}
	if window <= 0 {
		window = 5 * time.Minute
	}
	if banDuration <= 0 {
		banDuration = 15 * time.Minute
	}
	return &RateLimiter{
		maxFailures: maxFailures,
		window:      window,
		banDuration: banDuration,
		records:     make(map[string]*ipRecord),
	}
}

func (r *RateLimiter) key(namespace, ip string) string {
	return namespace + "|" + ip
}

func (r *RateLimiter) IsBanned(namespace, ip string) (bool, time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()

	rec, ok := r.records[r.key(namespace, ip)]
	if !ok {
		return false, 0
	}
	now := time.Now()
	if now.Before(rec.bannedUntil) {
		return true, rec.bannedUntil.Sub(now)
	}
	return false, 0
}

func (r *RateLimiter) RecordFailure(namespace, ip string) (banned bool, remaining time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := r.key(namespace, ip)
	rec, ok := r.records[k]
	if !ok {
		rec = &ipRecord{}
		r.records[k] = rec
	}

	now := time.Now()
	cutoff := now.Add(-r.window)
	valid := rec.attempts[:0]
	for _, t := range rec.attempts {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	valid = append(valid, now)
	rec.attempts = valid

	if len(rec.attempts) >= r.maxFailures {
		rec.bannedUntil = now.Add(r.banDuration)
		return true, r.banDuration
	}
	return false, 0
}

func (r *RateLimiter) RecordSuccess(namespace, ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.records, r.key(namespace, ip))
}

func (r *RateLimiter) Unban(namespace, ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.records, r.key(namespace, ip))
}

func (r *RateLimiter) ListBanned(namespace string) []BanEntry {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	out := make([]BanEntry, 0)
	for k, rec := range r.records {
		if !now.Before(rec.bannedUntil) {
			continue
		}
		var ns, ip string
		for i := 0; i < len(k); i++ {
			if k[i] == '|' {
				ns = k[:i]
				ip = k[i+1:]
				break
			}
		}
		if namespace != "" && ns != namespace {
			continue
		}
		out = append(out, BanEntry{
			Namespace:   ns,
			IP:          ip,
			FailCount:   len(rec.attempts),
			BannedUntil: rec.bannedUntil,
		})
	}
	return out
}
