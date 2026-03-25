import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
  ],
  server: {
    host: true,         // מאפשר גישה מחוץ לקונטיינר (חובה לדוקר)
    port: 5173,         // הפורט המוסכם שלנו
    strictPort: true,   // מבטיח ש-Vite לא ינסה לעבור לפורט אחר אם זה תפוס
    watch: {
      usePolling: true, // מבטיח שהשינויים בקוד יזוהו בתוך מערכת הקבצים של דוקר
    },
  },
})