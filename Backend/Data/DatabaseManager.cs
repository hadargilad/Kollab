using System;
using System.Collections.Generic;
using Microsoft.Data.Sqlite;
using AudioIntel.Models;
using System.Security.Cryptography;
using System.Text;
using System.IO;

namespace AudioIntel.Data
{
    public class DatabaseManager
    {
        private readonly string connectionString;

        public DatabaseManager()
        {
            // Get the local application data folder path
            var folder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var dbPath = Path.Combine(folder, "AudioIntel", "AudioIntelDB.db");

            // Ensure the directory exists
            Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
            connectionString = $"Data Source={dbPath}";
        }

        public void InitializeDatabase()
        {
            using (var connection = new SqliteConnection(connectionString))
            {
                connection.Open();

                // 1. Audio files metadata table
                string filesTable = @"
                CREATE TABLE IF NOT EXISTS AudioFiles (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    FileName TEXT NOT NULL,
                    FilePath TEXT NOT NULL,
                    UploadDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                    Status TEXT DEFAULT 'Uploaded'
                );";

                // 2. Speakers metadata table
                string speakersTable = @"
                CREATE TABLE IF NOT EXISTS Speakers (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    SpeakerTag TEXT NOT NULL,
                    VoicePrintData BLOB,
                    TotalSpeakingTime REAL
                );";

                // 3. Transcriptions mapping table
                string transcriptionsTable = @"
                CREATE TABLE IF NOT EXISTS Transcriptions (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    FileId INTEGER,
                    SpeakerId INTEGER,
                    TextContent TEXT,
                    Timestamp REAL,
                    FOREIGN KEY(FileId) REFERENCES AudioFiles(Id),
                    FOREIGN KEY(SpeakerId) REFERENCES Speakers(Id)
                );";

                // 4. Users and authentication table
                string userTable = @"
                CREATE TABLE IF NOT EXISTS Users (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Username TEXT NOT NULL UNIQUE,
                    PasswordHash TEXT NOT NULL,
                    Role TEXT NOT NULL
                );";

                // Execute table creation
                using (var cmd = new SqliteCommand(filesTable, connection)) { cmd.ExecuteNonQuery(); }
                using (var cmd = new SqliteCommand(speakersTable, connection)) { cmd.ExecuteNonQuery(); }
                using (var cmd = new SqliteCommand(transcriptionsTable, connection)) { cmd.ExecuteNonQuery(); }
                using (var cmd = new SqliteCommand(userTable, connection)) { cmd.ExecuteNonQuery(); }

                // Seed the database with default users if they don't exist
                SeedDefaultUsers(connection);
            }
        }

        private void SeedDefaultUsers(SqliteConnection connection)
        {
            // Register default Admin and Analyst users
            RegisterUserInternal("admin", "1234", "Admin", connection);
            RegisterUserInternal("analyst", "1234", "Analyst", connection);
        }

        private void RegisterUserInternal(string username, string password, string role, SqliteConnection connection)
        {
            using var sha256 = SHA256.Create();
            byte[] bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
            string hash = Convert.ToBase64String(bytes);

            // Use INSERT OR IGNORE to prevent errors if users already exist
            string insertQuery = "INSERT OR IGNORE INTO Users (Username, PasswordHash, Role) VALUES (@user, @hash, @role)";
            using var command = new SqliteCommand(insertQuery, connection);
            command.Parameters.AddWithValue("@user", username);
            command.Parameters.AddWithValue("@hash", hash);
            command.Parameters.AddWithValue("@role", role);
            command.ExecuteNonQuery();
        }

        public User? ValidateUser(string username, string password)
        {
            using var connection = new SqliteConnection(connectionString);
            connection.Open();

            using var sha256 = SHA256.Create();
            byte[] bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
            string hashInput = Convert.ToBase64String(bytes);

            string query = "SELECT Id, Username, Role FROM Users WHERE Username = @user AND PasswordHash = @hash";
            using var command = new SqliteCommand(query, connection);
            command.Parameters.AddWithValue("@user", username);
            command.Parameters.AddWithValue("@hash", hashInput);

            using var reader = command.ExecuteReader();
            if (reader.Read())
            {
                return new User
                {
                    Id = reader.GetInt32(0),
                    Username = reader.GetString(1),
                    Role = reader.GetString(2)
                };
            }
            return null;
        }

        public int GetTotalFilesCount()
        {
            using var connection = new SqliteConnection(connectionString);
            connection.Open();
            string query = "SELECT COUNT(*) FROM AudioFiles;";
            using var command = new SqliteCommand(query, connection);
            return Convert.ToInt32(command.ExecuteScalar());
        }

        public List<UploadedFile> GetRecentFiles()
        {
            List<UploadedFile> files = new List<UploadedFile>();
            using var connection = new SqliteConnection(connectionString);
            connection.Open();
            string query = "SELECT Id, FileName, UploadDate, Status FROM AudioFiles ORDER BY Id DESC LIMIT 50;";
            using var command = new SqliteCommand(query, connection);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                files.Add(new UploadedFile
                {
                    Id = reader.GetInt32(0),
                    FileName = reader.GetString(1),
                    UploadDate = reader.IsDBNull(2) ? "" : reader.GetDateTime(2).ToString("dd/MM/yyyy HH:mm"),
                    Status = reader.IsDBNull(3) ? "Unknown" : reader.GetString(3)
                });
            }
            return files;
        }
    }
}