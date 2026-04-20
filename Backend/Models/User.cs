using System;
using System.Collections.Generic;
using System.Text;

namespace AudioIntel.Models
{
    public class User
    {
        public int Id { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public bool ForceChangePassword { get; set; }

        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string IDNumber { get; set; } = string.Empty;
        public string CreatedAt { get; set; }
    }
}
