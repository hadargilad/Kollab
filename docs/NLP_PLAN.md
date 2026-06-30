# תכנית הרחבת NLP — Kollab
## מסמך עבודה צוותי: אופק, הדר, אופיר

> מסמך זה הוא ה-spec המשותף לשלושתכן. נועד לשיתוף ולעבודה במקביל. שלוש מטלות עצמאיות, אבל מתחברות ל-pipeline אחד.

---

## הקשר (Context)

הפרויקט הוא מערכת מודיעין קולית — מקבלת שיחות טלפון, מזהה דוברים, בונה גרף קשרים. כיום ה-pipeline מתמלל את השיחה (Whisper) ושומר את הטקסט ב-`Segments.Text`, אבל **הטקסט הזה כמעט לא מנוצל** — רק substring match למילים מסוכנות.

**המטרה:** להפוך את שכבת ה-NLP מ"חיפוש מילה" ל"הבנת תוכן" עם **עומק אלגוריתמי**. שלוש יכולות שמשלימות זו את זו:

| חברה | פיצ'ר | אלגוריתמים מרכזיים |
|---|---|---|
| **אופק** | NER + Ghost Nodes + Entity Resolution | NER (BERT), Double Metaphone, Jaro-Winkler, embedding-context tiebreaker |
| **הדר** | חיפוש סמנטי Hybrid | BM25, Dense Retrieval (sentence-transformers), RRF, Cross-Encoder, MMR |
| **אופיר** | זיהוי שפה מקודדת / Euphemisms | Topic incoherence, TF-IDF + PMI, Language model perplexity, contextual seed expansion |

שפת היעד: רוב אנגלית. שלוש המטלות מתחברות ב-`_run_ml_and_save()` ב-[Backend/api.py](../Backend/api.py) — כל שיחה חדשה תעבור את שלושת ה-pipelines אוטומטית.

> **חלוקה מוצעת** — אם תרצו להחליף בין אופק לאופיר או הדר, התשתית זהה. המטלות עצמאיות.

---

## עקרונות תכנון משותפים

| שכבה | מה מתווסף | למה |
|---|---|---|
| **ML** ([ml/](../ml/)) | **לא משתנה.** | ML נשאר אחראי על עיבוד אקוסטי בלבד. |
| **Backend** ([Backend/](../Backend/)) | מודולים חדשים תחת [Backend/nlp/](../Backend/nlp/), אחד לכל אחת. הרחבת [Backend/api.py](../Backend/api.py). 3 טבלאות חדשות + עמודות נוספות. | NLP על טקסט שכבר ב-DB — שייך טבעית ל-Backend. |
| **Frontend** ([audio-intel-ui/src/](../audio-intel-ui/src/)) | עמוד `/entities`, חיפוש גלובלי, עדכוני NetworkGraph ו-Transcript. כל אחת אחראית על ה-UI של הפיצ'ר שלה. | חלוקה ברורה — לא דורסות זו את זו. |

---

# 🛠 Phase 0 — Infrastructure משותפת (~3 ימים, שלושתכן יחד)

לפני שכל אחת הולכת לפיצ'ר שלה, שלושתכן עובדות **יחד** על תשתית מינימלית.

### 0.1 מבנה תיקיות

נוצרים יחד:
```
Backend/nlp/
├── __init__.py
├── models.py                # singleton loader (NER, embed, cross-enc, LM)
├── ner.py                   # אופק
├── entity_resolution.py     # אופק
├── semantic_search.py       # הדר
├── reranker.py              # הדר
├── coded_language.py        # אופיר
└── euphemism_expansion.py   # אופיר
```

### 0.2 [Backend/nlp/models.py](../Backend/nlp/models.py) — singleton loader משותף

קובץ ששלושתכן עוזרות לכתוב יחד. טוען מודלים פעם אחת:

```python
_ner_model = None
_embed_model = None
_cross_encoder = None
_lm_model = None  # distilgpt2 לחישוב perplexity

def get_ner_model(): ...
def get_embed_model(): ...
def get_cross_encoder(): ...
def get_lm_model(): ...
```

מאפשר לכל שלוש להשתמש באותם מודלים בלי טעינה כפולה.

### 0.3 הוספת requirements

