using AudioIntel.Models;
using Microsoft.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

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
                try
                {
                    string alterTable = "ALTER TABLE Users ADD COLUMN CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP;";
                    using (var cmd = new SqliteCommand(alterTable, connection)) { cmd.ExecuteNonQuery(); }
                }
                catch
                {
                    /* העמודה כבר קיימת, הכל טוב */
                }
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

        public (bool success, string message) RegisterUser(string username, string password, string role, string firstName, string lastName, string idNumber)
        {
            if (string.IsNullOrEmpty(idNumber) || idNumber.Length != 9 || !idNumber.All(char.IsDigit))
            {
                return (false, "Invalid Identification Number. Must be 9 digits.");
            }
            try
            {
                using var connection = new SqliteConnection(connectionString);
                connection.Open();

                // CHecking if id exists
                string checkQuery = "SELECT COUNT(*) FROM Users WHERE Username = @un OR IDNumber = @id";
                using (var checkCmd = new SqliteCommand(checkQuery, connection))
                {
                    checkCmd.Parameters.AddWithValue("@un", username);
                    checkCmd.Parameters.AddWithValue("@id", idNumber);
                    if ((long)checkCmd.ExecuteScalar() > 0)
                        return (false, "Identification Number or Username already exists.");
                }

                string salt = CreateSalt();
                string hash = HashPassword(password, salt);

                string insertQuery = @"
                    INSERT INTO Users (Username, PasswordHash, Salt, Role, FirstName, LastName, IDNumber, ForceChangePassword, CreatedAt) 
                    VALUES (@user, @hash, @salt, @role, @fname, @lname, @idnum, 1, DATETIME('now'))";

                using var command = new SqliteCommand(insertQuery, connection);
                command.Parameters.AddWithValue("@user", username);
                command.Parameters.AddWithValue("@hash", hash);
                command.Parameters.AddWithValue("@salt", salt);
                command.Parameters.AddWithValue("@role", role);
                command.Parameters.AddWithValue("@fname", firstName);
                command.Parameters.AddWithValue("@lname", lastName);
                command.Parameters.AddWithValue("@idnum", idNumber);

                command.ExecuteNonQuery();
                return (true, "Success");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Register Error: {ex.Message}");
                return (false, "An internal error occurred.");
            }
        }

        public User? ValidateUser(string username, string password)
        {
            using var connection = new SqliteConnection(connectionString);
            connection.Open();

            string getSaltQuery = @"SELECT PasswordHash, Salt, Role, Id, ForceChangePassword, 
                                   FirstName, LastName, IDNumber, CreatedAt 
                            FROM Users WHERE Username = @user";

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
                        UserName = username,
                        Role = role,
                        ForceChangePassword = forceChange,

                        FirstName = reader.IsDBNull(5) ? "" : reader.GetString(5),
                        LastName = reader.IsDBNull(6) ? "" : reader.GetString(6),
                        IDNumber = reader.IsDBNull(7) ? "" : reader.GetString(7),
                        CreatedAt = reader.IsDBNull(8) ? "" : reader.GetString(8)
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

        public bool DeleteUser(int targetID)
        {
            try
            {
                using var connection = new SqliteConnection(connectionString);
                connection.Open();

                string query = @"
                    DELETE FROM Users
                    WHERE Id = @targetID";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@targetID", targetID);

                int rowsAffected = command.ExecuteNonQuery();
                return rowsAffected > 0;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error deleting user: {ex.Message}");
                return false;
            }
        }

        public (bool success, string message) UpdateUser(int id, string firstName, string lastName, string idNumber, string role, string password = "")
        {
            try
            {
                using var connection = new SqliteConnection(connectionString);
                connection.Open();

                // 1. בדיקת כפילות ת"ז (מלבד המשתמש הנוכחי)
                string checkQuery = "SELECT COUNT(*) FROM Users WHERE IDNumber = @id AND Id != @userId";
                using (var checkCmd = new SqliteCommand(checkQuery, connection))
                {
                    checkCmd.Parameters.AddWithValue("@id", idNumber);
                    checkCmd.Parameters.AddWithValue("@userId", id);
                    if (Convert.ToInt64(checkCmd.ExecuteScalar()) > 0)
                        return (false, "Identification Number already exists for another user.");
                }

                // 2. בניית השאילתה
                string updateQuery;
                bool isChangingPassword = !string.IsNullOrEmpty(password);

                if (isChangingPassword)
                {
                    updateQuery = @"UPDATE Users SET FirstName=@fname, LastName=@lname, IDNumber=@idnum, Role=@role, 
                            PasswordHash=@hash, Salt=@salt WHERE Id=@userId";
                }
                else
                {
                    updateQuery = @"UPDATE Users SET FirstName=@fname, LastName=@lname, IDNumber=@idnum, Role=@role 
                            WHERE Id=@userId";
                }

                using var command = new SqliteCommand(updateQuery, connection);
                command.Parameters.AddWithValue("@fname", firstName);
                command.Parameters.AddWithValue("@lname", lastName);
                command.Parameters.AddWithValue("@idnum", idNumber);
                command.Parameters.AddWithValue("@role", role);
                command.Parameters.AddWithValue("@userId", id);

                if (isChangingPassword)
                {
                    string salt = CreateSalt();
                    string hash = HashPassword(password, salt);
                    command.Parameters.AddWithValue("@hash", hash);
                    command.Parameters.AddWithValue("@salt", salt);
                }

                command.ExecuteNonQuery();
                return (true, "Update successful");
            }
            catch (Exception ex)
            {

                Console.WriteLine($"Update Error: {ex.Message}");
                return (false, $"Internal error: {ex.Message}");
            }
        }

        public (bool success, string message) UpdateSelfProfile(int userId, string firstName, string lastName, string newPassword = "")
        {
            try
            {
                using var connection = new SqliteConnection(connectionString);
                connection.Open();

                // בניית השאילתה - רק שמות וסיסמה (בלי Role ובלי IDNumber)
                string query;
                bool isChangingPassword = !string.IsNullOrEmpty(newPassword);

                if (isChangingPassword)
                {
                    string salt = CreateSalt();
                    string hash = HashPassword(newPassword, salt);
                    query = "UPDATE Users SET FirstName=@fn, LastName=@ln, PasswordHash=@h, Salt=@s WHERE Id=@id";
                }
                else
                {
                    query = "UPDATE Users SET FirstName=@fn, LastName=@ln WHERE Id=@id";
                }

                using var cmd = new SqliteCommand(query, connection);
                cmd.Parameters.AddWithValue("@fn", firstName);
                cmd.Parameters.AddWithValue("@ln", lastName);
                cmd.Parameters.AddWithValue("@id", userId);

                if (isChangingPassword)
                {
                    // שליפת המלח וההאש שנוצרו למעלה
                    string salt = CreateSalt(); // רצוי להשתמש במשתנים שכבר נוצרו
                    string hash = HashPassword(newPassword, salt);
                    cmd.Parameters.AddWithValue("@h", hash);
                    cmd.Parameters.AddWithValue("@s", salt);
                }

                cmd.ExecuteNonQuery();
                return (true, "Profile updated successfully");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"UpdateSelf Error: {ex.Message}");
                return (false, "Internal error during profile update.");
            }
        }

        public SystemStats GetAdminDashboardStats()
        {
            var stats = new SystemStats();
            try
            {
                using var connection = new SqliteConnection(connectionString);
                connection.Open();
                stats.DbStatus = true;

                //User count
                var userCmd = new SqliteCommand("SELECT COUNT(*) FROM Users", connection);
                stats.TotalUsers = Convert.ToInt32(userCmd.ExecuteScalar());

                //File count
                var fileCmd = new SqliteCommand("SELECT COUNT(*) FROM UploadedFiles", connection);
                stats.TotalFiles = Convert.ToInt32(fileCmd.ExecuteScalar());

                //Calc storage
                var fileInfo = new System.IO.FileInfo("AudioIntel.db");
                stats.StorageUsedBytes = fileInfo.Exists ? fileInfo.Length : 0;

                //Update uptime
                var uptime = DateTime.Now - System.Diagnostics.Process.GetCurrentProcess().StartTime;
                stats.Uptime = $"{(int)uptime.TotalDays}d {uptime.Hours}h {uptime.Minutes}m";
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Dashboard Stats Error: {ex.Message}");
                stats.DbStatus = false;
            }
            return stats;
        }


    }
}