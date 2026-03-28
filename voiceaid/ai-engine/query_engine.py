import os
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_community.vectorstores import Chroma
from langchain_classic.chains import RetrievalQA
from langchain_core.prompts import PromptTemplate
from dotenv import load_dotenv

load_dotenv("../backend/.env")

CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("LLM_MODEL", "gemma2:2b")
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

PROMPT_EN = """
You are VoiceAid, an assistant created by team aiova to help Indian citizens.
Answer in simple, easy English that anyone can understand.
Keep answers to 3-5 sentences. Mention the scheme name if applicable.
If info is not in context, say: "I do not have this information."

Context:
{context}

Question: {question}

Answer:
"""

PROMPT_HI = """
Tum VoiceAid ho, team aiova dwara banaya gaya ek sahayak jo Bharat ke nagrikon ki madad karta hai.
IMPORTANT: Tum SIRF Hindi mein jawab doge. Koi bhi English word mat likho.
Har jawab saral Hindi mein do jo koi bhi samajh sake.
Jawab 3-5 lines mein do. Yojana ka naam zaroor batao.
Agar jaankari context mein nahi hai, to kaho: "Mujhe yeh jaankari nahi hai."

Context:
{context}

Sawaal: {question}

Jawab:
"""

_qa_chain_en = None
_qa_chain_hi = None


def _is_hindi(text: str) -> bool:
    """Check if text contains significant Devanagari characters."""
    deva = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    return deva / max(len(text), 1) > 0.15


def _get_chain(hindi: bool = False):
    global _qa_chain_en, _qa_chain_hi

    if hindi and _qa_chain_hi:
        return _qa_chain_hi
    if not hindi and _qa_chain_en:
        return _qa_chain_en

    embeddings = OllamaEmbeddings(model=EMBED_MODEL, base_url=OLLAMA_URL)
    vectorstore = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeddings)
    llm = ChatOllama(model=LLM_MODEL, base_url=OLLAMA_URL, temperature=0.3)

    template = PROMPT_HI if hindi else PROMPT_EN
    prompt = PromptTemplate(
        template=template, input_variables=["context", "question"]
    )
    chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=vectorstore.as_retriever(search_kwargs={"k": 4}),
        chain_type_kwargs={"prompt": prompt},
    )

    if hindi:
        _qa_chain_hi = chain
    else:
        _qa_chain_en = chain

    return chain


def get_answer(question: str) -> str:
    hindi = _is_hindi(question)
    return _get_chain(hindi=hindi).invoke({"query": question})["result"]