לעדכן יחד את [Backend/requirements.txt](../Backend/requirements.txt):
- `transformers` (NER + LM)
- `sentence-transformers` (embeddings)
- `faiss-cpu` (vector index)
- `rank_bm25` (BM25)
- `phonetics` (Double Metaphone)
- `jellyfish` (Jaro-Winkler)
- `scikit-learn` (TF-IDF, PMI)
- `anthropic` (אופציונלי — אופיר ל-LLM verification)

### 0.4 Schema migration אחיד

לכתוב יחד migration script ב-[Backend/database.py](../Backend/database.py):

```sql
-- שלוש הטבלאות החדשות
CREATE TABLE Entities (...)         -- אופק
CREATE TABLE EntityMentions (...)   -- אופק

-- עמודות חדשות
ALTER TABLE Segments ADD COLUMN Embedding BLOB NULL;            -- הדר + אופיר
ALTER TABLE Speakers ADD COLUMN IsGhost INTEGER DEFAULT 0;      -- אופק
ALTER TABLE Speakers ADD COLUMN PromotedFromEntityId INTEGER NULL;  -- אופק
ALTER TABLE Alerts ADD COLUMN SubScores TEXT NULL;              -- אופיר
ALTER TABLE Alerts ADD COLUMN SegmentId INTEGER NULL;           -- אופיר
ALTER TABLE Alerts ADD COLUMN LlmExplanation TEXT NULL;         -- אופיר
ALTER TABLE DangerousWords ADD COLUMN IsEuphemism INTEGER DEFAULT 0;  -- אופיר
ALTER TABLE DangerousWords ADD COLUMN AutoLearned INTEGER DEFAULT 0;  -- אופיר
ALTER TABLE DangerousWords ADD COLUMN Confidence REAL NULL;          -- אופיר
```

(פירוט מלא של הטבלאות בתת-סעיפים של כל אחת.)

### 0.5 Integration point ב-`_run_ml_and_save`

לכתוב יחד את הסדר ב-[Backend/api.py](../Backend/api.py):

```python
def _run_ml_and_save(audio_id, file_path):
    # ... existing ML call + segment save ...
    
    # NLP pipeline — הסדר חשוב!
    embed_segments(audio_id)                # הדר: חייב להיות ראשון
    extract_and_resolve_entities(audio_id)  # אופק: NER + resolution
    score_coded_language(audio_id)          # אופיר: צריכה embeddings + entities
    scan_for_dangerous_words(audio_id)      # קיים — נשאר
```

הפונקציות `embed_segments`, `extract_and_resolve_entities`, `score_coded_language` הן ה-API שכל אחת מספקת. בהתחלה כל אחת תכתוב stub שלא קורס — ככה אפשר להתחיל לעבוד מיד.

### 0.6 Phase 0 deliverable

עד סוף Phase 0:
- ✅ `Backend/nlp/` קיים עם stubs לכל הפונקציות.
- ✅ DB schema מעודכן (migration ירוץ ב-startup).
- ✅ `_run_ml_and_save` קורא לארבעת ה-stages בסדר נכון.
- ✅ כל אחת יכולה להתחיל לעבוד בעצמאות מלאה.

---

# 👤 אופק — NER + Ghost Nodes + Entity Resolution

**המטרה:** לדעת מי *מוזכר* בכל שיחה, לקשר חזרה לדוברים ידועים (alias resolution), וליצור "Ghost nodes" בגרף לאנשים שמדברים עליהם אבל אף פעם לא דיברו בעצמם.

### 1.1 חילוץ ישויות

**מודל:** `dslim/bert-base-NER` — מזהה PERSON, ORGANIZATION, LOCATION, MISCELLANEOUS.

טעון via singleton ב-[Backend/nlp/models.py](../Backend/nlp/models.py). מופעל על כל segment ב-`_run_ml_and_save` ע"י [Backend/nlp/ner.py](../Backend/nlp/ner.py).

**Post-processing ע"י regex:**
- `PHONE` — `(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}`
- `EMAIL` — בסיסי
- `MONEY` — `\$\d+(,\d{3})*(\.\d+)?` + מילות מפתח (`dollars?`, `bucks`, `K`, `M`)
- `DATE` — אופציונלי, `dateparser` library

**Normalization:** lowercasing, ניקוי דקדוקי (`'s`, `the `, ` Jr.`), כיווץ multi-token names.

### 1.2 Entity Resolution Algorithm — הלב של הפיצ'ר

ארבעה שלבי מסנן, מהחזק לחלש:

