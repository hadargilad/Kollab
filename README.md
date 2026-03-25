# 🎙️ Audio-Intel | Secure Intelligence Platform

An advanced intelligence platform for audio analysis, transcription, and speaker identification. This system integrates a **React-based Frontend** with a **.NET/Avalonia Backend**, using **SQLite** for secure data management.

---

## 🛠️ System Architecture

The project is divided into two main components:
* **Frontend:** React + Vite + Tailwind CSS (Running in Docker).
* **Backend:** .NET 8 + Avalonia UI + WebViewControl (Desktop Application).

---

## 🚀 Getting Started

Follow these steps to get the development environment up and running.

### 📋 Prerequisites
* **Docker Desktop** (Make sure it's running)
* **dotnet SDK 8.0**
* **Visual Studio 2022** (Windows) OR **VS Code** (Mac/Linux)

---

### 1️⃣ Step 1: Launch the UI (Docker)
The frontend must be running for the desktop application to display the interface.

1.  Open a terminal in the project root.
2.  Navigate to the UI directory:
    ```bash
    cd audio-intel-ui
    ```
3.  Start the container:
    ```bash
    docker-compose up --build
    ```
4.  Once ready, the UI will be accessible at `http://localhost:5173`.

---

### 2️⃣ Step 2: Launch the Desktop App (C#)

#### 🍎 For Mac/Linux (Using VS Code):
1.  Open the root folder in **VS Code**.
2.  Install the **C# Dev Kit** extension.
3.  Open the **Terminal** in VS Code and run:
    ```bash
    dotnet run --project Backend/AudioIntel.csproj
    ```
    *Note: If you are on an Intel Mac and encounter issues, try `dotnet run --project Backend/AudioIntel.csproj --arch x64`.*

#### 🪟 For Windows:
**Option A: Using Visual Studio 2022 (Recommended)**
1. Open `AudioIntel.sln`.
2. Set Solution Platform to **x64**.
3. Press **F5**.

**Option B: Using VS Code**
1. Open the folder in VS Code.
2. Open the Terminal and run:
   ```bash
   dotnet run --project Backend/AudioIntel.csproj --arch x64  
   ```

---

## 🔐 Access Credentials

The system automatically seeds the database with the following test users on its first run:

| Role        | Username  | Password |
| ----------- | --------- | -------- |
| **Admin** | `admin`   | `Aa!12345`   |
| **Analyst** | `analyst` | `1234`   |

---

## 📁 Project Structure

```text
AudioIntel/
├── AudioIntel/             # C# Backend (Avalonia UI)
│   ├── Data/               # Database management (SQLite)
│   ├── Models/             # Data models
│   └── MainWindow.axaml    # Desktop Window & WebView
├── audio-intel-ui/         # React Frontend
│   ├── src/                # UI Components & Logic
│   └── docker-compose.yml  # Docker configuration
└── README.md               # You are here!
