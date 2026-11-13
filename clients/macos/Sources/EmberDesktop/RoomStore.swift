import Foundation
import Observation

/// One room's timeline, kept by its socket (`/api/rooms/:id/socket`).
///
/// The room numbers its changes (`seq`); on reconnect the store names the latest it saw (`since`) and
/// the room answers with only what changed (`resumed`). Messages sent while the socket was down stay
/// pending and are checked with `message.check` once it's back.
@MainActor
@Observable
final class RoomStore {
    let roomId: String
    private let api: APIClient
    private let myId: String

    private(set) var messages: [Message] = []
    private(set) var pending: [PendingMessage] = []
    private(set) var present: [User] = []
    private(set) var typing: [User] = []
    private(set) var hasMore = false
    private(set) var loadingHistory = false
    private(set) var connected = false
    private(set) var gone = false
    var lastError: String?
    var visible = true

    private var seq: Int?
    private var socket: Socket?
    private var typingTimers: [String: Timer] = [:]
    private var typingSent = false
    private var typingStopTimer: Timer?

    struct PendingMessage: Identifiable, Hashable {
        let id: String  // clientMessageId
        let text: String
        let body: String
        var failed: String?
    }

    init(roomId: String, api: APIClient, myId: String) {
        self.roomId = roomId
        self.api = api
        self.myId = myId
    }

    func connect() {
        let socket = Socket(
            session: api.session,
            makeRequest: { [weak self] in self?.socketRequest() },
            onText: { [weak self] text in self?.handle(text) },
            onClose: { [weak self] code in
                guard code != EmberCloseCode.notFound, code != EmberCloseCode.revoked else {
                    self?.gone = true
                    return false
                }
                return true
            })
        socket.onStateChange = { [weak self] state in
            guard let self else { return }
            self.connected = state == .open
            if state == .open, !self.pending.isEmpty {
                self.send(.messageCheck(clientMessageIds: self.pending.map(\.id)))
            }
        }
        self.socket = socket
        socket.connect()
    }

    func close() {
        socket?.close()
    }

    private func socketRequest() -> URLRequest? {
        var query = "visible=\(visible ? 1 : 0)&protocol=\(roomProtocol)"
        if let seq { query += "&since=\(seq)" }
        return api.socketRequest("/api/rooms/\(roomId)/socket", query: query)
    }

    private func send(_ frame: RoomClientFrame) {
        socket?.send(frame.text)
    }

    func setVisible(_ visible: Bool) {
        guard visible != self.visible else { return }
        self.visible = visible
        send(.presenceVisible(visible))
    }

    // MARK: Actions