| שלב | אלגוריתם | סף |
|---|---|---|
| **A. Exact match** | מילה במילה אחרי normalization | identity |
| **B. Phonetic** | Double Metaphone (Lawrence Philips 2000) — מקודד שמות לפי איך הם נשמעים. תופס "Sara"≡"Sarah", "Geoff"≡"Jeff", "Steven"≡"Stephen". | Code match |
| **C. String similarity** | Jaro-Winkler — מותאם במיוחד לשמות. נותן בונוס לcommon prefix. | ≥ 0.92 |
| **D. Embedding context** | אם יש >1 מועמד אחרי A-C: השוואה של מי דיבר עם הישות הזו vs מי דיבר עם המועמד. cosine על embeddings מ-`Segments.Embedding`. | break tie |

**Math note for D:** לכל speaker בונים "context vector" = ממוצע embeddings של כל ה-segments שלו. לכל mention של ישות, ממוצעים embeddings של 5 ה-segments הסמוכים. אז המועמד הקרוב ביותר ב-cosine מנצח.

⚠️ **תלות:** Step D דורש `Segments.Embedding` שהדר בונה. עד שזה מוכן — נשתמש רק ב-A-C (זה כבר עובד מצוין).

### 1.3 Ghost Speaker Promotion

ישות PERSON שאף resolution לא קישרה — נשארת כ-"ghost".

**אלגוריתם promotion ל-`Speakers` עם דגל `IsGhost=1`:**
- ישות שמוזכרה ב-≥3 שיחות *שונות* OR ע"י ≥2 דוברים שונים.
- מקבלת `RiskLevel='low'` כברירת מחדל.
- יש לה כל הפיצ'רים של speaker רגיל (relations, mentions) חוץ מ-embeddings קוליים.

**יצירת קשרים ל-Ghosts:**
- כל פעם ש-speaker S מזכיר ישות E בשיחה A → upsert ב-`Relations` עם `Topic='mentioned'`.
- distinguishing from co-occurrence (`Topic='audio'` או null): שתי טופולוגיות שונות באותו גרף, עם תצוגה שונה ב-UI.

### 1.4 קבצים בבעלות אופק

- חדש: [Backend/nlp/ner.py](../Backend/nlp/ner.py) — `extract_entities(segment_text)`, normalize.
- חדש: [Backend/nlp/entity_resolution.py](../Backend/nlp/entity_resolution.py) — 4-stage resolution, ghost promotion, `extract_and_resolve_entities(audio_id)`.
- בעלות חלקית: [Backend/database.py](../Backend/database.py) — CRUD ל-`Entities` ו-`EntityMentions`.
- בעלות חלקית: [Backend/api.py](../Backend/api.py) — אנדפוינטים: `GET /entities`, `GET /entities/{id}`, `GET /entities/{id}/mentions`, `GET /entities/{id}/related-speakers`, `POST /entities/{id}/link-wikidata`.
- חדש: [audio-intel-ui/src/pages/Entities.tsx](../audio-intel-ui/src/pages/Entities.tsx).
- שינוי: [audio-intel-ui/src/components/NetworkGraph.tsx](../audio-intel-ui/src/components/NetworkGraph.tsx) — Toggle "Include Ghost speakers", צורה משולשת ל-Ghost, edges מקווקווים ל-`Topic='mentioned'`.
- שינוי: [audio-intel-ui/src/pages/Transcript.tsx](../audio-intel-ui/src/pages/Transcript.tsx) — highlight כל mention עם tooltip.

### 1.5 סכמה (אופק)

```sql
Entities
  Id INTEGER PK
  Type TEXT                  -- PERSON / ORG / LOC / PHONE / EMAIL / MONEY / DATE
  RawText TEXT               -- כפי שהופיע
  NormalizedText TEXT        -- אחרי נורמליזציה (collation key)
  PhoneticKey TEXT NULL      -- Double Metaphone, PERSON בלבד
  WikidataId TEXT NULL
  GhostSpeakerId INTEGER NULL FK→Speakers(Id) SET NULL  -- אם קודמה
  MentionCount INTEGER
  DistinctSpeakerCount INTEGER
  DistinctAudioCount INTEGER
  FirstSeen DATETIME
  LastSeen DATETIME

EntityMentions
  Id INTEGER PK
  EntityId INTEGER FK→Entities CASCADE
  SegmentId INTEGER FK→Segments CASCADE
  Offset INTEGER             -- char offset בתוך segment text
  Length INTEGER
  Confidence REAL
  ResolvedSpeakerId INTEGER NULL FK→Speakers SET NULL
  ResolutionMethod TEXT NULL  -- 'exact'|'phonetic'|'jaro'|'embedding'|'none'
```

