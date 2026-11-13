import Foundation
import Observation

/// The signed-in workspace: who's signed in, their rooms, the people directory, and the workspace socket
/// (`/api/socket`) that keeps the sidebar current.
@MainActor
@Observable
final class AppState {
    enum Phase: Equatable { case starting, signedOut, signedIn }

    private static let serverKey = "EmberServerURL"

    var phase: Phase = .starting
    var serverText: String = UserDefaults.standard.string(forKey: AppState.serverKey) ?? ""
    private(set) var api: APIClient?
    private(set) var me: Me?
    private(set) var rooms: [Room] = []
    private(set) var favorites: [String] = []
    private(set) var sharedOrder: [String] = []
    private(set) var people: [String: DirectoryUser] = [:]
    var selectedRoomId: String?
    var appIsActive = true
    var connectionProblem: String?

    private var workspaceSocket: Socket?
    private var roomStores: [String: RoomStore] = [:]

    // MARK: Signing in

    func start() async {
        guard let url = APIClient.serverURL(from: serverText) else { phase = .signedOut; return }
        let api = APIClient(server: url)
        do {
            me = try await api.me()
            self.api = api
            await enterWorkspace()
        } catch {
            phase = .signedOut
        }
    }

    func signIn(email: String, password: String) async throws {
        guard let url = APIClient.serverURL(from: serverText) else { throw APIError.invalidServer }
        let api = APIClient(server: url)
        me = try await api.signIn(email: email, password: password)
        self.api = api
        serverText = url.absoluteString
        UserDefaults.standard.set(serverText, forKey: AppState.serverKey)
        await enterWorkspace()
    }

    func signOut() async {
        workspaceSocket?.close()
        roomStores.values.forEach { $0.close() }
        roomStores = [:]
        await api?.signOut()
        me = nil
        rooms = []
        selectedRoomId = nil
        phase = .signedOut
    }

    private func enterWorkspace() async {
        phase = .signedIn
        await reloadSidebar()
        await reloadDirectory()
        if selectedRoomId == nil { selectedRoomId = sortedSharedRooms.first?.id ?? directs.first?.id }
        connectWorkspaceSocket()
        Notifier.shared.requestPermission()
    }

    // MARK: Sidebar

    func reloadSidebar() async {
        guard let api else { return }
        do {
            let sidebar = try await api.sidebar()
            rooms = sidebar.rooms
            favorites = sidebar.favorites.rooms
            sharedOrder = sidebar.sharedOrder
        } catch APIError.notSignedIn {
            await signOut()
        } catch {
            connectionProblem = error.localizedDescription
        }
    }

