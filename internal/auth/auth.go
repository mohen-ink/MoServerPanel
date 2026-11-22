package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"win-server-panel/internal/config"
)

const CookieName = "wsp_token"

var (
	ErrAlreadyInitialized = errors.New("面板已完成初始化")
	ErrNotInitialized     = errors.New("面板尚未初始化，请先设置管理员账号")
	ErrInvalidCredentials = errors.New("用户名或密码错误")
	ErrWeakPassword       = errors.New("密码长度至少为 8 位")
	ErrInvalidUsername    = errors.New("用户名不能为空且长度在 2-32 字符之间")
)

type Manager struct {
	store   *config.Store
	limiter *RateLimiter
}

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

func NewManager(store *config.Store, limiter *RateLimiter) *Manager {
	return &Manager{
		store:   store,
		limiter: limiter,
	}
}

func (m *Manager) Limiter() *RateLimiter {
	return m.limiter
}

func (m *Manager) IsInitialized() bool {
	return m.store.GetConfig().Auth.Initialized
}

func (m *Manager) Setup(username, password string) error {
	username = strings.TrimSpace(username)
	if len(username) < 2 || len(username) > 32 {
		return ErrInvalidUsername
	}
	if len(password) < 8 {
		return ErrWeakPassword
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	return m.store.UpdateConfig(func(c *config.PanelConfig) error {
		if c.Auth.Initialized {
			return ErrAlreadyInitialized
		}
		c.Auth.Initialized = true
		c.Auth.Username = username
		c.Auth.PasswordHash = string(hash)
		return nil
	})
}

func (m *Manager) Login(username, password, clientIP string) (string, time.Time, error) {
	cfg := m.store.GetConfig()
	if !cfg.Auth.Initialized {
		return "", time.Time{}, ErrNotInitialized
	}

	if banned, rem := m.limiter.IsBanned("panel", clientIP); banned {
		return "", time.Time{}, fmt.Errorf("登录失败次数过多，IP 已临时锁定，请 %d 秒后重试", int(rem.Seconds())+1)
	}

	if strings.TrimSpace(username) != cfg.Auth.Username {
		m.limiter.RecordFailure("panel", clientIP)
		return "", time.Time{}, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(cfg.Auth.PasswordHash), []byte(password)); err != nil {
		m.limiter.RecordFailure("panel", clientIP)
		return "", time.Time{}, ErrInvalidCredentials
	}

	m.limiter.RecordSuccess("panel", clientIP)
	return m.issueToken(cfg)
}

func (m *Manager) ChangePassword(oldPassword, newPassword string) error {
	if len(newPassword) < 8 {
		return ErrWeakPassword
	}
	cfg := m.store.GetConfig()
	if !cfg.Auth.Initialized {
		return ErrNotInitialized
	}
	if err := bcrypt.CompareHashAndPassword([]byte(cfg.Auth.PasswordHash), []byte(oldPassword)); err != nil {
		return errors.New("当前密码不正确")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return m.store.UpdateConfig(func(c *config.PanelConfig) error {
		c.Auth.PasswordHash = string(hash)
		return nil
	})
}

func (m *Manager) ResetPassword(username, newPassword string) error {
	if len(newPassword) < 8 {
		return ErrWeakPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return m.store.UpdateConfig(func(c *config.PanelConfig) error {
		if username != "" {
			c.Auth.Username = strings.TrimSpace(username)
		} else if c.Auth.Username == "" {
			c.Auth.Username = "admin"
		}
		c.Auth.Initialized = true
		c.Auth.PasswordHash = string(hash)
		return nil
	})
}

func (m *Manager) issueToken(cfg config.PanelConfig) (string, time.Time, error) {
	ttl := time.Duration(cfg.Auth.TokenTTLHours) * time.Hour
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	expiresAt := time.Now().Add(ttl)
	claims := Claims{
		Username: cfg.Auth.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   cfg.Auth.Username,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(cfg.Auth.JWTSecret))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

func (m *Manager) VerifyToken(tokenStr string) (*Claims, error) {
	cfg := m.store.GetConfig()
	if !cfg.Auth.Initialized {
		return nil, ErrNotInitialized
	}
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(cfg.Auth.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func (m *Manager) VerifyRequest(r *http.Request) (*Claims, error) {
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		return m.VerifyToken(c.Value)
	}
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return m.VerifyToken(strings.TrimPrefix(authHeader, "Bearer "))
	}
	return nil, errors.New("missing auth token")
}

func SetAuthCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func ClearAuthCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}