### 1.6 Verification של אופק

- **Unit tests ב-[Backend/tests/test_ner.py](../Backend/tests/test_ner.py):**
  - segment ידוע ("I met John Smith at Google yesterday") → expect 1 PERSON + 1 ORG.
  - "Sarah" וגם "Sara" באותו corpus → expect Double Metaphone כזיהוי כאותה ישות.
- **Manual test:** העלאת `samples/eldad 1.m4a` + `samples/eldad 2.m4a`. אם "eldad" מוזכר באחת — לוודא שמופיע ב-`/entities`.
- **Promotion test:** ישות שמוזכרת ב-3 שיחות → לוודא שמתקדמת ל-Ghost speaker ושמופיעה ב-NetworkGraph.

---

# 👤 הדר — חיפוש סמנטי חוצה-שיחות (Hybrid Retrieval)

**המטרה:** להחליף את ה-substring search הנוכחי ב-pipeline retrieval מתקדם. בנוסף — הפיצ'ר הזה מספק את `Segments.Embedding` שאופק ואופיר צריכות.

### 2.1 ארכיטקטורת Hybrid Retrieval

```
Query → BM25 + Dense → RRF fusion → Cross-encoder re-ranking → MMR diversification → top-K
```

**הסיבה ל-hybrid:** dense embeddings חזקים בסמנטיקה ("דברו על כסף" מוצא "מיליון דולר"), אבל חלשים ב-exact match (שמות, מספרים, מילות מפתח נדירות). BM25 משלים את זה.

### 2.2 שלב 1 — Embed Pipeline (משרת גם את אופק ואופיר)

**מודל:** `BAAI/bge-small-en-v1.5` (384-dim, אנגלית, ~33M params, מהיר).

`embed_segments(audio_id)` ב-[Backend/nlp/semantic_search.py](../Backend/nlp/semantic_search.py):
1. שולפת את כל ה-segments של ה-audio.
2. batches של 32, encode → 384-float32 vectors.
3. שומרת ב-`Segments.Embedding` כ-`.tobytes()` BLOB.

**רצה ראשונה ב-`_run_ml_and_save` — לפני NER ולפני coded language** (אופק ואופיר תלויות בזה).

### 2.3 BM25 (Lexical Retrieval)

נוסחה:
```
BM25(q, d) = Σ_{t ∈ q} IDF(t) · (f(t,d) · (k₁+1)) / (f(t,d) + k₁ · (1 - b + b · |d|/avgdl))
```
פרמטרים סטנדרטיים `k₁=1.5`, `b=0.75`.

**יישום:** ספריית `rank_bm25` — מבנה אינדקס בזיכרון. נטען מ-`Segments.Text` ב-startup, שמירה ל-pickle על disk. **Re-build trigger:** כל 100 segments חדשים.

### 2.4 Dense Retrieval (FAISS)

**אינדקס:** `faiss-cpu`, `IndexFlatIP` (exact, O(N) per query — עד 100K segments מהיר מאוד).

**בנייה lazy:** singleton בזיכרון Backend, נטען מ-DB ב-startup מ-`Segments.Embedding`. מתעדכן incremental כשמוסיפים segments חדשים.

**Query:** embed שאילתה → top-200 cosine similarity.

### 2.5 Fusion ע"י RRF (Reciprocal Rank Fusion)

נוסחה (Cormack et al. 2009):
```
RRF(d) = Σ_{r ∈ rankers} 1 / (k + rank_r(d))
```
עם `k=60` סטנדרטי. יתרון מול weighted sum: לא דורש כיול scores (BM25 ו-cosine בסקלות שונות).

מקבלים top-200 מ-BM25 + top-200 מ-dense → RRF score לכל d → top-100 משולב.

### 2.6 Cross-Encoder Re-ranking

על top-100 ה-fused: cross-encoder (`cross-encoder/ms-marco-MiniLM-L-6-v2`) מקבל `(query, segment_text)` כקלט יחד, מוציא relevance score. *הרבה* יותר מדויק מ-dense alone, אבל אטי — לכן רק על top-100.

