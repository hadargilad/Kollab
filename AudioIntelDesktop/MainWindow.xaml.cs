using System;
using System.Windows;

namespace AudioIntelDesktop
{
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
            LoadReact();
        }

        async void LoadReact()
        {
            await webView.EnsureCoreWebView2Async();
            webView.Source = new Uri("http://localhost:5173");
        }
    }
}