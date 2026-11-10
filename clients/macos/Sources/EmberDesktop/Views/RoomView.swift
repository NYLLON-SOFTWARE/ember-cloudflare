import SwiftUI

struct RoomView: View {
    @Environment(AppState.self) private var state
    let room: Room
    let store: RoomStore

    @State private var draft = ""
    @State private var editing: Message?
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            timeline
            Divider()
            composer
        }
        .navigationTitle(room.isDirect ? state.title(of: room) : "#\(state.title(of: room))")
        .navigationSubtitle(subtitle)
        .onAppear { composerFocused = true }
        .alert("Something went wrong", isPresented: .constant(store.lastError != nil)) {
            Button("OK") { store.lastError = nil }
        } message: {
            Text(store.lastError ?? "")
        }
    }

    private var subtitle: String {
        if store.gone { return "You're no longer in this room" }
        if !store.connected { return "Connecting…" }
        return store.present.isEmpty ? "" : "\(store.present.count) here"
    }

    // MARK: Timeline

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if store.hasMore {
                        Button(store.loadingHistory ? "Loading…" : "Load earlier messages") { store.loadEarlier() }
                            .buttonStyle(.link)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .onAppear { store.loadEarlier() }
                    }
                    ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                        MessageRow(
                            message: message,
                            continued: continues(index),
                            isMine: store.isMine(message),
                            myId: state.me?.id,
                            onBoost: { store.toggleBoost($0, on: message) },
                            onEdit: { editing = message; draft = message.plainText; composerFocused = true },
                            onDelete: { store.delete(message) })
                    }
                    ForEach(store.pending) { pending in
                        PendingRow(pending: pending, name: state.me?.name ?? "", userId: state.me?.id ?? "",
                                   onRetry: { store.retry(pending.id) }, onDiscard: { store.discard(pending.id) })
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.vertical, 8)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: store.messages.last?.id) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            .onChange(of: store.pending.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }

    /// A message by the same person within five minutes of the last one skips its name and avatar.
    private func continues(_ index: Int) -> Bool {
        guard index > 0 else { return false }
        let previous = store.messages[index - 1], message = store.messages[index]
        return previous.creator.id == message.creator.id
            && message.createdDate.timeIntervalSince(previous.createdDate) < 300
            && message.parentId == nil
    }

    // MARK: Composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !store.typing.isEmpty {
                Text(typingText).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
            }
            if editing != nil {
                HStack {
                    Text("Editing message").font(.caption.bold())
                    Spacer()
                    Button("Cancel") { editing = nil; draft = "" }.buttonStyle(.link).font(.caption)
                }
                .padding(.horizontal, 4)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($composerFocused)
                    .onKeyPress(.return, phases: .down) { press in
                        // Return sends; Shift-Return or Option-Return adds a line, as in the web app.
                        if press.modifiers.contains(.shift) || press.modifiers.contains(.option) { return .ignored }
                        submit()
                        return .handled
                    }
                    .onChange(of: draft) { _, text in if editing == nil { store.composerChanged(isEmpty: text.isEmpty) } }
                    .disabled(store.gone)
                Button(action: submit) { Image(systemName: "paperplane.fill") }
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .textBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))
        }
        .padding(12)
    }

    private var placeholder: String {
        room.isDirect ? "Message \(state.title(of: room))" : "Message #\(state.title(of: room))"
    }

    private var typingText: String {
        let names = store.typing.map(\.name)
        switch names.count {
        case 1: return "\(names[0]) is typing…"
        case 2: return "\(names[0]) and \(names[1]) are typing…"
        default: return "Several people are typing…"
        }
    }

    private func submit() {
        if let editing {
            store.edit(editing, to: draft)
            self.editing = nil
        } else {
            store.sendMessage(draft)
        }
        draft = ""
    }
}
