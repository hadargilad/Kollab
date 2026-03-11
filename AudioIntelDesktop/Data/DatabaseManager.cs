using System;
using System.Collections.Generic;
using Microsoft.Data.Sqlite;
using AudioIntelDesktop.Models;
using System.Security.Cryptography;
using System.Text;
using System.ComponentModel;

namespace AudioIntelDesktop.Data
{
    // Handles all database operations using SQLite
    public class DatabaseManager
    {
        // Connection string for the local SQLite database file
        private readonly string connectionString = "Data Source=AudioIntelDB.db";

        // Creates the database and the AudioFiles table if they do not exist
        public void InitializeDatabase()
        {
            using (var connection = new SqliteConnection(connectionString))
            {
                connection.Open();

                // 1. Table for Audio Files
                string filesTable = @"
            CREATE TABLE IF NOT EXISTS AudioFiles (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                FileName TEXT NOT NULL,
                FilePath TEXT NOT NULL,
                UploadDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                Status TEXT DEFAULT 'Uploaded'
            );";

                // 2. Table for Speakers
                string speakersTable = @"
            CREATE TABLE IF NOT EXISTS Speakers (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                SpeakerTag TEXT NOT NULL,
                VoicePrintData BLOB,
                TotalSpeakingTime REAL
            );";

                // 3. Table for Transcriptions
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

                string userTable = @"
            CREATE TABLE IF NOT EXISTS Users (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Username TEXT NOT NULL UNIQUE,
                PasswordHash TEXT NOT NULL,
                Role TEXT NOT NULL -- 'Admin' or 'Analyst'
            )";
                using var command = new SqliteCommand(userTable, connection);
                command.ExecuteNonQuery();

                // Execute each command separately to avoid syntax confusion
                using (var cmd1 = new SqliteCommand(filesTable, connection)) { cmd1.ExecuteNonQuery(); }
                using (var cmd2 = new SqliteCommand(speakersTable, connection)) { cmd2.ExecuteNonQuery(); }
                using (var cmd3 = new SqliteCommand(transcriptionsTable, connection)) { cmd3.ExecuteNonQuery(); }
            }
        }

        // Retrieves the total number of audio files in the database
        public int GetTotalFilesCount()
        {
            int count = 0;
            using (var connection = new SqliteConnection(connectionString))
            {
                connection.Open();

                string query = "SELECT COUNT(*) FROM AudioFiles;";

                using (var command = new SqliteCommand(query, connection))
                {
                    // ExecuteScalar is used to get a single value (the count)
                    count = Convert.ToInt32(command.ExecuteScalar());
                }
            }
            return count;
        }

        // Retrieves a list of the most recently uploaded files (up to 50)
        public List<UploadedFile> GetRecentFiles()
        {
            List<UploadedFile> files = new List<UploadedFile>();

            using (var connection = new SqliteConnection(connectionString))
            {
                connection.Open();

                // Fetch files ordered by Id descending (newest first)
                string query = "SELECT Id, FileName, UploadDate, Status FROM AudioFiles ORDER BY Id DESC LIMIT 50;";

                using (var command = new SqliteCommand(query, connection))
                {
                    using (var reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            files.Add(new UploadedFile
                            {
                                Id = reader.GetInt32(0),
                                FileName = reader.GetString(1),
                                // Format the date to a readable string
                                UploadDate = reader.GetDateTime(2).ToString("dd/MM/yyyy HH:mm"),
                                // Handle potential null values in the Status column
                                Status = reader.IsDBNull(3) ? "Unknown" : reader.GetString(3)
                            });
                        }
                    }
                }
            }
            return files;
        }

        public int GetTotalSpeakersCount()
        {
            int count = 0;
            using (var connection = new SqliteConnection(connectionString))
            {
                connection.Open();
                string query = "SELECT COUNT(*) FROM Speakers;";
                using (var command = new SqliteCommand(query, connection))
                {
                    count = Convert.ToInt32(command.ExecuteScalar());
                }
            }
            return count;
        }

        // Add new user with username, password and role
        public void RegisterUser(string username, string password, string role)
        {
            using var connection = new SqliteConnection(connectionString);
            connection.Open();

            //hashing the password before saving
            using var sha256 = SHA256.Create();
            byte[] bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
            string hash = Convert.ToBase64String(bytes);

            string insertQuery = "INSERT INTO Users (Username, PasswordHash, Role) VALUES (@user, @hash, @role)";
            using var command = new SqliteCommand(insertQuery, connection);
            command.Parameters.AddWithValue("@user", username);
            command.Parameters.AddWithValue("@hash", hash);
            command.Parameters.AddWithValue("@role", role);

            command.ExecuteNonQuery();
        }

        // Login user
        public User? ValidateUser(string username, string password)
        {
            using var connection = new SqliteConnection(connectionString);
            connection.Open();

            // Hashing the password to compare
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
                // If found, return user
                return new User
                {
                    Id = reader.GetInt32(0),
                    Username = reader.GetString(1),
                    Role = reader.GetString(2)
                };
            }

            return null; // If not found, return null
        }
    }

}