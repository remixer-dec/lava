package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"lava-notes/internal/db"
)

var ErrInvalidToken = errors.New("invalid token")
var ErrTokenExpired = errors.New("token expired")
var ErrTokenUsed = errors.New("token already used")

type Auth struct {
	db        *db.DB
	jwtSecret []byte
}

type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func New(database *db.DB, secret string) *Auth {
	return &Auth{
		db:        database,
		jwtSecret: []byte(secret),
	}
}

func (a *Auth) GenerateLoginLink(baseURL string) (string, error) {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return "", err
	}
	tokenStr := hex.EncodeToString(token)

	expiresAt := time.Now().Add(24 * time.Hour) // Link valid for 24 hours
	if err := a.db.CreateAuthToken(tokenStr, expiresAt); err != nil {
		return "", err
	}

	return baseURL + "/auth/login?token=" + tokenStr, nil
}

func (a *Auth) ValidateLoginToken(token string) (string, error) {
	authToken, err := a.db.GetAuthToken(token)
	if err != nil {
		return "", ErrInvalidToken
	}

	if authToken.Used {
		return "", ErrTokenUsed
	}

	if time.Now().After(authToken.ExpiresAt) {
		return "", ErrTokenExpired
	}

	if err := a.db.MarkTokenUsed(token); err != nil {
		return "", err
	}

	return a.GenerateJWT()
}

func (a *Auth) GenerateJWT() (string, error) {
	claims := &Claims{
		Role: "writer",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(90 * 24 * time.Hour)), // 3 months
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "lava-notes",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

func (a *Auth) ValidateJWT(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return a.jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, ErrInvalidToken
}

func (a *Auth) Middleware(next http.HandlerFunc, requireAuth bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")

		if authHeader == "" {
			cookie, err := r.Cookie("lava_token")
			if err == nil {
				authHeader = "Bearer " + cookie.Value
			}
		}

		if authHeader == "" {
			if requireAuth {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next(w, r)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			if requireAuth {
				http.Error(w, "Invalid authorization header", http.StatusUnauthorized)
				return
			}
			next(w, r)
			return
		}

		claims, err := a.ValidateJWT(parts[1])
		if err != nil {
			if requireAuth {
				http.Error(w, "Invalid token", http.StatusUnauthorized)
				return
			}
			next(w, r)
			return
		}

		r.Header.Set("X-User-Role", claims.Role)
		next(w, r)
	}
}

func IsWriter(r *http.Request) bool {
	return r.Header.Get("X-User-Role") == "writer"
}
