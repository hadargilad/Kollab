using Avalonia;
using Avalonia.Controls;
using Avalonia.Markup.Xaml;
using AudioIntel.Data;
using System.Text.Json;
using System;

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

            if (_webViewControl != null)
            {
                _webViewControl.RegisterJavascriptObject("Backend", new WebBridge(this));
            }

            LoadReact();
        }

        private void InitializeComponent()
        {
            AvaloniaXamlLoader.Load(this);
            _webViewControl = this.FindControl<WebViewControl.WebView>("MyWebView");

            if (_webViewControl != null)
            {
                // רישום האובייקט - זה החלק שיוצר את window.Backend בריאקט
                _webViewControl.RegisterJavascriptObject("Backend", new WebBridge(this));

                // תיקון השגיאה: גישה סטטית להגדרות (אם זה נחוץ בגרסה שלך)
                // WebViewControl.WebView.Settings.IsJavaScriptEnabled = true; 
            }
        }

        private void LoadReact()
        {
            if (_webViewControl != null)
            {
                // תיקון השגיאה: הסרת הפרמטרים מה-Delegate
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
        private void OnJavascriptContextCreated()
        {
            // רישום הגשר - ודאי שהשם "Backend" תואם למה שהשותפה משתמשת בריאקט
            _webViewControl?.RegisterJavascriptObject("Backend", new WebBridge(this));
        }

        // השארנו כ-public כדי שה-WebBridge יוכל לגשת
        public void OnWebMessageReceived(string message)
        {
            if (string.IsNullOrEmpty(message)) return;

            try
            {
                using (JsonDocument doc = JsonDocument.Parse(message))
                {
                    string type = doc.RootElement.GetProperty("type").GetString() ?? "";

                    if (type == "LOGIN_ATTEMPT")
                    {
                        var payload = doc.RootElement.GetProperty("payload");
                        string user = payload.GetProperty("username").GetString() ?? "";
                        string pass = payload.GetProperty("password").GetString() ?? "";

                        var validatedUser = _dbManager.ValidateUser(user, pass);

                        if (validatedUser != null)
                        {
                            var response = new { type = "LOGIN_SUCCESS", role = validatedUser.Role };
                            SendToReact(response);
                        }
                        else
                        {
                            var response = new { type = "LOGIN_ERROR" };
                            SendToReact(response);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error: {ex.Message}");
            }
        }

        private void SendToReact(object data)
        {
            if (_webViewControl == null) return;
            string json = JsonSerializer.Serialize(data);
            // שימוש ב-ExecuteScript כפי שמצאנו ב-Object Browser
            _webViewControl.ExecuteScript($"if(window.dispatchWebMessage) {{ window.dispatchWebMessage({json}); }}");
        }
    }

    public class WebBridge
    {
        private readonly MainWindow _window;
        public WebBridge(MainWindow window) => _window = window;

        public void PostMessage(string message)
        {
            _window.OnWebMessageReceived(message);
        }
    }
}