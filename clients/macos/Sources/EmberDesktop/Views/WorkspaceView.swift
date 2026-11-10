import SwiftUI

struct WorkspaceView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        @Bindable var state = state
        NavigationSplitView {
            List(selection: $state.selectedRoomId) {
                if !state.starredRooms.isEmpty {
                    Section("Starred") { ForEach(state.starredRooms) { RoomRow(room: $0) } }
                }
                Section("Rooms") { ForEach(state.sortedSharedRooms) { RoomRow(room: $0) } }
                if !state.directs.isEmpty {
                    Section("Direct messages") { ForEach(state.directs) { RoomRow(room: $0) } }
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 240)
            .safeAreaInset(edge: .bottom) {
                if let me = state.me {
                    HStack(spacing: 8) {
                        Avatar(userId: me.id, name: me.name, size: 24)
                        Text(me.name).lineLimit(1)
                        Spacer()
                        Menu {
                            Button("Reload") { Task { await state.reloadSidebar() } }
                            Button("Sign Out") { Task { await state.signOut() } }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .menuStyle(.borderlessButton)
                        .fixedSize()
                    }
                    .padding(10)
                }
            }
        } detail: {
            if let id = state.selectedRoomId, let room = state.room(id), let store = state.store(for: id) {
                RoomView(room: room, store: store)
                    .id(id)
            } else {
                ContentUnavailableView("Pick a room", systemImage: "bubble.left.and.bubble.right")
            }
        }
        .onChange(of: state.selectedRoomId) { _, _ in state.selectionChanged() }
    }
}

struct RoomRow: View {
    @Environment(AppState.self) private var state
    let room: Room

    var body: some View {
        HStack(spacing: 6) {
            if room.isDirect, let other = room.members?.first(where: { $0.id != state.me?.id }) ?? room.members?.first {
                Avatar(userId: other.id, name: other.name, size: 18)
            } else {
                Image(systemName: room.kind == "closed" ? "lock" : "number")
                    .foregroundStyle(.secondary)
                    .frame(width: 18)
            }
            Text(state.title(of: room))
                .fontWeight(room.unread ? .bold : .regular)
                .lineLimit(1)
            Spacer()
            if room.unread {
                Circle().fill(.orange).frame(width: 7, height: 7)
            }
        }
        .tag(room.id)
    }
}

struct Avatar: View {
    @Environment(AppState.self) private var state
    let userId: String
    let name: String
    let size: CGFloat

    var body: some View {
        AsyncImage(url: state.avatarURL(for: userId)) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                ZStack {
                    Color.secondary.opacity(0.25)
                    Text(initials).font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(.secondary)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22))
    }

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}
