namespace AudioIntelDesktop.Models
{
    public class Relationship
    {
        public int Id { get; set; }
        public int Speaker1Id { get; set; }
        public int Speaker2Id { get; set; }
        public string RelationshipType { get; set; } = "Direct";
        public int InteractionCount { get; set; }
        public double Strength { get; set; }
        public string Notes { get; set; } = string.Empty;
    }
}