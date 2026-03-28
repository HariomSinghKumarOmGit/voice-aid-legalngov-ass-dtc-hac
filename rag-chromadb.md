# RAG Pipeline + ChromaDB Reference

## How the RAG Pipeline Works

```
PDF files
   │
   ▼ PyPDFLoader
Raw text per page
   │
   ▼ RecursiveCharacterTextSplitter (500 chars, 50 overlap)
Chunks
   │
   ▼ OllamaEmbeddings (nomic-embed-text)
Vectors
   │
   ▼ ChromaDB (persisted to ./chroma_db/)
On-disk vector store
   │
   ▼ At query time: similarity search (k=4 chunks)
Retrieved context → LLM
```

## Adding / Re-ingesting PDFs

```bash
# 1. Drop new PDFs into voiceaid/data/
# 2. Re-run ingestion (it overwrites existing chroma_db)
cd voiceaid/ai-engine
source ../backend/venv/bin/activate
python ingest.py

# Expected output:
# ✅ Loaded: pm_kisan.pdf (12 pages)
# ✅ Loaded: mgnrega.pdf (8 pages)
# 📦 Total chunks: 347
# ✅ Stored 347 chunks to ./chroma_db
```

**Note:** Re-ingesting always rebuilds from scratch — safe to run multiple times.

## Chunk Tuning

Default: `chunk_size=500, chunk_overlap=50`

```python
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,       # chars per chunk
    chunk_overlap=50,     # overlap between chunks
    separators=["\n\n", "\n", "। ", ". ", " ", ""]
    # ^^^ "। " is the Hindi full stop — important for Devanagari PDFs
)
```

**When to change:**
- Short, dense PDFs (legal text) → `chunk_size=300, chunk_overlap=80`
- Long narrative PDFs → `chunk_size=800, chunk_overlap=100`
- Bad retrieval (answers miss obvious info) → reduce chunk size
- Answers feel incomplete / cut off → increase chunk size

## Retrieval Tuning

```python
retriever=vectorstore.as_retriever(
    search_kwargs={"k": 4}   # Number of chunks to retrieve
)
```

**When to change k:**
- `k=2` → Faster, less context, more focused
- `k=4` → Default, good balance
- `k=6` → More context, slower, risk of noise
- `k=8` → Only for complex multi-part questions

## Inspecting ChromaDB

```python
import chromadb

client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_collection("langchain")

print(f"Total chunks: {collection.count()}")

# Preview first 5 chunks
results = collection.peek(5)
for doc in results["documents"]:
    print(doc[:200])
    print("---")
```

Run this to verify ingestion worked before debugging the API.

## Common Issues

**Problem: `chroma_db` folder is missing / empty**
```bash
ls -la voiceaid/ai-engine/chroma_db/
# If missing, re-run: python ingest.py
```

**Problem: Query returns wrong / irrelevant answers**
1. Check chunk count (should be >50 for meaningful retrieval)
2. Try a more specific query
3. Reduce `k` to 2 and check if top result is relevant
4. PDF may be scanned (image-based) — OCR needed:
```bash
pip install pytesseract pillow pdf2image
# Use OCR loader instead of PyPDFLoader for scanned PDFs
```

**Problem: Hindi PDFs not chunked correctly**
→ Ensure `"। "` is in `separators` list (it's the Hindi sentence ender)
→ If PDF is Devanagari-heavy, try `chunk_size=300`

**Problem: Ingestion very slow**
→ Normal: ~2–3 min per 100 pages
→ `nomic-embed-text` runs via Ollama — make sure `ollama serve` is running
→ Check: `curl http://localhost:11434/api/tags`

**Problem: `collection not found` error at query time**
→ `CHROMA_DB_PATH` in `.env` doesn't match where you ran ingestion
→ Fix: use absolute paths or always run from `ai-engine/` directory

## PDF Sources for Indian Government Schemes

| Scheme | Source URL |
|---|---|
| PM Kisan | pmkisan.gov.in/Documents |
| MGNREGA | nrega.nic.in |
| RTI Act 2005 | cic.gov.in/RTI-Act |
| Ayushman Bharat | pmjay.gov.in |
| Jan Dhan Yojana | pmjdy.gov.in |
| Any scheme | india.gov.in/spotlight |

## Metadata Filtering (Advanced)

Tag chunks by source document for better attribution:

```python
# In ingest.py — add source metadata
for file in Path(pdf_folder).glob("*.pdf"):
    loader = PyPDFLoader(str(file))
    docs = loader.load()
    for doc in docs:
        doc.metadata["source_scheme"] = file.stem  # e.g. "pm_kisan"
    all_docs.extend(docs)

# Then filter at query time:
retriever = vectorstore.as_retriever(
    search_kwargs={
        "k": 4,
        "filter": {"source_scheme": "pm_kisan"}  # only search one scheme
    }
)
```
