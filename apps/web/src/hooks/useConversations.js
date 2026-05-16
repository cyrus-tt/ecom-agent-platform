import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ec-agent.conversations.v1";
const MAX_CONVERSATIONS = 100;
const MAX_TITLE_LEN = 28;

function readStore() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function writeStore(list) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = list.slice(0, MAX_CONVERSATIONS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (_err) {
    // localStorage may be full or blocked. Chat still works in memory.
  }
}

function newId() {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(firstUserContent) {
  const text = String(firstUserContent || "").replace(/\s+/g, " ").trim();
  if (!text) return "新对话";
  return text.length > MAX_TITLE_LEN ? `${text.slice(0, MAX_TITLE_LEN)}...` : text;
}

export default function useConversations() {
  const [conversations, setConversations] = useState(() => readStore());
  const [activeId, setActiveId] = useState(() => {
    const list = readStore();
    return list[0]?.id || null;
  });
  const writeTimer = useRef(null);

  useEffect(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => writeStore(conversations), 150);
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [conversations]);

  const createConversation = useCallback((firstMessage = null) => {
    const id = newId();
    const now = Date.now();
    const conversation = {
      id,
      title: firstMessage ? deriveTitle(firstMessage.content) : "新对话",
      messages: firstMessage ? [firstMessage] : [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  const deleteConversation = useCallback(
    (id) => {
      setConversations((prev) => prev.filter((item) => item.id !== id));
      setActiveId((current) => {
        if (current !== id) return current;
        const remaining = conversations.filter((item) => item.id !== id);
        return remaining[0]?.id || null;
      });
    },
    [conversations]
  );

  const renameConversation = useCallback((id, nextTitle) => {
    setConversations((prev) =>
      prev.map((item) => (item.id === id ? { ...item, title: nextTitle, updatedAt: Date.now() } : item))
    );
  }, []);

  const updateConversation = useCallback((id, updater) => {
    setConversations((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextMessages = updater(item.messages);
        const firstUser = nextMessages.find((message) => message.role === "user");
        const autoTitle = item.title === "新对话" && firstUser ? deriveTitle(firstUser.content) : item.title;
        return { ...item, messages: nextMessages, title: autoTitle, updatedAt: Date.now() };
      })
    );
  }, []);

  const activeConversation = conversations.find((item) => item.id === activeId) || null;

  return {
    conversations,
    activeId,
    activeConversation,
    setActiveId,
    createConversation,
    deleteConversation,
    renameConversation,
    updateConversation,
  };
}

export function groupConversations(list) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = startOfDay - 86400000;
  const weekAgo = startOfDay - 6 * 86400000;
  const buckets = { today: [], yesterday: [], thisWeek: [], earlier: [] };

  for (const conversation of list) {
    const time = conversation.updatedAt || conversation.createdAt || 0;
    if (time >= startOfDay) buckets.today.push(conversation);
    else if (time >= yesterday) buckets.yesterday.push(conversation);
    else if (time >= weekAgo) buckets.thisWeek.push(conversation);
    else buckets.earlier.push(conversation);
  }

  return buckets;
}
