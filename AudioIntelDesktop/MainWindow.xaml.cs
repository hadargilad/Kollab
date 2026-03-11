using System;
using System.Windows;
using AudioIntelDesktop.Data; 
using System.Text.Json;

namespace AudioIntelDesktop
{
    public partial class MainWindow : Window
    {
        private readonly DatabaseManager _dbManager;

        public MainWindow()
        {
            InitializeComponent();
            _dbManager = new DatabaseManager();
            _dbManager.InitializeDatabase();


            LoadReact();
        }

        async void LoadReact()
        {
            await webView.EnsureCoreWebView2Async();

            // Listener to the UI
            webView.WebMessageReceived += OnWebMessageReceived;

            webView.Source = new Uri("http://localhost:5173");
        }

        private void OnWebMessageReceived(object sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            //Receive message in json
            string jsonString = e.WebMessageAsJson;

            using (JsonDocument message = JsonDocument.Parse(jsonString))
            {
                string type = message.RootElement.GetProperty("type").GetString();

                if (type == "LOGIN_ATTEMPT")
                {
                    var payload = message.RootElement.GetProperty("payload");
                    string user = payload.GetProperty("username").GetString();
                    string pass = payload.GetProperty("password").GetString();

                    // Check in DB
                    var validatedUser = _dbManager.ValidateUser(user, pass);

                    if (validatedUser != null)
                    {
                        // Login was successful
                        var response = new { type = "LOGIN_SUCCESS", role = validatedUser.Role };
                        webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                    }
                    else
                    {
                        // Login failed
                        var response = new { type = "LOGIN_ERROR" };
                        webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                    }
                }

            }
        }
    }
}