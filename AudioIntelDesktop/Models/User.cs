using System;
using System.Collections.Generic;
using System.Text;

namespace AudioIntelDesktop.Models
{
    public class User
    {
        public int Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
    }
}
