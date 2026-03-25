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
            var folder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var dbPath = Path.Combine(folder, "AudioIntel", "AudioIntelDB.db");
            Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
            connectionString = $"Data Source={dbPath}";
        }

        public void InitializeDatabase()
        {
            using (var connection = new SqliteConnection(connectionString))
            {
                connection.Open();

                // 1. Users table with SALT column
                string userTable = @"
                CREATE TABLE IF NOT EXISTS Users (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Username TEXT NOT NULL UNIQUE,
                    PasswordHash TEXT NOT NULL,
                    Salt TEXT NOT NULL, 
                    Role TEXT NOT NULL,
                    FirstName TEXT,
                    LastName TEXT,
                    IDNumber TEXT UNIQUE,
                    ForceChangePassword INTEGER DEFAULT 1, -- 1 = true, 0 = false
                    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
                );";

                using (var cmd = new SqliteCommand(userTable, connection)) { cmd.ExecuteNonQuery(); }
                SeedDefaultUsers(connection);
            }
        }

        // Generate a random Salt
        private string CreateSalt()
        {
            byte[] saltBytes = new byte[32];
            using (var provider = RandomNumberGenerator.Create())
            {
                provider.GetBytes(saltBytes);
            }
            return Convert.ToBase64String(saltBytes);
        }

        // Hash password with salt
        private string HashPassword(string password, string salt)
        {
            using var sha256 = SHA256.Create();
            byte[] combinedBytes = Encoding.UTF8.GetBytes(password + salt);
            byte[] hashBytes = sha256.ComputeHash(combinedBytes);
            return Convert.ToBase64String(hashBytes);
        }

        public void RegisterUserInternal(string username, string password, string role, string firstName, string lastName, string idNumber, SqliteConnection? existingConnection = null)
        {
            string salt = CreateSalt();
            string hash = HashPassword(password, salt);

            string insertQuery = @"
                INSERT OR IGNORE INTO Users (Username, PasswordHash, Salt, Role, FirstName, LastName, IDNumber, ForceChangePassword) 
                VALUES (@user, @hash, @salt, @role, @fname, @lname, @idnum, 1)";

            using var connection = existingConnection ?? new SqliteConnection(connectionString);
            if (connection.State != System.Data.ConnectionState.Open) connection.Open();

            using var command = new SqliteCommand(insertQuery, connection);
            command.Parameters.AddWithValue("@user", username);
            command.Parameters.AddWithValue("@hash", hash);
            command.Parameters.AddWithValue("@salt", salt);
            command.Parameters.AddWithValue("@role", role);
            command.Parameters.AddWithValue("@fname", firstName);
            command.Parameters.AddWithValue("@lname", lastName);
            command.Parameters.AddWithValue("@idnum", idNumber);
            command.ExecuteNonQuery();
        }

        public User? ValidateUser(string username, string password)
        {
            using var connection = new SqliteConnection(connectionString);
            connection.Open();

            string getSaltQuery = "SELECT PasswordHash, Salt, Role, Id, ForceChangePassword FROM Users WHERE Username = @user";
            using var command = new SqliteCommand(getSaltQuery, connection);
            command.Parameters.AddWithValue("@user", username);

            using var reader = command.ExecuteReader();
            if (reader.Read())
            {
                string storedHash = reader.GetString(0);
                string salt = reader.GetString(1);
                string role = reader.GetString(2);
                int id = reader.GetInt32(3);

                bool forceChange = reader.GetInt32(4) == 1;

                string computedHash = HashPassword(password, salt);

                if (computedHash == storedHash)
                {
                    return new User
                    {
                        Id = id,
                        Username = username,
                        Role = role,
                        ForceChangePassword = forceChange
                    };
                }
            }
            return null;
        }

        public bool UpdateUserPassword(string username, string newPassword)
        {
            try
            {
                using var connection = new SqliteConnection(connectionString);
                connection.Open();

                string newSalt = CreateSalt();
                string newHash = HashPassword(newPassword, newSalt);

                string query = @"
                    UPDATE Users 
                    SET PasswordHash = @hash, 
                        Salt = @salt, 
                        ForceChangePassword = 0 
                    WHERE Username = @user";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@hash", newHash);
                command.Parameters.AddWithValue("@salt", newSalt);
                command.Parameters.AddWithValue("@user", username);

                int rowsAffected = command.ExecuteNonQuery();
                return rowsAffected > 0;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error updating password: {ex.Message}");
                return false;
            }
        }

        private void SeedDefaultUsers(SqliteConnection connection)
        {
            RegisterUserInternal("admin", "1234", "Admin", "System", "Administrator", "000000000", connection);
            RegisterUserInternal("analyst", "1234", "Analyst", "Israel", "Israeli", "123456789", connection);
        }

        public List<object> GetAllUsers()
        {
            var users = new List<object>();
            try
            {
                using (var connection = new SqliteConnection(connectionString))
                {
                    connection.Open();
                    var command = connection.CreateCommand();
                    command.CommandText = "SELECT Id, Username, Role, FirstName, LastName, IDNumber, CreatedAt FROM Users";

                    using (var reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            users.Add(new
                            {
                                id = reader.GetInt32(0),
                                username = reader.GetString(1),
                                role = reader.GetString(2),
                                firstName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                                lastName = reader.IsDBNull(4) ? "" : reader.GetString(4),
                                idNumber = reader.IsDBNull(5) ? "" : reader.GetString(5),
                                createdAt = reader.IsDBNull(6) ? "" : reader.GetDateTime(6).ToString("yyyy-MM-dd HH:mm:ss")
                            });
                        }
                    }
                }
            }
            catch (Exception ex) { Console.WriteLine($"DB Error: {ex.Message}"); }
            return users;
        }
    }
}