using System;

namespace AudioIntelDesktop.Models
{
    // Represents an audio file uploaded to the system
    public class UploadedFile
    {
        // Unique identifier for the file in the database
        public int Id { get; set; }

        // The original name of the uploaded file (e.g., intercept_alpha.wav)
        public string? FileName { get; set; }

        // The date and time when the file was uploaded
        public string? UploadDate { get; set; }

        // The current processing status of the file (e.g., Completed, Processing)
        public string? Status { get; set; }
    }
}