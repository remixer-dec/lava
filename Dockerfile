FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o lava-notes ./cmd/server

FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/lava-notes .
COPY --from=builder /app/templates ./templates

RUN mkdir -p /app/data

EXPOSE 8080

CMD ["./lava-notes", "-data", "/app/data"]
