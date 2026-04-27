# AudioIntel — Secure Intelligence Platform

---

## Prerequisites

Install these before starting:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — must be **running**
- [Node.js 20+](https://nodejs.org/)
- [Rust](https://rustup.rs/)

---

## One-time setup

Run from the **project root**:

```bash
cd audio-intel-ui
npm install
cd ..
```

---

## Run

Make sure **Docker Desktop is open and running**, then from the **project root**:

```bash
npm run dev:ml
```

This starts the backend + ML service in Docker and opens the desktop app.

> First run downloads ~4 GB of ML models and compiles Rust (~2 min). Subsequent runs are fast.

---

## Default credentials

| Role    | Username   | Password  | Notes                              |
|---------|------------|-----------|------------------------------------|
| Admin   | `admin`    | `Aa!12345`| Full access                        |
| Analyst | `analyst`  | `1234`    | Must change password on first login|