**output:** top-30 ממוין מחדש.

### 2.7 MMR (Maximal Marginal Relevance) — גיוון

**אלגוריתם** (Carbonell & Goldstein 1998):
```
MMR(d) = argmax_d [ λ · sim(d, q) − (1−λ) · max_{d' ∈ Selected} sim(d, d') ]
```
איטרטיבית בוחרים את ה-d המקסם — K פעמים. עם `λ=0.7`. הסיבה: top-K מ-cross-encoder עלולים להיות 10 segments זהים בתכלית.

**output:** final top-20.

### 2.8 Filters

ה-API יקבל פרמטרים אופציונליים:
- `speaker_id=X` — חיפוש רק במה שדובר X אמר.
- `entity_id=Y` — חיפוש רק ב-segments שמזכירים ישות Y (תלוי באופק).
- `from_date`, `to_date` — חלון זמן.
- `enable_rerank=true|false`, `enable_mmr=true|false` — toggles להשוואות אקדמיות.

### 2.9 קבצים בבעלות הדר

- חדש: [Backend/nlp/semantic_search.py](../Backend/nlp/semantic_search.py) — `embed_segments`, FAISS index, BM25 index, RRF, MMR.
- חדש: [Backend/nlp/reranker.py](../Backend/nlp/reranker.py) — cross-encoder singleton + scoring.
- בעלות חלקית: [Backend/database.py](../Backend/database.py) — store/load embeddings BLOB, batch query.
- בעלות חלקית: [Backend/api.py](../Backend/api.py) — אנדפוינטים: `GET /search/semantic?q=...&top=20`, `POST /search/reindex`.
- חדש: [audio-intel-ui/src/pages/Search.tsx](../audio-intel-ui/src/pages/Search.tsx) — תוצאות חיפוש עם snippets, speaker name + audio link + timestamp.
- שינוי: [audio-intel-ui/src/components/Layout/Header.tsx](../audio-intel-ui/src/components/Layout/Header.tsx) — חיפוש גלובלי בכותרת.

### 2.10 Verification של הדר

- **Sanity:** query "weather" צריך להחזיר segments על מזג אוויר גם אם המילה לא מופיעה.
- **Comparison test:** הריצי אותה query עם `enable_rerank=false` ו-`true` — האיכות צריכה לעלות חזותית (שמרי בעבודה הכתובה!).
- **MMR test:** query "money" עם 10 segments דומים מאוד צריך להחזיר רק 2-3.
- **Recall test:** העלי 5 שיחות → query עם synonym שלא מופיע מילולית → לוודא שמוצא.
- **Speed benchmark:** time per query ב-100, 1000, 5000 segments — לתעד בעבודה הכתובה.

---

# 👤 אופיר — זיהוי שפה מקודדת / Euphemisms

**המטרה:** לזהות שיחות שמשתמשות בשפה מקודדת — מילים תמימות כשלעצמן ש"מסתירות" משמעות אחרת. הגישה: **multi-signal anomaly scoring** — שילוב של 4 ציונים שכל אחד תופס תופעה שונה.

⚠️ **תלות:** עובדת על segments שכבר עברו embedding (הדר) ויש עליהם entities (אופק). יש לתאם תאריך התחלה.

### 3.1 Signal A — Topic Incoherence

**רעיון:** אם השיחה היא על "weekend plans" וכל פתאום segment מדבר על "the package", זה outlier.

**אלגוריתם:**
1. לכל שיחה — ממוצע משוקלל של embeddings (משקל = duration): `c = Σ wᵢ · eᵢ / Σ wᵢ`.
2. לכל segment: `incoherence(s) = 1 − cos(eₛ, c)`.
3. **דרישה נוספת:** הסביבה לא מסבירה. `local_context` = ממוצע של 4 segments סמוכים (2 לפני, 2 אחרי). `local_incoherence = 1 − cos(eₛ, local_context)`.
4. **Score A** = `0.5 · incoherence(s) + 0.5 · local_incoherence(s)`.

### 3.2 Signal B — Lexical Anomaly (TF-IDF + PMI)

**רעיון:** "tomatoes" באמצע שיחה על business meeting זה לקסיקלית חריג.

**אלגוריתם:**
1. בניית מטריצת TF-IDF גלובלית מכל ה-`Segments.Text`.
2. לכל segment: ממוצע `idf(word)` של ה-content words (לא stopwords). גבוה ⇒ מילים נדירות מהרגיל.
3. **PMI (Pointwise Mutual Information):**
   ```
   PMI(w, topic) = log [ P(w | topic) / P(w) ]
   ```
