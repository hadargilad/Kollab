using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AudioIntel.Models
{
    public class SystemStats
    {
        public int TotalUsers { get; set; }
        public int TotalFiles { get; set; }
        public long StorageUsedBytes { get; set; }
        public string Uptime { get; set; }
        public bool DbStatus { get; set; }
    }
}
