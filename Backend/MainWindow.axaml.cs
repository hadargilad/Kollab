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
                            // שים לב: אנחנו שולחים לריאקט את ה-ForceChangePassword כדי שידע אם לחסום את הגישה
                            var response = new
                            {
                                type = "LOGIN_SUCCESS",
                                role = validatedUser.Role,
                                username = validatedUser.Username,
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
                        _dbManager.RegisterUserInternal(
                            payload.GetProperty("username").GetString()!,
                            payload.GetProperty("password").GetString()!,
                            payload.GetProperty("role").GetString()!,
                            payload.GetProperty("firstName").GetString()!,
                            payload.GetProperty("lastName").GetString()!,
                            payload.GetProperty("idNumber").GetString()!
                        );
                        SendToReact(new { type = "USER_ADDED_SUCCESS" });
                    }

                    // --- 4. UPDATE PASSWORD (SECURITY FLOW) ---
                    if (type == "UPDATE_USER_PASSWORD")
                    {
                        var payload = doc.RootElement.GetProperty("payload");
                        string user = payload.GetProperty("username").GetString() ?? "";
                        string newPass = payload.GetProperty("newPassword").GetString() ?? "";

                        // קריאה לפונקציה שמעדכנת Hash/Salt ומבטלת את דגל ה-ForceChange
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