4. **Score B** = combination של (average IDF) ו-(min PMI אצל המילים הלא-stopword).

### 3.3 Signal C — Language Model Perplexity

**רעיון:** "did you water the plants" ב-context לא חקלאי = perplexity גבוהה.

**אלגוריתם:**
1. `distilgpt2` (82M params, מהיר).
2. לכל segment: `perplexity = exp(-1/N · Σ log P(wᵢ | w<ᵢ))`.
3. אקסטרא: יחס perplexity ה-segment ל-perplexity הממוצע של הדובר ⇒ מתעלם מסטייל הדיבור הטבעי.
4. **Score C** = z-score של perplexity ה-segment vs ה-corpus, נחתך ב-3σ.

### 3.4 Signal D — Euphemism Dictionary (Bootstrap Expansion)

**רעיון:** רשימת זרעים של ביטויים מקודדים ידועים → הרחבה אלגוריתמית.

**אלגוריתם:**
1. **Seed list** (~50 ביטויים): [Backend/nlp/seed_euphemisms.json](../Backend/nlp/seed_euphemisms.json) עם דוגמאות: "candy", "the goods", "make a delivery", "the package", "white horse", "weed".
2. **Expansion ע"י contextual similarity:**
   - לכל seed phrase, אסיפת contexts שבהן הוא מופיע ב-corpus.
   - embed את ה-contexts ע"י המודל המשותף.
   - חיפוש phrases אחרים שמופיעים ב-similar contexts (cosine ≥ 0.8).
   - **קבלה אם:** ה-frequency ב-domain calls גבוהה משמעותית מה-non-domain calls (`PMI ≥ 2`).
3. תוצאה: dictionary מתרחב — flag `AutoLearned=1` עם `Confidence`.
4. **Score D** = max similarity לכל euphemism במילון, normalized.

### 3.5 Combined Score & Threshold

```
SuspicionScore(s) = w_A · A(s) + w_B · B(s) + w_C · C(s) + w_D · D(s)
```

משקלות התחלתיים: `w_A = 0.30, w_B = 0.20, w_C = 0.25, w_D = 0.25`. סף: `SuspicionScore > 0.65` → Alert חדש מסוג `"coded_language"`.

### 3.6 LLM Verification (אופציונלי, מומלץ אם יש זמן)

על segment שהציון שלו > 0.65: שליחה ל-Claude Haiku API עם 3-5 examples (few-shot): "האם המשפט הזה משתמש בשפה מקודדת? תני ציון 0-1 והסבר".

**יתרון:** הפחתה דרמטית ב-false positives + הסבר מילולי. **עלות:** ~$0.001 per call.

### 3.7 קבצים בבעלות אופיר

- חדש: [Backend/nlp/coded_language.py](../Backend/nlp/coded_language.py) — 4 ה-scoring functions, ה-aggregator, optional LLM check, `score_coded_language(audio_id)`.
- חדש: [Backend/nlp/euphemism_expansion.py](../Backend/nlp/euphemism_expansion.py) — bootstrap מ-seed list, expansion algorithm.
- חדש: [Backend/nlp/seed_euphemisms.json](../Backend/nlp/seed_euphemisms.json) — רשימת זרעים יד-מומחה.
- בעלות חלקית: [Backend/database.py](../Backend/database.py) — שדות חדשים ב-`Alerts` ו-`DangerousWords`.
- בעלות חלקית: [Backend/api.py](../Backend/api.py) — אנדפוינטים: `GET /alerts/coded-language`, `POST /euphemisms/expand`, `GET /euphemisms`, `POST /euphemisms` (manual add).
- שינוי: [audio-intel-ui/src/pages/Transcript.tsx](../audio-intel-ui/src/pages/Transcript.tsx) — רקע אדום-כתום ל-segment חשוד + tooltip עם 4 sub-scores.
- שינוי (או חדש): [audio-intel-ui/src/pages/Alerts.tsx](../audio-intel-ui/src/pages/Alerts.tsx) — סינון לפי type "coded_language", stacked bar של sub-scores, LLM explanation.
- חדש: [audio-intel-ui/src/pages/EuphemismDictionary.tsx](../audio-intel-ui/src/pages/EuphemismDictionary.tsx) — ניהול seed + auto-learned dictionary.

