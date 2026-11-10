import SwiftUI

struct MessageRow: View {
    @Environment(AppState.self) private var state
    let message: Message
    let continued: Bool
    let isMine: Bool
    let myId: String?
    let onBoost: (String) -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if continued {
                Color.clear.frame(width: 36, height: 1)
            } else {
                Avatar(userId: message.creator.id, name: message.creator.name, size: 36)
            }
            VStack(alignment: .leading, spacing: 3) {
                if !continued {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(message.creator.name).fontWeight(.semibold)
                        if state.people[message.creator.id]?.agent == true {
                            Text("Agent").font(.caption2.bold()).padding(.horizontal, 4)
                                .background(Capsule().fill(Color.secondary.opacity(0.2)))
                        }
                        Text(message.createdDate, format: .dateTime.hour().minute())
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let parentText = message.parentText, message.parentId != nil {
                    Label(parentText.isEmpty ? "Replied in a thread" : parentText, systemImage: "arrowshape.turn.up.left")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                content
                if !message.boosts.isEmpty { boosts }
                if let thread = message.thread {
                    Text("\(thread.count) \(thread.count == 1 ? "reply" : "replies")")
                        .font(.caption.bold()).foregroundStyle(.tint)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, continued ? 2 : 10)
        .padding(.bottom, 2)
        .background(hovering ? Color.secondary.opacity(0.06) : .clear)
        .overlay(alignment: .topTrailing) { if hovering && message.deleted != true { actions } }
        .onHover { hovering = $0 }
        .contextMenu { menu }
    }

    @ViewBuilder
    private var content: some View {
        if message.deleted == true {
            Text("This message was deleted.").italic().foregroundStyle(.secondary)
        } else if let file = message.attachment {
            Attachment(file: file)
        } else {
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(LocalizedStringKey(markdownSafe(message.plainText)))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if message.editedAt != nil {
                    Text("(edited)").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    /// Plain text through LocalizedStringKey makes bare links clickable, but would also read `*` and `_`
    /// as Markdown; escaping those keeps the text as it was written.
    private func markdownSafe(_ text: String) -> String {
        var out = ""
        for ch in text {
            if "\\*_`~[]".contains(ch) { out.append("\\") }
            out.append(ch)
        }
        return out
    }

    private var boosts: some View {
        let grouped = Dictionary(grouping: message.boosts, by: \.content)
        let order = message.boosts.map(\.content).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        return HStack(spacing: 4) {
            ForEach(order, id: \.self) { content in
                let boosts = grouped[content] ?? []
                let mine = boosts.contains { $0.booster.id == myId }
                Button { onBoost(content) } label: {
                    Text("\(content) \(boosts.count)").font(.caption)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(mine ? Color.accentColor.opacity(0.25) : Color.secondary.opacity(0.15)))
                }
                .buttonStyle(.plain)
                .help(boosts.map(\.booster.name).joined(separator: ", "))
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 2) {
            ForEach(quickReactions.prefix(3), id: \.self) { emoji in
                Button(emoji) { onBoost(emoji) }.buttonStyle(.borderless)
            }
            Menu {
                ForEach(quickReactions.dropFirst(3), id: \.self) { emoji in Button(emoji) { onBoost(emoji) } }
            } label: { Image(systemName: "face.smiling") }
                .menuStyle(.borderlessButton).fixedSize()
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 6).fill(.background).shadow(radius: 1))
        .padding(.trailing, 16)
        .offset(y: -6)
    }

    @ViewBuilder
    private var menu: some View {
        Button("Copy Text") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(message.plainText, forType: .string)
        }
        if isMine && message.attachment == nil && message.deleted != true {
            Button("Edit", action: onEdit)
        }
        if isMine || state.me?.administrator == true {
            Button("Delete", role: .destructive, action: onDelete)
        }
    }
}

struct Attachment: View {
    @Environment(AppState.self) private var state
    let file: StoredFile

    var body: some View {
        if file.isImage, let url = state.api?.absolute(file.previewUrl ?? file.url) {
            Link(destination: state.api?.absolute(file.url) ?? url) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.15))
                }
                .frame(maxWidth: 360, maxHeight: 240, alignment: .leading)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        } else if let url = state.api?.absolute(file.downloadUrl) {
            Link(destination: url) {
                Label("\(file.name) (\(ByteCountFormatter.string(fromByteCount: Int64(file.byteSize), countStyle: .file)))",
                      systemImage: "doc")
            }
        }
    }
}

struct PendingRow: View {
    let pending: RoomStore.PendingMessage
    let name: String
    let userId: String
    let onRetry: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Color.clear.frame(width: 36, height: 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(pending.text).foregroundStyle(.secondary)
                if let failed = pending.failed {
                    HStack {
                        Text(failed).foregroundStyle(.red)
                        Button("Retry", action: onRetry).buttonStyle(.link)
                        Button("Discard", action: onDiscard).buttonStyle(.link)
                    }
                    .font(.caption)
                } else {
                    Text("Sending…").font(.caption).foregroundStyle(.tertiary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 2)
    }
}
