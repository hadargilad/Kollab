using Avalonia;
using Avalonia.Controls;
using Avalonia.Markup.Xaml;
using AudioIntel.Data;
using System.Text.Json;
using System;
using System.Threading.Tasks;

namespace AudioIntel
{
    public partial class MainWindow : Window
    {
        private readonly DatabaseManager _dbManager;
        private WebViewControl.WebView? _webViewControl;

        public MainWindow()
        {
            InitializeComponent();
            _dbManager = new DatabaseManager();
            _dbManager.InitializeDatabase();

            LoadReact();
        }

        private void InitializeComponent()
        {
            AvaloniaXamlLoader.Load(this);
            _webViewControl = this.FindControl<WebViewControl.WebView>("MyWebView");

            if (_webViewControl != null)
            {
                _webViewControl.RegisterJavascriptObject("Backend", new WebBridge(this));
            }
        }

        private void LoadReact()
        {
            if (_webViewControl != null)
            {
                _webViewControl.TitleChanged += () => {
                    string title = _webViewControl.Title;
                    if (!string.IsNullOrEmpty(title) && title.StartsWith("JSON:"))
                    {
                        string jsonContent = title.Substring(5);
                        OnWebMessageReceived(jsonContent);
                    }
                };

                _webViewControl.Address = "http://localhost:5173";
            }
        }

        public void OnWebMessageReceived(string message)
        {
            if (string.IsNullOrEmpty(message)) return;

            try
            {
                using (JsonDocument doc = JsonDocument.Parse(message))
                {
                    string type = doc.RootElement.GetProperty("type").GetString() ?? "";

                    // --- 1. LOGIN LOGIC ---
                    if (type == "LOGIN_ATTEMPT")
                    {
                        var payload = doc.RootElement.GetProperty("payload");
                        string user = payload.GetProperty("username").GetString() ?? "";
                        string pass = payload.GetProperty("password").GetString() ?? "";

                        var validatedUser = _dbManager.ValidateUser(user, pass);

                        if (validatedUser != null)
                        {
                            var response = new
                            {
                                type = "LOGIN_SUCCESS",
                                role = validatedUser.Role,
                                username = validatedUser.UserName,
                                forceChangePassword = validatedUser.ForceChangePassword
                            };
                            SendToReact(response);
                        }
                        else
                        {
                            SendToReact(new { type = "LOGIN_ERROR" });
                        }
                    }

                    // --- 2. FETCH USERS ---
                    if (type == "GET_USERS_LIST")
                    {
                        var allUsers = _dbManager.GetAllUsers();
                        SendToReact(new { type = "USERS_LIST_DATA", payload = allUsers });
                    }

                    // --- 3. ADD NEW USER (AUD-12) ---
                    if (type == "ADD_NEW_USER")
                    {
                        var payload = doc.RootElement.GetProperty("payload");
                        var result = _dbManager.RegisterUser(
                            payload.GetProperty("username").GetString()!,
                            payload.GetProperty("password").GetString()!,
                            payload.GetProperty("role").GetString()!,
                            payload.GetProperty("firstName").GetString()!,
                            payload.GetProperty("lastName").GetString()!,
                            payload.GetProperty("idNumber").GetString()!
                        );

                        if (result.success)
                        {
                            SendToReact(new { type = "USER_ADDED_SUCCESS" });
                        }
                        else
                        {
                            SendToReact(new
                            {
                                type = "FORM_ERROR",
                                message = result.message
                            });
                        }
                    }

                    if (type == "VERIFY_AND_EXECUTE")
                    {
                        var payload = doc.RootElement.GetProperty("payload");
                        string action = payload.GetProperty("actionType").GetString();
                        string adminPass = payload.GetProperty("adminPassword").GetString();
                        string adminUser = payload.GetProperty("adminUsername").GetString();

                        var admin = _dbManager.ValidateUser(adminUser, adminPass);
                        if (admin != null && admin.Role == "Admin")
                        {
                            if (action == "DELETE")
                            {
                                int targetId = payload.GetProperty("targetUserId").GetInt32();
                                _dbManager.DeleteUser(targetId);
                                SendToReact(new { type = "USER_DELETED_SUCCESS" });
                            }
                            else if (action == "EDIT")
                            {
                                SendToReact(new { type = "SECURITY_VERIFIED_FOR_EDIT" });
                            }
                        }
                        else
                        {
                            SendToReact(new { type = "SECURITY_ALERT", message = "Wrong Admin Password!" });
                        }
                    }

                    if (type == "UPDATE_USER")
                    {
                        var payload = doc.RootElement.GetProperty("payload");
                        var result = _dbManager.UpdateUser(
                            payload.GetProperty("id").GetInt32(),
                            payload.GetProperty("firstName").GetString(),
                            payload.GetProperty("lastName").GetString(),
                            payload.GetProperty("idNumber").GetString(),
                            payload.GetProperty("role").GetString(),
                            payload.TryGetProperty("password", out var p) ? p.GetString() : ""
                        );

                        if (result.success)
                            SendToReact(new { type = "USER_UPDATED_SUCCESS" });
                        else
                            SendToReact(new { type = "FORM_ERROR", message = result.message });
                    }

                    // --- 4. UPDATE PASSWORD (SECURITY FLOW) ---
                    if (type == "UPDATE_USER_PASSWORD")
                    {
                        var payload = doc.RootElement.GetProperty("payload");
                        string user = payload.GetProperty("username").GetString() ?? "";
                        string newPass = payload.GetProperty("newPassword").GetString() ?? "";

                        bool success = _dbManager.UpdateUserPassword(user, newPass);

                        if (success)
                        {
                            SendToReact(new { type = "PASSWORD_UPDATE_SUCCESS" });
                        }
                        else
                        {
                            SendToReact(new { type = "PASSWORD_UPDATE_ERROR" });
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Bridge Error: {ex.Message}");
            }
        }

        private void SendToReact(object data)
        {
            if (_webViewControl == null) return;
            string json = JsonSerializer.Serialize(data);
            _webViewControl.ExecuteScript($"if(window.dispatchWebMessage) {{ window.dispatchWebMessage({json}); }}");
        }
    }

    public class WebBridge
    {
        private readonly MainWindow _window;
        public WebBridge(MainWindow window) => _window = window;
        public void PostMessage(string message) => _window.OnWebMessageReceived(message);
    }
}