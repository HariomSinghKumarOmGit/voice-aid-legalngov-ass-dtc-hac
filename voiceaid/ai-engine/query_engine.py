import os
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_community.vectorstores import Chroma
from langchain_classic.chains import RetrievalQA
from langchain_core.prompts import PromptTemplate
from dotenv import load_dotenv
# hello

load_dotenv("../backend/.env")

CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("LLM_MODEL", "gemma2:2b")
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

PROMPT_TEMPLATE = """
You are VoiceAid, an assistant created by team aiova to help Indian citizens.
Answer in simple language anyone can understand.
If the user writes in Hindi or Devanagari, respond in Hindi.
If English, respond in English.
Keep answers to 3–5 sentences. Mention which scheme your answer is from.

If info is not in context, say: "Mujhe yeh jaankari nahi hai."

Context:
{context}

Question: {question}

Answer:
"""

_qa_chain = None


def _get_chain():
    global _qa_chain
    if _qa_chain:
        return _qa_chain
    embeddings = OllamaEmbeddings(model=EMBED_MODEL, base_url=OLLAMA_URL)
    vectorstore = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeddings)
    llm = ChatOllama(model=LLM_MODEL, base_url=OLLAMA_URL, temperature=0.3)
    prompt = PromptTemplate(
        template=PROMPT_TEMPLATE, input_variables=["context", "question"]
    )
    _qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=vectorstore.as_retriever(search_kwargs={"k": 4}),
        chain_type_kwargs={"prompt": prompt},
    )
    return _qa_chain


def get_answer(question: str) -> str:
    return _get_chain().invoke({"query": question})["result"]