    func reloadDirectory() async {
        guard let api, let directory = try? await api.directory() else { return }
        people = Dictionary(directory.users.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private var visibleRooms: [Room] { rooms.filter { !$0.isHidden } }

    var starredRooms: [Room] {
        favorites.compactMap { id in visibleRooms.first { $0.id == id } }
    }

    /// Shared rooms not starred: the workspace's shared order first, then the rest in the order they were made.
    var sortedSharedRooms: [Room] {
        let shared = visibleRooms.filter { !$0.isDirect && !favorites.contains($0.id) }
        let ranked = sharedOrder.compactMap { id in shared.first { $0.id == id } }
        return ranked + shared.filter { !sharedOrder.contains($0.id) }
    }

    /// DMs not starred, latest activity first.
    var directs: [Room] {
        visibleRooms
            .filter { $0.isDirect && !favorites.contains($0.id) }
            .sorted { ($0.activeAt ?? "") > ($1.activeAt ?? "") }
    }

    func room(_ id: String) -> Room? { rooms.first { $0.id == id } }

    func title(of room: Room) -> String { room.title(me: me?.id) }

    func avatarURL(for userId: String) -> URL? {
        guard let path = people[userId]?.avatarUrl else { return nil }
        return api?.absolute(path)
    }

    // MARK: Rooms

    func store(for roomId: String) -> RoomStore? {
        guard let api, let me else { return nil }
        if let store = roomStores[roomId] { return store }
        let store = RoomStore(roomId: roomId, api: api, myId: me.id)
        store.visible = appIsActive
        roomStores[roomId] = store
        store.connect()
        return store
    }

    func setAppActive(_ active: Bool) {
        appIsActive = active
        // Only the room on screen counts as seen; that's what clears its unread mark on the server.
        for (id, store) in roomStores { store.setVisible(active && id == selectedRoomId) }
    }

    func selectionChanged() {
        setAppActive(appIsActive)
        if let id = selectedRoomId, let index = rooms.firstIndex(where: { $0.id == id }), appIsActive {
            rooms[index].unread = false
        }
    }

    var unreadCount: Int { visibleRooms.filter(\.unread).count }

    // MARK: Workspace socket

    private func connectWorkspaceSocket() {
        guard let api else { return }
        workspaceSocket?.close()
        let socket = Socket(
            session: api.session,
            makeRequest: { api.socketRequest("/api/socket") },
            onText: { [weak self] text in self?.handleWorkspace(text) },
            onClose: { [weak self] code in
                if code == EmberCloseCode.revoked {
                    Task { await self?.signOut() }
                    return false
                }
                return true
            })
        socket.onStateChange = { [weak self] state in
            guard let self else { return }
            self.connectionProblem = state == .open ? nil : self.connectionProblem
            // Anything missed while the socket was down comes back with a fresh sidebar.
            if state == .open { Task { await self.reloadSidebar() } }
        }
        workspaceSocket = socket
        socket.connect()
    }

    private func handleWorkspace(_ text: String) {
        guard let frame = try? JSONDecoder().decode(WorkspaceServerFrame.self, from: Data(text.utf8)) else { return }
        switch frame {
        case let .welcome(you):
            me = you
        case let .roomUnread(id):
            guard let index = rooms.firstIndex(where: { $0.id == id }) else { return }
            let onScreen = id == selectedRoomId && appIsActive
            if !onScreen {
                rooms[index].unread = true
                notifyUnread(rooms[index])
            }
        case let .roomRead(id):
            if let index = rooms.firstIndex(where: { $0.id == id }) { rooms[index].unread = false }
        case let .userUpdated(user):
            people[user.id] = user
        case let .roomSaved(room):
            if let index = rooms.firstIndex(where: { $0.id == room.id }) {
                var updated = room
                updated.unread = rooms[index].unread
                updated.involvement = rooms[index].involvement
                rooms[index] = updated
            } else {
                rooms.append(room)
            }
        case let .roomGone(id):
            rooms.removeAll { $0.id == id }
            roomStores.removeValue(forKey: id)?.close()
            if selectedRoomId == id { selectedRoomId = nil }
        case let .roomActive(id, at):
            if let index = rooms.firstIndex(where: { $0.id == id }), (rooms[index].activeAt ?? "") < at {
                rooms[index].activeAt = at
            }
        case let .favoritesChanged(favorites):
            self.favorites = favorites.rooms
        case let .roomInvolvement(id, involvement):
            if let index = rooms.firstIndex(where: { $0.id == id }) { rooms[index].involvement = involvement }
        case .roomsReordered:
            Task { await reloadSidebar() }
        case let .error(message):
            connectionProblem = message
        case .pong, .other:
            break
        }
    }

    /// The workspace socket says only that a room has something unread, not what, so the notification
    /// names the room. Rooms set to "nothing" or hidden stay quiet, as the web app's push does.
    private func notifyUnread(_ room: Room) {
        guard !appIsActive, room.involvement != "nothing", room.involvement != "invisible" else { return }
        let title = room.isDirect ? title(of: room) : "#\(title(of: room))"
        Notifier.shared.post(title: title, body: room.isDirect ? "New direct message" : "New message", roomId: room.id)
    }
}