    func sendMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let id = UUID().uuidString.lowercased()
        let body = bodyMarkup(fromPlainText: trimmed)
        pending.append(PendingMessage(id: id, text: trimmed, body: body))
        stopTyping()
        send(.messageCreate(clientMessageId: id, body: body))
    }

    func retry(_ pendingId: String) {
        guard let index = pending.firstIndex(where: { $0.id == pendingId }) else { return }
        pending[index].failed = nil
        send(.messageCreate(clientMessageId: pending[index].id, body: pending[index].body))
    }

    func discard(_ pendingId: String) {
        pending.removeAll { $0.id == pendingId }
    }

    func edit(_ message: Message, to text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        send(.messageUpdate(messageId: message.id, body: bodyMarkup(fromPlainText: trimmed)))
    }

    func delete(_ message: Message) {
        send(.messageDelete(messageId: message.id))
    }

    /// Adds `content` as my boost, or takes mine away if I've already boosted with it.
    func toggleBoost(_ content: String, on message: Message) {
        if let mine = message.boosts.first(where: { $0.content == content && $0.booster.id == myId }) {
            send(.boostDelete(boostId: mine.id))
        } else {
            send(.boostCreate(messageId: message.id, content: content))
        }
    }

    func loadEarlier() {
        guard hasMore, !loadingHistory, let oldest = messages.first else { return }
        loadingHistory = true
        send(.historyBefore(before: oldest.id))
    }

    /// Called as the composer changes. Sends typing.start once, and typing.stop after 3 quiet seconds.
    func composerChanged(isEmpty: Bool) {
        if isEmpty { stopTyping(); return }
        if !typingSent {
            typingSent = true
            send(.typingStart)
        }
        typingStopTimer?.invalidate()
        typingStopTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.stopTyping() }
        }
    }

    private func stopTyping() {
        typingStopTimer?.invalidate()
        guard typingSent else { return }
        typingSent = false
        send(.typingStop)
    }

    func isMine(_ message: Message) -> Bool { message.creator.id == myId }

    // MARK: Frames

    private func handle(_ text: String) {
        let frame: RoomServerFrame
        do {
            frame = try JSONDecoder().decode(RoomServerFrame.self, from: Data(text.utf8))
        } catch {
            lastError = "Couldn't read a frame from the room: \(error.localizedDescription)"
            return
        }
        switch frame {
        case let .welcome(_, present, seq, messages, hasMore):
            self.messages = messages.filter(\.isInRoom)
            self.present = present
            self.seq = seq
            self.hasMore = hasMore
            reconcilePending()
        case let .resumed(changed, deletedIds, present, seq):
            for message in changed { upsert(message) }
            messages.removeAll { deletedIds.contains($0.id) }
            self.present = present
            self.seq = seq
            reconcilePending()
        case let .messageCreated(message, seq):
            self.seq = seq
            clearTyping(message.creator.id)
            upsert(message)
            pending.removeAll { $0.id == message.clientMessageId }
        case let .messageUpdated(message, seq):
            self.seq = seq
            upsert(message)
        case let .messageDeleted(id, seq):
            self.seq = seq
            messages.removeAll { $0.id == id }
        case let .boostCreated(boost, seq):
            self.seq = seq
            if let index = messages.firstIndex(where: { $0.id == boost.messageId }), !messages[index].boosts.contains(where: { $0.id == boost.id }) {
                messages[index].boosts.append(boost)
            }
        case let .boostDeleted(boostId, messageId, seq):
            self.seq = seq
            if let index = messages.firstIndex(where: { $0.id == messageId }) {
                messages[index].boosts.removeAll { $0.id == boostId }
            }
        case let .presenceJoined(user):
            if !present.contains(where: { $0.id == user.id }) { present.append(user) }
        case let .presenceLeft(userId):
            present.removeAll { $0.id == userId }
            clearTyping(userId)
        case let .typing(user, isTyping, threadId):
            guard threadId == nil, user.id != myId else { return }
            if isTyping { startTyping(user) } else { clearTyping(user.id) }
        case let .history(_, older, hasMore):
            let known = Set(messages.map(\.id))
            messages = older.filter { $0.isInRoom && !known.contains($0.id) } + messages
            self.hasMore = hasMore
            loadingHistory = false
        case let .messageChecked(stored, missing):
            pending.removeAll { stored.contains($0.id) }
            for id in missing { retry(id) }
        case let .error(message, clientMessageId):
            if let clientMessageId, let index = pending.firstIndex(where: { $0.id == clientMessageId }) {
                pending[index].failed = message
            } else {
                lastError = message
            }
            loadingHistory = false
        case .pong, .other:
            break
        }
    }

    /// Puts `message` in its place: replaces the stored copy, or inserts it by time. Replies sent only to
    /// a thread update their parent's summary through `message.updated`, so they're left out here.
    private func upsert(_ message: Message) {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            if message.isInRoom { messages[index] = message } else { messages.remove(at: index) }
            return
        }
        guard message.isInRoom else { return }
        let index = messages.lastIndex { $0.createdDate <= message.createdDate }.map { $0 + 1 } ?? 0
        messages.insert(message, at: index)
    }

    private func reconcilePending() {
        let stored = Set(messages.map(\.clientMessageId))
        pending.removeAll { stored.contains($0.id) }
    }

    private func startTyping(_ user: User) {
        if !typing.contains(where: { $0.id == user.id }) { typing.append(user) }
        // A typist who goes quiet without a stop (a closed laptop) drops off after 10 seconds.
        typingTimers[user.id]?.invalidate()
        typingTimers[user.id] = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.clearTyping(user.id) }
        }
    }

    private func clearTyping(_ userId: String) {
        typingTimers.removeValue(forKey: userId)?.invalidate()
        typing.removeAll { $0.id == userId }
    }
}
