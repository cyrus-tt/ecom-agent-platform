import { useState } from "react";
import { groupConversations } from "../hooks/useConversations";

const GROUP_LABELS = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "thisWeek", label: "本周" },
  { key: "earlier", label: "更早" },
];

export default function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  collapsed,
  onToggleCollapsed,
}) {
  const grouped = groupConversations(conversations);

  return (
    <aside className={`chat-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="chat-sidebar-header">
        <button type="button" className="chat-sidebar-toggle" onClick={onToggleCollapsed} aria-label="折叠侧栏">
          {collapsed ? ">" : "<"}
        </button>
        {!collapsed ? (
          <button type="button" className="chat-sidebar-new" onClick={onCreate}>
            + 新对话
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="chat-sidebar-list">
          {conversations.length === 0 ? <div className="chat-sidebar-empty">暂无历史对话。</div> : null}
          {GROUP_LABELS.map(({ key, label }) => {
            const items = grouped[key];
            if (!items || items.length === 0) return null;
            return (
              <div key={key} className="chat-sidebar-group">
                <div className="chat-sidebar-group-label">{label}</div>
                <ul className="chat-sidebar-items">
                  {items.map((conversation) => (
                    <ConversationItem
                      key={conversation.id}
                      conversation={conversation}
                      active={conversation.id === activeId}
                      onSelect={() => onSelect(conversation.id)}
                      onDelete={() => onDelete(conversation.id)}
                      onRename={(title) => onRename(conversation.id, title)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}

function ConversationItem({ conversation, active, onSelect, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  if (editing) {
    return (
      <li className={`chat-sidebar-item${active ? " is-active" : ""}`}>
        <input
          className="chat-sidebar-rename"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim()) onRename(draft.trim());
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              if (draft.trim()) onRename(draft.trim());
              setEditing(false);
            } else if (event.key === "Escape") {
              setDraft(conversation.title);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }

  return (
    <li
      className={`chat-sidebar-item${active ? " is-active" : ""}`}
      onClick={onSelect}
      onDoubleClick={() => {
        setDraft(conversation.title);
        setEditing(true);
      }}
      title={conversation.title}
    >
      <span className="chat-sidebar-item-title">{conversation.title}</span>
      <button
        type="button"
        className="chat-sidebar-item-del"
        onClick={(event) => {
          event.stopPropagation();
          if (window.confirm(`删除对话「${conversation.title}」？`)) onDelete();
        }}
        aria-label="删除对话"
      >
        x
      </button>
    </li>
  );
}