### 3.8 Verification של אופיר

- **Synthetic positive:** segment "let's grab some candy tonight" בתוך שיחה על "office meeting" → expect score > 0.65.
- **Synthetic negative:** segment "lovely weather today" באמצע שיחה על weekend → expect score < 0.3.
- **Sub-score sanity:** מקרה שבו Signal A מתפעל אבל B,C,D שקטים → expect medium score, ולא alert. מקרה כל ה-4 מאש → high.
- **Expansion test:** seed list עם "candy" → expansion algorithm → לוודא שגם "the goods" או דברים סמנטית קרובים מתווספים.

---

# 🗓 לוח זמנים מומלץ — 7 שבועות

| שבוע | אופק | הדר | אופיר |
|---|---|---|---|
| **1 — Phase 0** | יחד: יצירת `Backend/nlp/`, schema, stubs | יחד | יחד |
| **2** | NER extraction + normalization | `embed_segments` + FAISS index | seed list + Signal A (תלוי באמבדינגים מהדר) |
| **3** | Entity Resolution (A→B→C) | BM25 + RRF fusion | Signals B (TF-IDF/PMI) + C (perplexity) |
| **4** | Ghost promotion + Relations linking | Cross-encoder + MMR | Signal D + bootstrap expansion |
| **5** | UI: Entities + NetworkGraph + Transcript | UI: search bar + Search.tsx | UI: Transcript overlay + Alerts + EuphemismDictionary |
| **6** | אינטגרציה + Step D של resolution (תלוי בהדר) + bug fixes | toggle לרענון אינדקס + benchmarks | LLM verification (אם יש זמן) + bug fixes |
| **7** | **כולן יחד** — end-to-end על `samples/`, תיעוד API, כתיבת עבודה כתובה | | |

---

# 🧪 End-to-end test (שלושתכן יחד, שבוע 7)

1. העלאת 5-10 שיחות חדשות מ-`samples/` דרך ה-UI.
2. לוודא ש-`_run_ml_and_save` הסתיים successfully (status="processed").
3. **בדיקות DB:**
   - `Entities` נוצרו (אופק).
   - `EntityMentions` קישרו דוברים שונים לאותה ישות (אופק).
   - `Segments.Embedding` מלא לכל ה-segments (הדר).
   - לפחות 1-2 alerts מסוג `"coded_language"` (אופיר).
4. **בדיקות UI:**
   - עמוד `/entities` עם תוכן (אופק).
   - חיפוש סמנטי בכותרת עם תוצאות סבירות (הדר).
   - Transcript מציג entities highlighted (אופק) + suspicious segments (אופיר).
   - NetworkGraph כולל Ghost speakers (אופק).
5. **תיעוד באקדמיה:** סקיצה של ה-pipeline המלא, השוואות איכות (rerank vs no-rerank), דוגמאות לכל אחד מ-4 sub-scores של coded language.

---

# 📦 סיכום קומפקטי

- **Phase 0 משותף** (~3 ימים): `Backend/nlp/`, schema, stubs, models singleton.
- **3 מטלות עצמאיות**, ~6 שבועות פיתוח + שבוע אינטגרציה.
- **תלויות:** הדר (embeddings) → אופק (Step D resolution) + אופיר (Signal A); אבל כל אחת יכולה להתחיל מיד עם stub.
- **~12 אלגוריתמים** לעבודה הכתובה: BERT NER, Double Metaphone, Jaro-Winkler, embedding context, BM25, RRF, Cross-encoder, MMR, TF-IDF, PMI, LM perplexity, contextual seed expansion.
- **~10 קבצי Python חדשים, 3 טבלאות + 9 עמודות חדשות, 4 עמודי UI חדשים, ~10 endpoints חדשים.**

---

# מה לא בתכנית הזו (בכוונה)

- **Topic Modeling (BERTopic)** — נדחה לפי בחירתכן.
- **שינוי ל-ML pipeline** — כל ה-NLP נשאר ב-Backend.
- **שינוי קוד הזיהוי הקולי** ([Backend/matcher.py](../Backend/matcher.py), [ml/pipeline.py](../ml/pipeline.py)) — לא נוגעים.
- **מודלים עבריים יעודיים** — לפי בחירתכן (רוב אנגלית). swap-in נתמך בעתיד.
