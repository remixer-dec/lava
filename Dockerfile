FROM golang:1.21-alpine AS builder

WORKDIR /app
RUN mkdir -p /app/data
COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o lava-notes ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=builder /app/lava-notes .
COPY --from=builder /app/templates ./templates

EXPOSE 2025

CMD ["./lava-notes", "-data", "/app/data"]
