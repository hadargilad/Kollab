# משתמשים בגרסה של Node שמתאימה לרוב פרויקטי ה-Vite
FROM node:20-alpine

WORKDIR /app

# מעתיקים את קבצי ההגדרות של החבילות
COPY package*.json ./

# מתקינים את כל הספריות (כמו lucide-react, axios וכו')
RUN npm install

# מעתיקים את שאר הקוד של ה-Frontend
COPY . .

# חשיפת הפורט שבו Vite רץ
EXPOSE 5173

# הרצת השרת במצב פיתוח שמאפשר גישה מחוץ לקונטיינר
CMD ["npm", "run", "dev", "--", "--host"]