import os, sys
from pathlib import Path
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
from langchain_community.vectorstores import Chroma
from dotenv import load_dotenv

load_dotenv("../backend/.env")

CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
EMBED_MODEL  = os.getenv("EMBED_MODEL", "nomic-embed-text")
OLLAMA_URL   = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

def ingest_pdfs(pdf_folder="../data"):
    all_docs = []
    for file in Path(pdf_folder).glob("*.pdf"):
        try:
            loader = PyPDFLoader(str(file))
            docs = loader.load()
            for doc in docs:
                doc.metadata["source_scheme"] = file.stem
            all_docs.extend(docs)
            print(f"✅ Loaded: {file.name} ({len(docs)} pages)")
        except Exception as e:
            print(f"❌ Failed: {file.name} — {e}")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500, chunk_overlap=50,
        separators=["\n\n", "\n", "। ", ". ", " ", ""]
    )
    chunks = splitter.split_documents(all_docs)
    print(f"\n📦 Total chunks: {len(chunks)}")

    embeddings = OllamaEmbeddings(model=EMBED_MODEL, base_url=OLLAMA_URL)
    Chroma.from_documents(chunks, embeddings, persist_directory=CHROMA_PATH)
    print(f"✅ Stored to {CHROMA_PATH}")

if __name__ == "__main__":
    ingest_pdfs()
